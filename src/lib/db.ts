import { parseDocument, SCHEMA_VERSION } from "./parse";
import { newReview, scheduleReview, type ReviewItem, type ReviewQuality, type ReviewSeed } from "./review";
import type { ParsedDoc, SessionState } from "./types";

/**
 * Thin IndexedDB layer. Three stores:
 *   documents — the parsed document, keyed by id (source is kept so a document
 *               can be re-parsed after a parser change).
 *   sessions  — per-document reading state: position, flow nodes, summaries.
 *   reviews   — the spaced-retrieval queue, spanning every document. Indexed by
 *               `dueAt` so the loader can ask what is due without reading the
 *               whole queue, and by `docId` so forgetting a document does not
 *               leave its questions behind.
 */

const DB_NAME = "focusparse";
const DB_VERSION = 2;
const DOCS = "documents";
const SESSIONS = "sessions";
const REVIEWS = "reviews";

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DOCS)) {
        db.createObjectStore(DOCS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(SESSIONS)) {
        db.createObjectStore(SESSIONS, { keyPath: "docId" });
      }
      // Added in version 2. Guarded the same way as the others so a fresh
      // database and an upgraded one take the identical path.
      if (!db.objectStoreNames.contains(REVIEWS)) {
        const store = db.createObjectStore(REVIEWS, { keyPath: "id" });
        store.createIndex("dueAt", "dueAt");
        store.createIndex("docId", "docId");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return dbPromise;
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

/** Persistence is best-effort: private-mode browsers must not break reading. */
function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  return p.catch(() => fallback);
}

export interface DocSummary {
  id: string;
  title: string;
  wordCount: number;
  createdAt: number;
}

export const db = {
  async saveDoc(doc: ParsedDoc): Promise<void> {
    await safe(
      tx<IDBValidKey>(DOCS, "readwrite", (s) => s.put(doc)).then(() => undefined as void),
      undefined as void
    );
  },

  async getDoc(id: string): Promise<ParsedDoc | null> {
    const stored = await safe(
      tx<ParsedDoc | undefined>(DOCS, "readonly", (s) => s.get(id)).then((d) => d ?? null),
      null
    );
    if (!stored) return null;
    if (stored.schema === SCHEMA_VERSION) return stored;

    // Older shape. The original source is kept precisely so a document can be
    // rebuilt by the current parser instead of being thrown away — or worse,
    // handed to the engine with fields it expects missing.
    if (!stored.source) return null;

    const rebuilt: ParsedDoc = {
      ...parseDocument(stored.source, undefined),
      id: stored.id,
      title: stored.title,
      createdAt: stored.createdAt,
    };
    await db.saveDoc(rebuilt);
    return rebuilt;
  },

  /** Rename a stored document without touching its parsed content. */
  async renameDoc(id: string, title: string): Promise<void> {
    const doc = await db.getDoc(id);
    if (!doc) return;
    await db.saveDoc({ ...doc, title });
  },

  async listDocs(): Promise<DocSummary[]> {
    const all = await safe(
      tx<ParsedDoc[]>(DOCS, "readonly", (s) => s.getAll() as IDBRequest<ParsedDoc[]>),
      []
    );
    return all
      .map(({ id, title, wordCount, createdAt }) => ({ id, title, wordCount, createdAt }))
      .sort((a, b) => b.createdAt - a.createdAt);
  },

  async deleteDoc(id: string): Promise<void> {
    await safe(
      tx<undefined>(DOCS, "readwrite", (s) => s.delete(id)).then(() => undefined),
      undefined
    );
    await safe(
      tx<undefined>(SESSIONS, "readwrite", (s) => s.delete(id)).then(() => undefined),
      undefined
    );
    // Reviews outlive the reading session by design, but not the document they
    // quote: a question whose source text is gone can never be checked again.
    await db.deleteReviewsForDoc(id);
  },

  async saveSession(session: SessionState): Promise<void> {
    await safe(
      tx<IDBValidKey>(SESSIONS, "readwrite", (s) => s.put(session)).then(
        () => undefined as void
      ),
      undefined as void
    );
  },

  async getSession(docId: string): Promise<SessionState | null> {
    return safe(
      tx<SessionState | undefined>(SESSIONS, "readonly", (s) => s.get(docId)).then(
        (v) => v ?? null
      ),
      null
    );
  },

  /* ---- Spaced retrieval ------------------------------------------------ */

  /**
   * Record an answer against the queue.
   *
   * Upsert rather than insert: the id is derived from the content, so a term
   * missed twice in two sittings advances one item's schedule instead of
   * stacking duplicates. The returned item carries the new interval, which the
   * UI reports back so the reader can see the schedule respond to the answer.
   */
  async recordAnswer(
    seed: ReviewSeed,
    quality: ReviewQuality,
    now: number = Date.now()
  ): Promise<ReviewItem | null> {
    const existing = await safe(
      tx<ReviewItem | undefined>(REVIEWS, "readonly", (s) => s.get(seed.id)).then(
        (v) => v ?? null
      ),
      null
    );

    // Question text is refreshed from the seed — a re-parse can reword a carrier
    // sentence, and the stored question should follow the document — while the
    // schedule is taken from what is on disk. The caller may be holding a copy
    // read minutes ago, and letting a stale copy write back its own ease would
    // quietly undo progress.
    const base = existing
      ? {
          ...existing,
          ...seed,
          ease: existing.ease,
          intervalDays: existing.intervalDays,
          reps: existing.reps,
          lapses: existing.lapses,
          createdAt: existing.createdAt,
        }
      : newReview(seed, now);

    const next = scheduleReview(base, quality, now);
    await safe(
      tx<IDBValidKey>(REVIEWS, "readwrite", (s) => s.put(next)).then(
        () => undefined as void
      ),
      undefined as void
    );
    return next;
  },

  async listDue(now: number = Date.now(), limit = 40): Promise<ReviewItem[]> {
    const due = await safe(
      tx<ReviewItem[]>(
        REVIEWS,
        "readonly",
        (s) =>
          s
            .index("dueAt")
            .getAll(IDBKeyRange.upperBound(now)) as IDBRequest<ReviewItem[]>
      ),
      []
    );
    // Oldest debt first — the queue should drain, not churn on recent items.
    return due.sort((a, b) => a.dueAt - b.dueAt).slice(0, limit);
  },

  async countDue(now: number = Date.now()): Promise<number> {
    return safe(
      tx<number>(REVIEWS, "readonly", (s) =>
        s.index("dueAt").count(IDBKeyRange.upperBound(now))
      ),
      0
    );
  },

  async countReviews(): Promise<number> {
    return safe(
      tx<number>(REVIEWS, "readonly", (s) => s.count()),
      0
    );
  },

  async deleteReviewsForDoc(docId: string): Promise<void> {
    const items = await safe(
      tx<ReviewItem[]>(
        REVIEWS,
        "readonly",
        (s) => s.index("docId").getAll(docId) as IDBRequest<ReviewItem[]>
      ),
      []
    );
    for (const item of items) {
      await safe(
        tx<undefined>(REVIEWS, "readwrite", (s) => s.delete(item.id)).then(
          () => undefined
        ),
        undefined
      );
    }
  },
};

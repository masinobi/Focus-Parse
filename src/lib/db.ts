import {
  BACKUP_FORMAT,
  emptyCount,
  isBackupDoc,
  isReviewRecord,
  isSessionRecord,
  type Backup,
  type ImportSummary,
} from "./backup";
import { buildEntityIndex, ENTITY_SCHEMA, type DocEntityIndex } from "./entities";
import { isExamRecord, type ExamRecord } from "./history";
import { parseDocument, SCHEMA_VERSION } from "./parse";
import {
  difficulty,
  newReview,
  scheduleReview,
  termKey,
  type ReviewItem,
  type ReviewQuality,
  type ReviewSeed,
  type WeakTerms,
} from "./review";
import type { ParsedDoc, SessionState } from "./types";

/**
 * Thin IndexedDB layer. Five stores:
 *   documents — the parsed document, keyed by id (source is kept so a document
 *               can be re-parsed after a parser change).
 *   sessions  — per-document reading state: position, flow nodes, summaries.
 *   reviews   — the spaced-retrieval queue, spanning every document. Indexed by
 *               `dueAt` so the loader can ask what is due without reading the
 *               whole queue, and by `docId` so forgetting a document does not
 *               leave its questions behind.
 *   entities  — one compact entity index per document. Derived data, kept only
 *               so the corpus view does not have to load nine parsed documents
 *               — several hundred thousand tokens — to answer "where else does
 *               this term come up?".
 *   exams     — one record per mock paper sat. Kept because a single paper
 *               cannot answer the only question worth asking of it, which is
 *               whether the scores are moving.
 */

const DB_NAME = "focusparse";
const DB_VERSION = 4;
const DOCS = "documents";
const SESSIONS = "sessions";
const REVIEWS = "reviews";
const ENTITIES = "entities";
const EXAMS = "exams";

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
      // Added in version 3. No indexes: the whole store is read at once when
      // the corpus view opens, and it holds one small record per document.
      if (!db.objectStoreNames.contains(ENTITIES)) {
        db.createObjectStore(ENTITIES, { keyPath: "docId" });
      }
      // Added in version 4. Indexed by `at` so the home screen can ask for the
      // last few papers without reading every one ever sat.
      if (!db.objectStoreNames.contains(EXAMS)) {
        const store = db.createObjectStore(EXAMS, { keyPath: "id" });
        store.createIndex("at", "at");
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
    await db.syncEntityIndex(doc);
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
    // The index is derived data. Nothing can rebuild it once its document is
    // gone, and leaving it behind would show the corpus a document it no
    // longer has.
    await safe(
      tx<undefined>(ENTITIES, "readwrite", (s) => s.delete(id)).then(() => undefined),
      undefined
    );
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

  /**
   * What the reader is currently losing, keyed by term rather than document.
   *
   * Read in full rather than through an index: there is no index on difficulty,
   * the queue is a few hundred items at most, and this is read once when a
   * document opens and again after a check — not on any hot path.
   *
   * Summaries are excluded. Their "answer" is a whole sentence the reader
   * wrote, so it can never be the term a blank is cut around, and folding them
   * in would only put unreachable keys in the map.
   */
  async weakTerms(): Promise<WeakTerms> {
    const all = await safe(
      tx<ReviewItem[]>(REVIEWS, "readonly", (s) => s.getAll() as IDBRequest<ReviewItem[]>),
      []
    );

    const weak: WeakTerms = {};
    for (const item of all) {
      if (item.kind === "summary") continue;
      const weight = difficulty(item);
      if (weight <= 0) continue;

      const key = termKey(item.answer, item.acronym);
      const existing = weak[key];
      // The same term can be queued from several documents. Take the worst
      // showing: struggling with it anywhere is struggling with it.
      if (!existing || weight > existing.weight) {
        weak[key] = { key, weight, lapses: Math.max(item.lapses, existing?.lapses ?? 0) };
      } else if (item.lapses > existing.lapses) {
        existing.lapses = item.lapses;
      }
    }
    return weak;
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

  /* ---- Exam history ----------------------------------------------------- */

  /**
   * Keep a marked paper.
   *
   * Deliberately *not* removed by `deleteDoc`, unlike reviews and the entity
   * index. Those are questions about a document and cannot outlive it — a
   * question whose source text is gone can never be checked again. A paper is
   * a fact about the reader on a date: it was sat, it scored what it scored,
   * and forgetting one of the nine guidelines afterwards does not make that
   * untrue. Each breakdown row keeps the title it was sat under, so the row
   * still reads after the document is gone.
   */
  async saveExam(record: ExamRecord): Promise<void> {
    await safe(
      tx<IDBValidKey>(EXAMS, "readwrite", (s) => s.put(record)).then(
        () => undefined as void
      ),
      undefined as void
    );
  },

  /** Papers newest first. */
  async listExams(limit = 30): Promise<ExamRecord[]> {
    const all = await safe(
      tx<ExamRecord[]>(EXAMS, "readonly", (s) => s.getAll() as IDBRequest<ExamRecord[]>),
      []
    );
    return all.sort((a, b) => b.at - a.at).slice(0, limit);
  },

  async countExams(): Promise<number> {
    return safe(
      tx<number>(EXAMS, "readonly", (s) => s.count()),
      0
    );
  },

  /* ---- Backup and restore ---------------------------------------------- */

  /**
   * Everything worth keeping, as one plain object.
   *
   * Documents are reduced to their `source`: the parser rebuilds the rest
   * exactly, and a parsed corpus would be tens of megabytes of token arrays.
   * The entity index is left out for the same reason — it is derived, and
   * `listEntityIndexes` rebuilds any that are missing.
   */
  async exportAll(): Promise<Backup> {
    const docs = await safe(
      tx<ParsedDoc[]>(DOCS, "readonly", (s) => s.getAll() as IDBRequest<ParsedDoc[]>),
      []
    );
    const sessions = await safe(
      tx<SessionState[]>(
        SESSIONS,
        "readonly",
        (s) => s.getAll() as IDBRequest<SessionState[]>
      ),
      []
    );
    const reviews = await safe(
      tx<ReviewItem[]>(REVIEWS, "readonly", (s) => s.getAll() as IDBRequest<ReviewItem[]>),
      []
    );
    const exams = await safe(
      tx<ExamRecord[]>(EXAMS, "readonly", (s) => s.getAll() as IDBRequest<ExamRecord[]>),
      []
    );

    return {
      app: "focusparse",
      format: BACKUP_FORMAT,
      exportedAt: Date.now(),
      documents: docs
        .filter((d) => typeof d.source === "string" && d.source.trim())
        .map(({ id, title, source, wordCount, createdAt }) => ({
          id,
          title,
          source,
          wordCount,
          createdAt,
        })),
      sessions,
      reviews,
      exams,
    };
  },

  /**
   * Merge a backup into whatever is already here.
   *
   * Nothing is deleted and nothing newer is overwritten: where both sides hold
   * a record, the one with the later timestamp wins. Restoring a three-week-old
   * backup onto a machine that has been read on since must not rewind that
   * reading — for reviews in particular, an older copy carries an older
   * interval, and applying it would quietly undo weeks of scheduling.
   *
   * Documents are re-parsed rather than restored verbatim, so a backup taken
   * under an older parser comes back with the current one.
   */
  async importAll(
    backup: Backup,
    onProgress?: (done: number, total: number, title: string) => void
  ): Promise<ImportSummary> {
    const summary: ImportSummary = {
      documents: emptyCount(),
      sessions: emptyCount(),
      reviews: emptyCount(),
      exams: emptyCount(),
      skipped: 0,
    };

    for (let i = 0; i < backup.documents.length; i++) {
      const entry = backup.documents[i];
      if (!isBackupDoc(entry)) {
        summary.skipped += 1;
        continue;
      }
      onProgress?.(i, backup.documents.length, entry.title);

      const existing = await safe(
        tx<ParsedDoc | undefined>(DOCS, "readonly", (s) => s.get(entry.id)).then(
          (d) => d ?? null
        ),
        null
      );

      const rebuilt: ParsedDoc = {
        ...parseDocument(entry.source, undefined),
        id: entry.id,
        title: entry.title,
        createdAt: entry.createdAt ?? Date.now(),
      };
      await db.saveDoc(rebuilt);
      if (existing) summary.documents.updated += 1;
      else summary.documents.added += 1;
    }

    for (const session of backup.sessions) {
      if (!isSessionRecord(session)) {
        summary.skipped += 1;
        continue;
      }
      const existing = await db.getSession(session.docId);
      if (existing && (existing.updatedAt ?? 0) >= (session.updatedAt ?? 0)) {
        summary.sessions.kept += 1;
        continue;
      }
      await db.saveSession(session);
      if (existing) summary.sessions.updated += 1;
      else summary.sessions.added += 1;
    }

    for (const item of backup.reviews) {
      if (!isReviewRecord(item)) {
        summary.skipped += 1;
        continue;
      }
      const existing = await safe(
        tx<ReviewItem | undefined>(REVIEWS, "readonly", (s) => s.get(item.id)).then(
          (v) => v ?? null
        ),
        null
      );
      if (existing && (existing.updatedAt ?? 0) >= (item.updatedAt ?? 0)) {
        summary.reviews.kept += 1;
        continue;
      }
      await safe(
        tx<IDBValidKey>(REVIEWS, "readwrite", (s) => s.put(item)).then(
          () => undefined as void
        ),
        undefined as void
      );
      if (existing) summary.reviews.updated += 1;
      else summary.reviews.added += 1;
    }

    // A paper is immutable once marked, so there is no newer-wins contest to
    // run here — unlike a review item, whose interval genuinely changes. A
    // record already present is the same record.
    for (const record of backup.exams ?? []) {
      if (!isExamRecord(record)) {
        summary.skipped += 1;
        continue;
      }
      const existing = await safe(
        tx<ExamRecord | undefined>(EXAMS, "readonly", (s) => s.get(record.id)).then(
          (v) => v ?? null
        ),
        null
      );
      if (existing) {
        summary.exams.kept += 1;
        continue;
      }
      await db.saveExam(record);
      summary.exams.added += 1;
    }

    onProgress?.(backup.documents.length, backup.documents.length, "");
    return summary;
  },

  /* ---- Entity index ---------------------------------------------------- */

  /**
   * Keep a document's entity index in step with the document.
   *
   * Rebuilt only when it could actually have changed: a different word count
   * means a re-parse, a different schema means different extraction rules, and
   * a rename is folded in without walking the token stream again. Renaming a
   * 524-page guideline should not cost a full re-index.
   */
  async syncEntityIndex(doc: ParsedDoc): Promise<DocEntityIndex> {
    const existing = await safe(
      tx<DocEntityIndex | undefined>(ENTITIES, "readonly", (s) => s.get(doc.id)).then(
        (v) => v ?? null
      ),
      null
    );

    if (
      existing &&
      existing.schema === ENTITY_SCHEMA &&
      existing.wordCount === doc.wordCount
    ) {
      if (existing.docTitle === doc.title) return existing;
      const renamed = { ...existing, docTitle: doc.title };
      await safe(
        tx<IDBValidKey>(ENTITIES, "readwrite", (s) => s.put(renamed)).then(
          () => undefined as void
        ),
        undefined as void
      );
      return renamed;
    }

    const built = buildEntityIndex(doc);
    await safe(
      tx<IDBValidKey>(ENTITIES, "readwrite", (s) => s.put(built)).then(
        () => undefined as void
      ),
      undefined as void
    );
    return built;
  },

  /**
   * Every stored document's index, building any that are missing or stale.
   *
   * Documents stored before this existed have no index, and rebuilding one
   * means loading the whole parsed document — which for the GCDMP is a few
   * hundred thousand tokens. That is why `onProgress` is here: the first open
   * after an upgrade has real work to do and the reader should see it, not
   * wonder whether the view has hung.
   */
  async listEntityIndexes(
    onProgress?: (done: number, total: number, title: string) => void
  ): Promise<DocEntityIndex[]> {
    const summaries = await db.listDocs();
    const stored = await safe(
      tx<DocEntityIndex[]>(
        ENTITIES,
        "readonly",
        (s) => s.getAll() as IDBRequest<DocEntityIndex[]>
      ),
      []
    );
    const byId = new Map(stored.map((i) => [i.docId, i]));

    const out: DocEntityIndex[] = [];
    for (let i = 0; i < summaries.length; i++) {
      const summary = summaries[i];
      onProgress?.(i, summaries.length, summary.title);

      const index = byId.get(summary.id);
      if (
        index &&
        index.schema === ENTITY_SCHEMA &&
        index.wordCount === summary.wordCount &&
        index.docTitle === summary.title
      ) {
        out.push(index);
        continue;
      }

      // `getDoc` re-parses a stale document, so this also picks up any parser
      // change since the index was written.
      const doc = await db.getDoc(summary.id);
      if (!doc) continue;
      out.push(await db.syncEntityIndex(doc));
    }

    onProgress?.(summaries.length, summaries.length, "");
    return out;
  },
};

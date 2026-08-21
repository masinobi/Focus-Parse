import type { ParsedDoc, SessionState } from "./types";

/**
 * Thin IndexedDB layer. Two stores:
 *   documents — the parsed document, keyed by id (source is kept so a document
 *               can be re-parsed after a parser change).
 *   sessions  — per-document reading state: position, flow nodes, summaries.
 */

const DB_NAME = "focusparse";
const DB_VERSION = 1;
const DOCS = "documents";
const SESSIONS = "sessions";

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
    return safe(
      tx<ParsedDoc | undefined>(DOCS, "readonly", (s) => s.get(id)).then((d) => d ?? null),
      null
    );
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
};

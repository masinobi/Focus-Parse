import type { ReviewItem } from "./review";
import type { SessionState } from "./types";

/**
 * Backup and restore.
 *
 * Everything this app has ever produced — every summary written at an
 * intercept, every captured node, every review interval earned over weeks —
 * lives in one browser's IndexedDB. Clearing site data, resetting a browser or
 * moving to another machine loses all of it, silently and with no recovery.
 * For someone working toward a dated exam that is the largest actual risk in
 * the app, and it is not a risk anything else here mitigates.
 *
 * **Documents are exported as their source, not as parsed documents.** A
 * parsed GCDMP is a few hundred thousand tokens and chunks — tens of megabytes
 * of JSON that the parser can regenerate exactly. `source` is a complete record
 * by design (it is what `db.getDoc` already rebuilds from when the schema
 * moves), so the backup stays small, stays readable, and cannot carry a stale
 * token shape into a future parser.
 *
 * **Import never deletes.** It merges, and where both sides have a record it
 * keeps whichever was touched last. Restoring a three-week-old backup onto a
 * machine that has since been read on must not rewind that reading, and a
 * restore that quietly destroys newer work is worse than no restore at all.
 */

/** Shape version of the backup file itself. */
export const BACKUP_FORMAT = 1;

/** A document, reduced to what the parser needs to rebuild it. */
export interface BackupDoc {
  id: string;
  title: string;
  source: string;
  wordCount: number;
  createdAt: number;
}

export interface Backup {
  app: "focusparse";
  format: number;
  exportedAt: number;
  documents: BackupDoc[];
  sessions: SessionState[];
  reviews: ReviewItem[];
}

/** What a restore actually did, per store. */
export interface MergeCount {
  added: number;
  updated: number;
  /** Present locally in a newer form, so the backup's copy was not applied. */
  kept: number;
}

export interface ImportSummary {
  documents: MergeCount;
  sessions: MergeCount;
  reviews: MergeCount;
  /** Records rejected as malformed, reported rather than silently dropped. */
  skipped: number;
}

export function emptyCount(): MergeCount {
  return { added: 0, updated: 0, kept: 0 };
}

/**
 * Validate a parsed JSON file as a backup.
 *
 * Deliberately shallow: it checks the envelope and that the three collections
 * are arrays, then the importer validates each record as it goes. A file that
 * is 99% good should restore the 99%, with the rest counted in `skipped` — an
 * all-or-nothing parse would throw away a whole backup over one bad row.
 */
export function isBackup(value: unknown): value is Backup {
  if (!value || typeof value !== "object") return false;
  const b = value as Partial<Backup>;
  return (
    b.app === "focusparse" &&
    typeof b.format === "number" &&
    Array.isArray(b.documents) &&
    Array.isArray(b.sessions) &&
    Array.isArray(b.reviews)
  );
}

export function isBackupDoc(value: unknown): value is BackupDoc {
  if (!value || typeof value !== "object") return false;
  const d = value as Partial<BackupDoc>;
  return (
    typeof d.id === "string" &&
    d.id.length > 0 &&
    typeof d.title === "string" &&
    typeof d.source === "string" &&
    d.source.trim().length > 0
  );
}

export function isSessionRecord(value: unknown): value is SessionState {
  if (!value || typeof value !== "object") return false;
  const s = value as Partial<SessionState>;
  return typeof s.docId === "string" && typeof s.tokenIndex === "number";
}

export function isReviewRecord(value: unknown): value is ReviewItem {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<ReviewItem>;
  return (
    typeof r.id === "string" &&
    typeof r.docId === "string" &&
    typeof r.prompt === "string" &&
    typeof r.dueAt === "number"
  );
}

/** Filename for a backup taken now. Sorts chronologically in a file listing. */
export function backupFilename(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `focusparse-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate()
  )}.json`;
}

/** One-line description of what a file holds, shown before it is applied. */
export function describeBackup(backup: Backup): string {
  const when = new Date(backup.exportedAt || Date.now()).toLocaleDateString();
  const parts = [
    `${backup.documents.length} ${backup.documents.length === 1 ? "document" : "documents"}`,
    `${backup.sessions.length} ${backup.sessions.length === 1 ? "session" : "sessions"}`,
    `${backup.reviews.length} review ${backup.reviews.length === 1 ? "item" : "items"}`,
  ];
  return `${parts.join(" · ")} — exported ${when}`;
}

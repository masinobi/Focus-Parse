/**
 * Spaced retrieval.
 *
 * Everything the reader produces during a session — a summary at an intercept,
 * a term they failed to recall at a cloze, a grid cell they got wrong — used to
 * be written to IndexedDB and never looked at again. Reading a dense guideline
 * once and never being asked about it again is how the material evaporates
 * before it is needed, so each of those artefacts becomes a review item on an
 * interval instead.
 *
 * The scheduler is deliberately plain. It is SM-2 with a four-point grade,
 * which is well understood, needs no tuning, and produces intervals a reader can
 * predict — a retention system that behaves unpredictably is one that gets
 * abandoned.
 */

export type ReviewKind = "summary" | "cloze" | "grid";

/**
 * How well the item came back.
 *
 * Auto-graded items only ever produce `again` or `good`: the app knows whether
 * the answer was right, not how hard it was. Self-graded summaries use the full
 * range, because only the reader knows what it cost them.
 */
export type ReviewQuality = 0 | 1 | 2 | 3;

export const QUALITY = {
  again: 0,
  hard: 1,
  good: 2,
  easy: 3,
} as const;

export interface ReviewItem {
  /** Stable and content-derived, so re-answering updates rather than duplicates. */
  id: string;
  docId: string;
  docTitle: string;
  kind: ReviewKind;

  /** What the reader is asked. */
  prompt: string;
  /** What counts as right. For a summary this is the reader's own sentence. */
  answer: string;
  /** Multiple-choice options, for grid items. */
  options?: string[];
  /** Where it came from, shown after answering. */
  context?: string;
  /** Acronym key, so an expansion is accepted for the acronym. */
  acronym?: string;
  /** Section this came from, for grouping in the queue. */
  section?: number;

  ease: number;
  /** Current interval in days. Sub-day intervals are held as 0. */
  intervalDays: number;
  reps: number;
  lapses: number;
  dueAt: number;
  createdAt: number;
  updatedAt: number;
}

/** A new item before it has ever been scheduled. */
export type ReviewSeed = Omit<
  ReviewItem,
  "ease" | "intervalDays" | "reps" | "lapses" | "dueAt" | "createdAt" | "updatedAt"
>;

const DAY_MS = 86_400_000;

/** Starting ease factor, from SM-2. */
const DEFAULT_EASE = 2.5;

/**
 * Ease floor. Below this an item that keeps being failed would be scheduled
 * every day forever, which is how a review queue becomes a wall of leeches.
 */
const MIN_EASE = 1.3;
const MAX_EASE = 2.8;

/**
 * A failed item comes back inside the same sitting rather than tomorrow. The
 * point of failing is to see it again while the miss is still felt.
 */
const RELEARN_MS = 10 * 60_000;

/** Longest interval. Beyond a couple of months this stops being study. */
const MAX_INTERVAL_DAYS = 180;

export function newReview(seed: ReviewSeed, now: number): ReviewItem {
  return {
    ...seed,
    ease: DEFAULT_EASE,
    intervalDays: 0,
    reps: 0,
    lapses: 0,
    dueAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Advance an item after it has been answered.
 *
 * The ease adjustment is the standard SM-2 curve rescaled from its 0–5 grade to
 * the 0–3 one used here: `good` leaves ease untouched, `easy` raises it,
 * `hard` lowers it, and `again` lowers it hardest and resets the interval.
 */
export function scheduleReview(
  item: ReviewItem,
  quality: ReviewQuality,
  now: number
): ReviewItem {
  const delta = [-0.8, -0.15, 0, 0.15][quality];
  const ease = Math.min(MAX_EASE, Math.max(MIN_EASE, item.ease + delta));

  if (quality === QUALITY.again) {
    return {
      ...item,
      ease,
      intervalDays: 0,
      reps: 0,
      lapses: item.lapses + 1,
      dueAt: now + RELEARN_MS,
      updatedAt: now,
    };
  }

  const reps = item.reps + 1;
  const intervalDays = Math.min(
    MAX_INTERVAL_DAYS,
    reps === 1
      ? quality === QUALITY.easy
        ? 3
        : 1
      : reps === 2
        ? quality === QUALITY.hard
          ? 3
          : 6
        : Math.max(1, Math.round(item.intervalDays * ease))
  );

  return {
    ...item,
    ease,
    intervalDays,
    reps,
    dueAt: now + intervalDays * DAY_MS,
    updatedAt: now,
  };
}

/** Human-readable interval, for the "next in…" line after an answer. */
export function formatInterval(item: ReviewItem): string {
  if (item.intervalDays <= 0) return "10 minutes";
  if (item.intervalDays === 1) return "1 day";
  if (item.intervalDays < 30) return `${item.intervalDays} days`;
  const months = Math.round(item.intervalDays / 30);
  return months === 1 ? "1 month" : `${months} months`;
}

/* ------------------------------------------------------------------ *
 * Item identity
 * ------------------------------------------------------------------ *
 *
 * Ids are derived from content rather than generated, so answering the same
 * term at a cloze on Monday and again on Thursday updates one item's schedule
 * instead of stacking two copies of the same question in the queue.
 */

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export function clozeId(docId: string, answer: string): string {
  return `${docId}:cloze:${slug(answer)}`;
}

export function gridId(docId: string, block: number, row: string, column: string): string {
  return `${docId}:grid:${block}:${slug(row)}:${slug(column)}`;
}

export function summaryId(docId: string, section: number): string {
  return `${docId}:summary:${section}`;
}

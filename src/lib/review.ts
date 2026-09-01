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

/**
 * `acronym` arrived with the mock exam: a definition question, asked and marked
 * the same way a cloze is, but whose prompt is the term rather than a sentence
 * with a hole in it.
 */
export type ReviewKind = "summary" | "cloze" | "grid" | "acronym";

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
  /**
   * The reader was shown the section's own vocabulary before writing this.
   *
   * A summary written against a blank page is free recall; one written after
   * three nouns were put on screen is cued recall, and they are not the same
   * evidence. The anchors exist because the blank page is where a reader with
   * executive dysfunction stalls out — but a scaffold that goes unrecorded
   * quietly inflates every downstream judgement of the same sentence: the
   * grader's `missed` list shrinks, and the self-grade at review is made
   * against a sentence whose nouns were supplied.
   *
   * So it is written down, the way `gridAttempts` writes down attempts spent.
   * It does *not* change what is owed. The reader cannot un-see the anchors,
   * and a debt that cannot be discharged is worse than no debt at all —
   * invariant 20. Coverage counts a cued summary exactly as it counts any
   * other; only the record of how it was produced differs.
   *
   * Optional for the reason `FlowNode.links` is: every item already on disk
   * predates this and reads back `undefined`, which must mean "not cued"
   * rather than crash.
   */
  cued?: boolean;

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
 *
 * `horizonDays` is the exam date's doing — the longest interval worth granting,
 * because an item scheduled past the paper is worth nothing and it is the items
 * going *best* that earn the intervals that fall off the end. It only ever
 * shortens: `undefined` (no date, or the date has passed) is exactly the
 * original scheduler, and ease, reps and lapses are untouched by it, so a
 * horizon that comes and goes leaves no mark on what the queue has learned.
 * See `deadline.ts` for why it is half the remaining time and not all of it.
 */
export function scheduleReview(
  item: ReviewItem,
  quality: ReviewQuality,
  now: number,
  horizonDays?: number | null
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
  // The horizon is applied last and never below one day: the point is to bring
  // the item back before the exam, not to schedule it into the past.
  const cap =
    horizonDays === undefined || horizonDays === null
      ? MAX_INTERVAL_DAYS
      : Math.min(MAX_INTERVAL_DAYS, Math.max(1, Math.floor(horizonDays)));
  const intervalDays = Math.min(
    cap,
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

/* ------------------------------------------------------------------ *
 * Difficulty
 * ------------------------------------------------------------------ */

/**
 * What the reader is currently struggling with.
 *
 * The queue already knows this — it is the whole content of `lapses` and
 * `ease` — but until now it only spent that knowledge on *when* to ask again.
 * The reading engine picks blanks by salience alone, so a term failed three
 * times in review is no more likely to be blanked on the next pass through a
 * document than one that has never given any trouble. Weighting closes that
 * loop: what the queue has learned steers what the next spot check asks about.
 */
export interface WeakTerm {
  key: string;
  /** 0 (solid) to 1 (badly stuck). */
  weight: number;
  /** Times it has been failed outright, for reporting it back to the reader. */
  lapses: number;
}

export type WeakTerms = Record<string, WeakTerm>;

/** Lapses at which a term counts as fully stuck. */
const WEAK_LAPSES = 3;

/**
 * How badly an item is going, as 0–1.
 *
 * Two independent signals, combined with `max` so either alone is enough.
 * Lapses are the direct evidence — the item was failed outright. Ease is the
 * slower one: a summary self-graded `hard` three times has never been failed
 * but is plainly not settling, and an item whose ease has been driven to the
 * floor is by definition the queue's own account of a term that will not stick.
 */
export function difficulty(item: Pick<ReviewItem, "lapses" | "ease">): number {
  const fromLapses = Math.min(1, Math.max(0, item.lapses) / WEAK_LAPSES);
  const fromEase = Math.max(
    0,
    Math.min(1, (DEFAULT_EASE - item.ease) / (DEFAULT_EASE - MIN_EASE))
  );
  return Math.max(fromLapses, fromEase);
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

/**
 * Identity of a *term*, independent of the document it was met in.
 *
 * Review ids are per-document on purpose — the same word blanked out of two
 * guidelines is two questions with two carrier sentences. Difficulty is not:
 * a reader who cannot hold on to "SUSAR" cannot hold on to it in the GCDMP
 * either, so the weakness has to be keyed by the term alone or nine documents
 * each learn the same lesson separately and none of them acts on it.
 *
 * An acronym keys on its dictionary entry rather than its spelling, so "CRFs"
 * and "CRF" are one term.
 */
export function termKey(answer: string, acronym?: string): string {
  return acronym ?? slug(answer);
}

export function gridId(docId: string, block: number, row: string, column: string): string {
  return `${docId}:grid:${block}:${slug(row)}:${slug(column)}`;
}

export function summaryId(docId: string, section: number): string {
  return `${docId}:summary:${section}`;
}

/**
 * Acronym items are keyed by the term alone, not by where it was met. The
 * expansion of "SUSAR" does not differ between guidelines, so asking it once
 * per document would be the same question three times in one queue.
 */
export function acronymId(acronym: string): string {
  return `acronym:${acronym}`;
}

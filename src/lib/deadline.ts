/**
 * The exam date, and what it does to the review schedule.
 *
 * Nothing in this app knew when the exam was. The scheduler is SM-2, which
 * grows an interval for as long as an item keeps coming back right, capped at
 * six months because beyond that it stops being study. That is the correct
 * shape for open-ended retention and the wrong one for a dated exam: an item
 * scheduled for after the date is worth exactly nothing, and it is precisely
 * the items going *well* — the ones that have earned long intervals — that
 * fall off the far end. A reader six weeks out, doing everything the app asks,
 * would sit the paper having not seen their strongest hundred terms since the
 * month before.
 *
 * So the interval gets a horizon.
 *
 * **Never schedule beyond half the time remaining.** Not "before the exam",
 * which is the obvious rule and the wrong one: an item landing the day before
 * gets one look and no room to recover if it fails, and near the date every
 * item collapses onto the same day. Halving is self-correcting — 60 days out
 * an item can reach 30, then 15, then 7, 3, 1 — so a term gets roughly
 * log2(days) further looks, spread out, each with time behind it to re-learn
 * from a miss.
 *
 * The horizon only ever *shortens* an interval. It cannot promote an item, and
 * it does not touch the relearning path: a failed item still comes back inside
 * the same sitting, which is already sooner than any horizon.
 *
 * Kept in `localStorage` beside the voice and the words-per-minute target,
 * because like those it is a property of the reader rather than of any
 * document — and unlike those it is worth saying out loud that backups do not
 * carry it. A backup is an IndexedDB export; re-entering a date is ten
 * seconds, and widening the backup format to reach into `localStorage` for one
 * string is not a trade worth making.
 */

const KEY = "focusparse:examdate";

/**
 * The horizon as a share of the time remaining.
 *
 * Half. See the note above: this is the number that makes the rule
 * self-correcting rather than a wall on the final day.
 */
const HORIZON_SHARE = 0.5;

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD`, which is what a date input produces and what a reader means. */
export type ExamDate = string;

export function isExamDate(value: unknown): value is ExamDate {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function loadDeadline(): ExamDate | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    return isExamDate(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function saveDeadline(date: ExamDate | null): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (date === null) localStorage.removeItem(KEY);
    else if (isExamDate(date)) localStorage.setItem(KEY, date);
  } catch {
    /* Private mode. The reader can still read; they just re-enter the date. */
  }
}

/**
 * Whole days from today to the exam, in local time.
 *
 * Both ends are floored to local midnight before subtracting, so this counts
 * *calendar days* rather than 24-hour periods. An exam tomorrow is 1 whether it
 * is asked at breakfast or at eleven at night — which is what a reader means by
 * "one day left", and what stops the horizon shifting under them through the
 * day. Zero on the day itself, negative afterwards.
 */
export function daysUntil(date: ExamDate, now: number = Date.now()): number {
  const [y, m, d] = date.split("-").map(Number);
  const exam = new Date(y, m - 1, d).getTime();
  const today = new Date(now);
  const midnight = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  ).getTime();
  return Math.round((exam - midnight) / DAY_MS);
}

/**
 * The longest interval worth granting, or `null` for no limit.
 *
 * `null` for no date, and `null` once the date has arrived or passed: after
 * the exam the app has no business cramming, and on the day itself there is
 * nothing left to schedule into. Both cases return the scheduler to exactly
 * its old behaviour rather than to some degenerate one-day loop.
 */
export function horizonDays(
  date: ExamDate | null,
  now: number = Date.now()
): number | null {
  if (!date) return null;
  const left = daysUntil(date, now);
  if (left <= 0) return null;
  return Math.max(1, Math.floor(left * HORIZON_SHARE));
}

/* ------------------------------------------------------------------ *
 * Reporting
 * ------------------------------------------------------------------ */

export interface DeadlineState {
  date: ExamDate;
  /** Calendar days remaining. Zero today, negative once it has gone. */
  daysLeft: number;
  passed: boolean;
  /** The cap currently being applied, or `null` when none is. */
  horizon: number | null;
}

export function deadlineState(
  date: ExamDate | null,
  now: number = Date.now()
): DeadlineState | null {
  if (!date) return null;
  const daysLeft = daysUntil(date, now);
  return {
    date,
    daysLeft,
    passed: daysLeft < 0,
    horizon: horizonDays(date, now),
  };
}

/** "in 12 days" / "today" / "3 days ago". */
export function describeDeadline(state: DeadlineState): string {
  if (state.daysLeft === 0) return "today";
  if (state.daysLeft === 1) return "tomorrow";
  if (state.daysLeft > 1) return `in ${state.daysLeft} days`;
  if (state.daysLeft === -1) return "yesterday";
  return `${Math.abs(state.daysLeft)} days ago`;
}

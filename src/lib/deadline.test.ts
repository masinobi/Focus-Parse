import { describe, expect, it } from "vitest";

import {
  daysUntil,
  deadlineState,
  describeDeadline,
  horizonDays,
  isExamDate,
} from "./deadline";
import { newReview, scheduleReview, QUALITY, type ReviewItem } from "./review";

/**
 * The horizon's one promise, and the arithmetic under it.
 *
 * The promise is that with an exam date set, nothing in the queue is scheduled
 * to come round after it. That is not a statement about one call — it is a
 * statement about a reader answering items over weeks — so most of what is
 * below is a simulation rather than an assertion about a single interval. A
 * per-call test would pass on a rule that quietly lets an item drift past the
 * date after five good answers, which is exactly the failure this exists to
 * rule out.
 */

const DAY = 86_400_000;

/** Midday, so nothing here depends on which side of midnight a test runs. */
function at(y: number, m: number, d: number): number {
  return new Date(y, m - 1, d, 12, 0, 0).getTime();
}

function item(overrides: Partial<ReviewItem> = {}): ReviewItem {
  return {
    ...newReview(
      {
        id: "i",
        docId: "d",
        docTitle: "T",
        kind: "cloze",
        prompt: "p",
        answer: "a",
      },
      0
    ),
    ...overrides,
  };
}

describe("isExamDate", () => {
  it("accepts a calendar date", () => {
    expect(isExamDate("2026-11-04")).toBe(true);
  });

  it.each([
    ["a timestamp", "1787639166303"],
    ["a slashed date", "2026/11/04"],
    ["a short year", "26-11-04"],
    ["nothing", null],
    ["a number", 20261104],
  ])("rejects %s", (_label, value) => {
    expect(isExamDate(value)).toBe(false);
  });
});

describe("daysUntil", () => {
  it("is zero on the day itself", () => {
    expect(daysUntil("2026-11-04", at(2026, 11, 4))).toBe(0);
  });

  it("is one the day before", () => {
    expect(daysUntil("2026-11-04", at(2026, 11, 3))).toBe(1);
  });

  it("goes negative afterwards", () => {
    expect(daysUntil("2026-11-04", at(2026, 11, 7))).toBe(-3);
  });

  it("counts calendar days, not 24-hour periods", () => {
    // Both of these are "tomorrow" to a reader, and the horizon must not move
    // under them as the day goes on.
    const earlyMorning = new Date(2026, 10, 3, 0, 5).getTime();
    const lateNight = new Date(2026, 10, 3, 23, 55).getTime();
    expect(daysUntil("2026-11-04", earlyMorning)).toBe(1);
    expect(daysUntil("2026-11-04", lateNight)).toBe(1);
  });

  it("crosses a month boundary", () => {
    expect(daysUntil("2026-12-01", at(2026, 11, 24))).toBe(7);
  });
});

describe("horizonDays", () => {
  it("is null with no date, so the scheduler is untouched", () => {
    expect(horizonDays(null)).toBeNull();
  });

  it("is null on the day of the exam", () => {
    expect(horizonDays("2026-11-04", at(2026, 11, 4))).toBeNull();
  });

  it("is null once the exam has passed", () => {
    // After the date the app has no business still compressing intervals.
    expect(horizonDays("2026-11-04", at(2026, 11, 5))).toBeNull();
  });

  it("is half the remaining days", () => {
    expect(horizonDays("2026-11-04", at(2026, 10, 5))).toBe(15);
  });

  it("floors rather than rounds", () => {
    expect(horizonDays("2026-11-04", at(2026, 11, 1))).toBe(1);
  });

  it("never drops below a day", () => {
    expect(horizonDays("2026-11-04", at(2026, 11, 3))).toBe(1);
  });
});

describe("scheduleReview under a horizon", () => {
  it("is unchanged when there is no horizon", () => {
    const settled = item({ reps: 5, intervalDays: 40, ease: 2.5 });
    expect(scheduleReview(settled, QUALITY.good, 0).intervalDays).toBe(
      scheduleReview(settled, QUALITY.good, 0, null).intervalDays
    );
  });

  it("caps an earned interval at the horizon", () => {
    const settled = item({ reps: 5, intervalDays: 40, ease: 2.5 });
    expect(scheduleReview(settled, QUALITY.good, 0, 12).intervalDays).toBe(12);
  });

  it("leaves an interval already shorter than the horizon alone", () => {
    const fresh = item({ reps: 0 });
    expect(scheduleReview(fresh, QUALITY.good, 0, 30).intervalDays).toBe(1);
  });

  it("still respects the six-month ceiling when the horizon is further out", () => {
    const settled = item({ reps: 9, intervalDays: 170, ease: 2.8 });
    expect(scheduleReview(settled, QUALITY.good, 0, 900).intervalDays).toBe(180);
  });

  it("does not touch a failed item's ten-minute return", () => {
    const settled = item({ reps: 5, intervalDays: 40 });
    const failed = scheduleReview(settled, QUALITY.again, 0, 60);
    expect(failed.intervalDays).toBe(0);
    expect(failed.dueAt).toBe(10 * 60_000);
  });

  it("does not touch ease, reps or lapses", () => {
    const settled = item({ reps: 5, intervalDays: 40, ease: 2.5, lapses: 1 });
    const capped = scheduleReview(settled, QUALITY.good, 0, 3);
    const free = scheduleReview(settled, QUALITY.good, 0, null);
    expect(capped.ease).toBe(free.ease);
    expect(capped.reps).toBe(free.reps);
    expect(capped.lapses).toBe(free.lapses);
  });
});

/**
 * The promise, over a whole run-up rather than one call.
 *
 * A reader answers each item whenever it comes due, at whatever quality, from
 * some starting distance out. Every interval the scheduler grants is checked
 * against the exam. The seeded generator is so a failure names one reproducible
 * sequence rather than "it went wrong sometimes".
 */
describe("nothing is ever scheduled past the exam", () => {
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1_664_525 + 1_013_904_223) >>> 0;
      return s / 0x1_0000_0000;
    };
  }

  const exam = "2026-11-04";
  /** Midnight *after* the exam day: due on the day itself is still in time. */
  const examEnds = new Date(2026, 10, 5).getTime();

  it("holds across a thousand random run-ups", () => {
    const failures: string[] = [];

    for (let trial = 0; trial < 1000; trial++) {
      const next = rng(trial + 1);
      const startDaysOut = 1 + Math.floor(next() * 120);
      let now = at(2026, 11, 4) - startDaysOut * DAY;
      let current = item();

      for (let step = 0; step < 60; step++) {
        const horizon = horizonDays(exam, now);
        // Once the date is reached the horizon is deliberately gone, and the
        // scheduler is allowed to look past it again.
        if (horizon === null) break;

        const quality = [QUALITY.again, QUALITY.hard, QUALITY.good, QUALITY.easy][
          Math.floor(next() * 4)
        ];
        current = scheduleReview(current, quality, now, horizon);

        if (current.dueAt > examEnds) {
          failures.push(
            `trial ${trial}: ${startDaysOut}d out, step ${step}, ` +
              `interval ${current.intervalDays}d lands ${Math.round(
                (current.dueAt - examEnds) / DAY
              )}d after the exam`
          );
          break;
        }
        now = current.dueAt;
      }
    }

    expect(failures.slice(0, 5)).toEqual([]);
  });

  it("brings a long-settled item back several times, not once", () => {
    // The reason the rule is half the remaining time rather than all of it: an
    // item landing the day before gets one look and nowhere to recover from a
    // miss.
    let now = at(2026, 11, 4) - 60 * DAY;
    let current = item({ reps: 9, intervalDays: 180, ease: 2.8 });
    const landings: number[] = [];

    for (let step = 0; step < 20; step++) {
      const horizon = horizonDays(exam, now);
      if (horizon === null) break;
      current = scheduleReview(current, QUALITY.good, now, horizon);
      landings.push(current.intervalDays);
      now = current.dueAt;
    }

    expect(landings.length).toBeGreaterThanOrEqual(5);
    expect(landings).toEqual([...landings].sort((a, b) => b - a));
  });
});

describe("deadlineState", () => {
  it("is null with no date", () => {
    expect(deadlineState(null)).toBeNull();
  });

  it("reports a date that has gone", () => {
    const state = deadlineState("2026-11-04", at(2026, 11, 9));
    expect(state).toMatchObject({ daysLeft: -5, passed: true, horizon: null });
  });

  it("does not call the day itself passed", () => {
    expect(deadlineState("2026-11-04", at(2026, 11, 4))?.passed).toBe(false);
  });
});

describe("describeDeadline", () => {
  it.each([
    [at(2026, 11, 4), "today"],
    [at(2026, 11, 3), "tomorrow"],
    [at(2026, 10, 28), "in 7 days"],
    [at(2026, 11, 5), "yesterday"],
    [at(2026, 11, 9), "5 days ago"],
  ])("reads correctly", (now, expected) => {
    expect(describeDeadline(deadlineState("2026-11-04", now)!)).toBe(expected);
  });
});

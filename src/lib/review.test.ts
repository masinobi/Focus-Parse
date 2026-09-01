import { describe, expect, it } from "vitest";

import {
  difficulty,
  newReview,
  QUALITY,
  scheduleReview,
  termKey,
  type ReviewItem,
} from "./review";

/**
 * The scheduler has no corpus to scan.
 *
 * `scan-checks` and `scan-exam` measure everything that depends on real
 * documents, which is most of this project — but SM-2 is arithmetic over four
 * numbers and a document never touches it. A wrong interval is invisible: the
 * queue still works, items still come back, and nobody notices they come back
 * at the wrong time until weeks of study have been mis-spaced. That is exactly
 * the shape of bug a unit test is cheap at and a corpus scan cannot see at all.
 */

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

function seeded(overrides: Partial<ReviewItem> = {}): ReviewItem {
  return {
    ...newReview(
      {
        id: "d:cloze:term",
        docId: "d",
        docTitle: "Doc",
        kind: "cloze",
        prompt: "A ____ carrier.",
        answer: "term",
      },
      NOW
    ),
    ...overrides,
  };
}

describe("scheduleReview", () => {
  it("brings a failed item back inside the sitting, not tomorrow", () => {
    const next = scheduleReview(seeded({ reps: 4, intervalDays: 30 }), QUALITY.again, NOW);

    expect(next.dueAt - NOW).toBe(10 * 60_000);
    expect(next.intervalDays).toBe(0);
    expect(next.reps).toBe(0);
    expect(next.lapses).toBe(1);
  });

  it("walks a new item out 1 day, then 6, then by ease", () => {
    const first = scheduleReview(seeded(), QUALITY.good, NOW);
    expect(first.intervalDays).toBe(1);

    const second = scheduleReview(first, QUALITY.good, NOW);
    expect(second.intervalDays).toBe(6);

    const third = scheduleReview(second, QUALITY.good, NOW);
    // ease is untouched by `good`, so this is 6 * 2.5.
    expect(third.intervalDays).toBe(15);
    expect(third.dueAt).toBe(NOW + 15 * DAY);
  });

  it("floors ease so a repeatedly failed item never becomes a daily leech", () => {
    let item = seeded();
    for (let i = 0; i < 12; i++) item = scheduleReview(item, QUALITY.again, NOW);
    expect(item.ease).toBeGreaterThanOrEqual(1.3);
  });

  it("caps the interval at six months", () => {
    const item = seeded({ reps: 9, intervalDays: 170, ease: 2.8 });
    expect(scheduleReview(item, QUALITY.good, NOW).intervalDays).toBe(180);
  });

  it("leaves ease alone on good and raises it on easy", () => {
    expect(scheduleReview(seeded(), QUALITY.good, NOW).ease).toBe(2.5);
    expect(scheduleReview(seeded(), QUALITY.easy, NOW).ease).toBeCloseTo(2.65);
    expect(scheduleReview(seeded(), QUALITY.hard, NOW).ease).toBeCloseTo(2.35);
  });
});

describe("difficulty", () => {
  it("is zero for an item that has never given trouble", () => {
    expect(difficulty({ lapses: 0, ease: 2.5 })).toBe(0);
  });

  it("reaches 1 at three lapses and never exceeds it", () => {
    expect(difficulty({ lapses: 3, ease: 2.5 })).toBe(1);
    expect(difficulty({ lapses: 9, ease: 1.3 })).toBe(1);
  });

  it("reads a collapsed ease as difficulty even with no lapse recorded", () => {
    // A summary self-graded `hard` repeatedly is never failed outright, but is
    // plainly not settling — the whole reason ease is a second signal.
    expect(difficulty({ lapses: 0, ease: 1.9 })).toBeGreaterThan(0);
    expect(difficulty({ lapses: 0, ease: 1.3 })).toBe(1);
  });
});

describe("termKey", () => {
  it("keys an acronym on its dictionary entry, not its spelling", () => {
    expect(termKey("CRFs", "CRF")).toBe("CRF");
    expect(termKey("CRF", "CRF")).toBe("CRF");
  });

  it("collapses punctuation and case so one term is one key", () => {
    expect(termKey("Protocol")).toBe(termKey("protocol"));
    expect(termKey("e-CRF")).toBe("e-crf");
  });
});

/**
 * The cued flag is not scheduling data — it changes no interval and no ease.
 * It is provenance, and provenance is worth nothing if it does not survive the
 * trip. A summary answered three times over six weeks must still say it was
 * written with the section's nouns on screen, because the self-grade at every
 * one of those sittings is made against the same sentence.
 */
describe("cued provenance", () => {
  it("survives being scheduled", () => {
    const item = seeded({ kind: "summary", cued: true });
    expect(item.cued).toBe(true);
    const next = scheduleReview(item, QUALITY.good, NOW, null);
    expect(next.cued).toBe(true);
  });

  it("survives a lapse and a relearn", () => {
    let item = seeded({ kind: "summary", cued: true });
    for (const q of [QUALITY.again, QUALITY.hard, QUALITY.good, QUALITY.easy]) {
      item = scheduleReview(item, q, NOW, null);
      expect(item.cued).toBe(true);
    }
  });

  it("reads as not cued on everything written before it existed", () => {
    // No item on disk carries this field. `undefined` must mean free recall
    // rather than crash — the same contract as `FlowNode.links`.
    const legacy = seeded({ kind: "summary" });
    expect(legacy.cued).toBeUndefined();
    expect(scheduleReview(legacy, QUALITY.good, NOW, null).cued).toBeUndefined();
  });

  it("changes no interval", () => {
    const free = scheduleReview(seeded({ kind: "summary" }), QUALITY.good, NOW, null);
    const cued = scheduleReview(
      seeded({ kind: "summary", cued: true }),
      QUALITY.good,
      NOW,
      null
    );
    expect({ ease: cued.ease, days: cued.intervalDays, due: cued.dueAt }).toEqual({
      ease: free.ease,
      days: free.intervalDays,
      due: free.dueAt,
    });
  });
});

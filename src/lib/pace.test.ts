import { describe, expect, it } from "vitest";

import {
  BASELINE_WPM,
  loadPace,
  noteWords,
  observedWpm,
  reachOf,
  solveRate,
  type PaceTable,
} from "./pace";

/**
 * The solver has no corpus to scan, and a wrong answer here is silent.
 *
 * Every other check in this project measures something a real document
 * produces. This measures arithmetic over four numbers and a document never
 * touches it — but the failure mode is the worst kind: the reader still reads,
 * the audio still plays, and the only symptom is that the speed on the control
 * is not the speed being read at. Which is precisely the defect this module was
 * written to end, so it must not be reintroduced by a sign error.
 *
 * Rates and words per minute below are the measured shape of the real thing:
 * a voice saturates, so 2.0 is not twice 1.0.
 */

const VOICE = "urn:voice:aria";
const MIN = 1.0;
const MAX = 3.0;

/** A sample the table will actually price — past both floors, not just one. */
function sample(table: PaceTable, rate: number, wpm: number): PaceTable {
  const ms = 60_000;
  return noteWords(table, VOICE, rate, Math.round(wpm), ms);
}

describe("an uncalibrated voice", () => {
  it("solves exactly as the old multiplier did", () => {
    // 260 wpm was rate 1.4 before this existed, and has to stay rate 1.4 —
    // otherwise every reader's speed moves the day they upgrade.
    expect(solveRate({}, VOICE, 260, MIN, MAX).rate).toBe(1.4);
    expect(solveRate({}, VOICE, BASELINE_WPM, MIN, MAX).rate).toBe(1.0);
  });

  it("says so, rather than claiming a measurement", () => {
    expect(solveRate({}, VOICE, 260, MIN, MAX).calibrated).toBe(false);
    expect(reachOf({}, VOICE, MIN, MAX)).toBeNull();
  });

  it("is what a null voice gets, since nothing can be attributed to it", () => {
    const table = sample({}, 1.0, 200);
    expect(solveRate(table, null, 260, MIN, MAX).calibrated).toBe(false);
  });
});

describe("the sample floors", () => {
  it("ignore a stretch too short to price a rate with", () => {
    // Ten words in ten seconds is a real ratio and a worthless one.
    const table = noteWords({}, VOICE, 1.0, 10, 10_000);
    expect(observedWpm(table, VOICE, 1.0)).toBeNull();
    expect(solveRate(table, VOICE, 260, MIN, MAX).calibrated).toBe(false);
  });

  it("ignore a stretch that is long in words but not in time", () => {
    // Both floors, not either: a hundred words in two seconds is a burst
    // between two stalls, not a pace.
    const table = noteWords({}, VOICE, 1.0, 100, 2_000);
    expect(observedWpm(table, VOICE, 1.0)).toBeNull();
  });

  it("accumulate, so a rate becomes usable by being read at", () => {
    let table = noteWords({}, VOICE, 1.0, 30, 6_000);
    expect(observedWpm(table, VOICE, 1.0)).toBeNull();
    table = noteWords(table, VOICE, 1.0, 30, 6_000);
    expect(observedWpm(table, VOICE, 1.0)).toBeCloseTo(300, 0);
  });

  it("keep rates apart, because that is the whole measurement", () => {
    let table = sample({}, 1.0, 180);
    table = sample(table, 2.0, 250);
    expect(observedWpm(table, VOICE, 1.0)).toBeCloseTo(180, 0);
    expect(observedWpm(table, VOICE, 2.0)).toBeCloseTo(250, 0);
  });
});

describe("one observation", () => {
  it("solves proportionally through it", () => {
    const table = sample({}, 1.4, 240);
    // 120 wpm is half of 240, so half the rate.
    expect(solveRate(table, VOICE, 120, MIN, MAX).rate).toBe(1.0);
    expect(solveRate(table, VOICE, 240, MIN, MAX).rate).toBe(1.4);
  });

  it("counts as calibrated — it is this voice's own reading", () => {
    expect(solveRate(sample({}, 1.4, 240), VOICE, 240, MIN, MAX).calibrated).toBe(true);
  });
});

describe("two observations", () => {
  /** The measured shape: rate 2.0 delivers well under twice rate 1.0. */
  const saturating = sample(sample({}, 1.0, 185), 2.0, 260);

  it("returns the rate each was observed at", () => {
    expect(solveRate(saturating, VOICE, 185, MIN, MAX).rate).toBe(1.0);
    expect(solveRate(saturating, VOICE, 260, MIN, MAX).rate).toBe(2.0);
  });

  it("interpolates between them", () => {
    // Halfway in speed is halfway in rate on a line: 222 wpm at rate 1.5.
    expect(solveRate(saturating, VOICE, 222, MIN, MAX).rate).toBe(1.5);
  });

  it("extrapolates past them without pretending rate is proportional", () => {
    // The naive multiplier would ask 335/185 = 1.8. This voice needs 3.0,
    // because it gains only 75 wpm across a whole unit of rate.
    expect(solveRate(saturating, VOICE, 335, MIN, MAX).rate).toBe(3.0);
  });

  it("reports the range it can actually reach", () => {
    expect(reachOf(saturating, VOICE, MIN, MAX)).toEqual({ min: 185, max: 335 });
  });
});

describe("a target the voice cannot reach", () => {
  const saturating = sample(sample({}, 1.0, 185), 2.0, 260);

  it("is reported as clamped, with what will really be delivered", () => {
    const solved = solveRate(saturating, VOICE, 450, MIN, MAX);
    expect(solved.rate).toBe(MAX);
    expect(solved.clamped).toBe(true);
    expect(solved.expectedWpm).toBe(335);
  });

  it("clamps at the slow end too", () => {
    const solved = solveRate(saturating, VOICE, 120, MIN, MAX);
    expect(solved.rate).toBe(MIN);
    expect(solved.clamped).toBe(true);
    expect(solved.expectedWpm).toBe(185);
  });

  /**
   * The assertion above is worth nothing unless this one holds. `clamped`
   * driving a struck-through number in the header means a flag stuck at true
   * would mark every speed as unreachable, and a flag stuck at false would put
   * the app straight back to claiming numbers it does not deliver.
   */
  it("is false for a target the voice does reach", () => {
    expect(solveRate(saturating, VOICE, 260, MIN, MAX).clamped).toBe(false);
    expect(solveRate(saturating, VOICE, 222, MIN, MAX).clamped).toBe(false);
  });

  it("is false for a target that only rounding moves", () => {
    // 258 is not on the control's step and is not reachable exactly. Reporting
    // that as "this voice cannot do it" would fire on almost every target.
    expect(solveRate(saturating, VOICE, 258, MIN, MAX).clamped).toBe(false);
  });
});

describe("readings that cannot be solved from", () => {
  it("falls back to proportional when the samples say speed drops with rate", () => {
    // A voice cannot be measured going backwards, but a contaminated pair can
    // look that way — one sample taken across a network stall. A negative slope
    // would solve to a rate below the floor for every target, so it is refused
    // in favour of the proportional reading of where the samples sit.
    const backwards = sample(sample({}, 1.0, 260), 2.0, 185);
    const solved = solveRate(backwards, VOICE, 260, MIN, MAX);
    expect(solved.rate).toBeGreaterThanOrEqual(MIN);
    expect(solved.rate).toBeLessThanOrEqual(MAX);
    expect(solved.calibrated).toBe(true);
  });

  it("survives several samples landing in one bucket", () => {
    let table = sample({}, 1.4, 240);
    table = sample(table, 1.4, 240);
    const solved = solveRate(table, VOICE, 480, MIN, MAX);
    expect(solved.rate).toBeGreaterThanOrEqual(MIN);
    expect(solved.rate).toBeLessThanOrEqual(MAX);
  });
});

describe("noteWords", () => {
  it("refuses what it cannot attribute", () => {
    expect(noteWords({}, null, 1.0, 100, 60_000)).toEqual({});
    expect(noteWords({}, VOICE, 1.0, 0, 60_000)).toEqual({});
    expect(noteWords({}, VOICE, 1.0, 100, 0)).toEqual({});
  });

  it("does not mutate the table it is given", () => {
    const before: PaceTable = {};
    noteWords(before, VOICE, 1.0, 100, 60_000);
    expect(before).toEqual({});
  });

  it("keeps voices apart", () => {
    let table = sample({}, 1.0, 300);
    table = noteWords(table, "urn:voice:david", 1.0, 150, 60_000);
    expect(observedWpm(table, VOICE, 1.0)).toBeCloseTo(300, 0);
    expect(observedWpm(table, "urn:voice:david", 1.0)).toBeCloseTo(150, 0);
  });
});

describe("loadPace", () => {
  /**
   * Anything at all can be under this key — a hand-edited value, a half-written
   * record, another version of the app. It must read as "uncalibrated" rather
   * than reaching the solver, where a NaN would propagate into the rate handed
   * to the synthesizer.
   */
  const withStorage = (value: string | null): PaceTable => {
    const original = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {
      localStorage: { getItem: () => value },
    };
    try {
      return loadPace();
    } finally {
      (globalThis as { window?: unknown }).window = original;
    }
  };

  it("reads nothing as an empty table", () => {
    expect(withStorage(null)).toEqual({});
  });

  it("rejects malformed JSON", () => {
    expect(withStorage("{not json")).toEqual({});
  });

  it("rejects a shape that is not a table", () => {
    expect(withStorage("[1,2,3]")).toEqual({});
    expect(withStorage('"a string"')).toEqual({});
  });

  it("drops records with unusable numbers but keeps the rest", () => {
    const table = withStorage(
      JSON.stringify({
        [VOICE]: {
          "1.0": { words: 400, ms: 60000 },
          "2.0": { words: "lots", ms: 60000 },
          "2.5": { words: 400, ms: 0 },
        },
      })
    );
    expect(Object.keys(table[VOICE] ?? {})).toEqual(["1.0"]);
  });
});

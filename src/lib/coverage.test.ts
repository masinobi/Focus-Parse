import { describe, expect, it } from "vitest";

import {
  buildCoverage,
  nextStop,
  nextToVerify,
  type CoverageInput,
} from "./coverage";
import { MAX_GRID_ATTEMPTS } from "./quiz";
import type { Block, ClozeResult, ParsedDoc, Section } from "./types";

/**
 * Coverage is a claim about the reader, and getting it wrong is silent.
 *
 * The failure that matters is not a crash. It is a section reported as verified
 * when nothing was ever asked about it — which would put the map straight back
 * to being a progress bar with a tick on it, and would do so while looking like
 * it had been fixed. So the rules are pinned here rather than eyeballed in a
 * sidebar, where "read but unchecked" and "verified" are two shades of the same
 * three-pixel dot.
 *
 * The document below is synthetic on purpose: these are rules about rungs, not
 * about anything a PDF produces, and the corpus scanners already cover
 * everything that does depend on real documents.
 */

interface SectionSpec {
  words: number;
  intercept?: boolean;
  furniture?: boolean;
  /** Table blocks in this section that yielded flattened steps. */
  grids?: number;
  /** Make those grids ones no question can be built from. */
  unanswerableGrid?: boolean;
}

/** Sections laid end to end, 1 token per word, with their grid blocks. */
function makeDoc(specs: SectionSpec[]): ParsedDoc {
  const sections: Section[] = [];
  const blocks: Block[] = [];
  let token = 0;

  specs.forEach((spec, i) => {
    sections.push({
      i,
      title: `Section ${i}`,
      level: 1,
      blockStart: 0,
      blockEnd: 0,
      chunkStart: 0,
      tokenStart: token,
      tokenEnd: token + spec.words,
      wordCount: spec.words,
      intercept: Boolean(spec.intercept),
      ...(spec.furniture ? { furniture: true } : {}),
    });
    for (let g = 0; g < (spec.grids ?? 0); g++) {
      blocks.push({
        i: blocks.length,
        kind: "table",
        section: i,
        chunks: [],
        text: "",
        // Three distinct cells, because `buildGridQuestion` needs an answer and
        // two distractors before it will offer anything — and a grid it cannot
        // build a question from is one the engine never stops for.
        steps: spec.unanswerableGrid
          ? ([{ row: "r", column: "", value: "only" }] as Block["steps"])
          : ([
              { row: "r1", column: "c", value: "v1" },
              { row: "r2", column: "c", value: "v2" },
              { row: "r3", column: "c", value: "v3" },
            ] as Block["steps"]),
      });
    }
    token += spec.words;
  });

  return {
    id: "doc",
    schema: 4,
    title: "Doc",
    source: "",
    blocks,
    chunks: [],
    tokens: [],
    sections,
    wordCount: token,
    createdAt: 0,
  };
}

function input(over: Partial<CoverageInput> = {}): CoverageInput {
  return {
    tokenIndex: 0,
    summaries: {},
    gridsPassed: {},
    clozeChecks: {},
    ...over,
  };
}

function window(from: number, to: number, blanks = 3, recalled = 3): ClozeResult {
  return { from, to, blanks, recalled, at: 0 };
}

/** Windows keyed the way the session stores them: by where they ended. */
function windows(...list: ClozeResult[]): Record<number, ClozeResult> {
  return Object.fromEntries(list.map((w) => [w.to, w]));
}

describe("a section nobody has reached", () => {
  it("is unread, not unchecked", () => {
    const doc = makeDoc([{ words: 100 }, { words: 100 }]);
    const c = buildCoverage(doc, input({ tokenIndex: 0 }));
    expect(c.sections[1].state).toBe("unread");
    expect(c.unread).toBe(2);
  });

  it("is still unread when the caret is part way in", () => {
    const doc = makeDoc([{ words: 100 }]);
    const c = buildCoverage(doc, input({ tokenIndex: 59 }));
    expect(c.sections[0].state).toBe("unread");
    expect(c.sections[0].read).toBeCloseTo(0.6, 5);
  });

  /**
   * `tokenEnd` is exclusive and the caret is clamped to `tokens.length - 1`, so
   * the last section of a document is finished at `tokenEnd - 1` and never
   * reaches `tokenEnd`. Without this the final section of every document stayed
   * "not read yet" for ever — found in the running app, not here, because the
   * obvious test writes `tokenIndex: 100` against `tokenEnd: 100` and passes.
   */
  it("counts the last section of a document as read at its last token", () => {
    const doc = makeDoc([{ words: 100 }, { words: 100 }]);
    const c = buildCoverage(
      doc,
      input({ tokenIndex: 199, clozeChecks: windows(window(100, 200)) })
    );
    expect(c.sections[1].read).toBe(1);
    expect(c.sections[1].state).not.toBe("unread");
  });
});

describe("a section read with nothing asked about it", () => {
  /**
   * The whole point of the feature. Before coverage, this was indistinguishable
   * in the map from a section that had been summarized, and identical to the
   * progress bar's account of it.
   */
  it("is unchecked", () => {
    const doc = makeDoc([{ words: 100 }]);
    const c = buildCoverage(doc, input({ tokenIndex: 100 }));
    expect(c.sections[0].state).toBe("unchecked");
    expect(c.unchecked).toBe(1);
    expect(c.verifiedWords).toBe(0);
  });

  it("counts its words as read but not as verified", () => {
    const doc = makeDoc([{ words: 100 }]);
    const c = buildCoverage(doc, input({ tokenIndex: 100 }));
    expect(c.readWords).toBe(100);
    expect(c.totalWords).toBe(100);
    expect(c.verifiedWords).toBe(0);
  });
});

describe("the rungs", () => {
  it("marks a section verified once every rung that applies is answered", () => {
    const doc = makeDoc([{ words: 100, grids: 1 }, { words: 100, intercept: true }]);
    const c = buildCoverage(
      doc,
      input({
        tokenIndex: 199,
        summaries: { 0: "a sentence" },
        gridsPassed: { 0: true },
        clozeChecks: windows(window(0, 100), window(100, 200)),
      })
    );
    expect(c.sections[0].state).toBe("verified");
    expect(c.sections[0].summary).toBe("done");
    expect(c.verifiedWords).toBe(200);
  });

  it("holds a section at partial while a summary is owed", () => {
    const doc = makeDoc([{ words: 100 }, { words: 100, intercept: true }]);
    const c = buildCoverage(
      doc,
      input({ tokenIndex: 199, clozeChecks: windows(window(0, 200)) })
    );
    expect(c.sections[0].state).toBe("partial");
    expect(c.sections[0].summary).toBe("owed");
  });

  it("holds a section at partial while a table is unanswered", () => {
    const doc = makeDoc([{ words: 100, grids: 2 }]);
    const c = buildCoverage(
      doc,
      input({
        tokenIndex: 100,
        gridsPassed: { 0: true },
        clozeChecks: windows(window(0, 100)),
      })
    );
    expect(c.sections[0].state).toBe("partial");
    expect(c.sections[0].grids).toEqual({ total: 2, passed: 1 });
  });

  /**
   * The rung belongs to the section being *left*. `finishChunk` raises the
   * intercept on crossing into a section that arms one and asks about the one
   * just finished, so a section owes a summary when its successor arms an
   * intercept — not when it does.
   */
  it("owes a summary because the next section arms the intercept", () => {
    const doc = makeDoc([{ words: 100 }, { words: 100, intercept: true }]);
    const c = buildCoverage(
      doc,
      input({ tokenIndex: 199, clozeChecks: windows(window(0, 200)) })
    );
    expect(c.sections[0].summary).toBe("owed");
    expect(c.sections[0].state).toBe("partial");
  });

  /**
   * Invariant 7 in the engine: a check is never armed unless it can be
   * answered. A grid with one cell and no column name yields no question, so
   * the reader is never stopped for it — and a coverage map that counted it
   * would show a debt that cannot be discharged by any amount of reading.
   */
  it("never owes a grid no question can be built from", () => {
    const doc = makeDoc([{ words: 100, grids: 1, unanswerableGrid: true }]);
    const c = buildCoverage(
      doc,
      input({ tokenIndex: 99, clozeChecks: windows(window(0, 100)) })
    );
    expect(c.sections[0].grids).toEqual({ total: 0, passed: 0 });
    expect(c.sections[0].state).toBe("verified");
  });

  /**
   * `finishChunk` stops offering a grid after MAX_GRID_ATTEMPTS, so one failed
   * twice will never be asked again. Same reasoning: the app has given up on
   * it, and the map must not go on billing the reader for it.
   */
  it("stops owing a grid once the attempts are spent", () => {
    const doc = makeDoc([{ words: 100, grids: 1 }]);
    const owed = buildCoverage(
      doc,
      input({ tokenIndex: 99, clozeChecks: windows(window(0, 100)) })
    );
    expect(owed.sections[0].grids.total).toBe(1);
    expect(owed.sections[0].state).toBe("partial");

    const spent = buildCoverage(
      doc,
      input({
        tokenIndex: 99,
        gridAttempts: { 0: MAX_GRID_ATTEMPTS },
        clozeChecks: windows(window(0, 100)),
      })
    );
    expect(spent.sections[0].grids.total).toBe(0);
    expect(spent.sections[0].state).toBe("verified");
  });

  it("still counts a grid that was passed, however many attempts it took", () => {
    const doc = makeDoc([{ words: 100, grids: 1 }]);
    const c = buildCoverage(
      doc,
      input({
        tokenIndex: 99,
        gridsPassed: { 0: true },
        gridAttempts: { 0: MAX_GRID_ATTEMPTS },
        clozeChecks: windows(window(0, 100)),
      })
    );
    expect(c.sections[0].grids).toEqual({ total: 1, passed: 1 });
  });

  it("never owes one when nothing after it arms an intercept", () => {
    const doc = makeDoc([{ words: 100, intercept: true }, { words: 100 }]);
    const c = buildCoverage(
      doc,
      input({ tokenIndex: 199, clozeChecks: windows(window(0, 200)) })
    );
    expect(c.sections[0].summary).toBe("n/a");
    expect(c.sections[1].summary).toBe("n/a");
    expect(c.summaries).toEqual({ owed: 0, given: 0 });
  });

  /**
   * The last section is never crossed out of, so the engine never asks it for
   * anything. Reporting it as owing a summary would put a debt on every
   * document that the reader has no way at all to discharge.
   */
  it("never owes one from the last section of a document", () => {
    const doc = makeDoc([{ words: 100, intercept: true }, { words: 100, intercept: true }]);
    const c = buildCoverage(
      doc,
      input({
        tokenIndex: 199,
        summaries: { 0: "written" },
        clozeChecks: windows(window(0, 200)),
      })
    );
    expect(c.sections[1].summary).toBe("n/a");
    expect(c.sections[1].state).toBe("verified");
  });

  it("looks past furniture to the section playback will actually enter", () => {
    // Playback skips a bibliography rather than reading into it, so the
    // intercept the reader meets belongs to whatever comes after it.
    const doc = makeDoc([
      { words: 100 },
      { words: 300, furniture: true },
      { words: 100, intercept: true },
    ]);
    const c = buildCoverage(
      doc,
      input({ tokenIndex: 499, clozeChecks: windows(window(0, 500)) })
    );
    expect(c.sections[0].summary).toBe("owed");
  });
});

describe("journal furniture", () => {
  /**
   * Marked rather than removed, and playback will not wander in. Counting it as
   * unverified would leave a bibliography permanently on the list of things the
   * reader still has to account for — the fix for one defect creating another.
   */
  it("is owed nothing and counts toward nothing", () => {
    const doc = makeDoc([{ words: 500, furniture: true }, { words: 100 }]);
    const c = buildCoverage(doc, input({ tokenIndex: 0 }));
    expect(c.sections[0].state).toBe("verified");
    expect(c.sections[0].words).toBe(0);
    // Only the real section is in the denominator.
    expect(c.totalWords).toBe(100);
    expect(c.verified).toBe(0);
    expect(c.unread).toBe(1);
  });
});

describe("spot-check windows", () => {
  it("count for every section they overlap", () => {
    // The cadence fires on token count and knows nothing about structure, so a
    // window genuinely covered both sections it straddles.
    const doc = makeDoc([{ words: 100 }, { words: 100 }]);
    const c = buildCoverage(
      doc,
      input({ tokenIndex: 200, clozeChecks: windows(window(50, 150)) })
    );
    expect(c.sections[0].cloze.windows).toBe(1);
    expect(c.sections[1].cloze.windows).toBe(1);
  });

  it("do not count for a section they only touch the edge of", () => {
    const doc = makeDoc([{ words: 100 }, { words: 100 }]);
    const c = buildCoverage(
      doc,
      input({ tokenIndex: 200, clozeChecks: windows(window(0, 100)) })
    );
    expect(c.sections[0].cloze.windows).toBe(1);
    expect(c.sections[1].cloze.windows).toBe(0);
    expect(c.sections[1].state).toBe("unchecked");
  });

  /**
   * The per-section figure is deliberately double-counted; the document total
   * must not inherit it, or the map would report more checks than were sat.
   */
  it("are counted once in the document total", () => {
    const doc = makeDoc([{ words: 100 }, { words: 100 }]);
    const c = buildCoverage(
      doc,
      input({ tokenIndex: 200, clozeChecks: windows(window(50, 150)) })
    );
    expect(c.sections[0].cloze.windows + c.sections[1].cloze.windows).toBe(2);
    expect(c.cloze.windows).toBe(1);
  });

  it("replace rather than accumulate when a stretch is re-read", () => {
    const doc = makeDoc([{ words: 100 }]);
    const store = windows(window(0, 100, 3, 1));
    store[100] = window(0, 100, 3, 3);
    const c = buildCoverage(doc, input({ tokenIndex: 100, clozeChecks: store }));
    expect(c.cloze).toEqual({ windows: 1, blanks: 3, recalled: 3 });
  });
});

describe("recall", () => {
  /**
   * Answering the check is what proves the reader was there; answering it
   * correctly is a different claim. Folding them together would let a section
   * the reader has been held to three times read as unchecked.
   */
  it("is reported apart from whether the section is verified", () => {
    const doc = makeDoc([{ words: 100 }]);
    const c = buildCoverage(
      doc,
      input({ tokenIndex: 100, clozeChecks: windows(window(0, 100, 3, 0)) })
    );
    expect(c.sections[0].state).toBe("verified");
    expect(c.sections[0].recall).toBe(0);
  });

  it("is null where nothing was asked", () => {
    const doc = makeDoc([{ words: 100 }]);
    const c = buildCoverage(doc, input({ tokenIndex: 100 }));
    expect(c.sections[0].recall).toBeNull();
  });
});

describe("nextToVerify", () => {
  it("sends the reader to read-but-unchecked before anything else", () => {
    const doc = makeDoc([
      { words: 100 }, // partial: read and checked, but owes section 1's summary
      { words: 50, intercept: true }, // read, never asked about
      { words: 900 }, // unread
    ]);
    const c = buildCoverage(
      doc,
      input({ tokenIndex: 149, clozeChecks: windows(window(0, 100)) })
    );
    expect(c.sections[0].state).toBe("partial");
    expect(c.sections[1].state).toBe("unchecked");
    expect(nextToVerify(c)?.section).toBe(1);
  });

  it("prefers partly-done over unread", () => {
    // Section 0 is read and spot-checked but still owes the summary section 1's
    // intercept will ask for; section 2 is long and untouched.
    const doc = makeDoc([{ words: 100 }, { words: 50, intercept: true }, { words: 900 }]);
    const c = buildCoverage(
      doc,
      input({ tokenIndex: 99, clozeChecks: windows(window(0, 100)) })
    );
    expect(c.sections[0].state).toBe("partial");
    expect(nextToVerify(c)?.section).toBe(0);
  });

  it("takes the longest inside a band, where the most is unaccounted for", () => {
    const doc = makeDoc([{ words: 100 }, { words: 400 }, { words: 200 }]);
    const c = buildCoverage(doc, input({ tokenIndex: 700 }));
    expect(nextToVerify(c)?.section).toBe(1);
  });

  /**
   * Worth nothing unless it can also return null. A button that always has a
   * destination would send the reader somewhere on a fully verified document.
   */
  it("returns null when everything is verified", () => {
    const doc = makeDoc([{ words: 100 }]);
    const c = buildCoverage(
      doc,
      input({ tokenIndex: 100, clozeChecks: windows(window(0, 100)) })
    );
    expect(c.verified).toBe(1);
    expect(nextToVerify(c)).toBeNull();
  });

  it("returns null for a document that is nothing but furniture", () => {
    const doc = makeDoc([{ words: 500, furniture: true }]);
    expect(nextToVerify(buildCoverage(doc, input()))).toBeNull();
  });
});

describe("a session written before coverage existed", () => {
  /**
   * `SessionState` carries no schema version, so every session already on disk
   * reads back with no `clozeChecks` at all. The account must come out as "read
   * but never asked about" rather than throwing or reporting verified.
   */
  it("reads as unchecked rather than failing", () => {
    const doc = makeDoc([{ words: 100 }, { words: 100, intercept: true }]);
    const c = buildCoverage(
      doc,
      input({ tokenIndex: 199, summaries: { 0: "written last week" } })
    );
    expect(c.sections[0].summary).toBe("done");
    expect(c.sections[0].state).toBe("partial");
    expect(c.cloze).toEqual({ windows: 0, blanks: 0, recalled: 0 });
  });
});

/**
 * The distance to the next stop.
 *
 * Two ways this goes quietly wrong, and both would be believed. Reporting a
 * summary that will never be demanded — because the section it would be owed
 * for is already summarised, or because the boundary is into furniture the
 * engine steps over — sends the reader hunting for a stop that does not come.
 * And reporting only the summary is true and misleading, because the cadence
 * check will interrupt several times inside the same stretch.
 */
describe("nextStop", () => {
  const CADENCE = 250;

  it("counts down to the cadence check from the last one, not from zero", () => {
    const doc = makeDoc([{ words: 1000 }]);
    expect(nextStop(doc, 400, 300, {}, CADENCE).toCheck).toBe(150);
    expect(nextStop(doc, 300, 300, {}, CADENCE).toCheck).toBe(250);
  });

  it("does not go negative once the window is overdue", () => {
    const doc = makeDoc([{ words: 1000 }]);
    expect(nextStop(doc, 700, 300, {}, CADENCE).toCheck).toBe(0);
  });

  it("measures to the boundary that arms the intercept", () => {
    // Second section arms one; the summary is owed for the first.
    const doc = makeDoc([{ words: 100 }, { words: 100, intercept: true }]);
    expect(nextStop(doc, 40, 0, {}, CADENCE).toSummary).toBe(60);
  });

  it("skips a boundary that arms nothing", () => {
    const doc = makeDoc([
      { words: 100 },
      { words: 100 },
      { words: 100, intercept: true },
    ]);
    // Not 60: crossing into section 1 arms no intercept, so the next summary is
    // owed at the start of section 2.
    expect(nextStop(doc, 40, 0, {}, CADENCE).toSummary).toBe(160);
  });

  it("skips a section whose summary is already written", () => {
    const doc = makeDoc([
      { words: 100, intercept: true },
      { words: 100, intercept: true },
      { words: 100, intercept: true },
    ]);
    // Leaving section 0 owes nothing now, so the next stop is leaving 1.
    expect(nextStop(doc, 10, 0, { 0: "written" }, CADENCE).toSummary).toBe(190);
  });

  it("does not promise a summary at a boundary into furniture", () => {
    // The engine steps over furniture, so it never crosses this boundary at
    // all and the intercept it appears to arm is never raised.
    const doc = makeDoc([
      { words: 100 },
      { words: 100, intercept: true, furniture: true },
    ]);
    expect(nextStop(doc, 40, 0, {}, CADENCE).toSummary).toBeNull();
  });

  it("says there is no summary left rather than inventing one", () => {
    const doc = makeDoc([{ words: 100 }, { words: 100 }]);
    const at = nextStop(doc, 150, 100, {}, CADENCE);
    expect(at.toSummary).toBeNull();
    // But the cadence check still comes round, which is the whole reason both
    // numbers are reported.
    expect(at.toCheck).toBe(200);
  });

  it("stops counting the cadence at the end of the document", () => {
    const doc = makeDoc([{ words: 100 }]);
    expect(nextStop(doc, 100, 0, {}, CADENCE).toCheck).toBeNull();
  });
});

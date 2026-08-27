import { describe, expect, it } from "vitest";

import { activeClauseIn, activeTokenIn, blockRanges } from "./flow";
import { parseDocument } from "./parse";
import { SAMPLE_DOCUMENT } from "./sample";

const doc = parseDocument(SAMPLE_DOCUMENT, "sample.md");
const ranges = blockRanges(doc);

describe("the flow's per-block clamp", () => {
  it("has a document with blocks to clamp against", () => {
    expect(doc.blocks.length).toBeGreaterThan(10);
    expect(doc.tokens.length).toBeGreaterThan(200);
  });

  it("reports a block ahead of the caret as untouched", () => {
    const last = ranges[ranges.length - 1];
    expect(activeTokenIn(last, 0)).toBe(-1);
    expect(activeClauseIn(last, 0, 7)).toBe(-1);
  });

  it("reports a block behind the caret as fully read, with no live clause", () => {
    const first = ranges.find((r) => r.start !== -1)!;
    expect(activeTokenIn(first, doc.tokens.length - 1)).toBe(first.end);
    expect(activeClauseIn(first, doc.tokens.length - 1, 7)).toBe(-1);
  });

  it("passes the caret through only to the block holding it", () => {
    const at = Math.floor(doc.tokens.length / 2);
    const holding = ranges.findIndex((r) => r.start !== -1 && at >= r.start && at < r.end);
    expect(holding).toBeGreaterThanOrEqual(0);
    expect(activeTokenIn(ranges[holding], at)).toBe(at);
    expect(activeClauseIn(ranges[holding], at, 7)).toBe(7);
  });

  /**
   * The property the reader pane's element cache is built on, stated
   * independently of it.
   *
   * Advancing one word can only finish the block being left and start the block
   * being entered. If that were not true, reusing the previous render's
   * elements for every other block would show a stale highlight, and the cache
   * would be a correctness bug rather than a speed-up.
   */
  it("changes at most two blocks per word advanced", () => {
    let worst = 0;
    let worstAt = -1;

    let previous = ranges.map((r) => `${activeTokenIn(r, 0)}:${activeClauseIn(r, 0, doc.tokens[0]?.clause ?? -1)}`);

    for (let at = 1; at < doc.tokens.length; at++) {
      const clause = doc.tokens[at]?.clause ?? -1;
      const now = ranges.map((r) => `${activeTokenIn(r, at)}:${activeClauseIn(r, at, clause)}`);
      let changed = 0;
      for (let i = 0; i < now.length; i++) if (now[i] !== previous[i]) changed++;
      if (changed > worst) {
        worst = changed;
        worstAt = at;
      }
      previous = now;
    }

    // Bounded above because the cache depends on it, and below because a clamp
    // that returned a constant would satisfy the upper bound perfectly.
    expect({ worst, moved: worst > 0, at: worstAt >= 0 }).toEqual({
      worst,
      moved: true,
      at: true,
    });
    expect(worst).toBeLessThanOrEqual(2);
    expect(worst).toBeGreaterThanOrEqual(1);
  });

  it("does move, so the bound above is not a bound on nothing", () => {
    // A clamp that returned a constant would satisfy every assertion here.
    const early = ranges.map((r) => activeTokenIn(r, 0)).join(",");
    const late = ranges.map((r) => activeTokenIn(r, doc.tokens.length - 1)).join(",");
    expect(early).not.toBe(late);
  });
});

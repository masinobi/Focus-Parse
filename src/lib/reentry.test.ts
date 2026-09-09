import { describe, expect, it } from "vitest";

import { checkGauge } from "./gauge";
import { parseDocument } from "./parse";
import { PRE_ROLL_SENTENCES, STALE_MS, isAway, preRollTarget } from "./reentry";
import type { ParsedDoc } from "./types";

/**
 * Coming back, and knowing how far the next stop is.
 *
 * Both of these are decided by pure functions on purpose. The idle timer and
 * the row of segments are the parts a probe can see; what counts as away, and
 * which sentence to resume from, are the parts that have to be right when
 * nobody is looking.
 */

const NOW = 1_800_000_000_000;

describe("isAway", () => {
  it("is false while the audio is running, however long since a keypress", () => {
    // The whole guard. A reader following the caret is present by definition,
    // and reading for an hour without touching the keyboard is the app working.
    expect(isAway(NOW, NOW - STALE_MS * 4, true)).toBe(false);
  });

  it("is false for a pause shorter than the threshold", () => {
    expect(isAway(NOW, NOW - (STALE_MS - 1), false)).toBe(false);
  });

  it("is true at the threshold exactly", () => {
    expect(isAway(NOW, NOW - STALE_MS, false)).toBe(true);
  });

  it("stays true as the absence grows", () => {
    expect(isAway(NOW, NOW - STALE_MS * 10, false)).toBe(true);
  });
});

/** Two ordinary sections and a reference list the engine never speaks. */
const WITH_FURNITURE = `# Database Closure

The database is locked once all queries are resolved and the data is clean.
Every discrepancy raised during conduct must be closed before lock.
The sponsor confirms readiness in writing and the lock is applied.
A post-lock change requires a documented and approved unlock procedure.

## References

1. Society for Clinical Data Management. Good Clinical Data Management Practices.
2. International Council for Harmonisation. E6(R2) Good Clinical Practice.
`;

describe("preRollTarget", () => {
  const doc = (): ParsedDoc => parseDocument(WITH_FURNITURE, "fixture.md");

  it("steps back two spoken sentences", () => {
    const d = doc();
    expect(preRollTarget(d, 4)).toBe(2);
  });

  it("honours a different count", () => {
    const d = doc();
    expect(preRollTarget(d, 4, 1)).toBe(3);
    expect(preRollTarget(d, 4, 3)).toBe(1);
  });

  it("stops at the start rather than going negative", () => {
    const d = doc();
    expect(preRollTarget(d, 1)).toBe(0);
    expect(preRollTarget(d, 0)).toBe(0);
  });

  it("returns the current chunk when there is nothing behind it", () => {
    // Which is what makes the caller's "anything to replay?" test a plain
    // inequality rather than a second rule about document starts.
    const d = doc();
    expect(preRollTarget(d, 0)).toBe(0);
  });

  it("counts back over what was spoken, not over what is stored", () => {
    // Playback never enters furniture, so a pre-roll that landed in the
    // reference list would replay something the reader has never heard.
    const d = doc();
    const furniture = d.sections.filter((s) => s.furniture);
    expect(furniture.length).toBeGreaterThan(0);

    const lastChunk = d.chunks.length - 1;
    const target = preRollTarget(d, lastChunk, PRE_ROLL_SENTENCES);
    expect(d.sections[d.chunks[target].section]?.furniture).toBeFalsy();
  });
});

describe("checkGauge", () => {
  const doc = (): ParsedDoc => parseDocument(WITH_FURNITURE, "fixture.md");

  it("counts the sentences of the leg, and none beyond it", () => {
    const d = doc();
    const wide = checkGauge(d, 0, 0, 10_000, 100);
    const narrow = checkGauge(d, 0, 0, 20, 100);
    expect(wide).not.toBeNull();
    expect(narrow).not.toBeNull();
    expect(narrow!.total).toBeLessThan(wide!.total);
  });

  it("counts a sentence done once the caret is past its end", () => {
    const d = doc();
    const first = d.chunks[0];
    expect(checkGauge(d, first.tokenEnd - 1, 0, 10_000, 100)?.done).toBe(0);
    expect(checkGauge(d, first.tokenEnd, 0, 10_000, 100)?.done).toBe(1);
  });

  it("keeps the sentence the leg starts inside", () => {
    // Overlap rather than containment. A check lands mid-sentence, so the leg
    // begins inside a chunk; testing containment drops that chunk and shortens
    // every leg by one. Asserted on `total`, because `done` is zero either way
    // and an earlier version of this test passed against both rules.
    const d = doc();
    const second = d.chunks[1];
    const mid = Math.floor((second.tokenStart + second.tokenEnd) / 2);
    expect(mid).toBeGreaterThan(second.tokenStart);

    const spokenFrom = d.chunks.filter(
      (c) => !d.sections[c.section]?.furniture && c.tokenEnd > mid
    ).length;

    const gauge = checkGauge(d, mid, mid, 10_000, 100);
    expect(gauge).not.toBeNull();
    expect(gauge!.total).toBe(spokenFrom);
    expect(gauge!.done).toBe(0);
  });

  it("leaves furniture out of the count", () => {
    const d = doc();
    const spoken = d.chunks.filter(
      (c) => !d.sections[c.section]?.furniture
    ).length;
    expect(checkGauge(d, 0, 0, 10_000, 500)?.total).toBe(spoken);
  });

  it("is null past the end of the document", () => {
    const d = doc();
    expect(checkGauge(d, d.wordCount, 0, 250, 100)).toBeNull();
  });

  it("is null for a leg holding nothing", () => {
    const d = doc();
    expect(checkGauge(d, 0, -10_000, 1, 100)).toBeNull();
  });

  it("scales a leg longer than the cap, and says so", () => {
    const d = doc();
    const full = checkGauge(d, 0, 0, 10_000, 500);
    expect(full!.total).toBeGreaterThan(4);

    const capped = checkGauge(d, d.chunks[2].tokenEnd, 0, 10_000, 4);
    expect(capped!.total).toBe(4);
    expect(capped!.scaled).toBe(true);
    expect(capped!.done).toBeLessThanOrEqual(4);
  });

  it("does not claim to be scaled when it fits", () => {
    const d = doc();
    expect(checkGauge(d, 0, 0, 10_000, 500)?.scaled).toBe(false);
  });
});

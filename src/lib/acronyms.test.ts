import { describe, expect, it } from "vitest";

import { ACRONYMS, matchAcronym, spokenForm } from "./acronyms";

/**
 * The scan `matchAcronym` used to be, kept verbatim as the reference.
 *
 * Replacing it with a lookup was a performance change, and a performance change
 * that quietly alters what matches is worse than the slow version: the acronym
 * tag feeds the badges, the corpus index, the drill, the cloze weighting and
 * the spoken form. So the old implementation stays here and the new one is
 * asserted to agree with it, token for token, over every shape the corpus
 * produces. Delete the reference and this file can no longer fail for the
 * reason it exists.
 */
const KEYS = Object.keys(ACRONYMS).sort((a, b) => b.length - a.length);

function scanForAcronym(token: string): { key: string; lead: string; trail: string } | null {
  const shell = /^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$/.exec(token);
  if (!shell) return null;

  const [, lead, core, trail] = shell;
  if (!core) return null;

  for (const key of KEYS) {
    if (core === key) return { key, lead, trail };
    if (core === `${key}s` || core === `${key}'s` || core === `${key}\u2019s`) {
      return { key, lead, trail };
    }
  }
  return null;
}

/** Wrappers the shell regex is there to strip. */
const WRAPPERS: Array<[string, string]> = [
  ["", ""],
  ["", "."],
  ["", ","],
  ["", ")"],
  ["(", ")"],
  ["\u201c", "\u201d"],
  ["", "\u2019s"],
  ["\u2014", "\u2014"],
];

/** Suffixes the dictionary is meant to tolerate, and one it is not. */
const SUFFIXES = ["", "s", "'s", "\u2019s", "es", "S", "z"];

function everyShape(): string[] {
  const out: string[] = [];
  for (const key of KEYS) {
    for (const suffix of SUFFIXES) {
      for (const [lead, trail] of WRAPPERS) out.push(`${lead}${key}${suffix}${trail}`);
    }
    // Case is load-bearing, so vary it.
    out.push(key.toLowerCase(), key.toUpperCase(), `${key}${key}`, key.slice(1), `x${key}`);
  }
  // Ordinary words, numbers, punctuation and the empty shapes the shell can hit.
  out.push(
    ...["the", "study", "data", "monitoring", "1996", "21", "-", "", " ", "...", "e.g.", "PI's", "n/a"]
  );
  return out;
}

describe("matchAcronym", () => {
  const shapes = everyShape();

  it("has enough shapes to be worth running", () => {
    // A generated corpus that generates nothing passes silently.
    expect(shapes.length).toBeGreaterThan(2000);
  });

  it("agrees with the scan it replaced on every one of them", () => {
    const disagreements: string[] = [];
    for (const token of shapes) {
      const was = scanForAcronym(token);
      const now = matchAcronym(token);
      const a = was ? `${was.key}|${was.lead}|${was.trail}` : "null";
      const b = now ? `${now.key}|${now.lead}|${now.trail}` : "null";
      if (a !== b) disagreements.push(`${JSON.stringify(token)}: was ${a}, now ${b}`);
    }
    expect(disagreements).toEqual([]);
  });

  it("matches something, so the agreement above is not two nulls", () => {
    const hits = shapes.filter((t) => matchAcronym(t) !== null);
    expect(hits.length).toBeGreaterThan(400);
  });

  it("still refuses a lowercased key", () => {
    expect(matchAcronym("crf")).toBeNull();
    expect(matchAcronym("CRF")).not.toBeNull();
  });

  it("carries the punctuation through to the spoken form", () => {
    expect(spokenForm("(CRFs)")).toBe("(case report forms)");
    expect(spokenForm("CRF.")).toBe("case report form.");
  });
});

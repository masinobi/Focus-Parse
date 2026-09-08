import { describe, expect, it } from "vitest";

import { parseDocument, SCHEMA_VERSION } from "./parse";
import type { GridData } from "./tables";
import type { ParsedDoc } from "./types";

/**
 * What a grid says out loud.
 *
 * Prose expands an acronym for the ear on purpose — hearing "electronic case
 * report form" inside a sentence is what invariant 1 exists for. A grid card is
 * not a sentence: it shows one cell, alone, in the largest type in the app.
 *
 * The argument that settles it is not comfort, it is the check that follows.
 * `buildGridQuestion` draws its answer from the raw cell value, so with the
 * expansion on, the reader studied "case report form" and was then asked to
 * pick `CRF` out of four options. Study channel and test channel disagreed on
 * 33 of the corpus's 262 grid steps.
 *
 * A grid reaches the parser as an `fp-grid` fence carrying JSON — the extractor
 * routes it through markdown so `source` stays a complete record — which is
 * what makes this testable without a PDF.
 */

function gridDoc(grid: GridData, prose = ""): ParsedDoc {
  const fence = ["```fp-grid", JSON.stringify(grid), "```"].join("\n");
  return parseDocument(`# Roles\n\n${fence}\n\n${prose}\n`, "fixture.md");
}

const GRID: GridData = {
  caption: "Responsibilities",
  header: ["Task", "Owner"],
  rows: [
    ["Track receipt of CRF paper data", "CDM"],
    ["Approve the eCRF design", "Sponsor"],
    ["Reconcile SAE listings", "Safety"],
  ],
};

const chunksOf = (doc: ParsedDoc, kind: string) =>
  doc.chunks.filter((c) => doc.blocks[c.block]?.kind === kind);

describe("grid speech", () => {
  it("reaches the parser as a table block with steps", () => {
    // Without this the assertions below pass against a document that has no
    // grid in it at all — which used to be exactly what a plain markdown pipe
    // table produced, before the parser learned to fold one. See `md-tables.ts`.
    const doc = gridDoc(GRID);
    const table = doc.blocks.find((b) => b.kind === "table");
    expect(table).toBeDefined();
    expect(table!.steps?.length).toBeGreaterThan(0);
    expect(chunksOf(doc, "table").length).toBeGreaterThan(0);
  });

  it("says a grid cell exactly as it is shown", () => {
    const doc = gridDoc(GRID);
    for (const chunk of chunksOf(doc, "table")) {
      expect(chunk.speech).toBe(chunk.text);
    }
  });

  it("still tags the acronym, which is a different question", () => {
    // Only the speech stops expanding. The tag feeds the corpus index, the
    // acronym drill and cloze weighting, and dropping it would quietly remove
    // every grid cell from all three.
    const doc = gridDoc(GRID);
    const tagged = doc.tokens
      .filter((t) => doc.blocks[t.block]?.kind === "table")
      .filter((t) => t.acronym);
    expect(tagged.map((t) => t.acronym)).toEqual(
      expect.arrayContaining(["CRF", "CDM", "eCRF", "SAE"])
    );
  });

  it("leaves prose expanding, because that is the point of it", () => {
    const doc = gridDoc(GRID, "The CRF is completed by the site before review.");
    const prose = chunksOf(doc, "p");
    expect(prose.length).toBeGreaterThan(0);
    expect(prose.some((c) => c.speech.length > c.text.length)).toBe(true);
    expect(prose.some((c) => c.speech.includes("case report form"))).toBe(true);
  });

  it("keeps display and speech offsets in step inside a grid", () => {
    // A consequence rather than a goal, but a useful one: with nothing
    // expanding, a token's place in the utterance is its place on screen.
    const doc = gridDoc(GRID);
    for (const chunk of chunksOf(doc, "table")) {
      for (let i = chunk.tokenStart; i < chunk.tokenEnd; i++) {
        const token = doc.tokens[i];
        expect(chunk.speech.slice(token.speechOffset, token.speechOffset + token.text.length)).toBe(
          token.text
        );
      }
    }
  });

  it("was bumped so stored documents rebuild", () => {
    // Token speech offsets and chunk speech strings both change, and both are
    // stored. A document parsed by version 5 would play its grids with the old
    // utterance until it happened to be re-ingested.
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(6);
    expect(gridDoc(GRID).schema).toBe(SCHEMA_VERSION);
  });
});

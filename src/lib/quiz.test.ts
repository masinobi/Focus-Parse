import { describe, expect, it } from "vitest";

import { parseDocument } from "./parse";
import { buildCloze, isStructuralReference, BLANK } from "./quiz";

/**
 * The reading cadence's spot check, built through the real parser.
 *
 * `exam.test.ts` pins `isStructuralReference` as a predicate. What was never
 * pinned is that the *reading* check consults it. The rule lived in `quiz.ts`
 * and only `exam.ts` ever called it, so the check firing every 250 words was
 * free to ask "Section ____ Qualification and Training highlights…" and want
 * "3.4", while a paper built from the same corpus threw the identical blank
 * out. It did so 72 times across the eleven documents.
 *
 * Driven through `parseDocument` rather than a hand-built `ParsedDoc`, because
 * what is under test is a decision about carriers and offsets, and a synthetic
 * document is exactly where those stop being real.
 */

/**
 * Prose that yields candidates.
 *
 * Salience rewards acronyms, numbers and mid-sentence capitals, so filler
 * written as plain sentences produces no blanks at all and every assertion
 * below would pass against a `null` check. This reads like the corpus on
 * purpose.
 */
const FILLER = [
  "The sponsor retains accountability for the integrity of trial data and may",
  "delegate the work to a CRO without delegating the responsibility.",
  "The Data Management Plan records every delegation and is kept current",
  "throughout the study.",
  "Quality control is applied at each stage of data entry so the analysis",
  "database can be reproduced from source records.",
  "An EDC system keeps an audit trail and every CRF change is attributable to a",
  "named user.",
  "Training is documented for each person before access to the eCRF is granted",
  "by role.",
].join(" ");

function docOf(body: string) {
  return parseDocument(`# Study conduct\n\n${body}\n`, "fixture.md");
}

describe("buildCloze", () => {
  it("builds a check from ordinary prose", () => {
    const doc = docOf(FILLER);
    const cloze = buildCloze(doc, 0, doc.tokens.length, 12);
    expect(cloze).not.toBeNull();
    expect(cloze!.blanks.length).toBeGreaterThan(1);
    for (const blank of cloze!.blanks) {
      expect(blank.carrier).toContain(BLANK);
      // Never readable off its own carrier.
      expect(blank.carrier).not.toContain(blank.answer);
    }
  });

  it("never asks where something is instead of what it says", () => {
    // With the filter removed this check blanks "3.4" out of "Section ____
    // Qualification and Training highlights…" — verified by removing it.
    const doc = docOf(
      "Section 3.4 Qualification and Training highlights the need for documented " +
        `evidence that each person is trained before access is granted. ${FILLER}`
    );
    const cloze = buildCloze(doc, 0, doc.tokens.length, 12);
    expect(cloze).not.toBeNull();
    expect(cloze!.blanks.map((b) => b.answer)).not.toContain("3.4");
    for (const blank of cloze!.blanks) {
      expect(isStructuralReference(blank.carrier, blank.answer)).toBe(false);
    }
  });

  it("falls through to another occurrence rather than losing the term", () => {
    // The same number is a reference in one sentence and a fact in the next.
    // Dropping the candidate outright would throw away a good blank — which is
    // why the skip is inside the occurrence loop and not around it.
    const doc = docOf(
      "Section 15 of the guideline sets the retention rule. Records are retained " +
        `for 15 years after the trial closes. ${FILLER}`
    );
    const cloze = buildCloze(doc, 0, doc.tokens.length, 12);
    expect(cloze).not.toBeNull();

    const fifteen = cloze!.blanks.find((b) => b.answer === "15");
    expect(fifteen).toBeDefined();
    expect(fifteen!.carrier).toMatch(/retained for/);
    expect(isStructuralReference(fifteen!.carrier, fifteen!.answer)).toBe(false);
  });

  it("returns null rather than a check it cannot make honest", () => {
    expect(buildCloze(docOf("Too short."), 0, 4)).toBeNull();
  });

  it("puts its blanks in reading order", () => {
    const doc = docOf(FILLER);
    const cloze = buildCloze(doc, 0, doc.tokens.length, 12);
    const indexes = cloze!.blanks.map((b) => b.tokenIndex);
    expect([...indexes].sort((a, b) => a - b)).toEqual(indexes);
  });

  it("never cuts two blanks from one sentence", () => {
    const doc = docOf(FILLER);
    const cloze = buildCloze(doc, 0, doc.tokens.length, 12);
    const chunks = cloze!.blanks.map((b) => doc.tokens[b.tokenIndex].chunk);
    expect(new Set(chunks).size).toBe(chunks.length);
  });
});

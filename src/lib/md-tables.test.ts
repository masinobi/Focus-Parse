import { describe, expect, it } from "vitest";

import { foldPipeTables } from "./md-tables";
import { parseDocument } from "./parse";
import type { ParsedDoc } from "./types";

/**
 * Markdown pipe tables.
 *
 * Mostly asserted end to end through `parseDocument`, because the thing that
 * was broken was not a helper — it was that a table reached the reader as
 * paragraphs of pipes and could never raise a grid check. A unit test of the
 * folder alone would have passed on the day the defect existed.
 */

const doc = (source: string): ParsedDoc => parseDocument(source, "fixture.md");

const tableBlocks = (d: ParsedDoc) => d.blocks.filter((b) => b.kind === "table");
const stepsOf = (d: ParsedDoc) => tableBlocks(d).flatMap((b) => b.steps ?? []);
const textOf = (d: ParsedDoc) =>
  d.chunks.map((c) => c.text).join(" ").replace(/\s+/g, " ");

/** The shape the reader's own notes are written in. */
const DISCRIMINATOR = `# Week 1

| Term | What it actually means |
|---|---|
| **Attributable** | Who recorded the data |
| **Contemporaneous** | Recorded at the time of the activity |
| **Original** | First capture, not a copy |
`;

describe("pipe tables reach the parser as grids", () => {
  it("becomes a table block with one step per cell", () => {
    const d = doc(DISCRIMINATOR);
    expect(tableBlocks(d)).toHaveLength(1);
    expect(stepsOf(d)).toHaveLength(3);
  });

  it("names the row, the column and the value", () => {
    const [first] = stepsOf(doc(DISCRIMINATOR));
    expect(first).toEqual({
      row: "Attributable",
      column: "What it actually means",
      value: "Who recorded the data",
    });
  });

  it("strips the markdown the cells are written with", () => {
    // Every term in the reader's first column is bold. Left in, the asterisks
    // are both displayed and spoken.
    const d = doc(DISCRIMINATOR);
    expect(textOf(d)).not.toContain("*");
    expect(stepsOf(d).map((s) => s.row)).toEqual([
      "Attributable",
      "Contemporaneous",
      "Original",
    ]);
  });

  it("carries three columns as two steps a row", () => {
    const d = doc(`# Entry

| Method | What happens | The variable |
|---|---|---|
| Third-person adjudication | Two people enter | A dedicated third party |
`);
    expect(stepsOf(d).map((s) => s.column)).toEqual([
      "What happens",
      "The variable",
    ]);
  });

  it("reads the same with or without outer pipes", () => {
    const bare = doc(`# T

Term | Meaning
--- | ---
Audit | By the sponsor
`);
    const piped = doc(`# T

| Term | Meaning |
| --- | --- |
| Audit | By the sponsor |
`);
    expect(stepsOf(bare)).toEqual(stepsOf(piped));
    expect(stepsOf(bare)).toHaveLength(1);
  });

  it("keeps an escaped pipe as a character in the cell", () => {
    const d = doc(`# T

| Operator | Meaning |
|---|---|
| a \\| b | either one |
`);
    expect(stepsOf(d)[0]).toEqual({
      row: "a | b",
      column: "Meaning",
      value: "either one",
    });
  });

  it("snaps a ragged row to the header's width", () => {
    // A short row keeps its shape rather than shifting left, and a long one is
    // truncated rather than inventing a column with no name to report it under.
    const d = doc(`# T

| A | B | C |
|---|---|---|
| one | two |
| three | four | five | six |
`);
    expect(stepsOf(d)).toEqual([
      { row: "one", column: "B", value: "two" },
      { row: "three", column: "B", value: "four" },
      { row: "three", column: "C", value: "five" },
    ]);
  });
});

describe("what is not a table", () => {
  it("leaves pipe-carrying prose alone when no delimiter row makes it a table", () => {
    // Three consecutive lines on purpose. Without the delimiter rule the first
    // is read as a header and the *second* is consumed as the delimiter, so a
    // two-line fixture is refused for having no body rows — and passes whether
    // the rule is enforced or not.
    const d = doc(`# T

The pipe | character separates alternatives in a regular expression.
A missing delimiter | is what makes this prose and not a table.
Three lines | is the fewest that can tell the difference.
`);
    expect(tableBlocks(d)).toHaveLength(0);
    expect(textOf(d)).toContain("pipe | character");
    expect(textOf(d)).toContain("Three lines | is the fewest");
  });

  it("leaves a single-column table alone", () => {
    // Caught by the flatten guard rather than by a width rule: a one-column
    // grid has no column to report a value under, so it yields no steps.
    const d = doc(`# T

| Term |
|---|
| Attributable |
`);
    expect(tableBlocks(d)).toHaveLength(0);
    expect(textOf(d)).toContain("Attributable");
  });

  it("keeps a header with no rows as the text it was", () => {
    // The failure that would be silent. A table folded to zero steps emits a
    // fence the line loop discards, and the reader's text disappears from the
    // document with nothing to show it ever existed.
    const d = doc(`# T

| Term | Meaning |
|---|---|

Prose after.
`);
    expect(tableBlocks(d)).toHaveLength(0);
    expect(textOf(d)).toContain("Term");
    expect(textOf(d)).toContain("Meaning");
  });

  it("keeps a table whose rows have no label as the text it was", () => {
    // Rows exist, so the header/no-body guard does not fire, but every row's
    // first cell is empty and `flattenGrid` yields nothing from it. Folded, the
    // fence would carry a grid the line loop drops on the floor.
    const d = doc(`# T

| Term | Meaning |
|---|---|
|  | orphaned value |
|  | another |
`);
    expect(tableBlocks(d)).toHaveLength(0);
    expect(textOf(d)).toContain("orphaned value");
  });

  it("never drops a row's text, whatever it decides", () => {
    for (const source of [
      DISCRIMINATOR,
      `# T\n\n| A |\n|---|\n| lonely |\n`,
      `# T\n\n| A | B |\n|---|---|\n`,
    ]) {
      const said = textOf(doc(source));
      for (const word of ["Attributable", "lonely", "Meaning", "A", "B"]) {
        if (!source.includes(word)) continue;
        expect(said).toContain(word);
      }
    }
  });
});

describe("fenced blocks are not touched", () => {
  it("leaves a pipe table inside a code fence as code", () => {
    const d = doc(`# T

\`\`\`
| Term | Meaning |
|---|---|
| Audit | By the sponsor |
\`\`\`
`);
    expect(tableBlocks(d)).toHaveLength(0);
    expect(d.blocks.filter((b) => b.kind === "code")).toHaveLength(1);
  });

  it("still folds a table that follows a fenced block", () => {
    // The assertion that makes the fence guard testable in both directions. A
    // guard that opens on ``` and never closes would swallow the rest of the
    // document, and every table after the first code block would go unfolded —
    // which the "inside a fence" test alone cannot see.
    const grid = { caption: null, header: ["Task", "Owner"], rows: [["Lock", "CDM"]] };
    const d = doc(`# T

\`\`\`fp-grid
${JSON.stringify(grid)}
\`\`\`

| Term | Meaning |
|---|---|
| Audit | By the sponsor |
`);
    const blocks = tableBlocks(d);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].grid?.header).toEqual(["Task", "Owner"]);
    expect(blocks[1].grid?.header).toEqual(["Term", "Meaning"]);
  });

  it("leaves an already-folded fence alone", () => {
    const lines = ["```fp-grid", '{"caption":null,"header":[],"rows":[]}', "```"];
    expect(foldPipeTables(lines, (s) => s, "fp-grid")).toEqual(lines);
  });
});

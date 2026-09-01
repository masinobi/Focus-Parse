import { describe, expect, it } from "vitest";

import { contentWordCount, firstContentToken, parseDocument } from "./parse";

/**
 * A book's front matter, and the convention that ends it.
 *
 * The full GCDMP opens with its own title broken across two centred lines and
 * recovered as two chapters — "Good Clinical Data", "Management Practices" —
 * then an edition line, the society's name, and the whole cover again on the
 * next page. Six headings, none of them a chapter, at the top of a 755-row map,
 * counted as content, and the first thing playback read aloud.
 *
 * Nothing in that text says "cover". Its position does: a book puts its table
 * of contents after the cover, the title page and the copyright, and before the
 * text.
 */
const COVER = `# Good Clinical Data

# Management Practices

# October 2013 Edition

Recipient of an award for raising standards, granted in an earlier year.

# Society for Clinical Data Management

# Good Clinical Data

# Management Practices

# Published October 2013

This document reflects the current views of the membership and supersedes no
regulation. It should not be considered an exhaustive list of topics.

# Revision History

The first edition appeared in 2000 and the sixth in 2013.

# Contents

Data Privacy. Data Management Plan. Metrics for Data Quality.

# Executive Summary

Data management is the collection, integration and availability of the data
that a clinical trial is judged on, at the quality the judgement needs.

# Data Privacy

Personal data of study participants must be protected throughout the trial.
`;

const titles = (source: string) =>
  parseDocument(source, "fixture.md").sections.map((s) => ({
    title: s.title.trim(),
    furniture: Boolean(s.furniture),
  }));

describe("the front of a book", () => {
  const doc = parseDocument(COVER, "fixture.md");

  it("recovers the cover as separate headings in the first place", () => {
    // The defect this rule answers. If heading recovery ever stopped producing
    // them, the rule would be guarding nothing and this file would still pass.
    expect(doc.sections.slice(0, 2).map((s) => s.title.trim())).toEqual([
      "Good Clinical Data",
      "Management Practices",
    ]);
  });

  it("marks everything up to and including the contents", () => {
    const marked = titles(COVER)
      .filter((s) => s.furniture)
      .map((s) => s.title);
    expect(marked).toEqual([
      "Good Clinical Data",
      "Management Practices",
      "October 2013 Edition",
      "Society for Clinical Data Management",
      "Good Clinical Data",
      "Management Practices",
      "Published October 2013",
      "Revision History",
      "Contents",
    ]);
  });

  it("leaves the text that follows alone", () => {
    const after = titles(COVER).filter((s) => !s.furniture).map((s) => s.title);
    expect(after).toEqual(["Executive Summary", "Data Privacy"]);
  });

  it("starts playback past it rather than on the cover", () => {
    const start = firstContentToken(doc);
    const section = doc.sections.find((s) => s.tokenStart <= start && s.tokenEnd > start);
    expect(section?.title.trim()).toBe("Executive Summary");
  });

  it("stops counting it as something the reader owes an account of", () => {
    expect(contentWordCount(doc)).toBeLessThan(doc.wordCount);
    // And still counts the text: a rule that marked everything would satisfy
    // the line above perfectly.
    expect(contentWordCount(doc)).toBeGreaterThan(30);
  });
});

describe("what the rule refuses", () => {
  it("ignores a heading that merely begins with the word", () => {
    // A real shape in this subject matter, and everything above one of these is
    // the chapter, not the front of a book.
    const source = COVER.replace(
      "# Contents\n",
      "# Contents of the Data Management Plan\n"
    );
    // Asserted on the cover rather than on the whole document: "Revision
    // History" is furniture on its own account whatever this rule does, and
    // `some()` would have gone on being true for that reason alone.
    expect(titles(source).filter((s) => s.title === "Good Clinical Data")).toEqual([
      { title: "Good Clinical Data", furniture: false },
      { title: "Good Clinical Data", furniture: false },
    ]);
  });

  it("ignores a contents list too deep to be the front of a book", () => {
    const filler = Array.from(
      { length: 14 },
      (_, i) => `# Chapter ${i + 1}\n\nSome guidance about clinical data management practice.\n`
    ).join("\n");
    const source = `${filler}\n# Contents\n\nA list of chapters.\n`;
    expect(titles(source).filter((s) => s.furniture)).toEqual([]);
  });

  it("leaves a document with no contents list entirely alone", () => {
    // The control. Without it, a rule that marked every section would pass
    // every assertion above.
    const source = `# Data Privacy\n\nPersonal data must be protected.\n\n# Database Lock\n\nNo value changes after lock without authorization.\n`;
    expect(titles(source).map((s) => s.furniture)).toEqual([false, false]);
  });
});

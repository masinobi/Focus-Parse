import { describe, expect, it } from "vitest";

import {
  chapterTitles,
  qualifiedTitle,
  searchOutline,
  type OutlineRow,
} from "./section-search";

/**
 * The shape the full GCDMP actually has: chapters at level 1, and the same five
 * headings repeated inside every one of them. Two chapters is enough to make
 * every repeat ambiguous, which is the condition the filter exists for.
 */
const GCDMP: OutlineRow[] = [
  { title: "Data Privacy", level: 1 },
  { title: "Introduction", level: 2 },
  { title: "Scope", level: 2 },
  { title: "Minimum Standards", level: 2 },
  { title: "Legislation and Regulatory Guidance", level: 2 },
  { title: "Data Management Plan", level: 1 },
  { title: "Introduction", level: 2 },
  { title: "Scope", level: 2 },
  { title: "Minimum Standards", level: 2 },
  { title: "Case Report Forms", level: 2 },
];

/** A document that opens with a title above its chapters, as three PDFs do. */
const TITLED: OutlineRow[] = [
  { title: "Vendor Selection & Management", level: 0 },
  { title: "Assessing Need", level: 1 },
  { title: "Request for Proposal", level: 2 },
  { title: "Contracting", level: 1 },
];

describe("chapterTitles", () => {
  it("puts each heading under the chapter above it", () => {
    expect(chapterTitles(GCDMP)).toEqual([
      null,
      "Data Privacy",
      "Data Privacy",
      "Data Privacy",
      "Data Privacy",
      null,
      "Data Management Plan",
      "Data Management Plan",
      "Data Management Plan",
      "Data Management Plan",
    ]);
  });

  it("does not treat a document title as a chapter's chapter", () => {
    // Level 0 outranks level 1, so the chapters answer to the title — and the
    // title answers to nothing.
    expect(chapterTitles(TITLED)).toEqual([
      null,
      "Vendor Selection & Management",
      "Assessing Need",
      "Vendor Selection & Management",
    ]);
  });

  it("closes a chapter when the next one at its level opens", () => {
    // The bug this guards: a stack that only ever grows would file "Contracting"
    // under "Request for Proposal".
    const titles = chapterTitles(TITLED);
    expect(titles[3]).not.toBe("Request for Proposal");
  });
});

describe("searchOutline", () => {
  it("returns null for an empty query rather than everything", () => {
    // Not the same claim. `null` leaves the map alone; an array of every index
    // would be a filter that is on and matching everything, and the panel would
    // say "10 of 10 sections" to a reader who never asked for a filter.
    expect(searchOutline(GCDMP, "")).toBeNull();
    expect(searchOutline(GCDMP, "   ")).toBeNull();
  });

  it("returns an empty array when nothing matches", () => {
    expect(searchOutline(GCDMP, "pharmacovigilance")).toEqual([]);
  });

  it("finds a repeated heading in every chapter that has one", () => {
    expect(searchOutline(GCDMP, "minimum standards")).toEqual([3, 8]);
  });

  it("opens a whole chapter when the chapter is what matched", () => {
    // The chapter row and all four of its headings, and nothing from the other.
    expect(searchOutline(GCDMP, "privacy")).toEqual([0, 1, 2, 3, 4]);
  });

  it("ignores case and collapses the spacing PDF headings arrive with", () => {
    expect(searchOutline(GCDMP, "  CASE   report  ")).toEqual([9]);
  });

  it("matches a heading and its chapter without listing it twice", () => {
    // "Data" is in the chapter title and in one of its own headings.
    const hits = searchOutline([
      { title: "Data Privacy", level: 1 },
      { title: "Data Collection", level: 2 },
    ], "data");
    expect(hits).toEqual([0, 1]);
  });

  it("is a substring match, not a fuzzy one", () => {
    // One word apart from a real heading, and it must not come back — the same
    // refusal the blueprint matcher makes.
    expect(searchOutline(GCDMP, "maximum standards")).toEqual([]);
    expect(searchOutline(GCDMP, "standrads")).toEqual([]);
  });

  it("still finds a heading whose chapter does not match", () => {
    // The half of the rule that is easy to lose: without the own-title test,
    // "case report" would return nothing at all.
    expect(searchOutline(GCDMP, "case report")).toEqual([9]);
  });
});

describe("qualifiedTitle", () => {
  const GCDMP: OutlineRow[] = [
    { title: "Database Closure", level: 1 },
    { title: "Scope", level: 2 },
    { title: "Minimum Standards", level: 2 },
    { title: "Best Practices", level: 2 },
    { title: "Data Privacy", level: 1 },
    { title: "Scope", level: 2 },
    { title: "Best Practices", level: 2 },
  ];

  it("tells two sections with the same title apart", () => {
    // The reader's report: 19 sections called "Best Practices" in one document,
    // and the intercept, the grader and the review queue all name it by that
    // alone.
    expect(qualifiedTitle(GCDMP, 3)).toBe("Database Closure — Best Practices");
    expect(qualifiedTitle(GCDMP, 6)).toBe("Data Privacy — Best Practices");
    expect(qualifiedTitle(GCDMP, 3)).not.toBe(qualifiedTitle(GCDMP, 6));
  });

  it("leaves a top-level chapter as its own name", () => {
    expect(qualifiedTitle(GCDMP, 0)).toBe("Database Closure");
  });

  it("does not repeat a chapter that would only say itself again", () => {
    const rows: OutlineRow[] = [
      { title: "Audit Trail", level: 1 },
      { title: "audit  trail", level: 2 },
    ];
    expect(qualifiedTitle(rows, 1)).toBe("audit  trail");
  });

  it("survives an index that is not there", () => {
    expect(qualifiedTitle(GCDMP, 99)).toBe("");
  });

  it("names every intercept in a repeating outline distinctly", () => {
    const names = GCDMP.map((_, i) => qualifiedTitle(GCDMP, i));
    // Two "Scope" and two "Best Practices" in the bare titles; none after.
    expect(new Set(GCDMP.map((r) => r.title)).size).toBe(5);
    expect(new Set(names).size).toBe(7);
  });
});

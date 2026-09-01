import { describe, expect, it } from "vitest";

import { comparePhrase, finalForms, findPhrase, phraseWords, SITES_PER_DOC } from "./compare";
import { parseDocument } from "./parse";

/**
 * The comparison is only worth anything on the phrases the corpus actually
 * uses, and those are lowercase prose. Every fixture here is written the way
 * the guidelines write it — no capitalized headline terms — because that is the
 * case the entity index could not serve and this module exists for.
 */

const PART_11 = `# Contents

Electronic records. Audit trails.

# Subpart B

Persons who use closed systems shall employ secure, computer-generated,
time-stamped audit trails. The audit trail shall record the operator entry
and the date. Audit trail documentation shall be retained for a period.

# Subpart C

An electronic signature shall be linked to its respective electronic record.

# References

Anderson, K. Audit trail integrity in regulated systems. Journal, 2004.
`;

const GCDMP = `# Contents

Data quality.

# Database Closure

The audit trail should be reviewed before the database is locked.

# Metrics

Quality is measured against a plan.
`;

const NEITHER = `# Contents

Nothing here.

# Vendor Selection

Oversight of the vendor is retained by the sponsor, and the sponsor may not
delegate it.
`;

const part11 = parseDocument(PART_11, "21 CFR Part 11.pdf");
const gcdmp = parseDocument(GCDMP, "GCDMP.pdf");
const neither = parseDocument(NEITHER, "Vendor Selection.pdf");

describe("phraseWords", () => {
  it("drops the punctuation a reader pastes in with the phrase", () => {
    expect(phraseWords("  (Audit  Trail), ")).toEqual(["audit", "trail"]);
  });

  it("has no words for a query that is only punctuation", () => {
    expect(phraseWords("  —  ")).toEqual([]);
  });
});

describe("finalForms", () => {
  it("lists the plural of a singular", () => {
    expect([...finalForms("trail")].sort()).toEqual(["trail", "trailes", "trails"]);
  });

  it("lists the singular of a plural, so typing either works", () => {
    expect(finalForms("trails").has("trail")).toBe(true);
  });

  it("refuses to strip a stem that is not a word", () => {
    // "process" -> "proces" is the reason the ss case is excluded by name.
    expect(finalForms("process").has("proces")).toBe(false);
    expect(finalForms("was").has("wa")).toBe(false);
  });
});

describe("findPhrase", () => {
  it("finds a lowercase phrase the entity index does not carry", () => {
    // The whole premise: "audit trail" is not a capitalized noun phrase, so it
    // is absent from the entity index in all ten corpus documents that use it.
    const hit = findPhrase(part11, "audit trail");
    expect(hit?.count).toBeGreaterThan(0);
    expect(hit?.sites[0].text).toContain("audit trail");
  });

  it("matches through the punctuation stuck to a token", () => {
    // "trails." ends the first sentence of Subpart B.
    const hit = findPhrase(part11, "audit trail");
    expect(hit!.sites.some((s) => s.text.trim().endsWith("."))).toBe(true);
  });

  it("accepts the plural for a singular query and the reverse", () => {
    const singular = findPhrase(part11, "audit trail");
    const plural = findPhrase(part11, "audit trails");
    expect(singular!.count).toBe(plural!.count);
    expect(singular!.count).toBeGreaterThan(1);
  });

  it("inflects only the final word", () => {
    const doc = parseDocument(
      "# Contents\n\nx\n\n# B\n\nThe audit trail procedure is fixed.\n",
      "f.md"
    );
    expect(findPhrase(doc, "audit trail procedure")!.count).toBe(1);
    // Middle-word inflection would make a different phrase match, which is how
    // a name stops meaning anything.
    expect(findPhrase(doc, "audit trails procedure")!.count).toBe(0);
  });

  it("refuses a paraphrase", () => {
    // Every word of "sponsor oversight" is in the text, in the other order,
    // with words between them. Invariant 26: exactly, or listed, or not at all.
    expect(findPhrase(neither, "sponsor oversight")!.count).toBe(0);
    expect(findPhrase(neither, "sponsor")!.count).toBe(2);
  });

  it("will not match across a sentence boundary", () => {
    const doc = parseDocument(
      "# Contents\n\nx\n\n# B\n\nReview the audit. Trail documents are kept.\n",
      "f.md"
    );
    expect(findPhrase(doc, "audit trail")!.count).toBe(0);
  });

  it("skips furniture", () => {
    // PART_11 says "Audit trails" in its contents list and again in a reference
    // title. Neither is the regulation's account of audit trails.
    const hit = findPhrase(part11, "audit trail");
    expect(hit!.sites.every((s) => !/contents|references/i.test(s.sectionTitle))).toBe(
      true
    );
    expect(hit!.sites.every((s) => !s.text.includes("Anderson"))).toBe(true);
  });

  it("skips code blocks", () => {
    const doc = parseDocument(
      "# Contents\n\nx\n\n# B\n\n```sql\n-- audit trail check\nSELECT 1;\n```\n",
      "f.md"
    );
    expect(findPhrase(doc, "audit trail")!.count).toBe(0);
  });

  it("tells a section named after the phrase apart from a mention of it", () => {
    // Found in the browser: a heading whose whole text is the phrase was
    // quoted as prose, rendering a box that repeated the section label above
    // it. It is a stronger fact than a mention, not an empty one.
    const doc = parseDocument(
      "# Contents\n\nx\n\n# Audit Trail\n\nThe audit trail records who changed what.\n",
      "f.md"
    );
    const hit = findPhrase(doc, "audit trail")!;
    expect(hit.count).toBe(2);
    expect(hit.sites.map((s) => s.heading)).toEqual([true, false]);
    expect(hit.sites[0].text).toBe("Audit Trail");
  });

  it("marks the phrase inside the carrier sentence", () => {
    const site = findPhrase(part11, "audit trail")!.sites[0];
    expect(site.text.slice(site.from, site.to).toLowerCase()).toMatch(
      /^audit trails?$/
    );
  });

  it("counts every occurrence but keeps only a few", () => {
    const body = Array.from({ length: SITES_PER_DOC + 4 }, (_, i) =>
      `The audit trail is checked in step ${i}.`
    ).join(" ");
    const doc = parseDocument(`# Contents\n\nx\n\n# B\n\n${body}\n`, "f.md");
    const hit = findPhrase(doc, "audit trail")!;
    expect(hit.count).toBe(SITES_PER_DOC + 4);
    expect(hit.sites).toHaveLength(SITES_PER_DOC);
  });

  it("does not count a repeated word as overlapping matches", () => {
    const doc = parseDocument(
      "# Contents\n\nx\n\n# B\n\nThe data data data set is here.\n",
      "f.md"
    );
    // Three "data" in a row contain two overlapping "data data". Reporting two
    // would be a fact about the scan, not about the document.
    expect(findPhrase(doc, "data data")!.count).toBe(1);
  });

  it("separates asking nothing from asking and being told no", () => {
    expect(findPhrase(part11, "   ")).toBeNull();
    expect(findPhrase(part11, "quality tolerance limit")!.count).toBe(0);
  });
});

describe("comparePhrase", () => {
  it("drops the documents that never say it", () => {
    const rows = comparePhrase([part11, gcdmp, neither], "audit trail")!;
    expect(rows.map((r) => r.docTitle)).not.toContain(neither.title);
    expect(rows).toHaveLength(2);
  });

  it("leads with the document that has most to say", () => {
    const rows = comparePhrase([gcdmp, part11], "audit trail")!;
    expect(rows[0].docId).toBe(part11.id);
    expect(rows[0].count).toBeGreaterThan(rows[1].count);
  });

  it("is null for an empty query, not an empty corpus answer", () => {
    expect(comparePhrase([part11, gcdmp], "")).toBeNull();
    expect(comparePhrase([part11, gcdmp], "quality tolerance limit")).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";

import { parseDocument } from "./parse";
import {
  EXCLUDED_TIERS,
  TIER_TITLES,
  isExcludedTier,
  mentionsTier,
  normalizeTierTitle,
  tierOf,
} from "./tiers";

/**
 * Reading the tier off the heading.
 *
 * The near misses are the reason these are assertions and not a substring test.
 * All four of them are real titles in the corpus, and a rule that tagged any of
 * them would put "minimum standard" on a table of contents.
 */

describe("tierOf", () => {
  it("reads the four spellings the corpus actually uses", () => {
    expect(tierOf("Minimum Standards")).toBe("minimum");
    expect(tierOf("4) Minimum Standards")).toBe("minimum");
    expect(tierOf("Best Practices")).toBe("best");
    expect(tierOf("5) Best Practices")).toBe("best");
  });

  it("refuses a heading that names both tiers", () => {
    // The study guide's own contents entry for its section 2. Tagging it either
    // way is wrong, and tagging it at all puts a tier badge on a contents page.
    const both = "2 GCDMP Chapters – Minimum Standards and Best Practices";
    expect(tierOf(both)).toBeNull();
    expect(isExcludedTier(both)).toBe(true);
  });

  it("refuses prose that merely contains the words", () => {
    for (const title of [
      "Other Best Practice Considerations",
      "Recommended Standard Operating Procedures",
      "Validation Standards",
      "Importance of Metrics Standardization",
      "GUIDELINE FOR GOOD CLINICAL PRACTICE",
      "Standards for Clinical Research",
    ]) {
      expect(tierOf(title)).toBeNull();
    }
  });

  it("does not read the tier out of the prose", () => {
    // The rule this module exists to refuse. Item 1 of the vendor chapter's
    // Table 1 *Minimum Standards*, written in "should" — a modal-verb rule
    // badges it a best practice, backwards.
    expect(
      tierOf("Sponsors should assess a vendor's Quality Management System")
    ).toBeNull();
    expect(tierOf("The sponsor shall retain records")).toBeNull();
  });

  it("strips an enumerator without swallowing a word", () => {
    expect(normalizeTierTitle("4) Minimum Standards")).toBe("minimum standards");
    expect(normalizeTierTitle("iii) Best Practices")).toBe("best practices");
    // "Best" is not an enumerator, even though `b` alone is one.
    expect(normalizeTierTitle("Best Practices")).toBe("best practices");
  });
});

describe("the tier tables", () => {
  it("keeps the tagged and the excluded disjoint", () => {
    // A title in both is an authoring mistake that reads as a tagged tier which
    // has also been ruled out.
    for (const key of Object.keys(EXCLUDED_TIERS)) {
      expect(TIER_TITLES[key]).toBeUndefined();
    }
  });

  it("stores every key already normalized", () => {
    // A key that does not survive its own normalizer can never match anything.
    for (const key of [...Object.keys(TIER_TITLES), ...Object.keys(EXCLUDED_TIERS)]) {
      expect(normalizeTierTitle(key)).toBe(key);
    }
  });

  it("flags every listed title as a mention, so the scanner sees it", () => {
    for (const key of Object.keys(TIER_TITLES)) expect(mentionsTier(key)).toBe(true);
    for (const key of Object.keys(EXCLUDED_TIERS)) expect(mentionsTier(key)).toBe(true);
  });
});

describe("a parsed document carries the tier", () => {
  const doc = () =>
    parseDocument(
      [
        "# Vendor Selection and Management",
        "",
        "## 4) Minimum Standards",
        "",
        "Sponsors should assess a vendor's Quality Management System and deem it",
        "appropriate prior to receiving goods or services toward a clinical study.",
        "Decisions made in the course of such an assessment may be risk-based.",
        "",
        "## 5) Best Practices",
        "",
        "Obtain a confidentiality agreement with the vendor prior to exchange of",
        "proprietary information, and document the sponsor's process.",
        "",
        "## Vendor Oversight",
        "",
        "Organizational vendor oversight is a key part of a quality system.",
      ].join("\n"),
      "fixture.md"
    );

  const tierAt = (title: string) =>
    doc().sections.find((s) => (s.baseTitle ?? s.title).includes(title))?.tier;

  it("tags the two tier sections and nothing else", () => {
    expect(tierAt("Minimum Standards")).toBe("minimum");
    expect(tierAt("Best Practices")).toBe("best");
    expect(tierAt("Vendor Oversight")).toBeUndefined();
    expect(tierAt("Vendor Selection and Management")).toBeUndefined();
  });

  it("leaves the field absent rather than null on an ordinary section", () => {
    // `SessionState` and the stored shape both read an absent field as "no
    // tier"; a null would serialize and mean the same thing more expensively.
    const ordinary = doc().sections.find((s) => s.title.includes("Vendor Oversight"));
    expect(ordinary && "tier" in ordinary).toBe(false);
  });

  it("counts a tier section the same as any other", () => {
    // The tag must not change what the section *is* — its words, its intercept
    // and its place in the map are decided exactly as before.
    const tier = doc().sections.find((s) => s.title.includes("Minimum Standards"));
    expect(tier?.wordCount).toBeGreaterThan(0);
    expect(tier?.level).toBe(2);
  });
});

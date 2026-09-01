import { describe, expect, it } from "vitest";

import { MAX_ANCHORS, sectionAnchors } from "./anchors";
import { buildEntityIndex } from "./entities";
import { parseDocument } from "./parse";

/**
 * The anchors have to come from the section and nowhere else. A term the
 * reader is handed that the section never used is not scaffolding, it is the
 * app putting words in their mouth at the one moment it must not — the same
 * argument invariant 28 makes about the dictation corrector.
 */
const DOC = `# Contents

x

# Data Privacy

The Data Management Plan describes how the CRF is handled. A CRF is signed by
the investigator and the Data Management Plan is approved before first patient
in. The CRF is then locked.

# Vendor Selection

An SOP governs selection. The SOP is reviewed each year, and the SOP names an
owner. Selection requires Vendor Oversight throughout, and the sponsor keeps
Vendor Oversight at all times.

# Data Handling

The SOP refers to the eCRF, and the eCRF is validated by the CRO. A CRF is not
an eCRF. The SOP names the DMP owner, and the CRO signs the DMP.

# Empty Chapter

Nothing here is named or abbreviated at all in this short line of prose.
`;

const doc = parseDocument(DOC, "anchors.md");
const index = buildEntityIndex(doc);
const sectionNamed = (title: string) =>
  doc.sections.findIndex((s) => s.title.trim() === title);

describe("sectionAnchors", () => {
  it("offers the acronyms the section actually used", () => {
    const anchors = sectionAnchors(doc, sectionNamed("Data Privacy"), index);
    expect(anchors.some((a) => a.label === "CRF" && a.kind === "acronym")).toBe(true);
  });

  it("never offers a term from a different section", () => {
    const privacy = sectionAnchors(doc, sectionNamed("Data Privacy"), index);
    // SOP is used three times, but in the vendor chapter.
    expect(privacy.map((a) => a.label)).not.toContain("SOP");

    const vendor = sectionAnchors(doc, sectionNamed("Vendor Selection"), index);
    expect(vendor.map((a) => a.label)).not.toContain("CRF");
  });

  it("leads with the acronym the section leaned on most", () => {
    // Five acronyms, and the most-used is not the alphabetically first: eCRF
    // appears three times, CRF once. Sorting by name instead of by use turns
    // this red, which is the only thing that makes the ordering a claim.
    const anchors = sectionAnchors(doc, sectionNamed("Data Handling"), index);
    expect(anchors[0]).toEqual({ label: "eCRF", kind: "acronym" });
    expect(anchors.map((a) => a.label)).not.toContain("CRF");
  });

  it("adds named things the index found in this section", () => {
    const anchors = sectionAnchors(doc, sectionNamed("Vendor Selection"), index);
    expect(anchors.some((a) => a.kind === "term" && a.label === "Vendor Oversight")).toBe(
      true
    );
  });

  it("offers nothing for a section that names nothing", () => {
    // 9% of the corpus's intercept sections land here, and they get no button
    // rather than an empty one.
    expect(sectionAnchors(doc, sectionNamed("Empty Chapter"), index)).toEqual([]);
  });

  it("never offers more than it promises", () => {
    // The cap only means anything where there is something to cut: this
    // section names five acronyms on its own.
    const crowded = sectionNamed("Data Handling");
    expect(sectionAnchors(doc, crowded, index, 99).length).toBeGreaterThan(MAX_ANCHORS);
    expect(sectionAnchors(doc, crowded, index)).toHaveLength(MAX_ANCHORS);
    for (let i = 0; i < doc.sections.length; i++) {
      expect(sectionAnchors(doc, i, index).length).toBeLessThanOrEqual(MAX_ANCHORS);
    }
  });

  it("works with no stored index, on acronyms alone", () => {
    // The index is derived and can be absent — a document read before it
    // existed, or a private-mode browser where the store never opened.
    const anchors = sectionAnchors(doc, sectionNamed("Data Privacy"), null);
    expect(anchors.map((a) => a.label)).toEqual(["CRF"]);
  });

  it("will not take an acronym from a stale index", () => {
    // An index is derived data and is stale-checked by word count, so it can
    // outlive a re-parse that moved section boundaries. An acronym must come
    // from the tokens of the section being summarized -- the same guarantee
    // invariant 28 gives the dictation corrector -- or a reader gets handed a
    // term this section never used, badged as if it had.
    const empty = sectionNamed("Empty Chapter");
    const lying = {
      ...index,
      entries: [
        { key: "SOP", display: "SOP", kind: "acronym" as const, count: 9, sections: [empty], first: 0 },
        ...index.entries,
      ],
    };
    expect(sectionAnchors(doc, empty, lying)).toEqual([]);
  });

  it("returns nothing for a section that does not exist", () => {
    expect(sectionAnchors(doc, 999, index)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";

import {
  buildCitationIndex,
  citationsInDocument,
  findCitations,
  PARTS,
  type CitationSite,
} from "./citations";

/**
 * A citation recogniser fails in two directions and only one is visible.
 *
 * Missing one costs the reader a cross-reference they never knew was there.
 * *Inventing* one puts a regulation into a panel whose entire job is to say
 * where a rule is discussed — and a manufactured entry is indistinguishable
 * from a real one. So most of what is pinned here is what must **not** be
 * recognised.
 */

const regs = (text: string) => findCitations(text).map((c) => c.regulation);
const pairs = (text: string) =>
  findCitations(text).map((c) => `${c.regulation}${c.provision ? ` §${c.provision}` : ""}`);

describe("findCitations", () => {
  it("reads the CFR forms this corpus actually uses", () => {
    expect(regs("required by 21 CFR Part 11")).toEqual(["21 CFR Part 11"]);
    expect(regs("required by 21 CFR 11")).toEqual(["21 CFR Part 11"]);
    expect(regs("Title 21 CFR Part 312 applies")).toEqual(["21 CFR Part 312"]);
  });

  it("reads a bare part, but only one on the list", () => {
    expect(regs("Part 11 requires audit trails")).toEqual(["21 CFR Part 11"]);
    // The one that matters. `\bPart \d+\b` matches this forty times inside the
    // Part 11 rule itself, and "Part 3 of the data management plan" everywhere.
    expect(regs("records maintained by part 117 of this chapter")).toEqual([]);
    expect(regs("see Part 3 of the data management plan")).toEqual([]);
  });

  it("does not read Title 21 CFR Part 11 as two citations", () => {
    // The anchors nest deliberately, and emitting the inner `Part 11` as well
    // would double every CFR citation in the corpus.
    expect(regs("Title 21 CFR Part 11 requires")).toHaveLength(1);
  });

  it("keeps the ICH revision when one is given, and not when it is not", () => {
    expect(regs("under ICH E6(R2)")).toEqual(["ICH E6(R2)"]);
    expect(regs("under ICH E6 (R3)")).toEqual(["ICH E6(R3)"]);
    expect(regs("under E6(R1)")).toEqual(["ICH E6(R1)"]);
    expect(regs("under ICH E6 generally")).toEqual(["ICH E6"]);
  });

  it("reads the other ICH guidelines and the named laws", () => {
    expect(regs("see ICH E9 and ICH M2")).toEqual(["ICH E9", "ICH M2"]);
    expect(regs("ICH GCP applies")).toEqual(["ICH GCP"]);
    expect(regs("under HIPAA and the GDPR")).toEqual(["HIPAA", "EU GDPR"]);
  });

  it("takes a provision only when it is introduced or extends the part", () => {
    expect(pairs("21 CFR Part 11 section 11.10")).toEqual(["21 CFR Part 11 §11.10"]);
    expect(pairs("ICH E6(R2), Chapter 5")).toEqual(["ICH E6(R2) §5"]);
    expect(pairs("Part 11 11.300 covers")).toEqual(["21 CFR Part 11 §11.300"]);
    // A bare number following is not a provision.
    expect(pairs("21 CFR Part 11 1998 amendments")).toEqual(["21 CFR Part 11"]);
  });

  it("does not reach across a sentence for a provision", () => {
    // The provision pattern is anchored at the end of the anchor, so a section
    // number two clauses later belongs to nothing.
    expect(pairs("ICH E6 is the guideline. The protocol section 4.2 says")).toEqual([
      "ICH E6",
    ]);
  });

  it("refuses a bare section number, which is the whole rule", () => {
    // Ambiguous between E6's quality management section and the fifth section
    // of the document being read. Nothing in the sentence settles it.
    expect(regs("as described in section 5.0 above")).toEqual([]);
    expect(regs("see Table 1 and Figure 2")).toEqual([]);
  });

  it("does not read a citation out of a URL", () => {
    // From the GCDMP bibliography. A real reference to the HIPAA Security Rule
    // and still not a citation the reader can act on — and admitting it means
    // every link in the corpus becomes a candidate.
    expect(
      regs("Available at: http://www.access.gpo.gov/nara/cfr/waisidx_02/45cfr164_02.html.")
    ).toEqual([]);
    // But the same reference in prose is a citation.
    expect(regs("as set out in 45 CFR 164")).toEqual(["45 CFR Part 164"]);
  });

  it("never returns overlapping spans", () => {
    const found = findCitations(
      "Title 21 CFR Part 11 section 11.10 and ICH E6(R2), Chapter 5 and Part 312"
    );
    let at = -1;
    for (const c of found) {
      expect(c.start).toBeGreaterThanOrEqual(at);
      at = c.end;
    }
    expect(found).toHaveLength(3);
  });

  it("gives every part on the list a title", () => {
    for (const [part, title] of Object.entries(PARTS)) {
      expect(title.length).toBeGreaterThan(3);
      expect(regs(`under Part ${part}`)).toEqual([`21 CFR Part ${part}`]);
    }
  });
});

describe("citationsInDocument", () => {
  const source = (words: string[]) => ({
    docId: "d",
    docTitle: "Doc",
    words,
    sectionOf: (i: number) => (i < 4 ? 0 : 1),
    sectionTitle: (s: number) => (s === 0 ? "Scope" : "Records"),
  });

  it("points at the token the citation starts on", () => {
    const words = ["Systems", "must", "meet", "21", "CFR", "Part", "11", "in", "full"];
    const [site] = citationsInDocument(source(words));
    expect(site.tokenIndex).toBe(3);
    expect(words[site.tokenIndex]).toBe("21");
  });

  it("labels the citation with the section it sits in", () => {
    const words = ["a", "b", "c", "d", "under", "ICH", "GCP", "rules"];
    const [site] = citationsInDocument(source(words));
    expect(site.section).toBe(1);
    expect(site.sectionTitle).toBe("Records");
  });

  it("finds a citation that spans several tokens", () => {
    const words = ["see", "21", "CFR", "Part", "11", "section", "11.10", "now"];
    const sites = citationsInDocument(source(words));
    expect(sites).toHaveLength(1);
    expect(sites[0].tokenIndex).toBe(1);
    expect(sites[0].text).toBe("21 CFR Part 11 section 11.10");
  });
});

describe("buildCitationIndex", () => {
  const site = (
    over: Partial<CitationSite> & { regulation: string; provision: string | null }
  ): CitationSite => ({
    docId: "a",
    docTitle: "A",
    section: 0,
    sectionTitle: "S",
    tokenIndex: 0,
    text: "t",
    ...over,
  });

  it("ranks by how many documents cite a rule, not how often", () => {
    const index = buildCitationIndex([
      // Quoted forty times inside one document.
      ...Array.from({ length: 40 }, () =>
        site({ regulation: "21 CFR Part 820", provision: null })
      ),
      // Discussed by three different ones.
      site({ regulation: "ICH E6(R2)", provision: null, docId: "a" }),
      site({ regulation: "ICH E6(R2)", provision: null, docId: "b" }),
      site({ regulation: "ICH E6(R2)", provision: null, docId: "c" }),
    ]);
    expect(index[0].regulation).toBe("ICH E6(R2)");
    expect(index[0].documents).toBe(3);
    expect(index[1].total).toBe(40);
  });

  it("groups provisions under their regulation and counts documents", () => {
    const index = buildCitationIndex([
      site({ regulation: "21 CFR Part 11", provision: "11.10", docId: "a" }),
      site({ regulation: "21 CFR Part 11", provision: "11.10", docId: "b" }),
      site({ regulation: "21 CFR Part 11", provision: "11.300", docId: "a" }),
      site({ regulation: "21 CFR Part 11", provision: null, docId: "a" }),
    ]);
    const part11 = index.find((e) => e.regulation === "21 CFR Part 11");
    expect(part11?.total).toBe(4);
    expect(part11?.provisions[0].provision).toBe("11.10");
    expect(part11?.provisions[0].documents).toBe(2);
    // The un-provisioned citations are their own group, not merged in.
    expect(part11?.provisions.some((p) => p.provision === null)).toBe(true);
  });

  it("carries the official title of a listed part", () => {
    const index = buildCitationIndex([
      site({ regulation: "21 CFR Part 11", provision: null }),
      site({ regulation: "45 CFR Part 164", provision: null }),
    ]);
    expect(index.find((e) => e.regulation === "21 CFR Part 11")?.subtitle).toBe(
      PARTS["11"]
    );
    // A part from another title has no entry in the list, and gets no invented
    // one.
    expect(index.find((e) => e.regulation === "45 CFR Part 164")?.subtitle).toBeUndefined();
  });

  it("is empty for a corpus that cites nothing", () => {
    expect(buildCitationIndex([])).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";

import { DOMAINS, STANDARDS_CHAPTERS } from "./blueprint";
import {
  ALIASES,
  EXCLUDED,
  RESEMBLES,
  allChapters,
  buildBlueprintCoverage,
  isExcluded,
  matchChapter,
  normalizeTitle,
  resembledChapters,
  type CoverageUnit,
} from "./blueprint-coverage";

/** A section-level unit, read and verified unless told otherwise. */
function unit(over: Partial<CoverageUnit> = {}): CoverageUnit {
  const words = over.words ?? 100;
  return {
    docId: "doc",
    docTitle: "Doc",
    section: 0,
    title: "Data Privacy",
    words,
    readWords: over.readWords ?? words,
    verifiedWords: over.verifiedWords ?? words,
    ...over,
  };
}

describe("normalizeTitle", () => {
  it("folds the spellings the study guide uses for one chapter", () => {
    // All four of these appear in the guide, for the same chapter.
    expect(normalizeTitle("Medical Coding Dictionary Management & Maintenance")).toBe(
      normalizeTitle("Medical Coding Dictionary Management and Maintenance")
    );
    expect(normalizeTitle("Electronic Data Capture--Study Closeout")).toBe(
      normalizeTitle("Electronic Data Capture - Study Closeout")
    );
    expect(normalizeTitle("Project Management for the Clinical Data Manager")).toBe(
      normalizeTitle("Project Management for Clinical Data Manager")
    );
    expect(normalizeTitle("DATA PRIVACY")).toBe(normalizeTitle("Data Privacy"));
  });

  it("keeps an edition marker, which is a different chapter", () => {
    // If this ever folds, `Vendor Selection and Management (Released 2021)`
    // disappears from the report entirely — `allChapters` dedupes by key — and
    // a chapter that is never listed can never be reported absent.
    expect(normalizeTitle("Vendor Selection and Management (Released 2021)")).not.toBe(
      normalizeTitle("Vendor Selection and Management")
    );
  });

  it("does not collapse two chapters that differ by one word", () => {
    // The pair that rules out fuzzy matching. Both are real GCDMP chapters and
    // only `Measuring` is on the blueprint.
    expect(normalizeTitle("Assuring Data Quality")).not.toBe(
      normalizeTitle("Measuring Data Quality")
    );
  });
});

describe("matchChapter", () => {
  it("matches a chapter under its own name", () => {
    expect(matchChapter("Edit Check Design Principles")).toBe(
      "Edit Check Design Principles"
    );
  });

  it("matches through an alias", () => {
    expect(matchChapter("Data Entry Process")).toBe("Data Entry Processes");
  });

  it("refuses the nearest neighbour rather than guessing", () => {
    // `Assuring Data Quality` is a real chapter of the handbook that is not on
    // the blueprint. Every edit-distance metric pairs it with `Measuring Data
    // Quality`; this must return null instead.
    expect(matchChapter("Assuring Data Quality")).toBeNull();
    expect(matchChapter("Measuring Data Quality")).toBe("Measuring Data Quality");
  });

  it("returns null for the handbook's non-chapter sections", () => {
    for (const title of ["Contents", "Glossary", "GCDMP Revision History", "Introduction"]) {
      expect(matchChapter(title)).toBeNull();
    }
  });

  it("does not match a run-in sub-heading that quotes a chapter name", () => {
    // "m) Data Privacy" is two hundred words inside the DCI chapter. Matching
    // it would report a twenty-page chapter as covered by a paragraph.
    expect(matchChapter("m) Data Privacy")).toBeNull();
    expect(isExcluded("m) Data Privacy")).toBe(true);
  });
});

describe("the blueprint tables", () => {
  it("lists every chapter exactly once", () => {
    const chapters = allChapters();
    expect(new Set(chapters.map(normalizeTitle)).size).toBe(chapters.length);
  });

  it("covers every chapter named by a domain or by section 2", () => {
    const known = new Set(allChapters().map(normalizeTitle));
    for (const name of [...DOMAINS.flatMap((d) => d.chapters), ...STANDARDS_CHAPTERS]) {
      expect(known.has(normalizeTitle(name))).toBe(true);
    }
  });

  it("keeps aliases, resemblances and exclusions disjoint", () => {
    // A title in two tables is an authoring mistake that reads as a matched
    // chapter which is also merely similar to itself.
    const aliased = new Set(Object.keys(ALIASES).map(normalizeTitle));
    const resembling = new Set(
      Object.values(RESEMBLES).flat().map(normalizeTitle)
    );
    const excluded = new Set(Object.keys(EXCLUDED).map(normalizeTitle));
    for (const key of aliased) {
      expect(resembling.has(key)).toBe(false);
      expect(excluded.has(key)).toBe(false);
    }
    for (const key of resembling) expect(excluded.has(key)).toBe(false);
  });

  it("points every resemblance at a chapter that exists", () => {
    const known = new Set(allChapters().map(normalizeTitle));
    for (const chapter of Object.keys(RESEMBLES)) {
      expect(known.has(normalizeTitle(chapter))).toBe(true);
    }
  });

  it("names Training as the only domain with ICH topics", () => {
    const withTopics = DOMAINS.filter((d) => d.ichTopics?.length);
    expect(withTopics.map((d) => d.id)).toEqual(["training"]);
  });
});

describe("resembledChapters", () => {
  it("reports a later edition against the chapter it re-split", () => {
    expect(
      resembledChapters("Electronic Data Capture-Study Implementation and Start-up")
    ).toContain("Electronic Data Capture--Concepts and Study Start-up");
  });

  it("is empty for an unrelated title", () => {
    expect(resembledChapters("Laboratory Data Handling")).toEqual([]);
  });
});

describe("buildBlueprintCoverage", () => {
  it("reports a chapter nothing matches as absent", () => {
    const report = buildBlueprintCoverage([unit({ title: "Data Privacy" })]);
    const privacy = report.chapters.find((c) => c.chapter === "Data Privacy");
    const closure = report.chapters.find((c) => c.chapter === "Database Closure");
    expect(privacy?.state).toBe("verified");
    expect(closure?.state).toBe("absent");
    expect(report.absent.map((c) => c.chapter)).toContain("Database Closure");
  });

  it("separates unread, unchecked, partial and verified", () => {
    const report = buildBlueprintCoverage([
      unit({ title: "Data Privacy", words: 100, readWords: 0, verifiedWords: 0 }),
      unit({
        docId: "b",
        title: "Database Closure",
        words: 100,
        readWords: 100,
        verifiedWords: 0,
      }),
      unit({
        docId: "c",
        title: "Laboratory Data Handling",
        words: 100,
        readWords: 100,
        verifiedWords: 40,
      }),
      unit({ docId: "d", title: "Edit Check Design Principles" }),
    ]);
    const state = (name: string) =>
      report.chapters.find((c) => c.chapter === name)?.state;

    expect(state("Data Privacy")).toBe("unread");
    expect(state("Database Closure")).toBe("unchecked");
    expect(state("Laboratory Data Handling")).toBe("partial");
    expect(state("Edit Check Design Principles")).toBe("verified");
  });

  it("counts a standalone chapter PDF once, not twice", () => {
    // The document is the chapter, and one of its own sections repeats the
    // title. Counting both would report 900 words for a 600-word chapter.
    const report = buildBlueprintCoverage([
      unit({ docId: "vsm", section: 3, title: "Vendor Selection and Management", words: 300 }),
      unit({ docId: "vsm", section: null, title: "Vendor Selection and Management", words: 600 }),
    ]);
    const chapter = report.chapters.find(
      (c) => c.chapter === "Vendor Selection and Management"
    );
    expect(chapter?.words).toBe(300);
    expect(chapter?.sources).toHaveLength(1);
    expect(chapter?.sources[0].section).toBe(3);
  });

  it("still uses a document-level match when no section claims the chapter", () => {
    const report = buildBlueprintCoverage([
      unit({ docId: "vsm", section: 0, title: "Introduction", words: 50 }),
      unit({ docId: "vsm", section: null, title: "Vendor Selection and Management", words: 600 }),
    ]);
    const chapter = report.chapters.find(
      (c) => c.chapter === "Vendor Selection and Management"
    );
    expect(chapter?.words).toBe(600);
    expect(chapter?.sources[0].section).toBeNull();
  });

  it("never counts a resemblance as coverage", () => {
    const report = buildBlueprintCoverage([
      unit({
        docId: "edc",
        section: null,
        title: "Electronic Data Capture-Study Implementation and Start-up",
        words: 900,
      }),
    ]);
    const chapter = report.chapters.find(
      (c) => c.chapter === "Electronic Data Capture--Concepts and Study Start-up"
    );
    expect(chapter?.state).toBe("absent");
    expect(chapter?.words).toBe(0);
    // But the reader is told the document exists, because it is worth a look.
    expect(chapter?.resembling.map((r) => r.title)).toEqual([
      "Electronic Data Capture-Study Implementation and Start-up",
    ]);
  });

  it("rolls chapters up to the domains that name them", () => {
    const report = buildBlueprintCoverage([unit({ title: "Data Privacy" })]);
    const processing = report.domains.find((d) => d.id === "processing");

    expect(processing?.taskCount).toBe(3);
    expect(processing?.verified).toBe(1);
    expect(processing?.absent).toBe(processing!.chapters.length - 1);
    // Design does not name Data Privacy, so the same unit moves nothing there.
    expect(report.domains.find((d) => d.id === "design")?.verified).toBe(0);
  });

  it("names the domains a chapter belongs to, and only those", () => {
    const report = buildBlueprintCoverage([unit({ title: "Measuring Data Quality" })]);
    const quality = report.chapters.find((c) => c.chapter === "Measuring Data Quality");
    // The guide names this chapter against Review and nothing else.
    expect(quality?.domains).toEqual(["review"]);

    const privacy = report.chapters.find((c) => c.chapter === "Data Privacy");
    expect(privacy?.domains).toEqual(["processing", "training", "coordination", "review"]);
  });

  it("marks the chapters the guide gives minimum standards for", () => {
    const report = buildBlueprintCoverage([]);
    const withStandards = report.chapters.filter((c) => c.standards);
    expect(withStandards).toHaveLength(STANDARDS_CHAPTERS.length);
    // And an absent chapter carries that flag through, because it is what makes
    // one gap cost more than another.
    expect(report.absentWithStandards.length).toBe(STANDARDS_CHAPTERS.length);
  });

  it("reports a chapter absent when the library is empty", () => {
    const report = buildBlueprintCoverage([]);
    expect(report.absent).toHaveLength(report.totalChapters);
    expect(report.verifiedChapters).toBe(0);
  });
});

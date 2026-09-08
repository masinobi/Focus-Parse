/**
 * Matching the blueprint against a reader's library, and reporting the gap.
 *
 * Deliberately a separate module from `blueprint.ts`. That file is a
 * transcription of what SCDM published and a human audits it against the PDF.
 * This file is a claim about *one reader's* corpus — which titles correspond to
 * which chapters — and it is the half that can be wrong in a way the reader
 * cannot see. Keeping them apart means an alias argument never turns into an
 * edit of the blueprint.
 *
 * ## Why an alias table and not a similarity score
 *
 * The obvious implementation is a fuzzy title match: normalize, score, take the
 * best above a threshold. It is the wrong tool, and the GCDMP handbook contains
 * the counterexample that proves it. Its chapter list holds both
 *
 *     Assuring Data Quality        (revised Oct 2013, 20 pages)
 *     Measuring Data Quality       (revised Sep 2008, 12 pages)
 *
 * which are different chapters about different things, one word apart. Every
 * edit-distance or trigram metric scores that pair as a near-certain match, and
 * only one of them is on the blueprint. The failure is silent in both
 * directions at once: the reader is told they have covered `Measuring Data
 * Quality` when they read `Assuring Data Quality`, and the real chapter never
 * shows as missing.
 *
 * So matching is **exact after normalization, or listed in `ALIASES`** (or, for
 * a title standing as a whole document, in `DOCUMENT_ALIASES`). A title
 * that matches nothing is reported as unmatched rather than attached to its
 * closest neighbour. That makes the report boring to maintain and impossible to
 * be quietly wrong about, which is the correct trade for a number the reader
 * will plan their remaining weeks around.
 *
 * `RESEMBLES` is the pressure valve. Some corpus titles genuinely relate to a
 * blueprint chapter without being it — a later edition that re-split the
 * chapter, or a chapter renamed between guide revisions. Those are surfaced to
 * the reader as something to look at and **never counted as coverage**.
 */

import { DOMAINS, STANDARDS_CHAPTERS, type DomainId } from "./blueprint";
import { MIN_INTERCEPT_WORDS } from "./parse";

/* ------------------------------------------------------------------ *
 * Normalization
 * ------------------------------------------------------------------ */

/**
 * The spelling differences that are not differences.
 *
 * All four of these appear inside the study guide itself, between its own
 * domain tables and its own section 2 — so this is not accommodating sloppy
 * user input, it is reconciling one document with itself.
 *
 *  - `&` and `and`
 *  - `--`, `-`, en and em dashes, all used for the same EDC chapter separator
 *  - a leading `the` in "Project Management for the Clinical Data Manager"
 *  - trailing edition parentheses, which `RESEMBLES` handles rather than this
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[‐-―-]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\bthe\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Titles that *are* a blueprint chapter, under another name.
 *
 * Every entry here is a judgement about this reader's corpus and each one is
 * justified in place. Adding to this table is how the report is kept honest
 * when a document is renamed; guessing is how it stops being honest.
 */
export const ALIASES: Record<string, string> = {
  // The guide's own section 2 heading drops the plural its domain tables use.
  "data entry process": "Data Entry Processes",
  // The GCDMP handbook spells out "and"; the guide's section 2 uses "&".
  "medical coding dictionary management and maintenance":
    "Medical Coding Dictionary Management & Maintenance",
  // Section 2 omits "the"; normalization already drops it, so this is here for
  // the case where a reader titles the document from the handbook's contents.
  "project management for clinical data manager":
    "Project Management for the Clinical Data Manager",
};

/**
 * Aliases that apply only to a title standing as a whole *document*.
 *
 * One entry, and it exists because the corpus holds two different chapters
 * whose titles are identical after normalization. The guide's section 2 gives
 * separate minimum standards for
 *
 *     Vendor Selection and Management                  (guide p38)
 *     Vendor Selection and Management (Released 2021)  (guide p40)
 *
 * and they are not the same list. What p38 calls a minimum standard —
 * "document the sponsor's process and support functions ... evaluate and
 * qualify" — the 2021 release demotes to its Table 2, *Best Practices*. A
 * reader who studied one and answered from the other is wrong in exactly the
 * way "which of the following is a minimum standard" is designed to catch.
 *
 * The corpus PDF is provably the 2021 release, on two independent counts:
 * its citation block reads "Amatya S, Edgerton D. Vendor Selection and
 * Management. Journal of the Society for Clinical Data Management. 2021;
 * 1(1)", and its Table 1 Minimum Standards opens "Sponsors should assess a
 * vendor's Quality Management System and deem it appropriate prior to
 * receiving goods or services" — which is the guide's p40 list verbatim, not
 * p38's.
 *
 * It cannot be keyed by title, because normalization folds `&` into `and` and
 * the two spellings collapse onto one key. Document versus section is the
 * distinction that survives: the 2021 release is a standalone article, and the
 * 2013 chapter exists only as a heading inside the GCDMP handbook. That is a
 * fact about this reader's corpus rather than a general rule, which is why it
 * is a separate table with the evidence attached.
 */
export const DOCUMENT_ALIASES: Record<string, string> = {
  "vendor selection and management": "Vendor Selection and Management (Released 2021)",
};

/**
 * Titles that resemble a blueprint chapter and are not it.
 *
 * Never coverage. Shown to the reader because in every case there is a real
 * decision to make, and the app has no basis for making it:
 *
 *  - The 2013 GCDMP calls its metrics chapter `Metrics in Clinical Data
 *    Management`. The blueprint names `Metrics for Clinical Trials` and
 *    `Reports and Metrics`, neither of which is in the 2013 edition. Whether
 *    the 2013 chapter teaches what the exam asks is a question for the reader,
 *    not for a string comparison.
 *  - The three standalone EDC PDFs in this corpus are a later edition that
 *    re-split the material. `Study Implementation and Start-up` overlaps
 *    `Concepts and Study Start-up` without being the same chapter, and
 *    `Study Conduct, Maintenance and Closeout` merges two of the 2013 ones.
 */
export const RESEMBLES: Record<string, string[]> = {
  "Metrics for Clinical Trials": ["Metrics in Clinical Data Management"],
  "Reports and Metrics": ["Metrics in Clinical Data Management"],
  "Electronic Data Capture--Concepts and Study Start-up": [
    "Electronic Data Capture-Study Implementation and Start-up",
    "Electronic Data Capture-Selecting an EDC System",
  ],
  "Electronic Data Capture--Study Closeout": [
    "Electronic Data Capture-Study Conduct, Maintenance and Closeout",
  ],
};

/**
 * Titles that all but match a blueprint chapter and are deliberately not it.
 *
 * The third answer, and the one that keeps the near-miss alarm in
 * `scan-blueprint.mjs` usable. That alarm flags any corpus title within an edit
 * or two of a chapter name, on the reasoning that a title which nearly matched
 * is either a missing alias or a missing resemblance. Sometimes it is neither,
 * and then the finding has to be written down or the alarm has to be switched
 * off — and an alarm nobody can switch off is an alarm somebody will delete.
 *
 * Each entry is a decision, with the reason, keyed by normalized title.
 */
export const EXCLUDED: Record<string, string> = {
  // A lettered run-in sub-heading inside `Design and Development of Data
  // Collection Instruments` — "m) Data Privacy Data privacy must be maintained
  // to protect..." — where the heading and its first sentence share a line. It
  // is roughly two hundred words about privacy in CRF design. The blueprint's
  // `Data Privacy` is a twenty-page chapter of the handbook. Matching them
  // would report a chapter as covered on the strength of a paragraph, which is
  // the exact inflation this module exists to refuse.
  "m data privacy": "a sub-heading of the DCI chapter, not the Data Privacy chapter",
};

/** True when a near-match has been examined and ruled on. */
export function isExcluded(title: string): boolean {
  return normalizeTitle(title) in EXCLUDED;
}

/** Every chapter the blueprint names, from either source, without duplicates. */
export function allChapters(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of [
    ...DOMAINS.flatMap((d) => d.chapters),
    ...STANDARDS_CHAPTERS,
  ]) {
    const key = normalizeTitle(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Normalized chapter name to the blueprint's own spelling of it. */
function chapterIndex(): Map<string, string> {
  const index = new Map<string, string>();
  for (const name of allChapters()) index.set(normalizeTitle(name), name);
  for (const [alias, name] of Object.entries(ALIASES)) {
    index.set(normalizeTitle(alias), name);
  }
  return index;
}

const INDEX = chapterIndex();

/**
 * The blueprint chapter a corpus title is, or null.
 *
 * Null is a real answer and the common one: most sections of the GCDMP
 * handbook are not blueprint chapters, and the handbook's front matter,
 * glossary and revision history are not chapters at all.
 */
export function matchChapter(title: string): string | null {
  return INDEX.get(normalizeTitle(title)) ?? null;
}

/** Normalized document-alias key to the blueprint's own spelling. */
const DOCUMENT_INDEX = new Map(
  Object.entries(DOCUMENT_ALIASES).map(([alias, name]) => [
    normalizeTitle(alias),
    name,
  ])
);

/**
 * The blueprint chapter a corpus title is, given where the title stands.
 *
 * Identical to `matchChapter` for a section. A whole document consults
 * `DOCUMENT_ALIASES` first, which is the only place the two can differ.
 */
export function matchUnitChapter(
  title: string,
  isDocument: boolean
): string | null {
  if (isDocument) {
    const aliased = DOCUMENT_INDEX.get(normalizeTitle(title));
    if (aliased) return aliased;
  }
  return matchChapter(title);
}

/** Normalized resemblance title to the chapters that claim it. */
const RESEMBLE_INDEX = ((): Map<string, string[]> => {
  const index = new Map<string, string[]>();
  for (const [chapter, titles] of Object.entries(RESEMBLES)) {
    for (const title of titles) {
      const key = normalizeTitle(title);
      index.set(key, [...(index.get(key) ?? []), chapter]);
    }
  }
  return index;
})();

/** Blueprint chapters a corpus title resembles without being. */
export function resembledChapters(title: string): string[] {
  return RESEMBLE_INDEX.get(normalizeTitle(title)) ?? [];
}

/* ------------------------------------------------------------------ *
 * Rolling coverage up to the blueprint
 * ------------------------------------------------------------------ */

/**
 * One matchable piece of the library.
 *
 * A section of a document, or a whole document. Both are needed: the GCDMP
 * handbook carries its chapters as sections, while a standalone chapter PDF is
 * a document whose *title* is the chapter and whose sections are that chapter's
 * internal headings.
 */
export interface CoverageUnit {
  docId: string;
  docTitle: string;
  /** Section index, or null when the unit is the whole document. */
  section: number | null;
  title: string;
  words: number;
  readWords: number;
  verifiedWords: number;
}

export type ChapterState =
  | "absent"
  | "unread"
  | "unchecked"
  | "partial"
  | "verified";

export interface ChapterCoverage {
  chapter: string;
  /** The guide gives this chapter minimum standards and best practices. */
  standards: boolean;
  /** Domains that name this chapter. */
  domains: DomainId[];
  state: ChapterState;
  words: number;
  readWords: number;
  verifiedWords: number;
  sources: CoverageUnit[];
  /**
   * Corpus titles that resemble this chapter without being it, and which the
   * reader actually has. Empty when the resemblance is to something not in the
   * library, because there is then nothing to go and look at.
   */
  resembling: CoverageUnit[];
}

export interface DomainCoverage {
  id: DomainId;
  title: string;
  taskCount: number;
  chapters: ChapterCoverage[];
  absent: number;
  verified: number;
}

export interface BlueprintCoverage {
  domains: DomainCoverage[];
  chapters: ChapterCoverage[];
  /** Chapters the blueprint names that nothing in the library matches. */
  absent: ChapterCoverage[];
  /** Absent chapters the guide also gives minimum standards for. */
  absentWithStandards: ChapterCoverage[];
  totalChapters: number;
  verifiedChapters: number;
  ichTopics: string[];
}

/**
 * Which domains name each chapter. Built once; the blueprint is a constant.
 */
const DOMAINS_OF = ((): Map<string, DomainId[]> => {
  const map = new Map<string, DomainId[]>();
  for (const domain of DOMAINS) {
    for (const chapter of domain.chapters) {
      const key = normalizeTitle(chapter);
      map.set(key, [...(map.get(key) ?? []), domain.id]);
    }
  }
  return map;
})();

const STANDARDS_SET = new Set(STANDARDS_CHAPTERS.map(normalizeTitle));

function stateOf(words: number, read: number, verified: number): ChapterState {
  if (words === 0) return "absent";
  if (read === 0) return "unread";
  if (verified >= words) return "verified";
  if (verified > 0) return "partial";
  return "unchecked";
}

/**
 * Roll a library up to the blueprint.
 *
 * The one subtlety is double counting. A standalone chapter PDF produces a
 * document-level unit *and* section-level units, and its sections are the
 * chapter's own headings — so if both matched, the chapter's word count would
 * be inflated by however much of itself it names. Within one document and one
 * chapter the two are therefore exclusive: either the sections are counted or
 * the document is, never both.
 *
 * Which one wins used to be decided by existence alone — any section match at
 * all suppressed the document — and that is wrong whenever the section is the
 * document's own title repeated as a running heading. `Vendor Selection &
 * Management.pdf` carries such a heading, four words long, and it was
 * suppressing the 8,377-word document behind it: the chapter reported as
 * *verified on eight words*. The same shape hit every standalone chapter PDF
 * in the corpus.
 *
 * So a section outranks the document it is in only when it is a section rather
 * than a heading, at `MIN_INTERCEPT_WORDS` — the floor the intercept, the
 * coverage map and the queue sweep already share. A shorter match still counts
 * as coverage (it is how a handbook's chapter headings are found at all), it
 * just no longer throws away the document it sits inside.
 */
export function buildBlueprintCoverage(units: CoverageUnit[]): BlueprintCoverage {
  const byChapter = new Map<string, CoverageUnit[]>();
  const resemblingBy = new Map<string, CoverageUnit[]>();

  /** docId + chapter pairs claimed by a section big enough to be one. */
  const claimedBySection = new Set<string>();
  /** docId + chapter pairs the whole-document unit will be counted for. */
  const claimedByDocument = new Set<string>();

  const key = (unit: CoverageUnit, chapter: string) =>
    `${unit.docId} ${normalizeTitle(chapter)}`;

  const matched: { unit: CoverageUnit; chapter: string }[] = [];
  for (const unit of units) {
    const chapter = matchUnitChapter(unit.title, unit.section === null);
    if (chapter) {
      matched.push({ unit, chapter });
      if (unit.section !== null && unit.words >= MIN_INTERCEPT_WORDS) {
        claimedBySection.add(key(unit, chapter));
      }
    }
    for (const near of resembledChapters(unit.title)) {
      resemblingBy.set(near, [...(resemblingBy.get(near) ?? []), unit]);
    }
  }

  // Settled before anything is counted, because the two rules below are each
  // other's condition: the document is used when no real section claimed the
  // chapter, and a heading is dropped when the document is used instead.
  for (const { unit, chapter } of matched) {
    if (unit.section !== null) continue;
    if (claimedBySection.has(key(unit, chapter))) continue;
    claimedByDocument.add(key(unit, chapter));
  }

  for (const { unit, chapter } of matched) {
    const pair = key(unit, chapter);
    // A whole-document match yields to a real section of that same document,
    // or the chapter counts its own contents twice.
    if (unit.section === null && claimedBySection.has(pair)) continue;
    // And a heading too short to be a section yields to the document it names,
    // for the same reason in the other direction.
    if (unit.section !== null && claimedByDocument.has(pair)) continue;
    byChapter.set(chapter, [...(byChapter.get(chapter) ?? []), unit]);
  }

  const chapters: ChapterCoverage[] = allChapters().map((chapter) => {
    const key = normalizeTitle(chapter);
    const sources = byChapter.get(chapter) ?? [];
    const words = sources.reduce((n, u) => n + u.words, 0);
    const readWords = sources.reduce((n, u) => n + u.readWords, 0);
    const verifiedWords = sources.reduce((n, u) => n + u.verifiedWords, 0);

    return {
      chapter,
      standards: STANDARDS_SET.has(key),
      domains: DOMAINS_OF.get(key) ?? [],
      state: stateOf(words, readWords, verifiedWords),
      words,
      readWords,
      verifiedWords,
      sources,
      resembling: resemblingBy.get(chapter) ?? [],
    };
  });

  const byName = new Map(chapters.map((c) => [normalizeTitle(c.chapter), c]));

  const domains: DomainCoverage[] = DOMAINS.map((domain) => {
    const rows = domain.chapters
      .map((c) => byName.get(normalizeTitle(c)))
      .filter((c): c is ChapterCoverage => Boolean(c));
    return {
      id: domain.id,
      title: domain.title,
      taskCount: domain.tasks.length,
      chapters: rows,
      absent: rows.filter((c) => c.state === "absent").length,
      verified: rows.filter((c) => c.state === "verified").length,
    };
  });

  const absent = chapters.filter((c) => c.state === "absent");

  return {
    domains,
    chapters,
    absent,
    absentWithStandards: absent.filter((c) => c.standards),
    totalChapters: chapters.length,
    verifiedChapters: chapters.filter((c) => c.state === "verified").length,
    ichTopics: DOMAINS.flatMap((d) => d.ichTopics ?? []),
  };
}

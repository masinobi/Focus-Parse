import { demandsSummary } from "./parse";
import { buildGridQuestion, MAX_GRID_ATTEMPTS } from "./quiz";
import type { ClozeResult, ParsedDoc, Section } from "./types";

/**
 * What has been *verified*, as distinct from what has been read past.
 *
 * Every progress indicator in this app reports the caret. The caret is a claim
 * about the audio, not about the reader — it advances at the same rate whether
 * somebody is following or the tab is minimised, which is the entire reason the
 * enforcement ladder exists. And the ladder was already collecting the evidence
 * that would answer the harder question: a summary written at an intercept, a
 * grid answered, a spot check marked. It was collecting it and discarding it.
 *
 * So the ladder produced exactly the thing a reader working toward a dated exam
 * needs — a per-section account of what they have been made to account for —
 * and threw it away in favour of a bar that says 43%.
 *
 * Three rungs, and each is reported on its own terms rather than blended into a
 * score. Blending would be inventing a weighting nobody measured, and worse, it
 * would hide the distinction the reader actually acts on: a section that owes a
 * summary and a section whose grid was never answered need different amounts of
 * time, and a single percentage says neither.
 */

/** Whether a rung applies to a section, and whether it has been satisfied. */
export type RungState = "n/a" | "owed" | "done";

export interface SectionCoverage {
  section: number;
  title: string;
  /** Words in this section. Furniture reports zero — it is not owed anything. */
  words: number;
  /** How far the caret has been through it, 0–1. */
  read: number;
  /** The section demanded a summary at its boundary, and one was written. */
  summary: RungState;
  grids: { total: number; passed: number };
  /** Spot-check windows overlapping this section, and how they went. */
  cloze: { windows: number; blanks: number; recalled: number };
  /**
   * The headline, and deliberately four states rather than a percentage.
   *
   *  - `unread`   — the caret has not been through it.
   *  - `unchecked`— read, and nothing was ever asked about it. This is the one
   *                 worth seeing: it is ground covered with no evidence at all.
   *  - `partial`  — some rung satisfied and another still owed.
   *  - `verified` — every rung that applies to it has been satisfied.
   */
  state: "unread" | "unchecked" | "partial" | "verified";
  /**
   * Blanks recalled as a share of blanks asked, or null where none were.
   *
   * Held apart from `state` on purpose. Answering a spot check is what proves
   * the reader was there; answering it *correctly* is a different claim, and
   * folding the two together would let a section that was got wrong three times
   * read as unverified when the reader has in fact been held to it repeatedly.
   */
  recall: number | null;
}

export interface DocCoverage {
  sections: SectionCoverage[];
  /** Counts by state, over sections that can be verified at all. */
  verified: number;
  partial: number;
  unchecked: number;
  unread: number;
  /** Words in each, which is the honest denominator — sections vary hugely. */
  verifiedWords: number;
  readWords: number;
  totalWords: number;
  /** Rung totals across the document. */
  summaries: { owed: number; given: number };
  grids: { total: number; passed: number };
  cloze: { windows: number; blanks: number; recalled: number };
}

export interface CoverageInput {
  tokenIndex: number;
  summaries: Record<number, string>;
  gridsPassed: Record<number, boolean>;
  /**
   * Attempts already spent on each grid.
   *
   * Needed because a grid the engine has stopped offering is not a debt the
   * reader can still pay: `finishChunk` declines to arm one past
   * `MAX_GRID_ATTEMPTS`, so a table failed twice would otherwise sit in the map
   * as permanently owed, with no way at all to discharge it.
   */
  gridAttempts?: Record<number, number>;
  clozeChecks: Record<number, ClozeResult>;
}

/**
 * A section is skipped if it is furniture.
 *
 * Journal furniture is marked rather than removed — playback will not wander
 * into an author list, but a deliberate seek still reads it. It is therefore
 * not *owed* anything, and counting it as unverified would put a bibliography
 * permanently on the list of things the reader still has to account for.
 */
function isSkipped(section: Section): boolean {
  return Boolean(section.furniture) || section.wordCount === 0;
}

/**
 * Fraction of `[start, end)` the caret has reached.
 *
 * `tokenIndex + 1`, and the `+ 1` is load-bearing rather than a rounding
 * nicety: `tokenEnd` is exclusive and the caret is clamped to
 * `tokens.length - 1`, so a caret sitting on the very last word of a document
 * is at `tokenEnd - 1` and can never be at `tokenEnd`. Measured against the
 * naive form, the final section of every document stayed "not read yet" for
 * ever — including one whose spot check had just been answered.
 */
function readShare(tokenIndex: number, start: number, end: number): number {
  if (end <= start) return tokenIndex + 1 >= end ? 1 : 0;
  return Math.min(1, Math.max(0, (tokenIndex + 1 - start) / (end - start)));
}

/**
 * Build the coverage account for one document and one session.
 *
 * Pure, and takes the session's four fields rather than the store, so the same
 * function serves the sidebar, an offline report and a test without any of them
 * having to stand up a reader.
 */
export function buildCoverage(doc: ParsedDoc, input: CoverageInput): DocCoverage {
  const { tokenIndex, summaries, gridsPassed, clozeChecks } = input;
  const gridAttempts = input.gridAttempts ?? {};

  /*
   * Grid blocks per section, counted once — and only the ones the engine would
   * actually stop for.
   *
   * Two conditions beyond "it is a table with steps", both taken from
   * `finishChunk` so the account cannot demand something the ladder will never
   * raise. A grid with no answerable cell is never armed (invariant 7: a check
   * must never be armed unless it can be answered), and a grid already failed
   * twice is never armed again. Counting either as owed would be a debt with no
   * way to pay it, which is the one thing a coverage map must not contain.
   */
  const gridsBySection = new Map<number, number[]>();
  for (const block of doc.blocks) {
    if (block.kind !== "table" || !block.steps?.length) continue;
    const attempts = gridAttempts[block.i] ?? 0;
    const askable =
      gridsPassed[block.i] ||
      (attempts < MAX_GRID_ATTEMPTS && buildGridQuestion(block, attempts) !== null);
    if (!askable) continue;
    gridsBySection.set(block.section, [...(gridsBySection.get(block.section) ?? []), block.i]);
  }

  const windows = Object.values(clozeChecks);

  const sections: SectionCoverage[] = doc.sections.map((section) => {
    const skipped = isSkipped(section);
    const read = readShare(tokenIndex, section.tokenStart, section.tokenEnd);

    const blocks = gridsBySection.get(section.i) ?? [];
    const grids = {
      total: blocks.length,
      passed: blocks.filter((b) => gridsPassed[b]).length,
    };

    // A window is attributed to every section it overlaps. It genuinely covered
    // all of them — the cadence fires on token count and knows nothing about
    // structure — and picking one would discard real evidence for the others.
    let clozeWindows = 0;
    let blanks = 0;
    let recalled = 0;
    for (const w of windows) {
      if (w.to <= section.tokenStart || w.from >= section.tokenEnd) continue;
      clozeWindows += 1;
      blanks += w.blanks;
      recalled += w.recalled;
    }

    // A summary is owed by the section being *left*, not by the one that arms
    // the intercept — `finishChunk` raises it on crossing into a section with
    // `intercept` set, and asks about the one just finished. Keying this off
    // `section.intercept` instead looks equivalent on a document where every
    // section arms one, and is wrong in the places it matters.
    //
    // The whole condition lives in `demandsSummary` so this and `finishChunk`
    // cannot drift: invariant 20 is only kept if both read the same rule, and
    // when they each carried their own they shared the same defect for a round.
    const summary: RungState = !demandsSummary(doc.sections, section.i)
      ? "n/a"
      : summaries[section.i]
        ? "done"
        : "owed";

    const rungs: RungState[] = [
      summary,
      grids.total === 0 ? "n/a" : grids.passed === grids.total ? "done" : "owed",
      // The cheap rung applies to any section long enough to have been asked
      // about. A two-sentence heading between two others never gets a window of
      // its own and must not be marked as owing one for ever.
      clozeWindows > 0 ? "done" : "owed",
    ];

    const applicable = rungs.filter((r) => r !== "n/a");
    const done = applicable.filter((r) => r === "done").length;

    const state: SectionCoverage["state"] = skipped
      ? "verified" // Nothing is owed, so nothing is outstanding.
      : read < 1
        ? "unread"
        : done === 0
          ? "unchecked"
          : done === applicable.length
            ? "verified"
            : "partial";

    return {
      section: section.i,
      title: section.baseTitle ?? section.title,
      words: skipped ? 0 : section.wordCount,
      read,
      summary,
      grids,
      cloze: { windows: clozeWindows, blanks, recalled },
      state,
      recall: blanks > 0 ? recalled / blanks : null,
    };
  });

  const counted = sections.filter((s) => s.words > 0);
  const sum = (pick: (s: SectionCoverage) => number) =>
    counted.reduce((t, s) => t + pick(s), 0);

  return {
    sections,
    verified: counted.filter((s) => s.state === "verified").length,
    partial: counted.filter((s) => s.state === "partial").length,
    unchecked: counted.filter((s) => s.state === "unchecked").length,
    unread: counted.filter((s) => s.state === "unread").length,
    verifiedWords: sum((s) => (s.state === "verified" ? s.words : 0)),
    readWords: sum((s) => Math.round(s.words * s.read)),
    totalWords: sum((s) => s.words),
    summaries: {
      owed: counted.filter((s) => s.summary === "owed").length,
      given: counted.filter((s) => s.summary === "done").length,
    },
    grids: { total: sum((s) => s.grids.total), passed: sum((s) => s.grids.passed) },
    cloze: {
      // Windows are counted once here, not once per section they overlap — the
      // per-section figure is deliberately double-counted and this one must not
      // inherit that or the document would report more checks than were sat.
      windows: windows.length,
      blanks: windows.reduce((t, w) => t + w.blanks, 0),
      recalled: windows.reduce((t, w) => t + w.recalled, 0),
    },
  };
}

/**
 * The section the remaining time should go to.
 *
 * Read-but-unchecked first, then partial, then unread — which is the order of
 * how cheap the evidence is to get. A section already read needs one check; a
 * section not yet read needs reading. Within a band, the longest first: that is
 * where the most unaccounted-for material is.
 */
/**
 * How much reading stands between here and the next enforced stop.
 *
 * The reader asked for a countdown and a countdown is the wrong shape. A
 * ticking clock in the field of view is a thing to watch instead of the text,
 * and this app puts the vigilance pill in the corner precisely so it is noticed
 * without being looked at. Distance in words is the same information with none
 * of that pull: it is glanced at deliberately, in the sidebar, and it does not
 * move on its own.
 *
 * Both rungs are reported, because reporting only the summary would be true and
 * misleading. The ladder fires a spot check every 250 tokens, so a reader told
 * "1,400 words to the next summary" will in fact be stopped four or five times
 * before then, and would reasonably conclude the number was wrong.
 *
 * The spot-check figure is a floor rather than a promise, and the summary
 * figure assumes the section is read from here to its end. `buildCloze` can
 * find nothing worth asking in a stretch — narrative passages and reference
 * lists both do it — and then the engine slides the window forward instead of
 * stopping. Nothing here can know that in advance, which is why the caller
 * renders these as approximations.
 */
export interface NextStop {
  /** Words until the reading cadence next comes round, at the earliest. */
  toCheck: number | null;
  /** Words until crossing into a section that owes a summary for this one. */
  toSummary: number | null;
}

export function nextStop(
  doc: ParsedDoc,
  tokenIndex: number,
  lastCheckToken: number,
  summaries: Record<number, string>,
  clozeIntervalTokens: number
): NextStop {
  // `wordCount` rather than `tokens.length`: they are the same number in a
  // parsed document, and only the first is present on one built from sections
  // alone. Depending on the token array made this untestable without building
  // one, which is a lot of scaffolding for a subtraction.
  const toCheck =
    tokenIndex >= doc.wordCount
      ? null
      : Math.max(0, clozeIntervalTokens - (tokenIndex - lastCheckToken));

  // Walk forward for the next boundary that would actually arm an intercept:
  // a section that arms one, entered from a section that has not been
  // summarised yet. A boundary into furniture arms nothing, and neither does a
  // boundary out of a section whose summary is already written.
  let toSummary: number | null = null;
  // Located from the section bounds rather than from `tokens[i].section`, for
  // the same reason. The two agree in a parsed document.
  const here = Math.max(
    0,
    doc.sections.findIndex((x) => tokenIndex < x.tokenEnd)
  );
  for (let i = here; i < doc.sections.length - 1; i++) {
    const leaving = doc.sections[i];
    const entering = doc.sections[i + 1];
    if (!entering || leaving.furniture || entering.furniture) continue;
    if (!entering.intercept) continue;
    if (summaries[leaving.i] !== undefined) continue;
    toSummary = Math.max(0, entering.tokenStart - tokenIndex);
    break;
  }

  return { toCheck, toSummary };
}

export function nextToVerify(coverage: DocCoverage): SectionCoverage | null {
  const rank: Record<SectionCoverage["state"], number> = {
    unchecked: 0,
    partial: 1,
    unread: 2,
    verified: 3,
  };
  const candidates = coverage.sections.filter(
    (s) => s.words > 0 && s.state !== "verified"
  );
  if (!candidates.length) return null;
  return candidates.reduce((best, s) =>
    rank[s.state] !== rank[best.state]
      ? rank[s.state] < rank[best.state]
        ? s
        : best
      : s.words > best.words
        ? s
        : best
  );
}

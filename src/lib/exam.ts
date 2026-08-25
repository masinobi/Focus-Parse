import { ACRONYMS, type AcronymCategory } from "./acronyms";
import { buildCloze, buildGridQuestion, gridPrompt, isStructuralReference } from "./quiz";
import { termKey, type WeakTerms } from "./review";
import type { ParsedDoc } from "./types";

/**
 * Mock exam.
 *
 * Everything this needs already exists. `buildGridQuestion` and `buildCloze`
 * produce questions with exactly one right answer and grade them locally with
 * no model call, and the acronym dictionary is a definition list — which is
 * precisely what a certification examines. What was missing was the shape:
 * those checks fire *while reading*, one document at a time, as interruptions
 * whose purpose is to stop the reader coasting. An exam is the opposite. It is
 * a timed set drawn across the whole corpus at once, with no feedback until the
 * end, which is the only arrangement that answers "would I pass on Tuesday?".
 *
 * Three kinds, for three different things a certification tests:
 *
 *  - **Acronym definitions.** The vocabulary the material is written in, and
 *    the cheapest thing to be caught out by.
 *  - **Cloze blanks.** Whether a claim was understood in its own sentence
 *    rather than recognised.
 *  - **Grid cells.** Whether a matrix — a RACI table, a metrics table — was
 *    taken in as a structure rather than heard as prose.
 *
 * Questions are generated from a seed rather than at random, so a given exam
 * can be rebuilt exactly. The reason is not reproducibility for its own sake:
 * it means a score can be attributed to an identifiable set of questions rather
 * than to an unrepeatable draw.
 */

export type ExamKind = "acronym" | "cloze" | "grid";

interface BaseQuestion {
  /** Stable within an exam, and used as the React key. */
  id: string;
  kind: ExamKind;
  docId: string;
  docTitle: string;
  section?: number;
}

export interface AcronymQuestion extends BaseQuestion {
  kind: "acronym";
  /** Dictionary key, which is also what is shown. */
  acronym: string;
  prompt: string;
  answer: string;
  options: string[];
}

export interface ClozeQuestion extends BaseQuestion {
  kind: "cloze";
  /** The sentence with the term removed. */
  carrier: string;
  answer: string;
  acronym?: string;
  tokenIndex: number;
}

export interface GridQuestion extends BaseQuestion {
  kind: "grid";
  prompt: string;
  answer: string;
  options: string[];
  blockIndex: number;
  row: string;
  column: string;
  caption: string | null;
}

export type ExamQuestion = AcronymQuestion | ClozeQuestion | GridQuestion;

/** One document's candidate questions, before the exam is assembled. */
export interface QuestionPool {
  docId: string;
  docTitle: string;
  acronym: AcronymQuestion[];
  cloze: ClozeQuestion[];
  grid: GridQuestion[];
}

/**
 * Candidates collected per document per kind.
 *
 * A cap rather than everything: the GCDMP alone would yield hundreds of cloze
 * blanks, and an exam that drew half its questions from whichever document
 * happens to be longest would test that document rather than the corpus.
 */
const PER_DOC_PER_KIND = 12;

/** Token window a cloze candidate is drawn from — the reading engine's cadence. */
const CLOZE_WINDOW = 250;

/** Options offered on a multiple-choice question. */
const OPTIONS = 4;

/** Default length of an exam, and the seconds allowed per question. */
export const DEFAULT_QUESTIONS = 40;
export const SECONDS_PER_QUESTION = 45;

/** FNV-1a, as in `quiz.ts`: seeded ordering, never random ordering. */
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic shuffle: same items and same seed, same order. */
function shuffle<T>(items: T[], seed: string, key: (item: T) => string): T[] {
  return [...items].sort((a, b) => hash(seed + key(a)) - hash(seed + key(b)));
}

/** Expansion as it should be read as an answer, without a leading article. */
export function expansionOf(key: string): string {
  return (ACRONYMS[key]?.expansion ?? "").replace(/^the\s+/i, "");
}

/**
 * Build the acronym questions for one document.
 *
 * Only acronyms the document actually uses. A definition question about a term
 * that never appeared in anything the reader has read is a vocabulary quiz, not
 * an exam on this corpus.
 */
function acronymQuestions(
  doc: ParsedDoc,
  seed: string,
  limit: number = PER_DOC_PER_KIND
): AcronymQuestion[] {
  const present = new Set<string>();
  for (const token of doc.tokens) {
    if (token.acronym && ACRONYMS[token.acronym]) present.add(token.acronym);
  }

  const byCategory = new Map<AcronymCategory, string[]>();
  for (const [key, entry] of Object.entries(ACRONYMS)) {
    byCategory.set(entry.category, [...(byCategory.get(entry.category) ?? []), key]);
  }

  const out: AcronymQuestion[] = [];
  for (const key of shuffle([...present], seed + ":acr", (k) => k)) {
    const answer = expansionOf(key);
    if (!answer) continue;

    // Distractors from the same category first: "electronic data capture" against
    // three other systems is a question about the material, while the same answer
    // against three regulators is a question about reading the options.
    const category = ACRONYMS[key].category;
    const sameCategory = (byCategory.get(category) ?? []).filter((k) => k !== key);
    const anywhere = Object.keys(ACRONYMS).filter((k) => k !== key);
    const pool = sameCategory.length >= OPTIONS - 1 ? sameCategory : anywhere;

    const distractors = shuffle(pool, seed + key, (k) => k)
      .map(expansionOf)
      .filter((e) => e && e !== answer)
      .slice(0, OPTIONS - 1);
    if (distractors.length < OPTIONS - 1) continue;

    out.push({
      id: `${doc.id}:acronym:${key}`,
      kind: "acronym",
      docId: doc.id,
      docTitle: doc.title,
      acronym: key,
      prompt: `What does ${key} stand for?`,
      answer,
      options: shuffle([answer, ...distractors], seed + key + ":opt", (o) => o),
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Every acronym one document uses, uncapped.
 *
 * `PER_DOC_PER_KIND` exists so an exam is not dominated by whichever document
 * happens to be longest — a paper that drew half its questions from the GCDMP
 * would be testing the GCDMP rather than the corpus. A drill has the opposite
 * requirement: it *is* the vocabulary, and a term left out of it is the term
 * the reader meets on the day. Measured before this existed, the cap held the
 * drill to 30 acronyms where the corpus uses 50.
 */
export function collectAcronyms(doc: ParsedDoc, seed: string): AcronymQuestion[] {
  return acronymQuestions(doc, seed, Number.POSITIVE_INFINITY);
}

function clozeQuestions(doc: ParsedDoc, seed: string): ClozeQuestion[] {
  const out: ClozeQuestion[] = [];
  const seen = new Set<string>();

  for (let from = 0; from + CLOZE_WINDOW <= doc.tokens.length; from += CLOZE_WINDOW) {
    const check = buildCloze(doc, from, from + CLOZE_WINDOW);
    if (!check) continue;

    for (const blank of check.blanks) {
      // "Section ____ states that…" asks where a rule lives rather than what it
      // says. Tolerable as a spot check while reading, where the point is to
      // prove the reader is present; useless on a paper meant to predict an
      // exam result.
      if (isStructuralReference(blank.carrier, blank.answer)) continue;

      // One question per term per document: the same word blanked out of two
      // sentences is two ways of asking one thing, and an exam has better uses
      // for the second slot.
      const key = (blank.acronym ?? blank.answer).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({
        id: `${doc.id}:cloze:${blank.tokenIndex}`,
        kind: "cloze",
        docId: doc.id,
        docTitle: doc.title,
        section: doc.tokens[blank.tokenIndex]?.section,
        carrier: blank.carrier,
        answer: blank.answer,
        acronym: blank.acronym,
        tokenIndex: blank.tokenIndex,
      });
    }
    if (out.length >= PER_DOC_PER_KIND * 2) break;
  }

  return shuffle(out, seed + ":cloze", (q) => q.id).slice(0, PER_DOC_PER_KIND);
}

function gridQuestions(doc: ParsedDoc, seed: string): GridQuestion[] {
  const out: GridQuestion[] = [];

  for (const block of doc.blocks) {
    if (block.kind !== "table" || !block.steps?.length) continue;
    // Two cells per grid at most, and the second is a different cell by
    // construction — `attempt` is what varies which one is asked.
    for (let attempt = 0; attempt < 2; attempt++) {
      const q = buildGridQuestion(block, attempt);
      if (!q) break;
      out.push({
        id: `${doc.id}:grid:${block.i}:${q.stepIndex}`,
        kind: "grid",
        docId: doc.id,
        docTitle: doc.title,
        section: block.section,
        prompt: gridPrompt(q),
        answer: q.answer,
        options: q.options,
        blockIndex: q.blockIndex,
        row: q.row,
        column: q.column,
        caption: q.caption,
      });
    }
  }

  // Distinct cells only: a replay question and its original ask the same cell
  // when a grid has just one usable one.
  const unique = out.filter(
    (q, i) => out.findIndex((other) => other.id === q.id) === i
  );
  return shuffle(unique, seed + ":grid", (q) => q.id).slice(0, PER_DOC_PER_KIND);
}

/** Everything one document can offer. The document is not retained. */
export function collectQuestions(doc: ParsedDoc, seed: string): QuestionPool {
  return {
    docId: doc.id,
    docTitle: doc.title,
    acronym: acronymQuestions(doc, seed),
    cloze: clozeQuestions(doc, seed),
    grid: gridQuestions(doc, seed),
  };
}

/**
 * Assemble an acronym drill.
 *
 * Everything this needs already existed: `collectQuestions` builds acronym
 * definitions with same-category distractors, `acronymId` keys them by the term
 * alone, and the retrieval queue already carries an `acronym` kind. What did not
 * exist was a way to reach any of it without sitting a mixed forty-question
 * paper — so this is an ordering and a deduplication, not a feature.
 *
 * Two things it does that `assembleExam` deliberately does not:
 *
 *  - **Everything the corpus uses, not a sample.** An exam takes a share of
 *    each kind because it is predicting a result. A drill is the vocabulary
 *    itself, and leaving a term out of it is the term the reader will meet on
 *    the day.
 *  - **Worst first.** `weak` is the queue's own account of what is not
 *    sticking, keyed by term — the same map the reading spot checks consult. A
 *    drill that opened on the eight acronyms the reader has never missed is a
 *    drill that spends its first minute on the part already done.
 *
 * The same acronym is defined identically in every guideline that uses it, so
 * it is asked once and attributed to the first document that had it. Within a
 * weakness band the order is seeded rather than random, so a drill can be sat
 * twice and be the same drill.
 */
export function assembleDrill(
  perDocument: AcronymQuestion[][],
  weak: WeakTerms,
  seed: string
): AcronymQuestion[] {
  const byAcronym = new Map<string, AcronymQuestion>();
  for (const questions of perDocument) {
    for (const question of questions) {
      if (!byAcronym.has(question.acronym)) byAcronym.set(question.acronym, question);
    }
  }

  const unique = shuffle([...byAcronym.values()], seed + ":drill", (q) => q.acronym);
  // Descending difficulty, and the sort has to be stable to keep the seeded
  // order inside a band. Array.prototype.sort is stable in every engine this
  // runs on, so the shuffle above survives as the tie-break.
  const weightOf = (q: AcronymQuestion) =>
    weak[termKey(q.answer, q.acronym)]?.weight ?? 0;
  // Sorted descending directly rather than ascending-then-reversed: reversing
  // would also reverse the seeded order inside each band, which is the tie-break
  // the stability is there to preserve.
  return unique.sort((a, b) => weightOf(b) - weightOf(a));
}

const KINDS: ExamKind[] = ["acronym", "cloze", "grid"];

/**
 * What share of a paper each kind should be.
 *
 * Cloze takes the largest share because it is the hardest of the three and the
 * closest to what an exam actually asks: the term has to come back inside a
 * claim, not be recognised in a list. Acronyms are cheap to answer and cheap to
 * be caught out by, so they earn a solid share but not the paper. Grids get the
 * smallest because they are limited by how many tables a corpus contains at
 * all — most guidelines here have none.
 *
 * This exists because the first measured paper came out 23 acronym, 15 cloze,
 * 2 grid. The cause was scarcity, not weighting: a grid slot in a document with
 * no tables fell through to the next kind in list order, which is always
 * acronym, so every missing table became another acronym question. Choosing the
 * kind furthest below its target instead means a shortfall in one kind is made
 * up by whichever of the others is most owed.
 */
const TARGET_MIX: Record<ExamKind, number> = {
  cloze: 0.45,
  acronym: 0.35,
  grid: 0.2,
};

/**
 * Assemble the paper.
 *
 * Round-robin over documents and then over kinds, so a corpus of nine
 * guidelines is examined as nine guidelines rather than as whichever one has
 * the most extractable questions. Where a document runs out — a guideline with
 * no tables offers no grid questions at all — its slot passes to the next
 * rather than being left empty, so a short corpus still yields a full paper if
 * it has the material anywhere.
 */
export function assembleExam(
  pools: QuestionPool[],
  count: number,
  seed: string
): ExamQuestion[] {
  const cursors = new Map<string, Record<ExamKind, number>>();
  for (const pool of pools) {
    cursors.set(pool.docId, { acronym: 0, cloze: 0, grid: 0 });
  }

  const ordered = shuffle(pools, seed + ":docs", (p) => p.docId);
  const picked: ExamQuestion[] = [];
  /**
   * What has already been asked, by meaning rather than by id. The same
   * acronym is defined identically in every guideline that uses it, and a term
   * blanked in two documents is one fact — asking either twice in one paper
   * wastes a slot on a question already answered.
   */
  const asked = new Set<string>();
  const meaningOf = (q: ExamQuestion): string =>
    q.kind === "acronym"
      ? `acr:${q.acronym}`
      : q.kind === "cloze"
        ? `cloze:${(q.acronym ?? q.answer).toLowerCase()}`
        : `grid:${q.id}`;

  const taken: Record<ExamKind, number> = { acronym: 0, cloze: 0, grid: 0 };

  /** Candidates left in this pool for a kind, skipping anything already asked. */
  const advance = (pool: QuestionPool, kind: ExamKind): ExamQuestion | null => {
    const cursor = cursors.get(pool.docId);
    if (!cursor) return null;
    const list = pool[kind];
    while (cursor[kind] < list.length && asked.has(meaningOf(list[cursor[kind]]))) {
      cursor[kind] += 1;
    }
    return cursor[kind] < list.length ? list[cursor[kind]] : null;
  };

  let exhausted = false;
  while (picked.length < count && !exhausted) {
    exhausted = true;
    for (const pool of ordered) {
      if (picked.length >= count) break;

      // Whichever kind this pool can still offer is furthest below its share.
      const available = KINDS.map((kind) => ({ kind, next: advance(pool, kind) })).filter(
        (entry) => entry.next !== null
      );
      if (!available.length) continue;

      const owed = available.reduce((best, entry) => {
        const debt = (k: ExamKind) => TARGET_MIX[k] * (picked.length + 1) - taken[k];
        return debt(entry.kind) > debt(best.kind) ? entry : best;
      });

      const question = owed.next as ExamQuestion;
      picked.push(question);
      asked.add(meaningOf(question));
      taken[owed.kind] += 1;
      cursors.get(pool.docId)![owed.kind] += 1;
      exhausted = false;
    }
  }

  return picked;
}

/* ------------------------------------------------------------------ *
 * Marking
 * ------------------------------------------------------------------ */

export interface ExamAnswer {
  questionId: string;
  /** What the reader typed or chose. Empty when the question was left. */
  given: string;
  correct: boolean;
}

export interface ExamBreakdown {
  label: string;
  correct: number;
  total: number;
}

export interface ExamResult {
  questions: ExamQuestion[];
  answers: Map<string, ExamAnswer>;
  correct: number;
  total: number;
  /** Seconds actually spent. */
  elapsed: number;
  byDocument: ExamBreakdown[];
  byKind: ExamBreakdown[];
}

const KIND_LABEL: Record<ExamKind, string> = {
  acronym: "Acronyms",
  cloze: "Terms in context",
  grid: "Tables",
};

/** Score a finished paper, broken down the two ways that suggest what to read. */
export function scoreExam(
  questions: ExamQuestion[],
  answers: Map<string, ExamAnswer>,
  elapsed: number
): ExamResult {
  const tally = (
    keyOf: (q: ExamQuestion) => string,
    labelOf: (key: string) => string
  ): ExamBreakdown[] => {
    const rows = new Map<string, ExamBreakdown>();
    for (const q of questions) {
      const key = keyOf(q);
      const row = rows.get(key) ?? { label: labelOf(key), correct: 0, total: 0 };
      row.total += 1;
      if (answers.get(q.id)?.correct) row.correct += 1;
      rows.set(key, row);
    }
    // Worst first: the breakdown exists to say what to read next.
    return [...rows.values()].sort(
      (a, b) => a.correct / a.total - b.correct / b.total
    );
  };

  const titles = new Map(questions.map((q) => [q.docId, q.docTitle]));

  return {
    questions,
    answers,
    correct: questions.filter((q) => answers.get(q.id)?.correct).length,
    total: questions.length,
    elapsed,
    byDocument: tally(
      (q) => q.docId,
      (key) => titles.get(key) ?? "Unknown"
    ),
    byKind: tally(
      (q) => q.kind,
      (key) => KIND_LABEL[key as ExamKind]
    ),
  };
}

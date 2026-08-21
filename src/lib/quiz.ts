import { ACRONYMS, matchAcronym } from "./acronyms";
import type { Block, ParsedDoc, Token } from "./types";

/**
 * Deterministic comprehension checks.
 *
 * Everything here grades locally with no model call. That is the point: the AI
 * summary grader is optional and networked, so it can never be the thing that
 * holds the reader accountable moment to moment. A recovered grid and a blanked
 * term both have exactly one right answer already sitting in the parsed
 * document, and an answer the app can mark itself is an answer it can demand.
 */

/** Placeholder rendered in a cloze carrier sentence. */
export const BLANK = "____";

/* ------------------------------------------------------------------ *
 * Grid interrogation
 * ------------------------------------------------------------------ */

export interface GridQuestion {
  blockIndex: number;
  caption: string | null;
  row: string;
  column: string;
  /** Verbatim cell value from the grid. */
  answer: string;
  /** Answer plus distractors, in a stable shuffled order. */
  options: string[];
  /** Index into the block's steps, so a wrong answer can be replayed. */
  stepIndex: number;
}

/** Options offered at once. More than this is a reading test, not a recall one. */
const MAX_OPTIONS = 4;

/**
 * Fewest distractors worth asking with. Two options is a coin flip, which
 * proves nothing and teaches nothing.
 */
const MIN_DISTRACTORS = 2;

/**
 * FNV-1a. Used only to order multiple-choice options: the answer must not sit
 * in a predictable slot, but the same question must present identically every
 * time it is rebuilt, so this is seeded rather than random.
 */
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function tidy(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Build one multiple-choice question from a flattened grid.
 *
 * `attempt` selects which cell is asked about, so replaying a grid after a
 * wrong answer does not re-ask the same cell — the reader has to have taken the
 * whole matrix in rather than memorized one card.
 *
 * A step with no recovered column name is usable only when its row has exactly
 * one value. Otherwise "for this row, what was the value?" is ambiguous, and an
 * ambiguous question graded as wrong is worse than no question at all. This is
 * the same rule the flattener already applies to naming a column: never assert
 * a relationship the table did not state.
 */
export function buildGridQuestion(block: Block, attempt: number): GridQuestion | null {
  const steps = block.steps ?? [];
  if (!steps.length) return null;

  const rowCounts = new Map<string, number>();
  for (const step of steps) {
    const row = tidy(step.row);
    rowCounts.set(row, (rowCounts.get(row) ?? 0) + 1);
  }

  const usable = steps
    .map((step, stepIndex) => ({ step, stepIndex }))
    .filter(({ step }) => {
      if (!tidy(step.value)) return false;
      if (tidy(step.column)) return true;
      return rowCounts.get(tidy(step.row)) === 1;
    });

  if (!usable.length) return null;

  const picked = usable[attempt % usable.length];
  const answer = tidy(picked.step.value);
  const column = tidy(picked.step.column);
  const row = tidy(picked.step.row);

  // Distractors come from the same column first: a plausible wrong answer is
  // one the grid actually contains somewhere it could have gone.
  const sameColumn = new Set<string>();
  const anywhere = new Set<string>();
  for (const step of steps) {
    const value = tidy(step.value);
    if (!value || value === answer) continue;
    anywhere.add(value);
    if (column && tidy(step.column) === column) sameColumn.add(value);
  }

  const pool = sameColumn.size >= MIN_DISTRACTORS ? sameColumn : anywhere;
  if (pool.size < MIN_DISTRACTORS) return null;

  const seed = `${block.i}:${picked.stepIndex}:${attempt}`;
  const distractors = Array.from(pool)
    .sort((a, b) => hash(a + seed) - hash(b + seed))
    .slice(0, MAX_OPTIONS - 1);

  const options = [answer, ...distractors].sort(
    (a, b) => hash(seed + a) - hash(seed + b)
  );

  return {
    blockIndex: block.i,
    caption: block.grid?.caption ?? null,
    row,
    column,
    answer,
    options,
    stepIndex: picked.stepIndex,
  };
}

/** The question as one line, for the review queue and for screen readers. */
export function gridPrompt(question: {
  caption: string | null;
  row: string;
  column: string;
}): string {
  const where = question.caption ? `${question.caption} — ` : "";
  return question.column
    ? `${where}for “${question.row}”, what was the ${question.column}?`
    : `${where}what value did the grid give for “${question.row}”?`;
}

/* ------------------------------------------------------------------ *
 * Cloze checks
 * ------------------------------------------------------------------ */

export interface ClozeBlank {
  /** The sentence it came from, with the term replaced by BLANK. */
  carrier: string;
  /** Exactly the characters that were removed. */
  answer: string;
  /** Dictionary key when the answer is a recognised acronym. */
  acronym?: string;
  /** Position of the occurrence, so the reader can seek back to it. */
  tokenIndex: number;
}

export interface ClozeCheck {
  /** Token window this was drawn from. */
  from: number;
  to: number;
  blanks: ClozeBlank[];
}

/** Most blanks in one check. Beyond this it stops being the cheap rung. */
export const MAX_BLANKS = 3;

/**
 * Fewest blanks worth stopping for. One blank is a five-second check that still
 * costs a full interruption, which is the wrong trade.
 */
const MIN_BLANKS = 2;

/** A carrier shorter than this gives the reader nothing to reason from. */
const MIN_CARRIER_TOKENS = 6;

/**
 * Blocks a blank is never drawn from.
 *
 * Grids have their own deterministic check and code is never spoken at all, so
 * blanking either tests eyesight rather than recall. Headings are excluded for
 * a different reason: a heading is a label the reader heard announced, not a
 * claim they reasoned through, and removing a word from one asks them to
 * transcribe a title. Measured on the vendor-management PDF, where a recovered
 * citation line — "Amatya S, Edgerton D. Vendor Selection and ___." — was
 * offered as a blank before this rule existed.
 */
const EXCLUDED_BLOCKS = new Set(["table", "code", "h1", "h2", "h3"]);

/** Too short a window has not covered enough ground to ask about. */
const MIN_WINDOW_TOKENS = 20;

/**
 * Capitalized words that carry no content when they open a clause. Kept
 * deliberately short — over-filtering here silently drops real terms, and a
 * capitalized domain noun ("Sponsor", "Monitor") is exactly what should be
 * asked about.
 */
const CAPITALIZED_STOPWORDS = new Set([
  "the", "this", "that", "these", "those", "there", "then", "when", "where",
  "while", "which", "what", "who", "whom", "whose", "each", "every", "any",
  "all", "some", "both", "for", "from", "with", "without", "however",
  "therefore", "because", "although", "though", "since", "after", "before",
  "during", "under", "over", "into", "onto", "such", "they", "their", "them",
  "its", "his", "her", "our", "your", "and", "but", "not", "may", "must",
  "should", "would", "could", "will", "shall", "can", "has", "have", "had",
  "was", "were", "are", "been", "being", "section", "figure", "table",
  "chapter", "appendix", "note", "example",
]);

/** Punctuation shell around a token, mirroring the acronym matcher's split. */
const SHELL = /^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$/;

function shellOf(text: string): { lead: string; core: string } | null {
  const m = SHELL.exec(text);
  if (!m || !m[2]) return null;
  return { lead: m[1], core: m[2] };
}

/**
 * How much a term is worth blanking.
 *
 * A recognised acronym outranks everything: it is the vocabulary the material
 * is actually written in. Numbers come next — thresholds, timeframes and
 * regulation numbers are the facts a reader most reliably believes they
 * retained and most reliably did not. A capitalized mid-sentence word is a weak
 * signal and scores accordingly.
 */
function salience(doc: ParsedDoc, token: Token, core: string): number {
  if (token.acronym) return 10;

  // Evidence grades are shown but never spoken, so they were never heard.
  if (token.text.includes("[")) return 0;

  if (/\d/.test(core) && core.length >= 2) return 4;

  const sentenceStart = token.i === doc.chunks[token.chunk]?.tokenStart;
  if (sentenceStart) return 0;
  if (CAPITALIZED_STOPWORDS.has(core.toLowerCase())) return 0;

  if (/^[A-Z]{2,}$/.test(core)) return 5;
  if (/^[A-Z][a-z]{3,}$/.test(core)) return 3;

  return 0;
}

interface Candidate {
  key: string;
  score: number;
  occurrences: number[];
}

/**
 * Build a cloze check over the stretch of text just read.
 *
 * Scoped to a token window rather than to a section, because this is the cheap
 * rung of the ladder: it fires on a reading cadence, several times between the
 * full intercepts that fire on structure.
 */
export function buildCloze(
  doc: ParsedDoc,
  from: number,
  to: number,
  max: number = MAX_BLANKS
): ClozeCheck | null {
  const start = Math.max(0, Math.min(from, doc.tokens.length));
  const end = Math.max(start, Math.min(to, doc.tokens.length));
  if (end - start < MIN_WINDOW_TOKENS) return null;

  const byKey = new Map<string, Candidate>();

  for (let i = start; i < end; i++) {
    const token = doc.tokens[i];
    const block = doc.blocks[token.block];
    if (!block || EXCLUDED_BLOCKS.has(block.kind)) continue;

    const shell = shellOf(token.text);
    if (!shell) continue;

    const score = salience(doc, token, shell.core);
    if (score <= 0) continue;

    const key = token.acronym ?? shell.core.toLowerCase();
    const existing = byKey.get(key);
    if (existing) {
      existing.occurrences.push(i);
      // Repetition is itself evidence the term is load-bearing in this stretch.
      existing.score += score;
    } else {
      byKey.set(key, { key, score, occurrences: [i] });
    }
  }

  const ranked = Array.from(byKey.values()).sort((a, b) => b.score - a.score);
  const blanks: ClozeBlank[] = [];

  for (const candidate of ranked) {
    if (blanks.length >= max) break;
    const blank = carrierFor(doc, candidate);
    if (blank) blanks.push(blank);
  }

  if (blanks.length < MIN_BLANKS) return null;

  // Present them in reading order: the check should feel like the text it came
  // from, not like a ranked list.
  blanks.sort((a, b) => a.tokenIndex - b.tokenIndex);

  return { from: start, to: end, blanks };
}

/**
 * Find an occurrence of a candidate that yields an answerable blank.
 *
 * The load-bearing rule is the last one: if the term survives elsewhere in the
 * same sentence, the blank can be read straight off the page and tests nothing.
 */
function carrierFor(doc: ParsedDoc, candidate: Candidate): ClozeBlank | null {
  for (const tokenIndex of candidate.occurrences) {
    const token = doc.tokens[tokenIndex];
    const chunk = doc.chunks[token.chunk];
    if (!chunk) continue;
    if (EXCLUDED_BLOCKS.has(doc.blocks[token.block]?.kind)) continue;
    if (chunk.tokenEnd - chunk.tokenStart < MIN_CARRIER_TOKENS) continue;

    const shell = shellOf(token.text);
    if (!shell) continue;

    const at = token.offset + shell.lead.length;
    if (chunk.text.slice(at, at + shell.core.length) !== shell.core) continue;

    const carrier =
      chunk.text.slice(0, at) + BLANK + chunk.text.slice(at + shell.core.length);

    // Given away by another occurrence in the same sentence.
    if (carrier.includes(shell.core)) continue;

    return { carrier, answer: shell.core, acronym: token.acronym, tokenIndex };
  }

  return null;
}

/* ------------------------------------------------------------------ *
 * Grading
 * ------------------------------------------------------------------ */

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’']s\b/g, "")
    .replace(/[^a-z0-9%. ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/s$/, "");
}

/**
 * Mark one typed answer.
 *
 * An acronym's full expansion is accepted for the acronym itself. A reader who
 * writes "electronic case report form" where the page said "eCRF" has
 * demonstrated more than one who typed four letters, and the app speaks the
 * expansion rather than the letters — marking it wrong would punish having
 * listened.
 */
export function answerMatches(
  given: string,
  expected: string,
  acronym?: string
): boolean {
  const a = normalize(given);
  if (!a) return false;
  if (a === normalize(expected)) return true;

  const key = acronym ?? matchAcronym(expected)?.key;
  if (key && ACRONYMS[key]) {
    const expansion = ACRONYMS[key].expansion.replace(/^the\s+/i, "");
    if (a === normalize(expansion)) return true;
  }

  return false;
}

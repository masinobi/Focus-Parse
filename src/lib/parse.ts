import { matchAcronym, spokenForm } from "./acronyms";
import { flattenGrid, stepText, type GridData, type GridStep } from "./tables";
import {
  isSqlFence,
  sqlSpeechFor,
  stepsOfScript,
  stepText as sqlStepText,
  type SqlStep,
} from "./sql";
import type { Block, BlockKind, Chunk, ParsedDoc, Section, Token } from "./types";

/**
 * Utterances longer than this get split on a clause boundary. Chrome's
 * synthesis backend degrades (and on some platforms silently truncates) on long
 * strings, and long utterances also make sentence-skip feel unresponsive.
 */
const MAX_CHUNK_CHARS = 180;

/**
 * Bump whenever the emitted Token/Chunk/Section shape changes. Version 2 added
 * the separate speech string, per-token speech offsets and clause indices.
 * Version 4 marks journal furniture and records which sections are pacing
 * checkpoints of a larger one — both are on `Section`, and stored documents
 * have to be rebuilt to gain them.
 */
export const SCHEMA_VERSION = 6;

/**
 * Sections shorter than this do not arm a cognitive intercept. Stopping a
 * reader to summarize two sentences is friction without a payoff.
 */
const MIN_INTERCEPT_WORDS = 60;

/**
 * Longest stretch of reading allowed without an intercept. Documents whose
 * structure could not be recovered still get paced checkpoints.
 */
const MAX_STRETCH_WORDS = 700;

/** Trailing punctuation that closes a clause. */
const CLAUSE_BREAK = /[,;:]["'’”)\]]?$|[—–]$/;

/** Periods that do not end a sentence. */
const ABBREVIATIONS = new Set([
  "mr.", "mrs.", "ms.", "dr.", "prof.", "sr.", "jr.", "st.", "mt.",
  "vs.", "etc.", "e.g.", "i.e.", "cf.", "al.", "fig.", "no.", "vol.",
  "inc.", "ltd.", "co.", "corp.", "dept.", "est.", "approx.", "ca.",
  "jan.", "feb.", "mar.", "apr.", "jun.", "jul.", "aug.", "sep.", "sept.",
  "oct.", "nov.", "dec.", "u.s.", "u.k.", "a.m.", "p.m.", "ph.d.",
]);

/**
 * In-text reference markers.
 *
 * These are noise in both channels: they clutter the line, and the synthesizer
 * reads them aloud, so "time stamps.13" becomes "time stamps thirteen". PDF
 * extraction removes them geometrically where it can (a raised baseline is
 * unambiguous); these patterns catch what arrives as plain text — pasted
 * articles, markdown, and markers set inline rather than superscript.
 */

/**
 * Bracketed numeric citations: [13], [13,14], [8-10].
 *
 * Deliberately numeric-only. Bracketed roman numerals are left alone because in
 * GCDMP guidance they are evidence-grade markers — [I], [II], [III] state how
 * strong the backing for a recommendation is, which is content, not clutter.
 */
const CITATION_BRACKET = /\[\s*\d{1,3}(?:\s*[,;–—-]\s*\d{1,3})*\s*\]/g;

/**
 * Digits fused to the end of a sentence: `stamps.13`, `data."8,19`.
 *
 * Anchored on a *letter* before the punctuation, so decimals and regulation
 * numbers — 312.62, 21 CFR 11.10 — are never touched. The trailing lookahead
 * is what keeps it away from dotted identifiers: in a DOI like
 * `journal.pone.0083049` the run after `e.` is followed by more digits, and
 * without the guard this rule would quietly eat three of them.
 */
const CITATION_GLUED =
  /([A-Za-z][.!?]["'’”)\]]?)\d{1,3}(?:\s*[,;–—-]\s*\d{1,3})*(?![./\w])/g;

/** URL-ish context in which a trailing digit run is part of an identifier. */
const URL_CONTEXT = /https?:\/\/|doi\.org|www\.|\/\S*$/;

/**
 * The lookahead in CITATION_GLUED stops the rule mid-identifier, but it cannot
 * see a DOI that *ends* in one — `10.47912/jscdm.411` looks exactly like a
 * sentence followed by a marker. Checking the preceding characters for a URL
 * settles it.
 */
function stripGluedCitation(
  match: string,
  keep: string,
  offset: number,
  full: string
): string {
  const before = full.slice(Math.max(0, offset - 40), offset);
  return URL_CONTEXT.test(before) ? match : keep;
}

/**
 * Evidence grades are shown but never spoken.
 *
 * "[III]" is meaningful on the page — it states how strong the backing for a
 * recommendation is — but read aloud it lands as a bare "three" in the middle
 * of a paragraph and derails the sentence. Any trailing punctuation is kept so
 * the synthesizer still gets its sentence-ending pause.
 */
const EVIDENCE_GRADE = /\[[IVXLCDM]{1,6}\]/g;

/**
 * What the synthesizer is given for one displayed token.
 *
 * The grade is matched anywhere in the token rather than as the whole of it,
 * because it is not always spaced off: "patient.[III]" is one token, and an
 * anchored pattern silently misses it.
 */
function speechFor(token: string): string {
  const stripped = gradeless(token);
  return stripped ? spokenForm(stripped) : "";
}

/** Everything `speechFor` does except expanding the acronym. */
function gradeless(token: string): string {
  return (
    token
      .replace(EVIDENCE_GRADE, "")
      // "patient.[III]." would otherwise leave a doubled terminator.
      .replace(/([.,;:])\1+$/, "$1")
  );
}

/**
 * What a grid cell is given to the synthesizer.
 *
 * Prose expands an acronym for the ear on purpose — hearing "electronic case
 * report form" inside a sentence is the whole reason invariant 1 exists. A grid
 * card is not a sentence. It shows one cell, alone, in the largest type in the
 * app, and says a different string than the one on screen: the eye reads `CRF`
 * while the ear hears "case report form".
 *
 * The argument that settles it is not comfort, it is the check that follows.
 * `buildGridQuestion` draws its answer from the raw cell value, so the reader
 * studies "case report form" and is then asked to pick `CRF` out of four
 * options. The study channel and the test channel disagreed.
 *
 * The evidence-grade stripping stays — that is about not reading `[III]` aloud
 * and has nothing to do with acronyms.
 */
function gridSpeechFor(token: string): string {
  return gradeless(token);
}

/** Traditional reference symbols fused to a word: `Smith†`, `method‡`. */
const CITATION_SYMBOL = /([A-Za-z])[*†‡§¶‖]+/g;

/** Strip inline markdown so the spoken string equals the rendered string. */
function cleanInline(input: string): string {
  return input
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<\/?[a-zA-Z][^>]*>/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*\*|___)(.+?)\1/g, "$2")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)(?=\S)(.+?)(?<=\S)\1/g, "$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(CITATION_BRACKET, "")
    .replace(CITATION_GLUED, stripGluedCitation)
    .replace(CITATION_SYMBOL, "$1")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function isSentenceStart(rest: string): boolean {
  return /^["'“‘([]?[A-Z0-9]/.test(rest);
}

/**
 * Sentence segmentation tuned for prose read aloud: tolerant of abbreviations,
 * initials, decimals and quoted terminators.
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== "." && ch !== "!" && ch !== "?") continue;

    // Absorb runs of terminators and any closing quote/bracket after them.
    let end = i;
    while (end + 1 < text.length && /[.!?"'’”)\]]/.test(text[end + 1])) end++;

    const next = text[end + 1];
    if (next === undefined) break;
    if (!/\s/.test(next)) {
      i = end;
      continue;
    }

    const candidate = text.slice(start, end + 1).trim();
    const lastWord = (candidate.split(/\s+/).pop() ?? "").toLowerCase();

    if (ch === ".") {
      if (ABBREVIATIONS.has(lastWord)) {
        i = end;
        continue;
      }
      // Single-letter initials: "J. R. R. Tolkien".
      if (/^[a-z]\.$/.test(lastWord)) {
        i = end;
        continue;
      }
    }

    const rest = text.slice(end + 1).replace(/^\s+/, "");
    if (rest && !isSentenceStart(rest)) {
      i = end;
      continue;
    }

    if (candidate) out.push(candidate);
    start = end + 1;
    i = end;
  }

  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

/** Break an over-long sentence at the latest clause boundary that fits. */
function capLength(sentence: string, max = MAX_CHUNK_CHARS): string[] {
  if (sentence.length <= max) return [sentence];

  const parts: string[] = [];
  let rest = sentence;

  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = Math.max(
      window.lastIndexOf("; "),
      window.lastIndexOf(", "),
      window.lastIndexOf(" — "),
      window.lastIndexOf(" – ")
    );
    if (cut > max * 0.4) {
      cut += 1;
    } else {
      cut = window.lastIndexOf(" ");
      if (cut <= 0) cut = max;
    }
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }

  if (rest) parts.push(rest);
  return parts.filter(Boolean);
}

function headingLevel(line: string): 1 | 2 | 3 | null {
  const m = /^(#{1,6})\s+\S/.exec(line);
  if (!m) return null;
  const n = m[1].length;
  return n === 1 ? 1 : n === 2 ? 2 : 3;
}

function slugId(): string {
  return `doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

interface PendingBlock {
  kind: BlockKind;
  text: string;
  raw?: string;
  ordinal?: number;
  grid?: GridData;
  steps?: GridStep[];
  sqlSteps?: SqlStep[];
}

/**
 * Fence info string that PDF extraction uses to hand a recovered grid through
 * the markdown intermediate. Routing it through markdown rather than a side
 * channel keeps `source` a complete record, so schema migration can rebuild a
 * document without re-reading the original file.
 */
const GRID_FENCE = "fp-grid";

/** Grid payloads come from our own extractor, but parse defensively anyway. */
function readGridPayload(json: string): GridData | null {
  try {
    const value = JSON.parse(json) as GridData;
    if (!value || !Array.isArray(value.rows) || !Array.isArray(value.header)) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}


interface Seed {
  title: string;
  level: 0 | 1 | 2 | 3;
  blockStart: number;
  baseTitle?: string;
  part?: number;
}

/* ------------------------------------------------------------------ *
 * Journal furniture
 * ------------------------------------------------------------------ *
 *
 * A published guidance chapter is not only guidance. It opens with a citation
 * line, an author list and an abstract that restates the whole chapter before
 * the reader has read it, and it closes with a revision history, a competing
 * interests declaration and a bibliography. Measured on the EDC
 * implementation chapter: about 2,400 of its 20,290 words — roughly ten
 * minutes of listening — are one of those, and none of it is examinable.
 *
 * Worse than the time, the reader reported the chapter as "repetitive". It is
 * not: six of its 1,351 sentences repeat verbatim. What repeats is the
 * abstract saying in advance what the chapter then says.
 */

/**
 * Section titles that end the document proper. Anchored at the start so a
 * heading that merely *mentions* references — "27) Literature Review" — is
 * left alone; it is the chapter's own methodology, not its back matter.
 */
const TRAILING_FURNITURE =
  /^(references?|bibliography|works cited|revision history|competing interests?|conflicts? of interest|acknowledge?ments?|funding|author contributions?|open access|copyright|about the authors?|disclaimer)\b/i;

/** How far into a document front matter can still plausibly be. */
const FRONT_MATTER_SECTIONS = 6;

/**
 * An author list or a self-citation, used as a heading.
 *
 * Two signals only, both of which prose does not produce. A citation marker
 * (`et al.`, a DOI, a URL) in a *heading* is a self-citation line. And PDF
 * extraction runs author lists together where the original had line breaks —
 * "Redkar-Brown,Olivia", "Kerkar andMeredith" — which no sentence does.
 *
 * A third rule was written and then measured out: "three or more capitalized
 * words with a separator" also matches an author list, but it matches "Data
 * Management and Quality Control" just as well. Across the whole corpus it
 * found 452 further words — 0.18% — and changed nothing at all in the document
 * that prompted this work. That is not worth a rule that can swallow a real
 * heading.
 */
function looksLikeFrontMatter(title: string): boolean {
  if (/\bet al\b|\bdoi\b|https?:/i.test(title)) return true;
  return /[a-z],[A-Z]|\band[A-Z]/.test(title);
}

/** Which sections are the artefact rather than the guidance. */
function markFurniture(sections: Section[]): Section[] {
  return sections.map((section) => {
    const title = section.title.trim();
    const furniture =
      TRAILING_FURNITURE.test(title) ||
      (section.i < FRONT_MATTER_SECTIONS && looksLikeFrontMatter(title));
    // A section playback will never reach on its own must not also demand a
    // summary of itself. Seeking into the references deliberately is allowed;
    // being asked to restate them is not.
    return furniture ? { ...section, furniture: true, intercept: false } : section;
  });
}

/** Words the engine will actually read: everything outside the furniture. */
export function contentWordCount(doc: ParsedDoc): number {
  return doc.sections.reduce(
    (n, section) => n + (section.furniture ? 0 : section.wordCount),
    0
  );
}

/** First token the engine should start on: past any opening furniture. */
export function firstContentToken(doc: ParsedDoc): number {
  const section = doc.sections.find((s) => !s.furniture && s.wordCount > 0);
  return section ? section.tokenStart : 0;
}

/**
 * Insert synthetic section boundaries so a document can never run for too long
 * without a cognitive intercept.
 *
 * Heading recovery is reliable in markdown and best-effort in PDFs, where a
 * heading may be smaller than the body text or absent entirely. Rather than let
 * the core mechanism depend on that, any stretch longer than
 * `MAX_STRETCH_WORDS` is divided at paragraph boundaries. The synthetic
 * sections are ordinary sections, so the structure map, intercepts and stored
 * summaries all work on them unchanged.
 */
function withPacingCheckpoints(
  seeds: Seed[],
  blockWords: number[],
  blockCount: number
): Seed[] {
  const out: Seed[] = [];

  seeds.forEach((seed, i) => {
    const seedAt = out.length;
    out.push(seed);

    const start = seed.blockStart;
    const end = i + 1 < seeds.length ? seeds[i + 1].blockStart : blockCount;

    let words = 0;
    let part = 1;

    for (let b = start; b < end; b++) {
      words += blockWords[b] ?? 0;
      if (words < MAX_STRETCH_WORDS || b + 1 >= end) continue;

      // Only break where a paragraph ends, never mid-thought.
      part += 1;
      const base = seed.title || "Section";
      out.push({
        title: `${base} (part ${part})`,
        level: 2,
        blockStart: b + 1,
        baseTitle: base,
        part,
      });
      // The heading these were split out of is part 1 of the same run, and the
      // structure map needs to know that to fold them back together. Written
      // by position: the seed object has already been replaced once by the
      // time a second part is cut, so searching for it would miss.
      out[seedAt] = { ...seed, baseTitle: base, part: 1 };
      words = 0;
    }
  });

  return out;
}

/**
 * Parse markdown (or plain text) into the aligned block/chunk/token model that
 * drives both the synthesizer and the visual pacer.
 */
export function parseDocument(source: string, fileName?: string): ParsedDoc {
  const normalized = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");

  const pending: PendingBlock[] = [];
  const sectionSeeds: { title: string; level: 0 | 1 | 2 | 3; blockStart: number }[] = [];

  let paragraph: string[] = [];
  let inFence = false;
  let fenceInfo = "";
  let fence: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const text = cleanInline(paragraph.join(" "));
    paragraph = [];
    if (text) pending.push({ kind: "p", text });
  };

  for (const line of lines) {
    const fenceMark = /^\s*(?:```|~~~)\s*(\S*)/.exec(line);
    if (fenceMark) {
      if (inFence) {
        if (fenceInfo === GRID_FENCE) {
          const grid = readGridPayload(fence.join("\n"));
          if (grid) {
            const steps = flattenGrid(grid);
            if (steps.length) {
              pending.push({ kind: "table", text: "", grid, steps });
            }
          }
        } else {
          const raw = fence.join("\n");
          // A SQL fence is the one code block that *is* spoken, because the
          // order a query is written in is not the order it runs in, and that
          // is the whole thing worth teaching about one. Steps are cut here
          // rather than at render time so `source` stays the only input a
          // rebuild needs — invariant 19.
          const sqlSteps = isSqlFence(fenceInfo) ? stepsOfScript(raw) : undefined;
          pending.push({
            kind: "code",
            text: "",
            raw,
            sqlSteps: sqlSteps?.length ? sqlSteps : undefined,
          });
        }
        fence = [];
        inFence = false;
        fenceInfo = "";
      } else {
        flushParagraph();
        inFence = true;
        fenceInfo = fenceMark[1] ?? "";
      }
      continue;
    }
    if (inFence) {
      fence.push(line);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    const level = headingLevel(line);
    if (level) {
      flushParagraph();
      const title = cleanInline(line.replace(/^#{1,6}\s+/, "").replace(/\s+#+\s*$/, ""));
      sectionSeeds.push({ title, level, blockStart: pending.length });
      pending.push({ kind: `h${level}` as BlockKind, text: title });
      continue;
    }

    // Setext-style underlines: promote the previous single line to a heading.
    if (/^\s*(={3,}|-{3,})\s*$/.test(line) && paragraph.length === 1) {
      const setext: 1 | 2 = line.trim().startsWith("=") ? 1 : 2;
      const title = cleanInline(paragraph[0]);
      paragraph = [];
      sectionSeeds.push({ title, level: setext, blockStart: pending.length });
      pending.push({ kind: `h${setext}` as BlockKind, text: title });
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      const text = cleanInline(bullet[1]);
      if (text) pending.push({ kind: "li", text });
      continue;
    }

    const ordered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (ordered) {
      flushParagraph();
      const text = cleanInline(ordered[2]);
      if (text) pending.push({ kind: "li", text, ordinal: Number(ordered[1]) });
      continue;
    }

    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      flushParagraph();
      const text = cleanInline(quote[1]);
      if (text) pending.push({ kind: "quote", text });
      continue;
    }

    paragraph.push(line.trim());
  }

  if (inFence && fence.length) {
    const raw = fence.join("\n");
    const sqlSteps = isSqlFence(fenceInfo) ? stepsOfScript(raw) : undefined;
    pending.push({
      kind: "code",
      text: "",
      raw,
      sqlSteps: sqlSteps?.length ? sqlSteps : undefined,
    });
  }
  flushParagraph();

  // Build blocks, chunks and tokens in one aligned pass. Section ownership is
  // resolved afterwards, because synthetic section boundaries depend on the
  // word counts that only exist once tokenizing is done.
  const blocks: Block[] = [];
  const chunks: Chunk[] = [];
  const tokens: Token[] = [];
  let clauseIndex = 0;

  pending.forEach((p, b) => {
    const block: Block = {
      i: b,
      kind: p.kind,
      section: 0,
      chunks: [],
      text: p.text,
      raw: p.raw,
      ordinal: p.ordinal,
      grid: p.grid,
      steps: p.steps,
      sqlSteps: p.sqlSteps,
    };

    /**
     * A grid contributes one chunk per flattened step, so each step is its own
     * utterance and the gaps between them are real sentence boundaries rather
     * than pauses the engine has to fake. Display and speech text are identical
     * here, which keeps the token/offset machinery unchanged — the card UI
     * renders from `steps`, so nothing is lost by it.
     */
    /**
     * A SQL block is spoken the same way a grid is — one chunk per step, so the
     * gap between two clauses is a real utterance boundary rather than a pause
     * the engine has to fake. Its tokens are voiced through `sqlSpeechFor`
     * instead, because `p.PATIENT_ID` read literally is "p dot patient
     * underscore i d" on every voice measured, and a step nobody can listen to
     * is a step that is only being looked at.
     */
    const sqlBlock = p.kind === "code" && p.sqlSteps?.length ? p.sqlSteps : null;

    const pieces: string[] = [];
    /**
     * For a SQL block, which step each piece belongs to.
     *
     * A clause is a unit of *evaluation* and not of breath: the feasibility
     * screen's main `WHERE`, with its two `EXISTS` predicates, is 1,241
     * characters — one correct step and seven times the chunk cap that exists
     * to dodge the synthesizer's long-utterance truncation. Found by running
     * `scan-sql` over the reader's real scripts; a unit test on a four-line
     * query would never have produced one.
     *
     * So a long clause becomes several chunks that are all still *one step*.
     * Cutting the clause instead would mean the step boundaries stopped meaning
     * what this feature claims they mean, which is the whole product.
     */
    const chunkStep: number[] = [];
    /** Aligned with `block.chunks`, so the renderer can map either way. */
    const stepOfChunk: number[] = [];

    if (p.kind === "table") {
      pieces.push(...(p.steps ?? []).map(stepText));
    } else if (sqlBlock) {
      sqlBlock.forEach((step, s) => {
        for (const part of capLength(sqlStepText(step))) {
          pieces.push(part);
          chunkStep.push(s);
        }
      });
    } else if (!(p.kind === "code" || !p.text)) {
      pieces.push(...splitSentences(p.text).flatMap((s) => capLength(s)));
    }

    {
      for (let pi = 0; pi < pieces.length; pi++) {
        const piece = pieces[pi];
        const chunkIndex = chunks.length;
        const tokenStart = tokens.length;

        // The spoken string is assembled alongside the tokens so every token
        // knows where it lands in the utterance, even when an acronym expands
        // from four characters to forty.
        let speech = "";

        for (const m of Array.from(piece.matchAll(/\S+/g))) {
          const raw = m[0];
          const spoken = sqlBlock
            ? sqlSpeechFor(raw)
            : p.kind === "table"
              ? gridSpeechFor(raw)
              : speechFor(raw);

          // A silent token contributes no separator either, so it leaves no gap
          // in the utterance. Its offset then coincides with the next token's,
          // and the boundary search resolves forward — the caret steps over it
          // rather than dwelling on a word that is never voiced.
          if (spoken && speech && !/^[.,;:]/.test(spoken)) speech += " ";
          const speechOffset = speech.length;
          speech += spoken;

          tokens.push({
            i: tokens.length,
            text: raw,
            offset: m.index ?? 0,
            speechOffset,
            chunk: chunkIndex,
            block: b,
            section: 0,
            clause: clauseIndex,
            // Acronym badges are suppressed inside SQL. `SET`, `ID` and `CRO`
            // are column names here, not the terms the dictionary means, and a
            // badge that expands one is worse than no badge.
            //
            // A grid keeps its tag. Only the *speech* stops expanding there:
            // the tag is what feeds the corpus index, the acronym drill and
            // cloze weighting, and dropping it would quietly remove every grid
            // cell from all three.
            acronym: sqlBlock ? undefined : matchAcronym(raw)?.key,
          });

          // A clause ends at a comma, semicolon, colon or dash.
          if (CLAUSE_BREAK.test(raw)) clauseIndex += 1;
        }

        if (tokens.length === tokenStart) continue;

        // Every sentence starts a new clause, whatever its punctuation.
        clauseIndex += 1;

        chunks.push({
          i: chunkIndex,
          text: piece,
          speech,
          block: b,
          section: 0,
          tokenStart,
          tokenEnd: tokens.length,
        });
        block.chunks.push(chunkIndex);
        // Written here rather than alongside `pieces`, so a piece that yielded
        // no tokens leaves no entry and the two arrays stay the same length.
        if (sqlBlock) stepOfChunk.push(chunkStep[pi]);
      }
    }

    if (sqlBlock && stepOfChunk.length) block.sqlStepOfChunk = stepOfChunk;

    blocks.push(block);
  });

  const blockWords = blocks.map((b) =>
    b.chunks.reduce((n, c) => n + (chunks[c].tokenEnd - chunks[c].tokenStart), 0)
  );

  type Seed = { title: string; level: 0 | 1 | 2 | 3; blockStart: number };

  const hasPreamble = sectionSeeds.length === 0 || sectionSeeds[0].blockStart > 0;
  const headingSeeds: Seed[] = hasPreamble
    ? [{ title: "Opening", level: 0, blockStart: 0 }, ...sectionSeeds]
    : [...sectionSeeds];

  const seeds = withPacingCheckpoints(headingSeeds, blockWords, blocks.length);

  // Resolve section ownership now that the final boundary list is known.
  const sectionOfBlock: number[] = [];
  for (let b = 0; b < blocks.length; b++) {
    let idx = 0;
    for (let sIdx = 0; sIdx < seeds.length; sIdx++) {
      if (seeds[sIdx].blockStart <= b) idx = sIdx;
      else break;
    }
    sectionOfBlock[b] = idx;
  }

  for (const block of blocks) block.section = sectionOfBlock[block.i] ?? 0;
  for (const chunk of chunks) chunk.section = sectionOfBlock[chunk.block] ?? 0;
  for (const token of tokens) token.section = sectionOfBlock[token.block] ?? 0;

  const built: Section[] = seeds.map((seed, i) => {
    const blockStart = seed.blockStart;
    const blockEnd = i + 1 < seeds.length ? seeds[i + 1].blockStart : blocks.length;
    const owned = chunks.filter((c) => c.block >= blockStart && c.block < blockEnd);
    const tokenStart = owned.length ? owned[0].tokenStart : tokens.length;
    const tokenEnd = owned.length ? owned[owned.length - 1].tokenEnd : tokenStart;
    return {
      i,
      title: seed.title || "Untitled section",
      level: seed.level,
      blockStart,
      blockEnd,
      chunkStart: owned.length ? owned[0].i : chunks.length,
      tokenStart,
      tokenEnd,
      wordCount: tokenEnd - tokenStart,
      // A section too short to have said anything is not worth summarizing.
      // This also absorbs stacked headers and the occasional false heading
      // recovered from PDF typography.
      intercept:
        (seed.level === 1 || seed.level === 2) &&
        tokenEnd - tokenStart >= MIN_INTERCEPT_WORDS,
      ...(seed.baseTitle ? { baseTitle: seed.baseTitle, part: seed.part } : {}),
    };
  });

  const sections = markFurniture(built);

  const firstHeading = sectionSeeds[0]?.title;
  const title =
    (fileName ? fileName.replace(/\.(md|markdown|txt|pdf)$/i, "") : "") ||
    firstHeading ||
    "Untitled document";

  return {
    id: slugId(),
    schema: SCHEMA_VERSION,
    title,
    source: normalized,
    blocks,
    chunks,
    tokens,
    sections,
    wordCount: tokens.length,
    createdAt: Date.now(),
  };
}

/**
 * Binary search: which token owns this utterance-relative character index.
 *
 * Searches `speechOffset`, because the index reported by a boundary event is
 * relative to the string that was spoken — which is longer than the displayed
 * text wherever an acronym was expanded.
 */
export function tokenAtCharIndex(
  doc: ParsedDoc,
  chunkIndex: number,
  charIndex: number,
  /** False for a legacy document being read from its display text. */
  useSpeechOffsets = true
): number {
  const chunk = doc.chunks[chunkIndex];
  if (!chunk) return -1;

  let lo = chunk.tokenStart;
  let hi = chunk.tokenEnd - 1;
  let found = chunk.tokenStart;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const token = doc.tokens[mid];
    const at = useSpeechOffsets ? (token.speechOffset ?? token.offset) : token.offset;
    if (at <= charIndex) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** Split a word into its bionic lead and tail (letters only, ~45% lead). */
export function bionicSplit(word: string): [string, string] {
  const firstLetter = word.search(/[A-Za-zÀ-ɏ]/);
  if (firstLetter === -1) return [word, ""];

  let lettersEnd = firstLetter;
  while (lettersEnd < word.length && /[A-Za-zÀ-ɏ'’-]/.test(word[lettersEnd])) {
    lettersEnd++;
  }

  const letters = lettersEnd - firstLetter;
  const lead = letters <= 3 ? 1 : Math.max(1, Math.round(letters * 0.45));
  const cut = firstLetter + lead;
  return [word.slice(0, cut), word.slice(cut)];
}

/** Optimal recognition point for RSVP: the pivot letter the eye fixates on. */
export function orpIndex(word: string): number {
  const letters = word.replace(/[^A-Za-z0-9À-ɏ]/g, "");
  const n = letters.length;
  const pivot = n <= 1 ? 0 : n <= 5 ? 1 : n <= 9 ? 2 : 3;
  let seen = 0;
  for (let i = 0; i < word.length; i++) {
    if (/[A-Za-z0-9À-ɏ]/.test(word[i])) {
      if (seen === pivot) return i;
      seen++;
    }
  }
  return 0;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s}s`;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

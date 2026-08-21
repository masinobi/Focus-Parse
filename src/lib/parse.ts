import { matchAcronym, spokenForm } from "./acronyms";
import type { Block, BlockKind, Chunk, ParsedDoc, Section, Token } from "./types";

/**
 * Utterances longer than this get split on a clause boundary. Chrome's
 * synthesis backend degrades (and on some platforms silently truncates) on long
 * strings, and long utterances also make sentence-skip feel unresponsive.
 */
const MAX_CHUNK_CHARS = 180;

/**
 * Bump whenever the emitted Token/Chunk shape changes. Version 2 added the
 * separate speech string, per-token speech offsets and clause indices.
 */
export const SCHEMA_VERSION = 2;

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
  seeds: { title: string; level: 0 | 1 | 2 | 3; blockStart: number }[],
  blockWords: number[],
  blockCount: number
): { title: string; level: 0 | 1 | 2 | 3; blockStart: number }[] {
  const out: { title: string; level: 0 | 1 | 2 | 3; blockStart: number }[] = [];

  seeds.forEach((seed, i) => {
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
      out.push({
        title: `${seed.title || "Section"} (part ${part})`,
        level: 2,
        blockStart: b + 1,
      });
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
  let fence: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const text = cleanInline(paragraph.join(" "));
    paragraph = [];
    if (text) pending.push({ kind: "p", text });
  };

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      if (inFence) {
        pending.push({ kind: "code", text: "", raw: fence.join("\n") });
        fence = [];
        inFence = false;
      } else {
        flushParagraph();
        inFence = true;
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
    pending.push({ kind: "code", text: "", raw: fence.join("\n") });
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
    };

    if (p.kind !== "code" && p.text) {
      const pieces = splitSentences(p.text).flatMap((s) => capLength(s));
      for (const piece of pieces) {
        const chunkIndex = chunks.length;
        const tokenStart = tokens.length;

        // The spoken string is assembled alongside the tokens so every token
        // knows where it lands in the utterance, even when an acronym expands
        // from four characters to forty.
        let speech = "";

        for (const m of Array.from(piece.matchAll(/\S+/g))) {
          const raw = m[0];
          if (speech) speech += " ";
          const speechOffset = speech.length;
          speech += spokenForm(raw);

          tokens.push({
            i: tokens.length,
            text: raw,
            offset: m.index ?? 0,
            speechOffset,
            chunk: chunkIndex,
            block: b,
            section: 0,
            clause: clauseIndex,
            acronym: matchAcronym(raw)?.key,
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
      }
    }

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

  const sections: Section[] = seeds.map((seed, i) => {
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
    };
  });

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

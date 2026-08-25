import type { GridData, GridStep } from "./tables";

export type LogicTag = "entity" | "mechanism" | "output";

export type ViewMode = "standard" | "bionic" | "rsvp";

export type BlockKind =
  | "h1"
  | "h2"
  | "h3"
  | "p"
  | "li"
  | "quote"
  | "code"
  | "table";

/**
 * One spoken word. `offset` is the character index of the word *inside its own
 * chunk*, which is exactly the coordinate space `SpeechSynthesisUtterance`
 * reports through `onboundary` events. That equivalence is what makes
 * word-level highlighting exact rather than interpolated.
 */
export interface Token {
  i: number;
  text: string;
  offset: number;
  /**
   * Offset of this token inside its chunk's *spoken* string, which diverges
   * from the displayed string wherever an acronym is expanded for the ear.
   * Boundary events are resolved against this, not `offset`.
   */
  speechOffset: number;
  chunk: number;
  block: number;
  section: number;
  /** Global clause index, used by the clause spotlight. */
  clause: number;
  /** Dictionary key when this token is a recognised acronym. */
  acronym?: string;
}

/**
 * A single utterance handed to the synthesizer: one sentence, hard-capped in
 * length. Small chunks keep sentence-skipping responsive and dodge the
 * long-utterance truncation bugs in Chrome's synthesis backend.
 */
export interface Chunk {
  i: number;
  text: string;
  /**
   * What is actually uttered. Equal to `text` unless the chunk contains an
   * acronym, which is expanded so the ear hears the full term.
   */
  speech: string;
  block: number;
  section: number;
  tokenStart: number;
  /** exclusive */
  tokenEnd: number;
}

export interface Block {
  i: number;
  kind: BlockKind;
  section: number;
  chunks: number[];
  /** Cleaned, whitespace-normalized text. Empty for code blocks. */
  text: string;
  /** Verbatim payload for code blocks (never spoken). */
  raw?: string;
  ordinal?: number;
  /** Recovered grid, for `table` blocks. */
  grid?: GridData;
  /** The grid flattened into one step per chunk, aligned with `chunks`. */
  steps?: GridStep[];
}

export interface Section {
  i: number;
  title: string;
  level: 0 | 1 | 2 | 3;
  blockStart: number;
  blockEnd: number;
  chunkStart: number;
  tokenStart: number;
  /** exclusive */
  tokenEnd: number;
  wordCount: number;
  /** Level 1 and 2 headers arm a hard cognitive intercept. */
  intercept: boolean;
  /**
   * Journal furniture: an author list, an abstract, a reference list, a
   * revision history. Part of the published artefact, not of the guidance.
   *
   * Marked rather than removed. Detection is a heuristic over recovered PDF
   * typography, and silently deleting text on a heuristic is how a real section
   * disappears without anyone noticing. Everything marked here is still
   * present, still in the structure map, and still reachable by seeking to it —
   * what changes is that playback will not *wander* into it and the question
   * builders will not draw from it.
   */
  furniture?: boolean;
  /**
   * Set on the synthetic sections that pacing checkpoints create. `baseTitle`
   * is the heading they were split out of and `part` is which slice this is,
   * so the structure map can present six checkpoints of one section as one
   * section rather than as six repeats of the same title.
   */
  baseTitle?: string;
  part?: number;
}

export interface ParsedDoc {
  id: string;
  /**
   * Shape version. Stored documents are re-parsed from `source` when this does
   * not match the parser's current version — the token/chunk model has changed
   * before and will again, and a stale shape must never reach the engine.
   */
  schema: number;
  title: string;
  source: string;
  blocks: Block[];
  chunks: Chunk[];
  tokens: Token[];
  sections: Section[];
  wordCount: number;
  createdAt: number;
}

export interface FlowNode {
  id: string;
  tag: LogicTag | null;
  text: string;
  /** Section the reader was in when the node was captured. */
  section: number;
  tokenIndex: number;
  createdAt: number;
  /**
   * Ids this node points *to*. Optional because sessions carry no schema
   * version: every node already on disk predates linking and will read back
   * `undefined`, so every consumer must treat that as "no edges" rather than
   * assume an array. Kept acyclic — see `linkNodes`.
   */
  links?: string[];
}

/**
 * One cheap check, and what it established.
 *
 * Kept as the window rather than as a section, because that is what the check
 * actually covered: the cadence fires every 250 tokens and a window straddles
 * whatever section boundaries happen to fall inside it. Attributing it to a
 * section here would be deciding which one on the reader's behalf, and losing
 * the evidence for the other.
 */
export interface ClozeResult {
  /** Token window the blanks were drawn from. */
  from: number;
  to: number;
  blanks: number;
  recalled: number;
  /** When it was answered, so a coverage view can say how stale the evidence is. */
  at: number;
}

export interface SessionState {
  docId: string;
  tokenIndex: number;
  nodes: FlowNode[];
  summaries: Record<number, string>;
  /**
   * Grid blocks already answered correctly, and attempts spent on each.
   *
   * Optional for the same reason as `FlowNode.links`: sessions carry no schema
   * version, so every session written before these existed reads back without
   * them. Both must be treated as empty when absent rather than assumed
   * present — see `hydrateSession`.
   */
  gridsPassed?: Record<number, boolean>;
  gridAttempts?: Record<number, number>;
  /**
   * Spot checks answered, keyed by the token the window ended at.
   *
   * A record rather than a list, and keyed by the end of the window rather than
   * by a timestamp, so re-reading a stretch replaces its evidence instead of
   * accumulating a second opinion about the same words. Optional for the same
   * reason as `gridsPassed`: sessions carry no schema version, so every session
   * written before coverage existed reads back without it.
   */
  clozeChecks?: Record<number, ClozeResult>;
  updatedAt: number;
}

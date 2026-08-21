export type LogicTag = "entity" | "mechanism" | "output";

export type ViewMode = "standard" | "bionic" | "rsvp";

export type BlockKind = "h1" | "h2" | "h3" | "p" | "li" | "quote" | "code";

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
}

export interface SessionState {
  docId: string;
  tokenIndex: number;
  nodes: FlowNode[];
  summaries: Record<number, string>;
  updatedAt: number;
}

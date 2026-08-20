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
  chunk: number;
  block: number;
  section: number;
}

/**
 * A single utterance handed to the synthesizer: one sentence, hard-capped in
 * length. Small chunks keep sentence-skipping responsive and dodge the
 * long-utterance truncation bugs in Chrome's synthesis backend.
 */
export interface Chunk {
  i: number;
  text: string;
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

import type { ParsedDoc } from "./types";

/** First and last token index a block owns; `start === -1` when it owns none. */
export interface BlockRange {
  start: number;
  end: number;
}

export function blockRanges(doc: ParsedDoc): BlockRange[] {
  return doc.blocks.map((block) => {
    if (!block.chunks.length) return { start: -1, end: -1 };
    const first = doc.chunks[block.chunks[0]];
    const last = doc.chunks[block.chunks[block.chunks.length - 1]];
    return { start: first.tokenStart, end: last.tokenEnd };
  });
}

/**
 * What one block should be told about the reading position.
 *
 * `-1` for a block the caret has not reached, the block's own end for one it
 * has passed, and the caret itself for the block it is in. The clamping is the
 * point: a block that is told the raw token index re-renders on every spoken
 * word, and there are 5,404 blocks in the full GCDMP.
 */
export function activeTokenIn(range: BlockRange, tokenIndex: number): number {
  if (range.start === -1) return -1;
  if (tokenIndex >= range.end) return range.end;
  if (tokenIndex < range.start) return -1;
  return tokenIndex;
}

/**
 * The same clamp for the clause highlight, which differs in one way: a block
 * the caret has *passed* shows no clause at all, where it does show every word
 * as read. A finished block has no current clause in it.
 */
export function activeClauseIn(
  range: BlockRange,
  tokenIndex: number,
  clause: number
): number {
  if (range.start === -1) return -1;
  if (tokenIndex < range.start || tokenIndex >= range.end) return -1;
  return clause;
}

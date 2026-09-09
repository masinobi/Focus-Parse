import type { ParsedDoc } from "./types";

/**
 * The distance to the next spot check, as a shape rather than a number.
 *
 * The sidebar already reports it in words, and the reasoning for that is
 * recorded in `nextStop`: a countdown clock is a thing to watch instead of the
 * text, so the figure is glanced at deliberately and does not tick. That
 * argument is about a clock, and it still holds. It does not settle whether a
 * *number* is the right shape for the answer.
 *
 * "≈180w to a spot check" is a quantity a reader has to convert before it means
 * anything — and converting it is precisely the work that a tired brain, or one
 * that does not hold durations well, cannot spare. A row of segments that empty
 * as sentences finish is the same fact with the conversion already done.
 *
 * It satisfies the constraint the clock failed, and for a reason worth being
 * explicit about: **it only moves when a sentence ends.** A clock moves on its
 * own, which is what makes it a thing to watch; this moves on an event the
 * reader caused, a dozen or so times per leg, so there is nothing to watch
 * between moves.
 *
 * ## Why the spot check and not the summary
 *
 * The cheaper rung, on purpose. It comes round every 250 tokens — a dozen to
 * twenty sentences — so one segment per sentence is a readable row at a
 * readable size. The distance to the next *summary* is often over a thousand
 * words, where one segment per sentence is a hundred hairlines and a
 * proportional bar is a progress bar, which the header already has. That figure
 * stays a number.
 *
 * ## It is an approximation and must not look otherwise
 *
 * `buildCloze` can find nothing worth asking in a stretch — narrative passages
 * and reference lists both do it — and the engine then slides the window on
 * instead of stopping. So this is the *earliest* a stop can come and not a
 * promise that it will, exactly as the word figures beside it are. The caller
 * renders it with the same hedge.
 */

export interface CheckGauge {
  /** Sentences of this leg already behind the caret. */
  done: number;
  /** Sentences in the leg, after any clamp. */
  total: number;
  /**
   * The leg held more sentences than `max` and has been scaled to fit.
   *
   * Reported rather than hidden. On this corpus it does not happen — a 250
   * token leg is 13 to 18 sentences — but a document of very short sentences
   * would reach it, and a gauge that silently changed what a segment meant
   * would be a different measurement wearing the same row of marks.
   */
  scaled: boolean;
}

/**
 * Sentences in the current spot-check leg, and how many are done.
 *
 * Null when there is nothing to draw: past the end of the document, or a leg
 * that holds no chunks at all. Null is a real answer and the caller renders
 * nothing rather than an empty row, which would read as "no progress" instead
 * of "not applicable".
 */
export function checkGauge(
  doc: ParsedDoc,
  tokenIndex: number,
  lastCheckToken: number,
  intervalTokens: number,
  max: number
): CheckGauge | null {
  if (tokenIndex >= doc.wordCount) return null;

  const from = lastCheckToken;
  const to = lastCheckToken + intervalTokens;

  let total = 0;
  let done = 0;
  for (const chunk of doc.chunks) {
    // Overlap, not containment: the chunk the leg starts inside belongs to it,
    // and testing containment would drop it and shorten every leg by one.
    if (chunk.tokenEnd <= from || chunk.tokenStart >= to) continue;
    if (doc.sections[chunk.section]?.furniture) continue;
    total += 1;
    if (chunk.tokenEnd <= tokenIndex) done += 1;
  }

  if (total === 0) return null;

  if (total > max) {
    return {
      done: Math.round((done / total) * max),
      total: max,
      scaled: true,
    };
  }

  return { done, total, scaled: false };
}

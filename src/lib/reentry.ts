import type { ParsedDoc } from "./types";

/**
 * Coming back after being away.
 *
 * Nothing in the app punishes an abandoned session and nothing needed to be
 * removed to keep it that way: `abandonCheck` already clears an open check,
 * stops playback and rewinds to the chunk the check interrupted, and it records
 * nothing at all. A summary never written is simply not written.
 *
 * What was missing is that **no timer touches an open check**. The vigilance
 * device is the only clock in the app and it runs `if (!enabled || !isPlaying)
 * return` — arming a check pauses playback, so while a dialog is open the one
 * mechanism that notices absence is switched off. Walk away mid-intercept and
 * that dialog is still there tomorrow, asking about a section whose text is
 * long gone from working memory. The only move left is to dismiss it, which
 * reads as a failure and is not one.
 *
 * So two small things. A stale check is cleared on the reader's behalf, using
 * the same `abandonCheck` path a dismiss would take — the *offer* is what
 * changes, not the accounting. And on return the app offers to replay the last
 * couple of sentences, which is the same advice the vigilance lapse already
 * gives ("consider stepping back a section") at a scale that costs seconds
 * rather than minutes.
 *
 * Deliberately an offer and not an action. Audio that starts by itself in a tab
 * someone has just come back to is hostile, and the reader may have been away
 * for a reason that makes the pre-roll pointless.
 */

/**
 * How long away before the app stops assuming someone is coming right back.
 *
 * Fifteen minutes, which is far longer than a pause to think and far shorter
 * than a lunch. The cost of being wrong is asymmetric and cheap in one
 * direction: offering a pre-roll to someone who did not need it is one
 * dismissed pill, while not offering it to someone who did is the whole
 * re-entry problem this exists for.
 */
export const STALE_MS = 15 * 60_000;

/** Sentences replayed on return. Two is a thought, one is a fragment. */
export const PRE_ROLL_SENTENCES = 2;

/**
 * Whether the reader has been away long enough to be treated as returning.
 *
 * `playing` is the whole guard. A reader following the audio is present by
 * definition and is the vigilance device's problem, not this one — and reading
 * for fifteen minutes without touching the keyboard is the app working, not a
 * reason to interrupt.
 */
export function isAway(
  now: number,
  lastPresenceAt: number,
  playing: boolean
): boolean {
  if (playing) return false;
  return now - lastPresenceAt >= STALE_MS;
}

/**
 * The chunk to resume from, counting back over what was actually spoken.
 *
 * Furniture is skipped rather than counted. Playback never wanders into a
 * reference list, so replaying "the last two sentences" out of one would be
 * replaying something the reader has never heard — the pre-roll exists to
 * restore what was in their head, and nothing that was never said can be.
 *
 * Returns the current chunk when there is nothing behind it, which makes the
 * caller's "is there anything to replay" test a plain inequality.
 */
export function preRollTarget(
  doc: ParsedDoc,
  chunkIndex: number,
  sentences: number = PRE_ROLL_SENTENCES
): number {
  const start = Math.max(0, Math.min(chunkIndex, doc.chunks.length - 1));
  let target = start;
  let counted = 0;

  for (let i = start - 1; i >= 0 && counted < sentences; i--) {
    const chunk = doc.chunks[i];
    if (!chunk) continue;
    if (doc.sections[chunk.section]?.furniture) continue;
    target = i;
    counted += 1;
  }

  return target;
}

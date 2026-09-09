/**
 * How long the engine waits, and how long before it decides nothing is coming.
 *
 * Extracted from `useSpeechEngine` because none of it could be tested where it
 * lived. Headless Chromium enumerates zero voices, so the speech path has no
 * probe and never will; these are the numbers that decide whether a sentence is
 * heard, and they need to be checkable without a browser.
 *
 * ## The bug this module was extracted to fix
 *
 * Two clocks run over every utterance and they disagreed.
 *
 * The **estimator grace** is how long to wait for a real `boundary` event
 * before interpolating the caret. It is generous, deliberately, and learned per
 * voice: `NETWORK_PROBE_GRACE_MS` for a voice never heard from, then the
 * voice's own measured latency plus half again, up to `MAX_ESTIMATOR_GRACE_MS`
 * — 2,800ms.
 *
 * The **stall watchdog** is how long before concluding the platform dropped the
 * utterance entirely, at which point the sentence is abandoned and the next one
 * begins. It was a flat 1,600ms.
 *
 * So the watchdog was tighter than the wait it exists to back up. A voice that
 * the estimator was still patiently waiting for at 2,000ms had already had its
 * sentence given up on at 1,600. And this is not hypothetical on this corpus's
 * own machine: `PREFERRED_VOICES` is ordered by a `/voice-check` run whose
 * docstring records that **across 49 voices in Edge the first boundary arrived
 * between 575ms and 2,376ms**. Every voice in the slow half of that measured
 * range had its sentences abandoned before it had said a word — silently, since
 * an abandoned sentence looks exactly like a sentence that finished.
 *
 * Local voices are unaffected: they report in tens of milliseconds. Which is
 * why the symptom is per-voice rather than per-browser, and reads as "this
 * voice does not work" rather than as a bug.
 *
 * The rule now is derived rather than declared: **the watchdog may never fire
 * before the grace it backs up has expired.** `stallTimeoutFor` takes the grace
 * as an argument so the two cannot drift apart again.
 */

/**
 * Grace period before the interpolating fallback is allowed to move the
 * highlight. Real `boundary` events almost always arrive inside this window.
 */
export const ESTIMATOR_GRACE_MS = 320;

/**
 * Grace used for a voice we have not heard from yet and that synthesizes over
 * the network. Measured, not guessed: across 49 voices in Edge the first
 * boundary arrived between 575ms and 2376ms, so the 320ms baseline — which was
 * tuned against local voices — guarantees the estimator moves the caret on a
 * guess at the start of every sentence.
 */
export const NETWORK_PROBE_GRACE_MS = 1200;

/**
 * Ceiling on the learned grace. Past this the fallback has stopped being a
 * fallback; a voice this slow to report is better paced by interpolation than
 * by waiting for it.
 */
export const MAX_ESTIMATOR_GRACE_MS = 2800;

/**
 * How much longer than a voice's observed latency to wait before interpolating.
 * Latency varies per utterance, especially over a network, so matching it
 * exactly would trip the estimator on every slower-than-average sentence.
 */
export const LATENCY_HEADROOM = 1.5;

/** Utterances to give a voice before concluding it fires no boundaries at all. */
export const SILENT_VOICE_ATTEMPTS = 2;

/**
 * Shortest stall timeout, used once a voice has proved it reports.
 *
 * After a first boundary the question changes: the voice is known to be
 * speaking and known to be reachable, so silence now means a genuinely dropped
 * utterance and there is no reason to sit through seconds of it.
 */
export const STALL_TIMEOUT_MS = 1600;

/**
 * Margin between the grace expiring and the watchdog firing.
 *
 * The grace ending means "assume it is speaking and pace it by interpolation".
 * The watchdog firing means "assume nothing was ever spoken and move on". The
 * second is a much stronger claim, so it waits a further beat before making it.
 */
export const STALL_HEADROOM_MS = 1200;

/** What the engine has learned about the currently selected voice. */
export interface VoiceLatency {
  voiceURI: string | null;
  /** Smoothed time to the first boundary, or null if none has ever arrived. */
  ms: number | null;
  utterances: number;
  boundaries: number;
  /** Utterances for which a `start` event ever arrived. */
  starts: number;
}

/**
 * How long to let a sentence run before interpolating.
 *
 * The estimator exists for engines that never fire word boundaries. Starting it
 * while boundaries are merely *late* is worse than useless: it advances the
 * caret on a guess, and because highlight movement is monotonic within an
 * utterance, the real events then have to catch up to the guess before the
 * caret moves again — so a late voice reads as a caret that lurches and then
 * stalls.
 */
export function graceFor(stats: VoiceLatency, localService: boolean): number {
  if (stats.ms !== null) {
    return Math.min(
      MAX_ESTIMATOR_GRACE_MS,
      Math.round(stats.ms * LATENCY_HEADROOM) + 80
    );
  }
  // Tried and heard nothing back: it is not going to start now, so pace
  // promptly rather than leaving the reader in silence.
  if (stats.utterances >= SILENT_VOICE_ATTEMPTS && stats.boundaries === 0) {
    return ESTIMATOR_GRACE_MS;
  }
  return localService ? ESTIMATOR_GRACE_MS : NETWORK_PROBE_GRACE_MS;
}

/**
 * How long before an utterance that has said nothing is presumed dropped.
 *
 * Derived from the grace rather than declared beside it, which is the whole
 * point: the two numbers were independent constants and drifted into
 * contradiction. Passing the grace in makes the ordering structural.
 *
 * `boundarySeen` tightens it back to the flat timeout, because a voice that has
 * already reported once is known to be reachable and a later silence is a real
 * drop rather than a slow start.
 */
export function stallTimeoutFor(graceMs: number, boundarySeen: boolean): number {
  if (boundarySeen) return STALL_TIMEOUT_MS;
  return Math.max(STALL_TIMEOUT_MS, graceMs + STALL_HEADROOM_MS);
}

/**
 * When the estimator may treat elapsed time as *spoken* time.
 *
 * The estimator interpolates the caret for engines that fire no word
 * boundaries, at a fixed words-per-minute. That arithmetic is only meaningful
 * measured from the moment audio actually began, and it used to be measured
 * from the moment the utterance was handed to `speak()` -- which on a network
 * voice is one cold round trip earlier.
 *
 * The result was the bug as reported: on resuming, the caret ran ahead to the
 * end of the sentence while nothing was audible, and then sat frozen there
 * while the audio caught up to it, because highlight movement is monotonic
 * within an utterance and the real boundaries all arrived behind the guess. The
 * engine's own docstring predicted it in as many words; what it did not say is
 * that `startedAt` was the queue time rather than the speech time, which is
 * what made a *slow-starting* voice look like a *non-reporting* one.
 *
 * Returning null means "not yet": there is no basis for interpolating, so do
 * nothing and let the stall watchdog own that window.
 *
 * The fallback matters as much as the rule. An engine that never reports a
 * start at all -- and the spec does not oblige one to -- would otherwise have
 * its caret frozen for every sentence. So a voice is given
 * `SILENT_VOICE_ATTEMPTS` utterances to prove it reports starts, exactly as it
 * is given the same to prove it reports boundaries; if it never has, the queue
 * time is used and the behaviour is what it was before.
 */
export function estimatorAnchor(
  queuedAt: number,
  speakingSince: number | null,
  stats: VoiceLatency
): number | null {
  if (speakingSince !== null) return speakingSince;
  if (stats.utterances >= SILENT_VOICE_ATTEMPTS && stats.starts === 0) {
    return queuedAt;
  }
  return null;
}

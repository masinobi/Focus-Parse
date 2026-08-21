"use client";

import { useEffect } from "react";

import { useFocusStore } from "@/store/useFocusStore";

/**
 * The vigilance device.
 *
 * Every other mechanism in the app assumes a reader is present and works to
 * keep them engaged. None of them can tell the difference between someone
 * following the caret and an empty chair — the synthesizer reads to both at the
 * same rate, the highlight tracks for both, and the session record afterwards
 * looks identical. So periodically the app stops assuming: it asks for one
 * keypress, and if nothing comes back within a few seconds it stops the audio.
 *
 * Borrowed from the driver's safety device on a train, deliberately including
 * the part that makes it work: the cue is small and the consequence is not.
 * Losing your place in a dense guideline is a real cost, which is exactly why
 * it is the right one to attach to being absent.
 */

/** Shortest gap between checks. */
const BASE_INTERVAL_MS = 90_000;

/**
 * Random spread on top of the base interval. A fixed period is a rhythm, and a
 * rhythm can be anticipated and answered without ever leaving the daydream that
 * the check exists to catch.
 */
const JITTER_MS = 45_000;

/**
 * Time to respond. Long enough to finish hearing the sentence you are on,
 * short enough that it cannot be answered from another room.
 */
const GRACE_MS = 3_500;

/** Timer resolution. Fine enough for a 3.5s window, coarse enough to be free. */
const TICK_MS = 250;

export function useVigilance(): void {
  const enabled = useFocusStore((s) => s.vigilance.enabled);
  const phase = useFocusStore((s) => s.vigilance.phase);
  const isPlaying = useFocusStore((s) => s.isPlaying);

  useEffect(() => {
    if (!enabled || !isPlaying) return;
    if (phase === "lapsed") return;

    const store = useFocusStore;

    /*
     * The deadline is anchored to the last proof of presence rather than to a
     * fixed schedule, so a reader typing in the scratchpad — who is provably
     * there, and doing the more demanding thing — keeps pushing it out instead
     * of being interrupted to prove it again.
     */
    const jitter = Math.round(Math.random() * JITTER_MS);
    let dueAt = store.getState().vigilance.lastPresenceAt + BASE_INTERVAL_MS + jitter;

    const timer = window.setInterval(() => {
      const state = store.getState();
      const now = Date.now();

      if (state.vigilance.phase === "waiting") {
        if (state.vigilance.raisedAt !== null && now - state.vigilance.raisedAt > GRACE_MS) {
          state.lapseVigilance();
        }
        return;
      }

      // Presence noted since this effect started: push the deadline out.
      const anchored = state.vigilance.lastPresenceAt + BASE_INTERVAL_MS + jitter;
      if (anchored > dueAt) dueAt = anchored;

      if (now >= dueAt) state.raiseVigilance();
    }, TICK_MS);

    return () => window.clearInterval(timer);
  }, [enabled, isPlaying, phase]);
}

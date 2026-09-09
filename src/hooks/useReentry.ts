"use client";

import { useEffect } from "react";

import { isAway } from "@/lib/reentry";
import { useFocusStore } from "@/store/useFocusStore";

/**
 * The clock that reaches an open check.
 *
 * The vigilance device is the app's only other timer and it deliberately does
 * not run here: `if (!enabled || !isPlaying) return`, and arming a check pauses
 * playback. That is correct for what vigilance is — it asks whether someone is
 * listening, and nobody is listening to a paused document — but it leaves the
 * one state a reader is most likely to walk away from with nothing watching it.
 *
 * So this runs on the opposite condition. It ticks only while the audio is
 * *stopped*, which is also why a one-minute interval costs nothing: there is no
 * reading in progress for it to compete with.
 */

/**
 * Resolution of the idle clock.
 *
 * A minute against a fifteen-minute threshold. The offer is not time-critical —
 * a reader who has been gone twenty minutes is not harmed by being noticed at
 * twenty-one — and a coarse timer is one that cannot be accused of waking a
 * sleeping tab.
 */
const TICK_MS = 60_000;

export function useReentry(): void {
  const isPlaying = useFocusStore((s) => s.isPlaying);
  const hasDoc = useFocusStore((s) => s.doc !== null);
  const away = useFocusStore((s) => s.away);

  useEffect(() => {
    // Nothing to come back to, already offered, or the reader is present.
    if (!hasDoc || isPlaying || away) return;

    const store = useFocusStore;
    const timer = window.setInterval(() => {
      const state = store.getState();
      if (state.isPlaying || state.away) return;
      // Read at the tick rather than closed over: `lastPresenceAt` moves under
      // this effect every time the reader touches anything, and a captured
      // value would make the threshold count from whenever the effect last ran
      // instead of from the last thing they actually did.
      if (!isAway(Date.now(), state.vigilance.lastPresenceAt, state.isPlaying)) {
        return;
      }
      state.noteAway();
    }, TICK_MS);

    return () => window.clearInterval(timer);
  }, [hasDoc, isPlaying, away]);
}

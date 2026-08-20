"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { tokenAtCharIndex } from "@/lib/parse";
import { useFocusStore } from "@/store/useFocusStore";

/**
 * Grace period before the interpolating fallback is allowed to move the
 * highlight. Real `boundary` events almost always arrive inside this window.
 */
const ESTIMATOR_GRACE_MS = 320;
const ESTIMATOR_TICK_MS = 55;

/** No boundary, no end, nothing speaking: the engine dropped the utterance. */
const STALL_TIMEOUT_MS = 1600;

/** Chrome drops a `speak()` issued in the same tick as a `cancel()`. */
const CANCEL_SETTLE_MS = 60;

/** Baseline used only by the fallback estimator. */
const ESTIMATOR_WPM = 185;

export interface SpeechEngineStatus {
  supported: boolean;
  voices: SpeechSynthesisVoice[];
  /**
   * True when the platform is not emitting word boundaries and highlighting is
   * being interpolated instead. Surfaced in the UI so the pacing is honest.
   */
  estimating: boolean;
}

/**
 * Drives `SpeechSynthesis` and keeps the visual pacer locked to it.
 *
 * The engine speaks one chunk (one sentence) at a time, always starting at the
 * character offset of the current token, so pause/resume, sentence skipping,
 * rate changes and click-to-seek all collapse into a single "speak from token N"
 * code path. Boundary events are translated back into token indices via a
 * binary search over the chunk's token offsets.
 */
export function useSpeechEngine(): SpeechEngineStatus {
  const [supported, setSupported] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [estimating, setEstimating] = useState(false);

  const doc = useFocusStore((s) => s.doc);
  const isPlaying = useFocusStore((s) => s.isPlaying);
  const rate = useFocusStore((s) => s.rate);
  const voiceURI = useFocusStore((s) => s.voiceURI);
  const seekNonce = useFocusStore((s) => s.seekNonce);

  /** Incremented on every (re)start; stale utterance callbacks check it. */
  const generation = useRef(0);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const estimatorTimer = useRef<number | null>(null);
  const stallTimer = useRef<number | null>(null);
  const startTimer = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (estimatorTimer.current !== null) {
      window.clearInterval(estimatorTimer.current);
      estimatorTimer.current = null;
    }
    if (stallTimer.current !== null) {
      window.clearTimeout(stallTimer.current);
      stallTimer.current = null;
    }
    if (startTimer.current !== null) {
      window.clearTimeout(startTimer.current);
      startTimer.current = null;
    }
  }, []);

  // Voice list: Chrome populates it asynchronously.
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    setSupported(true);

    const load = () => {
      const list = window.speechSynthesis.getVoices();
      if (!list.length) return;
      voicesRef.current = list;
      setVoices(list);

      if (!useFocusStore.getState().voiceURI) {
        const preferred =
          list.find((v) => v.default && v.lang.startsWith("en")) ??
          list.find((v) => v.lang.startsWith("en")) ??
          list.find((v) => v.default) ??
          list[0];
        if (preferred) useFocusStore.getState().setVoice(preferred.voiceURI);
      }
    };

    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  // Stop audio if the tab goes away or the component unmounts.
  useEffect(() => {
    return () => {
      generation.current += 1;
      clearTimers();
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [clearTimers]);

  useEffect(() => {
    if (!supported || typeof window === "undefined") return;

    const synth = window.speechSynthesis;
    const store = useFocusStore;

    // Any dependency change invalidates whatever is currently speaking.
    generation.current += 1;
    const gen = generation.current;
    clearTimers();
    synth.cancel();
    setEstimating(false);

    if (!doc || !doc.chunks.length || !isPlaying) return;

    let disposed = false;
    const alive = () => !disposed && generation.current === gen;

    const speakFromToken = (tokenIndex: number) => {
      if (!alive()) return;

      const token = doc.tokens[tokenIndex];
      if (!token) {
        store.getState().setPlaying(false);
        return;
      }

      const chunk = doc.chunks[token.chunk];
      const startOffset = token.offset;
      const text = chunk.text.slice(startOffset);

      if (!text.trim()) {
        finishChunk(chunk.i);
        return;
      }

      store.getState().advanceToken(tokenIndex);

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = rate;
      utterance.pitch = 1;
      utterance.volume = 1;

      const voice = voicesRef.current.find((v) => v.voiceURI === voiceURI);
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      }

      let boundarySeen = false;
      let lastToken = tokenIndex;
      const startedAt = performance.now();

      const armStall = () => {
        if (stallTimer.current !== null) window.clearTimeout(stallTimer.current);
        stallTimer.current = window.setTimeout(() => {
          if (!alive()) return;
          if (!synth.speaking && !synth.pending) finishChunk(chunk.i);
          else armStall();
        }, STALL_TIMEOUT_MS);
      };

      utterance.onboundary = (event) => {
        if (!alive()) return;
        // Some engines also emit "sentence"; only words carry useful offsets.
        if (event.name && event.name !== "word") return;

        if (!boundarySeen) {
          boundarySeen = true;
          if (estimatorTimer.current !== null) {
            window.clearInterval(estimatorTimer.current);
            estimatorTimer.current = null;
          }
          setEstimating(false);
        }

        const absolute = startOffset + (event.charIndex ?? 0);
        const next = tokenAtCharIndex(doc, chunk.i, absolute);
        // Monotonic within an utterance: some engines re-emit an early offset
        // as they settle, and a highlight that jumps backwards reads as a bug.
        if (next > lastToken) {
          lastToken = next;
          store.getState().advanceToken(next);
          store.getState().tickWord();
        }
        armStall();
      };

      utterance.onend = () => {
        if (!alive()) return;
        finishChunk(chunk.i);
      };

      utterance.onerror = (event) => {
        if (!alive()) return;
        const reason = (event as SpeechSynthesisErrorEvent).error;
        if (reason === "canceled" || reason === "interrupted") return;
        // Anything else: skip the sentence rather than dead-ending the session.
        finishChunk(chunk.i);
      };

      // Interpolating fallback for engines that never fire word boundaries
      // (Safari, and several Linux/espeak voices).
      estimatorTimer.current = window.setInterval(() => {
        if (!alive() || boundarySeen) return;
        const elapsed = performance.now() - startedAt;
        if (elapsed < ESTIMATOR_GRACE_MS) return;

        setEstimating(true);
        const msPerWord = 60000 / (ESTIMATOR_WPM * rate);
        const target = Math.min(
          chunk.tokenEnd - 1,
          tokenIndex + Math.floor(elapsed / msPerWord)
        );
        if (target > lastToken) {
          lastToken = target;
          store.getState().advanceToken(target);
          store.getState().tickWord();
        }
      }, ESTIMATOR_TICK_MS);

      armStall();
      synth.speak(utterance);
    };

    const finishChunk = (chunkIndex: number) => {
      if (!alive()) return;
      clearTimers();

      const state = store.getState();
      const next = chunkIndex + 1;

      if (next >= doc.chunks.length) {
        state.advanceToken(doc.tokens.length - 1);
        state.setPlaying(false);
        return;
      }

      const leaving = doc.chunks[chunkIndex].section;
      const entering = doc.chunks[next].section;

      // A structural boundary into a major header arms the cognitive intercept:
      // the summary is owed for the section just finished.
      if (
        entering !== leaving &&
        doc.sections[entering]?.intercept &&
        !state.summaries[leaving]
      ) {
        state.advanceToken(doc.chunks[chunkIndex].tokenEnd - 1);
        state.armIntercept(leaving, next);
        return;
      }

      speakFromToken(doc.chunks[next].tokenStart);
    };

    startTimer.current = window.setTimeout(() => {
      if (!alive()) return;
      speakFromToken(store.getState().tokenIndex);
    }, CANCEL_SETTLE_MS);

    return () => {
      disposed = true;
      clearTimers();
      synth.cancel();
    };
  }, [supported, doc, isPlaying, rate, voiceURI, seekNonce, clearTimers]);

  return { supported, voices, estimating };
}

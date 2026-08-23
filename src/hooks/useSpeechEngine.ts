"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { tokenAtCharIndex } from "@/lib/parse";
import { buildCloze, buildGridQuestion } from "@/lib/quiz";
import {
  CLOZE_INTERVAL_TOKENS,
  MAX_GRID_ATTEMPTS,
  useFocusStore,
} from "@/store/useFocusStore";

/**
 * Grace period before the interpolating fallback is allowed to move the
 * highlight. Real `boundary` events almost always arrive inside this window.
 */
export const ESTIMATOR_GRACE_MS = 320;
const ESTIMATOR_TICK_MS = 55;

/**
 * Grace used for a voice we have not heard from yet and that synthesizes over
 * the network. Measured, not guessed: across 49 voices in Edge the first
 * boundary arrived between 575ms and 2376ms, so the 320ms baseline — which was
 * tuned against local voices — guarantees the estimator moves the caret on a
 * guess at the start of every sentence.
 */
const NETWORK_PROBE_GRACE_MS = 1200;

/**
 * Ceiling on the learned grace. Past this the fallback has stopped being a
 * fallback; a voice this slow to report is better paced by interpolation than
 * by waiting for it.
 */
const MAX_ESTIMATOR_GRACE_MS = 2800;

/**
 * How much longer than a voice's observed latency to wait before interpolating.
 * Latency varies per utterance, especially over a network, so matching it
 * exactly would trip the estimator on every slower-than-average sentence.
 */
const LATENCY_HEADROOM = 1.5;

/** Utterances to give a voice before concluding it fires no boundaries at all. */
const SILENT_VOICE_ATTEMPTS = 2;

/** What the engine has learned about the currently selected voice. */
interface VoiceLatency {
  voiceURI: string | null;
  /** Smoothed time to the first boundary, or null if none has ever arrived. */
  ms: number | null;
  utterances: number;
  boundaries: number;
}

/**
 * How long to let a sentence run before interpolating.
 *
 * The estimator exists for engines that never fire word boundaries. Starting it
 * while boundaries are merely *late* is worse than useless: it advances the
 * caret on a guess, and because highlight movement is monotonic within an
 * utterance, the real events then have to catch up to the guess before the caret
 * moves again — so a late voice reads as a caret that lurches and then stalls.
 */
function graceFor(stats: VoiceLatency, localService: boolean): number {
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

/** No boundary, no end, nothing speaking: the engine dropped the utterance. */
const STALL_TIMEOUT_MS = 1600;

/** Chrome drops a `speak()` issued in the same tick as a `cancel()`. */
export const CANCEL_SETTLE_MS = 60;

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
  /**
   * Per-voice boundary latency, learned as the session runs. Reset whenever the
   * selected voice changes, because latency is a property of the voice and a
   * local voice's timings say nothing about a networked one's.
   */
  const latency = useRef<VoiceLatency>({
    voiceURI: null,
    ms: null,
    utterances: 0,
    boundaries: 0,
  });

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

      // Speak from the token's position in the *spoken* string, which differs
      // from the displayed string wherever an acronym is expanded. The fallback
      // covers a document whose stored shape predates the speech string: it
      // should read without acronym expansion rather than fail to play at all.
      const hasSpeech = typeof chunk.speech === "string";
      const source = hasSpeech ? chunk.speech : chunk.text;
      const startOffset = hasSpeech ? (token.speechOffset ?? token.offset) : token.offset;
      const text = source.slice(startOffset);

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

      if (latency.current.voiceURI !== (voiceURI ?? null)) {
        latency.current = {
          voiceURI: voiceURI ?? null,
          ms: null,
          utterances: 0,
          boundaries: 0,
        };
      }
      const graceMs = graceFor(latency.current, voice ? voice.localService : true);
      latency.current.utterances += 1;

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
          const observed = performance.now() - startedAt;
          latency.current.boundaries += 1;
          // Smoothed rather than replaced: one slow round-trip should nudge the
          // grace, not redefine it.
          latency.current.ms =
            latency.current.ms === null
              ? observed
              : latency.current.ms * 0.7 + observed * 0.3;
          if (estimatorTimer.current !== null) {
            window.clearInterval(estimatorTimer.current);
            estimatorTimer.current = null;
          }
          setEstimating(false);
        }

        const absolute = startOffset + (event.charIndex ?? 0);
        const next = tokenAtCharIndex(doc, chunk.i, absolute, hasSpeech);
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
        if (elapsed < graceMs) return;

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

      /*
       * Three rungs of a single ladder, in descending cost. At most one fires
       * per boundary: a boundary that owes a summary does not also owe a grid
       * question, and stacking two stops back to back turns enforcement into
       * obstruction. The cheaper rungs come round again within a few hundred
       * words, so nothing is lost by yielding to the expensive one.
       */

      // 1. A structural boundary into a major header arms the cognitive
      //    intercept: the summary is owed for the section just finished.
      if (
        entering !== leaving &&
        doc.sections[entering]?.intercept &&
        !state.summaries[leaving]
      ) {
        state.advanceToken(doc.chunks[chunkIndex].tokenEnd - 1);
        state.armIntercept(leaving, next);
        return;
      }

      // 2. Leaving a grid. The matrix was just read out card by card and every
      //    cell is structured data, so the question and its marking need no
      //    model — the answer is already in the document. Only armed when a
      //    question can actually be built: an unanswerable grid must not stop
      //    the reader.
      const leavingBlock = doc.chunks[chunkIndex].block;
      if (doc.chunks[next].block !== leavingBlock) {
        const block = doc.blocks[leavingBlock];
        const attempts = state.gridAttempts[leavingBlock] ?? 0;

        if (
          block?.kind === "table" &&
          block.steps?.length &&
          !state.gridsPassed[leavingBlock] &&
          attempts < MAX_GRID_ATTEMPTS &&
          buildGridQuestion(block, attempts)
        ) {
          state.advanceToken(doc.chunks[chunkIndex].tokenEnd - 1);
          state.armGridCheck(leavingBlock, next);
          return;
        }
      }

      // 3. Reading cadence. The cheap rung: a few blanks drawn from the stretch
      //    just heard, marked locally, several times between intercepts.
      const readTo = doc.chunks[chunkIndex].tokenEnd;
      if (readTo - state.lastCheckToken >= CLOZE_INTERVAL_TOKENS) {
        const cloze = buildCloze(
          doc,
          state.lastCheckToken,
          readTo,
          undefined,
          state.weakTerms
        );
        if (cloze) {
          state.advanceToken(readTo - 1);
          state.armCloze(cloze, next);
          return;
        }
        // Nothing in that stretch was worth asking about — narrative passages
        // and reference lists both do this. Slide the window forward so the
        // next attempt measures from here instead of compounding into a check
        // that spans half the document.
        state.noteCheckPoint(readTo);
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

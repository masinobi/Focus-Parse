"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { demandsSummary, tokenAtCharIndex } from "@/lib/parse";
import {
  ESTIMATOR_GRACE_MS,
  graceFor,
  stallTimeoutFor,
  type VoiceLatency,
} from "@/lib/speech-timing";
import { buildCloze, buildGridQuestion } from "@/lib/quiz";
import {
  CLOZE_INTERVAL_TOKENS,
  MAX_GRID_ATTEMPTS,
  useFocusStore,
} from "@/store/useFocusStore";

/** Ticks of the interpolating fallback. Everything else it uses lives in
 * `speech-timing.ts`, where it can be tested; headless Chromium enumerates no
 * voices, so this file has no probe and never will. */
const ESTIMATOR_TICK_MS = 55;

/** Where the chosen voice is remembered between sessions. */
const VOICE_KEY = "focusparse:voice";

/**
 * Voices to prefer when the reader has not chosen one yet, best first.
 *
 * Not a taste ranking — these are the fastest to their first boundary in the
 * `/voice-check` run on this machine (Aria 576ms, Guy 637ms, Jenny 729ms,
 * Christopher 760ms), and the engine pays that latency once per *sentence*.
 * What this exists to avoid is the platform default: Windows nominates David,
 * which the same probe measured as the slowest of all 49 voices to report a
 * boundary. Picking `v.default` first meant every session started on the worst
 * available voice until the reader changed it by hand, every time.
 *
 * Matched as a case-insensitive substring, because the full names carry
 * platform decoration ("Microsoft Aria Online (Natural) - English (United
 * States)"). Absent every one of them, the old default-first order applies.
 */
const PREFERRED_VOICES = ["Aria", "Guy", "Jenny", "Christopher"];

/**
 * Voices to pass over when falling back. Both are word-exact, so this is about
 * lead-in latency alone; either is still chosen if nothing else is installed.
 */
const SLOW_DEFAULTS = ["David", "Zira"];

/** The voice a fresh install should start on. */
function pickVoice(list: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const english = list.filter((v) => v.lang.startsWith("en"));
  const pool = english.length ? english : list;

  for (const wanted of PREFERRED_VOICES) {
    const match = pool.find((v) => v.name.toLowerCase().includes(wanted.toLowerCase()));
    if (match) return match;
  }

  const notSlow = pool.find(
    (v) => !SLOW_DEFAULTS.some((slow) => v.name.toLowerCase().includes(slow.toLowerCase()))
  );
  return notSlow ?? pool.find((v) => v.default) ?? pool[0];
}

/** Chrome drops a `speak()` issued in the same tick as a `cancel()`. */
export const CANCEL_SETTLE_MS = 60;

/** Re-exported so `/voice-check` keeps one import for the engine's numbers. */
export { ESTIMATOR_GRACE_MS };

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
        // Read here rather than in the store's initial state: a "use client"
        // store is still evaluated on the server, and a value that differs
        // between the two renders is a hydration error.
        let stored: string | null = null;
        try {
          stored = window.localStorage.getItem(VOICE_KEY);
        } catch {
          // Private mode. Fall through to picking one.
        }

        // A remembered voice only counts if it is still installed — voices come
        // and go with the platform, and selecting a missing one silently drops
        // the utterance's voice rather than erroring.
        const remembered = stored
          ? list.find((v) => v.voiceURI === stored)
          : undefined;

        const preferred = remembered ?? pickVoice(list);
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

      /*
       * The watchdog, which used to be a flat 1,600ms and so was tighter than
       * the grace above it -- see `speech-timing.ts`. A network voice slower
       * than about a second to its first boundary had every sentence abandoned
       * before it had said a word, silently, because an abandoned sentence
       * looks exactly like one that finished. `stallTimeoutFor` takes the
       * grace as an argument so the two can no longer drift apart.
       */
      const armStall = () => {
        if (stallTimer.current !== null) window.clearTimeout(stallTimer.current);
        stallTimer.current = window.setTimeout(() => {
          if (!alive()) return;
          if (!synth.speaking && !synth.pending) finishChunk(chunk.i);
          else armStall();
        }, stallTimeoutFor(graceMs, boundarySeen));
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

    /**
     * First chunk at or after `from` that is not journal furniture.
     *
     * The engine declines to *wander* into an author list or a bibliography;
     * it does not refuse to read them. A deliberate seek — clicking the
     * section in the structure map — still starts there and plays it, because
     * the reader asking for the references is a different thing from the
     * reader being handed them after the chapter ends.
     */
    const skipFurniture = (from: number): number => {
      let at = from;
      while (at < doc.chunks.length && doc.sections[doc.chunks[at].section]?.furniture) {
        at += 1;
      }
      return at;
    };

    const finishChunk = (chunkIndex: number) => {
      if (!alive()) return;
      clearTimers();

      const state = store.getState();
      const next = skipFurniture(chunkIndex + 1);

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
      //    intercept: the summary is owed for the section just finished — so
      //    `demandsSummary` asks about *that* one, not the one being entered.
      //    Testing `sections[entering].intercept` alone applied the
      //    minimum-length floor to the wrong section and stopped the reader to
      //    summarize a two-word heading. Same rule as `buildCoverage` reads,
      //    from one place, because invariant 20 needs them identical.
      if (
        entering !== leaving &&
        demandsSummary(doc.sections, leaving) &&
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

      speakFromToken(doc.chunks[skipFurniture(next)]?.tokenStart ?? doc.tokens.length - 1);
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

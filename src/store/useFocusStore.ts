"use client";

import { create } from "zustand";

import { db } from "@/lib/db";
import type { ClozeCheck } from "@/lib/quiz";
import { QUALITY, summaryId, type WeakTerms } from "@/lib/review";
import type { FlowNode, LogicTag, ParsedDoc, ViewMode } from "@/lib/types";

export const MIN_RATE = 1.0;
export const MAX_RATE = 3.0;
export const RATE_STEP = 0.1;

/**
 * Reading covered between cheap checks. Roughly a third of the 700-word pacing
 * checkpoint, so two or three cloze checks land inside every stretch that ends
 * in a full intercept — cheap checks often, expensive ones rarely.
 */
export const CLOZE_INTERVAL_TOKENS = 250;

/**
 * Attempts allowed on one grid before the reader is let past.
 *
 * A grid that has beaten someone twice is not going to yield on the third pass,
 * and a check with no exit is a check that ends the session.
 */
export const MAX_GRID_ATTEMPTS = 2;

/** Words-per-minute assumed for a fresh session before telemetry accumulates. */
const BASELINE_WPM = 185;

/** Boundary gaps longer than this are treated as stalls, not reading time. */
const MAX_TICK_GAP_MS = 1500;

/** Kinetic visual anchors — sensory grounding for the reading pane. */
export interface AnchorSettings {
  /** Solid block cursor that snaps word to word, instead of a soft highlight. */
  caret: boolean;
  /** Active word pulses in time with the pacing cadence. */
  pulse: boolean;
  /** Everything outside the active clause fades back. */
  spotlight: boolean;
  /** Recognised acronyms render as colour-coded badges. */
  badges: boolean;
}

interface InterceptState {
  open: boolean;
  section: number | null;
  /** Chunk playback resumes from once the summary is accepted. */
  resumeChunk: number | null;
}

/**
 * Presence check — the vigilance device.
 *
 * Everything else in the app assumes a reader is there. Nothing verifies it:
 * the synthesizer speaks to an empty chair exactly as willingly as to someone
 * following along. Periodically the app stops assuming and asks.
 */
export type VigilancePhase = "quiet" | "waiting" | "lapsed";

interface VigilanceState {
  enabled: boolean;
  phase: VigilancePhase;
  /** When the open check was raised, which starts the grace window. */
  raisedAt: number | null;
  /**
   * Last proof that somebody is at the keyboard. A check answered counts, and
   * so does a keystroke in the scratchpad — someone mid-sentence in the pad has
   * already proved the thing the check exists to establish, and interrupting
   * them to prove it again is friction with no yield.
   */
  lastPresenceAt: number;
  answered: number;
  missed: number;
}

/**
 * A cheap, locally-graded check.
 *
 * Held apart from `intercept` on purpose. The intercept is the expensive rung —
 * non-dismissible, free text, optionally graded by a model — and its resume
 * path is load-bearing. These are the cheap rungs: seconds long, marked by the
 * app itself, and fired often enough that coasting between intercepts stops
 * being possible.
 */
interface CheckState {
  kind: "grid" | "cloze" | null;
  /** Table block under interrogation, for a grid check. */
  block: number | null;
  /** Prepared blanks, for a cloze check. */
  cloze: ClozeCheck | null;
  /** Chunk playback resumes from once the check is cleared. */
  resumeChunk: number | null;
}

interface FocusState {
  doc: ParsedDoc | null;

  isPlaying: boolean;
  rate: number;
  view: ViewMode;
  tokenIndex: number;
  chunkIndex: number;
  voiceURI: string | null;
  /**
   * Bumped by every deliberate position change. The speech engine restarts its
   * utterance when this changes, which is what makes a seek audible immediately
   * without the engine having to depend on the (per-word) token index.
   */
  seekNonce: number;

  anchors: AnchorSettings;

  intercept: InterceptState;
  summaries: Record<number, string>;
  nodes: FlowNode[];

  check: CheckState;
  vigilance: VigilanceState;
  /**
   * Token the cheap-check cadence is measured from. Reset by every deliberate
   * position change, so seeking around a document cannot bank credit toward a
   * check over text that was never read.
   */
  lastCheckToken: number;
  /**
   * What the retrieval queue says this reader keeps losing, keyed by term.
   * Read from IndexedDB rather than derived, and refreshed whenever an answer
   * changes it — the reading engine consults it synchronously when it builds a
   * spot check, and a promise there would arm the check a beat late.
   */
  weakTerms: WeakTerms;
  /** Grid blocks already answered correctly — never asked about twice. */
  gridsPassed: Record<number, boolean>;
  /** Attempts spent on each grid block, which also varies the cell asked. */
  gridAttempts: Record<number, number>;

  wordsSpoken: number;
  activeMs: number;
  lastTickAt: number | null;

  loadDoc: (doc: ParsedDoc) => void;
  clearDoc: () => void;
  renameDoc: (title: string) => void;
  hydrateSession: (docId: string) => Promise<void>;

  setPlaying: (playing: boolean) => void;
  togglePlaying: () => void;
  setRate: (rate: number) => void;
  nudgeRate: (delta: number) => void;
  setView: (view: ViewMode) => void;
  setVoice: (uri: string | null) => void;
  toggleAnchor: (key: keyof AnchorSettings) => void;

  /**
   * Position update driven by the synthesizer itself (word boundaries, chunk
   * advance). Deliberately does NOT bump seekNonce -- if it did, every spoken
   * word would restart the utterance.
   */
  advanceToken: (index: number) => void;
  seekToken: (index: number) => void;
  seekChunk: (index: number) => void;
  seekSection: (index: number) => void;
  stepSentence: (delta: number) => void;

  armIntercept: (section: number, resumeChunk: number) => void;
  submitSummary: (text: string) => void;
  abandonIntercept: () => void;

  armGridCheck: (block: number, resumeChunk: number) => void;
  armCloze: (cloze: ClozeCheck, resumeChunk: number) => void;
  /** Check cleared: resume where playback left off. */
  passCheck: () => void;
  /** Grid answered wrong: rewind and play the matrix again. */
  replayGrid: () => void;
  abandonCheck: () => void;
  noteCheckPoint: (tokenIndex: number) => void;
  /** Re-read the queue's account of which terms are not sticking. */
  refreshWeakTerms: () => Promise<void>;

  toggleVigilance: () => void;
  raiseVigilance: () => void;
  /** Someone is at the keyboard. Clears an open check and refreshes the clock. */
  notePresence: () => void;
  lapseVigilance: () => void;
  clearLapse: () => void;

  addNode: (text: string, tag: LogicTag | null) => void;
  retagNode: (id: string, tag: LogicTag | null) => void;
  removeNode: (id: string) => void;

  tickWord: () => void;
  effectiveWpm: () => number;
}

function clampRate(r: number): number {
  return Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(r * 10) / 10));
}

const IDLE_CHECK: CheckState = {
  kind: null,
  block: null,
  cloze: null,
  resumeChunk: null,
};

/**
 * Vigilance resets with the document, except for whether it is switched on:
 * that is a preference about how the reader wants to be held to the page, not
 * state belonging to one document.
 */
function freshVigilance(): VigilanceState {
  return {
    enabled: true,
    phase: "quiet",
    raisedAt: null,
    lastPresenceAt: Date.now(),
    answered: 0,
    missed: 0,
  };
}

/**
 * Fold a proven interaction into the vigilance state.
 *
 * Any deliberate act — pressing play, answering a check, submitting a summary —
 * establishes exactly what an open presence check is asking for, so it clears
 * one. Without this, a check raised moments before a pause would still be open
 * on resume with its grace window already spent, and the reader would be
 * marked absent for the act of coming back.
 */
function presence(v: VigilanceState): VigilanceState {
  return {
    ...v,
    // A lapse clears the same way, because starting the audio again is the
    // acknowledgment. The miss is already counted; holding the banner up after
    // the reader has demonstrably come back would just be scolding.
    phase: "quiet",
    raisedAt: null,
    lastPresenceAt: Date.now(),
    answered: v.phase === "waiting" ? v.answered + 1 : v.answered,
  };
}

export const useFocusStore = create<FocusState>((set, get) => ({
  doc: null,

  isPlaying: false,
  rate: 1.4,
  view: "standard",
  tokenIndex: 0,
  chunkIndex: 0,
  voiceURI: null,
  seekNonce: 0,

  anchors: { caret: true, pulse: true, spotlight: true, badges: true },

  intercept: { open: false, section: null, resumeChunk: null },
  summaries: {},
  nodes: [],

  check: IDLE_CHECK,
  vigilance: freshVigilance(),
  lastCheckToken: 0,
  weakTerms: {},
  gridsPassed: {},
  gridAttempts: {},

  wordsSpoken: 0,
  activeMs: 0,
  lastTickAt: null,

  loadDoc: (doc) => {
    set({
      doc,
      isPlaying: false,
      tokenIndex: 0,
      chunkIndex: 0,
      seekNonce: get().seekNonce + 1,
      intercept: { open: false, section: null, resumeChunk: null },
      summaries: {},
      nodes: [],
      check: IDLE_CHECK,
      vigilance: { ...freshVigilance(), enabled: get().vigilance.enabled },
      lastCheckToken: 0,
      gridsPassed: {},
      gridAttempts: {},
      wordsSpoken: 0,
      activeMs: 0,
      lastTickAt: null,
    });
    void db.saveDoc(doc);
  },

  clearDoc: () =>
    set({
      doc: null,
      isPlaying: false,
      tokenIndex: 0,
      chunkIndex: 0,
      intercept: { open: false, section: null, resumeChunk: null },
      summaries: {},
      nodes: [],
      check: IDLE_CHECK,
      vigilance: { ...freshVigilance(), enabled: get().vigilance.enabled },
      lastCheckToken: 0,
      gridsPassed: {},
      gridAttempts: {},
    }),

  renameDoc: (title) => {
    const trimmed = title.trim();
    const doc = get().doc;
    if (!doc || !trimmed || trimmed === doc.title) return;

    const renamed = { ...doc, title: trimmed };
    set({ doc: renamed });
    void db.saveDoc(renamed);
  },

  hydrateSession: async (docId) => {
    const session = await db.getSession(docId);
    if (!session) return;
    const doc = get().doc;
    if (!doc || doc.id !== docId) return;

    const tokenIndex = Math.min(Math.max(0, session.tokenIndex), Math.max(0, doc.tokens.length - 1));
    set({
      tokenIndex,
      chunkIndex: doc.tokens[tokenIndex]?.chunk ?? 0,
      seekNonce: get().seekNonce + 1,
      nodes: session.nodes ?? [],
      summaries: session.summaries ?? {},
      lastCheckToken: tokenIndex,
    });
  },

  setPlaying: (playing) =>
    set((s) => ({
      isPlaying: playing && !s.intercept.open && s.check.kind === null,
      lastTickAt: playing ? Date.now() : null,
    })),

  togglePlaying: () => {
    const { isPlaying, intercept, check, doc, vigilance } = get();
    if (!doc || intercept.open || check.kind !== null) return;
    set({
      isPlaying: !isPlaying,
      lastTickAt: isPlaying ? null : Date.now(),
      vigilance: presence(vigilance),
    });
  },

  setRate: (rate) => set({ rate: clampRate(rate) }),

  nudgeRate: (delta) => set((s) => ({ rate: clampRate(s.rate + delta) })),

  setView: (view) => set({ view }),

  setVoice: (voiceURI) => set({ voiceURI }),

  toggleAnchor: (key) =>
    set((s) => ({ anchors: { ...s.anchors, [key]: !s.anchors[key] } })),

  advanceToken: (index) => {
    const doc = get().doc;
    if (!doc || !doc.tokens.length) return;
    const i = Math.min(Math.max(0, index), doc.tokens.length - 1);
    set({ tokenIndex: i, chunkIndex: doc.tokens[i].chunk });
  },

  seekToken: (index) => {
    const doc = get().doc;
    if (!doc || !doc.tokens.length) return;
    const i = Math.min(Math.max(0, index), doc.tokens.length - 1);
    set((s) => ({
      tokenIndex: i,
      chunkIndex: doc.tokens[i].chunk,
      seekNonce: s.seekNonce + 1,
      lastCheckToken: i,
    }));
  },

  seekChunk: (index) => {
    const doc = get().doc;
    if (!doc || !doc.chunks.length) return;
    const i = Math.min(Math.max(0, index), doc.chunks.length - 1);
    set((s) => ({
      chunkIndex: i,
      tokenIndex: doc.chunks[i].tokenStart,
      seekNonce: s.seekNonce + 1,
      lastCheckToken: doc.chunks[i].tokenStart,
    }));
  },

  seekSection: (index) => {
    const doc = get().doc;
    const section = doc?.sections[index];
    if (!doc || !section) return;
    set((s) => ({
      chunkIndex: section.chunkStart,
      tokenIndex: section.tokenStart,
      seekNonce: s.seekNonce + 1,
      intercept: { open: false, section: null, resumeChunk: null },
      check: IDLE_CHECK,
      lastCheckToken: section.tokenStart,
    }));
  },

  stepSentence: (delta) => {
    const { doc, chunkIndex } = get();
    if (!doc || !doc.chunks.length) return;
    const next = Math.min(Math.max(0, chunkIndex + delta), doc.chunks.length - 1);
    set((s) => ({
      chunkIndex: next,
      tokenIndex: doc.chunks[next].tokenStart,
      seekNonce: s.seekNonce + 1,
      // Skipping forward must not bank credit toward a check over text that
      // was skipped rather than heard.
      lastCheckToken: doc.chunks[next].tokenStart,
    }));
  },

  armIntercept: (section, resumeChunk) =>
    set({
      isPlaying: false,
      lastTickAt: null,
      intercept: { open: true, section, resumeChunk },
    }),

  submitSummary: (text) => {
    const { intercept, doc } = get();
    if (intercept.section === null || !doc) return;

    const summary = text.trim();
    const summaries = { ...get().summaries, [intercept.section]: summary };
    const resume = intercept.resumeChunk;
    const section = doc.sections[intercept.section];

    set({
      summaries,
      seekNonce: get().seekNonce + 1,
      intercept: { open: false, section: null, resumeChunk: null },
      ...(resume !== null && doc.chunks[resume]
        ? {
            chunkIndex: resume,
            tokenIndex: doc.chunks[resume].tokenStart,
            lastCheckToken: doc.chunks[resume].tokenStart,
          }
        : {}),
      isPlaying: true,
      lastTickAt: Date.now(),
      vigilance: presence(get().vigilance),
    });

    // A summary is worth more than the moment it was written in. It enters the
    // retrieval queue as a self-graded item: at review the section title comes
    // back without the text, and the reader's own sentence is the answer key.
    if (section) {
      void db.recordAnswer(
        {
          id: summaryId(doc.id, section.i),
          docId: doc.id,
          docTitle: doc.title,
          kind: "summary",
          prompt: section.title,
          answer: summary,
          context: `${section.wordCount.toLocaleString()} words`,
          section: section.i,
        },
        QUALITY.good
      );
    }
  },

  abandonIntercept: () => {
    const { intercept, doc } = get();
    const resume = intercept.resumeChunk;
    set({
      intercept: { open: false, section: null, resumeChunk: null },
      isPlaying: false,
      lastTickAt: null,
      seekNonce: get().seekNonce + 1,
      ...(resume !== null && doc?.chunks[resume]
        ? { chunkIndex: resume, tokenIndex: doc.chunks[resume].tokenStart }
        : {}),
    });
  },

  /* ---- Cheap checks ---------------------------------------------------- */

  armGridCheck: (block, resumeChunk) =>
    set((s) => ({
      isPlaying: false,
      lastTickAt: null,
      check: { kind: "grid", block, cloze: null, resumeChunk },
      gridAttempts: {
        ...s.gridAttempts,
        [block]: (s.gridAttempts[block] ?? 0) + 1,
      },
    })),

  armCloze: (cloze, resumeChunk) =>
    set({
      isPlaying: false,
      lastTickAt: null,
      check: { kind: "cloze", block: null, cloze, resumeChunk },
    }),

  passCheck: () => {
    const { check, doc } = get();
    const resume = check.resumeChunk;
    const passedGrid = check.kind === "grid" && check.block !== null;

    set((s) => ({
      check: IDLE_CHECK,
      seekNonce: s.seekNonce + 1,
      gridsPassed:
        passedGrid && check.block !== null
          ? { ...s.gridsPassed, [check.block]: true }
          : s.gridsPassed,
      ...(resume !== null && doc?.chunks[resume]
        ? {
            chunkIndex: resume,
            tokenIndex: doc.chunks[resume].tokenStart,
            lastCheckToken: doc.chunks[resume].tokenStart,
          }
        : {}),
      isPlaying: true,
      lastTickAt: Date.now(),
      vigilance: presence(s.vigilance),
    }));
  },

  /**
   * A wrong grid answer sends the matrix round again from the top. The replay
   * *is* the correction: the cards that were spoken past are spoken again, and
   * the next question draws a different cell, so getting through needs the
   * whole grid rather than one remembered card.
   */
  replayGrid: () => {
    const { check, doc } = get();
    const block = check.block !== null ? doc?.blocks[check.block] : undefined;
    const firstChunk = block?.chunks[0];

    if (!doc || firstChunk === undefined) {
      get().passCheck();
      return;
    }

    set((s) => ({
      check: IDLE_CHECK,
      chunkIndex: firstChunk,
      tokenIndex: doc.chunks[firstChunk].tokenStart,
      lastCheckToken: doc.chunks[firstChunk].tokenStart,
      seekNonce: s.seekNonce + 1,
      isPlaying: true,
      lastTickAt: Date.now(),
      vigilance: presence(s.vigilance),
    }));
  },

  abandonCheck: () => {
    const { check, doc } = get();
    const resume = check.resumeChunk;
    set((s) => ({
      check: IDLE_CHECK,
      isPlaying: false,
      lastTickAt: null,
      seekNonce: s.seekNonce + 1,
      ...(resume !== null && doc?.chunks[resume]
        ? { chunkIndex: resume, tokenIndex: doc.chunks[resume].tokenStart }
        : {}),
    }));
  },

  noteCheckPoint: (tokenIndex) => set({ lastCheckToken: tokenIndex }),

  /**
   * Deliberately not reset by `loadDoc`. Difficulty is a property of the reader
   * and the term, not of the document open at the time — the whole point of
   * keying it by term is that a word lost in the GCDMP is asked about again in
   * ICH E6.
   */
  refreshWeakTerms: async () => {
    set({ weakTerms: await db.weakTerms() });
  },

  /* ---- Vigilance ------------------------------------------------------- */

  toggleVigilance: () =>
    set((s) => ({
      vigilance: {
        ...s.vigilance,
        enabled: !s.vigilance.enabled,
        phase: "quiet",
        raisedAt: null,
        lastPresenceAt: Date.now(),
      },
    })),

  raiseVigilance: () =>
    set((s) =>
      s.vigilance.phase === "quiet"
        ? { vigilance: { ...s.vigilance, phase: "waiting", raisedAt: Date.now() } }
        : {}
    ),

  notePresence: () => set((s) => ({ vigilance: presence(s.vigilance) })),

  lapseVigilance: () =>
    set((s) =>
      s.vigilance.phase === "waiting"
        ? {
            isPlaying: false,
            lastTickAt: null,
            vigilance: {
              ...s.vigilance,
              phase: "lapsed",
              raisedAt: null,
              missed: s.vigilance.missed + 1,
            },
          }
        : {}
    ),

  clearLapse: () =>
    set((s) => ({
      vigilance: {
        ...s.vigilance,
        phase: "quiet",
        raisedAt: null,
        lastPresenceAt: Date.now(),
      },
    })),

  addNode: (text, tag) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const { doc, tokenIndex } = get();
    const node: FlowNode = {
      id: `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      tag,
      text: trimmed,
      section: doc?.tokens[tokenIndex]?.section ?? 0,
      tokenIndex,
      createdAt: Date.now(),
    };
    set((s) => ({ nodes: [...s.nodes, node] }));
  },

  retagNode: (id, tag) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, tag } : n)),
    })),

  removeNode: (id) => set((s) => ({ nodes: s.nodes.filter((n) => n.id !== id) })),

  tickWord: () => {
    const now = Date.now();
    const { lastTickAt, wordsSpoken, activeMs } = get();
    const gap = lastTickAt === null ? 0 : Math.min(now - lastTickAt, MAX_TICK_GAP_MS);
    set({ wordsSpoken: wordsSpoken + 1, activeMs: activeMs + gap, lastTickAt: now });
  },

  effectiveWpm: () => {
    const { wordsSpoken, activeMs, rate } = get();
    // Quantized so the value is stable between words: this is read by selectors
    // in the header and the structure map, and an integer that moved on every
    // boundary event would re-render both sixty times a minute.
    const quantize = (wpm: number) => Math.round(wpm / 5) * 5;

    // Trust telemetry only once there is a usable sample.
    if (wordsSpoken > 25 && activeMs > 4000) {
      return quantize(wordsSpoken / (activeMs / 60000));
    }
    return quantize(BASELINE_WPM * rate);
  },
}));

/** Section index for a token, used to keep the sidebar and notes in sync. */
export function sectionOfToken(doc: ParsedDoc | null, tokenIndex: number): number {
  return doc?.tokens[tokenIndex]?.section ?? 0;
}

"use client";

import { create } from "zustand";

import { db } from "@/lib/db";
import {
  BASELINE_WPM,
  loadPace,
  noteWords,
  savePace,
  solveRate,
  type PaceTable,
} from "@/lib/pace";
import { firstContentToken } from "@/lib/parse";
import type { ClozeCheck } from "@/lib/quiz";
import { QUALITY, summaryId, type WeakTerms } from "@/lib/review";
import type { ClozeResult, FlowNode, LogicTag, ParsedDoc, ViewMode } from "@/lib/types";

/**
 * The rate range the synthesizer is asked for. Not a control any more — the
 * reader asks for a reading speed and this is what the solver is allowed to
 * choose between to deliver it.
 */
export const MIN_RATE = 1.0;
export const MAX_RATE = 3.0;
export const RATE_STEP = 0.1;

/**
 * The speed control, in words per minute.
 *
 * The floor is slower than any voice reads at rate 1.0 and the ceiling is
 * faster than any has been measured to reach, deliberately: the control's job
 * is to let the reader ask, and the app's job is to say plainly when the answer
 * is no. A range trimmed to what happens to be reachable would hide exactly the
 * fact this replaced a control that quietly did not deliver.
 */
export const MIN_WPM = 120;
export const MAX_WPM = 480;
export const WPM_STEP = 10;

/**
 * Reading covered between cheap checks. Roughly a third of the 700-word pacing
 * checkpoint, so two or three cloze checks land inside every stretch that ends
 * in a full intercept — cheap checks often, expensive ones rarely.
 */
export const CLOZE_INTERVAL_TOKENS = 250;

/** Re-exported so the engine and the keyboard hook keep one import site. */
export { MAX_GRID_ATTEMPTS } from "@/lib/quiz";

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
  /**
   * What the reader asked for, in words per minute. This is the control.
   *
   * `rate` below is derived from it and is not set directly by anything the
   * reader touches — the multiplier means something different on every voice,
   * so it is an implementation detail of hitting this number rather than a
   * setting in its own right.
   */
  targetWpm: number;
  /** Multiplier handed to the synthesizer, solved from `targetWpm`. */
  rate: number;
  /** What each voice has been heard to deliver at each rate. */
  pace: PaceTable;
  /**
   * Reading accumulated against the voice and rate that produced it, not yet
   * folded into `pace`. Held apart because a word is far too small a unit to
   * price a rate with, and rebuilding the table on every boundary event would
   * be sixty object allocations a minute for a number that moves in hours.
   */
  paceRun: { voiceURI: string | null; rate: number; words: number; ms: number } | null;
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
  /**
   * Node the next capture attaches to, or null for a loose note. Not part of
   * the session: it is where the reader's hand is, not what they recorded.
   */
  chainHead: string | null;

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
  /**
   * True once this document's stored session has been read back (or found not
   * to exist). The session writer waits on it: `loadDoc` resets captures to
   * empty and `hydrateSession` fills them in a tick later, so a writer that did
   * not wait could persist the empty state over a real session — losing every
   * node and summary for a document whose hydration happened to be slow.
   */
  hydrated: boolean;
  /** Grid blocks already answered correctly — never asked about twice. */
  gridsPassed: Record<number, boolean>;
  /** Attempts spent on each grid block, which also varies the cell asked. */
  gridAttempts: Record<number, number>;
  /**
   * Spot checks answered, keyed by the token their window ended at.
   *
   * The third rung's evidence. The intercept left a summary behind and the grid
   * left a pass, but the cheap rung — the one that fires most often and covers
   * the most ground — was marked, shown to the reader for eight seconds and
   * then discarded. Which meant the app could say how far the caret had got and
   * could not say which of it anybody had been made to account for.
   */
  clozeChecks: Record<number, ClozeResult>;

  wordsSpoken: number;
  activeMs: number;
  lastTickAt: number | null;

  loadDoc: (doc: ParsedDoc) => void;
  clearDoc: () => void;
  renameDoc: (title: string) => void;
  hydrateSession: (docId: string) => Promise<void>;

  setPlaying: (playing: boolean) => void;
  togglePlaying: () => void;
  /** Ask for a reading speed. The rate that delivers it is solved for. */
  setTargetWpm: (wpm: number) => void;
  nudgeTargetWpm: (delta: number) => void;
  /**
   * Read the remembered pace table and the remembered target.
   *
   * Called from an effect rather than folded into the store's initial state: a
   * `"use client"` store is still evaluated on the server, and a value read
   * from `localStorage` differs between the two renders, which is a hydration
   * error rather than a stale number.
   */
  hydratePace: () => void;
  /** Fold the open run into the table. Called when the voice, rate or playback changes. */
  settlePace: () => void;
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
  /**
   * `cued` records that the reader revealed the section's anchors first. It
   * changes the retrieval record, not what the section owes — see
   * `ReviewItem.cued`.
   */
  submitSummary: (text: string, cued?: boolean) => void;
  abandonIntercept: () => void;

  armGridCheck: (block: number, resumeChunk: number) => void;
  armCloze: (cloze: ClozeCheck, resumeChunk: number) => void;
  /** Check cleared: resume where playback left off. */
  passCheck: () => void;
  /** Grid answered wrong: rewind and play the matrix again. */
  replayGrid: () => void;
  /** Record what a spot check established, before it is cleared. */
  noteClozeResult: (result: ClozeResult) => void;
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

  /**
   * Commit a capture. `parked` marks it as an intrusive thought rather than a
   * piece of the argument — see `FlowNode.parked`.
   */
  addNode: (text: string, tag: LogicTag | null, parked?: boolean) => void;
  retagNode: (id: string, tag: LogicTag | null) => void;
  removeNode: (id: string) => void;
  /** Draw an edge. Refused if it would close a cycle. */
  linkNodes: (from: string, to: string) => void;
  unlinkNodes: (from: string, to: string) => void;
  /**
   * The node the next capture links from, and which then becomes the head
   * itself — so capturing entity, mechanism, output in a row builds the chain
   * without a single extra keystroke.
   */
  setChainHead: (id: string | null) => void;

  tickWord: () => void;
  effectiveWpm: () => number;
}

function clampRate(r: number): number {
  return Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(r * 10) / 10));
}

function clampWpm(w: number): number {
  if (!Number.isFinite(w)) return BASELINE_WPM;
  return Math.min(MAX_WPM, Math.max(MIN_WPM, Math.round(w / WPM_STEP) * WPM_STEP));
}

/** Where the asked-for reading speed is remembered, beside the chosen voice. */
const TARGET_KEY = "focusparse:wpm";

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
  // 260 wpm at the baseline is rate 1.4, which is what this control used to
  // start on. An uncalibrated voice therefore reads exactly as it did before.
  targetWpm: 260,
  rate: 1.4,
  pace: {},
  paceRun: null,
  view: "standard",
  tokenIndex: 0,
  chunkIndex: 0,
  voiceURI: null,
  seekNonce: 0,

  anchors: { caret: true, pulse: true, spotlight: true, badges: true },

  intercept: { open: false, section: null, resumeChunk: null },
  summaries: {},
  nodes: [],
  chainHead: null,

  check: IDLE_CHECK,
  vigilance: freshVigilance(),
  lastCheckToken: 0,
  weakTerms: {},
  hydrated: false,
  gridsPassed: {},
  gridAttempts: {},
  clozeChecks: {},

  wordsSpoken: 0,
  activeMs: 0,
  lastTickAt: null,

  loadDoc: (doc) => {
    // Past the citation line, the author list and the abstract — where a
    // published chapter starts saying anything. A stored session overrides this
    // a tick later, so resuming a document is unaffected.
    const start = firstContentToken(doc);
    set({
      doc,
      isPlaying: false,
      tokenIndex: start,
      chunkIndex: doc.tokens[start]?.chunk ?? 0,
      seekNonce: get().seekNonce + 1,
      intercept: { open: false, section: null, resumeChunk: null },
      summaries: {},
      nodes: [],
      chainHead: null,
      check: IDLE_CHECK,
      vigilance: { ...freshVigilance(), enabled: get().vigilance.enabled },
      lastCheckToken: start,
      hydrated: false,
      gridsPassed: {},
      gridAttempts: {},
      clozeChecks: {},
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
      chainHead: null,
      check: IDLE_CHECK,
      vigilance: { ...freshVigilance(), enabled: get().vigilance.enabled },
      lastCheckToken: 0,
      hydrated: false,
      gridsPassed: {},
      gridAttempts: {},
      clozeChecks: {},
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
    const doc = get().doc;
    if (!doc || doc.id !== docId) return;

    // Marked hydrated on every path, including "there was nothing to restore".
    // A freshly ingested document has no session, and if that case did not
    // arrive here the writer would stay blocked and the first reading of a new
    // document would never be saved at all.
    if (!session) {
      set({ hydrated: true });
      return;
    }

    const tokenIndex = Math.min(Math.max(0, session.tokenIndex), Math.max(0, doc.tokens.length - 1));
    set({
      tokenIndex,
      chunkIndex: doc.tokens[tokenIndex]?.chunk ?? 0,
      seekNonce: get().seekNonce + 1,
      nodes: session.nodes ?? [],
      summaries: session.summaries ?? {},
      // Absent on every session written before grid results were persisted.
      gridsPassed: session.gridsPassed ?? {},
      gridAttempts: session.gridAttempts ?? {},
      // And on every session written before spot-check results were.
      clozeChecks: session.clozeChecks ?? {},
      lastCheckToken: tokenIndex,
      hydrated: true,
    });
  },

  setPlaying: (playing) => {
    // Stopping closes the run. Not for tidiness: the table is what survives the
    // tab, and a reader who reads for an hour and closes the window should not
    // find the voice uncalibrated tomorrow.
    if (!playing) get().settlePace();
    set((s) => ({
      isPlaying: playing && !s.intercept.open && s.check.kind === null,
      lastTickAt: playing ? Date.now() : null,
    }));
  },

  togglePlaying: () => {
    const { isPlaying, intercept, check, doc, vigilance } = get();
    if (!doc || intercept.open || check.kind !== null) return;
    if (isPlaying) get().settlePace();
    set({
      isPlaying: !isPlaying,
      lastTickAt: isPlaying ? null : Date.now(),
      vigilance: presence(vigilance),
    });
  },

  /**
   * Ask for a reading speed, and solve for the rate that delivers it.
   *
   * Solved rather than servoed. A controller that nudged the rate as it read
   * would be cancelling and restarting the utterance every time it corrected —
   * `rate` is a dependency of the speech engine's effect — so the caret would
   * jump back to the start of the sentence at intervals nobody asked for. The
   * rate changes only when the reader changes something: the target, or the
   * voice.
   */
  setTargetWpm: (wpm) => {
    const targetWpm = clampWpm(wpm);
    // The open run was read at the old rate, and letting it merge into the new
    // one would price both wrongly.
    get().settlePace();
    const solved = solveRate(get().pace, get().voiceURI, targetWpm, MIN_RATE, MAX_RATE);
    set({ targetWpm, rate: solved.rate });

    try {
      window.localStorage.setItem(TARGET_KEY, String(targetWpm));
    } catch {
      // Private mode: the speed lasts the session and no longer.
    }
  },

  nudgeTargetWpm: (delta) => get().setTargetWpm(get().targetWpm + delta),

  hydratePace: () => {
    const pace = loadPace();
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(TARGET_KEY);
    } catch {
      // Private mode. The default stands.
    }
    const targetWpm = stored ? clampWpm(Number(stored)) : get().targetWpm;
    const solved = solveRate(pace, get().voiceURI, targetWpm, MIN_RATE, MAX_RATE);
    set({ pace, targetWpm, rate: solved.rate });
  },

  /**
   * Fold the open run of reading into the table.
   *
   * A run belongs to one voice at one rate, so it has to be closed before
   * either changes. Short runs are dropped rather than kept: a handful of words
   * between two pauses says nothing about a pace, and the table's own sample
   * floor would ignore them anyway — but only after they had diluted a real
   * measurement they were averaged into.
   */
  settlePace: () => {
    const { paceRun, pace } = get();
    if (!paceRun || paceRun.words <= 0 || paceRun.ms <= 0) {
      if (paceRun) set({ paceRun: null });
      return;
    }
    const next = noteWords(pace, paceRun.voiceURI, paceRun.rate, paceRun.words, paceRun.ms);
    set({ pace: next, paceRun: null });
    savePace(next);
  },

  setView: (view) => set({ view }),

  /**
   * Remembered across sessions. The choice is a property of the machine's
   * installed voices rather than of any document, so it lives in localStorage
   * rather than in a session record — and it is written here, from an action,
   * never during render.
   */
  setVoice: (voiceURI) => {
    // Close the run against the voice that actually read it, then re-solve:
    // the reader asked for a reading speed, not for a multiplier, and the
    // multiplier that delivers it is different on the voice being switched to.
    // Carrying the target across the switch is the point of having one.
    get().settlePace();
    const solved = solveRate(get().pace, voiceURI, get().targetWpm, MIN_RATE, MAX_RATE);
    set({ voiceURI, rate: solved.rate });
    try {
      if (voiceURI) window.localStorage.setItem("focusparse:voice", voiceURI);
      else window.localStorage.removeItem("focusparse:voice");
    } catch {
      // Private mode: the voice simply is not remembered.
    }
  },

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

  submitSummary: (text, cued = false) => {
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
          // Written down rather than inferred later. Nothing downstream can
          // tell a cued sentence from a free one by reading it.
          cued,
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

  /**
   * Record what a spot check established.
   *
   * Called from the dialog at the moment of marking rather than from
   * `passCheck`, because the two are not the same event: a reader can mark a
   * check and then leave with "Stop reading here", and the answers they gave
   * are evidence whether or not they carried on. Keyed by the window's end, so
   * re-reading a stretch replaces its evidence rather than doubling it.
   */
  noteClozeResult: (result) =>
    set((s) => ({ clozeChecks: { ...s.clozeChecks, [result.to]: result } })),

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

  addNode: (text, tag, parked = false) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const { doc, tokenIndex, chainHead, nodes } = get();
    const node: FlowNode = {
      id: `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      tag: parked ? null : tag,
      text: trimmed,
      section: doc?.tokens[tokenIndex]?.section ?? 0,
      tokenIndex,
      createdAt: Date.now(),
      ...(parked ? { parked: true } : {}),
    };

    // A parked thought is off-topic by definition, so it must not attach to the
    // open chain and must not become the next head. Letting it do either would
    // splice "renew the car insurance" into the middle of the argument the
    // reader is building, which is the whole thing this exists to prevent.
    if (parked) {
      set((s) => ({ nodes: [...s.nodes, node] }));
      return;
    }

    // Capturing into an open chain attaches to it and then hands the chain on,
    // so entity → mechanism → output is three ordinary captures and no extra
    // keystrokes. A head that has since been deleted is simply ignored.
    const head = chainHead && nodes.some((n) => n.id === chainHead) ? chainHead : null;

    set((s) => ({
      nodes: [
        ...s.nodes.map((n) =>
          n.id === head ? { ...n, links: [...(n.links ?? []), node.id] } : n
        ),
        node,
      ],
      chainHead: head ? node.id : s.chainHead,
    }));
  },

  retagNode: (id, tag) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, tag } : n)),
    })),

  removeNode: (id) =>
    set((s) => ({
      // Edges into a deleted node go with it. A dangling id would render as a
      // line to nowhere and survive every save.
      nodes: s.nodes
        .filter((n) => n.id !== id)
        .map((n) =>
          (n.links ?? []).includes(id)
            ? { ...n, links: (n.links ?? []).filter((l) => l !== id) }
            : n
        ),
      chainHead: s.chainHead === id ? null : s.chainHead,
    })),

  /**
   * Add an edge, unless it would close a cycle.
   *
   * The graph is a claim about direction — this entity is acted on by that
   * mechanism, which produces that output — and a cycle is not a subtler claim,
   * it is an unreadable one. It also makes the layered view unlayerable. Cheap
   * to prevent at the only point edges are created.
   */
  linkNodes: (from, to) => {
    if (from === to) return;
    const { nodes } = get();
    if (!nodes.some((n) => n.id === from) || !nodes.some((n) => n.id === to)) return;
    if ((nodes.find((n) => n.id === from)?.links ?? []).includes(to)) return;

    const byId = new Map(nodes.map((n) => [n.id, n]));
    const seen = new Set<string>();
    const stack = [to];
    while (stack.length) {
      const at = stack.pop() as string;
      if (at === from) return; // `to` already reaches `from`
      if (seen.has(at)) continue;
      seen.add(at);
      stack.push(...(byId.get(at)?.links ?? []));
    }

    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === from ? { ...n, links: [...(n.links ?? []), to] } : n
      ),
    }));
  },

  unlinkNodes: (from, to) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === from ? { ...n, links: (n.links ?? []).filter((l) => l !== to) } : n
      ),
    })),

  setChainHead: (id) => set({ chainHead: id }),

  tickWord: () => {
    const now = Date.now();
    const { lastTickAt, wordsSpoken, activeMs, paceRun, rate, voiceURI } = get();
    const gap = lastTickAt === null ? 0 : Math.min(now - lastTickAt, MAX_TICK_GAP_MS);

    // The same word, counted twice: once for this document's live pace and once
    // against the voice and rate that produced it, which outlives the document.
    // A stall longer than MAX_TICK_GAP_MS is excluded from both — a reader who
    // walked away did not read slowly, and a voice must not be priced as though
    // they had.
    const open =
      paceRun && paceRun.rate === rate && paceRun.voiceURI === (voiceURI ?? null)
        ? paceRun
        : { voiceURI: voiceURI ?? null, rate, words: 0, ms: 0 };

    set({
      wordsSpoken: wordsSpoken + 1,
      activeMs: activeMs + gap,
      lastTickAt: now,
      paceRun: { ...open, words: open.words + 1, ms: open.ms + gap },
    });
  },

  effectiveWpm: () => {
    const { wordsSpoken, activeMs } = get();
    // Quantized so the value is stable between words: this is read by selectors
    // in the header and the structure map, and an integer that moved on every
    // boundary event would re-render both sixty times a minute.
    const quantize = (wpm: number) => Math.round(wpm / 5) * 5;

    // Trust telemetry only once there is a usable sample.
    if (wordsSpoken > 25 && activeMs > 4000) {
      return quantize(wordsSpoken / (activeMs / 60000));
    }
    // Before that, what this voice has been heard to do at this rate — which
    // for a voice never heard is the old `BASELINE_WPM * rate` exactly. The
    // sidebar's "time left" is built on this, and starting a long document on a
    // baseline that a calibrated voice already disagrees with makes every
    // estimate in the structure map wrong for the first minute of reading.
    return quantize(
      solveRate(get().pace, get().voiceURI, get().targetWpm, MIN_RATE, MAX_RATE)
        .expectedWpm
    );
  },
}));

/** Section index for a token, used to keep the sidebar and notes in sync. */
/**
 * The nodes that are part of the reading, which is not all of them.
 *
 * Parked thoughts are stored beside the real captures — they have to survive a
 * reload, and they carry the token they were dropped at so the reader can get
 * back to where they were. What they must never do is appear anywhere the
 * reader is thinking *about the document*: the graph, the list, or the summary
 * box's captures. One predicate, so a new surface cannot forget.
 */
export function readingNodes(nodes: FlowNode[]): FlowNode[] {
  return nodes.filter((n) => !n.parked);
}

/** The opposite half, for the drawer that hands them back. */
export function parkedNodes(nodes: FlowNode[]): FlowNode[] {
  return nodes.filter((n) => n.parked);
}

export function sectionOfToken(doc: ParsedDoc | null, tokenIndex: number): number {
  return doc?.tokens[tokenIndex]?.section ?? 0;
}

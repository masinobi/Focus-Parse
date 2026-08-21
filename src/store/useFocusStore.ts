"use client";

import { create } from "zustand";

import { db } from "@/lib/db";
import type { FlowNode, LogicTag, ParsedDoc, ViewMode } from "@/lib/types";

export const MIN_RATE = 1.0;
export const MAX_RATE = 3.0;
export const RATE_STEP = 0.1;

/** Words-per-minute assumed for a fresh session before telemetry accumulates. */
const BASELINE_WPM = 185;

/** Boundary gaps longer than this are treated as stalls, not reading time. */
const MAX_TICK_GAP_MS = 1500;

interface InterceptState {
  open: boolean;
  section: number | null;
  /** Chunk playback resumes from once the summary is accepted. */
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

  intercept: InterceptState;
  summaries: Record<number, string>;
  nodes: FlowNode[];

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

  addNode: (text: string, tag: LogicTag | null) => void;
  retagNode: (id: string, tag: LogicTag | null) => void;
  removeNode: (id: string) => void;

  tickWord: () => void;
  effectiveWpm: () => number;
}

function clampRate(r: number): number {
  return Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(r * 10) / 10));
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

  intercept: { open: false, section: null, resumeChunk: null },
  summaries: {},
  nodes: [],

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
    });
  },

  setPlaying: (playing) =>
    set((s) => ({
      isPlaying: playing && !s.intercept.open,
      lastTickAt: playing ? Date.now() : null,
    })),

  togglePlaying: () => {
    const { isPlaying, intercept, doc } = get();
    if (!doc || intercept.open) return;
    set({ isPlaying: !isPlaying, lastTickAt: isPlaying ? null : Date.now() });
  },

  setRate: (rate) => set({ rate: clampRate(rate) }),

  nudgeRate: (delta) => set((s) => ({ rate: clampRate(s.rate + delta) })),

  setView: (view) => set({ view }),

  setVoice: (voiceURI) => set({ voiceURI }),

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
    set((s) => ({ tokenIndex: i, chunkIndex: doc.tokens[i].chunk, seekNonce: s.seekNonce + 1 }));
  },

  seekChunk: (index) => {
    const doc = get().doc;
    if (!doc || !doc.chunks.length) return;
    const i = Math.min(Math.max(0, index), doc.chunks.length - 1);
    set((s) => ({
      chunkIndex: i,
      tokenIndex: doc.chunks[i].tokenStart,
      seekNonce: s.seekNonce + 1,
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

    const summaries = { ...get().summaries, [intercept.section]: text.trim() };
    const resume = intercept.resumeChunk;

    set({
      summaries,
      seekNonce: get().seekNonce + 1,
      intercept: { open: false, section: null, resumeChunk: null },
      ...(resume !== null && doc.chunks[resume]
        ? { chunkIndex: resume, tokenIndex: doc.chunks[resume].tokenStart }
        : {}),
      isPlaying: true,
      lastTickAt: Date.now(),
    });
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

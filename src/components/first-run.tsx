"use client";

import * as React from "react";
import { flushSync } from "react-dom";
import { AudioLines, ClipboardPaste, Loader2, Play, Upload } from "lucide-react";

import { BackupControls } from "@/components/backup-controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { nextStop } from "@/lib/coverage";
import { solveRate } from "@/lib/pace";
import { firstContentToken, parseDocument } from "@/lib/parse";
import { SAMPLE_DOCUMENT } from "@/lib/sample";
import type { ParsedDoc } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  CLOZE_INTERVAL_TOKENS,
  MAX_RATE,
  MIN_RATE,
  useFocusStore,
} from "@/store/useFocusStore";

export const SAMPLE_TITLE = "The Drift Problem";

/**
 * How long Play waits for the view transition to take its snapshot before
 * opening the reader without it. A painted transition reaches its callback in
 * a frame or two; this is only ever reached by one that will not paint.
 */
const TRANSITION_GRACE_MS = 1200;

interface FirstRunProps {
  /** Parse and open pasted text, the same path the full home uses. */
  ingest: (source: string, name?: string) => void;
  readFile: (file: File) => Promise<void>;
  busy: string | null;
  error: string | null;
  /** After a backup is restored, so the loader can find the library it brought. */
  onRestored: () => void;
}

/**
 * What the home is before there is a library.
 *
 * Everything on the full home — the exam date, backup, the corpus tools — is
 * about documents the reader already has, so a first visit sees none of it.
 * What it sees instead is the mechanism: the sample's real opening with the
 * caret on the word the voice will start on, and one button. Pressing it carries
 * those same lines into the reader, so the page does not change so much as the
 * reading starts.
 */
export function FirstRun({ ingest, readFile, busy, error, onRestored }: FirstRunProps) {
  const loadDoc = useFocusStore((s) => s.loadDoc);
  const hydrateSession = useFocusStore((s) => s.hydrateSession);
  const setPlaying = useFocusStore((s) => s.setPlaying);
  const hydratePace = useFocusStore((s) => s.hydratePace);
  const pace = useFocusStore((s) => s.pace);
  const voiceURI = useFocusStore((s) => s.voiceURI);
  const targetWpm = useFocusStore((s) => s.targetWpm);
  const caret = useFocusStore((s) => s.anchors.caret);

  /** `null` until known: the server render cannot ask the browser. */
  const [canSpeak, setCanSpeak] = React.useState<boolean | null>(null);
  const [pasting, setPasting] = React.useState(false);
  const [pasted, setPasted] = React.useState("");
  const [pastedName, setPastedName] = React.useState("");
  const [dragging, setDragging] = React.useState(false);
  const [starting, setStarting] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    hydratePace();
    setCanSpeak("speechSynthesis" in window);
  }, [hydratePace]);

  // Parsed once, here, for the same reason the reader parses it: the opening
  // shown and the distance quoted have to be the document that will play.
  const sample = React.useMemo(() => parseDocument(SAMPLE_DOCUMENT, SAMPLE_TITLE), []);
  const opening = React.useMemo(() => openingOf(sample), [sample]);

  // In words, from the same rule the structure map's gauge uses. In seconds
  // only once this voice has been heard: an unheard voice is assumed to read at
  // the target, and the one this was measured against read the sample at 150
  // wpm against 260 — "about 20 seconds" arrived at 36. Words are exact, and
  // they are the unit the reader's own map uses.
  const firstCheck = React.useMemo(() => {
    const start = firstContentToken(sample);
    const stop = nextStop(sample, start, start, {}, CLOZE_INTERVAL_TOKENS);
    const words = Math.min(stop.toCheck ?? Infinity, stop.toSummary ?? Infinity);
    if (!Number.isFinite(words)) return null;
    const solved = solveRate(pace, voiceURI, targetWpm, MIN_RATE, MAX_RATE);
    const seconds = solved.calibrated
      ? Math.max(5, Math.round(((words / solved.expectedWpm) * 60) / 5) * 5)
      : null;
    return { words, seconds };
  }, [sample, pace, voiceURI, targetWpm]);

  const start = React.useCallback(async () => {
    if (starting) return;
    setStarting(true);
    const doc = parseDocument(SAMPLE_DOCUMENT, SAMPLE_TITLE);
    // Once only: the transition's callback and the fallback below can both
    // reach it, and a second `loadDoc` would reset the reading it just began.
    let opened = false;
    const open = () => {
      if (opened) return;
      opened = true;
      flushSync(() => loadDoc(doc, { firstSession: true }));
    };

    const root = document.documentElement;
    // Keeps the carried sentence lit until the voice reaches it; see
    // `fp-opening-lit` in globals.css. Any move off the heading ends it.
    root.classList.add("fp-opening-lit");
    let arrived = false;
    const unlit = useFocusStore.subscribe((s) => {
      // Nothing to judge until the document is in; after that, leaving it
      // (back to the home) ends the light as surely as reading on does.
      if (!arrived && s.doc?.id !== doc.id) return;
      arrived = true;
      const block = s.doc?.tokens[s.tokenIndex]?.block ?? -1;
      if (s.doc?.id === doc.id && block < 1) return;
      root.classList.remove("fp-opening-lit");
      unlit();
    });

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!still && typeof document.startViewTransition === "function") {
      // The reader's first two blocks take the names the opening carries, so
      // the browser morphs one into the other instead of cutting.
      root.classList.add("fp-arriving");
      const transition = document.startViewTransition(open);
      void transition.finished.finally(() => root.classList.remove("fp-arriving"));
      // A transition the browser never paints (a hidden or throttled tab) never
      // runs its callback, and Play sat disabled with nothing happening. Past
      // the grace the move is skipped and the reader opens without it.
      await Promise.race([
        transition.updateCallbackDone,
        new Promise((resolve) => window.setTimeout(resolve, TRANSITION_GRACE_MS)),
      ]);
      if (!opened) {
        transition.skipTransition();
        root.classList.remove("fp-arriving");
        open();
      }
    } else {
      open();
    }

    // Every load path goes through hydration (the session writer waits on it),
    // and playback starts after it so the seek it makes does not restart the
    // first utterance.
    await hydrateSession(doc.id);
    if (canSpeak) setPlaying(true);
    // Focus follows the reading: the button that had it is gone, and a screen
    // reader left on <body> is told nothing about where it now is.
    document.querySelector<HTMLElement>("[data-reader]")?.focus({ preventScroll: true });
  }, [starting, loadDoc, hydrateSession, setPlaying, canSpeak]);

  /** Play waits for the browser to say whether it can speak, and for a file being read. */
  const ready = canSpeak !== null && busy === null && !starting;

  // Space starts the sample, as it plays in the reader — unless the reader is
  // typing, where a space is a space.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, button, [contenteditable=true]")) return;
      e.preventDefault();
      // The same conditions as the button. Pressed before the browser had
      // answered, Space opened the reader and then never started the voice.
      if (ready) void start();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [start, ready]);

  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      setDragging(false);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void readFile(file);
    },
  };

  return (
    <div
      {...dropProps}
      className="fp-scroll flex h-full flex-col items-center overflow-y-auto px-6 py-10 sm:px-10"
    >
      <div className="my-auto w-full max-w-[42rem]">
        {/* The page's one heading. The sample's title below is the document's,
            hidden from assistive tech inside its labelled figure. */}
        <header className="mb-14 flex items-center gap-2 text-muted-foreground">
          <AudioLines className="h-4 w-4" aria-hidden />
          <h1 className="text-sm font-semibold tracking-tight text-foreground">FocusParse</h1>
        </header>

        {/* The opening, as the reader will set it: the heading in the app's
            sans, the prose in the reading serif, the caret on the first word
            the voice will say. */}
        <figure
          aria-label={`The sample begins: ${opening.title}. ${opening.sentence}`}
          className={cn(caret && "fp-anchor-caret")}
        >
          <p
            aria-hidden
            className="fp-opening-title font-sans text-2xl font-bold tracking-tight"
          >
            {opening.title.split(" ").map((w, i) => (
              <React.Fragment key={i}>
                <span className={cn("fp-word", i === 0 && "fp-word-active")}>{w}</span>{" "}
              </React.Fragment>
            ))}
          </p>
          <p
            aria-hidden
            className="fp-opening-text mt-4 max-w-[30em] text-pretty font-reader text-[clamp(1.375rem,1.1rem+1.2vw,1.875rem)] leading-[1.5] text-foreground/90"
          >
            {opening.sentence}
          </p>
        </figure>

        <p className="mt-10 max-w-[34rem] text-base leading-relaxed text-muted-foreground">
          FocusParse reads a document aloud and keeps your place word by word.
          It stops at the end of each section to ask what you just heard.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
          {canSpeak === false ? (
            <Button
              size="lg"
              variant="outline"
              className="gap-2 px-6"
              disabled={!ready}
              onClick={() => void start()}
            >
              Open the sample
            </Button>
          ) : (
            <Button
              size="lg"
              className="h-12 gap-2.5 px-7 text-base"
              disabled={!ready}
              aria-keyshortcuts="Space"
              onClick={() => void start()}
            >
              <Play className="h-4 w-4" aria-hidden />
              Play the sample
            </Button>
          )}
          {canSpeak !== false && firstCheck !== null && (
            <p className="flex items-center gap-2.5 text-sm text-muted-foreground">
              {firstCheck.seconds !== null ? (
                <span>
                  First check in about{" "}
                  <span className="tabular-nums text-foreground">
                    {firstCheck.seconds} seconds
                  </span>
                </span>
              ) : (
                <span>
                  First check after{" "}
                  <span className="tabular-nums text-foreground">
                    {firstCheck.words} words
                  </span>
                </span>
              )}
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs [@media(pointer:coarse)]:hidden">
                Space
              </kbd>
            </p>
          )}
        </div>

        {canSpeak === false && (
          <p className="mt-4 max-w-[34rem] text-sm leading-relaxed text-muted-foreground">
            This browser can&apos;t read aloud: it has no speech synthesis. Chrome
            and Edge can. You can still open the sample and read it yourself,
            and the checks still stop you at each section.
          </p>
        )}

        {/* The second way in, for someone who arrived with the document they
            have to get through. The whole page takes a drop; this is where it
            says so. */}
        <section
          aria-label="Read your own document"
          className={cn(
            "mt-16 rounded-lg border border-dashed px-5 py-4 transition-colors",
            dragging ? "border-primary bg-primary/5" : "border-muted-foreground/30"
          )}
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <Upload className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <p className="min-w-[14rem] flex-1 text-sm leading-relaxed text-muted-foreground">
              {/* A touch screen has nothing to drop, so it is told what it can
                  do instead. */}
              <span className="text-foreground">Or read your own.</span>{" "}
              <span className="[@media(pointer:coarse)]:hidden">
                Drop a PDF, Markdown or text file anywhere on this page. It stays on
                this computer.
              </span>
              <span className="hidden [@media(pointer:coarse)]:inline">
                Choose a PDF, Markdown or text file. It stays on this device.
              </span>
            </p>
            <div className="flex gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".md,.markdown,.txt,.sql,.pdf,text/plain,text/markdown,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void readFile(file);
                  e.target.value = "";
                }}
              />
              <Button
                variant="outline"
                disabled={busy !== null}
                onClick={() => fileRef.current?.click()}
              >
                Choose a file
              </Button>
              <Button
                variant="ghost"
                className="gap-2"
                aria-expanded={pasting}
                onClick={() => setPasting((p) => !p)}
              >
                <ClipboardPaste className="h-4 w-4" aria-hidden />
                Paste text
              </Button>
            </div>
          </div>

          {busy && (
            <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              {busy}
            </p>
          )}
          {error && (
            <p className="mt-3 text-sm text-alarm" role="alert">
              {error}
            </p>
          )}

          {pasting && (
            <div className="mt-4">
              <Textarea
                autoFocus
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder="Paste markdown or plain text. A line starting with # becomes a section."
                aria-label="Text to read"
                className="min-h-[160px] resize-y text-sm leading-relaxed"
              />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Input
                  value={pastedName}
                  onChange={(e) => setPastedName(e.target.value)}
                  placeholder="Name (optional)"
                  aria-label="Document name"
                  spellCheck={false}
                  className="w-56"
                />
                <Button
                  disabled={!pasted.trim()}
                  onClick={() => ingest(pasted, pastedName.trim() || undefined)}
                >
                  Read this
                </Button>
              </div>
            </div>
          )}
        </section>

        <BackupControls variant="restore" onRestored={onRestored} />
      </div>
    </div>
  );
}

/** The sample's first heading and its first sentence, as the parser sees them. */
function openingOf(doc: ParsedDoc): { title: string; sentence: string } {
  const heading = doc.blocks.find((b) => b.kind === "h1" || b.kind === "h2");
  const prose = doc.blocks.find((b) => b.kind === "p" && b.text.trim());
  const text = prose?.text.replace(/\s+/g, " ").trim() ?? "";
  // Two sentences: the first states the claim, the second turns it.
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  return {
    title: heading?.text ?? SAMPLE_TITLE,
    sentence: sentences.slice(0, 2).join("").trim(),
  };
}

"use client";

import * as React from "react";
import {
  AlertTriangle,
  Check,
  Eye,
  EyeOff,
  Loader2,
  Mic,
  MicOff,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

import { TAG_META } from "@/components/scratchpad/flow-node-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  recognitionCtor,
  reconcile,
  transcriptOf,
  type Correction,
} from "@/lib/dictation";
import type { Verdict } from "@/lib/graders/types";
import { cn } from "@/lib/utils";
import { readingNodes, useFocusStore } from "@/store/useFocusStore";

/** A summary shorter than this is a keystroke, not a recall. */
const MIN_WORDS = 4;

const VERDICT_META: Record<
  Verdict["verdict"],
  { label: string; icon: React.ElementType; tone: string }
> = {
  accurate: { label: "Accurate", icon: Check, tone: "text-output" },
  partial: { label: "Partial", icon: TriangleAlert, tone: "text-[hsl(var(--pace-active))]" },
  off_track: { label: "Off track", icon: AlertTriangle, tone: "text-destructive" },
};

/**
 * Start a recognition session, or throw if the platform has none.
 *
 * Kept here rather than in `dictation.ts` because it is all side effect: the
 * module holds the part worth testing, this holds the part that needs a
 * microphone. `continuous` with `interimResults` means the box fills as the
 * reader speaks instead of after they stop, which is what makes it feel like
 * talking rather than like submitting a recording.
 */
function startRecognizer(handlers: {
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
  onEnd: () => void;
}) {
  const Ctor = recognitionCtor();
  if (!Ctor) throw new Error("no recognizer");

  const recognizer = new Ctor();
  recognizer.lang = "en-US";
  recognizer.continuous = true;
  recognizer.interimResults = true;
  recognizer.onresult = (event) => handlers.onTranscript(transcriptOf(event));
  recognizer.onerror = (event) => {
    const code = (event as { error?: string }).error;
    handlers.onError(
      code === "not-allowed"
        ? "Microphone access was refused."
        : code === "no-speech"
          ? "Nothing was heard."
          : "The recognizer stopped."
    );
  };
  recognizer.onend = handlers.onEnd;
  recognizer.start();

  return {
    stop() {
      recognizer.onend = null;
      try {
        recognizer.stop();
      } catch {
        /* already stopped */
      }
    },
  };
}

/**
 * Automated cognitive intercept. Fires at every section boundary and holds
 * playback until the section just finished has been restated in one sentence.
 * The dialog is intentionally non-dismissible: escape, outside-click and the
 * corner close button are all disabled.
 */
export function InterceptDialog() {
  const [text, setText] = React.useState("");
  const [showCaptures, setShowCaptures] = React.useState(false);
  const [touched, setTouched] = React.useState(false);

  const [provider, setProvider] = React.useState<string | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [verdict, setVerdict] = React.useState<Verdict | null>(null);
  const [checkError, setCheckError] = React.useState<string | null>(null);

  const [listening, setListening] = React.useState(false);
  const [corrections, setCorrections] = React.useState<Correction[]>([]);
  const [micError, setMicError] = React.useState<string | null>(null);
  const recognizerRef = React.useRef<ReturnType<typeof startRecognizer> | null>(null);
  /** Text already committed, so a restart appends rather than replaces. */
  const committedRef = React.useRef("");

  const doc = useFocusStore((s) => s.doc);
  const intercept = useFocusStore((s) => s.intercept);
  const nodes = useFocusStore((s) => s.nodes);
  const submitSummary = useFocusStore((s) => s.submitSummary);
  const abandonIntercept = useFocusStore((s) => s.abandonIntercept);

  const section =
    intercept.section !== null ? doc?.sections[intercept.section] : undefined;

  // The check is optional: without a key the button never appears.
  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/check-summary")
      .then((r) => r.json())
      .then((data: { configured?: boolean; provider?: string | null }) => {
        if (!cancelled && data.configured) setProvider(data.provider ?? "ai");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (intercept.open) {
      setText("");
      setTouched(false);
      setShowCaptures(false);
      setVerdict(null);
      setCheckError(null);
      setCorrections([]);
      setMicError(null);
      committedRef.current = "";
    }
  }, [intercept.open, intercept.section]);

  // The recognizer holds a microphone. Nothing may survive this dialog.
  React.useEffect(() => {
    if (!intercept.open && recognizerRef.current) {
      recognizerRef.current.stop();
      recognizerRef.current = null;
      setListening(false);
    }
  }, [intercept.open]);

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const valid = words >= MIN_WORDS;

  const sectionNodes = React.useMemo(
    // `readingNodes` first: a thought parked mid-section is not evidence of
    // having understood the section, and putting it on screen beside the
    // summary box is the single worst moment to hand the reader back their own
    // distraction.
    () => readingNodes(nodes).filter((n) => n.section === intercept.section),
    [nodes, intercept.section]
  );

  /**
   * The acronyms this section actually contains.
   *
   * The tokens already carry them — `parse.ts` tags every token it recognises —
   * so this is a lookup rather than a guess, and it is what keeps the corrector
   * from putting words into the reader's mouth: nothing outside this set is
   * ever substituted in.
   */
  const vocabulary = React.useMemo(() => {
    if (!doc || !section) return [];
    const found = new Set<string>();
    for (let i = section.tokenStart; i < section.tokenEnd; i++) {
      const key = doc.tokens[i]?.acronym;
      if (key) found.add(key);
    }
    return [...found];
  }, [doc, section]);

  const stopListening = React.useCallback(() => {
    recognizerRef.current?.stop();
    recognizerRef.current = null;
    setListening(false);
  }, []);

  const toggleListening = () => {
    if (listening) {
      stopListening();
      return;
    }
    setMicError(null);
    committedRef.current = text;
    try {
      recognizerRef.current = startRecognizer({
        onTranscript: (heard) => {
          const joined = [committedRef.current.trim(), heard].filter(Boolean).join(" ");
          const fixed = reconcile(joined, vocabulary);
          setText(fixed.text);
          setCorrections(fixed.corrections);
        },
        onError: (message) => {
          setMicError(message);
          stopListening();
        },
        onEnd: () => setListening(false),
      });
      setListening(true);
    } catch {
      setMicError("Could not start the microphone.");
    }
  };

  const submit = () => {
    setTouched(true);
    stopListening();
    if (!valid) return;
    submitSummary(text);
  };

  const check = async () => {
    if (!doc || !section || !valid) return;
    setChecking(true);
    setCheckError(null);
    setVerdict(null);

    try {
      const sectionText = doc.tokens
        .slice(section.tokenStart, section.tokenEnd)
        .map((t) => t.text)
        .join(" ");

      const response = await fetch("/api/check-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionTitle: section.title,
          sectionText,
          summary: text,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        setCheckError(data.error ?? "Summary check failed.");
        return;
      }
      setVerdict(data as Verdict);
    } catch {
      setCheckError("Could not reach the summary checker.");
    } finally {
      setChecking(false);
    }
  };

  const meta = verdict ? VERDICT_META[verdict.verdict] : null;
  const VerdictIcon = meta?.icon;

  return (
    <Dialog open={intercept.open}>
      <DialogContent
        hideCloseButton
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="flex h-[100dvh] max-h-none w-screen max-w-none flex-col justify-center overflow-y-auto rounded-none border-0 p-0 sm:rounded-none"
      >
        <div className="mx-auto w-full max-w-2xl px-6 py-10">
          <DialogHeader className="text-left">
            <div className="mb-3 flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-[hsl(var(--pace-active))]" />
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Cognitive intercept
              </span>
            </div>

            <DialogTitle className="text-2xl leading-tight">
              Summarize “{section?.title ?? "this section"}” in one sentence.
            </DialogTitle>

            <DialogDescription className="pt-1">
              {section
                ? `${section.wordCount.toLocaleString()} words just went past. `
                : ""}
              Write it from memory, before you look back at the text. Playback stays
              paused until you do.
            </DialogDescription>
          </DialogHeader>

          <Textarea
            autoFocus
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (verdict || checkError) {
                setVerdict(null);
                setCheckError(null);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="The section argued that…"
            spellCheck={false}
            className="mt-6 min-h-[120px] resize-none text-base leading-relaxed"
          />

          <div className="mt-2 flex items-center gap-3 text-xs">
            <span
              className={
                touched && !valid ? "text-destructive" : "text-muted-foreground"
              }
            >
              {words} {words === 1 ? "word" : "words"}
              {!valid && ` · at least ${MIN_WORDS} needed`}
            </span>

            {/* Absent where the platform has no recognizer, rather than
                present and inert: a button that does nothing is worse than no
                button. Chrome is the only browser that ships one. */}
            {recognitionCtor() && (
              <button
                type="button"
                onClick={toggleListening}
                aria-pressed={listening}
                className={cn(
                  "flex items-center gap-1.5 rounded border px-1.5 py-0.5",
                  listening
                    ? "border-destructive/60 bg-destructive/20 text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
                title={
                  listening
                    ? "Stop dictating"
                    : "Say it instead of typing it. Chrome sends the audio to Google for transcription."
                }
              >
                {listening ? (
                  <MicOff className="h-3 w-3" />
                ) : (
                  <Mic className="h-3 w-3" />
                )}
                {listening ? "Listening" : "Speak it"}
              </button>
            )}

            {sectionNodes.length > 0 && (
              <button
                type="button"
                onClick={() => setShowCaptures((v) => !v)}
                className="ml-auto flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
              >
                {showCaptures ? (
                  <EyeOff className="h-3 w-3" />
                ) : (
                  <Eye className="h-3 w-3" />
                )}
                {showCaptures ? "Hide" : "Show"} my {sectionNodes.length} capture
                {sectionNodes.length === 1 ? "" : "s"}
              </button>
            )}
          </div>

          {micError && (
            <p className="mt-2 text-xs text-muted-foreground">{micError}</p>
          )}

          {/* Every substitution, named. The corrector is more dangerous than
              the recognizer it repairs -- a mangled word is visible and a
              swapped one is not -- so it says what it did and the text stays
              editable. */}
          {corrections.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Heard and corrected:{" "}
              {corrections.map((c, i) => (
                <span key={`${c.from}-${i}`}>
                  {i > 0 && ", "}
                  <span className="line-through opacity-60">{c.from}</span>{" "}
                  <span className="text-foreground">{c.to}</span>
                </span>
              ))}
            </p>
          )}

          {showCaptures && sectionNodes.length > 0 && (
            <div className="mt-3 space-y-1.5 rounded-md border bg-muted/30 p-3">
              {sectionNodes.map((node) => (
                <div key={node.id} className="flex items-start gap-2 text-sm">
                  {node.tag ? (
                    <Badge
                      variant={node.tag}
                      className="mt-[2px] shrink-0 px-1.5 py-0 text-[10px]"
                    >
                      {TAG_META[node.tag].label}
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="mt-[2px] shrink-0 px-1.5 py-0 text-[10px] font-normal"
                    >
                      note
                    </Badge>
                  )}
                  <span className="text-muted-foreground">{node.text}</span>
                </div>
              ))}
            </div>
          )}

          {verdict && meta && VerdictIcon && (
            <div className="mt-4 rounded-md border bg-muted/30 p-4">
              <div className="flex items-center gap-2">
                <VerdictIcon className={cn("h-4 w-4", meta.tone)} />
                <span className={cn("text-sm font-medium", meta.tone)}>
                  {meta.label}
                </span>
              </div>

              <p className="mt-2 text-sm leading-relaxed">{verdict.feedback}</p>

              {verdict.missed.length > 0 && (
                <div className="mt-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Missed
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {verdict.missed.map((item) => (
                      <li key={item} className="text-sm text-muted-foreground">
                        — {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {verdict.contradictions.length > 0 && (
                <div className="mt-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-destructive">
                    Not supported by the text
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {verdict.contradictions.map((item) => (
                      <li key={item} className="text-sm text-muted-foreground">
                        — {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {checkError && (
            <p className="mt-3 text-xs text-destructive">{checkError}</p>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button onClick={submit} disabled={!valid} className="gap-2">
              Log it and resume
            </Button>

            {provider && (
              <Button
                variant="outline"
                onClick={() => void check()}
                disabled={!valid || checking}
                className="gap-2"
                title={`Grade this summary against the section text (${provider})`}
              >
                {checking ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {checking ? "Checking…" : "Check my recall"}
              </Button>
            )}

            <Button variant="ghost" onClick={abandonIntercept}>
              Stop reading here
            </Button>

            <span className="ml-auto hidden text-xs text-muted-foreground sm:block">
              Enter to submit · Shift+Enter for a newline
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

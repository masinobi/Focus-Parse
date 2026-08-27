"use client";

import * as React from "react";
import {
  AlertTriangle,
  Check,
  Eye,
  EyeOff,
  Loader2,
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
    }
  }, [intercept.open, intercept.section]);

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

  const submit = () => {
    setTouched(true);
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

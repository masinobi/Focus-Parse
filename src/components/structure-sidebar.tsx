"use client";

import * as React from "react";
import { Check, CircleDot, PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { EditableTitle } from "@/components/editable-title";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatDuration } from "@/lib/parse";
import type { Section } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useFocusStore } from "@/store/useFocusStore";

interface RowProps {
  section: Section;
  state: "done" | "current" | "ahead";
  summarized: boolean;
  seconds: number;
  /** Only meaningful for the current row; -1 elsewhere so props stay stable. */
  progress: number;
  onSeek: (index: number) => void;
}

/**
 * Memoized so that advancing a word only re-renders the row being read. A long
 * PDF produces a hundred-odd sections, and re-rendering all of them on every
 * boundary event is the difference between smooth pacing and a locked tab.
 */
const SectionRow = React.memo(function SectionRow({
  section,
  state,
  summarized,
  seconds,
  progress,
  onSeek,
}: RowProps) {
  return (
    <button
      type="button"
      onClick={() => onSeek(section.i)}
      className={cn(
        "group flex w-full flex-col gap-1 px-3 py-2 text-left transition-colors hover:bg-accent/60",
        section.level >= 2 && "pl-6",
        state === "current" && "bg-accent"
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-[3px] shrink-0">
          {summarized ? (
            <Check className="h-3 w-3 text-output" />
          ) : state === "current" ? (
            <CircleDot className="h-3 w-3 text-primary" />
          ) : (
            <span
              className={cn(
                "block h-3 w-3 rounded-full border",
                state === "done"
                  ? "border-muted-foreground/60 bg-muted-foreground/30"
                  : "border-border"
              )}
            />
          )}
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 text-sm leading-snug",
            section.level <= 1 ? "font-medium" : "font-normal",
            state === "done" && "text-muted-foreground"
          )}
        >
          {section.title}
        </span>
      </div>

      <div className="flex items-center gap-2 pl-5">
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {section.wordCount.toLocaleString()}w · {formatDuration(seconds)}
        </span>
        {section.intercept && (
          <span
            className={cn(
              "rounded px-1 text-[10px] uppercase tracking-wide",
              summarized ? "bg-output/15 text-output" : "bg-muted text-muted-foreground"
            )}
          >
            {summarized ? "logged" : "intercept"}
          </span>
        )}
      </div>

      {state === "current" && progress >= 0 && (
        <Progress value={progress} className="ml-5 mt-1 h-1 w-[calc(100%-1.25rem)]" />
      )}
    </button>
  );
});

/**
 * Pre-scan structural map. Generated at load from the header hierarchy, with
 * per-section time estimates that track live WPM telemetry rather than a fixed
 * reading-speed constant.
 */
export function StructureSidebar() {
  const [open, setOpen] = React.useState(true);

  const doc = useFocusStore((s) => s.doc);
  const tokenIndex = useFocusStore((s) => s.tokenIndex);
  const summaries = useFocusStore((s) => s.summaries);
  const seekSection = useFocusStore((s) => s.seekSection);
  const renameDoc = useFocusStore((s) => s.renameDoc);
  const wpm = useFocusStore((s) => s.effectiveWpm());

  if (!doc) return null;

  const currentSection = doc.tokens[tokenIndex]?.section ?? 0;
  const remaining = Math.max(0, doc.wordCount - tokenIndex);

  if (!open) {
    return (
      <div className="flex w-12 shrink-0 flex-col items-center border-r bg-muted/20 py-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setOpen(true)}
          aria-label="Show structure map"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-muted/20">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
        <p className="truncate text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Structure
        </p>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={() => setOpen(false)}
          aria-label="Hide structure map"
        >
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>

      <div className="border-b px-3 py-3">
        <EditableTitle
          value={doc.title}
          onCommit={renameDoc}
          label="Rename document"
          className="text-sm font-medium"
          inputClassName="w-full"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          {doc.wordCount.toLocaleString()} words ·{" "}
          {formatDuration((remaining / wpm) * 60)} left
        </p>
      </div>

      <nav className="fp-scroll flex-1 overflow-y-auto py-2">
        {doc.sections.map((section) => {
          const isCurrent = section.i === currentSection;
          const isDone = tokenIndex >= section.tokenEnd && section.wordCount > 0;

          const read = Math.min(
            Math.max(0, tokenIndex - section.tokenStart),
            section.wordCount
          );

          return (
            <SectionRow
              key={section.i}
              section={section}
              state={isCurrent ? "current" : isDone ? "done" : "ahead"}
              summarized={Boolean(summaries[section.i])}
              seconds={(section.wordCount / wpm) * 60}
              progress={
                isCurrent && section.wordCount ? (read / section.wordCount) * 100 : -1
              }
              onSeek={seekSection}
            />
          );
        })}
      </nav>

      <div className="border-t px-3 py-2 text-[11px] text-muted-foreground">
        Measured pace: <span className="tabular-nums text-foreground">{wpm}</span> wpm
      </div>
    </aside>
  );
}

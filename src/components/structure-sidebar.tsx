"use client";

import * as React from "react";
import { Check, CircleDot, PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { EditableTitle } from "@/components/editable-title";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { contentWordCount, formatDuration } from "@/lib/parse";
import type { Section } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useFocusStore } from "@/store/useFocusStore";

interface RowProps {
  section: Section;
  /** Words across every checkpoint folded into this row. */
  wordCount: number;
  /** How many pacing checkpoints this row stands for. */
  parts: number;
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
  wordCount,
  parts,
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
        state === "current" && "bg-accent",
        // Still listed, still clickable — playback simply will not wander in.
        section.furniture && "opacity-55"
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
          {section.baseTitle ?? section.title}
        </span>
      </div>

      <div className="flex items-center gap-2 pl-5">
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {wordCount.toLocaleString()}w · {formatDuration(seconds)}
        </span>
        {parts > 1 && (
          <span className="text-[10px] text-muted-foreground/70">
            {parts} checkpoints
          </span>
        )}
        {section.furniture && (
          <span className="rounded bg-muted px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            skipped
          </span>
        )}
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
  // Counted over what will actually be read. Billing the reader for a
  // bibliography the engine skips makes every estimate in the map too long —
  // on the EDC implementation chapter, by about a ninth.
  const content = contentWordCount(doc);
  const skipped = doc.wordCount - content;
  const remaining = Math.max(0, content - tokenIndex);

  /**
   * Pacing checkpoints folded back into the heading they were cut from.
   *
   * The engine needs them as separate sections — that is the whole point of
   * them — but the map does not: a 3,700-word section showed as "4) Minimum
   * Standards" followed by five more rows of the same words, which reads as a
   * document repeating itself. Reported by the reader as exactly that.
   */
  const rows = doc.sections.reduce<
    {
      section: Section;
      wordCount: number;
      tokenEnd: number;
      parts: number;
      lastIndex: number;
    }[]
  >((acc, section) => {
    const previous = acc[acc.length - 1];
    const continues =
      previous &&
      section.part !== undefined &&
      section.part > 1 &&
      section.baseTitle !== undefined &&
      section.baseTitle === previous.section.baseTitle;

    if (continues) {
      previous.wordCount += section.wordCount;
      previous.tokenEnd = section.tokenEnd;
      previous.parts += 1;
      previous.lastIndex = section.i;
      return acc;
    }

    acc.push({
      section,
      wordCount: section.wordCount,
      tokenEnd: section.tokenEnd,
      parts: 1,
      lastIndex: section.i,
    });
    return acc;
  }, []);

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
          {content.toLocaleString()} words ·{" "}
          {formatDuration((remaining / wpm) * 60)} left
        </p>
        {skipped > 0 && (
          <p className="mt-0.5 text-[11px] text-muted-foreground/70">
            {skipped.toLocaleString()} more in front matter and references,
            skipped
          </p>
        )}
      </div>

      <nav className="fp-scroll flex-1 overflow-y-auto py-2">
        {rows.map((row) => {
          const isCurrent =
            currentSection >= row.section.i && currentSection <= row.lastIndex;
          const isDone = tokenIndex >= row.tokenEnd && row.wordCount > 0;

          const read = Math.min(
            Math.max(0, tokenIndex - row.section.tokenStart),
            row.wordCount
          );

          return (
            <SectionRow
              key={row.section.i}
              section={row.section}
              wordCount={row.wordCount}
              parts={row.parts}
              state={isCurrent ? "current" : isDone ? "done" : "ahead"}
              summarized={Boolean(summaries[row.section.i])}
              seconds={(row.wordCount / wpm) * 60}
              progress={isCurrent && row.wordCount ? (read / row.wordCount) * 100 : -1}
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

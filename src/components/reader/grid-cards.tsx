"use client";

import * as React from "react";
import { Table2 } from "lucide-react";

import type { Block, ParsedDoc } from "@/lib/types";
import { cn } from "@/lib/utils";

interface GridCardsProps {
  doc: ParsedDoc;
  block: Block;
  tokenIndex: number;
}

/**
 * Matrix flattener.
 *
 * A grid read as prose is noise — "Run edit Checks I A/R I I" — because the
 * relation between a value and its column header is spatial, and speech has no
 * spatial dimension. Here the page is blacked out and the grid arrives as one
 * card at a time, each naming its row, its column and its value, so the
 * structure that the linearized text destroys is restored explicitly.
 *
 * The step shown is derived from the reading position, so it stays locked to
 * the audio without needing a clock of its own.
 */
export function GridCards({ doc, block, tokenIndex }: GridCardsProps) {
  const steps = block.steps ?? [];

  /** Which step owns the reading position. */
  const active = React.useMemo(() => {
    const index = block.chunks.findIndex((c) => {
      const chunk = doc.chunks[c];
      return tokenIndex >= chunk.tokenStart && tokenIndex < chunk.tokenEnd;
    });
    if (index >= 0) return index;
    // Before the first token of the block, or past its last: clamp.
    const first = doc.chunks[block.chunks[0]];
    return first && tokenIndex < first.tokenStart ? 0 : steps.length - 1;
  }, [doc, block, tokenIndex, steps.length]);

  const step = steps[Math.max(0, Math.min(active, steps.length - 1))];
  if (!step) return null;

  const rowsTotal = block.grid?.rows.length ?? 0;

  return (
    <div className="relative flex h-full flex-col items-center justify-center bg-black px-8">
      <div className="absolute left-0 right-0 top-0 flex items-center gap-2 px-6 py-4 text-xs uppercase tracking-[0.18em] text-muted-foreground">
        <Table2 className="h-3.5 w-3.5" />
        <span className="truncate">
          {block.grid?.caption ?? `Grid · ${rowsTotal} rows`}
        </span>
        <span className="ml-auto shrink-0 tabular-nums">
          {active + 1} / {steps.length}
        </span>
      </div>

      <div key={active} className="w-full max-w-2xl animate-node-in">
        <p className="text-center text-sm uppercase tracking-[0.2em] text-muted-foreground">
          {step.row}
        </p>

        {step.column && (
          <p className="mt-6 text-center text-base text-muted-foreground">
            {step.column}
          </p>
        )}

        <p
          className={cn(
            "mt-2 text-center font-reader leading-tight",
            step.value.length > 60 ? "text-3xl" : "text-5xl"
          )}
          style={{ color: "hsl(var(--pace-active))" }}
        >
          {step.value}
        </p>
      </div>

      {/* Progress through the grid, so the sequence has a visible end. */}
      <div className="absolute bottom-0 left-0 right-0 flex gap-1 px-6 py-5">
        {steps.map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-0.5 flex-1 rounded-full transition-colors",
              i < active
                ? "bg-muted-foreground/50"
                : i === active
                  ? "bg-[hsl(var(--pace-active))]"
                  : "bg-muted-foreground/15"
            )}
          />
        ))}
      </div>
    </div>
  );
}

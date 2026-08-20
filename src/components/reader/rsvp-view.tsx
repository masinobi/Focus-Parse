"use client";

import * as React from "react";

import { orpIndex } from "@/lib/parse";
import type { ParsedDoc } from "@/lib/types";

interface RsvpViewProps {
  doc: ParsedDoc;
  tokenIndex: number;
}

/**
 * Rapid Serial Visual Presentation: the word is delivered to a fixed point so
 * the eye never moves. The pivot letter is aligned to the vertical guide, which
 * is what keeps a stationary fixation comfortable at speed.
 */
export function RsvpView({ doc, tokenIndex }: RsvpViewProps) {
  const token = doc.tokens[tokenIndex];
  const word = token?.text ?? "";
  const pivot = React.useMemo(() => orpIndex(word), [word]);

  const before = word.slice(0, pivot);
  const at = word.slice(pivot, pivot + 1);
  const after = word.slice(pivot + 1);

  const context = React.useMemo(() => {
    const start = Math.max(0, tokenIndex - 6);
    const end = Math.min(doc.tokens.length, tokenIndex + 7);
    return {
      left: doc.tokens.slice(start, tokenIndex).map((t) => t.text).join(" "),
      right: doc.tokens.slice(tokenIndex + 1, end).map((t) => t.text).join(" "),
    };
  }, [doc, tokenIndex]);

  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <div className="w-full max-w-2xl">
        <div className="relative select-none rounded-lg border bg-card/40 py-16">
          {/* Fixation guides */}
          <div className="pointer-events-none absolute left-1/2 top-0 h-6 w-px -translate-x-1/2 bg-border" />
          <div className="pointer-events-none absolute bottom-0 left-1/2 h-6 w-px -translate-x-1/2 bg-border" />

          <div
            key={tokenIndex}
            className="flex animate-rsvp-in items-baseline justify-center font-reader text-5xl tracking-tight"
          >
            <span className="flex-1 text-right text-foreground">{before}</span>
            <span
              className="text-center"
              style={{ color: "hsl(var(--pace-active))" }}
            >
              {at}
            </span>
            <span className="flex-1 text-left text-foreground">{after}</span>
          </div>
        </div>

        <div className="mt-6 flex items-baseline gap-2 text-xs leading-relaxed text-muted-foreground/60">
          <span className="flex-1 truncate text-right">{context.left}</span>
          <span className="h-1 w-1 shrink-0 rounded-full bg-muted-foreground/40" />
          <span className="flex-1 truncate text-left">{context.right}</span>
        </div>
      </div>
    </div>
  );
}

"use client";

import * as React from "react";

import { BlockView } from "@/components/reader/block-view";
import { RsvpView } from "@/components/reader/rsvp-view";
import { useFocusStore } from "@/store/useFocusStore";

/** Keep the active word inside this vertical band of the viewport. */
const BAND_TOP = 0.25;
const BAND_BOTTOM = 0.7;

/**
 * Above this size, blocks are marked `content-visibility: auto` so the browser
 * skips layout and paint for the ones that are off-screen. Every block stays in
 * the DOM — a document must be scrollable and searchable in full, whatever the
 * playback position happens to be.
 */
const DEFER_THRESHOLD_TOKENS = 3000;

export function ReaderPane() {
  const doc = useFocusStore((s) => s.doc);
  const view = useFocusStore((s) => s.view);
  const tokenIndex = useFocusStore((s) => s.tokenIndex);
  const seekToken = useFocusStore((s) => s.seekToken);

  const scrollRef = React.useRef<HTMLDivElement>(null);

  const deferred = Boolean(doc && doc.tokens.length > DEFER_THRESHOLD_TOKENS);

  /** First and last token index owned by each block, for memo clamping. */
  const blockRanges = React.useMemo(() => {
    if (!doc) return [];
    return doc.blocks.map((block) => {
      if (!block.chunks.length) return { start: -1, end: -1 };
      const first = doc.chunks[block.chunks[0]];
      const last = doc.chunks[block.chunks[block.chunks.length - 1]];
      return { start: first.tokenStart, end: last.tokenEnd };
    });
  }, [doc]);

  /**
   * Height estimates for `contain-intrinsic-size`, so the scrollbar is roughly
   * right before a block has ever been rendered.
   */
  const estimates = React.useMemo(() => {
    if (!doc || !deferred) return null;
    return doc.blocks.map((block) => {
      const chars = block.kind === "code" ? (block.raw?.length ?? 0) : block.text.length;
      const lines = Math.max(1, Math.ceil(chars / 62));
      const lineHeight = block.kind === "h1" ? 40 : block.kind === "h2" ? 34 : 31;
      return lines * lineHeight + 18;
    });
  }, [doc, deferred]);

  React.useEffect(() => {
    if (view === "rsvp") return;
    const container = scrollRef.current;
    if (!container) return;

    const active = container.querySelector<HTMLElement>("#fp-active-word");
    if (!active) return;

    const box = container.getBoundingClientRect();
    const word = active.getBoundingClientRect();
    const top = box.top + box.height * BAND_TOP;
    const bottom = box.top + box.height * BAND_BOTTOM;

    if (word.top >= top && word.bottom <= bottom) return;

    const overshoot = Math.abs(word.top - top);
    active.scrollIntoView({
      block: "center",
      // Smooth scrolling queues animations faster than they finish once the
      // jumps get large; only use it for the short, word-to-word case.
      behavior: overshoot < box.height ? "smooth" : "auto",
    });
  }, [tokenIndex, view]);

  if (!doc) return null;

  if (view === "rsvp") {
    return <RsvpView doc={doc} tokenIndex={tokenIndex} />;
  }

  return (
    <div ref={scrollRef} className="fp-scroll h-full overflow-y-auto px-8 py-10">
      <article className="fp-measure mx-auto font-reader text-[1.0625rem] leading-[1.85] text-foreground/90">
        {doc.blocks.map((block, i) => {
          const range = blockRanges[i];
          const clamped =
            range.start === -1
              ? -1
              : tokenIndex >= range.end
                ? range.end
                : tokenIndex < range.start
                  ? -1
                  : tokenIndex;

          return (
            <BlockView
              key={block.i}
              doc={doc}
              block={block}
              activeToken={clamped}
              bionic={view === "bionic"}
              onSeek={seekToken}
              deferHeight={estimates ? estimates[i] : undefined}
            />
          );
        })}
        <div className="h-[40vh]" aria-hidden />
      </article>
    </div>
  );
}

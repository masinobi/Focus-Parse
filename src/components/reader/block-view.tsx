"use client";

import * as React from "react";

import { bionicSplit } from "@/lib/parse";
import type { Block, ParsedDoc } from "@/lib/types";
import { cn } from "@/lib/utils";

interface BlockViewProps {
  doc: ParsedDoc;
  block: Block;
  /**
   * The active token index, pre-clamped by the parent to this block's range:
   * `-1` when the block is entirely upcoming, `blockEnd` when it is entirely
   * read. That clamping is what keeps this component from re-rendering on every
   * spoken word in a different block.
   */
  activeToken: number;
  bionic: boolean;
  onSeek: (tokenIndex: number) => void;
  /**
   * Estimated rendered height in pixels. When set, the block is marked
   * `content-visibility: auto`, letting the browser skip layout and paint for
   * it while it is off-screen. The block stays in the DOM, so scrolling,
   * find-in-page and scroll-into-view all behave normally.
   */
  deferHeight?: number;
}

function Word({
  index,
  text,
  state,
  bionic,
  onSeek,
}: {
  index: number;
  text: string;
  state: "read" | "active" | "ahead";
  bionic: boolean;
  onSeek: (tokenIndex: number) => void;
}) {
  const content = bionic ? bionicSplit(text) : null;

  return (
    <span
      id={state === "active" ? "fp-active-word" : undefined}
      data-token={index}
      role="button"
      tabIndex={-1}
      onClick={() => onSeek(index)}
      className={cn(
        "fp-word cursor-pointer",
        state === "read" && "fp-word-read",
        state === "active" && "fp-word-active",
        state === "ahead" && "hover:bg-accent/60"
      )}
    >
      {content ? (
        <>
          <span className="fp-bionic-lead">{content[0]}</span>
          {content[1]}
        </>
      ) : (
        text
      )}
    </span>
  );
}

const BlockViewImpl = ({
  doc,
  block,
  activeToken,
  bionic,
  onSeek,
  deferHeight,
}: BlockViewProps) => {
  const style: React.CSSProperties | undefined = deferHeight
    ? {
        contentVisibility: "auto",
        containIntrinsicSize: `auto ${deferHeight}px`,
      }
    : undefined;

  if (block.kind === "code") {
    return (
      <div className="relative my-5" style={style}>
        <pre className="fp-scroll overflow-x-auto rounded-md border border-dashed bg-muted/40 p-4 font-mono text-xs leading-relaxed text-muted-foreground">
          {block.raw}
        </pre>
        <span className="absolute right-2 top-2 rounded bg-background/80 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          not spoken
        </span>
      </div>
    );
  }

  const words: React.ReactNode[] = [];
  let first = true;

  for (const chunkIndex of block.chunks) {
    const chunk = doc.chunks[chunkIndex];
    for (let i = chunk.tokenStart; i < chunk.tokenEnd; i++) {
      if (!first) words.push(" ");
      first = false;
      words.push(
        <Word
          key={i}
          index={i}
          text={doc.tokens[i].text}
          state={i < activeToken ? "read" : i === activeToken ? "active" : "ahead"}
          bionic={bionic}
          onSeek={onSeek}
        />
      );
    }
  }

  switch (block.kind) {
    case "h1":
      return (
        <h1
          style={style}
          data-block={block.i}
          className="mb-4 mt-10 scroll-mt-24 font-sans text-2xl font-bold tracking-tight first:mt-0"
        >
          {words}
        </h1>
      );
    case "h2":
      return (
        <h2
          style={style}
          data-block={block.i}
          className="mb-3 mt-9 scroll-mt-24 font-sans text-xl font-semibold tracking-tight first:mt-0"
        >
          {words}
        </h2>
      );
    case "h3":
      return (
        <h3
          style={style}
          data-block={block.i}
          className="mb-2 mt-7 scroll-mt-24 font-sans text-base font-semibold uppercase tracking-wide text-muted-foreground first:mt-0"
        >
          {words}
        </h3>
      );
    case "li":
      return (
        <div data-block={block.i} style={style} className="my-1.5 flex gap-3 pl-1">
          <span className="select-none pt-[2px] text-sm text-muted-foreground">
            {block.ordinal ? `${block.ordinal}.` : "—"}
          </span>
          <p className="flex-1">{words}</p>
        </div>
      );
    case "quote":
      return (
        <blockquote
          style={style}
          data-block={block.i}
          className="my-5 border-l-2 border-primary/40 pl-4 italic text-muted-foreground"
        >
          {words}
        </blockquote>
      );
    default:
      return (
        <p data-block={block.i} style={style} className="my-4">
          {words}
        </p>
      );
  }
};

export const BlockView = React.memo(BlockViewImpl);

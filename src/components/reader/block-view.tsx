"use client";

import * as React from "react";

import { ACRONYMS } from "@/lib/acronyms";
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
  /**
   * Clause the reading position sits in, pre-clamped like `activeToken` so a
   * block containing neither never re-renders as the position moves.
   */
  activeClause: number;
  bionic: boolean;
  badges: boolean;
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
  inClause,
  bionic,
  acronym,
  onSeek,
}: {
  index: number;
  text: string;
  state: "read" | "active" | "ahead";
  inClause: boolean;
  bionic: boolean;
  acronym?: string;
  onSeek: (tokenIndex: number) => void;
}) {
  const content = bionic && !acronym ? bionicSplit(text) : null;
  const category = acronym ? ACRONYMS[acronym]?.category : undefined;

  return (
    <span
      id={state === "active" ? "fp-active-word" : undefined}
      data-token={index}
      role="button"
      tabIndex={-1}
      onClick={() => onSeek(index)}
      title={acronym ? ACRONYMS[acronym]?.expansion : undefined}
      className={cn(
        "fp-word cursor-pointer",
        state === "read" && "fp-word-read",
        state === "active" && "fp-word-active",
        state === "ahead" && "hover:bg-accent/60",
        inClause && "fp-word-clause"
      )}
    >
      {category ? (
        <span className={cn("fp-badge", `fp-badge-${category}`)}>{text}</span>
      ) : content ? (
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
  activeClause,
  bionic,
  badges,
  onSeek,
  deferHeight,
}: BlockViewProps) => {
  const style: React.CSSProperties | undefined = deferHeight
    ? {
        contentVisibility: "auto",
        containIntrinsicSize: `auto ${deferHeight}px`,
      }
    : undefined;

  if (block.kind === "table") {
    const rows = block.grid?.rows.length ?? 0;
    const columns = block.grid?.header.length ?? 0;
    const firstToken = doc.chunks[block.chunks[0]]?.tokenStart ?? -1;

    // The grid's own words are never laid out in the flow, so this marker is
    // the only way to seek into it by hand.
    return (
      <button
        type="button"
        data-block={block.i}
        data-grid-entry={firstToken}
        style={style}
        onClick={() => firstToken >= 0 && onSeek(firstToken)}
        className="my-5 flex w-full items-center gap-3 rounded-md border border-dashed bg-muted/30 px-4 py-3 text-left font-sans text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:bg-accent/40"
      >
        <span className="flex-1">
          {block.grid?.caption ?? "Grid"} — {rows} rows × {columns} columns,
          flattened into {block.steps?.length ?? 0} steps.
        </span>
        <span className="shrink-0 text-xs uppercase tracking-wider">Play grid</span>
      </button>
    );
  }

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
      const token = doc.tokens[i];
      words.push(
        <Word
          key={i}
          index={i}
          text={token.text}
          state={i < activeToken ? "read" : i === activeToken ? "active" : "ahead"}
          inClause={token.clause === activeClause}
          bionic={bionic}
          acronym={badges ? token.acronym : undefined}
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

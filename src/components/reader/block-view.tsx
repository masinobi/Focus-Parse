"use client";

import * as React from "react";

import { ACRONYMS } from "@/lib/acronyms";
import { bionicSplit } from "@/lib/parse";
import { TIER_LABEL, type Tier } from "@/lib/tiers";
import type { Block, ParsedDoc } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The tier mark beside a section heading in the reading pane.
 *
 * Inline and small on purpose. It is a fact about the document, not a state of
 * the reader, so it must not compete with the caret or the clause spotlight —
 * the two things on this page that are allowed to move the eye.
 */
function TierBadge({ tier }: { tier: Tier }) {
  return (
    <span
      data-tier={tier}
      className={cn(
        "ml-2 select-none align-middle rounded px-1.5 py-0.5 font-sans text-[10px] font-medium uppercase tracking-wide",
        tier === "minimum"
          ? "bg-primary/15 text-primary"
          : "bg-muted text-muted-foreground"
      )}
    >
      {TIER_LABEL[tier]}
    </span>
  );
}

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

  if (block.kind === "code" && block.sqlSteps?.length) {
    return <SqlBlock doc={doc} block={block} activeToken={activeToken} onSeek={onSeek} style={style} />;
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

  /**
   * The tier this heading declares, where it declares one.
   *
   * Rendered beside the heading rather than over the prose, because the tier
   * *is* the heading — every sentence under it carries it, and a badge on each
   * one would be noise that says the same thing forty times. `blockStart` keeps
   * it on the heading that opened the section rather than on every heading
   * inside it.
   */
  const section = doc.sections[block.section];
  const tier =
    section?.tier && section.blockStart === block.i ? section.tier : null;

  switch (block.kind) {
    case "h1":
      return (
        <h1
          style={style}
          data-block={block.i}
          className="mb-4 mt-10 scroll-mt-24 font-sans text-2xl font-bold tracking-tight first:mt-0"
        >
          {words}
          {tier && <TierBadge tier={tier} />}
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
          {tier && <TierBadge tier={tier} />}
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
          {tier && <TierBadge tier={tier} />}
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

/**
 * A SQL statement, shown as written and lit up in the order it is evaluated.
 *
 * The whole point is the mismatch between the two, so the text is never
 * reordered on screen — the caret is what moves, jumping from the bottom of the
 * query to the top and back as each clause is spoken. Reordering the display
 * would hide exactly the thing the reader is here to notice.
 *
 * Every clause is clickable and seeks to its own step, which makes this the
 * only way to replay one clause without scrubbing through the query.
 */
function SqlBlock({
  doc,
  block,
  activeToken,
  onSeek,
  style,
}: {
  doc: ParsedDoc;
  block: Block;
  activeToken: number;
  onSeek: (tokenIndex: number) => void;
  style?: React.CSSProperties;
}) {
  const steps = block.sqlSteps ?? [];
  const raw = block.raw ?? "";

  // Which step is being spoken. A clause longer than one utterance is several
  // chunks of the same step, so this goes through the map rather than assuming
  // chunk k is step k.
  const stepOfChunk = block.sqlStepOfChunk;
  let active = -1;
  for (let k = 0; k < block.chunks.length; k++) {
    const chunk = doc.chunks[block.chunks[k]];
    if (activeToken >= chunk.tokenStart && activeToken < chunk.tokenEnd) {
      active = stepOfChunk?.[k] ?? k;
      break;
    }
  }

  /** First chunk of a step, which is where clicking its clause seeks to. */
  const firstChunkOf = (step: number): number | undefined => {
    if (!stepOfChunk) return block.chunks[step];
    const k = stepOfChunk.indexOf(step);
    return k === -1 ? undefined : block.chunks[k];
  };

  // Spans in written order, with the gaps between them — `WITH x AS (` belongs
  // to no clause and still has to be on screen.
  const inWritten = [...steps].sort((a, b) => a.start - b.start);
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const step of inWritten) {
    if (step.start > at) parts.push(raw.slice(at, step.start));
    const isActive = step.i === active;
    parts.push(
      <span
        key={step.i}
        data-sql-step={step.i}
        role="button"
        tabIndex={-1}
        title={`${step.i + 1} of ${steps.length} — ${step.role || "statement"}`}
        onClick={() => {
          const chunk = doc.chunks[firstChunkOf(step.i) ?? -1];
          if (chunk) onSeek(chunk.tokenStart);
        }}
        className={cn(
          "cursor-pointer rounded-sm",
          isActive
            ? "bg-primary/20 text-foreground ring-1 ring-primary/40"
            : "hover:bg-accent/60"
        )}
      >
        {raw.slice(step.start, step.end)}
      </span>
    );
    at = Math.max(at, step.end);
  }
  if (at < raw.length) parts.push(raw.slice(at));

  const current = active >= 0 ? steps[active] : null;

  return (
    <div className="relative my-5" style={style}>
      <div className="flex items-baseline gap-2 rounded-t-md border border-b-0 border-dashed bg-muted/60 px-3 py-1.5 font-sans text-xs">
        <span className="font-medium uppercase tracking-wider text-muted-foreground">
          T-SQL · stepped in evaluation order
        </span>
        {current && (
          <span className="ml-auto tabular-nums text-muted-foreground">
            {current.cte ? `${current.cte} · ` : ""}
            {current.i + 1} of {steps.length} — {current.role || "statement"}
          </span>
        )}
      </div>
      {/*
        Wrapped, not scrolled — the opposite of the plain code block above.
        There, horizontal scroll is fine: nobody is tracking a caret through it.
        Here the highlight moves on its own while the audio plays, and a clause
        that runs past the pane edge is a clause the reader cannot follow
        without dragging a scrollbar sideways mid-sentence. Real SQL lines are
        long and this pane is narrow, so it was every JOIN in the probe.
        `pl-6 -indent-6` hangs the continuation so a wrapped clause still reads
        as one line rather than as two statements.
      */}
      <pre
        data-block={block.i}
        className="fp-scroll overflow-x-auto whitespace-pre-wrap break-words rounded-b-md border border-dashed bg-muted/30 p-4 pl-6 -indent-6 font-mono text-xs leading-relaxed"
      >
        {parts}
      </pre>
    </div>
  );
}

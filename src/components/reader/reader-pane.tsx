"use client";

import * as React from "react";

import { BlockView } from "@/components/reader/block-view";
import { GridCards } from "@/components/reader/grid-cards";
import { RsvpView } from "@/components/reader/rsvp-view";
import { activeClauseIn, activeTokenIn, blockRanges } from "@/lib/flow";
import type { ParsedDoc } from "@/lib/types";
import { cn } from "@/lib/utils";
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

/**
 * The flow, as React elements, and what each one was rendered from.
 *
 * `nodes[i]` is the element for block `i`; `active[i]` and `clause[i]` are the
 * clamped values it was built with. Nothing is compared structurally — the
 * cache is only ever consulted by asking whether those two numbers still hold.
 */
interface FlowCache {
  doc: ParsedDoc;
  bionic: boolean;
  badges: boolean;
  onSeek: (tokenIndex: number) => void;
  estimates: number[] | null;
  active: Int32Array;
  clause: Int32Array;
  nodes: React.ReactNode[];
}

export function ReaderPane() {
  const doc = useFocusStore((s) => s.doc);
  const view = useFocusStore((s) => s.view);
  const tokenIndex = useFocusStore((s) => s.tokenIndex);
  const seekToken = useFocusStore((s) => s.seekToken);
  const anchors = useFocusStore((s) => s.anchors);
  const wpm = useFocusStore((s) => s.effectiveWpm());

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const cacheRef = React.useRef<FlowCache | null>(null);

  const deferred = Boolean(doc && doc.tokens.length > DEFER_THRESHOLD_TOKENS);
  const activeClause = doc?.tokens[tokenIndex]?.clause ?? -1;

  /**
   * The pulse should beat with the pace, not at a fixed rate, so its duration
   * is derived from measured words-per-minute and capped so it always finishes
   * before the next word lands.
   */
  const pulseMs = Math.max(90, Math.min(420, Math.round((60000 / wpm) * 0.8)));

  /** First and last token index owned by each block, for memo clamping. */
  const ranges = React.useMemo(() => (doc ? blockRanges(doc) : []), [doc]);

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

  // A grid takes over the pane entirely: the point of the flattener is that the
  // surrounding page is *not* competing for attention while it plays.
  const activeBlock = doc.blocks[doc.tokens[tokenIndex]?.block ?? -1];
  if (activeBlock?.kind === "table" && activeBlock.steps?.length) {
    return <GridCards doc={doc} block={activeBlock} tokenIndex={tokenIndex} />;
  }

  if (view === "rsvp") {
    return <RsvpView doc={doc} tokenIndex={tokenIndex} />;
  }

  /**
   * The flow, rebuilt only where it changed.
   *
   * Mapping over `doc.blocks` here allocated one React element per block per
   * spoken word, and React then reconciled all of them to conclude that all but
   * one was unchanged. `BlockView` is memoized, so nothing *re-rendered* — the
   * cost was entirely in producing and comparing the list. On the full GCDMP,
   * 5,404 blocks: 19% of the wall clock went into tasks over 50ms, with spikes
   * to 242ms, and the audio stuttered against them. RSVP, which plays the same
   * document with no flow at all, spent 1%.
   *
   * React skips an element that is *identical by reference* before it reaches
   * the memo comparison, so handing back the previous render's element for
   * every unchanged block removes both costs at once. `flow.test.ts` pins the
   * property this relies on: advancing one word changes the clamped values of
   * at most two blocks — the one being finished and the one being entered.
   *
   * What remains per word is a numeric loop over the blocks and three array
   * copies. The copies are not thrift: the cache is only sound while `nodes[i]`
   * and `active[i]` describe the same render, and a render React discards after
   * this ran must not leave the two disagreeing.
   */
  const cache = cacheRef.current;
  const reusable =
    cache !== null &&
    cache.doc === doc &&
    cache.bionic === (view === "bionic") &&
    cache.badges === anchors.badges &&
    cache.onSeek === seekToken &&
    cache.estimates === estimates;

  const nodes = reusable ? cache.nodes.slice() : new Array<React.ReactNode>(doc.blocks.length);
  const active = reusable ? Int32Array.from(cache.active) : new Int32Array(doc.blocks.length).fill(-2);
  const clause = reusable ? Int32Array.from(cache.clause) : new Int32Array(doc.blocks.length).fill(-2);

  for (let i = 0; i < doc.blocks.length; i++) {
    const range = ranges[i];
    const at = activeTokenIn(range, tokenIndex);
    const cl = activeClauseIn(range, tokenIndex, activeClause);
    if (active[i] === at && clause[i] === cl) continue;

    active[i] = at;
    clause[i] = cl;
    nodes[i] = (
      <BlockView
        key={doc.blocks[i].i}
        doc={doc}
        block={doc.blocks[i]}
        activeToken={at}
        activeClause={cl}
        bionic={view === "bionic"}
        badges={anchors.badges}
        onSeek={seekToken}
        deferHeight={estimates ? estimates[i] : undefined}
      />
    );
  }

  cacheRef.current = {
    doc,
    bionic: view === "bionic",
    badges: anchors.badges,
    onSeek: seekToken,
    estimates,
    active,
    clause,
    nodes,
  };
  const flow = nodes;

  return (
    <div ref={scrollRef} className="fp-scroll h-full overflow-y-auto px-8 py-10">
      <article
        style={{ "--fp-pulse-ms": `${pulseMs}ms` } as React.CSSProperties}
        className={cn(
          "fp-measure mx-auto font-reader text-[1.0625rem] leading-[1.85] text-foreground/90",
          anchors.caret && "fp-anchor-caret",
          anchors.pulse && "fp-anchor-pulse",
          anchors.spotlight && "fp-anchor-spotlight"
        )}
      >
        {flow}
        <div className="h-[40vh]" aria-hidden />
      </article>
    </div>
  );
}

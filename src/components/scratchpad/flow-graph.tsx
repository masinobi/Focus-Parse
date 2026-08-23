"use client";

import * as React from "react";
import { CornerDownRight, Link2, Unlink, X } from "lucide-react";

import { TAG_META } from "@/components/scratchpad/flow-node-card";
import type { FlowNode, LogicTag } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The captures, as the graph they were always describing.
 *
 * `/e`, `/m` and `/o` have been three colours on a list since the scratchpad
 * was written — the reader was tagging *what kind of thing* each note was and
 * the app was recording nothing about how they connect, so "the sponsor
 * delegates to the CRO, which produces the data management plan" came out as
 * three unrelated cards. Linked, it is one claim with a direction, and the
 * lanes make the shape of the claim visible: which entities were left with no
 * mechanism, which mechanisms produce nothing.
 *
 * Layout is computed rather than measured. Every node is the same size, so the
 * geometry is known before render and the edges can be drawn in one pass with
 * no reflow loop and no layout library.
 */

const NODE_W = 196;
const NODE_H = 66;
const COL_GAP = 44;
const ROW_GAP = 14;
const PAD = 14;
/** Room for the lane label above the first row. */
const HEADER_H = 26;

type Lane = LogicTag | "note";

const LANE_ORDER: Lane[] = ["entity", "mechanism", "output", "note"];

const LANE_LABEL: Record<Lane, string> = {
  entity: "Entity",
  mechanism: "Mechanism",
  output: "Output",
  note: "Note",
};

/** Stroke for an edge leaving a node, coloured by what it leaves. */
const LANE_STROKE: Record<Lane, string> = {
  entity: "hsl(var(--entity))",
  mechanism: "hsl(var(--mechanism))",
  output: "hsl(var(--output))",
  note: "hsl(var(--muted-foreground))",
};

interface Placed {
  node: FlowNode;
  lane: Lane;
  x: number;
  y: number;
}

interface FlowGraphProps {
  nodes: FlowNode[];
  chainHead: string | null;
  sectionTitle: (section: number) => string;
  onSeek: (tokenIndex: number) => void;
  onSetChainHead: (id: string | null) => void;
  onLink: (from: string, to: string) => void;
  onUnlink: (from: string, to: string) => void;
  onRemove: (id: string) => void;
}

export function FlowGraph({
  nodes,
  chainHead,
  sectionTitle,
  onSeek,
  onSetChainHead,
  onLink,
  onUnlink,
  onRemove,
}: FlowGraphProps) {
  const { placed, lanes, width, height } = React.useMemo(() => {
    const byLane = new Map<Lane, FlowNode[]>();
    for (const node of nodes) {
      const lane: Lane = node.tag ?? "note";
      const list = byLane.get(lane) ?? [];
      list.push(node);
      byLane.set(lane, list);
    }

    // An empty Note lane is dead space; the three tag lanes always show, so the
    // view reads as the /e /m /o structure even before anything is captured
    // into one of them.
    const active = LANE_ORDER.filter(
      (lane) => lane !== "note" || (byLane.get(lane)?.length ?? 0) > 0
    );

    const out: Placed[] = [];
    let rows = 0;
    active.forEach((lane, laneIndex) => {
      const list = (byLane.get(lane) ?? []).sort((a, b) => a.createdAt - b.createdAt);
      rows = Math.max(rows, list.length);
      list.forEach((node, rowIndex) => {
        out.push({
          node,
          lane,
          x: PAD + laneIndex * (NODE_W + COL_GAP),
          y: PAD + HEADER_H + rowIndex * (NODE_H + ROW_GAP),
        });
      });
    });

    return {
      placed: out,
      lanes: active,
      width: PAD * 2 + active.length * NODE_W + Math.max(0, active.length - 1) * COL_GAP,
      height: PAD * 2 + HEADER_H + Math.max(1, rows) * (NODE_H + ROW_GAP),
    };
  }, [nodes]);

  const positions = React.useMemo(
    () => new Map(placed.map((p) => [p.node.id, p])),
    [placed]
  );

  /**
   * Nodes an edge from the chain head may not reach: the head itself and
   * everything upstream of it, since an edge into one of those closes a cycle.
   * The store refuses those anyway — this is so the offer is never made, rather
   * than made and silently declined.
   */
  const wouldCycle = React.useMemo(() => {
    const blocked = new Set<string>();
    if (!chainHead) return blocked;

    const parents = new Map<string, string[]>();
    for (const node of nodes) {
      for (const target of node.links ?? []) {
        parents.set(target, [...(parents.get(target) ?? []), node.id]);
      }
    }

    const stack = [chainHead];
    while (stack.length) {
      const at = stack.pop() as string;
      if (blocked.has(at)) continue;
      blocked.add(at);
      stack.push(...(parents.get(at) ?? []));
    }
    return blocked;
  }, [nodes, chainHead]);

  const edges = React.useMemo(() => {
    const list: { from: Placed; to: Placed; d: string }[] = [];
    for (const p of placed) {
      for (const targetId of p.node.links ?? []) {
        const t = positions.get(targetId);
        if (!t) continue;
        list.push({ from: p, to: t, d: edgePath(p, t) });
      }
    }
    return list;
  }, [placed, positions]);

  if (!nodes.length) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <p className="max-w-xs text-sm text-muted-foreground">
          Nothing captured yet. Tag a note with{" "}
          <span className="font-mono">/e</span>, <span className="font-mono">/m</span> or{" "}
          <span className="font-mono">/o</span>, then link them into a chain.
        </p>
      </div>
    );
  }

  return (
    <div className="fp-scroll h-full overflow-auto p-1">
      <div className="relative" style={{ width, height }}>
        <svg
          width={width}
          height={height}
          className="pointer-events-none absolute inset-0"
          aria-hidden
        >
          <defs>
            {LANE_ORDER.map((lane) => (
              <marker
                key={lane}
                id={`fp-arrow-${lane}`}
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 8 4 L 0 7 z" fill={LANE_STROKE[lane]} />
              </marker>
            ))}
          </defs>

          {edges.map((edge) => (
            <path
              key={`${edge.from.node.id}->${edge.to.node.id}`}
              d={edge.d}
              fill="none"
              stroke={LANE_STROKE[edge.from.lane]}
              strokeWidth={1.5}
              strokeOpacity={0.55}
              markerEnd={`url(#fp-arrow-${edge.from.lane})`}
            />
          ))}
        </svg>

        {lanes.map((lane, i) => (
          <div
            key={lane}
            className="absolute text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            style={{ left: PAD + i * (NODE_W + COL_GAP), top: PAD, width: NODE_W }}
          >
            {LANE_LABEL[lane]}
          </div>
        ))}

        {placed.map((p) => (
          <GraphNode
            key={p.node.id}
            placed={p}
            isHead={chainHead === p.node.id}
            /**
             * With a chain open, every other node offers to be its target —
             * which is how two captures made minutes apart get connected once
             * the reader sees that they belong together.
             */
            linkableFrom={
              chainHead &&
              !wouldCycle.has(p.node.id) &&
              !(positions.get(chainHead)?.node.links ?? []).includes(p.node.id)
                ? chainHead
                : null
            }
            sectionTitle={sectionTitle(p.node.section)}
            outgoing={(p.node.links ?? []).filter((id) => positions.has(id))}
            onSeek={onSeek}
            onSetChainHead={onSetChainHead}
            onLink={onLink}
            onUnlink={onUnlink}
            onRemove={onRemove}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * A cubic between two placed nodes.
 *
 * Edges usually run left to right, but a mechanism may well point back at an
 * entity, and two nodes in the same lane can be linked. Both of those leave the
 * card on the side the line is actually heading, so an edge never crosses the
 * node it starts from.
 */
function edgePath(from: Placed, to: Placed): string {
  const y1 = from.y + NODE_H / 2;
  const y2 = to.y + NODE_H / 2;

  if (to.x > from.x) {
    const x1 = from.x + NODE_W;
    const x2 = to.x;
    const bend = Math.max(24, (x2 - x1) / 2);
    return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
  }

  if (to.x < from.x) {
    const x1 = from.x;
    const x2 = to.x + NODE_W;
    const bend = Math.max(24, (x1 - x2) / 2);
    return `M ${x1} ${y1} C ${x1 - bend} ${y1}, ${x2 + bend} ${y2}, ${x2} ${y2}`;
  }

  // Same lane: bulge out to the right rather than drawing straight through
  // every card between them.
  const x = from.x + NODE_W;
  return `M ${x} ${y1} C ${x + 46} ${y1}, ${x + 46} ${y2}, ${x} ${y2}`;
}

function GraphNode({
  placed,
  isHead,
  linkableFrom,
  sectionTitle,
  outgoing,
  onSeek,
  onSetChainHead,
  onLink,
  onUnlink,
  onRemove,
}: {
  placed: Placed;
  isHead: boolean;
  /** Id of the open chain head, when an edge into this node could be drawn. */
  linkableFrom: string | null;
  sectionTitle: string;
  outgoing: string[];
  onSeek: (tokenIndex: number) => void;
  onSetChainHead: (id: string | null) => void;
  onLink: (from: string, to: string) => void;
  onUnlink: (from: string, to: string) => void;
  onRemove: (id: string) => void;
}) {
  const { node, lane } = placed;
  const meta = node.tag ? TAG_META[node.tag] : null;

  return (
    <div
      className={cn(
        "group absolute rounded-md border-l-2 border bg-card px-2 py-1.5 shadow-sm transition-colors",
        meta ? meta.ring : "border-l-muted-foreground/30",
        isHead && "ring-2 ring-primary"
      )}
      style={{ left: placed.x, top: placed.y, width: NODE_W, height: NODE_H }}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onSeek(node.tokenIndex)}
          title={`Jump to where this was captured — ${sectionTitle}`}
          className="min-w-0 flex-1 truncate text-left text-[10px] text-muted-foreground hover:text-foreground hover:underline"
        >
          {sectionTitle}
        </button>

        {linkableFrom && (
          <button
            type="button"
            onClick={() => onLink(linkableFrom, node.id)}
            title="Draw an edge from the chained node into this one"
            aria-label="Link the chained node into this one"
            className="rounded p-0.5 text-primary hover:bg-accent"
          >
            <CornerDownRight className="h-3 w-3" />
          </button>
        )}

        <button
          type="button"
          onClick={() => onSetChainHead(isHead ? null : node.id)}
          title={isHead ? "Stop chaining from here" : "Chain the next capture from here"}
          aria-label={isHead ? "Stop chaining from here" : "Chain from here"}
          className={cn(
            "rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground",
            isHead && "text-primary"
          )}
        >
          <Link2 className="h-3 w-3" />
        </button>

        {outgoing.length > 0 && (
          <button
            type="button"
            onClick={() => onUnlink(node.id, outgoing[outgoing.length - 1])}
            title="Remove the most recent link out of this node"
            aria-label="Remove the most recent link"
            className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus:opacity-100 group-hover:opacity-100"
          >
            <Unlink className="h-3 w-3" />
          </button>
        )}

        <button
          type="button"
          onClick={() => onRemove(node.id)}
          aria-label="Delete node"
          className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/15 hover:text-destructive focus:opacity-100 group-hover:opacity-100"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      <p
        className="mt-0.5 overflow-hidden text-[12px] leading-snug"
        style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}
        title={node.text}
      >
        {node.text}
      </p>

      {outgoing.length > 1 && (
        <span className="absolute bottom-0.5 right-1.5 text-[9px] tabular-nums text-muted-foreground">
          {outgoing.length} out
        </span>
      )}

      <span className="sr-only">{LANE_LABEL[lane]}</span>
    </div>
  );
}

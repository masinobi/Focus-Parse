"use client";

import * as React from "react";
import { Boxes, Cog, Link2, Target, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { FlowNode, LogicTag } from "@/lib/types";
import { cn } from "@/lib/utils";

export const TAG_META: Record<
  LogicTag,
  { label: string; key: string; icon: React.ElementType; ring: string; rail: string }
> = {
  entity: {
    label: "Entity",
    key: "/e",
    icon: Boxes,
    ring: "border-entity/40",
    rail: "bg-entity",
  },
  mechanism: {
    label: "Mechanism",
    key: "/m",
    icon: Cog,
    ring: "border-mechanism/40",
    rail: "bg-mechanism",
  },
  output: {
    label: "Output",
    key: "/o",
    icon: Target,
    ring: "border-output/40",
    rail: "bg-output",
  },
};

interface FlowNodeCardProps {
  node: FlowNode;
  sectionTitle: string;
  isLast: boolean;
  /** True when the next capture will attach to this node. */
  isHead: boolean;
  /** Outgoing edges that still point at a node that exists. */
  outgoing: number;
  onRemove: (id: string) => void;
  onRetag: (id: string, tag: LogicTag | null) => void;
  onSeek: (tokenIndex: number) => void;
  onSetChainHead: (id: string | null) => void;
}

export function FlowNodeCard({
  node,
  sectionTitle,
  isLast,
  isHead,
  outgoing,
  onRemove,
  onRetag,
  onSeek,
  onSetChainHead,
}: FlowNodeCardProps) {
  const meta = node.tag ? TAG_META[node.tag] : null;
  const Icon = meta?.icon;

  return (
    <div className="relative pl-5">
      {/* Flow rail: the vertical spine that makes the notes read as a chain. */}
      <span
        className={cn(
          "absolute left-[7px] top-3 h-2 w-2 rounded-full",
          meta ? meta.rail : "bg-muted-foreground/40"
        )}
      />
      {!isLast && (
        <span className="absolute bottom-[-10px] left-[10px] top-5 w-px bg-border" />
      )}

      <Card
        className={cn(
          "group animate-node-in border-l-2 bg-card/60 px-3 py-2",
          meta ? meta.ring : "border-l-muted-foreground/30",
          isHead && "ring-2 ring-primary"
        )}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              {node.tag && meta && Icon ? (
                <Badge variant={node.tag} className="gap-1 px-1.5 py-0 text-[10px]">
                  <Icon className="h-2.5 w-2.5" />
                  {meta.label}
                </Badge>
              ) : (
                <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">
                  note
                </Badge>
              )}
              <button
                type="button"
                onClick={() => onSeek(node.tokenIndex)}
                className="truncate text-[10px] text-muted-foreground hover:text-foreground hover:underline"
                title={`Jump to where this was captured — ${sectionTitle}`}
              >
                {sectionTitle}
              </button>
              {outgoing > 0 && (
                <span
                  className="flex items-center gap-0.5 text-[10px] text-muted-foreground"
                  title={`Links out to ${outgoing} ${outgoing === 1 ? "node" : "nodes"}`}
                >
                  <Link2 className="h-2.5 w-2.5" />
                  {outgoing}
                </span>
              )}
            </div>

            <p className="whitespace-pre-wrap break-words text-sm leading-snug">
              {node.text}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            {(Object.keys(TAG_META) as LogicTag[]).map((tag) => {
              const TagIcon = TAG_META[tag].icon;
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => onRetag(node.id, node.tag === tag ? null : tag)}
                  className={cn(
                    "rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground",
                    node.tag === tag && "text-foreground"
                  )}
                  aria-label={`Tag as ${TAG_META[tag].label}`}
                  title={`${TAG_META[tag].label} (${TAG_META[tag].key})`}
                >
                  <TagIcon className="h-3 w-3" />
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => onSetChainHead(isHead ? null : node.id)}
              className={cn(
                "rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground",
                isHead && "text-primary"
              )}
              aria-label={isHead ? "Stop chaining from here" : "Chain from here"}
              title={
                isHead
                  ? "Stop chaining from here"
                  : "Chain the next capture from this node"
              }
            >
              <Link2 className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => onRemove(node.id)}
              className="rounded p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
              aria-label="Delete node"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}

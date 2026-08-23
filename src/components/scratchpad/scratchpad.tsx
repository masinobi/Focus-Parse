"use client";

import * as React from "react";
import { CornerDownLeft, Link2, ListTree, Network, PenLine, X } from "lucide-react";

import { FlowGraph } from "@/components/scratchpad/flow-graph";
import { FlowNodeCard, TAG_META } from "@/components/scratchpad/flow-node-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { LogicTag } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useFocusStore } from "@/store/useFocusStore";

/** `/e`, `/m`, `/o` at the end of the buffer, preceded by a space or nothing. */
const TAG_TRIGGER = /(^|\s)\/(e|m|o)$/i;

const TRIGGER_TO_TAG: Record<string, LogicTag> = {
  e: "entity",
  m: "mechanism",
  o: "output",
};

/**
 * Kinetic re-encoding workspace. Capture is deliberately one-keystroke-cheap:
 * typing a tag trigger commits the buffer immediately, so the hand never leaves
 * the keyboard and the audio never has to stop.
 */
export function Scratchpad() {
  const [draft, setDraft] = React.useState("");
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  const [mode, setMode] = React.useState<"list" | "graph">("list");

  const doc = useFocusStore((s) => s.doc);
  const nodes = useFocusStore((s) => s.nodes);
  const chainHead = useFocusStore((s) => s.chainHead);
  const addNode = useFocusStore((s) => s.addNode);
  const removeNode = useFocusStore((s) => s.removeNode);
  const retagNode = useFocusStore((s) => s.retagNode);
  const seekToken = useFocusStore((s) => s.seekToken);
  const notePresence = useFocusStore((s) => s.notePresence);
  const setChainHead = useFocusStore((s) => s.setChainHead);
  const linkNodes = useFocusStore((s) => s.linkNodes);
  const unlinkNodes = useFocusStore((s) => s.unlinkNodes);

  const commit = React.useCallback(
    (text: string, tag: LogicTag | null) => {
      if (!text.trim()) return;
      addNode(text, tag);
      setDraft("");
    },
    [addNode]
  );

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    // Typing here is the most demanding thing the app asks for, and it is proof
    // of presence in its own right. Answering the vigilance check from the pad
    // means the reader doing the harder work is never interrupted to prove they
    // are doing the easier one.
    notePresence();

    const value = event.target.value;
    const match = TAG_TRIGGER.exec(value);

    if (match) {
      const body = value.slice(0, value.length - match[0].length);
      const tag = TRIGGER_TO_TAG[match[2].toLowerCase()];
      if (body.trim()) {
        commit(body, tag);
        return;
      }
      // Trigger typed with nothing to tag: drop it rather than leaving "/e".
      setDraft("");
      return;
    }

    setDraft(value);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      commit(draft, null);
    }
  };

  React.useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [nodes.length]);

  const headNode = React.useMemo(
    () => nodes.find((n) => n.id === chainHead) ?? null,
    [nodes, chainHead]
  );

  /** Edges that still point at a node that exists, per node. */
  const outgoing = React.useMemo(() => {
    const alive = new Set(nodes.map((n) => n.id));
    const counts: Record<string, number> = {};
    for (const node of nodes) {
      // Sessions carry no schema version: every node written before linking
      // reads back with no `links` at all.
      counts[node.id] = (node.links ?? []).filter((id) => alive.has(id)).length;
    }
    return counts;
  }, [nodes]);

  const sectionTitle = (index: number) =>
    doc?.sections[index]?.title ?? "Unsectioned";

  const counts = React.useMemo(() => {
    const base: Record<LogicTag, number> = { entity: 0, mechanism: 0, output: 0 };
    for (const n of nodes) if (n.tag) base[n.tag] += 1;
    return base;
  }, [nodes]);

  return (
    <div className="flex h-full flex-col bg-muted/10">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <PenLine className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Re-encoding</span>
        <span className="text-xs text-muted-foreground">
          {nodes.length} {nodes.length === 1 ? "node" : "nodes"}
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <div className="mr-1 flex items-center gap-0.5">
            {(
              [
                ["list", "List", ListTree],
                ["graph", "Graph", Network],
              ] as ["list" | "graph", string, React.ElementType][]
            ).map(([id, label, Icon]) => (
              <Button
                key={id}
                variant={mode === id ? "secondary" : "ghost"}
                size="sm"
                className="h-6 gap-1 px-1.5 text-[11px]"
                onClick={() => setMode(id)}
                aria-pressed={mode === id}
                title={`${label} view`}
              >
                <Icon className="h-3 w-3" />
                {label}
              </Button>
            ))}
          </div>

          {(Object.keys(TAG_META) as LogicTag[]).map((tag) => (
            <Badge
              key={tag}
              variant={counts[tag] > 0 ? tag : "outline"}
              className={cn(
                "gap-1 px-1.5 py-0 text-[10px] tabular-nums",
                counts[tag] === 0 && "text-muted-foreground"
              )}
            >
              {TAG_META[tag].key}
              <span className="opacity-70">{counts[tag]}</span>
            </Badge>
          ))}
        </div>
      </div>

      {mode === "graph" ? (
        <div className="min-h-0 flex-1">
          <FlowGraph
            nodes={nodes}
            chainHead={chainHead}
            sectionTitle={sectionTitle}
            onSeek={seekToken}
            onSetChainHead={setChainHead}
            onLink={linkNodes}
            onUnlink={unlinkNodes}
            onRemove={removeNode}
          />
        </div>
      ) : (
      <div ref={listRef} className="fp-scroll flex-1 space-y-2.5 overflow-y-auto px-4 py-4">
        {nodes.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="max-w-xs text-sm text-muted-foreground">
              Restate what you hear, in your own words, while it is still moving.
            </p>
            <div className="space-y-1.5 text-left text-xs text-muted-foreground">
              {(Object.keys(TAG_META) as LogicTag[]).map((tag) => (
                <p key={tag} className="flex items-center gap-2">
                  <kbd className="rounded border bg-background px-1.5 py-0.5 font-mono text-[10px]">
                    {TAG_META[tag].key}
                  </kbd>
                  <span>{TAG_META[tag].label}</span>
                </p>
              ))}
              <p className="flex items-center gap-2 pt-1">
                <kbd className="rounded border bg-background px-1.5 py-0.5 font-mono text-[10px]">
                  Enter
                </kbd>
                <span>Untagged note</span>
              </p>
            </div>
          </div>
        ) : (
          nodes.map((node, i) => (
            <FlowNodeCard
              key={node.id}
              node={node}
              sectionTitle={sectionTitle(node.section)}
              isLast={i === nodes.length - 1}
              isHead={node.id === chainHead}
              outgoing={outgoing[node.id] ?? 0}
              onRemove={removeNode}
              onRetag={retagNode}
              onSeek={seekToken}
              onSetChainHead={setChainHead}
            />
          ))
        )}
      </div>
      )}

      <div className="border-t bg-background/60 p-3">
        {/* The chain: which node the next capture attaches to. Committing then
            hands the chain to the new node, so /e /m /o in a row builds
            entity → mechanism → output with no extra keystrokes. */}
        {headNode ? (
          <div className="mb-2 flex items-center gap-2 rounded border border-primary/40 bg-primary/5 px-2 py-1 text-[11px]">
            <Link2 className="h-3 w-3 shrink-0 text-primary" />
            <span className="shrink-0 text-muted-foreground">Chaining from</span>
            <span className="min-w-0 flex-1 truncate">{headNode.text}</span>
            <button
              type="button"
              onClick={() => setChainHead(null)}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Stop chaining"
              title="Stop chaining (the next capture stands alone)"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          nodes.length > 0 && (
            <button
              type="button"
              onClick={() => setChainHead(nodes[nodes.length - 1].id)}
              className="mb-2 flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
              title="Attach the next capture to the last one"
            >
              <Link2 className="h-3 w-3" />
              Chain from the last node
            </button>
          )
        )}

        <Textarea
          ref={inputRef}
          value={draft}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Type the idea, then /e, /m or /o to commit it as a node…"
          spellCheck={false}
          className="min-h-[72px] resize-none bg-background text-sm leading-relaxed"
        />

        <div className="mt-2 flex items-center gap-1.5">
          {(Object.keys(TAG_META) as LogicTag[]).map((tag) => {
            const Icon = TAG_META[tag].icon;
            return (
              <Button
                key={tag}
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs"
                disabled={!draft.trim()}
                onClick={() => {
                  commit(draft, tag);
                  inputRef.current?.focus();
                }}
              >
                <Icon className="h-3 w-3" />
                {TAG_META[tag].label}
              </Button>
            );
          })}

          <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
            <CornerDownLeft className="h-3 w-3" />
            commit · Shift+Enter newline
          </span>
        </div>
      </div>
    </div>
  );
}

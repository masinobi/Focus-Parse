"use client";

import * as React from "react";
import { CornerDownLeft, Inbox, Link2, ListTree, Network, PenLine, X } from "lucide-react";

import { FlowGraph } from "@/components/scratchpad/flow-graph";
import { FlowNodeCard, TAG_META } from "@/components/scratchpad/flow-node-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { LogicTag } from "@/lib/types";
import { cn } from "@/lib/utils";
import { parkedNodes, readingNodes, useFocusStore } from "@/store/useFocusStore";

/** `/e`, `/m`, `/o`, `/p` at the end of the buffer, preceded by a space or nothing. */
const TAG_TRIGGER = /(^|\s)\/(e|m|o|p)$/i;

const TRIGGER_TO_TAG: Record<string, LogicTag> = {
  e: "entity",
  m: "mechanism",
  o: "output",
};

/**
 * The fourth trigger, and the only one that is not a tag.
 *
 * Reading dense guidance surfaces thoughts that have nothing to do with it —
 * an errand, a work thing, a question about something three chapters back.
 * Ignoring one means ruminating on it; switching windows to write it down ends
 * the session. Both cost more than the thought is worth.
 *
 * `/p` drops it out of the way in the same keystroke as everything else here,
 * and because typing in this pad already counts as a presence check, parking a
 * thought never triggers the vigilance pill either. What it does not do is join
 * the chain or draw in the graph: the whole point is that it is *not* part of
 * the argument being built.
 */
const PARK_TRIGGER = "p";

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
  const [showParked, setShowParked] = React.useState(false);

  const doc = useFocusStore((s) => s.doc);
  const stored = useFocusStore((s) => s.nodes);
  /**
   * Everything below works on the reading nodes only. Parked thoughts are still
   * in `stored` — they have to survive a reload and they keep the token they
   * were dropped at — but they are not part of the argument, so they are not
   * part of the list, the graph, the counts or the chain.
   */
  const nodes = React.useMemo(() => readingNodes(stored), [stored]);
  const parked = React.useMemo(() => parkedNodes(stored), [stored]);
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
    (text: string, tag: LogicTag | null, parked = false) => {
      if (!text.trim()) return;
      addNode(text, tag, parked);
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
      const key = match[2].toLowerCase();
      const parked = key === PARK_TRIGGER;
      const tag = parked ? null : TRIGGER_TO_TAG[key];
      if (body.trim()) {
        commit(body, tag, parked);
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

        {parked.length > 0 && (
          <button
            type="button"
            onClick={() => setShowParked((v) => !v)}
            aria-pressed={showParked}
            className={cn(
              "flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] tabular-nums",
              showParked
                ? "border-primary/50 bg-primary/10 text-foreground"
                : "text-muted-foreground hover:bg-accent"
            )}
            title="Thoughts you parked while reading"
          >
            <Inbox className="h-3 w-3" />
            {parked.length} parked
          </button>
        )}

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

      {/* The drawer that hands them back.
          Deliberately a list of plain text with a way to delete and a way to
          jump to where it was dropped, and deliberately nothing else — no tag,
          no chain, no place in the graph. A parked thought that grew features
          would start competing for the attention it exists to protect. */}
      {showParked && parked.length > 0 && (
        <div className="fp-scroll max-h-48 shrink-0 overflow-y-auto border-b bg-background/40 px-4 py-3">
          <p className="mb-2 text-[11px] text-muted-foreground">
            Parked while reading. Not part of the map.
          </p>
          <ul className="space-y-1.5">
            {parked.map((node) => (
              <li key={node.id} className="flex items-start gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => seekToken(node.tokenIndex)}
                  className="min-w-0 flex-1 rounded px-1 py-0.5 text-left hover:bg-accent"
                  title={`Back to ${sectionTitle(node.section)}`}
                >
                  <span className="block">{node.text}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {sectionTitle(node.section)}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => removeNode(node.id)}
                  className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="Delete parked note"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

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
              <p className="flex items-center gap-2">
                <kbd className="rounded border bg-background px-1.5 py-0.5 font-mono text-[10px]">
                  /p
                </kbd>
                <span>Park an off-topic thought</span>
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
          placeholder="Type the idea, then /e, /m or /o to commit it — or /p to park it…"
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

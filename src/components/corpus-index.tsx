"use client";

import * as React from "react";
import {
  ArrowLeft,
  Columns2,
  Library,
  Loader2,
  Network,
  Search,
  TriangleAlert,
} from "lucide-react";

import { ComparePanel } from "@/components/compare-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ACRONYMS } from "@/lib/acronyms";
import { db } from "@/lib/db";
import { mergeEntityIndexes, type CorpusEntity, type DocEntityIndex } from "@/lib/entities";
import type { WeakTerms } from "@/lib/review";
import { cn } from "@/lib/utils";
import { useFocusStore } from "@/store/useFocusStore";

/**
 * The corpus view.
 *
 * Nine guidelines on one subject were nine separate reading sessions with no
 * thread between them. This is that thread: every named thing the parser found,
 * with the documents that use it and a way into each one at the place it first
 * appears. Terms the retrieval queue says are not sticking are marked, because
 * "this is in four documents and you keep losing it" is a different instruction
 * from "this is in four documents".
 *
 * Everything shown is read from the stored per-document indexes rather than
 * from the documents themselves — the merge is over a few thousand small
 * records, not over half a million tokens.
 */

interface CorpusIndexProps {
  onBack: () => void;
}

type KindFilter = "all" | "acronym" | "term";

/** Rows rendered at once. The list is not virtualized; the rest is reported. */
const MAX_ROWS = 200;

export function CorpusIndex({ onBack }: CorpusIndexProps) {
  const [indexes, setIndexes] = React.useState<DocEntityIndex[] | null>(null);
  const [progress, setProgress] = React.useState<string | null>(null);
  const [weak, setWeak] = React.useState<WeakTerms>({});
  const [query, setQuery] = React.useState("");
  const [kind, setKind] = React.useState<KindFilter>("all");
  const [sharedOnly, setSharedOnly] = React.useState(true);
  /**
   * The phrase being compared, or `null` for the index itself.
   *
   * A sub-view rather than another home-screen mode. There are eight of those
   * already, and comparison is not a ninth thing to do with the corpus — it is
   * what the corpus view was for.
   */
  const [comparing, setComparing] = React.useState<string | null>(null);

  const loadDoc = useFocusStore((s) => s.loadDoc);
  const hydrateSession = useFocusStore((s) => s.hydrateSession);
  const seekToken = useFocusStore((s) => s.seekToken);

  React.useEffect(() => {
    let live = true;
    void db
      .listEntityIndexes((done, total, title) => {
        if (!live) return;
        // Only meaningful on the first open after an upgrade, when indexes are
        // being built rather than read.
        setProgress(done < total ? `Indexing ${done + 1} of ${total} — ${title}` : null);
      })
      .then((list) => {
        if (!live) return;
        setIndexes(list);
        setProgress(null);
        // Only one document indexed: "in more than one document" would hide
        // everything, so start unfiltered instead of showing an empty list.
        if (list.length < 2) setSharedOnly(false);
      });
    void db.weakTerms().then((w) => live && setWeak(w));
    return () => {
      live = false;
    };
  }, []);

  const entities = React.useMemo(
    () => (indexes ? mergeEntityIndexes(indexes) : []),
    [indexes]
  );

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entities.filter((e) => {
      if (sharedOnly && e.docs.length < 2) return false;
      if (kind !== "all" && e.kind !== kind) return false;
      if (!needle) return true;
      if (e.display.toLowerCase().includes(needle)) return true;
      // An acronym is findable by what it stands for, not only by its letters.
      const expansion = e.kind === "acronym" ? ACRONYMS[e.key]?.expansion : undefined;
      return expansion ? expansion.toLowerCase().includes(needle) : false;
    });
  }, [entities, query, kind, sharedOnly]);

  const open = async (docId: string, tokenIndex: number) => {
    const doc = await db.getDoc(docId);
    if (!doc) return;
    loadDoc(doc);
    // Hydrate first, then seek: hydration restores the stored reading position,
    // and the seek has to be the last word on where this lands.
    await hydrateSession(docId);
    seekToken(tokenIndex);
  };

  const truncated = (indexes ?? []).reduce((sum, i) => sum + i.truncated, 0);

  if (comparing !== null) {
    return (
      <ComparePanel
        phrase={comparing}
        onPhrase={setComparing}
        onBack={() => setComparing(null)}
        onOpen={open}
      />
    );
  }

  if (indexes === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        {progress && <p className="text-xs text-muted-foreground">{progress}</p>}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b px-4 py-2.5">
        <Library className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">Corpus index</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {entities.length.toLocaleString()} terms · {indexes.length}{" "}
          {indexes.length === 1 ? "document" : "documents"}
        </span>
        <Button variant="ghost" size="sm" className="ml-auto h-7 gap-1.5" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search terms and expansions…"
            aria-label="Search the corpus index"
            spellCheck={false}
            className="h-9 pl-8"
          />
        </div>

        <div className="flex items-center gap-1">
          {(
            [
              ["all", "All"],
              ["acronym", "Acronyms"],
              ["term", "Terms"],
            ] as [KindFilter, string][]
          ).map(([id, label]) => (
            <Button
              key={id}
              variant={kind === id ? "secondary" : "ghost"}
              size="sm"
              className="h-8"
              onClick={() => setKind(id)}
            >
              {label}
            </Button>
          ))}
        </div>

        <Button
          variant={sharedOnly ? "secondary" : "ghost"}
          size="sm"
          className="h-8 gap-1.5"
          onClick={() => setSharedOnly((v) => !v)}
          title="Only terms that appear in more than one document"
        >
          <Network className="h-3.5 w-3.5" />
          Shared
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5"
          onClick={() => setComparing(query.trim())}
          title="Read one phrase across every document at once"
        >
          <Columns2 className="h-3.5 w-3.5" />
          Compare
        </Button>
      </div>

      <div className="fp-scroll flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-4">
          {filtered.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm text-muted-foreground">
                {entities.length === 0
                  ? "No documents indexed yet. Read something first."
                  : `Nothing is indexed under “${query.trim()}”.`}
              </p>

              {/* The dead end this index has always had, now with a way out of
                  it. Only capitalized names are indexed, so an ordinary
                  lowercase term — "audit trail" is in ten of the twelve
                  documents and indexed in none — lands here and reads as
                  "the corpus does not cover this". It does. */}
              {entities.length > 0 && query.trim() && (
                <>
                  <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground">
                    Only capitalized names are indexed. A term the guidelines write
                    in lowercase — “audit trail”, “database lock” — is in the text
                    but never in this list.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4 gap-1.5"
                    onClick={() => setComparing(query.trim())}
                  >
                    <Columns2 className="h-3.5 w-3.5" />
                    Search the documents for “{query.trim()}”
                  </Button>
                </>
              )}
            </div>
          ) : (
            <div className="divide-y rounded-md border">
              {filtered.slice(0, MAX_ROWS).map((entity) => (
                <EntityRow
                  key={entity.key}
                  entity={entity}
                  lapses={weak[entity.key]?.lapses ?? 0}
                  onOpen={open}
                  onCompare={setComparing}
                />
              ))}
            </div>
          )}

          {filtered.length > MAX_ROWS && (
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Showing the first {MAX_ROWS} of {filtered.length.toLocaleString()} — narrow
              it with the search box.
            </p>
          )}

          {truncated > 0 && (
            <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <TriangleAlert className="h-3 w-3" />
              {truncated.toLocaleString()} rarer terms were left out of the stored
              indexes.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function EntityRow({
  entity,
  lapses,
  onOpen,
  onCompare,
}: {
  entity: CorpusEntity;
  lapses: number;
  onOpen: (docId: string, tokenIndex: number) => void;
  onCompare: (phrase: string) => void;
}) {
  const expansion = entity.kind === "acronym" ? ACRONYMS[entity.key]?.expansion : undefined;

  return (
    <div className="px-3 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {entity.kind === "acronym" && entity.category ? (
          <span className={cn("fp-badge", `fp-badge-${entity.category}`)}>
            {entity.display}
          </span>
        ) : (
          <span className="text-sm font-medium">{entity.display}</span>
        )}

        {expansion && (
          <span className="text-xs text-muted-foreground">{expansion}</span>
        )}

        {lapses > 0 && (
          <span
            className="rounded border border-destructive/40 px-1.5 py-0 text-[10px] text-destructive"
            title="You have failed this in review"
          >
            lost {lapses}×
          </span>
        )}

        <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
          {entity.docs.length} {entity.docs.length === 1 ? "doc" : "docs"} ·{" "}
          {entity.total.toLocaleString()}×
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {entity.docs.map((d) => (
          <button
            key={d.docId}
            type="button"
            onClick={() => onOpen(d.docId, d.first)}
            title={`Open ${d.docTitle} at the first mention`}
            className="max-w-[16rem] truncate rounded border bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
          >
            {d.docTitle}
            <span className="ml-1 tabular-nums opacity-70">{d.count}</span>
          </button>
        ))}

        {/* Only where there is something to compare it against. One document
            saying a term is not a disagreement between guidelines. */}
        {entity.docs.length > 1 && (
          <button
            type="button"
            onClick={() => onCompare(entity.display)}
            title={`Read every mention of ${entity.display} side by side`}
            className="flex items-center gap-1 rounded border border-dashed px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
          >
            <Columns2 className="h-3 w-3" />
            Compare
          </button>
        )}
      </div>
    </div>
  );
}

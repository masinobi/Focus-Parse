"use client";

import * as React from "react";
import { ArrowLeft, Columns2, Loader2, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DocComparison } from "@/lib/compare";
import { db } from "@/lib/db";

/**
 * One phrase, as every guideline in the corpus writes it.
 *
 * The exam tests operational differences between documents that all describe
 * the same process, and the app had no way to put two of them next to each
 * other. Switching tabs between a 524-page PDF and a regulation is not a
 * comparison — by the time the second passage is on screen the first one is
 * gone.
 *
 * The phrase is typed rather than picked from a list, and that is the point.
 * The corpus index lists capitalized names; the terms this panel exists for are
 * ordinary prose, and none of them are in it. Entering from an entity row is a
 * convenience, not the route.
 */

interface ComparePanelProps {
  phrase: string;
  onPhrase: (phrase: string) => void;
  onBack: () => void;
  onOpen: (docId: string, tokenIndex: number) => void;
}

/** Long enough that a phrase is not searched letter by letter as it is typed. */
const DEBOUNCE_MS = 250;

export function ComparePanel({ phrase, onPhrase, onBack, onOpen }: ComparePanelProps) {
  const [rows, setRows] = React.useState<DocComparison[] | null>(null);
  const [searching, setSearching] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void db.comparePhrase(phrase).then((found) => {
        if (!live) return;
        setRows(found);
        setSearching(false);
      });
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [phrase]);

  const mentions = (rows ?? []).reduce((sum, r) => sum + r.count, 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b px-4 py-2.5">
        <Columns2 className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">Compare across documents</span>
        {rows !== null && rows.length > 0 && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {rows.length} {rows.length === 1 ? "document" : "documents"} ·{" "}
            {mentions.toLocaleString()} {mentions === 1 ? "mention" : "mentions"}
          </span>
        )}
        <Button variant="ghost" size="sm" className="ml-auto h-7 gap-1.5" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Index
        </Button>
      </div>

      <div className="shrink-0 border-b px-4 py-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={phrase}
            onChange={(e) => onPhrase(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && phrase) {
                e.stopPropagation();
                onPhrase("");
              }
            }}
            aria-label="Phrase to compare across documents"
            placeholder="audit trail"
            spellCheck={false}
            className="h-9 pl-8 pr-8"
          />
          {phrase && (
            <button
              type="button"
              onClick={() => onPhrase("")}
              aria-label="Clear the phrase"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* What the match rule is, stated where the reader can act on it. A
            panel that quietly finds nothing teaches the reader the corpus does
            not cover the topic, which is usually the opposite of true.

            Deliberately no worked example. The one written here first —
            "sponsor oversight" will not find "oversight by the sponsor" — turned
            out to be false twice over: E6(R3) carries "Sponsor Oversight" as a
            heading *and* "Oversight by the sponsor" as a sentence. An
            illustration the app itself disproves is worse than none. */}
        <p className="mt-2 text-xs text-muted-foreground">
          These exact words, in this order — only the last may be singular or
          plural. A guideline that words the same idea differently will not be
          found, so try the wording the guidelines use rather than the exam’s.
          Front matter and reference lists are skipped.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows === null || searching ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : !phrase.trim() ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            Type a phrase to see how each guideline handles it.
          </p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            No document says “{phrase.trim()}”. Try the words the guidelines use —
            they rarely match the words an exam question uses.
          </p>
        ) : (
          <div className="divide-y">
            {rows.map((row) => (
              <DocumentColumn key={row.docId} row={row} onOpen={onOpen} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DocumentColumn({
  row,
  onOpen,
}: {
  row: DocComparison;
  onOpen: (docId: string, tokenIndex: number) => void;
}) {
  const held = row.count - row.sites.length;

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-sm font-medium">{row.docTitle}</span>
        <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
          {/* A capped document must say what it is holding back, or three of
              thirty reads as three. */}
          {held > 0
            ? `${row.sites.length} of ${row.count.toLocaleString()} mentions`
            : `${row.count.toLocaleString()} ${row.count === 1 ? "mention" : "mentions"}`}
        </span>
      </div>

      <div className="mt-2 space-y-2">
        {row.sites.map((site) => (
          <button
            key={site.token}
            type="button"
            onClick={() => onOpen(row.docId, site.token)}
            title="Open this document here"
            className="block w-full rounded-md border bg-muted/30 px-3 py-2 text-left transition-colors hover:border-foreground/40"
          >
            {/* A heading match is a stronger fact than a passing mention — this
                guideline gave the term a section of its own — but its "carrier
                sentence" is the heading, so quoting it as prose renders a box
                repeating the label above it. Said once, as what it is. */}
            {site.heading ? (
              <span className="block text-sm leading-relaxed">
                <mark className="rounded bg-primary/20 px-0.5 text-foreground">
                  {site.text}
                </mark>
                <span className="ml-2 text-xs text-muted-foreground">
                  — a section of its own
                </span>
              </span>
            ) : (
              <>
                <span className="block text-[11px] uppercase tracking-wider text-muted-foreground">
                  {site.sectionTitle}
                </span>
                <span className="mt-1 block text-sm leading-relaxed">
                  {site.text.slice(0, site.from)}
                  <mark className="rounded bg-primary/20 px-0.5 text-foreground">
                    {site.text.slice(site.from, site.to)}
                  </mark>
                  {site.text.slice(site.to)}
                </span>
              </>
            )}
          </button>
        ))}
      </div>

      {held > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {held.toLocaleString()} more not shown — this is a comparison, not a
          concordance. Open the document to read the rest.
        </p>
      )}
    </div>
  );
}


"use client";

import * as React from "react";
import { ArrowLeft, Gavel, Loader2, Scale } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  buildCitationIndex,
  type CitationSite,
  type ProvisionEntry,
  type RegulationEntry,
} from "@/lib/citations";
import { db } from "@/lib/db";
import { cn } from "@/lib/utils";
import { useFocusStore } from "@/store/useFocusStore";

/**
 * Which rules this corpus is arguing about, and where each is argued.
 *
 * The corpus index answers "where else does this *term* appear". It cannot see
 * a citation, because `21 CFR Part 11 section 11.10` is not a term — it is a
 * provision, and the question builders throw provisions away on purpose
 * (`isStructuralReference`), since "Section ____" is a lookup rather than a
 * fact.
 *
 * But the corpus is saturated with them: 376 citations across eleven documents,
 * and Part 11 alone is discussed by nine of them. Four chapters describing the
 * same rule from four angles is exactly the thing that is hard to assemble by
 * reading them one at a time, and it is what the exam asks about.
 *
 * What this deliberately does not do is claim to *resolve* a citation. Of the
 * regulations named here only ICH E6 is in the library at all, so a drawer that
 * opened the referenced text would have nothing to open on most clicks. Every
 * link here goes to a place in a document the reader has, which is the only
 * promise that can be kept.
 */

export function CitationIndex({ onBack }: { onBack: () => void }) {
  const [index, setIndex] = React.useState<RegulationEntry[] | null>(null);
  const [query, setQuery] = React.useState("");
  const [openRegulation, setOpenRegulation] = React.useState<string | null>(null);

  const loadDoc = useFocusStore((s) => s.loadDoc);
  const hydrateSession = useFocusStore((s) => s.hydrateSession);
  const seekToken = useFocusStore((s) => s.seekToken);

  React.useEffect(() => {
    let live = true;
    void db.citationSites().then((sites) => {
      if (live) setIndex(buildCitationIndex(sites));
    });
    return () => {
      live = false;
    };
  }, []);

  const open = async (docId: string, tokenIndex: number) => {
    const doc = await db.getDoc(docId);
    if (!doc) return;
    loadDoc(doc);
    // Hydrate first, then seek — the same order as the corpus index, and for
    // the same reason: hydration restores the stored position and the seek has
    // to be the last word on where this lands.
    await hydrateSession(docId);
    seekToken(tokenIndex);
  };

  const rows = React.useMemo(() => {
    if (!index) return [];
    const q = query.trim().toLowerCase();
    if (!q) return index;
    return index.filter(
      (e) =>
        e.regulation.toLowerCase().includes(q) ||
        e.subtitle?.toLowerCase().includes(q) ||
        e.provisions.some((p) => p.provision?.toLowerCase().includes(q))
    );
  }, [index, query]);

  if (index === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <p className="text-xs text-muted-foreground">Reading the corpus…</p>
      </div>
    );
  }

  const total = index.reduce((n, e) => n + e.total, 0);
  const shared = index.filter((e) => e.documents > 1).length;

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <Button variant="ghost" size="sm" onClick={onBack} className="mb-6 -ml-2">
        <ArrowLeft className="mr-1 h-4 w-4" />
        Back
      </Button>

      <div className="mb-2 flex items-center gap-2">
        <Scale className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-xl font-semibold">Regulations cited</h1>
      </div>
      <p className="mb-6 max-w-prose text-sm text-muted-foreground">
        {total.toLocaleString()} citations, {index.length} regulations,{" "}
        {shared} of them discussed by more than one document. Sorted by how many
        documents cite a rule rather than how often — a rule quoted forty times
        inside its own text says less than one four chapters disagree about.
      </p>

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Part 11, E6, 11.10…"
        className="mb-6"
        spellCheck={false}
      />

      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">Nothing matches that.</p>
      )}

      <ul className="space-y-1">
        {rows.map((entry) => (
          <RegulationRow
            key={entry.regulation}
            entry={entry}
            expanded={openRegulation === entry.regulation}
            onToggle={() =>
              setOpenRegulation((v) =>
                v === entry.regulation ? null : entry.regulation
              )
            }
            onOpen={open}
          />
        ))}
      </ul>

      <p className="mt-8 max-w-prose text-xs leading-relaxed text-muted-foreground">
        A bare &quot;section 5.0&quot; is not counted. It is ambiguous between a
        provision of ICH E6 and the fifth section of the document being read,
        and nothing in the sentence settles it — so it is left out rather than
        guessed at. That is why this list is shorter than the number of
        cross-references in the text.
      </p>
    </div>
  );
}

function RegulationRow({
  entry,
  expanded,
  onToggle,
  onOpen,
}: {
  entry: RegulationEntry;
  expanded: boolean;
  onToggle: () => void;
  onOpen: (docId: string, tokenIndex: number) => void;
}) {
  const provisions = entry.provisions.filter((p) => p.provision);

  return (
    <li className="rounded-md border">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-accent/50"
      >
        <Gavel className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{entry.regulation}</span>
          {entry.subtitle && (
            <span className="block text-xs text-muted-foreground">
              {entry.subtitle}
            </span>
          )}
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {entry.total} {entry.total === 1 ? "citation" : "citations"} in{" "}
            <span
              className={cn(entry.documents > 1 && "font-medium text-foreground")}
            >
              {entry.documents} {entry.documents === 1 ? "document" : "documents"}
            </span>
            {provisions.length > 0 &&
              ` · ${provisions.length} named ${
                provisions.length === 1 ? "provision" : "provisions"
              }`}
          </span>
        </span>
      </button>

      {expanded && (
        <div className="border-t px-3 py-2">
          {entry.provisions.map((p) => (
            <ProvisionRow key={p.provision ?? "—"} entry={p} onOpen={onOpen} />
          ))}
        </div>
      )}
    </li>
  );
}

function ProvisionRow({
  entry,
  onOpen,
}: {
  entry: ProvisionEntry;
  onOpen: (docId: string, tokenIndex: number) => void;
}) {
  const byDocument = React.useMemo(() => {
    const map = new Map<string, { docId: string; docTitle: string; sites: CitationSite[] }>();
    for (const site of entry.sites) {
      const row = map.get(site.docId) ?? {
        docId: site.docId,
        docTitle: site.docTitle,
        sites: [],
      };
      row.sites.push(site);
      map.set(site.docId, row);
    }
    return [...map.values()].sort((a, b) => b.sites.length - a.sites.length);
  }, [entry]);

  return (
    <div className="py-1.5">
      <p className="text-xs font-medium">
        {entry.provision ? `§ ${entry.provision}` : "Named without a provision"}
        <span className="ml-2 font-normal text-muted-foreground">
          {entry.sites.length}× in {entry.documents}{" "}
          {entry.documents === 1 ? "document" : "documents"}
        </span>
      </p>
      {/* Grouped by document, because the flat list repeated the same title
          on eight consecutive rows -- and the question this panel answers is
          "which documents argue about this", so the document is the unit. */}
      <ul className="mt-1 space-y-1">
        {byDocument.slice(0, 6).map((group) => (
          <li key={group.docId}>
            <p className="px-1.5 text-xs text-muted-foreground">
              {group.docTitle}
              {group.sites.length > 1 && (
                <span className="ml-1.5">{group.sites.length}×</span>
              )}
            </p>
            <ul className="flex flex-wrap gap-1 px-1.5 pt-0.5">
              {group.sites.slice(0, 5).map((site, i) => (
                <li key={`${site.tokenIndex}-${i}`}>
                  <button
                    type="button"
                    onClick={() => onOpen(site.docId, site.tokenIndex)}
                    className="rounded border px-1.5 py-0.5 text-[11px] hover:bg-accent"
                    title={site.text}
                  >
                    {site.sectionTitle.slice(0, 42) || "Unsectioned"}
                  </button>
                </li>
              ))}
              {group.sites.length > 5 && (
                <li className="self-center text-[11px] text-muted-foreground">
                  +{group.sites.length - 5}
                </li>
              )}
            </ul>
          </li>
        ))}
        {byDocument.length > 6 && (
          <li className="px-1.5 text-xs text-muted-foreground">
            and {byDocument.length - 6} more documents
          </li>
        )}
      </ul>
    </div>
  );
}

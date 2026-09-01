"use client";

import * as React from "react";
import {
  Check,
  CircleAlert,
  CircleDot,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  SquarePen,
  Table2,
  Target,
  X,
} from "lucide-react";

import { EditableTitle } from "@/components/editable-title";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  buildCoverage,
  nextStop,
  nextToVerify,
  type RungState,
  type SectionCoverage,
} from "@/lib/coverage";
import { contentWordCount, formatDuration } from "@/lib/parse";
import { chapterTitles, searchOutline } from "@/lib/section-search";
import type { Section } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CLOZE_INTERVAL_TOKENS, useFocusStore } from "@/store/useFocusStore";

type Verified = SectionCoverage["state"];

interface RowProps {
  section: Section;
  /** Words across every checkpoint folded into this row. */
  wordCount: number;
  /** How many pacing checkpoints this row stands for. */
  parts: number;
  state: "done" | "current" | "ahead";
  /**
   * The summary rung, from the coverage account rather than from
   * `section.intercept`. The two are not the same claim: the intercept fires on
   * *entering* a section and asks about the one just left, so the section that
   * owes a summary is the one before the one that arms it. A chip driven off
   * `intercept` would label the wrong row, and would put a permanent
   * "intercept" on the last section of every document.
   */
  summary: RungState;
  seconds: number;
  /** Only meaningful for the current row; -1 elsewhere so props stay stable. */
  progress: number;
  /**
   * What has been established about this row, flattened to primitives.
   *
   * Passed a field at a time rather than as the coverage object it came from,
   * because the object is rebuilt on every render and would defeat the memo
   * that keeps a hundred-row map from re-rendering on every boundary event.
   */
  verified: Verified;
  gridsTotal: number;
  gridsPassed: number;
  clozeWindows: number;
  /** Blanks recalled as a share of blanks asked, or -1 where none were. */
  recall: number;
  /**
   * The chapter this row sits under, shown only while the map is filtered.
   *
   * Off the filter it would be noise — the indentation already says it, and it
   * would add a line to all 755 rows. On the filter it is the difference
   * between a usable result and twenty-five identical ones: every chapter of
   * the GCDMP has a "Minimum Standards".
   */
  chapter?: string | null;
  onSeek: (index: number) => void;
}

const VERIFIED_LABEL: Record<Verified, string> = {
  verified: "Everything this section owed has been answered",
  partial: "Partly accounted for — a rung is still owed",
  unchecked: "Read, and never asked about",
  unread: "Not read yet",
};

/**
 * Memoized so that advancing a word only re-renders the row being read. A long
 * PDF produces a hundred-odd sections, and re-rendering all of them on every
 * boundary event is the difference between smooth pacing and a locked tab.
 */
const SectionRow = React.memo(function SectionRow({
  section,
  wordCount,
  parts,
  state,
  summary,
  seconds,
  progress,
  verified,
  gridsTotal,
  gridsPassed,
  clozeWindows,
  recall,
  chapter,
  onSeek,
}: RowProps) {
  return (
    <button
      type="button"
      onClick={() => onSeek(section.i)}
      title={section.furniture ? "Skipped — playback will not wander in" : VERIFIED_LABEL[verified]}
      className={cn(
        "group flex w-full flex-col gap-1 px-3 py-2 text-left transition-colors hover:bg-accent/60",
        section.level >= 2 && "pl-6",
        state === "current" && "bg-accent",
        // Still listed, still clickable — playback simply will not wander in.
        section.furniture && "opacity-55"
      )}
    >
      <div className="flex items-start gap-2">
        {/*
          The marker now reports evidence rather than position. It used to show
          a tick for a submitted summary and a dot otherwise, which meant a
          section that had been read past with nothing asked about it looked
          exactly like one that was merely still ahead.
        */}
        <span className="mt-[3px] shrink-0">
          {state === "current" ? (
            <CircleDot className="h-3 w-3 text-primary" />
          ) : verified === "verified" && !section.furniture ? (
            <Check className="h-3 w-3 text-output" />
          ) : verified === "unchecked" ? (
            <CircleAlert className="h-3 w-3 text-destructive/70" />
          ) : verified === "partial" ? (
            <span className="block h-3 w-3 rounded-full border border-output bg-output/30" />
          ) : (
            <span className="block h-3 w-3 rounded-full border border-border" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          {chapter && (
            <span className="block truncate text-[10px] uppercase tracking-wide text-muted-foreground/70">
              {chapter}
            </span>
          )}
          <span
            className={cn(
              "block text-sm leading-snug",
              section.level <= 1 ? "font-medium" : "font-normal",
              state === "done" && "text-muted-foreground"
            )}
          >
            {section.baseTitle ?? section.title}
          </span>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-5">
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {wordCount.toLocaleString()}w · {formatDuration(seconds)}
        </span>
        {parts > 1 && (
          <span className="text-[10px] text-muted-foreground/70">
            {parts} checkpoints
          </span>
        )}
        {section.furniture && (
          <span className="rounded bg-muted px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            skipped
          </span>
        )}
        {summary !== "n/a" && !section.furniture && (
          <span
            className={cn(
              "rounded px-1 text-[10px] uppercase tracking-wide",
              summary === "done"
                ? "bg-output/15 text-output"
                : "bg-muted text-muted-foreground"
            )}
          >
            {summary === "done" ? "logged" : "intercept"}
          </span>
        )}
        {gridsTotal > 0 && (
          <span
            className={cn(
              "flex items-center gap-0.5 text-[10px] tabular-nums",
              gridsPassed === gridsTotal ? "text-output" : "text-muted-foreground"
            )}
            title={`${gridsPassed} of ${gridsTotal} tables answered`}
          >
            <Table2 className="h-2.5 w-2.5" />
            {gridsPassed}/{gridsTotal}
          </span>
        )}
        {clozeWindows > 0 && (
          <span
            className="flex items-center gap-0.5 text-[10px] tabular-nums text-muted-foreground"
            title={
              recall >= 0
                ? `${clozeWindows} spot ${clozeWindows === 1 ? "check" : "checks"}, ${Math.round(recall * 100)}% recalled`
                : `${clozeWindows} spot checks`
            }
          >
            <SquarePen className="h-2.5 w-2.5" />
            {clozeWindows}
            {recall >= 0 && (
              <span className={cn(recall < 0.5 ? "text-destructive" : "text-output")}>
                {" "}
                {Math.round(recall * 100)}%
              </span>
            )}
          </span>
        )}
      </div>

      {state === "current" && progress >= 0 && (
        <Progress value={progress} className="ml-5 mt-1 h-1 w-[calc(100%-1.25rem)]" />
      )}
    </button>
  );
});

/**
 * Pre-scan structural map, and the coverage account measured against it.
 *
 * The map used to answer one question — how far has the caret got — which is a
 * claim about the audio rather than about the reader. The enforcement ladder
 * was already producing the answer to the harder one, and discarding it. Now
 * every row says what it owed and what has been answered, and the header says
 * where the remaining time should go.
 */
/**
 * Row count from which the filter is worth its 44 pixels.
 *
 * The panel already stacks a title block, a coverage block and a next-to-verify
 * button above the list, and on a twelve-row map a fourth control would push
 * the list itself below the fold to save nothing. Ten of the twelve documents
 * in this corpus are under this; the GCDMP is 755 rows and two chapters are in
 * the sixties.
 */
const SEARCH_FROM_ROWS = 20;

export function StructureSidebar() {
  const [open, setOpen] = React.useState(true);
  const [query, setQuery] = React.useState("");

  const doc = useFocusStore((s) => s.doc);
  const tokenIndex = useFocusStore((s) => s.tokenIndex);
  const summaries = useFocusStore((s) => s.summaries);
  const lastCheckToken = useFocusStore((s) => s.lastCheckToken);
  const gridsPassed = useFocusStore((s) => s.gridsPassed);
  const gridAttempts = useFocusStore((s) => s.gridAttempts);
  const clozeChecks = useFocusStore((s) => s.clozeChecks);
  const seekSection = useFocusStore((s) => s.seekSection);
  const renameDoc = useFocusStore((s) => s.renameDoc);
  const wpm = useFocusStore((s) => s.effectiveWpm());

  /**
   * Rebuilt only when the evidence changes, not on every word.
   *
   * `tokenIndex` is a dependency because a section is not owed anything until
   * it has been read, so it is quantized to the section the caret is in — the
   * account cannot change between two words of the same section, and rebuilding
   * it sixty times a minute over a hundred-odd sections is exactly the cost the
   * row memo exists to avoid.
   */
  const caretSection = doc?.tokens[tokenIndex]?.section ?? 0;
  const coverage = React.useMemo(
    () =>
      doc
        ? buildCoverage(doc, {
            tokenIndex,
            summaries,
            gridsPassed,
            gridAttempts,
            clozeChecks,
          })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, caretSection, summaries, gridsPassed, gridAttempts, clozeChecks]
  );

  /**
   * How far to the next enforced stop, in words rather than in seconds.
   *
   * A live clock would be read instead of the text — the same reason the
   * vigilance pill sits in a corner. This is glanced at on purpose, in a panel
   * the reader opens, and it does not tick.
   */
  const stop = React.useMemo(
    () =>
      doc
        ? nextStop(doc, tokenIndex, lastCheckToken, summaries, CLOZE_INTERVAL_TOKENS)
        : null,
    [doc, tokenIndex, lastCheckToken, summaries]
  );

  // A filter is about one document. Carrying it across would open the next one
  // on an empty map with no visible reason, and the box is only rendered on
  // long documents, so the reader might not even be shown the cause.
  const docId = doc?.id;
  React.useEffect(() => {
    setQuery("");
  }, [docId]);

  if (!doc || !coverage) return null;

  const currentSection = caretSection;
  // Counted over what will actually be read. Billing the reader for a
  // bibliography the engine skips makes every estimate in the map too long —
  // on the EDC implementation chapter, by about a ninth.
  const content = contentWordCount(doc);
  const skipped = doc.wordCount - content;
  const remaining = Math.max(0, content - tokenIndex);

  const next = nextToVerify(coverage);
  const accountable =
    coverage.verified + coverage.partial + coverage.unchecked + coverage.unread;

  /**
   * Pacing checkpoints folded back into the heading they were cut from.
   *
   * The engine needs them as separate sections — that is the whole point of
   * them — but the map does not: a 3,700-word section showed as "4) Minimum
   * Standards" followed by five more rows of the same words, which reads as a
   * document repeating itself. Reported by the reader as exactly that.
   *
   * Coverage folds with them. A checkpoint is not a thing the reader recognises
   * as a section, so reporting five of six checkpoints verified would be
   * reporting on a division the app invented.
   */
  const rows = doc.sections.reduce<
    {
      section: Section;
      wordCount: number;
      tokenEnd: number;
      parts: number;
      lastIndex: number;
      cover: SectionCoverage[];
    }[]
  >((acc, section) => {
    const previous = acc[acc.length - 1];
    const continues =
      previous &&
      section.part !== undefined &&
      section.part > 1 &&
      section.baseTitle !== undefined &&
      section.baseTitle === previous.section.baseTitle;

    if (continues) {
      previous.wordCount += section.wordCount;
      previous.tokenEnd = section.tokenEnd;
      previous.parts += 1;
      previous.lastIndex = section.i;
      previous.cover.push(coverage.sections[section.i]);
      return acc;
    }

    acc.push({
      section,
      wordCount: section.wordCount,
      tokenEnd: section.tokenEnd,
      parts: 1,
      lastIndex: section.i,
      cover: [coverage.sections[section.i]],
    });
    return acc;
  }, []);

  /**
   * The filter, over the rows as they are displayed rather than over
   * `doc.sections`.
   *
   * That distinction is the whole reason this sits here and not in the store: a
   * heading split into six pacing checkpoints is six sections and one row, and
   * filtering the sections would return the same title six times. `rows` has
   * already folded them.
   */
  const outline = rows.map((row) => ({
    title: row.section.baseTitle ?? row.section.title,
    level: row.section.level,
  }));
  const chapters = chapterTitles(outline);
  const hits = searchOutline(outline, query);
  const searchable = rows.length >= SEARCH_FROM_ROWS;
  const shown = hits ?? outline.map((_, i) => i);

  if (!open) {
    return (
      <div className="flex w-12 shrink-0 flex-col items-center border-r bg-muted/20 py-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setOpen(true)}
          aria-label="Show structure map"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-muted/20">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
        <p className="truncate text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Structure
        </p>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={() => setOpen(false)}
          aria-label="Hide structure map"
        >
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>

      <div className="border-b px-3 py-3">
        <EditableTitle
          value={doc.title}
          onCommit={renameDoc}
          label="Rename document"
          className="text-sm font-medium"
          inputClassName="w-full"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          {content.toLocaleString()} words ·{" "}
          {formatDuration((remaining / wpm) * 60)} left
        </p>
        {skipped > 0 && (
          <p className="mt-0.5 text-[11px] text-muted-foreground/70">
            {skipped.toLocaleString()} more in front matter and references,
            skipped
          </p>
        )}

        {/* Both rungs, because reporting only the summary would be true and
            misleading: the cadence check comes round four or five times inside
            the same stretch, and a reader told otherwise would rightly stop
            believing the number. Approximate on purpose — a stretch with
            nothing worth asking about slides the window instead of stopping. */}
        {stop && (stop.toCheck !== null || stop.toSummary !== null) && (
          <p
            className="mt-1.5 text-[11px] text-muted-foreground/80"
            title="A spot check needs something in the passage worth asking about; when there is nothing, the engine slides the window on rather than stopping. Both figures are the earliest a stop can come, not a promise that it will."
          >
            {stop.toCheck !== null && (
              <>
                ≈{stop.toCheck.toLocaleString()}w to a spot check
              </>
            )}
            {stop.toCheck !== null && stop.toSummary !== null && " · "}
            {stop.toSummary !== null ? (
              <>≈{stop.toSummary.toLocaleString()}w to a summary</>
            ) : (
              stop.toCheck !== null && " · no summary left in this document"
            )}
          </p>
        )}
      </div>

      {/*
        Coverage, which is a different claim from the progress bar in the header
        and has to be readable as one. The bar is segmented by words rather than
        by section count: sections here run from forty words to four thousand,
        and "12 of 47 sections" would let a document be four-fifths verified by
        section and a third verified by anything the reader will be examined on.
      */}
      {accountable > 0 && (
        <div className="border-b px-3 py-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Verified
            </p>
            <p className="text-xs tabular-nums">
              <span className="font-medium text-foreground">
                {coverage.totalWords
                  ? Math.round((coverage.verifiedWords / coverage.totalWords) * 100)
                  : 0}
                %
              </span>
              <span className="text-muted-foreground">
                {" "}
                of {coverage.totalWords.toLocaleString()}w
              </span>
            </p>
          </div>

          <CoverageBar coverage={coverage} />

          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            {coverage.verified} verified · {coverage.partial} partly ·{" "}
            <span className={cn(coverage.unchecked > 0 && "text-destructive")}>
              {coverage.unchecked} read but unchecked
            </span>{" "}
            · {coverage.unread} unread
          </p>

          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/80">
            {coverage.summaries.given}/
            {coverage.summaries.given + coverage.summaries.owed} summaries ·{" "}
            {coverage.grids.passed}/{coverage.grids.total} tables ·{" "}
            {coverage.cloze.windows} spot{" "}
            {coverage.cloze.windows === 1 ? "check" : "checks"}
            {coverage.cloze.blanks > 0 && (
              <>
                {" "}
                ({Math.round((coverage.cloze.recalled / coverage.cloze.blanks) * 100)}%
                recalled)
              </>
            )}
          </p>

          {/* The action the whole panel exists for. Read-but-unchecked first,
              then partly done, then unread — cheapest evidence first. */}
          {next && (
            <button
              type="button"
              onClick={() => seekSection(next.section)}
              className="mt-2.5 flex w-full items-start gap-1.5 rounded border border-dashed px-2 py-1.5 text-left transition-colors hover:bg-accent/60"
            >
              <Target className="mt-[2px] h-3 w-3 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-medium leading-tight">
                  {next.title}
                </span>
                <span className="block text-[10px] text-muted-foreground">
                  {next.state === "unchecked"
                    ? `read, never asked about · ${next.words.toLocaleString()}w`
                    : next.state === "partial"
                      ? `still owes a check · ${next.words.toLocaleString()}w`
                      : `not read yet · ${next.words.toLocaleString()}w`}
                </span>
              </span>
            </button>
          )}
        </div>
      )}

      {searchable && (
        <div className="border-b px-3 py-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                // The global transport handler already ignores inputs, so this
                // is only about not letting Escape reach anything else on its
                // way out — in the box, Escape means "clear", not "stop".
                event.stopPropagation();
                setQuery("");
              }}
              placeholder={`Filter ${rows.length} sections`}
              aria-label="Filter sections by name"
              className="h-8 pl-7 pr-7 text-xs"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear the filter"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {hits !== null && hits.length > 0 && (
            <p
              className="mt-1.5 text-[11px] text-muted-foreground"
              title="A heading matches on its own name or on its chapter's, so typing a chapter name brings the whole chapter back rather than one row."
            >
              {hits.length} of {rows.length} sections
            </p>
          )}
        </div>
      )}

      <nav className="fp-scroll flex-1 overflow-y-auto py-2">
        {hits?.length === 0 && (
          <p className="px-3 py-6 text-center text-xs leading-relaxed text-muted-foreground">
            Nothing in this document is called{" "}
            <span className="font-medium text-foreground">{query.trim()}</span>.
            <br />
            The filter matches the words in a heading, not their sense.
          </p>
        )}
        {shown.map((index) => {
          const row = rows[index];
          const isCurrent =
            currentSection >= row.section.i && currentSection <= row.lastIndex;
          // `tokenEnd` is exclusive and the caret cannot exceed the last
          // token, so the final row of a document is done at `tokenEnd - 1`.
          const isDone = tokenIndex + 1 >= row.tokenEnd && row.wordCount > 0;

          const read = Math.min(
            Math.max(0, tokenIndex - row.section.tokenStart),
            row.wordCount
          );

          const folded = foldCoverage(row.cover);

          return (
            <SectionRow
              key={row.section.i}
              section={row.section}
              wordCount={row.wordCount}
              parts={row.parts}
              state={isCurrent ? "current" : isDone ? "done" : "ahead"}
              summary={folded.summary}
              seconds={(row.wordCount / wpm) * 60}
              progress={isCurrent && row.wordCount ? (read / row.wordCount) * 100 : -1}
              verified={folded.state}
              gridsTotal={folded.gridsTotal}
              gridsPassed={folded.gridsPassed}
              clozeWindows={folded.clozeWindows}
              recall={folded.recall}
              chapter={hits ? chapters[index] : null}
              onSeek={seekSection}
            />
          );
        })}
      </nav>

      <div className="border-t px-3 py-2 text-[11px] text-muted-foreground">
        Measured pace: <span className="tabular-nums text-foreground">{wpm}</span> wpm
      </div>
    </aside>
  );
}

/**
 * Several checkpoints of one heading, reported as the heading.
 *
 * The worst state wins, because a row is only as accounted for as its least
 * accounted-for part — reporting a 3,700-word section as verified on the
 * strength of its first checkpoint would be the progress bar's mistake in a new
 * place. Spot-check windows are summed: a window overlapping two checkpoints of
 * the same heading covered that heading once, but it is counted per checkpoint
 * here and the heading genuinely was checked that many times.
 */
function foldCoverage(cover: SectionCoverage[]): {
  state: Verified;
  summary: RungState;
  gridsTotal: number;
  gridsPassed: number;
  clozeWindows: number;
  recall: number;
} {
  const rank: Record<Verified, number> = {
    unchecked: 0,
    unread: 1,
    partial: 2,
    verified: 3,
  };
  const parts = cover.filter(Boolean);
  const state = parts.reduce<Verified>(
    (worst, s) => (rank[s.state] < rank[worst] ? s.state : worst),
    "verified"
  );
  const blanks = parts.reduce((t, s) => t + s.cloze.blanks, 0);
  const recalled = parts.reduce((t, s) => t + s.cloze.recalled, 0);

  // A run of checkpoints owes a summary if any of them does, and is logged only
  // if none is still owed. Only the last checkpoint of a run is ever asked —
  // the ones before it are followed by more of themselves — so in practice this
  // reports that one, folded under the heading it was cut from.
  const summary: RungState = parts.some((s) => s.summary === "owed")
    ? "owed"
    : parts.some((s) => s.summary === "done")
      ? "done"
      : "n/a";

  return {
    state,
    summary,
    gridsTotal: parts.reduce((t, s) => t + s.grids.total, 0),
    gridsPassed: parts.reduce((t, s) => t + s.grids.passed, 0),
    clozeWindows: parts.reduce((t, s) => t + s.cloze.windows, 0),
    recall: blanks > 0 ? recalled / blanks : -1,
  };
}

/** Words by state, as one bar. Segments narrower than a pixel are dropped. */
function CoverageBar({
  coverage,
}: {
  coverage: ReturnType<typeof buildCoverage>;
}) {
  const total = coverage.totalWords || 1;
  const words = (state: Verified) =>
    coverage.sections
      .filter((s) => s.state === state)
      .reduce((t, s) => t + s.words, 0);

  const segments: { state: Verified; className: string; label: string }[] = [
    { state: "verified", className: "bg-output", label: "verified" },
    { state: "partial", className: "bg-output/40", label: "partly verified" },
    { state: "unchecked", className: "bg-destructive/60", label: "read but unchecked" },
    { state: "unread", className: "bg-muted-foreground/20", label: "unread" },
  ];

  return (
    <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
      {segments.map(({ state, className, label }) => {
        const share = (words(state) / total) * 100;
        if (share <= 0) return null;
        return (
          <span
            key={state}
            className={className}
            style={{ width: `${share}%` }}
            title={`${Math.round(share)}% ${label}`}
          />
        );
      })}
    </div>
  );
}

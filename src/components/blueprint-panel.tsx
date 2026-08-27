"use client";

import * as React from "react";
import {
  ArrowLeft,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleSlash,
  Target,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { DOMAINS } from "@/lib/blueprint";
import {
  buildBlueprintCoverage,
  type BlueprintCoverage,
  type ChapterCoverage,
  type ChapterState,
} from "@/lib/blueprint-coverage";
import { db } from "@/lib/db";
import { cn } from "@/lib/utils";

/**
 * The only panel in this app that can tell the reader to go and find something.
 *
 * Everything else here measures the corpus against itself and so can only ever
 * report a reading debt — a section unread, a term unrecalled, all of it
 * payable by pressing play. This one measures the corpus against the published
 * exam blueprint, which means its headline number is the one thing more reading
 * cannot fix: chapters the exam draws on that are not in the library at all.
 *
 * That distinction is the whole design. An absent chapter is deliberately not
 * shown in the same visual language as an unread one, and it is listed first,
 * because confusing "you have not read this" with "you do not have this" wastes
 * exactly the weeks a reader has least of.
 */

const STATE_META: Record<
  ChapterState,
  { label: string; icon: React.ElementType; tone: string; hint: string }
> = {
  absent: {
    label: "Not in your library",
    icon: CircleSlash,
    tone: "text-destructive",
    hint: "No document matches this chapter.",
  },
  unread: {
    label: "Unread",
    icon: CircleDashed,
    tone: "text-muted-foreground",
    hint: "In the library, not started.",
  },
  unchecked: {
    label: "Read, unchecked",
    icon: CircleDot,
    tone: "text-muted-foreground",
    hint: "Heard, but nothing has been proved back.",
  },
  partial: {
    label: "Part verified",
    icon: CircleAlert,
    tone: "text-[hsl(var(--pace-active))]",
    hint: "Some sections verified.",
  },
  verified: {
    label: "Verified",
    icon: CircleCheck,
    tone: "text-output",
    hint: "Every section carried a check that was answered.",
  },
};

export function BlueprintPanel({ onBack }: { onBack: () => void }) {
  const [report, setReport] = React.useState<BlueprintCoverage | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    void db
      .blueprintUnits()
      .then((units) => {
        if (cancelled) return;
        setReport(buildBlueprintCoverage(units));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <Button variant="ghost" size="sm" onClick={onBack} className="mb-6 -ml-2">
        <ArrowLeft className="mr-1 h-4 w-4" />
        Back
      </Button>

      <div className="mb-2 flex items-center gap-2">
        <Target className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-xl font-semibold">Blueprint coverage</h1>
      </div>
      <p className="mb-8 max-w-prose text-sm text-muted-foreground">
        The CCDA exam study guide names six domains, their tasks, and the GCDMP
        chapters each draws on. This is your library measured against that list
        rather than against itself — so it can report something no amount of
        reading will fix.
      </p>

      {loading && <p className="text-sm text-muted-foreground">Reading the library…</p>}

      {report && !loading && (
        <>
          <Missing report={report} />
          <Domains report={report} />
          <Chapters report={report} />
          <IchTopics report={report} />
        </>
      )}
    </div>
  );
}

/** The headline, and the only claim here that is not a reading debt. */
function Missing({ report }: { report: BlueprintCoverage }) {
  if (!report.absent.length) {
    return (
      <section className="mb-10 rounded-lg border border-output/40 bg-output/5 p-4">
        <p className="text-sm">
          <span className="font-medium">Nothing is missing.</span> Every chapter
          the blueprint names is somewhere in your library.
        </p>
      </section>
    );
  }

  return (
    <section className="mb-10 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
      <h2 className="mb-1 text-sm font-medium">
        {report.absent.length}{" "}
        {report.absent.length === 1 ? "chapter is" : "chapters are"} named by the
        exam and not in your library
      </h2>
      <p className="mb-4 text-xs text-muted-foreground">
        These are not reading debts. Pressing play will never clear them.
      </p>

      <ul className="space-y-3">
        {report.absent.map((c) => (
          <li key={c.chapter} className="text-sm">
            <span className="font-medium">{c.chapter}</span>
            {c.standards && (
              // `text-destructive` is unreadable here. In dark mode the token is
              // `0 62.8% 30.6%` — a dark red meant to sit *behind* text, and at
              // 10px on a tinted panel it disappears. The red stays as the tint
              // and the border; the words are foreground.
              <span className="ml-2 rounded border border-destructive/50 bg-destructive/25 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-foreground/90">
                has minimum standards
              </span>
            )}
            <span className="block text-xs text-muted-foreground">
              {c.domains.length
                ? `Named by ${c.domains.length} ${
                    c.domains.length === 1 ? "domain" : "domains"
                  }: ${c.domains
                    .map((id) => DOMAINS.find((d) => d.id === id)?.title ?? id)
                    .join(", ")}.`
                : "Listed in the guide's chapter standards, not against a domain."}
            </span>
            {c.resembling.length > 0 && (
              <span className="mt-1 block text-xs text-muted-foreground">
                You do have{" "}
                {[...new Set(c.resembling.map((r) => r.title))]
                  .map((t) => `“${t}”`)
                  .join(", ")}
                , which covers related ground under a different name. Whether it
                teaches what the exam asks is your call, not the app&apos;s.
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Domains({ report }: { report: BlueprintCoverage }) {
  return (
    <section className="mb-10">
      <h2 className="mb-1 text-sm font-medium">By domain</h2>
      <p className="mb-4 text-xs text-muted-foreground">
        Task counts are the guide&apos;s own. They are not question weights — the
        guide does not publish those, and inventing them would be the one number
        here that is made up.
      </p>
      <div className="space-y-2">
        {report.domains.map((d) => (
          <div key={d.id} className="rounded-lg border px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium">{d.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {d.taskCount} tasks · {d.chapters.length} chapters
              </span>
            </div>
            <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-muted">
              {(["verified", "partial", "unchecked", "unread", "absent"] as ChapterState[]).map(
                (state) => {
                  const n = d.chapters.filter((c) => c.state === state).length;
                  if (!n) return null;
                  return (
                    <span
                      key={state}
                      title={`${n} ${STATE_META[state].label.toLowerCase()}`}
                      className={cn(
                        "h-full",
                        state === "verified" && "bg-output",
                        state === "partial" && "bg-[hsl(var(--pace-active))]",
                        state === "unchecked" && "bg-muted-foreground/50",
                        state === "unread" && "bg-muted-foreground/25",
                        state === "absent" && "bg-destructive"
                      )}
                      style={{ width: `${(n / d.chapters.length) * 100}%` }}
                    />
                  );
                }
              )}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {d.verified} verified
              {d.absent > 0 && (
                <span className="font-medium text-foreground/80">
                  {" "}
                  · {d.absent} missing
                </span>
              )}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Chapters({ report }: { report: BlueprintCoverage }) {
  const order: ChapterState[] = ["absent", "unread", "unchecked", "partial", "verified"];
  const sorted = [...report.chapters].sort(
    (a, b) =>
      order.indexOf(a.state) - order.indexOf(b.state) ||
      a.chapter.localeCompare(b.chapter)
  );

  return (
    <section className="mb-10">
      <h2 className="mb-4 text-sm font-medium">
        Every chapter the blueprint names ({report.totalChapters})
      </h2>
      <ul className="space-y-1">
        {sorted.map((c) => (
          <ChapterRow key={c.chapter} chapter={c} />
        ))}
      </ul>
    </section>
  );
}

function ChapterRow({ chapter }: { chapter: ChapterCoverage }) {
  const meta = STATE_META[chapter.state];
  const Icon = meta.icon;

  return (
    <li className="flex items-start gap-3 rounded-md px-2 py-2 hover:bg-accent/40">
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", meta.tone)} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm">
          {chapter.chapter}
          {chapter.standards && (
            <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
              standards
            </span>
          )}
        </span>
        <span className="block text-xs text-muted-foreground">
          {meta.label}
          {chapter.words > 0 && ` · ${chapter.words.toLocaleString()} words`}
          {chapter.sources.length > 1 && ` across ${chapter.sources.length} sections`}
        </span>
      </span>
    </li>
  );
}

/**
 * The one domain the guide attaches ICH GCP topics to.
 *
 * Listed rather than mapped to guideline sections. The guide's table pairs each
 * topic with a chapter of E6 in a two-column layout that no extraction
 * recovers intact, so the pairing is not transcribed — printing a guessed
 * mapping would be worse than printing none.
 */
function IchTopics({ report }: { report: BlueprintCoverage }) {
  if (!report.ichTopics.length) return null;

  return (
    <section className="mb-10">
      <h2 className="mb-1 text-sm font-medium">
        ICH GCP topics ({report.ichTopics.length})
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        The guide attaches these to the Training domain and says plainly that
        the other five have none. Which E6 chapter each maps to is in a table
        this app does not transcribe, because the layout does not survive
        extraction and a guessed mapping would read exactly like a real one.
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {report.ichTopics.map((t) => (
          <li
            key={t}
            className="rounded border px-2 py-1 text-xs text-muted-foreground"
          >
            {t}
          </li>
        ))}
      </ul>
    </section>
  );
}

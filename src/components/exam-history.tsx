"use client";

import * as React from "react";
import { ArrowLeft, LineChart, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import {
  examPercent,
  repeatMisses,
  trendOf,
  type ExamRecord,
  type RepeatMiss,
} from "@/lib/history";
import { cn } from "@/lib/utils";

/**
 * Every paper sat, and the one thing only a history knows.
 *
 * The marked screen already breaks a single paper down by document and by
 * question type, and that is the right report for the paper you just finished.
 * This is the other report: how the scores are moving, and which terms have
 * survived being learned — missed on one paper, presumably revised, and missed
 * again on the next. Nothing else in the app can see that. The retrieval queue
 * forgives an item the moment it is answered right once, which is correct for
 * scheduling and useless as evidence.
 */

interface ExamHistoryProps {
  onBack: () => void;
}

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function ExamHistory({ onBack }: ExamHistoryProps) {
  const [records, setRecords] = React.useState<ExamRecord[] | null>(null);

  React.useEffect(() => {
    void db.listExams(50).then(setRecords);
  }, []);

  if (records === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const trend = trendOf(records);
  const repeats = repeatMisses(records);

  return (
    <div className="fp-scroll h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-6 py-12">
        <div className="mb-6 flex items-center gap-2.5">
          <LineChart className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold tracking-tight">Exam history</h2>
        </div>

        {records.length === 0 ? (
          <p className="mb-8 text-sm text-muted-foreground">
            No papers sat yet. Every mock exam from here on is kept, so the
            second one has something to be compared against.
          </p>
        ) : (
          <>
            <div className="mb-8 grid grid-cols-3 gap-3">
              <Figure
                label={trend.papers === 1 ? "Paper" : "Papers"}
                value={String(trend.papers)}
              />
              <Figure
                label={trend.papers >= 3 ? "Last three" : "Latest"}
                value={`${
                  trend.papers >= 3
                    ? trend.recentAverage
                    : trend.latest
                      ? examPercent(trend.latest)
                      : 0
                }%`}
                note={
                  trend.delta === null
                    ? undefined
                    : trend.delta === 0
                      ? "level"
                      : `${trend.delta > 0 ? "+" : ""}${trend.delta} on the last`
                }
                noteTone={
                  trend.delta === null || trend.delta === 0
                    ? "flat"
                    : trend.delta > 0
                      ? "up"
                      : "down"
                }
              />
              <Figure label="Best" value={`${trend.best}%`} />
            </div>

            <Sparkline records={records} />

            {repeats.length > 0 && (
              <div className="mt-8">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Missed on more than one paper
                </p>
                <p className="mb-3 text-xs text-muted-foreground">
                  These survived being learned. They are in the review queue like
                  everything else, but the queue stops counting once they come
                  back right — this does not.
                </p>
                <div className="divide-y rounded-md border">
                  {repeats.map((m) => (
                    <RepeatRow key={m.term} miss={m} />
                  ))}
                </div>
              </div>
            )}

            <div className="mt-8">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Papers
              </p>
              <div className="divide-y rounded-md border">
                {records.map((r) => (
                  <div key={r.id} className="flex items-baseline gap-3 px-3 py-2.5">
                    <span className="w-12 shrink-0 text-sm font-medium tabular-nums">
                      {examPercent(r)}%
                    </span>
                    <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                      {r.correct} of {r.total} · {formatClock(r.elapsed)} ·{" "}
                      {r.documents} {r.documents === 1 ? "document" : "documents"}
                      {r.byKind.length > 0 && (
                        <span className="block">
                          {r.byKind
                            .map((k) => `${k.label} ${k.correct}/${k.total}`)
                            .join(" · ")}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {new Date(r.at).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        <Button className="mt-8 gap-2" variant="ghost" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          Back to documents
        </Button>
      </div>
    </div>
  );
}

function Figure({
  label,
  value,
  note,
  noteTone = "flat",
}: {
  label: string;
  value: string;
  note?: string;
  noteTone?: "up" | "down" | "flat";
}) {
  return (
    <div className="rounded-md border px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      {note && (
        <p
          className={cn(
            "text-xs tabular-nums",
            noteTone === "up" && "text-output",
            noteTone === "down" && "text-destructive",
            noteTone === "flat" && "text-muted-foreground"
          )}
        >
          {note}
        </p>
      )}
    </div>
  );
}

function RepeatRow({ miss }: { miss: RepeatMiss }) {
  return (
    <div className="flex items-baseline gap-3 px-3 py-2.5">
      <span className="min-w-0 flex-1 text-sm">
        {miss.label}
        {miss.detail && (
          <span className="block text-xs text-muted-foreground">{miss.detail}</span>
        )}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {miss.papers} papers · {miss.documents.length}{" "}
        {miss.documents.length === 1 ? "document" : "documents"}
      </span>
    </div>
  );
}

/**
 * Scores oldest to newest.
 *
 * Drawn from the same percentages the table shows rather than from a
 * smoothed series: a chart that disagrees with the numbers beside it is worse
 * than no chart. Papers of different lengths are plotted as equals, which is
 * the honest limit of a percentage — noted under it rather than hidden by
 * scaling the dots.
 */
function Sparkline({ records }: { records: ExamRecord[] }) {
  const points = [...records].sort((a, b) => a.at - b.at).map(examPercent);
  if (points.length < 2) return null;

  const w = 560;
  const h = 90;
  const pad = 6;
  const x = (i: number) => pad + (i * (w - pad * 2)) / (points.length - 1);
  const y = (pct: number) => h - pad - (pct / 100) * (h - pad * 2);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)} ${y(p)}`).join(" ");

  return (
    <div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full"
        role="img"
        aria-label={`Scores across ${points.length} papers, oldest first: ${points.join(
          "%, "
        )}%`}
      >
        <line
          x1={pad}
          x2={w - pad}
          y1={y(70)}
          y2={y(70)}
          className="stroke-border"
          strokeDasharray="3 3"
        />
        <path d={path} fill="none" className="stroke-primary" strokeWidth={2} />
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p)} r={3} className="fill-primary" />
        ))}
      </svg>
      <p className="mt-1 text-xs text-muted-foreground">
        Oldest first. The dashed line is 70%. Papers of different lengths are
        plotted as equals — a 20-question set moves 5 points per question.
      </p>
    </div>
  );
}

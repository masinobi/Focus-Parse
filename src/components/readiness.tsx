"use client";

import * as React from "react";
import { CalendarClock, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { db } from "@/lib/db";
import {
  deadlineState,
  describeDeadline,
  isExamDate,
  loadDeadline,
  saveDeadline,
  type ExamDate,
} from "@/lib/deadline";
import { trendOf, type ExamTrend } from "@/lib/history";

/**
 * The exam date, and the four numbers that hang off it.
 *
 * Nothing here is a verdict. The app has no idea what the pass mark is, what a
 * given percentage on a paper it wrote itself predicts, or how much of the
 * corpus this reader needs — so it reports what it measured and stops. Days
 * left, how the last few papers went, what the queue owes, and the one
 * consequence the date actually has: the scheduler will not push anything past
 * it. A tool that announced "on track" from these four numbers would be making
 * it up.
 *
 * The block only appears once a date is set. Before that it is one line asking
 * for one, because an empty dashboard is worse than no dashboard.
 */

interface ReadinessProps {
  /** Retrieval items owed right now, already loaded by the home screen. */
  due: number;
  onReview: () => void;
}

export function Readiness({ due, onReview }: ReadinessProps) {
  const [date, setDate] = React.useState<ExamDate | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [queue, setQueue] = React.useState(0);
  const [trend, setTrend] = React.useState<ExamTrend | null>(null);
  /**
   * Ticks the clock so "in 3 days" does not go stale in a tab left open
   * overnight — which is exactly how someone reads on the run-up to an exam.
   */
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    setDate(loadDeadline());
    void db.countReviews().then(setQueue);
    void db.listExams().then((records) => setTrend(trendOf(records)));
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const commit = () => {
    const next = isExamDate(draft) ? draft : null;
    saveDeadline(next);
    setDate(next);
    setEditing(false);
  };

  const state = deadlineState(date, now);

  if (editing || !state) {
    return (
      <div className="mb-6 flex flex-wrap items-center gap-2 rounded-lg border px-4 py-3">
        <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
        {editing ? (
          <>
            <Input
              type="date"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") setEditing(false);
              }}
              className="h-8 w-40"
            />
            <Button size="sm" onClick={commit}>
              Set
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <span className="text-sm text-muted-foreground">
              No exam date set. With one, the review queue stops scheduling
              anything for after it.
            </span>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              onClick={() => {
                setDraft(date ?? "");
                setEditing(true);
              }}
            >
              Set a date
            </Button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-lg border px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <CalendarClock className="h-4 w-4 shrink-0 self-center text-muted-foreground" />
        <span className="text-sm font-medium">
          {state.passed ? "Exam was" : "Exam"} {describeDeadline(state)}
        </span>
        <span className="text-xs text-muted-foreground">
          {new Date(`${state.date}T00:00:00`).toLocaleDateString(undefined, {
            weekday: "short",
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </span>
        <button
          type="button"
          onClick={() => {
            setDraft(state.date);
            setEditing(true);
          }}
          className="ml-auto text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          Change
        </button>
        <button
          type="button"
          aria-label="Clear the exam date"
          onClick={() => {
            saveDeadline(null);
            setDate(null);
          }}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
        <Line
          label="Last three papers"
          value={
            trend && trend.papers > 0
              ? `${trend.recentAverage}%${
                  trend.papers < 3 ? ` from ${trend.papers}` : ""
                }`
              : "none sat"
          }
        />
        <Line
          label="Review queue"
          value={queue === 0 ? "empty" : `${due} of ${queue} due`}
          onClick={due > 0 ? onReview : undefined}
        />
        <Line
          label="Longest interval"
          value={
            state.horizon === null
              ? state.passed
                ? "uncapped — date has gone"
                : "uncapped today"
              : `${state.horizon} ${state.horizon === 1 ? "day" : "days"}`
          }
        />
      </div>

      {state.horizon !== null && (
        <p className="mt-2 text-xs text-muted-foreground">
          Nothing is scheduled past the exam: an interval is capped at half the
          time remaining, so even a term you have settled comes back several
          more times before then.
        </p>
      )}
    </div>
  );
}

function Line({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-1.5 tabular-nums">{value}</span>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="text-left hover:underline">
      {body}
    </button>
  ) : (
    <p>{body}</p>
  );
}

"use client";

import * as React from "react";
import { ArrowLeft, GraduationCap, Loader2, Timer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { db } from "@/lib/db";
import {
  assembleExam,
  collectQuestions,
  scoreExam,
  DEFAULT_QUESTIONS,
  SECONDS_PER_QUESTION,
  type ExamAnswer,
  type ExamQuestion,
  type ExamResult,
} from "@/lib/exam";
import { recordExam, trendOf, examPercent, type ExamTrend } from "@/lib/history";
import { answerMatches, BLANK } from "@/lib/quiz";
import { acronymId, clozeId, gridId, QUALITY } from "@/lib/review";
import { cn } from "@/lib/utils";

/**
 * The mock exam.
 *
 * Every other check in this app is an interruption whose purpose is to stop a
 * reader coasting through one document. This is the opposite arrangement, and
 * it is the one that answers the question the reader actually has: a timed set
 * drawn across the whole corpus, no feedback until the end, scored with a
 * breakdown that says what to read next.
 *
 * Misses go into the same retrieval queue everything else feeds, so sitting an
 * exam is not a detour from the study loop — it is another way into it.
 *
 * The marked paper is also kept. It used to live only in the `result` state
 * below and die when this component unmounted, which meant the app's single
 * best evidence about whether the reading is working was thrown away every
 * time it was produced. See `history.ts`.
 */

interface ExamSessionProps {
  onDone: () => void;
}

type Phase = "setup" | "building" | "running" | "marked";

const LENGTHS = [20, DEFAULT_QUESTIONS, 60];

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function ExamSession({ onDone }: ExamSessionProps) {
  const [phase, setPhase] = React.useState<Phase>("setup");
  const [length, setLength] = React.useState(DEFAULT_QUESTIONS);
  const [progress, setProgress] = React.useState<string | null>(null);
  const [questions, setQuestions] = React.useState<ExamQuestion[]>([]);
  const [at, setAt] = React.useState(0);
  const [draft, setDraft] = React.useState("");
  const [answers] = React.useState(() => new Map<string, ExamAnswer>());
  const [remaining, setRemaining] = React.useState(0);
  const [result, setResult] = React.useState<ExamResult | null>(null);
  const [docCount, setDocCount] = React.useState(0);
  /**
   * Read inside `finish`, which is memoized on the paper rather than on the
   * document count — a stale closure here would file the paper against the
   * wrong corpus size.
   */
  const docCountRef = React.useRef(0);
  /** Papers sat, refreshed once this one is filed so "up from" has a subject. */
  const [trend, setTrend] = React.useState<ExamTrend | null>(null);
  const startedAt = React.useRef(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    void db.listDocs().then((docs) => {
      setDocCount(docs.length);
      docCountRef.current = docs.length;
    });
    void db.listExams().then((records) => setTrend(trendOf(records)));
  }, []);

  /**
   * Guarded by a ref rather than by reading `phase`: the clock, the last
   * answer and the End button can all arrive at marking, and a stale closure
   * or a second call would score the paper twice. Setting state inside a
   * state updater would do the same under StrictMode's double invocation.
   */
  const phaseRef = React.useRef<Phase>("setup");
  React.useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const finish = React.useCallback(() => {
    if (phaseRef.current !== "running") return;
    phaseRef.current = "marked";
    const elapsed = (Date.now() - startedAt.current) / 1000;
    const marked = scoreExam(questions, answers, elapsed);
    setResult(marked);
    setPhase("marked");

    // Written here rather than on unmount: the reader can close the tab from
    // the marked screen, and a paper that is only persisted on the way out is
    // a paper that is sometimes not persisted at all. The same ref that stops
    // the paper being scored twice stops it being written twice.
    void db
      .saveExam(recordExam(marked, docCountRef.current, Date.now()))
      .then(() => db.listExams())
      .then((records) => setTrend(trendOf(records)));
  }, [questions, answers]);

  // The clock. Stored as a deadline rather than a decrementing counter, so a
  // throttled background tab cannot hand back extra time.
  React.useEffect(() => {
    if (phase !== "running") return;
    const deadline = startedAt.current + questions.length * SECONDS_PER_QUESTION * 1000;
    const tick = () => {
      const left = (deadline - Date.now()) / 1000;
      setRemaining(left);
      if (left <= 0) finish();
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [phase, questions.length, finish]);

  React.useEffect(() => {
    if (phase !== "running") return;
    setDraft("");
    const timer = window.setTimeout(() => inputRef.current?.focus(), 40);
    return () => window.clearTimeout(timer);
  }, [at, phase]);

  const build = async () => {
    setPhase("building");
    // A seed per sitting: the same paper can be rebuilt from it, and two
    // sittings on the same corpus are not the same forty questions.
    const seed = `exam:${Date.now().toString(36)}`;

    const summaries = await db.listDocs();
    const pools = [];
    for (let i = 0; i < summaries.length; i++) {
      setProgress(`Reading ${summaries[i].title} — ${i + 1} of ${summaries.length}`);
      const doc = await db.getDoc(summaries[i].id);
      if (!doc) continue;
      // Collected and then released: holding nine parsed documents at once is
      // hundreds of thousands of tokens, and only the questions are needed.
      pools.push(collectQuestions(doc, seed));
    }

    const paper = assembleExam(pools, length, seed);
    setProgress(null);
    if (!paper.length) {
      setPhase("setup");
      return;
    }
    setQuestions(paper);
    answers.clear();
    setAt(0);
    startedAt.current = Date.now();
    setPhase("running");
  };

  const question = questions[at];

  const record = (given: string) => {
    if (!question) return;
    const correct =
      question.kind === "cloze"
        ? answerMatches(given, question.answer, question.acronym)
        : given === question.answer;

    answers.set(question.id, { questionId: question.id, given, correct });

    // Straight into the retrieval queue, right or wrong, on the same schedule
    // everything else in the app feeds. A term recalled under time pressure has
    // earned its next interval as much as one recalled at a spot check.
    const quality = correct ? QUALITY.good : QUALITY.again;
    if (question.kind === "cloze") {
      void db.recordAnswer(
        {
          id: clozeId(question.docId, question.answer),
          docId: question.docId,
          docTitle: question.docTitle,
          kind: "cloze",
          prompt: question.carrier,
          answer: question.answer,
          acronym: question.acronym,
          section: question.section,
        },
        quality
      );
    } else if (question.kind === "grid") {
      void db.recordAnswer(
        {
          id: gridId(question.docId, question.blockIndex, question.row, question.column),
          docId: question.docId,
          docTitle: question.docTitle,
          kind: "grid",
          prompt: question.prompt,
          answer: question.answer,
          options: question.options,
          context: question.caption ?? undefined,
        },
        quality
      );
    } else {
      void db.recordAnswer(
        {
          id: acronymId(question.acronym),
          docId: question.docId,
          docTitle: question.docTitle,
          kind: "acronym",
          prompt: question.prompt,
          answer: question.answer,
          options: question.options,
          acronym: question.acronym,
        },
        quality
      );
    }

    if (at + 1 >= questions.length) finish();
    else setAt(at + 1);
  };

  /* ---- Setup ---------------------------------------------------------- */

  if (phase === "setup" || phase === "building") {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center gap-2.5">
            <GraduationCap className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold tracking-tight">Mock exam</h2>
          </div>

          <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
            Acronym definitions, terms in context and table cells, drawn across
            every document you have loaded and mixed together. No feedback until
            the end. {SECONDS_PER_QUESTION} seconds a question.
          </p>

          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Length
          </p>
          <div className="mb-6 flex gap-2">
            {LENGTHS.map((n) => (
              <Button
                key={n}
                variant={length === n ? "secondary" : "outline"}
                size="sm"
                disabled={phase === "building"}
                onClick={() => setLength(n)}
              >
                {n} questions
              </Button>
            ))}
          </div>

          {trend && trend.papers > 0 && trend.latest && (
            <p className="mb-6 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              {trend.papers} {trend.papers === 1 ? "paper" : "papers"} sat · last
              one {examPercent(trend.latest)}% on{" "}
              {new Date(trend.latest.at).toLocaleDateString()} · best {trend.best}%
            </p>
          )}

          <p className="mb-6 text-xs text-muted-foreground">
            {docCount === 0
              ? "No documents loaded yet — an exam needs something to draw from."
              : `Drawing from ${docCount} ${docCount === 1 ? "document" : "documents"} · ${formatClock(
                  length * SECONDS_PER_QUESTION
                )} on the clock`}
          </p>

          <div className="flex items-center gap-2">
            <Button disabled={phase === "building" || docCount === 0} onClick={() => void build()}>
              {phase === "building" ? "Preparing…" : "Start"}
            </Button>
            <Button variant="ghost" className="gap-2" onClick={onDone}>
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </div>

          {progress && (
            <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {progress}
            </p>
          )}
        </div>
      </div>
    );
  }

  /* ---- Marked --------------------------------------------------------- */

  if (phase === "marked" && result) {
    const pct = result.total ? Math.round((result.correct / result.total) * 100) : 0;
    const missed = result.questions.filter((q) => !result.answers.get(q.id)?.correct);

    return (
      <div className="fp-scroll h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-6 py-12">
          <div className="mb-6 flex items-center gap-2.5">
            <GraduationCap className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold tracking-tight">
              {result.correct} of {result.total} — {pct}%
            </h2>
          </div>

          <p className="mb-2 text-sm text-muted-foreground">
            {formatClock(result.elapsed)} spent. The {missed.length}{" "}
            {missed.length === 1 ? "miss is" : "misses are"} in the review queue.
          </p>

          {/* The comparison is the reason the paper is kept at all. Shown only
              once there is something to compare against: a first paper has no
              trend, and inventing one from a single point is exactly the kind
              of number that reads as progress and is not. If the write failed
              — a private-mode browser, where every store here is best-effort —
              this stays absent rather than claiming a history that is not
              there. */}
          {trend && trend.papers >= 2 && (
            <p className="mb-8 text-sm text-muted-foreground">
              Paper {trend.papers}.{" "}
              {trend.delta === null ? null : trend.delta === 0 ? (
                <>Level with the one before.</>
              ) : (
                <>
                  <span className={trend.delta > 0 ? "text-output" : "text-destructive"}>
                    {trend.delta > 0 ? "Up" : "Down"} {Math.abs(trend.delta)}
                  </span>{" "}
                  on the one before.
                </>
              )}{" "}
              {trend.papers >= 3 && trend.recentAverage !== null ? (
                <>Last three average {trend.recentAverage}%. </>
              ) : null}
              Best {trend.best}%.
            </p>
          )}
          {(!trend || trend.papers < 2) && <div className="mb-8" />}

          <Breakdown title="By document" rows={result.byDocument} />
          <Breakdown title="By question type" rows={result.byKind} />

          {missed.length > 0 && (
            <div className="mt-8">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                What you missed
              </p>
              <div className="divide-y rounded-md border">
                {missed.map((q) => {
                  const given = result.answers.get(q.id)?.given;
                  return (
                    <div key={q.id} className="px-3 py-2.5">
                      <p className="text-sm">
                        {q.kind === "cloze" ? q.carrier : q.prompt}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        <span className="text-output">{q.answer}</span>
                        {given ? ` — you put “${given}”` : " — left blank"}
                        {" · "}
                        {q.docTitle}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <Button className="mt-8 gap-2" onClick={onDone}>
            <ArrowLeft className="h-4 w-4" />
            Back to documents
          </Button>
        </div>
      </div>
    );
  }

  /* ---- Running -------------------------------------------------------- */

  if (!question) return null;

  const low = remaining < 60;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2.5">
        <GraduationCap className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">Mock exam</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {at + 1} / {questions.length}
        </span>
        <span
          className={cn(
            "ml-auto flex items-center gap-1.5 text-sm tabular-nums",
            low ? "text-destructive" : "text-muted-foreground"
          )}
        >
          <Timer className="h-3.5 w-3.5" />
          {formatClock(remaining)}
        </span>
      </div>
      <Progress value={(at / questions.length) * 100} className="h-[3px] shrink-0 rounded-none" />

      <div className="fp-scroll flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-6 py-12">
          <p className="mb-6 truncate text-xs text-muted-foreground">{question.docTitle}</p>

          {question.kind === "cloze" ? (
            <ClozeAsk
              carrier={question.carrier}
              draft={draft}
              setDraft={setDraft}
              inputRef={inputRef}
              onSubmit={() => record(draft.trim())}
            />
          ) : (
            <div>
              <p className="font-reader text-xl leading-snug">{question.prompt}</p>
              <div className="mt-8 space-y-2">
                {question.options.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => record(option)}
                    className="flex w-full items-center rounded-md border px-4 py-3 text-left transition-colors hover:border-foreground/40 hover:bg-accent/40"
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-8 flex flex-wrap items-center gap-3">
            {question.kind === "cloze" && (
              <Button disabled={!draft.trim()} onClick={() => record(draft.trim())}>
                Answer
              </Button>
            )}
            <Button variant="ghost" onClick={() => record("")}>
              Skip
            </Button>
            <span className="text-xs text-muted-foreground">
              Marked at the end, not now.
            </span>
            <Button variant="ghost" className="ml-auto" onClick={finish}>
              End and mark
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: { label: string; correct: number; total: number }[] }) {
  if (!rows.length) return null;
  return (
    <div className="mt-6">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <div className="space-y-1.5">
        {rows.map((row) => {
          const pct = row.total ? Math.round((row.correct / row.total) * 100) : 0;
          return (
            <div key={row.label} className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-sm">{row.label}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {row.correct}/{row.total}
              </span>
              <span className="w-28 shrink-0">
                <Progress value={pct} className="h-1.5" />
              </span>
              <span
                className={cn(
                  "w-10 shrink-0 text-right text-xs tabular-nums",
                  pct >= 70 ? "text-output" : "text-destructive"
                )}
              >
                {pct}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ClozeAsk({
  carrier,
  draft,
  setDraft,
  inputRef,
  onSubmit,
}: {
  carrier: string;
  draft: string;
  setDraft: (v: string) => void;
  inputRef: React.RefObject<HTMLInputElement>;
  onSubmit: () => void;
}) {
  const at = carrier.indexOf(BLANK);
  const before = at >= 0 ? carrier.slice(0, at) : carrier;
  const after = at >= 0 ? carrier.slice(at + BLANK.length) : "";

  return (
    <p className="font-reader text-lg leading-[1.9] text-foreground/90">
      {before}
      <Input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && draft.trim()) {
            e.preventDefault();
            onSubmit();
          }
        }}
        spellCheck={false}
        aria-label="Missing term"
        className="mx-1 inline-flex h-8 w-48 border-0 border-b-2 border-[hsl(var(--pace-active))] bg-transparent px-1 font-sans text-base"
      />
      {after}
    </p>
  );
}

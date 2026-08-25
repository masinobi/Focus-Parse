"use client";

import * as React from "react";
import { ArrowLeft, Check, History, Loader2, Tags, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { db } from "@/lib/db";
import { assembleDrill, collectAcronyms, type AcronymQuestion } from "@/lib/exam";
import { acronymId, QUALITY, termKey, type WeakTerms } from "@/lib/review";
import { cn } from "@/lib/utils";

/**
 * The acronym drill.
 *
 * The vocabulary the material is written in, and the cheapest thing to be
 * caught out by. The mock exam already asked these, marked them, and filed them
 * in the retrieval queue — but only a handful at a time, mixed into a
 * forty-question paper with a clock on it. There was no way to sit down and go
 * through the vocabulary, which is the one part of this corpus that rewards
 * exactly that.
 *
 * Deliberately not an exam, and the differences are the point:
 *
 *  - **Marked as you go.** An exam withholds feedback because it is predicting
 *    a result. A drill exists to close the loop, and a wrong answer is worth
 *    nothing until the right one lands next to it.
 *  - **No clock.** Recall under time pressure is what the exam measures. This
 *    measures whether the association is there at all.
 *  - **Worst first.** The queue's account of what is not sticking orders the
 *    set, so the drill opens on the terms that need it.
 *
 * Answers feed the same retrieval queue as everything else, under the same
 * `acronym` id keyed by the term rather than the document — so drilling is not
 * a detour from the study loop, it is another way into it.
 */

interface AcronymDrillProps {
  onDone: () => void;
}

type Phase = "building" | "running" | "done";

export function AcronymDrill({ onDone }: AcronymDrillProps) {
  const [phase, setPhase] = React.useState<Phase>("building");
  const [progress, setProgress] = React.useState<string | null>(null);
  const [questions, setQuestions] = React.useState<AcronymQuestion[]>([]);
  const [weak, setWeak] = React.useState<WeakTerms>({});
  const [at, setAt] = React.useState(0);
  const [chosen, setChosen] = React.useState<string | null>(null);
  const [tally, setTally] = React.useState({ right: 0, wrong: 0 });
  /** Terms answered wrong, so the closing screen can say which to come back to. */
  const [missed, setMissed] = React.useState<AcronymQuestion[]>([]);

  React.useEffect(() => {
    let cancelled = false;

    void (async () => {
      // A seed per sitting. The order inside a weakness band is stable, so the
      // same drill can be sat twice; two sittings are not the same order.
      const seed = `drill:${Date.now().toString(36)}`;
      const weakTerms = await db.weakTerms();
      const summaries = await db.listDocs();

      const pools = [];
      for (let i = 0; i < summaries.length; i++) {
        if (cancelled) return;
        setProgress(`Reading ${summaries[i].title} — ${i + 1} of ${summaries.length}`);
        const doc = await db.getDoc(summaries[i].id);
        if (!doc) continue;
        // Only the acronyms, and only the questions: the cloze and grid
        // builders walk every token in the document and nothing here uses
        // what they produce. The parsed document is released either way —
        // holding nine at once is hundreds of thousands of tokens.
        pools.push(collectAcronyms(doc, seed));
      }

      if (cancelled) return;
      const set = assembleDrill(pools, weakTerms, seed);
      setWeak(weakTerms);
      setQuestions(set);
      setProgress(null);
      setPhase(set.length ? "running" : "done");
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const question = questions[at];

  const answer = (option: string) => {
    if (!question || chosen !== null) return;
    setChosen(option);

    const correct = option === question.answer;
    setTally((t) => ({
      right: t.right + (correct ? 1 : 0),
      wrong: t.wrong + (correct ? 0 : 1),
    }));
    if (!correct) setMissed((m) => [...m, question]);

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
      correct ? QUALITY.good : QUALITY.again
    );
  };

  const next = () => {
    setChosen(null);
    if (at + 1 >= questions.length) setPhase("done");
    else setAt(at + 1);
  };

  /* ---- Building ------------------------------------------------------- */

  if (phase === "building") {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center gap-2.5">
            <Tags className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold tracking-tight">Acronym drill</h2>
          </div>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {progress ?? "Collecting the vocabulary your documents use…"}
          </p>
        </div>
      </div>
    );
  }

  /* ---- Done ----------------------------------------------------------- */

  if (phase === "done") {
    const total = tally.right + tally.wrong;
    return (
      <div className="fp-scroll h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-6 py-12">
          <div className="mb-6 flex items-center gap-2.5">
            <Tags className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold tracking-tight">
              {total === 0
                ? "Nothing to drill"
                : `${tally.right} of ${total} — ${Math.round((tally.right / total) * 100)}%`}
            </h2>
          </div>

          <p className="mb-8 text-sm text-muted-foreground">
            {total === 0
              ? "None of the loaded documents use an acronym this app has a definition for. Load a guideline and the drill fills itself."
              : missed.length === 0
                ? "Every one of them. They are all queued to come back on a longer interval."
                : `The ${missed.length} you missed ${missed.length === 1 ? "is" : "are"} in the review queue, due again shortly.`}
          </p>

          {missed.length > 0 && (
            <div className="divide-y rounded-md border">
              {missed.map((q) => (
                <div key={q.acronym} className="px-3 py-2.5">
                  <p className="text-sm">
                    <span className="font-medium">{q.acronym}</span>
                    <span className="text-muted-foreground"> — </span>
                    <span className="text-output">{q.answer}</span>
                  </p>
                </div>
              ))}
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

  const lapses = weak[termKey(question.answer, question.acronym)]?.lapses ?? 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2.5">
        <Tags className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">Acronym drill</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {at + 1} / {questions.length}
        </span>
        <span className="ml-auto flex items-center gap-3 text-xs tabular-nums">
          <span className="flex items-center gap-1 text-output">
            <Check className="h-3.5 w-3.5" />
            {tally.right}
          </span>
          <span
            className={cn(
              "flex items-center gap-1",
              tally.wrong > 0 ? "text-destructive" : "text-muted-foreground"
            )}
          >
            <X className="h-3.5 w-3.5" />
            {tally.wrong}
          </span>
        </span>
      </div>
      <Progress
        value={(at / questions.length) * 100}
        className="h-[3px] shrink-0 rounded-none"
      />

      <div className="fp-scroll flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-6 py-12">
          <p className="mb-6 truncate text-xs text-muted-foreground">{question.docTitle}</p>

          <p className="font-reader text-3xl font-semibold tracking-tight">
            {question.acronym}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">What does it stand for?</p>

          {/* Why this one is near the front. Shown before the answer rather
              than after, unlike the reading spot check: there the reason is a
              distraction from recalling, here it is the reader being told what
              the drill is for. */}
          {lapses > 0 && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
              <History className="h-3 w-3 shrink-0" />
              Lost {lapses === 1 ? "once" : `${lapses} times`} in review.
            </p>
          )}

          <div className="mt-8 space-y-2">
            {question.options.map((option) => {
              const isAnswer = option === question.answer;
              const isChosen = option === chosen;
              const state =
                chosen === null ? null : isAnswer ? "right" : isChosen ? "wrong" : "quiet";

              return (
                <button
                  key={option}
                  type="button"
                  disabled={chosen !== null}
                  onClick={() => answer(option)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md border px-4 py-3 text-left transition-colors",
                    state === null && "hover:border-foreground/40 hover:bg-accent/40",
                    state === "right" && "border-output bg-output/10 text-output",
                    state === "wrong" &&
                      "border-destructive bg-destructive/10 text-destructive",
                    state === "quiet" && "opacity-50"
                  )}
                >
                  {state === "right" && <Check className="h-4 w-4 shrink-0" />}
                  {state === "wrong" && <X className="h-4 w-4 shrink-0" />}
                  <span className="min-w-0 flex-1">{option}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            {chosen !== null && (
              <Button onClick={next} autoFocus>
                {at + 1 >= questions.length ? "Finish" : "Next"}
              </Button>
            )}
            <span className="text-xs text-muted-foreground">
              {chosen === null
                ? "Marked as you go — this is a drill, not a paper."
                : chosen === question.answer
                  ? "Queued to come back on a longer interval."
                  : "Queued to come back shortly."}
            </span>
            <Button variant="ghost" className="ml-auto gap-2" onClick={onDone}>
              <ArrowLeft className="h-4 w-4" />
              Stop here
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

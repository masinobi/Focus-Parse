"use client";

import * as React from "react";
import { Check, RotateCcw, Table2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { db } from "@/lib/db";
import { buildGridQuestion, gridPrompt } from "@/lib/quiz";
import { formatInterval, gridId, QUALITY, type ReviewItem } from "@/lib/review";
import { cn } from "@/lib/utils";
import { MAX_GRID_ATTEMPTS, useFocusStore } from "@/store/useFocusStore";

/**
 * Grid interrogation.
 *
 * The matrix flattener already recovers a table into structured cells and reads
 * them out one at a time. That means the document contains a question with
 * exactly one right answer and no ambiguity about what it is — so this check
 * needs no model, no key and no network. It is the cheapest possible
 * enforcement, and it lands on the content most likely to be examined: RACI
 * matrices, metrics tables, costing grids.
 *
 * A wrong answer replays the grid. The point is not the score; it is that
 * getting past a table requires having actually taken it in.
 */
export function GridCheckDialog() {
  const doc = useFocusStore((s) => s.doc);
  const check = useFocusStore((s) => s.check);
  const attempts = useFocusStore((s) =>
    check.block !== null ? (s.gridAttempts[check.block] ?? 1) : 1
  );
  const passCheck = useFocusStore((s) => s.passCheck);
  const replayGrid = useFocusStore((s) => s.replayGrid);
  const abandonCheck = useFocusStore((s) => s.abandonCheck);

  const [picked, setPicked] = React.useState<string | null>(null);
  const [scheduled, setScheduled] = React.useState<ReviewItem | null>(null);

  const open = check.kind === "grid" && check.block !== null;
  const block = open && check.block !== null ? doc?.blocks[check.block] : undefined;

  // The question is derived, not stored: same block and same attempt always
  // produce the same cell and the same option order.
  const question = React.useMemo(
    () => (block ? buildGridQuestion(block, attempts - 1) : null),
    [block, attempts]
  );

  React.useEffect(() => {
    if (open) {
      setPicked(null);
      setScheduled(null);
    }
  }, [open, check.block, attempts]);

  const answer = React.useCallback(
    (option: string) => {
      if (picked !== null || !question || !doc) return;
      setPicked(option);

      const correct = option === question.answer;
      void db
        .recordAnswer(
          {
            id: gridId(doc.id, question.blockIndex, question.row, question.column),
            docId: doc.id,
            docTitle: doc.title,
            kind: "grid",
            prompt: gridPrompt(question),
            answer: question.answer,
            options: question.options,
            context: question.caption ?? undefined,
          },
          correct ? QUALITY.good : QUALITY.again
        )
        .then(setScheduled);
    },
    [picked, question, doc]
  );

  // Number keys, so the answer costs one keystroke like everything else here.
  React.useEffect(() => {
    if (!open || !question || picked !== null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const index = Number(event.key) - 1;
      if (Number.isNaN(index) || index < 0 || index >= question.options.length) return;
      event.preventDefault();
      answer(question.options[index]);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, question, picked, answer]);

  if (!open || !question) return null;

  const correct = picked === question.answer;
  const exhausted = attempts >= MAX_GRID_ATTEMPTS;

  return (
    <Dialog open>
      <DialogContent
        hideCloseButton
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="flex h-[100dvh] max-h-none w-screen max-w-none flex-col justify-center overflow-y-auto rounded-none border-0 bg-black p-0 sm:rounded-none"
      >
        <div className="mx-auto w-full max-w-2xl px-6 py-10">
          <DialogHeader className="text-left">
            <div className="mb-3 flex items-center gap-2">
              <Table2 className="h-4 w-4 text-[hsl(var(--pace-active))]" />
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Grid check
                {attempts > 1 && ` · attempt ${attempts} of ${MAX_GRID_ATTEMPTS}`}
              </span>
            </div>

            <DialogTitle className="font-reader text-2xl leading-tight">
              {question.column ? (
                <>
                  For <span className="text-[hsl(var(--pace-active))]">{question.row}</span>
                  , what was the {question.column}?
                </>
              ) : (
                <>
                  What value did the grid give for{" "}
                  <span className="text-[hsl(var(--pace-active))]">{question.row}</span>?
                </>
              )}
            </DialogTitle>

            {question.caption && (
              <p className="pt-1 text-sm text-muted-foreground">{question.caption}</p>
            )}
          </DialogHeader>

          <div className="mt-8 space-y-2">
            {question.options.map((option, i) => {
              const isAnswer = option === question.answer;
              const isPicked = option === picked;
              const settled = picked !== null;

              return (
                <button
                  key={option}
                  type="button"
                  disabled={settled}
                  onClick={() => answer(option)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md border px-4 py-3 text-left text-base transition-colors",
                    !settled && "hover:border-foreground/40 hover:bg-accent/40",
                    settled && isAnswer && "border-output bg-output/10",
                    settled && isPicked && !isAnswer && "border-destructive bg-destructive/10",
                    settled && !isAnswer && !isPicked && "opacity-40"
                  )}
                >
                  <kbd className="shrink-0 rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {i + 1}
                  </kbd>
                  <span className="min-w-0 flex-1">{option}</span>
                  {settled && isAnswer && <Check className="h-4 w-4 shrink-0 text-output" />}
                  {settled && isPicked && !isAnswer && (
                    <X className="h-4 w-4 shrink-0 text-destructive" />
                  )}
                </button>
              );
            })}
          </div>

          {picked !== null && (
            <div className="mt-6">
              <p className={cn("text-sm", correct ? "text-output" : "text-destructive")}>
                {correct
                  ? "Correct."
                  : exhausted
                    ? `The grid said “${question.answer}”. Moving on — it stays in the review queue.`
                    : `The grid said “${question.answer}”. Playing it again.`}
              </p>

              {scheduled && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Back in {formatInterval(scheduled)}.
                </p>
              )}

              <div className="mt-5 flex flex-wrap items-center gap-3">
                {correct || exhausted ? (
                  <Button onClick={passCheck} className="gap-2">
                    Resume
                  </Button>
                ) : (
                  <Button onClick={replayGrid} className="gap-2">
                    <RotateCcw className="h-4 w-4" />
                    Replay the grid
                  </Button>
                )}

                <Button variant="ghost" onClick={abandonCheck}>
                  Stop reading here
                </Button>
              </div>
            </div>
          )}

          {picked === null && (
            <p className="mt-6 text-xs text-muted-foreground">
              Answer from what you just heard · press 1–{question.options.length}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

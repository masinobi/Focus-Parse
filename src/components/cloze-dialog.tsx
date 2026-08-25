"use client";

import * as React from "react";
import { Check, History, SquarePen, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { db } from "@/lib/db";
import { answerMatches, BLANK } from "@/lib/quiz";
import { clozeId, QUALITY } from "@/lib/review";
import { cn } from "@/lib/utils";
import { useFocusStore } from "@/store/useFocusStore";

/**
 * The cheap rung of the enforcement ladder.
 *
 * A full intercept costs the better part of a minute, which is why it can only
 * fire at section boundaries — and between two boundaries there is nothing
 * stopping a reader from drifting for six hundred words. This costs about eight
 * seconds: two or three terms drawn from the stretch just heard, put back into
 * the sentence they came from, marked locally against the document.
 *
 * There is no way past it except by filling every blank. Marking happens after
 * that, and a wrong answer does not rewind — the rewind is reserved for grids.
 * What a miss does is put the term into the retrieval queue, where it will be
 * asked again tomorrow whether or not this document is ever opened again.
 */
export function ClozeDialog() {
  const doc = useFocusStore((s) => s.doc);
  const check = useFocusStore((s) => s.check);
  const passCheck = useFocusStore((s) => s.passCheck);
  const abandonCheck = useFocusStore((s) => s.abandonCheck);
  const seekToken = useFocusStore((s) => s.seekToken);
  const refreshWeakTerms = useFocusStore((s) => s.refreshWeakTerms);
  const noteClozeResult = useFocusStore((s) => s.noteClozeResult);

  const [drafts, setDrafts] = React.useState<string[]>([]);
  const [marked, setMarked] = React.useState<boolean[] | null>(null);
  const firstRef = React.useRef<HTMLInputElement>(null);

  const open = check.kind === "cloze" && check.cloze !== null;
  const cloze = check.cloze;

  React.useEffect(() => {
    if (!open || !cloze) return;
    setDrafts(new Array(cloze.blanks.length).fill(""));
    setMarked(null);
    // Focus lands on the first blank so the check is answerable without ever
    // reaching for the mouse, like every other capture in the app.
    const timer = window.setTimeout(() => firstRef.current?.focus(), 40);
    return () => window.clearTimeout(timer);
  }, [open, cloze]);

  const complete = drafts.length > 0 && drafts.every((d) => d.trim().length > 0);

  const submit = () => {
    if (!cloze || !doc || !complete || marked) return;

    const results = cloze.blanks.map((blank, i) =>
      answerMatches(drafts[i], blank.answer, blank.acronym)
    );
    setMarked(results);

    // The stretch this covered, kept. Until now the marking was shown for
    // eight seconds and thrown away, which is why the app could say how far
    // the caret had reached and not which of it anyone had accounted for.
    noteClozeResult({
      from: cloze.from,
      to: cloze.to,
      blanks: cloze.blanks.length,
      recalled: results.filter(Boolean).length,
      at: Date.now(),
    });

    // These answers are exactly what the weighting reads, so the next check
    // must be built from the queue as it stands after them, not before.
    const written: Promise<unknown>[] = [];

    cloze.blanks.forEach((blank, i) => {
      written.push(db.recordAnswer(
        {
          id: clozeId(doc.id, blank.answer),
          docId: doc.id,
          docTitle: doc.title,
          kind: "cloze",
          prompt: blank.carrier,
          answer: blank.answer,
          acronym: blank.acronym,
          section: doc.tokens[blank.tokenIndex]?.section,
        },
        results[i] ? QUALITY.good : QUALITY.again
      ));
    });

    void Promise.all(written).then(refreshWeakTerms);
  };

  if (!open || !cloze) return null;

  const score = marked ? marked.filter(Boolean).length : 0;

  return (
    <Dialog open>
      <DialogContent
        hideCloseButton
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="flex h-[100dvh] max-h-none w-screen max-w-none flex-col justify-center overflow-y-auto rounded-none border-0 p-0 sm:rounded-none"
      >
        <div className="mx-auto w-full max-w-2xl px-6 py-10">
          <DialogHeader className="text-left">
            <div className="mb-3 flex items-center gap-2">
              <SquarePen className="h-4 w-4 text-[hsl(var(--pace-active))]" />
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Spot check
              </span>
            </div>

            <DialogTitle className="text-2xl leading-tight">
              Fill the {cloze.blanks.length === 1 ? "blank" : "blanks"} from what you
              just heard.
            </DialogTitle>
          </DialogHeader>

          <div className="mt-8 space-y-6">
            {cloze.blanks.map((blank, i) => {
              // Split once, not on every occurrence: a carrier that happens to
              // contain the placeholder characters must not lose its tail.
              const at = blank.carrier.indexOf(BLANK);
              const before = at >= 0 ? blank.carrier.slice(0, at) : blank.carrier;
              const after = at >= 0 ? blank.carrier.slice(at + BLANK.length) : "";
              const state = marked ? marked[i] : null;

              return (
                <div key={blank.tokenIndex}>
                  <p className="font-reader text-[1.0625rem] leading-[1.9] text-foreground/90">
                    {before}
                    <input
                      ref={i === 0 ? firstRef : undefined}
                      value={drafts[i] ?? ""}
                      disabled={marked !== null}
                      onChange={(e) => {
                        const next = [...drafts];
                        next[i] = e.target.value;
                        setDrafts(next);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          submit();
                        }
                      }}
                      spellCheck={false}
                      aria-label={`Blank ${i + 1} of ${cloze.blanks.length}`}
                      className={cn(
                        "mx-1 w-40 rounded-[3px] border-b-2 bg-transparent px-1 py-0 font-sans text-base outline-none transition-colors",
                        state === null && "border-[hsl(var(--pace-active))] focus:bg-accent/40",
                        state === true && "border-output text-output",
                        state === false && "border-destructive text-destructive line-through"
                      )}
                    />
                    {after}
                  </p>

                  {state === false && (
                    <p className="mt-1.5 flex items-center gap-2 text-sm">
                      <X className="h-3.5 w-3.5 shrink-0 text-destructive" />
                      <span className="text-muted-foreground">
                        It was <span className="text-foreground">{blank.answer}</span>.
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          // Clear the check first: it resumes at the chunk
                          // playback was interrupted on, and the seek has to be
                          // the last word on position.
                          passCheck();
                          seekToken(blank.tokenIndex);
                        }}
                        className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                      >
                        Go back to it
                      </button>
                    </p>
                  )}

                  {state === true && (
                    <p className="mt-1.5 flex items-center gap-2 text-sm text-output">
                      <Check className="h-3.5 w-3.5 shrink-0" />
                      Correct.
                    </p>
                  )}

                  {/* Why this term and not another. Shown only after marking:
                      before it, knowing a blank was chosen for being hard is
                      noise the reader can do nothing with. */}
                  {state !== null && blank.missed ? (
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <History className="h-3 w-3 shrink-0" />
                      Asked because you have lost it{" "}
                      {blank.missed === 1 ? "once" : `${blank.missed} times`} in review.
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            {marked === null ? (
              <>
                <Button onClick={submit} disabled={!complete}>
                  Mark it
                </Button>
                <span className="text-xs text-muted-foreground">
                  {complete
                    ? "Enter to mark"
                    : `Every blank needs an answer — guess rather than skip`}
                </span>
              </>
            ) : (
              <>
                <Button onClick={passCheck} autoFocus>
                  Resume
                </Button>
                <span className="text-xs text-muted-foreground">
                  {score} of {cloze.blanks.length} recalled
                  {score < cloze.blanks.length && " · the misses are queued for review"}
                </span>
              </>
            )}

            <Button variant="ghost" className="ml-auto" onClick={abandonCheck}>
              Stop reading here
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

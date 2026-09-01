"use client";

import * as React from "react";
import { ArrowLeft, Check, Eye, Layers, LifeBuoy, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { db } from "@/lib/db";
import { answerMatches, BLANK } from "@/lib/quiz";
import {
  formatInterval,
  QUALITY,
  type ReviewItem,
  type ReviewQuality,
} from "@/lib/review";
import { cn } from "@/lib/utils";

/**
 * The warm-up.
 *
 * Sessions used to end and take everything with them. A summary written at an
 * intercept and a term missed at a spot check were both written to IndexedDB
 * and never surfaced again, which meant a reader could work through a guideline
 * exactly as intended and still have nothing left of it a fortnight later.
 * These are the same artefacts, asked again on a widening interval.
 *
 * Auto-graded kinds are marked the way they were the first time — against the
 * document, locally. A summary is the one thing the app cannot mark, because
 * the answer key is the reader's own sentence; that one is shown back and
 * self-rated, which is the honest version of the same loop.
 */

interface ReviewSessionProps {
  onDone: () => void;
}

const SELF_GRADES: { quality: ReviewQuality; label: string; hint: string }[] = [
  { quality: QUALITY.again, label: "Again", hint: "Gone" },
  { quality: QUALITY.hard, label: "Hard", hint: "Dragged it up" },
  { quality: QUALITY.good, label: "Good", hint: "Came back" },
  { quality: QUALITY.easy, label: "Easy", hint: "Instant" },
];

export function ReviewSession({ onDone }: ReviewSessionProps) {
  const [queue, setQueue] = React.useState<ReviewItem[] | null>(null);
  const [at, setAt] = React.useState(0);
  const [draft, setDraft] = React.useState("");
  const [revealed, setRevealed] = React.useState(false);
  const [marked, setMarked] = React.useState<boolean | null>(null);
  const [interval, setIntervalText] = React.useState<string | null>(null);
  const [done, setDone] = React.useState({ recalled: 0, missed: 0 });

  const inputRef = React.useRef<HTMLInputElement>(null);
  const areaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    void db.listDue().then(setQueue);
  }, []);

  const item = queue?.[at];

  React.useEffect(() => {
    setDraft("");
    setRevealed(false);
    setMarked(null);
    setIntervalText(null);
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
      areaRef.current?.focus();
    }, 40);
    return () => window.clearTimeout(timer);
  }, [at]);

  const advance = () => {
    if (!queue) return;
    if (at + 1 >= queue.length) {
      setAt(queue.length);
      return;
    }
    setAt(at + 1);
  };

  /** Auto-graded kinds: cloze and grid both have an answer key in the document. */
  const mark = (correct: boolean) => {
    if (!item || marked !== null) return;
    setMarked(correct);
    setDone((d) => ({
      recalled: d.recalled + (correct ? 1 : 0),
      missed: d.missed + (correct ? 0 : 1),
    }));
    void db
      .recordAnswer(item, correct ? QUALITY.good : QUALITY.again)
      .then((next) => setIntervalText(next ? formatInterval(next) : null));
  };

  const selfGrade = (quality: ReviewQuality) => {
    if (!item) return;
    setDone((d) => ({
      recalled: d.recalled + (quality > QUALITY.again ? 1 : 0),
      missed: d.missed + (quality === QUALITY.again ? 1 : 0),
    }));
    void db.recordAnswer(item, quality).then(() => advance());
  };

  if (queue === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!queue.length || at >= queue.length) {
    const total = done.recalled + done.missed;
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="w-full max-w-md text-center">
          <Layers className="mx-auto h-6 w-6 text-primary" />
          <h2 className="mt-4 text-xl font-semibold tracking-tight">
            {total ? "Queue clear" : "Nothing due"}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {total
              ? `${done.recalled} of ${total} came back. The misses return in ten minutes; the rest are spaced out.`
              : "Everything you have been asked about is still inside its interval."}
          </p>
          <Button className="mt-6 gap-2" onClick={onDone}>
            <ArrowLeft className="h-4 w-4" />
            Back to documents
          </Button>
        </div>
      </div>
    );
  }

  if (!item) return null;

  const progress = (at / queue.length) * 100;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2.5">
        <Layers className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">Warm-up</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {at + 1} / {queue.length}
        </span>
        <span className="ml-auto truncate text-xs text-muted-foreground">
          {item.docTitle}
        </span>
        <Button variant="ghost" size="sm" className="h-7" onClick={onDone}>
          Skip
        </Button>
      </div>
      <Progress value={progress} className="h-[3px] shrink-0 rounded-none" />

      <div className="fp-scroll flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-6 py-12">
          {(item.kind === "cloze" || item.kind === "acronym") && (
            <ClozeReview
              item={item}
              draft={draft}
              setDraft={setDraft}
              marked={marked}
              inputRef={inputRef}
              onMark={() => mark(answerMatches(draft, item.answer, item.acronym))}
            />
          )}

          {item.kind === "grid" && (
            <GridReview item={item} marked={marked} onPick={(o) => mark(o === item.answer)} />
          )}

          {item.kind === "summary" && (
            <SummaryReview
              item={item}
              draft={draft}
              setDraft={setDraft}
              revealed={revealed}
              areaRef={areaRef}
              onReveal={() => setRevealed(true)}
            />
          )}

          {/* Auto-graded outcome. */}
          {marked !== null && (
            <div className="mt-8">
              <p
                className={cn(
                  "flex items-center gap-2 text-sm",
                  marked ? "text-output" : "text-destructive"
                )}
              >
                {marked ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                {marked ? "Correct." : `It was “${item.answer}”.`}
              </p>
              {interval && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Back in {interval}.
                </p>
              )}
              <Button className="mt-5" autoFocus onClick={advance}>
                Next
              </Button>
            </div>
          )}

          {/* Self-graded outcome. */}
          {item.kind === "summary" && revealed && (
            <div className="mt-8">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                How did that come back?
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {SELF_GRADES.map(({ quality, label, hint }) => (
                  <Button
                    key={label}
                    variant="outline"
                    className="h-auto flex-col items-start gap-0.5 px-3 py-2"
                    onClick={() => selfGrade(quality)}
                  >
                    <span className="text-sm">{label}</span>
                    <span className="text-[11px] font-normal text-muted-foreground">
                      {hint}
                    </span>
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ClozeReview({
  item,
  draft,
  setDraft,
  marked,
  inputRef,
  onMark,
}: {
  item: ReviewItem;
  draft: string;
  setDraft: (v: string) => void;
  marked: boolean | null;
  inputRef: React.RefObject<HTMLInputElement>;
  onMark: () => void;
}) {
  // An acronym item's prompt is a question rather than a carrier sentence, so
  // it has no blank to split on and the whole prompt precedes the input.
  const at = item.prompt.indexOf(BLANK);
  const before = at >= 0 ? item.prompt.slice(0, at) : item.prompt;
  const after = at >= 0 ? item.prompt.slice(at + BLANK.length) : "";

  return (
    <div>
      <p className="mb-6 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {item.kind === "acronym" ? "Definition" : "Term"}
      </p>
      <p className="font-reader text-lg leading-[1.9] text-foreground/90">
        {before}
        <Input
          ref={inputRef}
          value={draft}
          disabled={marked !== null}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (draft.trim()) onMark();
            }
          }}
          spellCheck={false}
          aria-label="Missing term"
          className={cn(
            "mx-1 inline-flex h-8 w-48 border-0 border-b-2 bg-transparent px-1 font-sans text-base",
            marked === null && "border-[hsl(var(--pace-active))]",
            marked === true && "border-output text-output",
            marked === false && "border-destructive text-destructive line-through"
          )}
        />
        {after}
      </p>

      {marked === null && (
        <Button className="mt-8" disabled={!draft.trim()} onClick={onMark}>
          Mark it
        </Button>
      )}
    </div>
  );
}

function GridReview({
  item,
  marked,
  onPick,
}: {
  item: ReviewItem;
  marked: boolean | null;
  onPick: (option: string) => void;
}) {
  const [picked, setPicked] = React.useState<string | null>(null);

  React.useEffect(() => {
    setPicked(null);
  }, [item.id]);

  return (
    <div>
      <p className="mb-6 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Grid
      </p>
      <p className="font-reader text-xl leading-snug">{item.prompt}</p>

      <div className="mt-8 space-y-2">
        {(item.options ?? [item.answer]).map((option) => {
          const isAnswer = option === item.answer;
          const isPicked = option === picked;
          const settled = marked !== null;

          return (
            <button
              key={option}
              type="button"
              disabled={settled}
              onClick={() => {
                setPicked(option);
                onPick(option);
              }}
              className={cn(
                "flex w-full items-center gap-3 rounded-md border px-4 py-3 text-left transition-colors",
                !settled && "hover:border-foreground/40 hover:bg-accent/40",
                settled && isAnswer && "border-output bg-output/10",
                settled && isPicked && !isAnswer && "border-destructive bg-destructive/10",
                settled && !isAnswer && !isPicked && "opacity-40"
              )}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SummaryReview({
  item,
  draft,
  setDraft,
  revealed,
  areaRef,
  onReveal,
}: {
  item: ReviewItem;
  draft: string;
  setDraft: (v: string) => void;
  revealed: boolean;
  areaRef: React.RefObject<HTMLTextAreaElement>;
  onReveal: () => void;
}) {
  return (
    <div>
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Section
      </p>
      <h2 className="font-reader text-2xl leading-tight">{item.prompt}</h2>
      {item.context && (
        <p className="mt-1 text-sm text-muted-foreground">{item.context}</p>
      )}

      <Textarea
        ref={areaRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={revealed}
        placeholder="Restate it, before you look…"
        spellCheck={false}
        className="mt-6 min-h-[110px] resize-none text-base leading-relaxed"
      />

      {!revealed ? (
        <Button
          className="mt-4 gap-2"
          variant="outline"
          disabled={!draft.trim()}
          onClick={onReveal}
        >
          <Eye className="h-4 w-4" />
          Compare with what I wrote
        </Button>
      ) : (
        <div className="mt-5 rounded-md border bg-muted/30 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            What you wrote at the intercept
          </p>
          <p className="mt-1.5 text-sm leading-relaxed">{item.answer}</p>

          {/* The self-grade is the only place this sentence is ever judged,
              and it is judged by the reader. They have to know it was written
              with the section's nouns already on screen, or they will grade a
              cued recall as a free one. `undefined` on everything written
              before the anchors existed, which reads as "not cued". */}
          {item.cued && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
              <LifeBuoy className="h-3 w-3 shrink-0" />
              You had the section&rsquo;s terms on screen when you wrote this.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

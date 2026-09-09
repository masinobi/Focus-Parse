"use client";

import * as React from "react";
import { Rewind, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PRE_ROLL_SENTENCES } from "@/lib/reentry";
import { useFocusStore } from "@/store/useFocusStore";

/**
 * What is on screen when someone comes back.
 *
 * The tone is the design. This is the one notice in the app that is not about
 * something the reader failed to do — the vigilance lapse says "nothing here
 * was verified", the intercept says "you cannot pass yet", and both are meant
 * to be felt. This one has no such job. Nothing was recorded while they were
 * gone, nothing is owed, and saying so plainly is most of the point: a reader
 * who believes an absence cost them something will avoid coming back.
 *
 * So it states what happened in the past tense, offers one action, and can be
 * dismissed. There is no count of how long they were away, because that number
 * has no use except to be read as a reproach.
 *
 * Placed opposite the vigilance pill, bottom *left*, so the two can never
 * occupy the same corner — they cannot both be up at once today, since a lapse
 * requires playback and this requires its absence, but a corner is cheap and a
 * collision in a future state would be two notices stacked on one another.
 */
export function ReentryOffer() {
  const away = useFocusStore((s) => s.away);
  const doc = useFocusStore((s) => s.doc);
  const resumeWithPreRoll = useFocusStore((s) => s.resumeWithPreRoll);
  const clearReentry = useFocusStore((s) => s.clearReentry);

  if (!away || !doc) return null;

  return (
    <div className="fixed bottom-6 left-6 z-40 flex max-w-sm animate-node-in items-start gap-3 rounded-lg border bg-background px-4 py-3 shadow-lg">
      <Rewind className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-sm font-medium">Welcome back</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Nothing was marked and nothing was lost. Any check that was open has
          been put away — pick it up again whenever it comes round.
        </p>
        <Button
          size="sm"
          variant="secondary"
          className="mt-2.5 h-7 gap-1.5"
          onClick={resumeWithPreRoll}
        >
          <Rewind className="h-3 w-3" />
          Replay the last {PRE_ROLL_SENTENCES} sentences
        </Button>
      </div>
      <button
        type="button"
        onClick={clearReentry}
        aria-label="Dismiss"
        className="-mr-1 -mt-1 shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

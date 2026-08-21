"use client";

import * as React from "react";
import { Hand, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useFocusStore } from "@/store/useFocusStore";

/**
 * The presence cue, and the consequence when it goes unanswered.
 *
 * Deliberately peripheral while it is waiting. The reader's eyes are on the
 * caret in the middle of the page, and a cue placed there would compete with
 * the word being spoken — which is the one thing this app is built not to do.
 * A corner pill is visible without being looked at, which is what a vigilance
 * cue needs to be: noticed by someone reading, missed by someone who is not.
 *
 * The lapse notice is the opposite. It is meant to be unmissable, because
 * finding your place again in a dense guideline is the cost being attached to
 * having stopped being there.
 */
export function VigilancePill() {
  const phase = useFocusStore((s) => s.vigilance.phase);
  const enabled = useFocusStore((s) => s.vigilance.enabled);
  const notePresence = useFocusStore((s) => s.notePresence);
  const clearLapse = useFocusStore((s) => s.clearLapse);
  const setPlaying = useFocusStore((s) => s.setPlaying);

  if (!enabled || phase === "quiet") return null;

  if (phase === "waiting") {
    return (
      <button
        type="button"
        onClick={notePresence}
        className="fixed bottom-6 right-6 z-40 flex animate-node-in items-center gap-2 rounded-full border border-[hsl(var(--pace-active))] bg-background/95 px-4 py-2 text-sm shadow-lg backdrop-blur"
        style={{ color: "hsl(var(--pace-active))" }}
      >
        <Hand className="h-4 w-4" />
        <span className="font-medium">Still there?</span>
        <kbd className="rounded border border-current px-1.5 py-0.5 font-mono text-[10px]">
          V
        </kbd>
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-40 flex max-w-sm animate-node-in items-start gap-3 rounded-lg border border-destructive bg-background px-4 py-3 shadow-lg">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-destructive">Presence check missed</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Playback stopped. Nothing between here and the last check was verified —
          consider stepping back a section.
        </p>
        <Button
          size="sm"
          className="mt-2.5 h-7"
          onClick={() => {
            clearLapse();
            setPlaying(true);
          }}
        >
          Resume
        </Button>
      </div>
    </div>
  );
}

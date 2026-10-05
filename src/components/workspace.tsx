"use client";

import * as React from "react";

import { ClozeDialog } from "@/components/cloze-dialog";
import { DocumentLoader } from "@/components/document-loader";
import { GridCheckDialog } from "@/components/grid-check-dialog";
import { InterceptDialog } from "@/components/intercept-dialog";
import { ReaderPane } from "@/components/reader/reader-pane";
import { Scratchpad } from "@/components/scratchpad/scratchpad";
import { StructureSidebar } from "@/components/structure-sidebar";
import { TopBar } from "@/components/top-bar";
import { ReentryOffer } from "@/components/reentry-offer";
import { VigilancePill } from "@/components/vigilance-pill";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useBrownNoise } from "@/hooks/useBrownNoise";
import { useKeyboardControls } from "@/hooks/useKeyboardControls";
import { useSpeechEngine } from "@/hooks/useSpeechEngine";
import { useReentry } from "@/hooks/useReentry";
import { useVigilance } from "@/hooks/useVigilance";
import { db } from "@/lib/db";
import { cn } from "@/lib/utils";
import { useFocusStore } from "@/store/useFocusStore";

const SESSION_WRITE_DEBOUNCE_MS = 700;

/** The third field marks the keys a first session shows: the ones for listening. */
const KEY_HINTS: [string, string, boolean][] = [
  ["Space", "play / pause", true],
  ["← →", "sentence", true],
  ["⇧ ← →", "section", false],
  ["↑ ↓", "words per minute", true],
  ["V", "presence check", false],
];

/**
 * Below this the split cannot hold a reading column: at 375px the reader came
 * out 0px wide and set one word per line. One pane at a time instead.
 */
const NARROW = "(max-width: 767px)";

function useNarrow(): boolean {
  return React.useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(NARROW);
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia(NARROW).matches,
    () => false
  );
}

export function Workspace() {
  const doc = useFocusStore((s) => s.doc);
  const tokenIndex = useFocusStore((s) => s.tokenIndex);
  const nodes = useFocusStore((s) => s.nodes);
  const summaries = useFocusStore((s) => s.summaries);
  const gridsPassed = useFocusStore((s) => s.gridsPassed);
  const gridAttempts = useFocusStore((s) => s.gridAttempts);
  const clozeChecks = useFocusStore((s) => s.clozeChecks);
  const hydrated = useFocusStore((s) => s.hydrated);
  const firstSession = useFocusStore((s) => s.firstSession);
  const narrow = useNarrow();
  const [pane, setPane] = React.useState<"read" | "notes">("read");

  const refreshWeakTerms = useFocusStore((s) => s.refreshWeakTerms);
  const hydratePace = useFocusStore((s) => s.hydratePace);

  const { supported, voices, estimating } = useSpeechEngine();
  const noise = useBrownNoise();
  useKeyboardControls();
  useVigilance();
  useReentry();

  // The reading speed the reader asked for, and what each installed voice has
  // been heard to deliver. Read here rather than in the store's initial state:
  // a "use client" store is still evaluated on the server, and a value that
  // comes back from localStorage differs between the two renders.
  React.useEffect(() => {
    hydratePace();
  }, [hydratePace]);

  // What the review queue has learned steers what the next spot check asks
  // about, so it has to be in hand before the first check can fire. Read once
  // per document rather than per check: the queue only changes when an answer
  // is given, and those paths refresh it themselves.
  React.useEffect(() => {
    if (doc) void refreshWeakTerms();
  }, [doc, refreshWeakTerms]);

  // Persist reading position and captures, debounced so word-level advances do
  // not hammer IndexedDB.
  //
  // Gated on `hydrated`: `loadDoc` resets captures to empty and the stored
  // session arrives a tick later, so writing before that could persist the
  // empty state over a real session.
  React.useEffect(() => {
    if (!doc || !hydrated) return;
    const timer = window.setTimeout(() => {
      void db.saveSession({
        docId: doc.id,
        tokenIndex,
        nodes,
        summaries,
        // Without these, reopening a document re-interrogated every grid that
        // had already been answered correctly, and reset the two-attempt cap
        // with it.
        gridsPassed,
        gridAttempts,
        // The third rung's evidence, and the one that covers the most ground.
        // Without it the coverage map can only report the two rungs that fire
        // rarely, which is most of a document unaccounted for.
        clozeChecks,
        updatedAt: Date.now(),
      });
    }, SESSION_WRITE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [doc, hydrated, tokenIndex, nodes, summaries, gridsPassed, gridAttempts, clozeChecks]);

  if (!doc) {
    return (
      <main className="h-[100dvh]">
        <DocumentLoader />
      </main>
    );
  }

  const nodeCount = nodes.filter((n) => !n.parked).length;

  // The structure map, the reader and the key strip: one pane on a phone, the
  // left half of the split everywhere else. The strip is for keyboards, so a
  // touch screen does not get it.
  const reading = (
    <div className="flex h-full flex-col">
      <div className="relative flex min-h-0 flex-1">
        <StructureSidebar />
        <div className="min-w-0 flex-1">
          <ReaderPane />
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-1.5 text-xs text-muted-foreground [@media(pointer:coarse)]:hidden">
        {KEY_HINTS.filter(([, , listening]) => listening || !firstSession).map(([key, label]) => (
          <span key={key} className="flex items-center gap-1.5">
            <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">{key}</kbd>
            {label}
          </span>
        ))}
      </div>
    </div>
  );

  return (
    <main className="flex h-[100dvh] flex-col">
      <TopBar
        voices={voices}
        supported={supported}
        estimating={estimating}
        noise={noise}
      />

      {narrow ? (
        /* Both panes stay mounted, so a half-typed note and the reader's
           scroll survive switching. The switch sits at the bottom, under the
           thumb; the audio carries on through it. */
        <div className="flex min-h-0 flex-1 flex-col">
          <div className={cn("min-h-0 flex-1", pane !== "read" && "hidden")}>{reading}</div>
          <div className={cn("min-h-0 flex-1", pane !== "notes" && "hidden")}>
            <Scratchpad />
          </div>
          <nav aria-label="Panes" className="grid shrink-0 grid-cols-2 border-t bg-background">
            {(
              [
                ["read", "Reading"],
                ["notes", nodeCount ? `Notes (${nodeCount})` : "Notes"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={pane === id}
                onClick={() => setPane(id)}
                className={cn(
                  "h-12 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  pane === id ? "bg-secondary text-foreground" : "text-muted-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <ResizablePanelGroup direction="horizontal" autoSaveId="focusparse:panes">
            {/* Reading */}
            <ResizablePanel defaultSize={55} minSize={35}>
              {reading}
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Notes */}
            <ResizablePanel defaultSize={45} minSize={25}>
              <Scratchpad />
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      )}

      <InterceptDialog />
      <GridCheckDialog />
      <ClozeDialog />
      <VigilancePill />
      <ReentryOffer />
    </main>
  );
}

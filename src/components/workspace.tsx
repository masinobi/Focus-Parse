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
import { VigilancePill } from "@/components/vigilance-pill";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useBrownNoise } from "@/hooks/useBrownNoise";
import { useKeyboardControls } from "@/hooks/useKeyboardControls";
import { useSpeechEngine } from "@/hooks/useSpeechEngine";
import { useVigilance } from "@/hooks/useVigilance";
import { db } from "@/lib/db";
import { useFocusStore } from "@/store/useFocusStore";

const SESSION_WRITE_DEBOUNCE_MS = 700;

const KEY_HINTS: [string, string][] = [
  ["Space", "play / pause"],
  ["← →", "sentence"],
  ["⇧ ← →", "section"],
  ["↑ ↓", "speed"],
  ["V", "presence check"],
];

export function Workspace() {
  const doc = useFocusStore((s) => s.doc);
  const tokenIndex = useFocusStore((s) => s.tokenIndex);
  const nodes = useFocusStore((s) => s.nodes);
  const summaries = useFocusStore((s) => s.summaries);
  const gridsPassed = useFocusStore((s) => s.gridsPassed);
  const gridAttempts = useFocusStore((s) => s.gridAttempts);
  const hydrated = useFocusStore((s) => s.hydrated);

  const refreshWeakTerms = useFocusStore((s) => s.refreshWeakTerms);

  const { supported, voices, estimating } = useSpeechEngine();
  const noise = useBrownNoise();
  useKeyboardControls();
  useVigilance();

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
        updatedAt: Date.now(),
      });
    }, SESSION_WRITE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [doc, hydrated, tokenIndex, nodes, summaries, gridsPassed, gridAttempts]);

  if (!doc) {
    return (
      <main className="h-[100dvh]">
        <DocumentLoader />
      </main>
    );
  }

  return (
    <main className="flex h-[100dvh] flex-col">
      <TopBar
        voices={voices}
        supported={supported}
        estimating={estimating}
        noise={noise}
      />

      <div className="min-h-0 flex-1">
        <ResizablePanelGroup direction="horizontal" autoSaveId="focusparse:panes">
          {/* Ingestion */}
          <ResizablePanel defaultSize={55} minSize={35}>
            <div className="flex h-full flex-col">
              <div className="flex min-h-0 flex-1">
                <StructureSidebar />
                <div className="min-w-0 flex-1">
                  <ReaderPane />
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-1.5 text-[11px] text-muted-foreground">
                {KEY_HINTS.map(([key, label]) => (
                  <span key={key} className="flex items-center gap-1.5">
                    <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                      {key}
                    </kbd>
                    {label}
                  </span>
                ))}
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Kinetic re-encoding */}
          <ResizablePanel defaultSize={45} minSize={25}>
            <Scratchpad />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <InterceptDialog />
      <GridCheckDialog />
      <ClozeDialog />
      <VigilancePill />
    </main>
  );
}

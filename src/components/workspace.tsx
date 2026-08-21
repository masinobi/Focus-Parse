"use client";

import * as React from "react";

import { DocumentLoader } from "@/components/document-loader";
import { InterceptDialog } from "@/components/intercept-dialog";
import { ReaderPane } from "@/components/reader/reader-pane";
import { Scratchpad } from "@/components/scratchpad/scratchpad";
import { StructureSidebar } from "@/components/structure-sidebar";
import { TopBar } from "@/components/top-bar";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useBrownNoise } from "@/hooks/useBrownNoise";
import { useKeyboardControls } from "@/hooks/useKeyboardControls";
import { useSpeechEngine } from "@/hooks/useSpeechEngine";
import { db } from "@/lib/db";
import { useFocusStore } from "@/store/useFocusStore";

const SESSION_WRITE_DEBOUNCE_MS = 700;

const KEY_HINTS: [string, string][] = [
  ["Space", "play / pause"],
  ["← →", "sentence"],
  ["⇧ ← →", "section"],
  ["↑ ↓", "speed"],
];

export function Workspace() {
  const doc = useFocusStore((s) => s.doc);
  const tokenIndex = useFocusStore((s) => s.tokenIndex);
  const nodes = useFocusStore((s) => s.nodes);
  const summaries = useFocusStore((s) => s.summaries);

  const { supported, voices, estimating } = useSpeechEngine();
  const noise = useBrownNoise();
  useKeyboardControls();

  // Persist reading position and captures, debounced so word-level advances do
  // not hammer IndexedDB.
  React.useEffect(() => {
    if (!doc) return;
    const timer = window.setTimeout(() => {
      void db.saveSession({
        docId: doc.id,
        tokenIndex,
        nodes,
        summaries,
        updatedAt: Date.now(),
      });
    }, SESSION_WRITE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [doc, tokenIndex, nodes, summaries]);

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
    </main>
  );
}

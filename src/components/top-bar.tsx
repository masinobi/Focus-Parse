"use client";

import * as React from "react";
import {
  AudioLines,
  ChevronsLeft,
  ChevronsRight,
  Pause,
  Play,
  Rows3,
  ScanLine,
  Type,
  Upload,
  Volume2,
  Waves,
  SquareChevronRight,
  Activity,
  Focus,
  Tags,
} from "lucide-react";

import { EditableTitle } from "@/components/editable-title";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import type { BrownNoiseController } from "@/hooks/useBrownNoise";
import { MAX_RATE, MIN_RATE, RATE_STEP, useFocusStore } from "@/store/useFocusStore";
import type { AnchorSettings } from "@/store/useFocusStore";
import type { ViewMode } from "@/lib/types";
import { cn } from "@/lib/utils";

const VIEWS: { id: ViewMode; label: string; icon: React.ElementType }[] = [
  { id: "standard", label: "Standard", icon: Rows3 },
  { id: "bionic", label: "Bionic", icon: Type },
  { id: "rsvp", label: "RSVP", icon: ScanLine },
];

const ANCHORS: {
  id: keyof AnchorSettings;
  label: string;
  icon: React.ElementType;
}[] = [
  { id: "caret", label: "Block caret", icon: SquareChevronRight },
  { id: "pulse", label: "Syllabic pulse", icon: Activity },
  { id: "spotlight", label: "Clause spotlight", icon: Focus },
  { id: "badges", label: "Acronym badges", icon: Tags },
];

interface TopBarProps {
  voices: SpeechSynthesisVoice[];
  supported: boolean;
  estimating: boolean;
  noise: BrownNoiseController;
}

export function TopBar({ voices, supported, estimating, noise }: TopBarProps) {
  const doc = useFocusStore((s) => s.doc);
  const isPlaying = useFocusStore((s) => s.isPlaying);
  const rate = useFocusStore((s) => s.rate);
  const view = useFocusStore((s) => s.view);
  const tokenIndex = useFocusStore((s) => s.tokenIndex);
  const voiceURI = useFocusStore((s) => s.voiceURI);
  const wpm = useFocusStore((s) => s.effectiveWpm());

  const togglePlaying = useFocusStore((s) => s.togglePlaying);
  const stepSentence = useFocusStore((s) => s.stepSentence);
  const setRate = useFocusStore((s) => s.setRate);
  const setView = useFocusStore((s) => s.setView);
  const setVoice = useFocusStore((s) => s.setVoice);
  const anchors = useFocusStore((s) => s.anchors);
  const toggleAnchor = useFocusStore((s) => s.toggleAnchor);
  const clearDoc = useFocusStore((s) => s.clearDoc);
  const renameDoc = useFocusStore((s) => s.renameDoc);

  if (!doc) return null;

  const progress = doc.wordCount ? ((tokenIndex + 1) / doc.wordCount) * 100 : 0;

  return (
    <header className="shrink-0 border-b bg-background">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <AudioLines className="h-4 w-4 shrink-0 text-primary" />
          <span className="shrink-0 text-sm font-semibold tracking-tight">
            FocusParse
          </span>
          <Separator orientation="vertical" className="h-4" />
          <EditableTitle
            value={doc.title}
            onCommit={renameDoc}
            label="Rename document"
            className="text-sm text-muted-foreground"
            inputClassName="w-56"
          />
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => stepSentence(-1)}
            aria-label="Previous sentence"
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>

          <Button
            size="sm"
            className="h-8 w-[5.5rem] gap-1.5"
            onClick={togglePlaying}
            disabled={!supported}
          >
            {isPlaying ? (
              <>
                <Pause className="h-3.5 w-3.5" /> Pause
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" /> Play
              </>
            )}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => stepSentence(1)}
            aria-label="Next sentence"
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <span className="w-11 shrink-0 text-right text-sm font-medium tabular-nums">
            {rate.toFixed(1)}x
          </span>
          <input
            type="range"
            min={MIN_RATE}
            max={MAX_RATE}
            step={RATE_STEP}
            value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
            className="h-1 w-28 cursor-pointer appearance-none rounded-full bg-secondary accent-primary"
            aria-label="Playback speed"
          />
        </div>

        <div className="flex items-center rounded-md border p-0.5">
          {VIEWS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setView(id)}
              className={cn(
                "flex items-center gap-1.5 rounded-[4px] px-2.5 py-1 text-xs font-medium transition-colors",
                view === id
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center rounded-md border p-0.5">
          {ANCHORS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => toggleAnchor(id)}
              aria-pressed={anchors[id]}
              aria-label={label}
              title={label}
              className={cn(
                "rounded-[4px] p-1.5 transition-colors",
                anchors[id]
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>

        {noise.supported && (
          <div className="flex items-center gap-2">
            <Button
              variant={noise.enabled ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8"
              onClick={noise.toggle}
              aria-pressed={noise.enabled}
              aria-label={
                noise.enabled ? "Turn off masking noise" : "Turn on masking noise"
              }
              title="Brown-noise sensory masking"
            >
              <Waves
                className={cn("h-4 w-4", !noise.enabled && "text-muted-foreground")}
              />
            </Button>

            {noise.enabled && (
              <div className="flex items-center gap-1.5">
                <Volume2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={noise.volume}
                  onChange={(e) => noise.setVolume(Number(e.target.value))}
                  className="h-1 w-20 cursor-pointer appearance-none rounded-full bg-secondary accent-primary"
                  aria-label="Masking noise volume"
                />
              </div>
            )}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {estimating && (
            <Badge variant="outline" className="border-dashed text-[10px] font-normal">
              estimated pacing
            </Badge>
          )}

          <span className="text-xs tabular-nums text-muted-foreground">
            {tokenIndex.toLocaleString()} / {doc.wordCount.toLocaleString()} ·{" "}
            <span className="text-foreground">{wpm}</span> wpm
          </span>

          {voices.length > 0 && (
            <select
              value={voiceURI ?? ""}
              onChange={(e) => setVoice(e.target.value || null)}
              className="h-8 max-w-[11rem] rounded-md border border-input bg-background px-2 text-xs"
              aria-label="Voice"
            >
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name}
                </option>
              ))}
            </select>
          )}

          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={clearDoc}
          >
            <Upload className="h-3.5 w-3.5" />
            New
          </Button>
        </div>
      </div>

      <Progress value={progress} className="h-[3px] rounded-none" />

      {!supported && (
        <p className="bg-destructive/10 px-4 py-1.5 text-xs text-destructive-foreground">
          This browser does not expose the Web Speech API. Reading works, audio pacing
          does not — try Chrome or Edge.
        </p>
      )}
    </header>
  );
}

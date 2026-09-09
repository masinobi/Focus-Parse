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
  Hand,
} from "lucide-react";

import { EditableTitle } from "@/components/editable-title";
import { Badge } from "@/components/ui/badge";
import { VoicePicker } from "@/components/voice-picker";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import type { BrownNoiseController } from "@/hooks/useBrownNoise";
import {
  MAX_RATE,
  MAX_WPM,
  MIN_RATE,
  MIN_WPM,
  WPM_STEP,
  useFocusStore,
} from "@/store/useFocusStore";
import { reachOf, solveRate } from "@/lib/pace";
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
  const targetWpm = useFocusStore((s) => s.targetWpm);
  const pace = useFocusStore((s) => s.pace);
  const view = useFocusStore((s) => s.view);
  const tokenIndex = useFocusStore((s) => s.tokenIndex);
  const voiceURI = useFocusStore((s) => s.voiceURI);
  const wpm = useFocusStore((s) => s.effectiveWpm());

  const togglePlaying = useFocusStore((s) => s.togglePlaying);
  const stepSentence = useFocusStore((s) => s.stepSentence);
  const setTargetWpm = useFocusStore((s) => s.setTargetWpm);
  const setView = useFocusStore((s) => s.setView);
  const setVoice = useFocusStore((s) => s.setVoice);
  const anchors = useFocusStore((s) => s.anchors);
  const toggleAnchor = useFocusStore((s) => s.toggleAnchor);
  const clearDoc = useFocusStore((s) => s.clearDoc);
  const renameDoc = useFocusStore((s) => s.renameDoc);
  const vigilance = useFocusStore((s) => s.vigilance);
  const toggleVigilance = useFocusStore((s) => s.toggleVigilance);

  if (!doc) return null;

  const progress = doc.wordCount ? ((tokenIndex + 1) / doc.wordCount) * 100 : 0;

  // What the current voice will actually do with this target, and what it can
  // do at all. The control asks; this is the app answering, and it is the whole
  // difference between this and the multiplier it replaced.
  const solved = solveRate(pace, voiceURI, targetWpm, MIN_RATE, MAX_RATE);
  const reach = reachOf(pace, voiceURI, MIN_RATE, MAX_RATE);
  const speedTitle = solved.calibrated
    ? `${rate.toFixed(1)}x on this voice` +
      (reach ? ` · measured range ${reach.min}–${reach.max} wpm` : "")
    : `${rate.toFixed(1)}x — this voice has not been measured yet, so this is an estimate`;

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

        {/* The speed control asks for words per minute, and the rate that
            delivers them is solved for the selected voice. A number the voice
            cannot reach is shown struck through beside what it will actually
            do — the one thing this control must never do again is report a
            speed nobody is reading at. */}
        <div className="flex items-center gap-2" title={speedTitle}>
          <span className="flex w-[4.5rem] shrink-0 items-baseline justify-end gap-1 text-sm font-medium tabular-nums">
            {solved.clamped && (
              <span className="text-[11px] font-normal text-muted-foreground line-through">
                {targetWpm}
              </span>
            )}
            <span className={cn(solved.clamped && "text-destructive")}>
              {solved.clamped ? solved.expectedWpm : targetWpm}
            </span>
          </span>
          <input
            type="range"
            min={MIN_WPM}
            max={MAX_WPM}
            step={WPM_STEP}
            value={targetWpm}
            onChange={(e) => setTargetWpm(Number(e.target.value))}
            className="h-1 w-28 cursor-pointer appearance-none rounded-full bg-secondary accent-primary"
            aria-label="Reading speed, words per minute"
          />
          <span className="shrink-0 text-[11px] text-muted-foreground">
            wpm
            {!solved.calibrated && (
              <span className="ml-1 text-muted-foreground/60">est.</span>
            )}
          </span>
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

        {/* Presence check. The count is the point of showing it at all: a
            session with misses in it covered ground nobody was there for. */}
        <Button
          variant={vigilance.enabled ? "secondary" : "ghost"}
          size="sm"
          className="h-8 gap-1.5 px-2"
          onClick={toggleVigilance}
          aria-pressed={vigilance.enabled}
          title={
            vigilance.enabled
              ? "Presence checks on — press V when prompted"
              : "Presence checks off"
          }
        >
          <Hand
            className={cn(
              "h-3.5 w-3.5",
              !vigilance.enabled && "text-muted-foreground",
              vigilance.phase === "waiting" && "text-[hsl(var(--pace-active))]",
              vigilance.phase === "lapsed" && "text-destructive"
            )}
          />
          {vigilance.enabled && (vigilance.answered > 0 || vigilance.missed > 0) && (
            <span className="text-[11px] tabular-nums">
              {vigilance.answered}
              {vigilance.missed > 0 && (
                <span className="text-destructive"> / {vigilance.missed}</span>
              )}
            </span>
          )}
        </Button>

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

          {/* Measured, not asked for. The control on the left is the target;
              this is what the reading is actually coming out at, and the two
              being different is information rather than a defect. */}
          <span
            className="text-xs tabular-nums text-muted-foreground"
            title="Measured pace, from the synthesizer's own word boundaries"
          >
            {tokenIndex.toLocaleString()} / {doc.wordCount.toLocaleString()} ·{" "}
            <span className="text-foreground">{wpm}</span> wpm read
          </span>

          <VoicePicker
            voices={voices}
            voiceURI={voiceURI}
            onSelect={(uri) => setVoice(uri || null)}
          />

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

"use client";

import * as React from "react";
import { Check, Cloud, HardDrive, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { filterVoices, shortVoiceName } from "@/lib/voices";
import { cn } from "@/lib/utils";

/**
 * Choosing a voice out of the hundred-odd a browser installs.
 *
 * This was a bare `<select>`, which is the right control for five options and
 * the wrong one for a hundred and forty: the list is unsearchable, the names
 * all begin "Microsoft", and finding a particular voice means scrolling past
 * every language the machine has ever had a pack for.
 *
 * A dialog rather than a popover because the app has no popover primitive and
 * a dialog brings focus handling, Escape and click-away already correct. The
 * top bar is cramped enough that a panel hanging off it would cover the reading
 * pane anyway.
 *
 * Two things are shown per row that the old control could not show at all: the
 * language tag, and whether the voice needs the network. The second used to be
 * invisible and is exactly what separates a voice that works from one that does
 * not when the connection is poor — see `speech-timing.ts`.
 */

interface VoicePickerProps {
  voices: SpeechSynthesisVoice[];
  voiceURI: string | null;
  onSelect: (voiceURI: string) => void;
}

export function VoicePicker({ voices, voiceURI, onSelect }: VoicePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const current = voices.find((v) => v.voiceURI === voiceURI) ?? voices[0];
  const shown = React.useMemo(() => filterVoices(voices, query), [voices, query]);

  // A stale filter is confusing on the way back in: the reader reopens the
  // picker to change their mind and half the list is missing for a reason that
  // scrolled off the screen a day ago.
  React.useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  if (!voices.length) return null;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-8 max-w-[11rem] justify-start gap-1.5 px-2 text-xs font-normal"
        onClick={() => setOpen(true)}
        title={current ? current.name : "Choose a voice"}
        aria-label={`Voice: ${current ? current.name : "none"}. Click to change.`}
      >
        {current && !current.localService ? (
          <Cloud className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <HardDrive className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate">
          {current ? shortVoiceName(current.name) : "Voice"}
        </span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Voice</DialogTitle>
            <DialogDescription>
              {voices.length} installed. A cloud voice is synthesized over the
              network and takes longer to start each sentence.
            </DialogDescription>
          </DialogHeader>

          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Escape" || !query) return;
                // In the box, Escape means "clear"; only an empty box lets it
                // through to close the dialog.
                event.stopPropagation();
                event.preventDefault();
                setQuery("");
              }}
              placeholder="Name, language, or “local” / “cloud”"
              aria-label="Filter voices"
              className="h-9 pl-7 pr-7 text-sm"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear the voice filter"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground" data-voice-count>
            {query ? `${shown.length} of ${voices.length}` : `${voices.length} voices`}
          </p>

          <div className="fp-scroll max-h-[45vh] overflow-y-auto rounded-md border">
            {shown.length === 0 && (
              <p className="px-3 py-8 text-center text-xs leading-relaxed text-muted-foreground">
                No installed voice matches{" "}
                <span className="font-medium text-foreground">{query.trim()}</span>.
                <br />
                The filter matches a voice&rsquo;s name and language, not its sound.
              </p>
            )}
            {shown.map((voice) => {
              const selected = voice.voiceURI === voiceURI;
              return (
                <button
                  key={voice.voiceURI}
                  type="button"
                  data-voice-row={voice.voiceURI}
                  data-voice-selected={selected ? "true" : "false"}
                  onClick={() => {
                    onSelect(voice.voiceURI);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 border-b px-3 py-2 text-left last:border-b-0 transition-colors hover:bg-accent",
                    selected && "bg-accent"
                  )}
                >
                  <span className="w-3.5 shrink-0">
                    {selected && <Check className="h-3.5 w-3.5 text-output" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {shortVoiceName(voice.name)}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {voice.name}
                    </span>
                  </span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {voice.lang}
                  </span>
                  <span
                    className="shrink-0 text-muted-foreground"
                    title={
                      voice.localService
                        ? "Runs on this machine"
                        : "Synthesized over the network"
                    }
                  >
                    {voice.localService ? (
                      <HardDrive className="h-3 w-3" />
                    ) : (
                      <Cloud className="h-3 w-3" />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

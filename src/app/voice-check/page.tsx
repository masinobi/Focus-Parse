"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { CANCEL_SETTLE_MS, ESTIMATOR_GRACE_MS } from "@/hooks/useSpeechEngine";
import { parseDocument } from "@/lib/parse";
import {
  formatReport,
  probeVoice,
  type VoiceReport,
  type Verdict,
} from "@/lib/voice-probe";
import { cn } from "@/lib/utils";

/**
 * Voice probe.
 *
 * Which voices keep word-exact sync is a question about the *voice*, not the
 * app, and it cannot be answered by listening — a voice that fires no boundary
 * events sounds identical to one that does. Installing better-sounding voices
 * is only worth doing if they survive this page.
 *
 * The probe speaks chunks produced by the real parser and resolves every
 * boundary through the same `tokenAtCharIndex` the engine uses, so a voice that
 * passes here passes in the reader.
 */

/*
 * Deliberately includes acronyms. Expansion is what makes the displayed string
 * and the spoken string diverge, and boundary events report offsets into the
 * spoken one — so a voice that looks fine on plain prose can still put the
 * caret in the wrong place on the documents this app exists to read.
 */
const PROBE_DOCUMENT = `# Voice probe

The sponsor retains oversight of the trial even when the work is contracted out
to a vendor, and that responsibility cannot be delegated away.

Oversight of the EDC build, the CRF specification and the resulting SDTM
datasets remains with the sponsor under ICH GCP, whoever performs the work.

Query resolution turnaround is measured in days, and a study that lets it drift
past thirty accumulates a backlog it will not clear before database lock.
`;

/**
 * Longer than the 180-character cap the parser enforces, so it exercises the
 * truncation behaviour that cap exists to avoid.
 */
const LONG_UTTERANCE =
  "This sentence is deliberately longer than the one hundred and eighty character cap that the parser enforces on every chunk, because some speech backends silently stop speaking part way through a long string rather than reporting an error, and the only way to find out whether this particular voice does that is to hand it one and listen for whether it reaches the final words of the sentence.";

const VERDICT_STYLE: Record<Verdict, { label: string; className: string }> = {
  "word-exact": { label: "Word-exact", className: "text-output border-output" },
  partial: {
    label: "Partial",
    className: "text-[hsl(var(--pace-active))] border-[hsl(var(--pace-active))]",
  },
  "estimator-only": {
    label: "Estimator only",
    className: "text-muted-foreground border-muted-foreground",
  },
  failed: { label: "Failed", className: "text-destructive border-destructive" },
};

export default function VoiceCheckPage() {
  const [voices, setVoices] = React.useState<SpeechSynthesisVoice[]>([]);
  const [englishOnly, setEnglishOnly] = React.useState(true);
  const [running, setRunning] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [reports, setReports] = React.useState<VoiceReport[]>([]);
  const [copied, setCopied] = React.useState(false);
  const stopRef = React.useRef(false);

  /**
   * Null until mounted. Reading `window` during render makes the server emit
   * the unsupported branch and the client emit the controls, which is a
   * hydration mismatch — so support is discovered in an effect and both sides
   * render the same placeholder first.
   */
  const [supported, setSupported] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    const ok = "speechSynthesis" in window;
    setSupported(ok);
    if (!ok) return;

    const load = () => {
      const list = window.speechSynthesis.getVoices();
      if (list.length) setVoices(list);
    };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  const selected = React.useMemo(
    () => (englishOnly ? voices.filter((v) => v.lang.startsWith("en")) : voices),
    [voices, englishOnly]
  );

  const doc = React.useMemo(() => parseDocument(PROBE_DOCUMENT, "probe"), []);

  /** Prose chunks only: a heading is one or two words and measures nothing. */
  const chunkIndices = React.useMemo(
    () =>
      doc.chunks
        .filter((c) => c.tokenEnd - c.tokenStart >= 8)
        .slice(0, 3)
        .map((c) => c.i),
    [doc]
  );

  const run = async () => {
    if (!supported || running) return;
    stopRef.current = false;
    setRunning(true);
    setReports([]);
    setCopied(false);

    const synth = window.speechSynthesis;
    const collected: VoiceReport[] = [];

    for (const voice of selected) {
      if (stopRef.current) break;
      const report = await probeVoice(synth, voice, doc, chunkIndices, LONG_UTTERANCE, {
        graceMs: ESTIMATOR_GRACE_MS,
        settleMs: CANCEL_SETTLE_MS,
        rate: 1.4,
        onProgress: setStatus,
        shouldStop: () => stopRef.current,
      });
      collected.push(report);
      setReports([...collected]);
    }

    synth.cancel();
    setStatus(null);
    setRunning(false);
  };

  const stop = () => {
    stopRef.current = true;
    if (supported) window.speechSynthesis.cancel();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(formatReport(reports));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const best = reports.filter((r) => r.verdict === "word-exact");

  return (
    <main className="h-[100dvh] overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Voice probe</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Word-exact pacing depends on the voice firing <code>boundary</code> events
          at offsets that line up with word starts. A voice that fires none falls
          back to the estimator; one that fires them at the wrong offsets moves the
          caret confidently to the wrong word. Neither is audible — so measure.
        </p>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          This speaks aloud, one voice at a time. Turn the volume down; it takes
          roughly fifteen seconds per voice.
        </p>

        {supported === null ? (
          <p className="mt-6 text-sm text-muted-foreground">Checking for speech support&hellip;</p>
        ) : !supported ? (
          <p className="mt-6 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            This browser exposes no speech synthesis, so there is nothing to measure.
          </p>
        ) : (
          <>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button onClick={running ? stop : () => void run()} className="gap-2">
                {running ? "Stop" : `Probe ${selected.length} voices`}
              </Button>

              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={englishOnly}
                  disabled={running}
                  onChange={(e) => setEnglishOnly(e.target.checked)}
                  className="accent-primary"
                />
                English voices only
              </label>

              {reports.length > 0 && !running && (
                <Button variant="outline" onClick={() => void copy()}>
                  {copied ? "Copied" : "Copy report"}
                </Button>
              )}

              {status && (
                <span className="text-xs tabular-nums text-muted-foreground">{status}</span>
              )}
            </div>

            {voices.length === 0 && (
              <p className="mt-4 text-sm text-muted-foreground">
                Waiting for the voice list… Chrome populates it asynchronously.
              </p>
            )}

            {reports.length > 0 && !running && (
              <p className="mt-6 text-sm">
                {best.length > 0 ? (
                  <>
                    <span className="text-output">
                      {best.length} of {reports.length} keep word-exact sync.
                    </span>{" "}
                    Pick one of those in the reader.
                  </>
                ) : (
                  <span className="text-[hsl(var(--pace-active))]">
                    None of these voices keep word-exact sync. Pacing will be
                    interpolated whichever you choose.
                  </span>
                )}
              </p>
            )}

            <div className="mt-6 space-y-3 pb-16">
              {reports.map((report) => {
                const style = VERDICT_STYLE[report.verdict];
                return (
                  <div key={report.voiceURI} className="rounded-md border p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{report.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {report.lang} · {report.localService ? "local" : "network"}
                      </span>
                      <span
                        className={cn(
                          "ml-auto rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                          style.className
                        )}
                      >
                        {style.label}
                      </span>
                    </div>

                    <p className="mt-1.5 text-sm text-muted-foreground">{report.note}</p>

                    <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-5">
                      <Stat label="Coverage" value={`${Math.round(report.coverage * 100)}%`} />
                      <Stat label="Precision" value={`${Math.round(report.precision * 100)}%`} />
                      <Stat
                        label="First event"
                        value={report.firstBoundaryMs === null ? "—" : `${report.firstBoundaryMs}ms`}
                      />
                      <Stat
                        label="Rate 1x/2x"
                        value={report.rateRatio === null ? "—" : `${report.rateRatio}x`}
                      />
                      <Stat
                        label="Long text"
                        value={
                          report.longUtteranceOk === null
                            ? "—"
                            : report.longUtteranceOk
                              ? "ok"
                              : "cut"
                        }
                      />
                    </dl>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

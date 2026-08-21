import { tokenAtCharIndex } from "./parse";
import type { ParsedDoc } from "./types";

/**
 * Voice measurement.
 *
 * Word-exact pacing is not a property of the app, it is a property of the
 * *voice*. The engine maps each `boundary` event's `charIndex` back to a token
 * by binary search; a voice that never fires one falls back to the interpolating
 * estimator, and a voice that fires them at offsets which do not line up with
 * token starts is worse than that — it moves the caret confidently to the wrong
 * word.
 *
 * Neither failure is visible by listening. Both are trivial to measure, and the
 * answer decides whether a better-sounding voice is actually usable here.
 *
 * This module drives the same `tokenAtCharIndex` the engine uses, over a
 * document built by the same parser, so the report and the app cannot drift.
 */

export type Verdict = "word-exact" | "partial" | "estimator-only" | "failed";

export interface ChunkProbe {
  chunkIndex: number;
  /** Words in the chunk, from the parser. */
  tokens: number;
  /** `boundary` events seen with a usable word offset. */
  boundaries: number;
  /** Distinct tokens the caret would have landed on. */
  tokensHit: number;
  /**
   * Boundaries whose charIndex lands on a word start in the *spoken* string.
   *
   * This is the number that separates real sync from confident nonsense. An
   * engine reporting byte offsets, or offsets into the displayed string rather
   * than the spoken one, still resolves to *a* token through the binary search
   * — just the wrong one — and the caret moves smoothly to the wrong word.
   *
   * Deliberately measured against word starts rather than token starts. An
   * expanded acronym is one token spoken as several words, so "EDC" produces
   * boundaries at "electronic", "data" and "capture"; only the first is a token
   * start, and counting the other two as errors would penalise exactly the
   * behaviour the design intends — the caret holding on "EDC" for the whole
   * expansion.
   */
  alignedBoundaries: number;
  /** Of those, how many were also a token start. Informational. */
  onTokenStart: number;
  /** Boundaries that resolved to a token at or before the previous one. */
  nonMonotonic: number;
  /** ms from `speak()` to the first usable boundary. */
  firstBoundaryMs: number | null;
  /** ms from `speak()` to `end`. */
  durationMs: number | null;
  ended: boolean;
  error: string | null;
}

export interface VoiceReport {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
  verdict: Verdict;
  /** Why the verdict came out that way, in one line. */
  note: string;
  chunks: ChunkProbe[];
  /** Fraction of a chunk's words the caret would actually visit, averaged. */
  coverage: number;
  /** Fraction of boundaries landing on a word start in the spoken string. */
  precision: number;
  firstBoundaryMs: number | null;
  /** Duration at 1.0x divided by duration at 2.0x. ~2 means rate is honored. */
  rateRatio: number | null;
  /** A long utterance still reached its final words. */
  longUtteranceOk: boolean | null;
}

/**
 * Coverage below this means the caret skips words in visible runs, which reads
 * as the highlight lagging and then catching up.
 */
const MIN_COVERAGE = 0.8;

/** Below this, offsets are not addressing the string the engine thinks it is. */
const MIN_PRECISION = 0.9;

/**
 * Above this, a slow first boundary is a usability problem rather than a
 * footnote. Network voices synthesize per utterance, and the engine utters one
 * sentence at a time, so the latency lands on every sentence in the document.
 */
const SLOW_START_MS = 1_000;

/** Per-utterance ceiling. A voice that has not finished by now has hung. */
const UTTERANCE_TIMEOUT_MS = 25_000;

export interface ProbeOptions {
  /** Grace period before the estimator takes over, from the engine. */
  graceMs: number;
  /** Settle delay after `cancel()`, from the engine. */
  settleMs: number;
  rate: number;
  onProgress?: (message: string) => void;
  /** Set by the caller to abandon a run in flight. */
  shouldStop?: () => boolean;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Speak one string with one voice and record what came back.
 *
 * Deliberately mirrors the engine: the utterance is the chunk's *speech*
 * string, and offsets are interpreted against `speechOffset`, because that is
 * the coordinate space boundary events report in once an acronym has expanded.
 */
function speakAndRecord(
  synth: SpeechSynthesis,
  voice: SpeechSynthesisVoice,
  text: string,
  rate: number,
  onBoundary: (charIndex: number, elapsed: number) => void
): Promise<{ durationMs: number | null; ended: boolean; error: string | null }> {
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = rate;
    utterance.pitch = 1;
    utterance.volume = 1;

    const started = performance.now();
    let settled = false;

    const finish = (ended: boolean, error: string | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve({ durationMs: ended ? performance.now() - started : null, ended, error });
    };

    const timer = window.setTimeout(() => {
      synth.cancel();
      finish(false, "timed out");
    }, UTTERANCE_TIMEOUT_MS);

    utterance.onboundary = (event) => {
      // Some engines also emit "sentence"; only words carry usable offsets.
      if (event.name && event.name !== "word") return;
      onBoundary(event.charIndex ?? 0, performance.now() - started);
    };
    utterance.onend = () => finish(true, null);
    utterance.onerror = (event) => {
      const reason = (event as SpeechSynthesisErrorEvent).error;
      finish(false, reason || "error");
    };

    synth.speak(utterance);
  });
}

/** Measure one voice against a parsed document's first few chunks. */
export async function probeVoice(
  synth: SpeechSynthesis,
  voice: SpeechSynthesisVoice,
  doc: ParsedDoc,
  chunkIndices: number[],
  longText: string,
  options: ProbeOptions
): Promise<VoiceReport> {
  const chunks: ChunkProbe[] = [];

  for (const chunkIndex of chunkIndices) {
    if (options.shouldStop?.()) break;
    const chunk = doc.chunks[chunkIndex];
    if (!chunk) continue;

    options.onProgress?.(`${voice.name} — chunk ${chunks.length + 1}/${chunkIndices.length}`);

    const offsets = new Set<number>();
    for (let t = chunk.tokenStart; t < chunk.tokenEnd; t++) {
      offsets.add(doc.tokens[t].speechOffset ?? doc.tokens[t].offset);
    }

    const speech = chunk.speech;
    /** A word start: index 0, or preceded by whitespace and not whitespace itself. */
    const isWordStart = (at: number) =>
      at >= 0 &&
      at < speech.length &&
      !/\s/.test(speech[at]) &&
      (at === 0 || /\s/.test(speech[at - 1]));

    const hit = new Set<number>();
    let boundaries = 0;
    let alignedBoundaries = 0;
    let onTokenStart = 0;
    let nonMonotonic = 0;
    let firstBoundaryMs: number | null = null;
    let previous = -1;

    synth.cancel();
    await wait(options.settleMs);

    const result = await speakAndRecord(
      synth,
      voice,
      chunk.speech,
      options.rate,
      (charIndex, elapsed) => {
        boundaries += 1;
        if (firstBoundaryMs === null) firstBoundaryMs = elapsed;
        if (isWordStart(charIndex)) alignedBoundaries += 1;
        if (offsets.has(charIndex)) onTokenStart += 1;

        const token = tokenAtCharIndex(doc, chunkIndex, charIndex, true);
        if (token >= 0) {
          hit.add(token);
          /*
           * Strictly decreasing only. Several boundaries resolving to the *same*
           * token is not a regression, it is an expanded acronym being spoken —
           * the engine's own rule is `next > lastToken`, so an equal index means
           * the caret holds rather than moves. Counting equality here reported
           * exactly one false regression per extra word of every expansion.
           */
          if (token < previous) nonMonotonic += 1;
          previous = token;
        }
      }
    );

    chunks.push({
      chunkIndex,
      tokens: chunk.tokenEnd - chunk.tokenStart,
      boundaries,
      tokensHit: hit.size,
      alignedBoundaries,
      onTokenStart,
      nonMonotonic,
      firstBoundaryMs,
      durationMs: result.durationMs,
      ended: result.ended,
      error: result.error,
    });
  }

  const measured = chunks.filter((c) => !c.error);
  const totalTokens = measured.reduce((n, c) => n + c.tokens, 0);
  const totalHit = measured.reduce((n, c) => n + c.tokensHit, 0);
  const totalBoundaries = measured.reduce((n, c) => n + c.boundaries, 0);
  const totalAligned = measured.reduce((n, c) => n + c.alignedBoundaries, 0);

  const coverage = totalTokens ? totalHit / totalTokens : 0;
  const precision = totalBoundaries ? totalAligned / totalBoundaries : 0;
  const firsts = measured
    .map((c) => c.firstBoundaryMs)
    .filter((v): v is number => v !== null);
  const firstBoundaryMs = firsts.length
    ? Math.round(firsts.reduce((a, b) => a + b, 0) / firsts.length)
    : null;

  /*
   * Rate honesty. The transport advertises 1.0x-3.0x, and a voice that ignores
   * `rate` makes that control a lie — the reader turns it up and nothing moves.
   */
  let rateRatio: number | null = null;
  if (!options.shouldStop?.() && measured.some((c) => c.ended)) {
    const chunk = doc.chunks[chunkIndices[0]];
    if (chunk) {
      options.onProgress?.(`${voice.name} — rate response`);
      synth.cancel();
      await wait(options.settleMs);
      const slow = await speakAndRecord(synth, voice, chunk.speech, 1, () => undefined);
      synth.cancel();
      await wait(options.settleMs);
      const fast = await speakAndRecord(synth, voice, chunk.speech, 2, () => undefined);
      if (slow.durationMs && fast.durationMs && fast.durationMs > 0) {
        rateRatio = Math.round((slow.durationMs / fast.durationMs) * 100) / 100;
      }
    }
  }

  /*
   * Long-utterance truncation. Chunks are capped at 180 characters precisely
   * because some backends silently stop early on long strings; this checks
   * whether that cap is still earning its keep for this voice.
   */
  let longUtteranceOk: boolean | null = null;
  if (!options.shouldStop?.()) {
    options.onProgress?.(`${voice.name} — long utterance`);
    synth.cancel();
    await wait(options.settleMs);
    let lastCharIndex = -1;
    const long = await speakAndRecord(synth, voice, longText, options.rate, (charIndex) => {
      lastCharIndex = charIndex;
    });
    if (long.ended) {
      // With no boundaries at all, `end` alone is the only signal available.
      longUtteranceOk =
        lastCharIndex < 0 ? true : lastCharIndex >= longText.length * 0.75;
    } else {
      longUtteranceOk = false;
    }
  }

  synth.cancel();

  return {
    voiceURI: voice.voiceURI,
    name: voice.name,
    lang: voice.lang,
    localService: voice.localService,
    ...classify(chunks, coverage, precision, firstBoundaryMs, options.graceMs),
    chunks,
    coverage,
    precision,
    firstBoundaryMs,
    rateRatio,
    longUtteranceOk,
  };
}

function classify(
  chunks: ChunkProbe[],
  coverage: number,
  precision: number,
  firstBoundaryMs: number | null,
  graceMs: number
): { verdict: Verdict; note: string } {
  if (!chunks.length || chunks.every((c) => c.error)) {
    const reason = chunks.find((c) => c.error)?.error ?? "no result";
    return { verdict: "failed", note: `Voice did not speak (${reason}).` };
  }

  const boundaries = chunks.reduce((n, c) => n + c.boundaries, 0);
  if (boundaries === 0) {
    return {
      verdict: "estimator-only",
      note: "Fires no word boundaries. Pacing is interpolated and the header says so.",
    };
  }

  if (precision < MIN_PRECISION) {
    return {
      verdict: "partial",
      note: `Only ${Math.round(precision * 100)}% of boundary offsets land on a word start in the spoken text — the caret would move smoothly to the wrong word.`,
    };
  }

  if (coverage < MIN_COVERAGE) {
    return {
      verdict: "partial",
      note: `Reports ${Math.round(coverage * 100)}% of words; the caret would skip and catch up.`,
    };
  }

  const nonMonotonic = chunks.reduce((n, c) => n + c.nonMonotonic, 0);
  if (nonMonotonic > 0) {
    return {
      verdict: "partial",
      note: `${nonMonotonic} boundaries arrived out of order — the engine clamps these, so the caret stalls instead.`,
    };
  }

  /*
   * A slow first boundary is a caveat, not a failure — the estimator covers the
   * gap and hands back the moment real events arrive. But the engine speaks one
   * sentence per utterance, so this latency is paid at *every* sentence, not
   * once. Past about a second that stops being a blip and becomes a lead-in the
   * reader can hear, with the caret interpolated through all of it, which is
   * what separates two otherwise identical voices.
   */
  if (firstBoundaryMs !== null && firstBoundaryMs > SLOW_START_MS) {
    return {
      verdict: "word-exact",
      note:
        `Word-exact, but the first boundary takes ${firstBoundaryMs}ms. The engine speaks ` +
        `one sentence per utterance, so that is a lead-in on every sentence with the caret ` +
        `interpolated throughout. Prefer a faster-starting voice.`,
    };
  }

  if (firstBoundaryMs !== null && firstBoundaryMs > graceMs) {
    return {
      verdict: "word-exact",
      note:
        `Word-exact, but the first boundary arrives at ${firstBoundaryMs}ms — past the ` +
        `${graceMs}ms grace, so the estimator covers the opening of each sentence.`,
    };
  }

  return { verdict: "word-exact", note: "Word-exact sync. Safe to use as a primary voice." };
}

/** The run as pasteable text, for dropping into notes or an issue. */
export function formatReport(reports: VoiceReport[]): string {
  const lines: string[] = [];
  lines.push("FocusParse voice probe");
  lines.push(`${navigator.userAgent}`);
  lines.push("");

  const order: Verdict[] = ["word-exact", "partial", "estimator-only", "failed"];
  for (const verdict of order) {
    const group = reports.filter((r) => r.verdict === verdict);
    if (!group.length) continue;
    lines.push(`## ${verdict} (${group.length})`);
    for (const r of group) {
      lines.push(
        `- ${r.name} [${r.lang}${r.localService ? ", local" : ", network"}] ` +
          `coverage ${Math.round(r.coverage * 100)}%, ` +
          `precision ${Math.round(r.precision * 100)}%, ` +
          `first boundary ${r.firstBoundaryMs ?? "—"}ms, ` +
          `rate x${r.rateRatio ?? "—"}, ` +
          `long utterance ${r.longUtteranceOk === null ? "—" : r.longUtteranceOk ? "ok" : "TRUNCATED"}`
      );
      lines.push(`  ${r.note}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

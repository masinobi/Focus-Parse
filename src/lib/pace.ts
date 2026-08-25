/**
 * What a voice actually delivers, per rate, learned from the reading itself.
 *
 * The speed control used to be a `rate` multiplier passed straight to
 * `SpeechSynthesisUtterance`, and it claimed a number no voice has ever
 * produced. Measured with `/voice-check`: 2.0x delivers about 1.4x on the local
 * voices and about 1.9x on the network ones, and the control offered up to 3.0x.
 * Two readers at "2.0x" on two different voices are reading at speeds that
 * differ by a third, and neither is reading twice as fast as anything.
 *
 * `rate` is not a lie the app can fix — the platform owns what it means. What
 * the app can do is stop *reporting* it as the speed. So the control now asks
 * for words per minute, and the rate is solved for: the answer to "what rate
 * gets this voice to 260 wpm?" is a question about that voice, and it is
 * answered from what that voice has already been observed to do.
 *
 * Three properties this has to have, and they are why it is a table rather than
 * a formula:
 *
 *  - **Per voice.** Rate is honoured differently by local and network
 *    synthesis, so a local voice's timings say nothing about a networked one's.
 *  - **Learned, not modelled.** A curve fitted here would be a guess about
 *    engines this file cannot see. Two real observations beat any curve.
 *  - **Honest about its own reach.** Every voice runs out of speed somewhere,
 *    and the control must say so rather than accept a target and quietly
 *    deliver something slower. That is the failure this replaces.
 */

/** Words a rate must carry before its measurement is worth solving from. */
const MIN_SAMPLE_WORDS = 40;

/** And for long enough. A fast burst between two stalls is not a pace. */
const MIN_SAMPLE_MS = 8000;

/**
 * Words per minute assumed at rate 1.0 for a voice never heard before.
 *
 * The same constant the app has always used for its time estimates, kept here
 * so an uncalibrated voice behaves exactly as it did before this existed.
 */
export const BASELINE_WPM = 185;

/** Where the table is remembered. It is a property of the machine's voices. */
const PACE_KEY = "focusparse:pace";

/** Rates are bucketed to the control's own step. */
function bucket(rate: number): string {
  return (Math.round(rate * 10) / 10).toFixed(1);
}

export interface PaceSample {
  words: number;
  ms: number;
}

/** voiceURI to rate bucket to what that combination has been heard to deliver. */
export type PaceTable = Record<string, Record<string, PaceSample>>;

/**
 * Fold a stretch of reading into the table.
 *
 * Accumulated rather than replaced. A single sentence is far too short a sample
 * to price a rate — one slow network round-trip inside it would move the
 * estimate by more than the rate ever does — and accumulating means a voice
 * gets more trustworthy the more it is used, which is the right direction.
 */
export function noteWords(
  table: PaceTable,
  voiceURI: string | null,
  rate: number,
  words: number,
  ms: number
): PaceTable {
  if (!voiceURI || words <= 0 || ms <= 0) return table;
  const key = bucket(rate);
  const forVoice = table[voiceURI] ?? {};
  const at = forVoice[key] ?? { words: 0, ms: 0 };
  return {
    ...table,
    [voiceURI]: { ...forVoice, [key]: { words: at.words + words, ms: at.ms + ms } },
  };
}

/** Observations for one voice that are long enough to price, as (rate, wpm). */
function pointsFor(table: PaceTable, voiceURI: string | null): [number, number][] {
  if (!voiceURI) return [];
  return Object.entries(table[voiceURI] ?? {})
    .filter(([, s]) => s.words >= MIN_SAMPLE_WORDS && s.ms >= MIN_SAMPLE_MS)
    .map(([rate, s]): [number, number] => [Number(rate), s.words / (s.ms / 60000)])
    .sort((a, b) => a[0] - b[0]);
}

/** What this voice has been measured to deliver at this rate, if it has been. */
export function observedWpm(
  table: PaceTable,
  voiceURI: string | null,
  rate: number
): number | null {
  const sample = voiceURI ? table[voiceURI]?.[bucket(rate)] : undefined;
  if (!sample || sample.words < MIN_SAMPLE_WORDS || sample.ms < MIN_SAMPLE_MS) return null;
  return sample.words / (sample.ms / 60000);
}

/**
 * Straight line through what has been observed, as `wpm = intercept + slope*rate`.
 *
 * A line rather than anything cleverer, and the intercept is the reason: the
 * measured relationship saturates — a voice at 2.0 is not twice the voice at
 * 1.0 — and a line with a positive intercept and a shallow slope is exactly
 * what saturation looks like over the range a reader uses. Fitting a curve to
 * two or three points would be inventing precision that is not in the data.
 *
 * With one observation there is no line, so the fallback is proportionality
 * through the origin: the single honest reading of "this voice did 240 wpm at
 * 1.4" with nothing to compare it to.
 */
function fit(points: [number, number][]): { intercept: number; slope: number } | null {
  if (points.length === 0) return null;
  if (points.length === 1) {
    const [rate, wpm] = points[0];
    return rate > 0 ? { intercept: 0, slope: wpm / rate } : null;
  }

  const n = points.length;
  const meanRate = points.reduce((t, [r]) => t + r, 0) / n;
  const meanWpm = points.reduce((t, [, w]) => t + w, 0) / n;
  let num = 0;
  let den = 0;
  for (const [r, w] of points) {
    num += (r - meanRate) * (w - meanWpm);
    den += (r - meanRate) ** 2;
  }
  // Every sample landed in one bucket, or the readings disagree about which
  // direction the control goes. Neither is something to solve a slope from, so
  // fall back to the proportional reading of where the samples sit on average.
  if (den <= 0 || num <= 0) {
    return meanRate > 0 ? { intercept: 0, slope: meanWpm / meanRate } : null;
  }
  const slope = num / den;
  return { intercept: meanWpm - slope * meanRate, slope };
}

export interface PaceSolution {
  /** Rate to hand the synthesizer, already clamped to what it accepts. */
  rate: number;
  /** Words per minute that rate is expected to deliver on this voice. */
  expectedWpm: number;
  /** True once the answer comes from this voice rather than from the baseline. */
  calibrated: boolean;
  /**
   * True when the target is past what this voice can do at either end. The
   * caller must show `expectedWpm` instead of the target — reporting a number
   * the voice will not deliver is the defect this whole module exists to end.
   */
  clamped: boolean;
}

/**
 * Solve for the rate that reads at `target` words per minute on this voice.
 *
 * Uncalibrated, this reduces exactly to the old behaviour: `target / 185`,
 * which is the multiplier the control used to be. The difference is that the
 * number on screen is then a claim the app goes on to check.
 */
export function solveRate(
  table: PaceTable,
  voiceURI: string | null,
  target: number,
  minRate: number,
  maxRate: number
): PaceSolution {
  const line = fit(pointsFor(table, voiceURI));
  const calibrated = line !== null;
  const { intercept, slope } = line ?? { intercept: 0, slope: BASELINE_WPM };

  const wanted = slope > 0 ? (target - intercept) / slope : minRate;
  const rate = Math.min(maxRate, Math.max(minRate, Math.round(wanted * 10) / 10));
  const expectedWpm = Math.max(1, Math.round((intercept + slope * rate) / 5) * 5);

  return {
    rate,
    expectedWpm,
    calibrated,
    // Measured against what the solved rate delivers rather than against the
    // raw target, so rounding to the control's own step is never reported as a
    // shortfall — only a target the voice genuinely cannot reach is.
    clamped: Math.abs(expectedWpm - target) > 5,
  };
}

/** The fastest and slowest this voice can be asked for, as measured. */
export function reachOf(
  table: PaceTable,
  voiceURI: string | null,
  minRate: number,
  maxRate: number
): { min: number; max: number } | null {
  const line = fit(pointsFor(table, voiceURI));
  if (!line) return null;
  const at = (r: number) => Math.round((line.intercept + line.slope * r) / 5) * 5;
  return { min: at(minRate), max: at(maxRate) };
}

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

export function loadPace(): PaceTable {
  try {
    const raw = window.localStorage.getItem(PACE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    // Anything at all could be under this key — another version of the app, a
    // hand-edited value, a half-written record. A malformed table must read as
    // an empty one rather than reaching the solver.
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: PaceTable = {};
    for (const [voice, rates] of Object.entries(parsed as Record<string, unknown>)) {
      if (!rates || typeof rates !== "object") continue;
      const clean: Record<string, PaceSample> = {};
      for (const [rate, sample] of Object.entries(rates as Record<string, unknown>)) {
        const s = sample as Partial<PaceSample>;
        if (typeof s?.words === "number" && typeof s?.ms === "number" && s.ms > 0) {
          clean[rate] = { words: s.words, ms: s.ms };
        }
      }
      if (Object.keys(clean).length) out[voice] = clean;
    }
    return out;
  } catch {
    // Private mode, or nothing readable. The voice simply starts uncalibrated.
    return {};
  }
}

export function savePace(table: PaceTable): void {
  try {
    window.localStorage.setItem(PACE_KEY, JSON.stringify(table));
  } catch {
    // Private mode: the calibration lasts the session and no longer.
  }
}

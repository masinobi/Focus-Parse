/**
 * Speaking a summary instead of typing one, and the defect that comes with it.
 *
 * The intercept is the most expensive rung of the ladder and the only one that
 * demands manual output from someone who has spent twenty minutes in a purely
 * auditory task. Dictating it is an obvious win.
 *
 * The obvious win has a trap in it that nothing else in this app would catch.
 * **A speech recognizer does not know this vocabulary.** Said aloud, `CDISC`
 * comes back as "see disk", `SDTM` as "STM" or "ess dee tea em", `eCRF` as "e
 * see are eff". The reader gives a correct summary, the grader is handed a
 * garbled one, and it returns `off_track` on the single rung that costs the
 * most to redo. A false failure there does more damage than no dictation at
 * all: it teaches the reader that the grader is unreliable, and after that the
 * whole enforcement ladder is theatre.
 *
 * So the transcript is reconciled against the vocabulary the document actually
 * uses before anyone sees it.
 *
 * ## What keeps this from making things worse
 *
 * A corrector that rewrites the reader's words is worse than a recognizer that
 * mangles them, because the reader can see a mangled word and cannot see a
 * substituted one. Three rules hold it down:
 *
 *  - **Scoped to the document.** A candidate is only ever replaced by an
 *    acronym the document being summarised contains. "See disk" becomes
 *    `CDISC` in a chapter about data standards and stays "see disk" everywhere
 *    else.
 *  - **Derived, not guessed.** The forms matched are generated from the
 *    acronym itself — as written, and spelled out letter by letter using a
 *    fixed table of letter names. `SPOKEN_AS` holds the handful whose spoken
 *    form is neither, and it is a list rather than a similarity threshold.
 *  - **Reported.** Every substitution is returned, so the dialog can show what
 *    it changed and the reader can put it back. A silent correction is the
 *    thing this is trying to avoid, whoever makes it.
 */

/** How each letter is transcribed when it is spoken on its own. */
const LETTER_NAMES: Record<string, string> = {
  a: "ay",
  b: "bee",
  c: "see",
  d: "dee",
  e: "ee",
  f: "eff",
  g: "gee",
  h: "aitch",
  i: "eye",
  j: "jay",
  k: "kay",
  l: "el",
  m: "em",
  n: "en",
  o: "oh",
  p: "pee",
  q: "cue",
  r: "are",
  s: "ess",
  t: "tee",
  u: "you",
  v: "vee",
  w: "double you",
  x: "ex",
  y: "why",
  z: "zed",
};

/**
 * Acronyms nobody says letter by letter, and nobody says as written either.
 *
 * A list, on purpose. The alternative is a pronunciation model, and a wrong
 * pronunciation model substitutes words the reader never said.
 */
export const SPOKEN_AS: Record<string, string[]> = {
  CDISC: ["see disk", "sea disk", "cdisc"],
  CDASH: ["see dash", "sea dash", "cdash"],
  SDTM: ["ess dee tee em", "sdtm"],
  ADaM: ["adam", "a dam"],
  MedDRA: ["meddra", "med dra", "medra"],
  LOINC: ["loink", "loinc", "low ink"],
  WHODrug: ["who drug", "whodrug"],
  eCRF: ["e see are eff", "ecrf", "e crf"],
  ePRO: ["e pro", "epro"],
  eSource: ["e source", "esource"],
  ALCOA: ["alcoa", "al co a"],
  TMF: ["tee em eff", "tmf"],
  SAE: ["ess ay ee", "sae", "say"],
  UAT: ["you ay tee", "uat"],
  GCP: ["gee see pee", "gcp"],
  CRO: ["see are oh", "cro", "crow"],
};

/**
 * A rough consonant skeleton, used only to decide whether two strings are the
 * same *sounds* in the same order.
 *
 * Not a general phonetic algorithm and not trying to be. Vowels carry almost
 * none of the signal in this vocabulary and are exactly where a recognizer
 * varies ("see disk" against "sea disc"), while the consonant run is stable.
 * Soft `c` and `s` collapse together for the same reason.
 */
export function soundKey(text: string): string {
  const letters = text
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .replace(/ph/g, "f")
    .replace(/ck/g, "k")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/c/g, "k")
    .replace(/q/g, "k")
    .replace(/z/g, "s")
    .replace(/x/g, "ks");

  let out = "";
  for (const ch of letters) {
    // The leading vowel is kept, and it is not a nicety: `eCRF` spelled out is
    // "e see are eff" and `CRF` is "see are eff", which are the same consonant
    // run. Dropping it made the two indistinguishable and the longer acronym,
    // registered first, ate both.
    if ("aeiou".includes(ch) && out.length > 0) continue;
    // A doubled consonant is one sound.
    if (out.endsWith(ch)) continue;
    out += ch;
  }
  return out;
}

/** Every way an acronym plausibly comes back from a recognizer. */
export function spokenCandidates(acronym: string): string[] {
  const spelled = acronym
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .split("")
    .map((c) => LETTER_NAMES[c] ?? c)
    .join(" ");

  return [acronym, spelled, ...(SPOKEN_AS[acronym] ?? [])];
}

export interface Correction {
  from: string;
  to: string;
}

export interface Reconciled {
  text: string;
  corrections: Correction[];
}

/**
 * Longest first, so `eCRF` is tried before `CRF` and the shorter one does not
 * eat the front of the longer one's transcription.
 */
function byLength(a: string, b: string): number {
  return b.length - a.length;
}

/**
 * Put the document's own vocabulary back into a dictated summary.
 *
 * `vocabulary` is the set of acronyms the document actually contains — the
 * reader's tokens already carry them, so this is a lookup rather than a guess —
 * and nothing outside it is ever substituted in.
 *
 * Windows of one to four words are tested, longest window first, because the
 * spoken form of an acronym is usually several words ("ess dee tee em") and a
 * shorter match inside it would split the phrase.
 */
export function reconcile(transcript: string, vocabulary: string[]): Reconciled {
  /**
   * Sound key to the acronym, and the lengths of *every* form that produced it.
   *
   * Every form, because one key is reached by several: `SDTM` and "ess dee tee
   * em" have the same skeleton and are four letters and twelve. Keeping only
   * the first meant the size test below rejected the spelled-out form for being
   * three times the length of the written one — which is the form a recognizer
   * actually returns.
   */
  const keyed = new Map<string, { acronym: string; lengths: number[] }>();
  /** Written forms, matched case-insensitively and exactly. */
  const written = new Map<string, string>();

  for (const acronym of [...vocabulary].sort(byLength)) {
    written.set(acronym.toLowerCase(), acronym);
    for (const candidate of spokenCandidates(acronym)) {
      const key = soundKey(candidate);
      // A key long enough to be distinctive. "SAE" spelled is "ess ay ee",
      // whose skeleton is "s" — matching that would rewrite every stray "so".
      if (key.length < 3) continue;
      const length = candidate.replace(/[^a-z]/gi, "").length;
      const existing = keyed.get(key);
      if (existing) {
        if (existing.acronym === acronym) existing.lengths.push(length);
      } else {
        keyed.set(key, { acronym, lengths: [length] });
      }
    }
  }
  if (!keyed.size && !written.size) return { text: transcript, corrections: [] };

  /**
   * A sound key is a skeleton, and a skeleton fits more than one body.
   *
   * `soundKey` collapses adjacent duplicate consonants, which is right inside a
   * word and wrong across a boundary: "uses see disk" and "see disk" reduce to
   * the same "sdsk", and matching the longest window first happily rewrote
   * three words as `CDISC` and ate the verb. So the phrase also has to be about
   * the same *size* as the form that produced the key.
   */
  const sameSize = (phrase: string, lengths: number[]): boolean => {
    const n = phrase.replace(/[^a-z]/gi, "").length;
    return lengths.some((len) => n >= len * 0.6 && n <= len * 1.4);
  };

  const words = transcript.split(/(\s+)/);
  const corrections: Correction[] = [];
  const out: string[] = [];

  for (let i = 0; i < words.length; ) {
    if (/^\s+$/.test(words[i])) {
      out.push(words[i]);
      i += 1;
      continue;
    }

    let matched = false;
    for (let span = 4; span >= 1 && !matched; span--) {
      // Words are every other entry; the separators between them come along.
      const end = i + span * 2 - 1;
      if (end > words.length) continue;
      const phrase = words.slice(i, end).join("");
      if (!/[a-z]/i.test(phrase)) continue;

      // An exact written form first, and with no size test: "edc" is `EDC`,
      // and its skeleton is too short to key on safely.
      const exact = span === 1 ? written.get(phrase.trim().toLowerCase()) : undefined;
      const sounded = keyed.get(soundKey(phrase));
      const acronym =
        exact ?? (sounded && sameSize(phrase, sounded.lengths) ? sounded.acronym : undefined);
      if (!acronym) continue;
      // Already correct: not a correction, and must not be reported as one.
      if (phrase.trim() !== acronym) corrections.push({ from: phrase.trim(), to: acronym });
      out.push(acronym);
      i = end;
      matched = true;
    }

    if (!matched) {
      out.push(words[i]);
      i += 1;
    }
  }

  return { text: out.join(""), corrections };
}

/* ------------------------------------------------------------------ *
 * The recognizer
 * ------------------------------------------------------------------ */

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
}

type RecognitionCtor = new () => SpeechRecognitionLike;

/**
 * Chrome's is prefixed and nothing else ships it.
 *
 * Returned rather than asserted so the caller can decide: the dictation button
 * is simply absent where this is null, which is the honest behaviour — an
 * enabled button that does nothing is worse than no button.
 */
export function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** The final text out of a recognition result event, however it is shaped. */
export function transcriptOf(event: unknown): string {
  const results = (event as { results?: ArrayLike<ArrayLike<{ transcript?: string }>> })
    .results;
  if (!results) return "";

  let text = "";
  for (let i = 0; i < results.length; i++) {
    text += results[i]?.[0]?.transcript ?? "";
  }
  return text.trim();
}

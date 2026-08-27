/**
 * Summary grading, shared across providers.
 *
 * The intercept's value comes from producing the summary yourself, so grading
 * runs only after one has been written, never before, and never as a gate on
 * resuming. It judges recall against the section text — not writing quality.
 */

export type VerdictLevel = "accurate" | "partial" | "off_track";

/**
 * Whether the summary got at *why*, and whether there was a why to get.
 *
 * Held apart from `verdict` on purpose. A summary can capture a section's
 * central point perfectly and never say what the rule is for — and measured
 * against the real grader, both a bare restatement of Part 11’s audit-trail
 * requirement and an account of what audit trails are *for* came back
 * "accurate", with nothing to separate them.
 *
 * `not_stated` is what keeps this fair. A great deal of the GCDMP is lists of
 * minimum standards with no reasoning attached, and a grader that demanded a
 * rationale from a list would mark a correct summary down for omitting
 * something the section never said. That is the same failure as an unfair
 * cloze: the reader learns the check is unreliable and stops believing it.
 */
export type RationaleLevel = "captured" | "missed" | "not_stated";

/*
 * How well the separation holds, measured rather than assumed.
 *
 * Sampled against the live Gemini grader with a deliberately borderline
 * summary — "Part 11 requires secure computer-generated time-stamped audit
 * trails", against a section whose stated purpose is the reconstructability
 * that makes the record admissible. Six runs of the same input returned three
 * "accurate" and three "partial". The committed prompt, before any of this
 * existed, also returned "partial" for it.
 *
 * So the verdict on that summary is unstable either way, and the sample is not
 * large enough to say whether the rationale instruction moves it — the free
 * tier quota ran out before a baseline of the same size could be taken. What
 * is in place is the structural guard rather than the instruction alone:
 * `propertyOrdering` in the Gemini schema emits `verdict` before `rationale`,
 * so the verdict is committed to before the rationale judgement is made, and
 * the prompt now says to decide it first and on its own.
 *
 * Worth re-measuring with a fresh quota, on a summary that is not borderline.
 */

export interface Verdict {
  verdict: VerdictLevel;
  /** One or two sentences, addressed to the reader. */
  feedback: string;
  /** Load-bearing points the summary left out. */
  missed: string[];
  /** Claims in the summary the section does not support. */
  contradictions: string[];
  /** Whether the summary reached the reason, where the section gives one. */
  rationale: RationaleLevel;
  /**
   * The reason the section gives, in the section’s own terms. Empty when
   * `rationale` is `not_stated`, and never invented.
   */
  why: string;
}

export interface GradeRequest {
  sectionTitle: string;
  sectionText: string;
  summary: string;
}

export const GRADER_SYSTEM = `You grade one-sentence recall summaries written by someone studying a document.

You are given a section of source text and the reader's summary, written from memory.

Judge only against the source text provided. Never use outside knowledge, and never
reward a summary for being well written — the question is whether it captures what
the section actually argued.

- "accurate": the summary captures the section's main point, with nothing important
  wrong.
- "partial": what it says is true, but it misses the section's central point or
  reduces it to a detail.
- "off_track": it contradicts the section, or describes something the section does
  not say.

Decide the verdict first and on its own, before considering anything below. The
verdict is about the section's central point and nothing else.

Then, separately, judge whether the summary reached the *reason*.
Clinical data management is examined on why a rule exists, not only on what it
requires — that an audit trail makes a change attributable and reconstructable,
not merely that one is mandated.

- "captured": the section gives a reason, purpose or consequence, and the summary
  reached it.
- "missed": the section gives one and the summary restated only the requirement.
- "not_stated": the section does not give one. Lists of minimum standards, tables
  of responsibilities and definitions frequently do not, and that is normal.

Never mark "missed" for a reason the section does not actually state, and never
lower the verdict because the rationale was missed — they are separate judgements
and a summary that captures the central point is accurate either way.

why: the reason the section gives, in one short phrase, in the section's own
terms. Empty string when "not_stated". Never supply a reason from outside the
section, however well known it is.

feedback: one or two sentences, addressed to the reader as "you". Be direct and
specific about the actual content. No praise padding, no restating their summary.
missed: at most three load-bearing points the summary omitted. Empty if none.
contradictions: claims the section does not support. Empty if none.

The source text is extracted from a PDF, so it may contain artefacts — broken
hyphenation, stray reference numbers, or a caption spliced mid-sentence. Judge the
reader on the substance, never on transcription noise.`;

export function buildPrompt(request: GradeRequest): string {
  return [
    `<section title="${request.sectionTitle.replace(/"/g, "'")}">`,
    request.sectionText,
    "</section>",
    "",
    "<summary>",
    request.summary,
    "</summary>",
  ].join("\n");
}

/** Defensive narrowing: a model can always return something unexpected. */
export function coerceVerdict(value: unknown): Verdict | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  const level = raw.verdict;
  if (level !== "accurate" && level !== "partial" && level !== "off_track") {
    return null;
  }
  if (typeof raw.feedback !== "string") return null;

  const list = (input: unknown): string[] =>
    Array.isArray(input) ? input.filter((v): v is string => typeof v === "string") : [];

  // A model that omits the field, or invents a fourth level, must not take the
  // whole verdict down with it: the rest of the grade is still usable, and
  // "not_stated" is the reading that claims least.
  const rationale =
    raw.rationale === "captured" || raw.rationale === "missed" ? raw.rationale : "not_stated";

  return {
    verdict: level,
    feedback: raw.feedback,
    missed: list(raw.missed).slice(0, 3),
    contradictions: list(raw.contradictions).slice(0, 3),
    rationale,
    why: typeof raw.why === "string" && rationale !== "not_stated" ? raw.why : "",
  };
}

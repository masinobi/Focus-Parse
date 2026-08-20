/**
 * Summary grading, shared across providers.
 *
 * The intercept's value comes from producing the summary yourself, so grading
 * runs only after one has been written, never before, and never as a gate on
 * resuming. It judges recall against the section text — not writing quality.
 */

export type VerdictLevel = "accurate" | "partial" | "off_track";

export interface Verdict {
  verdict: VerdictLevel;
  /** One or two sentences, addressed to the reader. */
  feedback: string;
  /** Load-bearing points the summary left out. */
  missed: string[];
  /** Claims in the summary the section does not support. */
  contradictions: string[];
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

  return {
    verdict: level,
    feedback: raw.feedback,
    missed: list(raw.missed).slice(0, 3),
    contradictions: list(raw.contradictions).slice(0, 3),
  };
}

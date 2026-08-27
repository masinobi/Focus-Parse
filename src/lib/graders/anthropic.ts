import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

import {
  buildPrompt,
  coerceVerdict,
  GRADER_SYSTEM,
  type GradeRequest,
  type Verdict,
} from "./types";

const VerdictSchema = z.object({
  verdict: z.enum(["accurate", "partial", "off_track"]),
  feedback: z.string(),
  missed: z.array(z.string()),
  contradictions: z.array(z.string()),
  rationale: z.enum(["captured", "missed", "not_stated"]),
  why: z.string(),
});

export async function gradeWithClaude(request: GradeRequest): Promise<Verdict> {
  const client = new Anthropic();

  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 2_000,
    system: GRADER_SYSTEM,
    // Grading a short summary against a bounded passage is not an
    // intelligence-sensitive task, and the reader is waiting mid-session.
    output_config: {
      effort: "low",
      format: zodOutputFormat(VerdictSchema),
    },
    messages: [{ role: "user", content: buildPrompt(request) }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("The model declined to grade this passage.");
  }

  const verdict = coerceVerdict(response.parsed_output);
  if (!verdict) throw new Error("Claude returned an unusable verdict.");
  return verdict;
}

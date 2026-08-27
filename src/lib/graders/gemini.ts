import { GoogleGenAI, Type } from "@google/genai";

import {
  buildPrompt,
  coerceVerdict,
  GRADER_SYSTEM,
  type GradeRequest,
  type Verdict,
} from "./types";

/**
 * Gemini grader.
 *
 * Note on the model id: `models.list` still advertises `gemini-2.5-flash`, but
 * the endpoint rejects it for new keys and names `gemini-3.6-flash` as the
 * replacement. Trust the endpoint over the listing.
 */
const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    verdict: {
      type: Type.STRING,
      enum: ["accurate", "partial", "off_track"],
    },
    feedback: { type: Type.STRING },
    missed: { type: Type.ARRAY, items: { type: Type.STRING } },
    contradictions: { type: Type.ARRAY, items: { type: Type.STRING } },
    rationale: {
      type: Type.STRING,
      enum: ["captured", "missed", "not_stated"],
    },
    why: { type: Type.STRING },
  },
  required: ["verdict", "feedback", "missed", "contradictions", "rationale", "why"],
  propertyOrdering: [
    "verdict",
    "feedback",
    "missed",
    "contradictions",
    "rationale",
    "why",
  ],
} as const;

export async function gradeWithGemini(request: GradeRequest): Promise<Verdict> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: buildPrompt(request) }] }],
    config: {
      systemInstruction: GRADER_SYSTEM,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  const text = response.text;
  if (!text) throw new Error("Gemini returned an empty response.");

  const verdict = coerceVerdict(JSON.parse(text));
  if (!verdict) throw new Error("Gemini returned an unusable verdict.");
  return verdict;
}

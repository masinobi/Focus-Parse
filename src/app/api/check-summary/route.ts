import { NextResponse } from "next/server";
import { z } from "zod";

import type { GradeRequest, Verdict } from "@/lib/graders/types";

/**
 * Optional summary check. Provider is chosen by whichever key is configured, so
 * the feature is additive: with no key the UI never offers it.
 */

export const runtime = "nodejs";

/** Sections are normally capped near 700 words; this is a safety bound. */
const MAX_SECTION_CHARS = 40_000;

const RequestSchema = z.object({
  sectionTitle: z.string().max(300),
  sectionText: z.string().min(1).max(MAX_SECTION_CHARS),
  summary: z.string().min(1).max(2_000),
});

type Provider = "gemini" | "claude";

function activeProvider(): Provider | null {
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.ANTHROPIC_API_KEY) return "claude";
  return null;
}

/** Lets the UI hide the feature entirely when no key is configured. */
export async function GET() {
  const provider = activeProvider();
  return NextResponse.json({ configured: provider !== null, provider });
}

export async function POST(request: Request) {
  const provider = activeProvider();

  if (!provider) {
    return NextResponse.json(
      {
        error:
          "No API key configured. Add GEMINI_API_KEY or ANTHROPIC_API_KEY to .env.local and restart the dev server.",
      },
      { status: 501 }
    );
  }

  let body: GradeRequest;
  try {
    body = RequestSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  try {
    // Imported lazily so an unconfigured provider's SDK is never loaded.
    const verdict: Verdict =
      provider === "gemini"
        ? await (await import("@/lib/graders/gemini")).gradeWithGemini(body)
        : await (await import("@/lib/graders/anthropic")).gradeWithClaude(body);

    return NextResponse.json(verdict);
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : "Summary check failed.";
    // Surface the provider's own message: a bad key or a retired model id is
    // something the reader can act on, and hiding it just wastes their time.
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

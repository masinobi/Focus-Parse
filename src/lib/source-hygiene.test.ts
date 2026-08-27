import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * No source file may contain a control character.
 *
 * This is not style. Three separate live rules in this codebase were silently
 * dead because a stray control byte had replaced the backslash escape they were
 * written with, and every one of them read correctly in an editor:
 *
 *   pdf.ts     /…|\bet al\.|…/   became  /…|<0x08>et al\.|…/
 *   parse.ts   /([.,;:])\1+$/    became  /([.,;:])<0x01>+$/
 *   citations  /\bwww\.\S+/      became  /<0x08>www\.\S+/
 *
 * Each still compiled, still ran, still matched nothing it was meant to match.
 * `\b` is a backspace and `\1` is a start-of-header in most languages' string
 * escaping, so a scripted edit that passes a pattern through one layer too few
 * produces exactly this — and the resulting regex is a valid regex for a
 * character no document contains. The front-matter rule had been dead long
 * enough to be promoting journal citation lines to headings in three chapters.
 *
 * Nothing else catches it. TypeScript compiles it, ESLint passes it, the tests
 * that cover the surrounding function pass because they exercise the other
 * alternatives, and a diff shows an empty space.
 */

const ROOTS = ["src", "scripts"];
const EXTENSIONS = /\.(ts|tsx|mjs|mts|css)$/;
/** Tab, newline and carriage return are the only ones a source file may hold. */
const ALLOWED = new Set([9, 10, 13]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (EXTENSIONS.test(name)) out.push(path);
  }
  return out;
}

describe("source hygiene", () => {
  const files = ROOTS.flatMap(sourceFiles);

  it("finds the files it is meant to be checking", () => {
    // Without this the suite passes just as well when the walk is broken, which
    // is the failure this whole file exists to refuse.
    expect(files.length).toBeGreaterThan(30);
  });

  it("has no control characters in any source file", () => {
    const offenders: string[] = [];

    for (const path of files) {
      const bytes = readFileSync(path);
      const found = new Set<number>();
      for (const byte of bytes) {
        if (byte < 32 && !ALLOWED.has(byte)) found.add(byte);
      }
      if (found.size) {
        offenders.push(
          `${path}: ${[...found].map((b) => `0x${b.toString(16)}`).join(", ")}`
        );
      }
    }

    expect(offenders).toEqual([]);
  });
});

/**
 * The published demo is held to a stricter rule than the app: pure ASCII.
 *
 * `demo/index.html` is a standalone page published as an Artifact, and the
 * wrapper owns `<head>` — so the page cannot declare a charset and anything
 * outside ASCII renders as mojibake. Curly quotes and em-dashes have to be HTML
 * entities in markup and `\uXXXX` escapes in script.
 *
 * It drifts. Two em-dashes had reached JavaScript comments by the seventh
 * round, where they were invisible and harmless — and one edit away from being
 * moved into markup, at which point they render as garbage on a page nobody
 * runs a build over.
 */
describe("the published demo", () => {
  const path = join("demo", "index.html");

  it("exists where the notes say it does", () => {
    // It lived only in a session scratchpad for six rounds, and every change
    // meant fetching the published page back to recover it.
    expect(existsSync(path)).toBe(true);
  });

  it("is pure ASCII, because it cannot declare a charset", () => {
    const bytes = readFileSync(path);
    const offenders: string[] = [];
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] > 127) {
        const around = bytes.subarray(Math.max(0, i - 40), i + 12).toString("utf8");
        offenders.push(`byte ${i}: ${JSON.stringify(around)}`);
        if (offenders.length >= 3) break;
      }
    }
    expect(offenders).toEqual([]);
  });

  it("is the page body, without the wrapper the publisher adds", () => {
    // Republishing the fetched file verbatim would nest a whole document inside
    // the one the publisher builds.
    const html = readFileSync(path, "utf8");
    expect(html).not.toMatch(/<!doctype/i);
    expect(html).not.toMatch(/<html[\s>]/i);
    expect(html).not.toMatch(/<body[\s>]/i);
    expect(html).toMatch(/^<title>/);
  });
});

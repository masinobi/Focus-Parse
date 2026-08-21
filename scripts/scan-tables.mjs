/**
 * Offline grid-detection report.
 *
 * Compiles src/lib/tables.ts and runs it over a folder of PDFs, so the
 * detector's hit rate can be measured against a real corpus rather than
 * guessed at. Usage:
 *
 *   node scripts/scan-tables.mjs "C:/path/to/pdfs" [--verbose]
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const dir = process.argv[2];
const verbose = process.argv.includes("--verbose");
if (!dir) {
  console.error("usage: node scripts/scan-tables.mjs <folder-of-pdfs> [--verbose]");
  process.exit(1);
}

// Single source of truth: compile the module the app uses.
const out = mkdtempSync(join(tmpdir(), "fp-tables-"));
// Invoke the compiler's JS entry point directly: spawning tsc.cmd needs a
// shell on Windows, and going through one just to reach node is silly.
execFileSync(
  process.execPath,
  [resolve("node_modules/typescript/bin/tsc"),
   "src/lib/tables.ts", "--outDir", out, "--module", "esnext",
   "--target", "es2020", "--moduleResolution", "bundler", "--skipLibCheck"],
  { stdio: "inherit" }
);
const { detectTablesOnPage } = await import(
  pathToFileURL(join(out, "tables.js")).href
);

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf"));

let pages = 0;
let found = 0;
let schedules = 0;

for (const file of files) {
  const data = new Uint8Array(readFileSync(join(dir, file)));
  const doc = await pdfjs.getDocument({
    data, isEvalSupported: false, useSystemFonts: true,
  }).promise;

  const hits = [];
  for (let n = 1; n <= doc.numPages; n++) {
    pages += 1;
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const glyphs = content.items
      .filter((i) => "str" in i && i.str.trim())
      .map((i) => ({
        str: i.str,
        x: i.transform[4],
        width: i.width ?? 0,
        y: i.transform[5],
        size: Math.abs(i.transform[3]) || 10,
      }));
    page.cleanup();

    for (const t of detectTablesOnPage(glyphs, n)) {
      if (t.confidence < 0.6) continue;
      hits.push(t);
      found += 1;
      if (t.looksLikeSchedule) schedules += 1;
    }
  }

  console.log(`\n=== ${file} (${doc.numPages} pages) ===`);
  if (!hits.length) console.log("   no grids");
  for (const t of hits) {
    const flag = t.looksLikeSchedule ? " [SCHEDULE]" : "";
    console.log(
      `   p${t.page}: ${t.rows.length}x${t.columns.length}  ` +
      `conf=${t.confidence.toFixed(2)}${flag}` +
      (t.caption ? `  caption="${t.caption.slice(0, 50)}"` : "")
    );
    console.log(`        header: ${t.header.map((h) => h.slice(0, 22)).join(" | ")}`);
    if (verbose) {
      for (const r of t.rows.slice(1, 5)) {
        console.log(`        row:    ${r.cells.map((c) => c.text.slice(0, 22)).join(" | ")}`);
      }
    }
  }
  await doc.destroy();
}

console.log(`\n--- ${found} grids over ${pages} pages in ${files.length} files; ${schedules} look like schedules ---`);
rmSync(out, { recursive: true, force: true });

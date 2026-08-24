/**
 * Offline report for column recovery.
 *
 * A two-column page whose gutter is not detected is not *slightly* wrong: the
 * rows are read straight across, so the left column's sentence and the right
 * column's sentence interleave a fragment at a time. The reader hears half a
 * clause from one column, half from the other, and the text arrives as
 * plausible-sounding nonsense — which is far worse than text that is obviously
 * broken, because nothing announces it.
 *
 *   node scripts/scan-columns.mjs "C:/path/to/corpus" [--verbose]
 *
 * Ground truth for one page, established by reading the glyphs directly:
 * page 5 of the EDC implementation chapter has body text starting at x=62 and
 * at x=308, with the heading "5) Best Practices" at x=308 on the same baseline
 * as "and documents be retained in compliance with 21 CFR" at x=62. The gutter
 * is not detected there, and the assembled markdown reads
 * "…in compliance with 21 CFR 5) Best Practices 312.62(c) and 812.140(d)." —
 * which is also why that heading is missing from the structure map.
 *
 * **Columns are found here by where text starts, not by where it is absent.**
 * `detectBandCuts` looks for a quiet vertical strip, which one full-width
 * element anywhere on the page is enough to fill in. Left-edge clustering
 * survives that, so this report can see failures the app cannot.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const dir = process.argv[2];
const verbose = process.argv.includes("--verbose");
if (!dir) {
  console.error("usage: node scripts/scan-columns.mjs <folder> [--verbose]");
  process.exit(1);
}

const out = mkdtempSync(join(tmpdir(), "fp-columns-"));
execFileSync(
  process.execPath,
  [
    resolve("node_modules/typescript/bin/tsc"),
    "src/lib/pdf.ts",
    "src/lib/parse.ts",
    "src/lib/tables.ts",
    "--outDir", out,
    "--module", "commonjs",
    "--target", "es2020",
    "--moduleResolution", "node",
    "--skipLibCheck",
  ],
  { stdio: "inherit" }
);

const load = createRequire(import.meta.url);
const { detectBandCuts, detectColumnStarts, isBoldFont } = load(join(out, "pdf.js"));
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

/**
 * Distinct left edges that many runs share.
 *
 * A body column has one left edge used by most of its lines. Two such edges
 * more than 100pt apart is two columns, whatever sits between them — a table,
 * a full-width heading or a figure does not move where the body starts.
 */
function columnStarts(items) {
  const counts = new Map();
  for (const item of items) {
    const bucket = Math.round(item.x / 8) * 8;
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  const strong = [...counts.entries()]
    .filter(([, n]) => n >= 6)
    .map(([x]) => x)
    .sort((a, b) => a - b);

  const clusters = [];
  for (const x of strong) {
    if (!clusters.length || x - clusters[clusters.length - 1] > 100) clusters.push(x);
  }
  return clusters;
}

/** Pages with less text than this are covers and dividers, not prose. */
const MIN_RUNS = 20;

let corpusWords = 0;
let corpusFused = 0;
let corpusRescued = 0;

for (const file of readdirSync(dir).filter((f) => /\.pdf$/i.test(f))) {
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(readFileSync(join(dir, file))),
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  let twoColumn = 0;
  let missed = 0;
  let rescued = 0;
  let rescuedWords = 0;
  let words = 0;
  let fused = 0;
  const bad = [];

  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const styles = content.styles ?? {};

    const items = [];
    for (const raw of content.items) {
      if (!("str" in raw) || !raw.str.trim()) continue;
      const x = raw.transform[4];
      const family = styles[raw.fontName]?.fontFamily ?? "unknown";
      items.push({
        str: raw.str,
        x,
        xEnd: x + (raw.width ?? 0),
        y: raw.transform[5],
        size: Math.abs(raw.transform[3]) || 10,
        family,
        bold: isBoldFont(family),
      });
    }
    page.cleanup();
    if (items.length < MIN_RUNS) continue;

    const pageWords = items.reduce(
      (n, i) => n + i.str.split(/\s+/).filter(Boolean).length,
      0
    );
    words += pageWords;

    const sizes = items.map((i) => i.size).sort((a, b) => a - b);
    const body = sizes[Math.floor(sizes.length / 2)] || 10;

    if (columnStarts(items).length < 2) continue;
    twoColumn += 1;

    // Exactly what `buildLines` does: the gutter first, left edges as backup.
    const gutters = detectBandCuts(items, viewport.width, body);
    const cuts = gutters.length ? gutters : detectColumnStarts(items, body);
    if (!cuts.length) {
      missed += 1;
      fused += pageWords;
      bad.push(n);
    } else if (!gutters.length) {
      rescued += 1;
      rescuedWords += pageWords;
    }
  }

  await doc.destroy();
  corpusWords += words;
  corpusFused += fused;

  const pct = words ? Math.round((fused / words) * 100) : 0;
  corpusRescued += rescuedWords;
  console.log(
    `${file.replace(/\.pdf$/i, "").slice(0, 42).padEnd(42)} ` +
      `two-col ${String(twoColumn).padStart(3)}p  rescued by left edges ${String(rescued).padStart(3)}p ` +
      `(~${String(rescuedWords).padStart(5)}w)  still interleaved ${String(missed).padStart(2)}p (${pct}%)`
  );
  if (verbose && bad.length) console.log(`      pages: ${bad.join(", ")}`);
}

console.log(`\n=== columns ===`);
console.log(
  `  rescued by left-edge clustering: ~${corpusRescued.toLocaleString()} words`
);
console.log(
  `  not rescued: ~${corpusFused.toLocaleString()} of ` +
    `${corpusWords.toLocaleString()} words ` +
    `(${Math.round((corpusFused / corpusWords) * 100)}%)`
);
console.log(
  `
  "Not rescued" is NOT a defect count. This report's two-column test is
` +
    `  looser than the parser's on purpose — it has to be, to see failures the
` +
    `  parser cannot — so it also flags single-column pages whose numbered
` +
    `  clauses indent the body. ICH E6 is entirely of that shape ("1.1" at
` +
    `  x=72, its text at x=112); the parser declines every one of them and that
` +
    `  document is byte-identical before and after. Read "rescued" as the
` +
    `  result, and this line as an upper bound on what may remain.`
);

/**
 * Offline report for the deterministic comprehension checks.
 *
 * Compiles the same modules the app imports and runs them over a real corpus,
 * so the hit rate and the failure modes of grid questions and cloze checks are
 * measured rather than assumed. Nothing here re-implements the logic: if this
 * report and the app ever disagree, one of them is importing the wrong file.
 *
 *   node scripts/scan-checks.mjs "C:/path/to/corpus" [--verbose]
 *
 * Grids are read straight from PDF glyphs through tables.ts. Prose is read from
 * any .md in the folder through parse.ts, then walked in the same fixed-size
 * token windows the reading engine uses to fire a cloze check.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const dir = process.argv[2];
const verbose = process.argv.includes("--verbose");
if (!dir) {
  console.error("usage: node scripts/scan-checks.mjs <folder> [--verbose]");
  process.exit(1);
}

/** Must match CLOZE_INTERVAL_TOKENS in the store. */
const CLOZE_INTERVAL_TOKENS = 250;
/** Must match MAX_GRID_ATTEMPTS in the store. */
const MAX_GRID_ATTEMPTS = 2;
/** Must match FLATTEN_MIN_CONFIDENCE / FLATTEN_MIN_STEPS in tables.ts. */
const MIN_CONFIDENCE = 0.75;
const MIN_STEPS = 3;

const out = mkdtempSync(join(tmpdir(), "fp-checks-"));
execFileSync(
  process.execPath,
  [
    resolve("node_modules/typescript/bin/tsc"),
    "src/lib/quiz.ts",
    "src/lib/parse.ts",
    "src/lib/tables.ts",
    "--outDir", out,
    // CommonJS, not ESM: these modules import each other without file
    // extensions, which Node's ESM resolver rejects outright.
    "--module", "commonjs",
    "--target", "es2020",
    "--moduleResolution", "node",
    "--skipLibCheck",
  ],
  { stdio: "inherit" }
);

// tsc infers src/lib as the root, so the emitted files sit flat in outDir.
const load = createRequire(import.meta.url);
const { buildGridQuestion, buildCloze, answerMatches, BLANK } = load(join(out, "quiz.js"));
const { parseDocument } = load(join(out, "parse.js"));
const { detectTablesOnPage, toGrid, flattenGrid } = load(join(out, "tables.js"));

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const files = readdirSync(dir);

/* ---- Grids -------------------------------------------------------- */

let grids = 0;
let questioned = 0;
const skipReasons = { noUsableStep: 0, tooFewDistractors: 0 };
const optionCounts = new Map();
let ambiguousAnswer = 0;
let repeatedCell = 0;

for (const file of files.filter((f) => f.toLowerCase().endsWith(".pdf"))) {
  const data = new Uint8Array(readFileSync(join(dir, file)));
  const doc = await pdfjs.getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  let perFile = 0;
  let perFileQ = 0;

  for (let n = 1; n <= doc.numPages; n++) {
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

    for (const table of detectTablesOnPage(glyphs, n)) {
      if (table.confidence < MIN_CONFIDENCE) continue;
      const grid = toGrid(table);
      const steps = flattenGrid(grid);
      if (steps.length < MIN_STEPS) continue;

      grids += 1;
      perFile += 1;

      // The shape the parser hands to the app for a `table` block.
      const block = { i: grids, kind: "table", grid, steps, chunks: [], text: "" };

      const asked = [];
      for (let attempt = 0; attempt < MAX_GRID_ATTEMPTS; attempt++) {
        const q = buildGridQuestion(block, attempt);
        if (!q) break;
        asked.push(q);

        optionCounts.set(q.options.length, (optionCounts.get(q.options.length) ?? 0) + 1);

        // The answer must appear exactly once among the options, or the check
        // marks a right answer wrong.
        if (q.options.filter((o) => o === q.answer).length !== 1) ambiguousAnswer += 1;
      }

      if (!asked.length) {
        // Distinguish the two ways a grid can be unquestionable.
        const anyStep = steps.some(
          (s) => s.value.trim() && (s.column.trim() || true)
        );
        if (anyStep) skipReasons.tooFewDistractors += 1;
        else skipReasons.noUsableStep += 1;
        continue;
      }

      questioned += 1;
      perFileQ += 1;

      // A replay must not re-ask the identical cell, or the second attempt is
      // a memory test on the answer rather than on the grid.
      if (asked.length > 1 && asked[0].stepIndex === asked[1].stepIndex) {
        repeatedCell += 1;
        if (verbose) {
          console.log(`   ! ${file} p${table.page}: replay re-asked the same cell`);
        }
      }

      if (verbose && asked[0]) {
        const q = asked[0];
        console.log(
          `   ${file} p${table.page}: “${q.row}” / “${q.column || "—"}” = “${q.answer}” ` +
            `(${q.options.length} options)`
        );
      }
    }
  }

  if (perFile) console.log(`${file}: ${perFileQ}/${perFile} grids questionable`);
}

/* ---- Cloze -------------------------------------------------------- */

let windows = 0;
let checks = 0;
let blanksTotal = 0;
let leaked = 0;
let selfReject = 0;
let sharedCarrier = 0;
const byKind = { acronym: 0, numeric: 0, capitalized: 0 };

for (const file of files.filter((f) => f.toLowerCase().endsWith(".md"))) {
  const source = readFileSync(join(dir, file), "utf8");
  const doc = parseDocument(source, file);

  let fileChecks = 0;
  for (let from = 0; from + CLOZE_INTERVAL_TOKENS <= doc.tokens.length; from += CLOZE_INTERVAL_TOKENS) {
    windows += 1;
    const cloze = buildCloze(doc, from, from + CLOZE_INTERVAL_TOKENS);
    if (!cloze) continue;

    checks += 1;
    fileChecks += 1;
    blanksTotal += cloze.blanks.length;

    // One blank per sentence. Two cut from the same carrier print that sentence
    // twice with different holes, and each copy then shows the other's answer
    // in full — a leak the per-blank check below cannot see, because it only
    // ever looks at one blank at a time.
    const carriers = new Set(cloze.blanks.map((b) => doc.tokens[b.tokenIndex].chunk));
    if (carriers.size !== cloze.blanks.length) sharedCarrier += 1;

    for (const blank of cloze.blanks) {
      // The blank must not be readable off its own carrier.
      if (blank.carrier.includes(blank.answer)) leaked += 1;
      // And the carrier must actually carry a blank.
      if (!blank.carrier.includes(BLANK)) selfReject += 1;

      if (blank.acronym) byKind.acronym += 1;
      else if (/\d/.test(blank.answer)) byKind.numeric += 1;
      else byKind.capitalized += 1;

      // Grading must accept the exact string it removed.
      if (!answerMatches(blank.answer, blank.answer, blank.acronym)) {
        console.log(`   ! grading rejects its own answer: “${blank.answer}”`);
      }

      if (verbose) {
        console.log(`   [${blank.answer}] ${blank.carrier.slice(0, 96)}`);
      }
    }
  }

  console.log(
    `${file}: ${doc.tokens.length.toLocaleString()} words, ${fileChecks} cloze checks`
  );
}

/* ---- Report ------------------------------------------------------- */

console.log(`\n=== grids ===`);
console.log(`  detected (>= ${MIN_CONFIDENCE} confidence, >= ${MIN_STEPS} steps): ${grids}`);
console.log(`  yielded a question: ${questioned}`);
console.log(`  skipped, too few distinct values: ${skipReasons.tooFewDistractors}`);
console.log(`  skipped, no unambiguous cell: ${skipReasons.noUsableStep}`);
console.log(
  `  option counts: ${[...optionCounts.entries()].sort().map(([k, v]) => `${k}→${v}`).join("  ")}`
);
console.log(`  answer duplicated among options: ${ambiguousAnswer}   (must be 0)`);
console.log(`  replay re-asked the same cell: ${repeatedCell}   (must be 0)`);

console.log(`\n=== cloze ===`);
console.log(`  windows walked: ${windows}`);
console.log(
  `  produced a check: ${checks}` +
    (windows ? `  (${Math.round((checks / windows) * 100)}%)` : "")
);
console.log(`  blanks per check: ${checks ? (blanksTotal / checks).toFixed(2) : "—"}`);
console.log(
  `  by kind — acronym ${byKind.acronym}, numeric ${byKind.numeric}, capitalized ${byKind.capitalized}`
);
console.log(`  answer visible in its own carrier: ${leaked}   (must be 0)`);
console.log(`  carrier missing its blank: ${selfReject}   (must be 0)`);
console.log(`  two blanks sharing one carrier: ${sharedCarrier}   (must be 0)`);

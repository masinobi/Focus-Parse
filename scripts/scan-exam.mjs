/**
 * Offline report for the mock exam.
 *
 * An exam is only worth sitting if the paper it produces is a fair draw on the
 * real corpus, so this builds one the same way the app does — the same
 * `collectQuestions` and `assembleExam` — over a folder of PDFs and markdown,
 * and reports what came out.
 *
 *   node scripts/scan-exam.mjs "C:/path/to/corpus" [--verbose]
 *
 * The must-be-zero lines are the ways a paper can be quietly unfair: a question
 * whose answer is not among its own options cannot be answered correctly at
 * all, and a duplicate asks one fact twice while a document goes unexamined.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const dir = process.argv[2];
const verbose = process.argv.includes("--verbose");
if (!dir) {
  console.error("usage: node scripts/scan-exam.mjs <folder> [--verbose]");
  process.exit(1);
}

const out = mkdtempSync(join(tmpdir(), "fp-exam-"));
execFileSync(
  process.execPath,
  [
    resolve("node_modules/typescript/bin/tsc"),
    "src/lib/exam.ts",
    "src/lib/parse.ts",
    "src/lib/pdf.ts",
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
const { collectQuestions, assembleExam, scoreExam } = load(join(out, "exam.js"));
const { parseDocument } = load(join(out, "parse.js"));
const { assemble, isBoldFont } = load(join(out, "pdf.js"));
const { answerMatches, isStructuralReference } = load(join(out, "quiz.js"));

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const files = readdirSync(dir).filter((f) => /\.(pdf|md)$/i.test(f));

async function pagesOf(path) {
  const data = new Uint8Array(readFileSync(path));
  const doc = await pdfjs.getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const styles = content.styles ?? {};

    const items = [];
    for (const raw of content.items) {
      if (!("str" in raw) || !raw.str.trim()) continue;
      const size = Math.abs(raw.transform[3]) || Math.abs(raw.transform[0]) || 10;
      const x = raw.transform[4];
      const family = styles[raw.fontName]?.fontFamily ?? "unknown";
      items.push({
        str: raw.str,
        x,
        xEnd: x + (raw.width ?? 0),
        y: raw.transform[5],
        size,
        family,
        bold: isBoldFont(family),
      });
    }

    pages.push({ items, width: viewport.width, height: viewport.height });
    page.cleanup();
  }

  await doc.destroy();
  return pages;
}

const seed = "exam:scan";
const pools = [];

for (const file of files) {
  const path = join(dir, file);
  const source = /\.pdf$/i.test(file)
    ? assemble(await pagesOf(path))
    : readFileSync(path, "utf8");
  if (!source.trim()) {
    console.log(`${file}: no text layer`);
    continue;
  }

  const doc = parseDocument(source, file);
  const pool = collectQuestions(doc, seed);
  pools.push(pool);
  console.log(
    `${file}: ${pool.acronym.length} acronym, ${pool.cloze.length} cloze, ` +
      `${pool.grid.length} grid`
  );
}

/* ---- The paper ---------------------------------------------------- */

const COUNT = 40;
const paper = assembleExam(pools, COUNT, seed);

const byKind = {};
const byDoc = {};
let answerNotInOptions = 0;
let selfReject = 0;
let emptyPrompt = 0;
let structuralReference = 0;

const seen = new Set();
let duplicates = 0;

for (const q of paper) {
  byKind[q.kind] = (byKind[q.kind] ?? 0) + 1;
  byDoc[q.docTitle] = (byDoc[q.docTitle] ?? 0) + 1;

  const meaning =
    q.kind === "acronym"
      ? `acr:${q.acronym}`
      : q.kind === "cloze"
        ? `cloze:${(q.acronym ?? q.answer).toLowerCase()}`
        : `grid:${q.id}`;
  if (seen.has(meaning)) duplicates += 1;
  seen.add(meaning);

  if (q.kind === "cloze") {
    // The marker must accept the exact string the builder removed.
    if (!answerMatches(q.answer, q.answer, q.acronym)) selfReject += 1;
    if (!q.carrier.trim()) emptyPrompt += 1;
    // "Section ____ states that…" is a navigation question, not a knowledge one.
    if (isStructuralReference(q.carrier, q.answer)) structuralReference += 1;
  } else {
    if (q.options.filter((o) => o === q.answer).length !== 1) answerNotInOptions += 1;
    if (!q.prompt.trim()) emptyPrompt += 1;
  }

  if (verbose) {
    console.log(
      `   [${q.kind}] ${(q.kind === "cloze" ? q.carrier : q.prompt).slice(0, 88)}`
    );
  }
}

// A perfect paper and a blank one, to prove the marker moves at all.
const allRight = new Map(
  paper.map((q) => [q.id, { questionId: q.id, given: q.answer, correct: true }])
);
const allWrong = new Map(
  paper.map((q) => [q.id, { questionId: q.id, given: "", correct: false }])
);
const best = scoreExam(paper, allRight, 60);
const worst = scoreExam(paper, allWrong, 60);

console.log(`\n=== paper ===`);
console.log(`  documents offering questions: ${pools.length}`);
console.log(`  asked for: ${COUNT}, assembled: ${paper.length}`);
console.log(
  `  by kind: ${Object.entries(byKind).map(([k, v]) => `${k} ${v}`).join(", ")}`
);
console.log(
  `  by document: ${Object.entries(byDoc)
    .map(([k, v]) => `${k.replace(/\.(pdf|md)$/i, "").slice(0, 28)} ${v}`)
    .join(" · ")}`
);
console.log(`  documents represented: ${Object.keys(byDoc).length} of ${pools.length}`);
console.log(`  answer missing from its own options: ${answerNotInOptions}   (must be 0)`);
console.log(`  marker rejects its own answer: ${selfReject}   (must be 0)`);
console.log(`  question with no prompt: ${emptyPrompt}   (must be 0)`);
console.log(`  one fact asked twice: ${duplicates}   (must be 0)`);
console.log(`  blank asking for a cross-reference: ${structuralReference}   (must be 0)`);
console.log(`  a perfect paper scores: ${best.correct}/${best.total}   (must be ${paper.length})`);
console.log(`  a blank paper scores: ${worst.correct}/${worst.total}   (must be 0)`);
console.log(
  `  worst breakdown row: ${worst.byDocument[0]?.label.slice(0, 30) ?? "—"}, ` +
    `best paper's worst row: ${best.byDocument[0]?.label.slice(0, 30) ?? "—"}`
);

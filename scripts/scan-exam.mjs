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
    "src/lib/review.ts",
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
const { collectQuestions, assembleExam, assembleDrill, collectAcronyms, scoreExam } =
  load(join(out, "exam.js"));
const { ACRONYMS } = load(join(out, "acronyms.js"));
const { termKey } = load(join(out, "review.js"));
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
const drillPools = [];
/** Every acronym any document actually uses, counted from the tokens. */
const usedInCorpus = new Set();

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
  drillPools.push(collectAcronyms(doc, seed));

  // Ground truth for the drill, taken from the token stream rather than from
  // anything the question builders produced. Comparing the drill against a
  // count derived from the same capped pools would be a check that cannot
  // fail — which is how the 12-per-document cap went unnoticed in the first
  // place.
  for (const token of doc.tokens) {
    if (token.acronym && ACRONYMS[token.acronym]) usedInCorpus.add(token.acronym);
  }
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

/* ---- The acronym drill --------------------------------------------- */

/*
 * A drill is the whole vocabulary rather than a sample of it, so the numbers
 * that matter are different from the paper's: not "is this a fair draw" but
 * "is anything missing, and is anything asked twice".
 *
 * The ordering check is the one worth reading. Weak-first is a control, and a
 * control that never displaces anything is wired to nothing — the same failure
 * `scan-checks` found in the cloze weighting. So the drill is assembled twice,
 * once with an empty weak map and once with a synthetic one, and the report
 * says how far the stuck terms actually moved.
 */
const drill = assembleDrill(drillPools, {}, seed);

const drillSeen = new Set();
let drillDuplicates = 0;
let drillAnswerNotInOptions = 0;
let drillUnknown = 0;

for (const q of drill) {
  if (drillSeen.has(q.acronym)) drillDuplicates += 1;
  drillSeen.add(q.acronym);
  if (q.options.filter((o) => o === q.answer).length !== 1) drillAnswerNotInOptions += 1;
  if (!usedInCorpus.has(q.acronym)) drillUnknown += 1;
}

// A term used by a document and never drilled is the one the reader meets on
// the day. `expansionOf` can refuse an entry with no expansion and the
// distractor pool can come up short, so this is reported rather than asserted
// to zero — but it must be read, not skipped.
const undrilled = [...usedInCorpus].filter((a) => !drillSeen.has(a));

// Three terms marked as fully stuck, drawn from the back half of the unweighted
// order so that leaving them where they are would be visible as a zero.
const tail = drill.slice(Math.floor(drill.length / 2));
const stuck = [tail[0], tail[Math.floor(tail.length / 2)], tail[tail.length - 1]].filter(
  Boolean
);
const weak = {};
for (const q of stuck) {
  weak[termKey(q.answer, q.acronym)] = {
    key: termKey(q.answer, q.acronym),
    weight: 1,
    lapses: 3,
  };
}

const weighted = assembleDrill(drillPools, weak, seed);
const positionIn = (list, acronym) => list.findIndex((q) => q.acronym === acronym);
const promoted = stuck.filter(
  (q) => positionIn(weighted, q.acronym) < positionIn(drill, q.acronym)
).length;
const atFront = stuck.filter((q) => positionIn(weighted, q.acronym) < stuck.length).length;

// Reordering must not lose or invent a question.
const sameSet =
  weighted.length === drill.length &&
  new Set(weighted.map((q) => q.acronym)).size === drillSeen.size;

console.log(`
=== acronym drill ===`);
console.log(`  acronyms the corpus uses, counted from the tokens: ${usedInCorpus.size}`);
console.log(`  drilled: ${drill.length}`);
console.log(
  `  used but never drilled: ${undrilled.length}` +
    (undrilled.length ? `   (${undrilled.join(", ")})` : "   (must be 0)")
);
console.log(`  asked twice: ${drillDuplicates}   (must be 0)`);
console.log(`  answer missing from its own options: ${drillAnswerNotInOptions}   (must be 0)`);
console.log(`  drilled but used by no document: ${drillUnknown}   (must be 0)`);
console.log(
  `  stuck terms moved forward: ${promoted} of ${stuck.length}   (must be ${stuck.length})`
);
console.log(
  `  stuck terms now in the opening ${stuck.length}: ${atFront} of ${stuck.length}   (must be ${stuck.length})`
);
console.log(`  weighting kept the same set: ${sameSet}   (must be true)`);

if (verbose) {
  console.log(
    `  unweighted opening: ${drill.slice(0, 8).map((q) => q.acronym).join(", ")}`
  );
  console.log(
    `  with three stuck:   ${weighted.slice(0, 8).map((q) => q.acronym).join(", ")}`
  );
}

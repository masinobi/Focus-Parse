/**
 * Offline report for the cross-document entity index.
 *
 * The index exists to make nine PDFs behave as one corpus, so it can only be
 * judged against the real nine. This compiles the same modules the app imports
 * — `pdf.ts` for assembly, `parse.ts` for the token stream, `entities.ts` for
 * extraction and the merge — and runs them over a folder of PDFs and markdown.
 *
 *   node scripts/scan-entities.mjs "C:/path/to/corpus" [--verbose]
 *
 * `extractPdf` itself cannot run here: it loads the pdf.js worker from a URL
 * and is browser-only. Everything after the glyphs come out of pdf.js is pure,
 * which is why `assemble` is exported — the report and the app share it rather
 * than drifting apart.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const dir = process.argv[2];
const verbose = process.argv.includes("--verbose");
if (!dir) {
  console.error("usage: node scripts/scan-entities.mjs <folder> [--verbose]");
  process.exit(1);
}

const out = mkdtempSync(join(tmpdir(), "fp-entities-"));
execFileSync(
  process.execPath,
  [
    resolve("node_modules/typescript/bin/tsc"),
    "src/lib/entities.ts",
    "src/lib/parse.ts",
    "src/lib/pdf.ts",
    "src/lib/tables.ts",
    "--outDir", out,
    // CommonJS for the same reason as scan-checks: these modules import each
    // other without file extensions, which Node's ESM resolver rejects.
    "--module", "commonjs",
    "--target", "es2020",
    "--moduleResolution", "node",
    "--skipLibCheck",
  ],
  { stdio: "inherit" }
);

const load = createRequire(import.meta.url);
const { buildEntityIndex, mergeEntityIndexes } = load(join(out, "entities.js"));
const { parseDocument } = load(join(out, "parse.js"));
const { assemble, isBoldFont } = load(join(out, "pdf.js"));

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const files = readdirSync(dir).filter((f) => /\.(pdf|md)$/i.test(f));

/** Read one PDF into the shape `assemble` expects. */
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

const indexes = [];
let badFirst = 0;
let emptyDisplay = 0;
let underThreshold = 0;
let fromFurniture = 0;
let furnitureWords = 0;
let contentWords = 0;

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
  const index = buildEntityIndex(doc);
  indexes.push(index);

  for (const section of doc.sections) {
    if (section.furniture) furnitureWords += section.wordCount;
    else contentWords += section.wordCount;
  }

  for (const entry of index.entries) {
    // An author list is nothing but capitalized names. Indexing one fills the
    // corpus view with people instead of terms.
    if (doc.sections[doc.tokens[entry.first]?.section]?.furniture) fromFurniture += 1;
    // "Open it here" is a token index into this document. Out of range is a
    // dead link, and a dead link in a nine-document index is invisible.
    if (!(entry.first >= 0 && entry.first < doc.tokens.length)) badFirst += 1;
    if (!entry.display.trim() || entry.display !== entry.display.trim()) emptyDisplay += 1;
    if (entry.kind === "term" && entry.count < 2) underThreshold += 1;
  }

  const acronyms = index.entries.filter((e) => e.kind === "acronym").length;
  console.log(
    `${file}: ${doc.tokens.length.toLocaleString()} words, ` +
      `${index.entries.length} entries (${acronyms} acronyms)` +
      (index.truncated ? `, ${index.truncated} dropped by the cap` : "")
  );
}

/* ---- Merge -------------------------------------------------------- */

const corpus = mergeEntityIndexes(indexes);
const shared = corpus.filter((e) => e.docs.length >= 2);
const wide = corpus.filter((e) => e.docs.length >= 3);

// A merged entity naming the same document twice would double-count it and
// print the same chip twice in the UI.
let duplicatedDoc = 0;
for (const entity of corpus) {
  const ids = new Set(entity.docs.map((d) => d.docId));
  if (ids.size !== entity.docs.length) duplicatedDoc += 1;
}

console.log(`\n=== corpus ===`);
console.log(`  documents indexed: ${indexes.length}`);
console.log(`  distinct entities: ${corpus.length.toLocaleString()}`);
console.log(
  `  in 2+ documents: ${shared.length.toLocaleString()}` +
    (corpus.length ? `  (${Math.round((shared.length / corpus.length) * 100)}%)` : "")
);
console.log(`  in 3+ documents: ${wide.length.toLocaleString()}`);
console.log(
  `  acronyms: ${corpus.filter((e) => e.kind === "acronym").length}` +
    `, phrases: ${corpus.filter((e) => e.kind === "term").length}`
);
console.log(
  `  journal furniture: ${furnitureWords.toLocaleString()} words of ` +
    `${(furnitureWords + contentWords).toLocaleString()} ` +
    `(${Math.round((furnitureWords / (furnitureWords + contentWords)) * 1000) / 10}%), skipped`
);
console.log(`  entity indexed out of furniture: ${fromFurniture}   (must be 0)`);
console.log(`  entry pointing outside its document: ${badFirst}   (must be 0)`);
console.log(`  entry with an empty or padded display form: ${emptyDisplay}   (must be 0)`);
console.log(`  phrase kept below the occurrence floor: ${underThreshold}   (must be 0)`);
console.log(`  merged entity listing one document twice: ${duplicatedDoc}   (must be 0)`);
console.log(`  entities spanning documents: ${shared.length}   (must be > 0)`);

const top = (verbose ? shared : shared.slice(0, 25));
if (top.length) {
  console.log(`\n=== most widely shared ===`);
  for (const entity of top) {
    console.log(
      `  ${entity.display.padEnd(38)} ${String(entity.docs.length).padStart(2)} docs  ` +
        `${String(entity.total).padStart(5)}x   ${entity.docs
          .map((d) => d.docTitle.replace(/\.(pdf|md)$/i, ""))
          .join(" · ")
          .slice(0, 90)}`
    );
  }
}

/**
 * Offline report for the cross-guideline phrase comparison.
 *
 * The panel quotes a carrier sentence and marks the phrase inside it, and both
 * halves of that come from different modules: `parse.ts` decides where a token
 * sits inside its chunk, `compare.ts` decides which tokens matched. Nothing in
 * either file can notice the two disagreeing. This runs them over the real
 * corpus and slices every quotation at the offsets the panel would use.
 *
 *   node scripts/scan-compare.mjs "C:/path/to/corpus" [--verbose]
 *
 * Same compile-and-drive arrangement as `scan-entities`: the report imports the
 * app's own modules so the two cannot drift.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const dir = process.argv[2];
const verbose = process.argv.includes("--verbose");
if (!dir) {
  console.error("usage: node scripts/scan-compare.mjs <folder> [--verbose]");
  process.exit(1);
}

const out = mkdtempSync(join(tmpdir(), "fp-compare-"));
execFileSync(
  process.execPath,
  [
    resolve("node_modules/typescript/bin/tsc"),
    "src/lib/compare.ts",
    "src/lib/entities.ts",
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
const { comparePhrase, finalForms, phraseWords, SITES_PER_DOC } = load(
  join(out, "compare.js")
);
const { buildEntityIndex } = load(join(out, "entities.js"));
const { parseDocument } = load(join(out, "parse.js"));
const { assemble, isBoldFont } = load(join(out, "pdf.js"));

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const files = readdirSync(dir).filter((f) => /\.(pdf|md)$/i.test(f));

/**
 * The phrases this corpus is actually studied for.
 *
 * Chosen from the exam's own language — the operational processes a
 * certification asks you to tell apart between guidelines — not from what the
 * parser happens to find. That is the whole point of the list: it is the
 * question put to the corpus, rather than the corpus's answer read back.
 */
const PROBES = [
  "audit trail",
  "protocol deviation",
  "source data verification",
  "database lock",
  "serious adverse event",
  "electronic record",
  "informed consent",
  "data management plan",
  "risk management",
  "query management",
  "case report form",
  "quality tolerance limit",
];

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

const docs = [];
const indexed = new Map();

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
  docs.push(doc);
  indexed.set(
    doc.id,
    new Set(buildEntityIndex(doc).entries.map((e) => e.display.toLowerCase()))
  );
}

let badToken = 0;
let emptyCarrier = 0;
let misquoted = 0;
let unmarked = 0;
let fromFurniture = 0;
let overCap = 0;
let underCount = 0;
const examples = [];

for (const phrase of PROBES) {
  const words = phraseWords(phrase);
  const accepted = finalForms(words[words.length - 1]);
  const rows = comparePhrase(docs, phrase) ?? [];

  for (const row of rows) {
    const doc = docs.find((d) => d.id === row.docId);
    if (row.sites.length > SITES_PER_DOC) overCap += 1;
    if (row.count < row.sites.length) underCount += 1;

    for (const site of row.sites) {
      if (!(site.token >= 0 && site.token < doc.tokens.length)) badToken += 1;
      if (!site.text.trim()) emptyCarrier += 1;
      if (doc.sections[site.section]?.furniture) fromFurniture += 1;

      // The headline check. `parse.ts` owns the offset of a token inside its
      // chunk and `compare.ts` owns which tokens matched; slicing one with the
      // other is the only place the two are made to agree. Getting this wrong
      // is invariant 1 exactly — reach for `speechOffset` instead of `offset`
      // and every quotation containing an expanded acronym slides sideways.
      const marked = site.text.slice(site.from, site.to).toLowerCase();
      const shape = marked.split(/\s+/);
      const tail = shape[shape.length - 1];
      if (shape.length !== words.length) misquoted += 1;
      else if (!accepted.has(tail)) misquoted += 1;
      else if (shape.slice(0, -1).join(" ") !== words.slice(0, -1).join(" ")) {
        misquoted += 1;
      }

      if (!site.text.toLowerCase().includes(words[0])) unmarked += 1;
    }
  }

  const inText = rows.length;
  const inIndex = docs.filter((d) => indexed.get(d.id).has(phrase)).length;
  examples.push({ phrase, inText, inIndex, total: rows.reduce((s, r) => s + r.count, 0) });
}

console.log(`\n=== corpus ===`);
console.log(`  documents: ${docs.length}`);
console.log(`  phrases probed: ${PROBES.length}`);
console.log(`  quotation sliced at the wrong offsets: ${misquoted}   (must be 0)`);
console.log(`  quotation not containing its own phrase: ${unmarked}   (must be 0)`);
console.log(`  site drawn from journal furniture: ${fromFurniture}   (must be 0)`);
console.log(`  document over the per-document cap: ${overCap}   (must be 0)`);

/**
 * Below the line: three guards that cannot presently go red.
 *
 * `site.token` is the loop counter and the loop is bounded by the token array;
 * `count` increments before any push, so it can never trail `sites.length`; and
 * a token's chunk index always resolves. Each was written as a must-be-zero and
 * each was found, by breaking `compare.ts` on purpose, to be restating its own
 * implementation rather than checking it — the same mistake as last round's
 * "documents that open by reading their own cover".
 *
 * Kept because they stop being tautologies the moment any of those three facts
 * changes, and printed apart because a green that cannot go red must not be
 * counted alongside greens that can.
 */
console.log(`\n  structural, cannot currently fail:`);
console.log(`    site pointing outside its document: ${badToken}`);
console.log(`    site with an empty carrier sentence: ${emptyCarrier}`);
console.log(`    document reporting fewer than it kept: ${underCount}`);

/**
 * The measurement this feature was redesigned around, kept where it can be
 * re-run rather than quoted from a commit message. Not an assertion: what the
 * entity index does and does not carry is a property of the corpus, and a
 * threshold on it would go red the day someone loads a document that happens
 * to capitalize a heading.
 */
console.log(`\n=== what the entity index would have found ===`);
console.log(`  phrase                          docs   indexed`);
for (const e of examples) {
  console.log(
    `  ${e.phrase.padEnd(30)} ${String(e.inText).padStart(4)} ` +
      `${String(e.inIndex).padStart(9)}` +
      (e.inText > e.inIndex ? `   <- ${e.inText - e.inIndex} missed by the index` : "")
  );
}

const served = examples.filter((e) => e.inText >= 2).length;
console.log(
  `\n  probes comparable across 2+ documents: ${served} of ${PROBES.length}   (must be > 0)`
);

if (verbose) {
  console.log(`\n=== quotations ===`);
  for (const phrase of PROBES) {
    const rows = comparePhrase(docs, phrase) ?? [];
    if (!rows.length) continue;
    console.log(`\n  ${phrase} — ${rows.length} documents`);
    for (const row of rows) {
      const site = row.sites[0];
      console.log(`    ${row.docTitle.replace(/\.(pdf|md)$/i, "").slice(0, 46)}`);
      console.log(`      § ${site.sectionTitle.slice(0, 60)}`);
      console.log(`      ${site.text.slice(0, 150)}`);
    }
  }
}

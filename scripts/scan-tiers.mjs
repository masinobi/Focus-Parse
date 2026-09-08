/**
 * Offline report for GCDMP tier tagging.
 *
 *   node scripts/scan-tiers.mjs "C:/path/to/corpus" [--verbose]
 *
 * Two questions, and they fail in opposite directions.
 *
 *   - **Nothing goes untagged and unruled-on.** Any section title mentioning a
 *     tier that `tierOf` did not tag must be listed in `EXCLUDED_TIERS` with a
 *     reason. A new document arriving with a fifth spelling has to be
 *     adjudicated rather than silently dropped, which is the same alarm
 *     `scan-blueprint` runs over chapter names and for the same reason: the
 *     failure is invisible from the reader's side, because an untagged section
 *     looks exactly like a section that is not a tier.
 *   - **Nothing is tagged that was ruled out.** The two tables must stay
 *     disjoint on the real corpus, not merely in a unit fixture.
 *
 * And the control, which is not an assertion but the reason this module reads
 * headings at all: the modal-verb rule is scored against the headings and its
 * disagreement printed. If that number ever comes out small, the argument in
 * `tiers.ts` is wrong and this file is how anyone would find out.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const dir = process.argv[2];
const verbose = process.argv.includes("--verbose");
if (!dir) {
  console.error("usage: node scripts/scan-tiers.mjs <folder> [--verbose]");
  process.exit(1);
}

const out = mkdtempSync(join(tmpdir(), "fp-tiers-"));
execFileSync(
  process.execPath,
  [
    resolve("node_modules/typescript/bin/tsc"),
    "src/lib/tiers.ts",
    "src/lib/parse.ts",
    "src/lib/md-tables.ts",
    "src/lib/tables.ts",
    "src/lib/pdf.ts",
    "--outDir", out,
    "--module", "commonjs",
    "--target", "es2020",
    "--moduleResolution", "node",
    "--skipLibCheck",
  ],
  { stdio: "inherit" }
);

const load = createRequire(import.meta.url);
const emitted = (name) => load(join(out, `${name}.js`));

const { tierOf, isExcludedTier, mentionsTier, EXCLUDED_TIERS } = emitted("tiers");
const { parseDocument } = emitted("parse");
const { assemble, isBoldFont } = emitted("pdf");

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

async function pagesOf(path) {
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(readFileSync(path)),
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

/** Words the keyword rule would key on, counted inside a section. */
const BS = String.fromCharCode(92);
const countWord = (text, word) =>
  (text.match(new RegExp(BS + "b" + word + BS + "b", "g")) || []).length;

let sections = 0;
let minimum = 0;
let best = 0;
let minimumWords = 0;
let bestWords = 0;

const unadjudicated = [];
const taggedAndExcluded = [];

/** How the modal-verb rule would have scored the sections the headings tag. */
const modal = {
  minimumWithNoRequirement: 0,
  minimumShoulds: 0,
  bestShoulds: 0,
  corpusShoulds: 0,
  corpusMusts: 0,
  corpusShalls: 0,
};

const rows = [];

for (const file of readdirSync(dir).filter((f) => /\.(pdf|md)$/i.test(f))) {
  const path = join(dir, file);
  const source = /\.pdf$/i.test(file)
    ? assemble(await pagesOf(path))
    : readFileSync(path, "utf8");
  if (!source.trim()) {
    console.log(`${file}: no text layer`);
    continue;
  }

  const doc = parseDocument(source, file);
  let docMin = 0;
  let docBest = 0;

  const textOf = (section) =>
    doc.chunks
      .filter((c) => c.section === section.i)
      .map((c) => c.text)
      .join(" ")
      .toLowerCase();

  for (const section of doc.sections) {
    sections += 1;
    const title = section.baseTitle ?? section.title;
    const tier = section.tier ?? null;

    if (tier === "minimum") {
      minimum += 1;
      docMin += 1;
      minimumWords += section.wordCount;
    }
    if (tier === "best") {
      best += 1;
      docBest += 1;
      bestWords += section.wordCount;
    }

    // The alarm. A title that names a tier is either tagged or ruled on.
    if (!tier && mentionsTier(title) && !isExcludedTier(title)) {
      unadjudicated.push(`${file}: ${JSON.stringify(title)}`);
    }
    if (tier && isExcludedTier(title)) {
      taggedAndExcluded.push(`${file}: ${JSON.stringify(title)}`);
    }

    if (!tier) continue;
    const text = textOf(section);
    const shoulds = countWord(text, "should");
    if (tier === "minimum") {
      modal.minimumShoulds += shoulds;
      if (countWord(text, "must") + countWord(text, "shall") === 0) {
        modal.minimumWithNoRequirement += 1;
      }
    } else {
      modal.bestShoulds += shoulds;
    }
  }

  const all = doc.chunks.map((c) => c.text).join(" ").toLowerCase();
  modal.corpusShoulds += countWord(all, "should");
  modal.corpusMusts += countWord(all, "must");
  modal.corpusShalls += countWord(all, "shall");

  rows.push({ file, min: docMin, best: docBest, sections: doc.sections.length });
}

console.log(`\n=== tiers ===`);
for (const r of rows) {
  console.log(
    `  ${r.file.replace(/\.(pdf|md)$/i, "").slice(0, 44).padEnd(44)} ` +
      `sections ${String(r.sections).padStart(4)}  ` +
      `minimum ${String(r.min).padStart(3)}  best ${String(r.best).padStart(3)}`
  );
}

console.log(`
  sections read: ${sections}
  tagged minimum standard: ${minimum}  (${minimumWords.toLocaleString()} words)
  tagged best practice:    ${best}  (${bestWords.toLocaleString()} words)
  titles naming a tier, neither tagged nor adjudicated: ${unadjudicated.length}   (must be 0)
  titles both tagged and ruled out: ${taggedAndExcluded.length}   (must be 0)
  adjudicated near misses on the list: ${Object.keys(EXCLUDED_TIERS).length}`);

for (const line of unadjudicated) console.log(`    ! ${line}`);
for (const line of taggedAndExcluded) console.log(`    ! ${line}`);

console.log(`
  --- what the modal-verb rule would have done ---
  corpus-wide: should ${modal.corpusShoulds} · must ${modal.corpusMusts} · shall ${modal.corpusShalls}
  "should" inside a Minimum Standards section: ${modal.minimumShoulds}
  "should" inside a Best Practices section:    ${modal.bestShoulds}
  Minimum Standards sections containing no "must" and no "shall": ${modal.minimumWithNoRequirement} of ${minimum}

  Read that last line as the argument for reading the heading. Those sections
  are mandatory and say so nowhere in their verbs; a rule keyed on "shall" and
  "must" tags them a recommendation, which is the exact confusion the tier
  badge exists to prevent. If this number is ever near zero, tiers.ts is
  wrong and should be rewritten to read the prose.`);

if (verbose) {
  console.log(`\n  --- adjudicated ---`);
  for (const [key, why] of Object.entries(EXCLUDED_TIERS)) {
    console.log(`  ${key}\n      ${why}`);
  }
}

if (unadjudicated.length || taggedAndExcluded.length) process.exit(1);

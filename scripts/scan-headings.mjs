/**
 * Offline report for heading recovery, and for the wrapped-heading join.
 *
 * A heading broken across two lines by the measure used to reach the document
 * as its *second* line only. The first half was not merely lost from the
 * structure map — it was demoted to prose and glued onto the end of the
 * paragraph above, where the reader heard it read out mid-sentence. So this
 * reports two different things and they are not the same number: how many
 * headings a document yields at all, and how many of them had to be rejoined.
 *
 *   node scripts/scan-headings.mjs "C:/path/to/corpus" [--verbose]
 *
 * Ground truth, established by reading the glyphs on the page: the EDC
 * implementation chapter sets "6) What it Means to Design a Study Application
 * Within an EDC System" across two lines, and before the join the structure map
 * showed it as "Within an EDC System".
 *
 * This drives the app's own `assemble`, which is exported for exactly this, so
 * the report and the parser cannot drift. `--verbose` prints every join and
 * every join the parser declined to make; the declines are the interesting
 * half, because a join is abandoned when the rejoined text stops reading as a
 * heading, and a document with many of them is a document this rule is not
 * reaching.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const dir = process.argv[2];
const verbose = process.argv.includes("--verbose");
if (!dir) {
  console.error("usage: node scripts/scan-headings.mjs <folder> [--verbose]");
  process.exit(1);
}

const out = mkdtempSync(join(tmpdir(), "fp-headings-"));
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
const { assemble, isBoldFont } = load(join(out, "pdf.js"));
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

/** Read one PDF into the shape `assemble` takes. */
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

let corpusHeadings = 0;
let corpusJoined = 0;
let corpusDeclined = 0;
/** Joins whose result does not contain both halves — a join that lost text. */
let corpusLossy = 0;
/** Joins that came out identical to one of their halves — a join that did nothing. */
let corpusInert = 0;
/** Joins made, then demoted again by the run rules, so they never became headings. */
let corpusStranded = 0;

for (const file of readdirSync(dir).filter((f) => /\.pdf$/i.test(f))) {
  const notes = { wrapped: [], declined: [] };
  const markdown = assemble(await pagesOf(join(dir, file)), notes);

  const headings = markdown.split("\n").filter((l) => /^#{1,2}\s+\S/.test(l));
  corpusHeadings += headings.length;
  corpusJoined += notes.wrapped.length;
  corpusDeclined += notes.declined.length;

  // Two things have to hold of every join, and they fail differently.
  //
  // A join must not eat text: every word of every half has to be in what came
  // out. And a join must reach the document — a heading that merges and is then
  // demoted by the run rules reads as prose, which is not a defect but is not
  // the repair either, so it is counted rather than passed over.
  const heads = new Set(headings.map((h) => h.replace(/^#{1,2}\s+/, "").trim()));
  const lossy = [];
  const stranded = [];
  for (const { parts, text } of notes.wrapped) {
    const words = parts.flatMap((p) => p.split(/\s+/).filter(Boolean));
    // The seam of a hyphenated wrap belongs to both halves, so the two words it
    // joins are checked as one.
    // Inert before lossy, and the order is load-bearing: a join that did
    // nothing is also a join with every word of the second half missing, so
    // checking for lost text first would swallow it and leave this counter
    // permanently at zero — a green that cannot go red, which reads as
    // verification and is not.
    if (parts.length < 2 || text === parts[0]) {
      corpusInert += 1;
      lossy.push(`${parts.join(" / ")}  ->  ${text}   [join did nothing]`);
      continue;
    }
    const missing = words.filter(
      (w) => !text.includes(w) && !text.includes(w.replace(/-$/, ""))
    );
    if (missing.length) {
      corpusLossy += 1;
      lossy.push(`${parts.join(" / ")}  ->  ${text}   [lost: ${missing.join(" ")}]`);
      continue;
    }
    if (!heads.has(text)) stranded.push(text);
  }
  corpusStranded += stranded.length;

  console.log(
    `${file.replace(/\.pdf$/i, "").slice(0, 42).padEnd(42)} ` +
      `headings ${String(headings.length).padStart(4)}  ` +
      `rejoined ${String(notes.wrapped.length).padStart(3)}  ` +
      `declined ${String(notes.declined.length).padStart(3)}`
  );

  if (verbose && notes.wrapped.length) {
    for (const { parts, text } of notes.wrapped) {
      console.log(`      + ${text}${heads.has(text) ? "" : "   [merged, then demoted]"}`);
      console.log(`        from: ${parts.join("  /  ")}`);
    }
  }
  if (verbose && notes.declined.length) {
    for (const entry of notes.declined) console.log(`      - ${entry}`);
  }
  if (lossy.length) {
    for (const entry of lossy) console.log(`      ! ${entry}`);
  }
}

console.log(`\n=== headings ===`);
console.log(`  recovered:                ${corpusHeadings}`);
console.log(`  rejoined from two lines:  ${corpusJoined}`);
console.log(`  joins declined:           ${corpusDeclined}  (rejoined text stopped reading as a heading)`);
console.log(`  joins that lost text:     ${corpusLossy}  (must be 0)`);
console.log(`  joins that did nothing:   ${corpusInert}  (must be 0)`);
console.log(`  merged, then demoted:     ${corpusStranded}  (whole in the prose, absent from the map)`);
console.log(
  `
  "Declined" is not a defect count. A join is abandoned when the rejoined text
  stops satisfying the caps that keep prose from being promoted to a heading,
  and leaving half a heading in the map is the better of two bad outcomes. It
  IS the number to watch: if it climbs far above the joins made, the caps are
  cutting real headings and the rule is not reaching the documents it was
  written for.

  "Merged, then demoted" is a join the run rules threw out afterwards — three
  or more contrasting lines in a row are a caption or an author block, not a
  section. Those read whole and in order as prose, which is the repair working
  even where it does not reach the map.`
);

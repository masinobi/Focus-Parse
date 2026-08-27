/**
 * Offline report for the citation index.
 *
 *   node scripts/scan-citations.mjs "C:/path/to/corpus" [--verbose]
 *
 * A citation recogniser fails in two directions and only one of them is
 * visible. Missing a citation costs the reader a cross-reference they never
 * knew was there. *Inventing* one puts a regulation in the index that the
 * document never cited, in a panel whose whole purpose is to say where a rule
 * is discussed — and it looks exactly like a real entry.
 *
 * So the asserted numbers are all about precision, and recall is reported for a
 * human to read:
 *
 *   - **Every citation's span must contain its own anchor.** The regulation is
 *     canonicalised, so `Title 21 CFR Part 11` becomes `21 CFR Part 11` and a
 *     substring check will not do; what is checked is that the matched text
 *     still carries the part number, the ICH code, or the name.
 *   - **No two citations may overlap.** The anchors nest deliberately — `Title
 *     21 CFR Part 11` contains `Part 11` — and emitting both would double every
 *     citation in the corpus.
 *   - **No provision may be prose.** A provision is digits, dots, roman
 *     numerals or a single appendix letter. Anything else means the pattern
 *     reached past the reference into the sentence.
 *   - **No citation may name a part outside the list.** `\bPart \d+\b` matches
 *     "part 1, subpart J of this chapter" forty times inside the Part 11 rule
 *     itself. What the list rejects is printed rather than swallowed, so a real
 *     FDA part that turns up in a future document is adjudicated rather than
 *     silently dropped.
 *
 * The recall side is the last section: bare `section N.N` references that no
 * citation covers. That number is *supposed* to be large — most of them are
 * genuinely ambiguous, which is the whole reason a bare section number is never
 * read as a citation — and it is printed so the decision stays visible rather
 * than becoming folklore.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const dir = process.argv[2];
const verbose = process.argv.includes("--verbose");
if (!dir) {
  console.error("usage: node scripts/scan-citations.mjs <folder> [--verbose]");
  process.exit(1);
}

const out = mkdtempSync(join(tmpdir(), "fp-cite-"));
execFileSync(
  process.execPath,
  [
    resolve("node_modules/typescript/bin/tsc"),
    "src/lib/citations.ts",
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
const emitted = (n) => load(join(out, `${n}.js`));
const { PARTS, buildCitationIndex, citationsInDocument, findCitations } =
  emitted("citations");
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

const PROVISION_OK = /^([0-9]+(\.[0-9]+)*|[IVX]{1,5}|[A-C])$/;
/** A bare section reference, for the recall report. */
const BARE = /\b(?:sections?|chapters?|appendix|annex)\.?\s*\d+(\.\d+)*/gi;
/** What a whitelisted-parts rule refuses. Printed, never swallowed. */
const ANY_PART = /\bParts?\s+(\d{1,3})\b/gi;

const allSites = [];
let malformed = 0;
let overlapping = 0;
let proseProvision = 0;
let offPart = 0;
let bare = 0;
let covered = 0;
const rejectedParts = new Map();
let files = 0;

for (const file of readdirSync(dir).filter((f) => /\.(pdf|md)$/i.test(f))) {
  const path = join(dir, file);
  const source = /\.pdf$/i.test(file)
    ? assemble(await pagesOf(path))
    : readFileSync(path, "utf8");
  if (!source.trim()) continue;

  const doc = parseDocument(source, file);
  files += 1;

  const sites = citationsInDocument({
    docId: doc.id,
    docTitle: doc.title,
    words: doc.tokens.map((t) => t.text),
    sectionOf: (i) => doc.tokens[i]?.section ?? 0,
    sectionTitle: (s) => doc.sections[s]?.title ?? "Unsectioned",
  });
  allSites.push(...sites);

  // Precision, checked against the raw text rather than the token stream, so a
  // mistake in the offset table cannot hide a mistake in the patterns.
  const flat = doc.tokens.map((t) => t.text).join(" ");
  const found = findCitations(flat);

  let at = -1;
  for (const c of found) {
    if (c.start < at) overlapping += 1;
    at = c.end;

    // Any CFR title, not just 21. The first version only looked for `21 CFR`,
    // so a correct `45 CFR Part 164` was reported as malformed -- the check was
    // wrong, not the citation.
    const part = /^\d+ CFR Part (\d+)$/.exec(c.regulation)?.[1];
    const code = /^ICH ([A-Z]\d+)/.exec(c.regulation)?.[1];
    const carries =
      (part && c.text.includes(part)) ||
      (code && new RegExp(code, "i").test(c.text)) ||
      /HIPAA|GDPR|GCP/i.test(c.text);
    if (!carries) {
      malformed += 1;
      if (verbose) console.log(`      ! "${c.text}" -> ${c.regulation}`);
    }

    if (c.provision !== null && !PROVISION_OK.test(c.provision)) {
      proseProvision += 1;
      if (verbose) console.log(`      ! provision "${c.provision}" in "${c.text}"`);
    }

    if (part && !PARTS[part] && !/CFR/i.test(c.text)) offPart += 1;
  }

  // Recall, reported only.
  const spans = found.map((c) => [c.start, c.end]);
  for (const m of flat.matchAll(BARE)) {
    bare += 1;
    const i = m.index ?? 0;
    if (spans.some(([s, e]) => i >= s - 40 && i < e + 4)) covered += 1;
  }
  for (const m of flat.matchAll(ANY_PART)) {
    if (PARTS[m[1]]) continue;
    const key = m[1];
    rejectedParts.set(key, (rejectedParts.get(key) ?? 0) + 1);
  }

  console.log(
    `${file.replace(/\.(pdf|md)$/i, "").slice(0, 44).padEnd(44)} ` +
      `citations ${String(sites.length).padStart(4)}  ` +
      `regulations ${String(new Set(sites.map((s) => s.regulation)).size).padStart(3)}`
  );
}

const index = buildCitationIndex(allSites);

console.log(`\n=== citations ===`);
console.log(`  documents read: ${files}`);
console.log(`  citations found: ${allSites.length}`);
console.log(`  regulations named: ${index.length}`);
console.log(`  citations whose text lost its anchor: ${malformed}   (must be 0)`);
console.log(`  citations overlapping another: ${overlapping}   (must be 0)`);
console.log(`  provisions that are prose, not a reference: ${proseProvision}   (must be 0)`);
console.log(`  bare parts admitted from outside the list: ${offPart}   (must be 0)`);

console.log(`\n  --- what the exam material actually cites ---`);
for (const entry of index.slice(0, 12)) {
  const provisions = entry.provisions.filter((p) => p.provision).length;
  console.log(
    `  ${entry.regulation.padEnd(22)} ${String(entry.total).padStart(3)}x ` +
      `across ${entry.documents} document(s), ${provisions} provision(s)` +
      `${entry.subtitle ? ` — ${entry.subtitle}` : ""}`
  );
  if (verbose) {
    for (const p of entry.provisions.filter((x) => x.provision).slice(0, 4)) {
      console.log(
        `        ${String(p.provision).padEnd(10)} ${p.sites.length}x in ${p.documents} doc(s)` +
          `  e.g. ${JSON.stringify(p.sites[0].text.slice(0, 40))}`
      );
    }
  }
}

console.log(
  `\n  parts refused because they are not on the list: ` +
    `${[...rejectedParts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([p, n]) => `${p} (${n})`)
      .join(", ") || "none"}`
);

console.log(
  `
  --- recall, reported and not asserted ---
  bare section references in the corpus: ${bare}
  of those, sitting beside a named regulation: ${covered}

  The gap is meant to be wide. A bare "section 5.0" is ambiguous between ICH
  E6's quality management section and the fifth section of the document being
  read, and no pattern settles it — so it is not a citation. Reading the
  remainder as one would fill this index with references that were never made,
  in the one panel whose entire job is to say where a rule is discussed.`
);

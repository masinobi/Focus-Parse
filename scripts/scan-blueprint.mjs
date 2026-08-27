/**
 * Offline report for blueprint coverage.
 *
 *   node scripts/scan-blueprint.mjs "C:/path/to/corpus" [--verbose]
 *
 * Every other scanner in this folder asks whether the app handles the corpus
 * correctly. This one asks the opposite question — **whether the corpus is
 * enough** — and it is the only report here whose answer can be "no, and no
 * amount of reading will fix it."
 *
 * The thing that can go quietly wrong is matching. A blueprint chapter that
 * fails to match a section the reader actually owns is reported as a gap they
 * cannot close; a chapter that matches the wrong section is reported as covered
 * when it is not. Both are invisible from the panel. So:
 *
 *   - **Near misses must be zero.** A corpus title within edit distance 2 of a
 *     blueprint chapter that did *not* match is either a missing alias or a
 *     missing RESEMBLES entry. Fuzzy matching is untrustworthy as an oracle and
 *     excellent as an alarm, which is the only way it is used here: it never
 *     decides a match, it only refuses to let one go unexamined.
 *   - **No unit may be claimed by two chapters.** Normalization drops "the" and
 *     folds "&" into "and"; over-fold it and two blueprint chapters collapse
 *     into one, which reads as a chapter that is covered twice over.
 *   - **A chapter's words may never exceed its documents' words.** This is the
 *     double-counting check: a standalone chapter PDF matches at document level
 *     *and* at section level, and counting both inflates the chapter by however
 *     much of itself it names.
 *   - **A resemblance may never contribute a word.** RESEMBLES exists to tell
 *     the reader about a later edition that re-split a chapter. The moment it
 *     starts counting as coverage it is an alias wearing a disguise.
 *
 * And the control, without which none of the above proves anything: the same
 * corpus is scored twice, once for a reader who has done nothing and once for a
 * reader who answered every check the ladder ever raised. If the first also
 * comes out verified, the report is measuring the library rather than the
 * reading.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const dir = process.argv[2];
const verbose = process.argv.includes("--verbose");
if (!dir) {
  console.error("usage: node scripts/scan-blueprint.mjs <folder> [--verbose]");
  process.exit(1);
}

const out = mkdtempSync(join(tmpdir(), "fp-blueprint-"));
execFileSync(
  process.execPath,
  [
    resolve("node_modules/typescript/bin/tsc"),
    "src/lib/blueprint.ts",
    "src/lib/blueprint-coverage.ts",
    "src/lib/coverage.ts",
    "src/lib/parse.ts",
    "src/lib/quiz.ts",
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

// Every module under `src/lib` imports its siblings relatively, precisely so
// the scanners can compile them standalone. `--paths` cannot be passed on the
// command line, so an `@/` import anywhere in this graph would have to be
// unpicked here instead; keeping the convention is cheaper.
const load = createRequire(import.meta.url);
const emitted = (name) => load(join(out, `${name}.js`));

const {
  buildBlueprintCoverage,
  matchChapter,
  normalizeTitle,
  allChapters,
  resembledChapters,
  isExcluded,
} = emitted("blueprint-coverage");
const { DOMAINS, STANDARDS_CHAPTERS } = emitted("blueprint");
const DOMAINS_FLAT = DOMAINS.flatMap((d) => d.chapters);
const STANDARDS_FLAT = STANDARDS_CHAPTERS;
const { buildCoverage } = emitted("coverage");
const { buildGridQuestion } = emitted("quiz");
const { parseDocument } = emitted("parse");
const { assemble, isBoldFont } = emitted("pdf");

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

/** The reading engine's spot-check cadence, from `useFocusStore`. */
const CLOZE_INTERVAL_TOKENS = 250;

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

/** A reader who answered exactly what the ladder asked. From `scan-coverage`. */
function perfectSession(doc) {
  const skipFurniture = (from) => {
    let at = from;
    while (at < doc.chunks.length && doc.sections[doc.chunks[at].section]?.furniture) {
      at += 1;
    }
    return at;
  };

  const summaries = {};
  for (let i = 0; i < doc.chunks.length; i++) {
    const next = skipFurniture(i + 1);
    if (next >= doc.chunks.length) break;
    const leaving = doc.chunks[i].section;
    const entering = doc.chunks[next].section;
    if (entering !== leaving && doc.sections[entering]?.intercept) {
      summaries[leaving] = "written";
    }
  }

  const gridsPassed = {};
  for (const block of doc.blocks) {
    if (block.kind === "table" && block.steps?.length && buildGridQuestion(block, 0)) {
      gridsPassed[block.i] = true;
    }
  }

  const clozeChecks = {};
  for (let to = CLOZE_INTERVAL_TOKENS; to <= doc.tokens.length; to += CLOZE_INTERVAL_TOKENS) {
    clozeChecks[to] = { from: to - CLOZE_INTERVAL_TOKENS, to, blanks: 3, recalled: 3, at: 0 };
  }
  const last = doc.tokens.length;
  if (last > 0 && !clozeChecks[last]) {
    clozeChecks[last] = {
      from: Math.max(0, last - CLOZE_INTERVAL_TOKENS),
      to: last,
      blanks: 3,
      recalled: 3,
      at: 0,
    };
  }

  return {
    tokenIndex: Math.max(0, doc.tokens.length - 1),
    summaries,
    gridsPassed,
    gridAttempts: {},
    clozeChecks,
  };
}

const EMPTY = {
  tokenIndex: 0,
  summaries: {},
  gridsPassed: {},
  gridAttempts: {},
  clozeChecks: {},
};

/** Levenshtein, used only to raise an alarm — never to decide a match. */
function distance(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = row;
  }
  return prev[b.length];
}

/**
 * Units for one document: every section, plus the document itself.
 *
 * Both are needed and the reason is the corpus. The GCDMP handbook carries its
 * chapters as sections of one document; a standalone chapter PDF is a document
 * whose *title* is the chapter and whose sections are that chapter's internal
 * headings. Matching only sections misses the second; matching only documents
 * misses the first.
 */
function unitsOf(doc, coverage) {
  const units = coverage.sections
    .filter((s) => s.words > 0)
    .map((s) => ({
      docId: doc.id,
      docTitle: doc.title,
      section: s.section,
      title: s.title,
      words: s.words,
      readWords: s.read,
      verifiedWords: s.state === "verified" ? s.words : 0,
    }));

  units.push({
    docId: doc.id,
    docTitle: doc.title,
    section: null,
    title: doc.title,
    words: coverage.totalWords,
    readWords: coverage.readWords,
    verifiedWords: coverage.verifiedWords,
  });

  return units;
}

const perfectUnits = [];
const emptyUnits = [];
const corpusTitles = [];
let files = 0;

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
  files += 1;

  const perfect = buildCoverage(doc, perfectSession(doc));
  const fresh = buildCoverage(doc, EMPTY);

  perfectUnits.push(...unitsOf(doc, perfect));
  emptyUnits.push(...unitsOf(doc, fresh));

  for (const s of perfect.sections) {
    if (s.words > 0) corpusTitles.push(s.title);
  }
  corpusTitles.push(doc.title);

  const matched = perfect.sections.filter((s) => s.words > 0 && matchChapter(s.title));
  console.log(
    `${file.replace(/\.(pdf|md)$/i, "").slice(0, 44).padEnd(44)} ` +
      `sections ${String(perfect.sections.length).padStart(4)}  ` +
      `blueprint chapters ${String(matched.length + (matchChapter(doc.title) ? 1 : 0)).padStart(2)}`
  );
}

const report = buildBlueprintCoverage(perfectUnits);
const control = buildBlueprintCoverage(emptyUnits);

/* ---------------------------------------------------------------- *
 * Assertions
 * ---------------------------------------------------------------- */

// 1. Near misses. A corpus title that all but matched and did not.
const chapterKeys = allChapters().map((c) => ({ chapter: c, key: normalizeTitle(c) }));
const nearMisses = [];
for (const title of new Set(corpusTitles)) {
  // A title that matched, that is a recorded resemblance, or that has been
  // examined and ruled out, has already been adjudicated by a human.
  if (matchChapter(title)) continue;
  if (resembledChapters(title).length) continue;
  if (isExcluded(title)) continue;
  const key = normalizeTitle(title);
  if (key.length < 8) continue;
  for (const { chapter, key: ck } of chapterKeys) {
    const d = distance(key, ck);
    if (d > 0 && d <= 2) nearMisses.push({ title, chapter, d });
  }
}

// 2. A blueprint chapter lost to normalization.
//
// The first version of this check looked for a unit claimed by two chapters,
// which cannot happen: `matchChapter` is a single map lookup, so every title
// resolves to exactly one chapter and the count was structurally always zero.
// It stayed green with the normalizer folding every chapter into one.
//
// Over-folding does real damage, just not there. `allChapters` dedupes by
// normalized key, so two chapters that normalize alike do not collide — one of
// them silently disappears from the report, and a chapter that is never listed
// is a chapter that can never be reported absent. So the number to watch is
// how many of the blueprint's own names survive normalization.
const statedNames = new Set([
  ...DOMAINS_FLAT,
  ...STANDARDS_FLAT,
]);
const survivingKeys = new Set([...statedNames].map(normalizeTitle));
const collapsed = statedNames.size - survivingKeys.size;

// 3. Double counting: a chapter cannot hold more words than its documents do.
const docWords = new Map();
for (const u of perfectUnits) {
  if (u.section === null) docWords.set(u.docId, u.words);
}
const inflated = report.chapters.filter((c) => {
  const ceiling = [...new Set(c.sources.map((u) => u.docId))].reduce(
    (n, id) => n + (docWords.get(id) ?? 0),
    0
  );
  return c.words > ceiling;
});

// 4. A resemblance that contributed coverage.
const leakedResemblance = report.chapters.filter((c) =>
  c.resembling.some((r) =>
    c.sources.some((s) => s.docId === r.docId && s.section === r.section)
  )
);

// 5. The control.
const controlVerified = control.verifiedChapters;

/* ---------------------------------------------------------------- *
 * Report
 * ---------------------------------------------------------------- */

const STATE_ORDER = ["absent", "unread", "unchecked", "partial", "verified"];
const counts = Object.fromEntries(STATE_ORDER.map((s) => [s, 0]));
for (const c of report.chapters) counts[c.state] += 1;

console.log(`\n=== blueprint ===`);
console.log(`  documents read: ${files}`);
console.log(`  chapters the blueprint names: ${report.totalChapters}`);
console.log(
  `  by state: ${STATE_ORDER.map((s) => `${s} ${counts[s]}`).join(" · ")}`
);
console.log(`  unadjudicated near misses (must be 0): ${nearMisses.length}`);
console.log(`  blueprint chapters lost to normalization (must be 0): ${collapsed}`);
console.log(`  chapters counting more words than they have (must be 0): ${inflated.length}`);
console.log(`  resemblances counted as coverage (must be 0): ${leakedResemblance.length}`);
console.log(`  chapters verified by a reader who did nothing (must be 0): ${controlVerified}`);
console.log(`  chapters verified by a perfect reading: ${report.verifiedChapters}`);

for (const m of nearMisses) {
  console.log(
    `      ! "${m.title.slice(0, 44)}" is ${m.d} from blueprint "${m.chapter.slice(0, 44)}"`
  );
}
if (collapsed > 0) {
  const seen = new Map();
  for (const name of statedNames) {
    const key = normalizeTitle(name);
    seen.set(key, [...(seen.get(key) ?? []), name]);
  }
  for (const [key, names] of seen) {
    if (names.length > 1) console.log(`      ! "${key}" <- ${names.join(" + ")}`);
  }
}
for (const c of inflated) {
  console.log(`      ! ${c.chapter}: ${c.words}w across ${c.sources.length} sources`);
}

console.log(`\n  --- what the exam names and this corpus does not have ---`);
if (!report.absent.length) {
  console.log(`  nothing: every chapter the blueprint names is in the library.`);
}
for (const c of report.absent) {
  const also = c.resembling.length
    ? ` — you do have ${c.resembling.map((r) => `"${r.title.slice(0, 40)}"`).join(", ")}`
    : "";
  console.log(
    `  ${c.standards ? "!" : " "} ${c.chapter.padEnd(52)} ${c.domains.length} domain(s)${also}`
  );
}
console.log(
  `\n  ${report.absentWithStandards.length} of those are chapters the guide gives minimum\n` +
    `  standards for, which is where "which of these is a minimum standard"\n` +
    `  questions come from. They are marked with !.`
);

console.log(`\n  --- by domain ---`);
for (const d of report.domains) {
  console.log(
    `  ${d.title.padEnd(26)} ${String(d.taskCount).padStart(2)} tasks  ` +
      `${String(d.chapters.length).padStart(2)} chapters  ` +
      `absent ${String(d.absent).padStart(2)}  verified ${String(d.verified).padStart(2)}`
  );
}

if (verbose) {
  console.log(`\n  --- every chapter ---`);
  for (const c of report.chapters) {
    console.log(
      `  ${c.state.padEnd(10)} ${c.chapter.slice(0, 52).padEnd(52)} ` +
        `${String(c.words).padStart(6)}w  ${c.sources.length} source(s)`
    );
  }
}

console.log(
  `
  The absent list is the point of this report and it is the one number the
  app cannot derive from the corpus alone. A chapter there is not a reading
  debt — no amount of pressing play will pay it. It is a missing document.`
);

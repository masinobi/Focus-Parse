/**
 * Offline report for the coverage account.
 *
 * `coverage.test.ts` pins the rules; this asks the only question the rules
 * cannot answer on their own — **can a real document ever reach 100%?**
 *
 *   node scripts/scan-coverage.mjs "C:/path/to/corpus" [--verbose]
 *
 * A coverage map is a list of debts, and a debt the app will never let the
 * reader pay is worse than no map at all: it sits there permanently, it makes
 * the number never reach the top, and after a week of that the reader stops
 * reading the panel. So this drives a *perfect reader* over every document —
 * every intercept summarized, every grid answered, a spot check answered on
 * every cadence window the engine would have fired — and asserts that nothing
 * is left owing.
 *
 * Anything reported under "unreachable" is a section the enforcement ladder
 * will never raise a check for and the map will nag about for ever. That number
 * must be zero, and it is the reason this file exists rather than another unit
 * test: whether it holds depends on how real headings, real furniture and real
 * tables fall out of nine real PDFs.
 *
 * It also reports the opposite failure. A perfect reading that comes out 100%
 * verified proves nothing if a reading that did *nothing* also would, so the
 * same documents are scored with an empty session and the two are printed side
 * by side.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const dir = process.argv[2];
const verbose = process.argv.includes("--verbose");
if (!dir) {
  console.error("usage: node scripts/scan-coverage.mjs <folder> [--verbose]");
  process.exit(1);
}

const out = mkdtempSync(join(tmpdir(), "fp-coverage-"));
execFileSync(
  process.execPath,
  [
    resolve("node_modules/typescript/bin/tsc"),
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

const load = createRequire(import.meta.url);
const { buildCoverage, nextToVerify } = load(join(out, "coverage.js"));
const { buildGridQuestion } = load(join(out, "quiz.js"));
const { parseDocument } = load(join(out, "parse.js"));
const { assemble, isBoldFont } = load(join(out, "pdf.js"));

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

/**
 * A session in which the reader answered everything the app ever asked — and
 * *only* what it asked.
 *
 * The "only" is the whole point, and the first version of this file got it
 * wrong. Handing out a summary for every section made the report unable to
 * fail: the bug it exists to catch is the account demanding something the
 * ladder never raises, and a simulated reader who volunteers answers nobody
 * asked for pays that debt too. Confirmed by reintroducing the bug — keying the
 * summary rung off the section instead of its successor — and watching this
 * stay at zero.
 *
 * So the summaries below are derived by walking the chunk stream the way
 * `finishChunk` does, from the chunks rather than from the sections, which
 * makes it an independent statement of the same rule instead of a restatement
 * of the one under test.
 *
 * The spot-check windows are laid down on the engine's own cadence rather than
 * one per section: the check fires every 250 tokens of *reading*, knows nothing
 * about structure, and a section shorter than the gap between two windows may
 * genuinely never get one of its own. Simulating one per section would hide
 * exactly that.
 */
function perfectSession(doc) {
  /** The next chunk playback will actually reach: furniture is stepped over. */
  const skipFurniture = (from) => {
    let at = from;
    while (at < doc.chunks.length && doc.sections[doc.chunks[at].section]?.furniture) {
      at += 1;
    }
    return at;
  };

  // Exactly `finishChunk`'s first rung: crossing into a section that arms an
  // intercept demands a summary of the section just left.
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

  // And its second: only a grid the engine would stop for can be passed.
  const gridsPassed = {};
  for (const block of doc.blocks) {
    if (block.kind === "table" && block.steps?.length && buildGridQuestion(block, 0)) {
      gridsPassed[block.i] = true;
    }
  }

  const clozeChecks = {};
  for (let to = CLOZE_INTERVAL_TOKENS; to <= doc.tokens.length; to += CLOZE_INTERVAL_TOKENS) {
    clozeChecks[to] = {
      from: to - CLOZE_INTERVAL_TOKENS,
      to,
      blanks: 3,
      recalled: 3,
      at: 0,
    };
  }
  // The tail: the engine's last window ends where the reading does.
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

let corpusUnreachable = 0;
let corpusSections = 0;
let corpusFreshVerified = 0;
/** Tables with steps that no question can be built from. */
let corpusMuteGrids = 0;
let corpusGrids = 0;

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

  for (const block of doc.blocks) {
    if (block.kind !== "table" || !block.steps?.length) continue;
    corpusGrids += 1;
    if (!buildGridQuestion(block, 0)) corpusMuteGrids += 1;
  }

  const perfect = buildCoverage(doc, perfectSession(doc));
  // The control: a reader who has done nothing at all. If this also comes out
  // verified then the perfect run above proves nothing.
  const fresh = buildCoverage(doc, {
    tokenIndex: 0,
    summaries: {},
    gridsPassed: {},
    gridAttempts: {},
    clozeChecks: {},
  });

  const stuck = perfect.sections.filter((s) => s.words > 0 && s.state !== "verified");
  corpusUnreachable += stuck.length;
  corpusSections += perfect.sections.filter((s) => s.words > 0).length;
  corpusFreshVerified += fresh.verified;

  const pct = perfect.totalWords
    ? Math.round((perfect.verifiedWords / perfect.totalWords) * 100)
    : 0;

  console.log(
    `${file.replace(/\.(pdf|md)$/i, "").slice(0, 42).padEnd(42)} ` +
      `sections ${String(perfect.sections.length).padStart(4)}  ` +
      `perfect reading ${String(pct).padStart(3)}%  ` +
      `unreachable ${String(stuck.length).padStart(3)}  ` +
      `fresh reading ${fresh.verified}`
  );

  if (verbose) {
    console.log(
      `      rungs: ${perfect.summaries.given}/${
        perfect.summaries.given + perfect.summaries.owed
      } summaries · ${perfect.grids.passed}/${perfect.grids.total} tables · ` +
        `${perfect.cloze.windows} windows`
    );
    console.log(
      `      next after a fresh open: ${nextToVerify(fresh)?.title.slice(0, 50) ?? "—"}`
    );
  }
  for (const s of stuck.slice(0, 12)) {
    console.log(
      `      ! never verifiable: "${s.title.slice(0, 48)}" ${s.words}w — ` +
        `summary ${s.summary}, tables ${s.grids.passed}/${s.grids.total}, ` +
        `windows ${s.cloze.windows}`
    );
  }
}

console.log(`\n=== coverage ===`);
console.log(`  sections that can be owed something: ${corpusSections}`);
console.log(
  `  still owing after a perfect reading: ${corpusUnreachable}   (must be 0)`
);
console.log(
  `  verified after doing nothing at all: ${corpusFreshVerified}   (must be 0)`
);
console.log(
  `  tables no question can be built from: ${corpusMuteGrids} of ${corpusGrids}`
);
console.log(
  `
  The second line is the control. A perfect reading reaching 100% means
  nothing on its own — a model that called everything verified would report
  the same. Both numbers have to be zero for either to be worth reading.

  The third line is reported rather than asserted, and reported because it is
  currently zero: every table in this corpus that flattened into steps also
  yields an answerable question, so the guard that keeps an unaskable grid out
  of the account is not exercised by these nine documents. It is still load
  bearing — the other half of the same guard, a grid whose attempts are spent,
  fires in ordinary use — but nobody should read a green here as evidence that
  the mute-grid case works. coverage.test.ts is what covers that.`
);

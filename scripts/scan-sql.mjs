/**
 * Offline report for the T-SQL stepper.
 *
 * `sql.test.ts` pins the rules against fixtures that were written to exercise
 * them. This runs the same modules over the reader's actual practice scripts,
 * which is a different question: **does a real query survive being cut up?**
 *
 *   node scripts/scan-sql.mjs "C:/path/to/SQL Practice - Trial Screening"
 *
 * The failure mode is not a crash. A clause splitter fooled by a keyword inside
 * a string, or one that cuts into a subquery, produces steps that look
 * perfectly reasonable and teach an evaluation order that is a fiction — and
 * nothing downstream can tell. So the assertions below are all conservation
 * laws, and every one of them must be zero:
 *
 *   - Nothing that is still SQL is left out of every step. A dropped predicate
 *     is a query the reader is now quietly wrong about. Checked by looking for
 *     clause keywords in the text no step covers — *not* by reassembling the
 *     statement from the step spans, which is the same as slicing it end to end
 *     and cannot fail. The first version did exactly that and stayed green with
 *     a whole WHERE clause deleted.
 *   - No step overlaps another, or the renderer highlights two clauses at once.
 *   - No statement is handed a SELECT belonging to one of its own subqueries,
 *     which is what cutting below depth 0 produces: not a missing clause but an
 *     extra one, in an evaluation order that is a fiction.
 *   - Every step says something out loud. A step whose speech is empty is a
 *     silence in the middle of a query with no way to know why.
 *
 * It also reports what cannot be asserted: how the steps are distributed, and
 * the ten longest ones, because a "step" that is four hundred characters of
 * SELECT list is technically correct and useless to listen to.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const dir = process.argv[2];
const verbose = process.argv.includes("--verbose");
if (!dir) {
  console.error("usage: node scripts/scan-sql.mjs <folder> [--verbose]");
  process.exit(1);
}

const out = mkdtempSync(join(tmpdir(), "fp-sql-"));
execFileSync(
  process.execPath,
  [
    resolve("node_modules/typescript/bin/tsc"),
    "src/lib/sql.ts",
    "src/lib/parse.ts",
    "--outDir", out,
    "--module", "commonjs",
    "--target", "es2020",
    "--moduleResolution", "node",
    "--skipLibCheck",
  ],
  { stdio: "inherit" }
);

const load = createRequire(import.meta.url);
const {
  splitStatements,
  stepsOf,
  stepsOfScript,
  sqlSpeechFor,
  sqlToMarkdown,
  stepText,
} = load(join(out, "sql.js"));
const { parseDocument } = load(join(out, "parse.js"));

let files = 0;
let statements = 0;
let steps = 0;
/** Statements whose steps and gaps do not reassemble the original. */
let lossy = 0;
/** Steps whose span overlaps the previous one. */
let overlapping = 0;
/** Statements handed a SELECT that belonged to one of their own subqueries. */
let leaked = 0;

/** A clause keyword left in text no step covers means a clause went missing. */
const CLAUSE_WORD =
  /\b(select|from|where|group\s+by|having|order\s+by|join|union|values)\b/i;
/** Steps that would be spoken as nothing at all. */
let mute = 0;
/** Statements the splitter recognised no clause in. */
let opaque = 0;
/** Chunks longer than the cap that exists to dodge synthesizer truncation. */
let overlong = 0;
/** Blocks whose step-to-chunk map is the wrong length or goes backwards. */
let mapBroken = 0;
/** Steps no chunk claims, which would be a clause that is never spoken. */
let stepsWithNoChunk = 0;

/** From `parse.ts`. Kept here rather than exported so the report states it. */
const MAX_CHUNK_CHARS = 180;
const byKeyword = new Map();
const longest = [];

const say = (text) =>
  text
    .split(/\s+/)
    .map(sqlSpeechFor)
    .filter(Boolean)
    .join(" ")
    .trim();

for (const file of readdirSync(dir).filter((f) => /\.sql$/i.test(f))) {
  const script = readFileSync(join(dir, file), "utf8");
  files += 1;

  // Through the same door the app uses: the script becomes markdown, the
  // markdown is parsed, and the steps are read back off the blocks. Testing
  // `stepsOf` directly would not catch a fence that never reaches the parser.
  const doc = parseDocument(sqlToMarkdown(script), file);
  const sqlBlocks = doc.blocks.filter((b) => b.sqlSteps?.length);

  let fileSteps = 0;
  for (const block of sqlBlocks) {
    // A clause can be longer than one utterance, so chunks outnumber steps and
    // the map is what ties them together. If it were ever short, or went
    // backwards, the renderer would light the wrong clause.
    const map = block.sqlStepOfChunk ?? [];
    if (map.length !== block.chunks.length) mapBroken += 1;
    for (let k = 1; k < map.length; k++) if (map[k] < map[k - 1]) mapBroken += 1;
    for (let s = 0; s < block.sqlSteps.length; s++) {
      if (!map.includes(s)) stepsWithNoChunk += 1;
    }
    for (const chunkIndex of block.chunks) {
      if (doc.chunks[chunkIndex].text.length > MAX_CHUNK_CHARS) overlong += 1;
    }
    fileSteps += block.sqlSteps.length;

    const written = [...block.sqlSteps].sort((a, b) => a.start - b.start);
    let at = -1;
    for (const step of written) {
      if (step.start < at) overlapping += 1;
      at = step.end;

      byKeyword.set(step.keyword, (byKeyword.get(step.keyword) ?? 0) + 1);
      if (!say(step.text)) mute += 1;
      longest.push({ file, keyword: step.keyword, length: step.text.length, text: step.text });
    }
  }
  steps += fileSteps;

  // The conservation law, checked per statement against the raw script rather
  // than against anything the parser produced.
  for (const statement of splitStatements(script)) {
    statements += 1;
    const cut = stepsOf(statement.text);
    if (!cut.length || (cut.length === 1 && cut[0].keyword === "OTHER")) {
      opaque += 1;
    }

    // What no step covers.
    //
    // The first version of this check rebuilt the statement out of the step
    // *spans* and their gaps, which is the same thing as slicing the statement
    // end to end — it could not fail, and it stayed green with a whole WHERE
    // clause deleted on purpose. What is worth asserting is that the uncovered
    // remainder is only scaffolding: a `WITH x AS (`, a closing paren, a comma.
    // If a clause goes missing, its keyword turns up here.
    const written = [...cut].sort((a, b) => a.start - b.start);
    let leftOut = "";
    let cursor = 0;
    for (const step of written) {
      leftOut += " " + statement.text.slice(cursor, step.start);
      cursor = Math.max(cursor, step.end);
    }
    leftOut += " " + statement.text.slice(cursor);
    if (CLAUSE_WORD.test(stripStrings(leftOut))) {
      lossy += 1;
      if (verbose) {
        console.log(
          `      ! left out of every step: ${JSON.stringify(
            leftOut.replace(/\s+/g, " ").trim().slice(0, 70)
          )}`
        );
      }
    }

    // Subquery leakage. Ignoring parenthesis depth does not *lose* the outer
    // SELECT — it hands the statement the subquery's one as well. So the
    // number to watch is more than one main-body SELECT with no UNION to
    // explain it, which is the shape the bug actually takes.
    const bodySelects = cut.filter((s) => !s.cte && s.keyword === "SELECT").length;
    const unioned = cut.some((s) => s.keyword === "UNION");
    if (bodySelects > 1 && !unioned) leaked += 1;
  }

  console.log(
    `${file.replace(/\.sql$/i, "").slice(0, 40).padEnd(40)} ` +
      `blocks ${String(sqlBlocks.length).padStart(2)}  ` +
      `steps ${String(fileSteps).padStart(3)}  ` +
      `sections ${String(doc.sections.length).padStart(3)}  ` +
      `words ${String(doc.wordCount).padStart(5)}`
  );

  if (verbose) {
    const block = sqlBlocks.find((b) => b.sqlSteps.length > 4);
    if (block) {
      console.log(`      a stepped query, in the order it is evaluated:`);
      for (const step of block.sqlSteps.slice(0, 8)) {
        console.log(
          `        ${String(step.i + 1).padStart(2)}. w${String(step.written + 1).padStart(2)} ` +
            `${((step.cte ? step.cte + "/" : "") + step.keyword).padEnd(18)} ` +
            `${JSON.stringify(stepText(step).replace(/\s+/g, " ").slice(0, 62))}`
        );
      }
    }
  }
}

/** Crude, and only used to ask whether a SELECT was ever there to lose. */
function stripStrings(sql) {
  return sql.replace(/'[^']*'/g, "''").replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

longest.sort((a, b) => b.length - a.length);

console.log(`\n=== stepper ===`);
console.log(`  scripts read: ${files}`);
console.log(`  statements: ${statements}`);
console.log(`  steps cut: ${steps}`);
console.log(`  statements with SQL left out of every step: ${lossy}   (must be 0)`);
console.log(`  steps overlapping another step: ${overlapping}   (must be 0)`);
console.log(`  statements given a subquery's own SELECT: ${leaked}   (must be 0)`);
console.log(`  steps that would be spoken as silence: ${mute}   (must be 0)`);
console.log(`  utterances over ${MAX_CHUNK_CHARS} characters: ${overlong}   (must be 0)`);
console.log(`  blocks with a broken step-to-chunk map: ${mapBroken}   (must be 0)`);
console.log(`  steps no chunk ever speaks: ${stepsWithNoChunk}   (must be 0)`);
console.log(`  statements no clause was recognised in: ${opaque}`);
console.log(
  `  by clause: ${[...byKeyword.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}`)
    .join(" · ")}`
);
console.log(`  longest steps:`);
for (const step of longest.slice(0, 5)) {
  console.log(
    `    ${String(step.length).padStart(4)} chars  ${step.keyword.padEnd(9)} ` +
      `${JSON.stringify(step.text.replace(/\s+/g, " ").slice(0, 58))}`
  );
}
console.log(
  `
  The last line is reported rather than asserted, and it is the one to read.
  A clause is a unit of *evaluation*, not of attention: a forty-column SELECT
  list is one correct step and far more than one utterance. Nothing here caps
  it, because cutting a clause in half to fit an ear would mean the step
  boundaries no longer mean what this feature claims they mean. If these run
  long on a future script, the answer is a second-level split inside a clause
  that is still labelled as one step — not a shorter clause.`
);

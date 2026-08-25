/**
 * The T-SQL logical stepper.
 *
 * Code blocks are never spoken in this app, and that is right for almost every
 * code block: read aloud, source is noise. SQL is the exception, and not
 * because it sounds better — because **the order a query is written in is not
 * the order it is evaluated in**, and that single fact is what makes SQL click
 * or not. `SELECT` is written first and happens sixth. `WHERE` runs before the
 * columns it appears to filter on exist. Reading a query top to bottom teaches
 * the wrong model, and every reader who has been confused about why they cannot
 * use a column alias in `WHERE` has been taught it.
 *
 * So a SQL statement is not read out. It is *stepped*: split into its clauses,
 * put into the order the engine actually evaluates them, and played one clause
 * per utterance — which makes the gap between steps a real sentence boundary
 * rather than a pause the engine has to fake. The display keeps the statement
 * exactly as written and lights up whichever clause is being spoken, so the
 * caret visibly jumps from the bottom of the query to the top and back. The
 * jumping is the lesson.
 *
 * This is the same shape as the matrix flattener: one chunk per step, steps
 * carried on the block, the reader rendering from the steps. Nothing in the
 * token or offset machinery has to know SQL exists.
 *
 * Scope is deliberately one statement's *shape*. This does not parse SQL, know
 * what a query means, or check it — it finds clause boundaries, which is a
 * lexical problem, and it has to survive string literals, bracketed
 * identifiers, nested comments and subqueries to do that. Everything below is
 * about not being fooled by those.
 */

/** Fence info strings that mark a code block as steppable. */
const SQL_FENCES = new Set(["sql", "tsql", "t-sql", "mssql", "transact-sql"]);

export function isSqlFence(info: string): boolean {
  return SQL_FENCES.has(info.trim().toLowerCase());
}

/* ------------------------------------------------------------------ *
 * Lexical skeleton
 * ------------------------------------------------------------------ */

/**
 * Where a character sits, so a keyword inside a string is never a keyword.
 *
 * `'%type 2 diabetes%'` contains no `FROM`, but `'... from ...'` in a LIKE
 * pattern would, and a splitter fooled by one cuts a statement in half at a
 * place that is not a clause boundary. Nested block comments are a real T-SQL
 * feature, so the depth is counted rather than matched.
 */
type Span = { start: number; end: number; kind: "string" | "comment" };

export function inertSpans(sql: string): Span[] {
  const spans: Span[] = [];
  let i = 0;

  while (i < sql.length) {
    const c = sql[i];

    if (c === "'") {
      const start = i;
      i += 1;
      while (i < sql.length) {
        // '' is an escaped quote inside a string, not the end of one.
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") break;
        else i += 1;
      }
      spans.push({ start, end: Math.min(i + 1, sql.length), kind: "string" });
      i += 1;
      continue;
    }

    if (c === "[" || c === '"') {
      const close = c === "[" ? "]" : '"';
      const start = i;
      i += 1;
      while (i < sql.length && sql[i] !== close) i += 1;
      // A bracketed identifier is inert for the same reason a string is:
      // [FROM DATE] is a column name, not a clause.
      spans.push({ start, end: Math.min(i + 1, sql.length), kind: "string" });
      i += 1;
      continue;
    }

    if (c === "-" && sql[i + 1] === "-") {
      const start = i;
      while (i < sql.length && sql[i] !== "\n") i += 1;
      spans.push({ start, end: i, kind: "comment" });
      continue;
    }

    if (c === "/" && sql[i + 1] === "*") {
      const start = i;
      let depth = 0;
      while (i < sql.length) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth += 1;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth -= 1;
          i += 2;
          if (depth === 0) break;
        } else i += 1;
      }
      spans.push({ start, end: i, kind: "comment" });
      continue;
    }

    i += 1;
  }

  return spans;
}

/** A lookup saying whether each character is inside a string or a comment. */
function inertMask(sql: string): Uint8Array {
  const mask = new Uint8Array(sql.length);
  for (const span of inertSpans(sql)) {
    for (let i = span.start; i < span.end && i < sql.length; i++) mask[i] = 1;
  }
  return mask;
}

/** Parenthesis depth at each character, ignoring inert spans. */
function depths(sql: string, mask: Uint8Array): Int16Array {
  const out = new Int16Array(sql.length);
  let depth = 0;
  for (let i = 0; i < sql.length; i++) {
    if (!mask[i]) {
      if (sql[i] === "(") depth += 1;
      else if (sql[i] === ")") depth = Math.max(0, depth - 1);
    }
    // A closing paren reports the depth it closes *to*, so a clause keyword
    // immediately after one is measured outside the subquery it followed.
    out[i] = depth;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Statements
 * ------------------------------------------------------------------ */

/**
 * One executable statement, with where it sat in the script.
 *
 * `text` is verbatim, including its own comments: a `-- NOTE:` explaining why
 * a filter is *not* in a CTE is part of the query, and stripping it would throw
 * away the only reason that line is there.
 */
export interface SqlStatement {
  i: number;
  text: string;
  start: number;
  end: number;
}

/**
 * Split a script into statements at depth-0 `;` and at T-SQL's `GO` batch
 * separator.
 *
 * `GO` is not SQL — it is a batch marker the client honours — but it appears
 * in every script written against SQL Server and a splitter that ignores it
 * welds `USE Practice` onto the query after it.
 */
export function splitStatements(script: string): SqlStatement[] {
  const mask = inertMask(script);
  const depth = depths(script, mask);
  const out: SqlStatement[] = [];
  let from = 0;

  const push = (start: number, end: number) => {
    const text = script.slice(start, end);
    if (!hasCode(text)) return;
    out.push({ i: out.length, text: text.trim(), start, end });
  };

  for (let i = 0; i < script.length; i++) {
    if (mask[i]) continue;
    if (script[i] === ";" && depth[i] === 0) {
      push(from, i + 1);
      from = i + 1;
      continue;
    }
    // `GO` on a line of its own.
    if (
      depth[i] === 0 &&
      (script[i] === "G" || script[i] === "g") &&
      /^go\s*$/i.test(lineAround(script, i)) &&
      atLineStart(script, i)
    ) {
      push(from, i);
      from = i + 2;
    }
  }
  push(from, script.length);

  return out.map((s, i) => ({ ...s, i }));
}

function atLineStart(text: string, i: number): boolean {
  let j = i - 1;
  while (j >= 0 && (text[j] === " " || text[j] === "\t")) j -= 1;
  return j < 0 || text[j] === "\n";
}

function lineAround(text: string, i: number): string {
  const start = text.lastIndexOf("\n", i) + 1;
  const end = text.indexOf("\n", i);
  return text.slice(start, end === -1 ? text.length : end);
}

/**
 * Everything but the comments.
 *
 * Strings are kept: `SELECT 'x'` is a statement and `-- done` is not. Used to
 * decide whether a slice between two separators holds anything executable, so
 * a trailing comment after the last `;` does not become an empty statement.
 */
export function stripComments(sql: string): string {
  const drop = inertSpans(sql).filter((s) => s.kind === "comment");
  if (!drop.length) return sql;
  let out = "";
  let at = 0;
  for (const span of drop) {
    out += sql.slice(at, span.start);
    at = span.end;
  }
  return out + sql.slice(at);
}

function hasCode(text: string): boolean {
  return stripComments(text).trim().length > 0;
}

/* ------------------------------------------------------------------ *
 * Clauses
 * ------------------------------------------------------------------ */

export type SqlKeyword =
  | "WITH"
  | "SELECT"
  | "FROM"
  | "JOIN"
  | "APPLY"
  | "WHERE"
  | "GROUP BY"
  | "HAVING"
  | "WINDOW"
  | "UNION"
  | "ORDER BY"
  | "LIMIT"
  | "INSERT"
  | "VALUES"
  | "UPDATE"
  | "SET"
  | "DELETE"
  | "OTHER";

interface KeywordRule {
  keyword: SqlKeyword;
  /** Matched at a clause boundary, case-insensitively. */
  pattern: RegExp;
}

/**
 * Order matters: the longest form has to be tried first, or `ORDER BY` is
 * found as `OTHER`-nothing and `GROUP BY` splits after `GROUP`.
 */
const KEYWORDS: KeywordRule[] = [
  { keyword: "GROUP BY", pattern: /^group\s+by\b/i },
  { keyword: "ORDER BY", pattern: /^order\s+by\b/i },
  { keyword: "JOIN", pattern: /^(?:(?:inner|left|right|full|cross)\s+)?(?:outer\s+)?join\b/i },
  { keyword: "APPLY", pattern: /^(?:cross|outer)\s+apply\b/i },
  { keyword: "UNION", pattern: /^union(?:\s+all)?\b/i },
  { keyword: "UNION", pattern: /^(?:except|intersect)\b/i },
  { keyword: "LIMIT", pattern: /^offset\b/i },
  { keyword: "INSERT", pattern: /^insert(?:\s+into)?\b/i },
  { keyword: "DELETE", pattern: /^delete(?:\s+from)?\b/i },
  { keyword: "WITH", pattern: /^with\b/i },
  { keyword: "SELECT", pattern: /^select\b/i },
  { keyword: "FROM", pattern: /^from\b/i },
  { keyword: "WHERE", pattern: /^where\b/i },
  { keyword: "HAVING", pattern: /^having\b/i },
  { keyword: "WINDOW", pattern: /^window\b/i },
  { keyword: "VALUES", pattern: /^values\b/i },
  { keyword: "UPDATE", pattern: /^update\b/i },
  { keyword: "SET", pattern: /^set\b/i },
];

export interface SqlClause {
  keyword: SqlKeyword;
  /** Verbatim, including any comments that sat inside it. */
  text: string;
  /** Character offset inside the statement it came from. */
  start: number;
  end: number;
}

/**
 * Cut a statement at its depth-0 clause keywords.
 *
 * Depth 0 is the whole trick. `EXISTS (SELECT 1 FROM conditions c WHERE ...)`
 * contains three clause keywords and is *one* predicate belonging to the outer
 * `WHERE`; splitting on them would present a subquery's internals as steps of
 * the statement that contains it, in an evaluation order that is a fiction.
 * A CTE body is inside parentheses for the same reason and is left whole here —
 * see `stepsOf`, which gives each CTE its own steps.
 *
 * `ON` is deliberately *not* a clause. A join and its condition are one thought,
 * and separating them produces a step that says "on a.PATIENT_ID = p.PATIENT_ID"
 * with no way to know which join it belonged to.
 */
export function clausesOf(statement: string): SqlClause[] {
  const mask = inertMask(statement);
  const depth = depths(statement, mask);
  const cuts: { at: number; keyword: SqlKeyword; length: number }[] = [];

  for (let i = 0; i < statement.length; i++) {
    if (mask[i] || depth[i] !== 0) continue;
    if (!isWordStart(statement, i)) continue;

    const rest = statement.slice(i, i + 24);
    for (const rule of KEYWORDS) {
      const m = rule.pattern.exec(rest);
      if (!m) continue;
      cuts.push({ at: i, keyword: rule.keyword, length: m[0].length });
      i += m[0].length - 1;
      break;
    }
  }

  if (!cuts.length) {
    const text = statement.trim();
    return text ? [{ keyword: "OTHER", text, start: 0, end: statement.length }] : [];
  }

  const clauses: SqlClause[] = [];

  // Anything before the first keyword — `USE Practice`, a leading comment —
  // is kept rather than dropped. Losing text silently is how a reader stops
  // trusting the view.
  const preamble = statement.slice(0, cuts[0].at);
  if (preamble.trim()) {
    clauses.push({
      keyword: "OTHER",
      text: preamble.trim(),
      start: 0,
      end: cuts[0].at,
    });
  }

  for (let c = 0; c < cuts.length; c++) {
    const start = cuts[c].at;
    const end = c + 1 < cuts.length ? cuts[c + 1].at : statement.length;
    const text = statement.slice(start, end).trim();
    if (text) clauses.push({ keyword: cuts[c].keyword, text, start, end });
  }

  return clauses;
}

function isWordStart(text: string, i: number): boolean {
  return i === 0 || !/[A-Za-z0-9_]/.test(text[i - 1]);
}

/* ------------------------------------------------------------------ *
 * Logical order
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Logical order
 * ------------------------------------------------------------------ */

/**
 * The order the engine evaluates clauses in, which is the whole point.
 *
 * Not a house opinion: this is the conceptual evaluation order every SQL
 * reference states, and it is why a `SELECT` alias cannot be used in `WHERE`
 * and can be used in `ORDER BY`. Equal ranks keep their written order, so two
 * joins stay in the order they were written and the sort has to be stable.
 */
const RANK: Record<SqlKeyword, number> = {
  OTHER: 0,
  WITH: 5,
  INSERT: 6,
  UPDATE: 6,
  DELETE: 6,
  FROM: 10,
  JOIN: 11,
  APPLY: 11,
  WHERE: 20,
  "GROUP BY": 30,
  HAVING: 40,
  WINDOW: 45,
  SELECT: 50,
  VALUES: 52,
  SET: 52,
  UNION: 60,
  "ORDER BY": 70,
  LIMIT: 80,
};

/**
 * What each clause does, in the fewest words that are still true.
 *
 * A fixed table of well-known facts, not generated commentary. The two that
 * earn their place are `WHERE` and `SELECT`: naming when they run relative to
 * grouping is the thing a reader is usually wrong about, and it is the reason
 * this feature exists at all.
 */
const ROLE: Record<SqlKeyword, string> = {
  // Deliberately empty. `OTHER` is whatever sat before the first keyword — a
  // `USE` line, a note the author left above a CTE — and prefixing those with
  // the word "statement" adds nothing and is heard on every one of them.
  OTHER: "",
  WITH: "named subqueries, built first",
  INSERT: "the target",
  UPDATE: "the target",
  DELETE: "the target",
  FROM: "the row source",
  JOIN: "rows matched in",
  APPLY: "rows matched per row",
  WHERE: "filters rows, before any grouping",
  "GROUP BY": "collapses rows into groups",
  HAVING: "filters groups, after grouping",
  WINDOW: "named windows",
  SELECT: "what comes out, evaluated after the filters",
  VALUES: "the rows supplied",
  SET: "the columns assigned",
  UNION: "combined with the next result set",
  "ORDER BY": "presentation order, last of all",
  LIMIT: "how many rows are kept",
};

export function roleOf(keyword: SqlKeyword): string {
  return ROLE[keyword];
}

/** One clause, in the order it is evaluated, with what it does. */
export interface SqlStep {
  /** Position in the evaluated order — what the stepper plays. */
  i: number;
  /** Position in the written statement, so the display can light it up. */
  written: number;
  keyword: SqlKeyword;
  text: string;
  /** Character span inside the statement, for highlighting it in place. */
  start: number;
  end: number;
  role: string;
  /** Name of the CTE this step belongs to, when it is inside one. */
  cte?: string;
  /** Which statement of the block this came from. */
  statement: number;
}

/** `WITH name AS ( body )`, one entry per CTE, with the body's own span. */
interface Cte {
  name: string;
  bodyStart: number;
  bodyEnd: number;
}

/**
 * Find the named subqueries a `WITH` clause defines.
 *
 * Their bodies sit at depth 1 and so are invisible to `clausesOf`, which is
 * correct — they are not clauses of the outer statement — but leaving them as
 * one opaque step throws away most of a real query. `RankedLabs` in the
 * feasibility screen is a five-clause query in its own right, and it is the
 * one a reader needs stepped, because the `WHERE` inside it deliberately does
 * *not* carry the threshold.
 */
function ctesOf(clause: SqlClause): Cte[] {
  const text = clause.text;
  const mask = inertMask(text);
  const depth = depths(text, mask);
  const out: Cte[] = [];

  // `WITH a AS (...), b AS (...)` — every depth-0 `AS (` opens one.
  const pattern = /([A-Za-z_][A-Za-z0-9_]*)\s+AS\s*\(/gi;
  for (const m of Array.from(text.matchAll(pattern))) {
    const open = (m.index ?? 0) + m[0].length - 1;
    if (mask[open] || depth[open] !== 1) continue;
    let close = open + 1;
    while (close < text.length && !(depth[close] === 0 && text[close] === ")")) {
      close += 1;
    }
    out.push({ name: m[1], bodyStart: open + 1, bodyEnd: close });
  }

  return out;
}

/**
 * A statement as an ordered list of steps.
 *
 * Two passes. The CTEs go first, each expanded into its own clauses in their
 * own evaluation order, because that is genuinely when they are built. Then the
 * main body's clauses, sorted by rank. The `WITH` clause itself is replaced by
 * its contents rather than kept alongside them — a step whose text is the whole
 * of every CTE is not a step.
 *
 * `written` is assigned from the written order across the whole statement, so
 * a renderer can show the statement exactly as typed and know which span each
 * step lights up.
 */
export function stepsOf(statement: string): SqlStep[] {
  const clauses = clausesOf(statement);
  if (!clauses.length) return [];

  type Raw = Omit<SqlStep, "i" | "written" | "role" | "statement">;
  const raw: { step: Raw; rank: number; order: number }[] = [];
  let order = 0;

  for (const clause of clauses) {
    if (clause.keyword !== "WITH") {
      raw.push({
        step: {
          keyword: clause.keyword,
          text: clause.text,
          start: clause.start,
          end: clause.end,
        },
        rank: RANK[clause.keyword],
        order: order++,
      });
      continue;
    }

    const ctes = ctesOf(clause);
    if (!ctes.length) {
      raw.push({
        step: {
          keyword: "WITH",
          text: clause.text,
          start: clause.start,
          end: clause.end,
        },
        rank: RANK.WITH,
        order: order++,
      });
      continue;
    }

    for (let n = 0; n < ctes.length; n++) {
      const cte = ctes[n];
      const body = clause.text.slice(cte.bodyStart, cte.bodyEnd);
      const inner = clausesOf(body);
      for (const c of inner) {
        raw.push({
          step: {
            keyword: c.keyword,
            text: c.text,
            // Back to coordinates in the statement, so highlighting lands on
            // the right characters however deeply this was nested.
            start: clause.start + cte.bodyStart + c.start,
            end: clause.start + cte.bodyStart + c.end,
            cte: cte.name,
          },
          // A CTE is built before the body that selects from it; each CTE is
          // built *whole* before the next, which is why its index outranks its
          // own clause order. Interleaving two CTEs by clause — both FROMs,
          // then both WHEREs — is what this looked like before the index was
          // in the key, and it presented two independent queries as one.
          rank: RANK.WITH + n * 0.1 + RANK[c.keyword] / 10_000,
          order: order++,
        });
      }
    }
  }

  // Written order is fixed before the sort, because the sort destroys it.
  const written = new Map<number, number>();
  [...raw]
    .sort((a, b) => a.step.start - b.step.start)
    .forEach((r, i) => written.set(r.order, i));

  return raw
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map((r, i) => ({
      ...r.step,
      i,
      written: written.get(r.order) ?? i,
      role: ROLE[r.step.keyword],
      statement: 0,
    }));
}

/**
 * Every step in a fenced block, which may hold more than one statement.
 *
 * Offsets are rebased onto the block so a renderer highlighting a step lands on
 * the right characters of the payload it is showing, not of the statement the
 * step happened to come from. `i` is renumbered across the whole block for the
 * same reason: it is the play order, and playback does not restart per
 * statement.
 */
export function stepsOfScript(script: string): SqlStep[] {
  const out: SqlStep[] = [];
  for (const statement of splitStatements(script)) {
    // `splitStatements` trims, so the statement's own text may start later than
    // its recorded span. Find where it really begins before rebasing.
    const lead = script.slice(statement.start, statement.end).indexOf(statement.text.slice(0, 16));
    const base = statement.start + (lead === -1 ? 0 : lead);
    for (const step of stepsOf(statement.text)) {
      out.push({
        ...step,
        i: out.length,
        start: base + step.start,
        end: base + step.end,
        statement: statement.i,
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Saying it out loud
 * ------------------------------------------------------------------ */

/**
 * Comment markers: shown, never spoken.
 *
 * The same rule as evidence grades in prose. `-- criterion 3` is worth hearing;
 * the two dashes in front of it are read as "dash dash" by every voice and
 * derail the step before it starts.
 */
const SILENT = new Set(["--", "/*", "*/", "/**"]);

const OPERATORS: Record<string, string> = {
  "=": "equals",
  "<>": "not equal to",
  "!=": "not equal to",
  ">=": "greater than or equal to",
  "<=": "less than or equal to",
  ">": "greater than",
  "<": "less than",
  "*": "star",
  "||": "concatenated with",
};

/**
 * One displayed SQL token, as something a synthesizer can say.
 *
 * Without this the stepper is a false promise: `p.PATIENT_ID` is read as "p
 * dot patient underscore i d" by every voice tested, and a step that cannot be
 * listened to is a step that is only being looked at. So underscores become
 * spaces, a dot between identifiers becomes a space, and operators are named.
 *
 * Punctuation that does real work for the ear is kept. A comma is a pause and
 * a column list needs them; parentheses are dropped, because "open paren" nine
 * times in one predicate buries the predicate.
 *
 * The honest limit: a string literal containing spaces has already been split
 * into several tokens by the time this sees it, so `'%type 2 diabetes%'` is
 * spoken as three fragments. Structure is what the stepper is for and structure
 * survives; literals read roughly.
 */
export function sqlSpeechFor(token: string): string {
  if (SILENT.has(token)) return "";

  const named = OPERATORS[token];
  if (named) return named;

  const trailing = /[,;]$/.exec(token)?.[0] ?? "";
  const head = trailing ? token.slice(0, -1) : token;

  const operator = OPERATORS[head.replace(/[()]/g, "")];
  if (operator) return operator + trailing;

  const spoken = head
    // Parens become a *space*, never nothing: deleting them welds a function
    // onto its argument, and `TRY_CAST(RESULT_VALUE` was spoken as
    // "try castresult value".
    .replace(/[()']/g, " ")
    // `a.rn` and `dbo.patients` read as two words; `7.5` and `4548-4` do not.
    .replace(/([A-Za-z_])\.([A-Za-z_])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/%/g, " percent ")
    .replace(/\s+/g, " ")
    .trim();

  return spoken ? spoken + trailing : trailing;
}

/**
 * What one step is uttered as: what it does, then the clause itself.
 *
 * The role leads because it is the part that is not on the screen. A reader
 * looking at the query can see `WHERE`; what they cannot see is that it has
 * already run by the time `SELECT` is evaluated.
 */
export function stepText(step: SqlStep): string {
  const where = step.cte ? `${step.cte}: ` : "";
  return step.role ? `${where}${step.role}. ${step.text}` : `${where}${step.text}`;
}

/* ------------------------------------------------------------------ *
 * A .sql file as a document
 * ------------------------------------------------------------------ */

/**
 * Turn a SQL script into the markdown the parser already understands.
 *
 * A drill file is not a query with some comments in it. It is mostly *prose* —
 * the problem statement, why the technique matters, the trap — with the SQL as
 * punctuation between. Wrapping the whole file in one fence would silence 80%
 * of it, and feeding it in raw would read the delimiters and the operators
 * aloud as if they were sentences. Neither is the document the author wrote.
 *
 * So the two are separated on the one signal that is actually reliable in these
 * files: **a block comment starting its own line is prose; everything else is
 * SQL.** Line comments are deliberately left where they are — `-- NOTE: no 7.5
 * threshold here` explains why a filter is *absent* from the clause it sits in,
 * and moving it out of the query destroys the only reason it was written.
 *
 * A comment block whose first line is a rule of `=` or `-` takes its next line
 * as a heading, which is how these files are already written and what gives the
 * structure map something to work with — headings are what arm the intercepts,
 * so this is the difference between a drill set that can be enforced and one
 * that is just read. A block with no rule is plain prose.
 */
export function sqlToMarkdown(script: string): string {
  const blocks = inertSpans(script).filter(
    (s) => s.kind === "comment" && script.slice(s.start, s.start + 2) === "/*" && ownLine(script, s.start)
  );

  const out: string[] = [];
  let at = 0;

  const flushSql = (text: string) => {
    const body = text.trim();
    if (!body || !hasCode(body)) return;
    out.push("```sql\n" + body + "\n```");
  };

  for (const block of blocks) {
    flushSql(script.slice(at, block.start));
    out.push(commentToMarkdown(script.slice(block.start, block.end)));
    at = block.end;
  }
  flushSql(script.slice(at));

  return out.filter(Boolean).join("\n\n") + "\n";
}

function ownLine(text: string, i: number): boolean {
  let j = i - 1;
  while (j >= 0 && (text[j] === " " || text[j] === "\t")) j -= 1;
  return j < 0 || text[j] === "\n";
}

/** A run of `=` or `-` used as a rule rather than as content. */
const RULE = /^[=\-\u2014\u2013*\s]{4,}$/;

function commentToMarkdown(comment: string): string {
  const lines = comment
    .replace(/^\/\*+/, "")
    .replace(/\*+\/$/, "")
    .split("\n")
    // Leading `*` decoration on a continuation line, as in a javadoc-style box.
    .map((l) => l.replace(/^\s*\*(?!\/)\s?/, "").trimEnd());

  // Drop leading and trailing blanks, then read the first line.
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (!lines.length) return "";

  let heading = "";
  if (RULE.test(lines[0].trim())) {
    const level = lines[0].includes("=") ? "#" : "##";
    lines.shift();
    while (lines.length && !lines[0].trim()) lines.shift();
    if (lines.length) heading = `${level} ${lines.shift()!.trim()}`;
  }

  const body = lines
    .filter((l) => !RULE.test(l.trim()))
    .map((l) => l.replace(/^\s{0,6}/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return [heading, body].filter(Boolean).join("\n\n");
}

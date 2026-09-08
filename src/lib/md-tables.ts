import { flattenGrid, type GridData } from "./tables";

/**
 * Markdown pipe tables, folded into the grid path the PDF extractor uses.
 *
 * `tables.ts` recovers a grid from glyph coordinates, because that is all a PDF
 * leaves of one. A markdown table needs none of that — the author typed the
 * structure — but until now the parser had no idea it was looking at one, and
 * `grid-speech.test.ts` says so in a comment: "which is exactly what a plain
 * markdown pipe table produces — the parser does not recognise one."
 *
 * The cost of that was not theoretical. The reader keeps their own study notes
 * in this corpus, and those notes are mostly tables: `CCDA Discriminator
 * Matrix.md` is 86 table rows out of 148 lines, seven tables of near-synonym
 * pairs written specifically to be drilled. Every one of them was being read
 * aloud as "pipe Attributable pipe Who recorded the data pipe", and none of
 * them could ever raise a grid check — the one mechanism in the app built to
 * ask exactly the question those tables are for.
 *
 * ## Why a rewrite rather than a new block kind
 *
 * A folded table is emitted as an `fp-grid` fence and handed back to the line
 * loop, which already knows how to turn one into a `table` block with steps.
 * That is the same route PDF extraction takes, and for the same stated reason:
 * routing structure through the markdown intermediate keeps `source` a complete
 * record, so a schema migration can rebuild the document without re-reading the
 * original file. Nothing downstream — grid rendering, per-step speech, the grid
 * check, coverage — needs to learn a second shape.
 *
 * The rewrite is applied to the parser's working copy of the lines. The stored
 * `source` is still the markdown the reader supplied, so the fold re-runs on
 * every rebuild rather than being baked in.
 */

/**
 * A table is folded only if it would actually produce steps.
 *
 * Deliberately not `FLATTEN_MIN_STEPS`. That floor exists because a *detected*
 * grid can be half-recovered, and three cards of guessed structure are worse
 * than the prose they replace. Typed pipes are not a guess, so there is no
 * confidence to threshold — but a table that flattens to nothing must still be
 * left alone, or its text would be dropped from the document altogether.
 */
function worthFolding(grid: GridData): boolean {
  return flattenGrid(grid).length > 0;
}

/** A `|` that is not escaped as `\|`. */
function splitCells(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\" && line[i + 1] === "|") {
      cell += "|";
      i += 1;
      continue;
    }
    if (ch === "|") {
      cells.push(cell);
      cell = "";
      continue;
    }
    cell += ch;
  }
  cells.push(cell);

  // A leading and a trailing pipe are optional in GFM and produce an empty
  // cell at each end. Dropping them unconditionally would eat a genuinely
  // empty first or last column, so only the ones outside the outer pipes go.
  if (cells.length && !cells[0].trim() && line.trimStart().startsWith("|")) {
    cells.shift();
  }
  if (cells.length && !cells[cells.length - 1].trim() && line.trimEnd().endsWith("|")) {
    cells.pop();
  }
  return cells;
}

/** True for the `|---|:--:|` line that makes the row above it a header. */
function isDelimiter(line: string): boolean {
  if (!line.includes("|")) return false;
  const cells = splitCells(line);
  if (cells.length < 2) return false;
  return cells.every((c) => /^\s*:?-{1,}:?\s*$/.test(c));
}

/** True for a line that could be a table row: it has an unescaped pipe. */
function hasPipe(line: string): boolean {
  return splitCells(line).length > 1;
}

/**
 * The table starting at `start`, or null.
 *
 * A table is a header row, a delimiter row, and at least one body row.
 *
 * There is deliberately no minimum column count. A one-column table has no
 * column to report a value under and so flattens to nothing, which
 * `worthFolding` already refuses — and a width rule beside it would be a guard
 * no test could ever turn red.
 */
function readTable(
  lines: string[],
  start: number,
  clean: (s: string) => string
): { grid: GridData; end: number } | null {
  const headerLine = lines[start];
  if (!headerLine || !hasPipe(headerLine) || isDelimiter(headerLine)) return null;
  if (!isDelimiter(lines[start + 1] ?? "")) return null;

  const header = splitCells(headerLine).map((c) => clean(c));

  const rows: string[][] = [];
  let i = start + 2;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || !hasPipe(line)) break;

    // A row is snapped to the header's width: short rows are padded so a
    // missing trailing cell keeps its shape, and long ones are truncated
    // rather than inventing a column with no name. Same reasoning as `toGrid`.
    const cells = splitCells(line).map((c) => clean(c));
    const row = new Array<string>(header.length).fill("");
    for (let c = 0; c < header.length; c++) row[c] = cells[c] ?? "";
    if (row.some((c) => c)) rows.push(row);
  }

  if (!rows.length) return null;
  return { grid: { caption: null, header, rows }, end: i };
}

/**
 * Rewrite every markdown pipe table as an `fp-grid` fence.
 *
 * `clean` is the parser's own inline-markdown stripper, passed in rather than
 * imported so this module stays free of a cycle back through `parse.ts`. Cells
 * carry `**bold**` and links constantly — the discriminator tables bold every
 * term in their first column — and an unstripped cell would be both spoken and
 * displayed with its asterisks.
 */
export function foldPipeTables(
  lines: string[],
  clean: (s: string) => string,
  fence: string
): string[] {
  const out: string[] = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced blocks are copied through untouched. A pipe table inside a code
    // fence is a code sample of a pipe table, and the `fp-grid` fences the PDF
    // path emits must survive a second pass unchanged.
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }

    const table = readTable(lines, i, clean);
    if (table && worthFolding(table.grid)) {
      out.push("```" + fence);
      out.push(JSON.stringify(table.grid));
      out.push("```");
      i = table.end - 1;
      continue;
    }

    out.push(line);
  }

  return out;
}

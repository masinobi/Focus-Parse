/**
 * Grid detection for PDF pages.
 *
 * Tables survive PDF extraction as nothing but glyphs at coordinates, and the
 * ordinary prose path linearizes them into unreadable runs — a Schedule of
 * Assessments becomes a stream of visit names and checkmarks with no structure
 * at all. This module recovers the grid so it can be presented as a sequence
 * rather than read aloud as prose.
 *
 * Detection only: nothing here changes how a document is parsed or spoken.
 *
 * Deliberately independent of the rest of the parser — it takes plain glyph
 * records, so it can be run offline over a corpus to measure its hit rate.
 */

export interface Glyph {
  str: string;
  /** Left edge, in points. */
  x: number;
  /** Advance width, in points. */
  width: number;
  /** Baseline, in points, increasing upwards. */
  y: number;
  size: number;
}

export interface TableCell {
  text: string;
  x: number;
  /** Index of the column this cell snapped to, or -1 if it aligned to none. */
  column: number;
}

export interface TableRow {
  y: number;
  cells: TableCell[];
}

export interface DetectedTable {
  page: number;
  rows: TableRow[];
  /** Left edge of each recovered column, in points. */
  columns: number[];
  header: string[];
  caption: string | null;
  /** 0–1. Column alignment weighted by how much of a grid the run is. */
  confidence: number;
  /** Header or caption reads like a visit/assessment schedule. */
  looksLikeSchedule: boolean;
}

/**
 * Horizontal gap that separates cells, in multiples of body size. Word spacing
 * inside a cell runs well under half the body size; the narrowest real column
 * gap measured across the corpus was above one.
 */
const CELL_GAP_RATIO = 1.2;

/** A grid needs at least this many columns to be a grid rather than a list. */
const MIN_COLUMNS = 3;

/** ...and at least this many rows, so a wrapped heading cannot qualify. */
const MIN_ROWS = 3;

/** Cell x positions within this distance are the same column. */
const COLUMN_TOLERANCE_RATIO = 0.8;

/** A column must appear in this share of the run's rows. */
const COLUMN_PRESENCE = 0.5;

/**
 * Consecutive rows that fail the cell test before a run is abandoned.
 *
 * Real table rows wrap: a long first-column label continues on the next line
 * with nothing beside it, which splits into one cell, not three. Closing the
 * run there reports one table as several. The column check afterwards is what
 * keeps this tolerance from gluing genuinely separate tables together.
 */
const ROW_GAP_TOLERANCE = 2;

const SCHEDULE_WORDS =
  /schedule of (assessments|events|activities|procedures)|study (schedule|calendar)|visit schedule|flow ?chart/i;

/** Column headers typical of a visit schedule. */
const VISIT_WORDS =
  /^(screening|baseline|randomi[sz]ation|enrol|visit|week|day|month|cycle|follow[- ]?up|end of (study|treatment)|eos|eot|unscheduled)/i;

const CAPTION = /^(table|figure|exhibit)\s*\d+|schedule of/i;

function dominantSize(glyphs: Glyph[]): number {
  const weight = new Map<number, number>();
  for (const g of glyphs) {
    const key = Math.round(g.size);
    weight.set(key, (weight.get(key) ?? 0) + g.str.length);
  }
  let best = 10;
  let most = -1;
  weight.forEach((count, size) => {
    if (count > most) {
      most = count;
      best = size;
    }
  });
  return best || 10;
}

interface RawRow {
  y: number;
  glyphs: Glyph[];
}

function groupRows(glyphs: Glyph[]): RawRow[] {
  const rows: RawRow[] = [];
  for (const g of glyphs) {
    const tolerance = Math.max(2, g.size * 0.5);
    const row = rows.find((r) => Math.abs(r.y - g.y) <= tolerance);
    if (row) row.glyphs.push(g);
    else rows.push({ y: g.y, glyphs: [g] });
  }
  return rows.sort((a, b) => b.y - a.y);
}

/** Split one visual row into cells wherever a wide horizontal gap appears. */
function splitCells(row: RawRow, body: number): { x: number; text: string }[] {
  const sorted = row.glyphs.slice().sort((a, b) => a.x - b.x);
  const limit = body * CELL_GAP_RATIO;

  const groups: Glyph[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1];
    const gap = sorted[i].x - (previous.x + previous.width);
    if (gap > limit) groups.push([sorted[i]]);
    else groups[groups.length - 1].push(sorted[i]);
  }

  return groups
    .map((group) => ({
      x: group[0].x,
      text: group.map((g) => g.str).join("").replace(/\s+/g, " ").trim(),
    }))
    .filter((cell) => cell.text.length > 0);
}

/** Cluster cell x positions into columns present across most rows of the run. */
function recoverColumns(
  rows: { x: number; text: string }[][],
  body: number
): number[] {
  const tolerance = body * COLUMN_TOLERANCE_RATIO;
  const clusters: { x: number; rows: Set<number> }[] = [];

  rows.forEach((cells, rowIndex) => {
    for (const cell of cells) {
      const hit = clusters.find((c) => Math.abs(c.x - cell.x) <= tolerance);
      if (hit) {
        // Track the leftmost edge seen; wrapped cells indent slightly.
        hit.x = Math.min(hit.x, cell.x);
        hit.rows.add(rowIndex);
      } else {
        clusters.push({ x: cell.x, rows: new Set([rowIndex]) });
      }
    }
  });

  return clusters
    .filter((c) => c.rows.size >= Math.max(2, rows.length * COLUMN_PRESENCE))
    .map((c) => c.x)
    .sort((a, b) => a - b);
}

/**
 * Find grids on one page.
 *
 * A run of consecutive rows that each split into three or more cells is the
 * candidate; the columns those cells share is what confirms it. Prose never
 * produces three aligned break positions down several consecutive lines.
 */
export function detectTablesOnPage(
  glyphs: Glyph[],
  page: number
): DetectedTable[] {
  const usable = glyphs.filter((g) => g.str.trim().length > 0);
  if (usable.length < 12) return [];

  const body = dominantSize(usable);
  const rows = groupRows(usable);
  const celled = rows.map((r) => ({ y: r.y, cells: splitCells(r, body) }));

  const tables: DetectedTable[] = [];
  let start = -1;

  const closeRun = (endExclusive: number) => {
    if (start < 0) return;
    const run = celled.slice(start, endExclusive);
    const runStart = start;
    start = -1;
    if (run.length < MIN_ROWS) return;

    const columns = recoverColumns(run.map((r) => r.cells), body);
    if (columns.length < MIN_COLUMNS) return;

    const tolerance = body * COLUMN_TOLERANCE_RATIO;
    const snap = (x: number) =>
      columns.findIndex((c) => Math.abs(c - x) <= tolerance);

    let aligned = 0;
    let total = 0;
    const built: TableRow[] = run.map((r) => {
      const cells = r.cells.map((c) => {
        const column = snap(c.x);
        total += 1;
        if (column >= 0) aligned += 1;
        return { text: c.text, x: c.x, column };
      });
      return { y: r.y, cells };
    });

    const alignment = total ? aligned / total : 0;
    const confidence = alignment * Math.min(1, run.length / 6);

    // The nearest line above the run that reads like a caption.
    let caption: string | null = null;
    for (let i = runStart - 1; i >= Math.max(0, runStart - 4); i--) {
      const text = celled[i].cells.map((c) => c.text).join(" ").trim();
      if (text && CAPTION.test(text)) {
        caption = text;
        break;
      }
    }

    const header = built[0].cells.map((c) => c.text);
    const headerText = header.join(" ");
    const looksLikeSchedule =
      SCHEDULE_WORDS.test(headerText) ||
      SCHEDULE_WORDS.test(caption ?? "") ||
      header.filter((h) => VISIT_WORDS.test(h)).length >= 2;

    tables.push({
      page,
      rows: built,
      columns,
      header,
      caption,
      confidence,
      looksLikeSchedule,
    });
  };

  let gap = 0;
  let lastGood = -1;

  for (let i = 0; i < celled.length; i++) {
    if (celled[i].cells.length >= MIN_COLUMNS) {
      if (start < 0) start = i;
      lastGood = i;
      gap = 0;
      continue;
    }

    if (start < 0) continue;
    gap += 1;
    if (gap > ROW_GAP_TOLERANCE) {
      // Trim the trailing non-table rows back off the run.
      closeRun(lastGood + 1);
      gap = 0;
    }
  }
  closeRun(lastGood + 1);

  return tables;
}

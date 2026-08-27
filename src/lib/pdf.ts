import type { TextItem } from "pdfjs-dist/types/src/display/api";

import {
  detectTablesOnPage,
  flattenGrid,
  toGrid,
  FLATTEN_MIN_CONFIDENCE,
  FLATTEN_MIN_STEPS,
  type GridData,
} from "./tables";

/**
 * PDF ingestion.
 *
 * A PDF has no headers, paragraphs or lists — only glyphs at coordinates. This
 * module reconstructs the structure FocusParse needs from typography and
 * layout, and emits markdown so the result re-enters the ordinary parse path.
 *
 * Three things make real documents hard, and each is handled explicitly:
 *
 *  - **Multiple columns.** Glyphs at the same vertical position can belong to
 *    different columns or to a margin note. Merging them by row alone produces
 *    interleaved nonsense, so rows are split at wide horizontal gaps and the
 *    resulting segments are ordered column-band first, then top to bottom.
 *  - **Headings are not always bigger.** In journal typesetting a heading is
 *    frequently *smaller* than the body and set in a contrasting family. So
 *    heading detection keys on any deviation from the body style — size, family
 *    or weight — not on size alone.
 *  - **Furniture.** Running heads, folios and footnote markers are not prose.
 */

/**
 * One extracted glyph run. Exported, with `PageItems`, `assemble` and
 * `isBoldFont`, so the offline scanners can drive the *same* assembly the app
 * uses instead of re-implementing it — `extractPdf` itself is browser-only
 * (it loads the pdf.js worker from a URL), but everything after the glyphs
 * come out of pdf.js is pure and runs anywhere.
 */
export interface RawItem {
  str: string;
  x: number;
  xEnd: number;
  y: number;
  size: number;
  family: string;
  bold: boolean;
}

interface Line {
  text: string;
  size: number;
  family: string;
  bold: boolean;
  x: number;
  xEnd: number;
  y: number;
  band: number;
  page: number;
  /** True when the line sits in the top or bottom margin strip of the page. */
  edge: boolean;
  /** Present on the synthetic line that stands in for a recovered grid. */
  grid?: GridData;
  /**
   * Set on a heading rejoined from a wrap. It travels with the line because
   * classification runs again afterwards and has to apply the same looser word
   * cap the join was accepted under — otherwise a heading is merged and then
   * demoted by the very rule that admitted it, and the reader gets the whole
   * text as a paragraph and nothing in the structure map.
   */
  joined?: boolean;
}

export interface PageItems {
  items: RawItem[];
  width: number;
  height: number;
}

export interface PdfExtractProgress {
  page: number;
  pages: number;
}

/** Text this much larger than the body opens a top-level section. */
const H1_RATIO = 1.3;
/** Text this much larger than the body opens a sub-section. */
const H2_RATIO = 1.12;

/**
 * Superscript detection.
 *
 * Size alone is unreliable: markers here run 5.2–5.8pt against a body that is
 * 9pt on one page and 10pt on the next, so any fixed ratio catches some and
 * misses others. What is unambiguous is the *raise* — a marker's baseline sits
 * a few points above the text it follows, while a same-size numeral that is not
 * a citation (a page folio, a figure number) shares its neighbour's baseline
 * exactly.
 */
const SUPERSCRIPT_MAX_SIZE = 0.85;
const SUPERSCRIPT_MIN_RISE = 0.15;
const SUPERSCRIPT_MAX_RISE = 0.9;

/** Fallback when there is no preceding glyph to measure a raise against. */
const SUPERSCRIPT_RATIO = 0.62;

/**
 * What a footnote marker may consist of: digit runs with separators, roman
 * numerals, or the traditional reference symbols. Requiring this shape keeps
 * the rule from eating genuinely small prose.
 */
const MARKER_TEXT = /^[\s]*(\d{1,3}([,;–—-]\s*\d{1,3})*|[ivxlcdm]{1,6}|[IVXLCDM]{1,6}|[*†‡§¶‖]+)[\s]*$/;

/**
 * A row is also cut at a horizontal gap this wide, in multiples of the body
 * size. Column separation is handled by band detection; this only catches wide
 * table-like gaps that no gutter scan would find.
 */
const COLUMN_GAP_RATIO = 2.5;

/** Share of pages on which a repeated edge line counts as furniture. */
const RUNNING_HEAD_SHARE = 0.35;

/** Headings are short; a long line set large is prose. */
const MAX_HEADING_CHARS = 110;

/** And a heading is a label. Past this many words a large line is a sentence. */
const MAX_HEADING_WORDS = 14;

/**
 * The same cap for a heading rejoined from two lines.
 *
 * Looser, because a rejoin has already had to satisfy something no ordinary
 * line does: it wrapped. A paragraph does not reach the right edge of the
 * measure in a heading's type, at a heading's leading, with no sentence-ending
 * punctuation, and then continue in a shorter line of the same type. Holding a
 * rejoin to fourteen words cut real headings — measured on the vendor-selection
 * PDF, where "c) What to do when you have to oversee a vendor you did not
 * select?" is fifteen and was left in the map as "did not select?".
 */
const MAX_JOINED_HEADING_WORDS = 18;

/** Outline markers used for headings in structured guidance documents. */
const OUTLINE_MARKER = /^(\(?[a-z]\)|\(?[ivxlcdm]{1,5}\)|\d{1,2}(\.\d{1,2}){0,3}\.?)\s+\S/i;

/** Citations, affiliations and contact lines masquerading as headings. */
const FRONT_MATTER = /@|https?:|doi\.org|\bet al\.|,\s*[A-Z]{2}$|^\*/;

const LIST_MARKER = /^([•●▪◦·‣]|[-–—](?=\s))\s*/;
const NUMBERED = /^(\d{1,3})[.)]\s+/;

export function isBoldFont(family: string | undefined): boolean {
  return Boolean(family && /bold|black|heavy|semibold|-bd\b/i.test(family));
}

/** Char-weighted mode of a style dimension: whatever carries the most text. */
function dominant<T>(values: { key: T; weight: number }[]): T | undefined {
  const totals = new Map<T, number>();
  for (const { key, weight } of values) {
    totals.set(key, (totals.get(key) ?? 0) + weight);
  }
  let best: T | undefined;
  let most = -1;
  totals.forEach((total, key) => {
    if (total > most) {
      most = total;
      best = key;
    }
  });
  return best;
}

/* ------------------------------------------------------------------ *
 * Columns
 * ------------------------------------------------------------------ *
 *
 * Losing a gutter is not a small error. The rows are then read straight
 * across, so the left column's sentence and the right column's sentence
 * interleave a fragment at a time and the result is plausible-sounding
 * nonsense — worse than obviously broken text, because nothing announces it.
 * Measured before this existed: about a fifth of the two-column pages in the
 * corpus, ~25,000 words, including the page where the heading "5) Best
 * Practices" ended up inside "…in compliance with 21 CFR 5) Best Practices
 * 312.62(c) and 812.140(d)."
 *
 * Two independent detectors, because they fail on different pages:
 *
 *   1. `detectBandCuts` — a quiet vertical strip. Precise when it fires, but
 *      one full-width element that the table detector did not remove (a
 *      spanning heading, an undetected table) puts glyphs in the gutter bins
 *      and hides it for the *entire page*.
 *   2. `detectColumnStarts` — where the text begins. A body column has one
 *      left edge shared by most of its lines, and nothing crossing the gutter
 *      moves it. This sees what the first one cannot.
 *
 * The second is the looser rule, so it carries a check the first does not
 * need: a proposed cut is kept only if very few runs actually cross it. On a
 * single-column page with an indented list — two left edges, no gutter — every
 * full-width line crosses, and the cut is rejected.
 */

/** Left edges within this many points are the same column. */
const EDGE_BUCKET = 8;

/** Runs that must share a left edge before it counts as a column. */
const MIN_EDGE_SUPPORT = 6;

/** Two column starts closer than this are an indent, not a column. */
const MIN_COLUMN_SEPARATION = 100;

/** A gutter this far into the text is a margin note, not a column boundary. */
const MIN_GAP_RATIO = 0.3;

/**
 * Share of runs allowed to cross a proposed cut. A real gutter is crossed by
 * almost nothing — a running head, the odd figure. Anything more means the
 * page is one column and the second "start" was an indent.
 */
const MAX_STRADDLE_RATIO = 0.08;

/**
 * Find columns by where text starts.
 *
 * Deliberately independent of coverage: the whole point is to survive the
 * full-width element that defeats gutter detection.
 */
export function detectColumnStarts(items: RawItem[], body: number): number[] {
  if (items.length < 20) return [];

  const support = new Map<number, number>();
  let contentStart = Number.POSITIVE_INFINITY;
  let contentEnd = Number.NEGATIVE_INFINITY;

  for (const item of items) {
    contentStart = Math.min(contentStart, item.x);
    contentEnd = Math.max(contentEnd, item.xEnd);
    const bucket = Math.round(item.x / EDGE_BUCKET) * EDGE_BUCKET;
    support.set(bucket, (support.get(bucket) ?? 0) + 1);
  }

  const contentWidth = contentEnd - contentStart;
  if (!Number.isFinite(contentWidth) || contentWidth <= 0) return [];

  const edges = [...support.entries()]
    .filter(([, n]) => n >= MIN_EDGE_SUPPORT)
    .map(([x]) => x)
    .sort((a, b) => a - b);

  // Collapse edges that are really one column, keeping the leftmost.
  const starts: number[] = [];
  for (const x of edges) {
    if (!starts.length || x - starts[starts.length - 1] > MIN_COLUMN_SEPARATION) {
      starts.push(x);
    }
  }
  if (starts.length < 2) return [];

  const cuts: number[] = [];
  for (let i = 1; i < starts.length; i++) {
    if (starts[i] - starts[i - 1] < contentWidth * MIN_GAP_RATIO) continue;

    // Just left of the column's first glyph, so nothing in it is clipped.
    const cut = starts[i] - body * 0.5;
    const straddling = items.filter((it) => it.x < cut && it.xEnd > cut).length;
    if (straddling / items.length > MAX_STRADDLE_RATIO) continue;

    cuts.push(cut);
  }

  return cuts;
}

/**
 * Find vertical gutters: interior x-ranges that carry almost no text.
 *
 * Works in absolute points rather than page fractions, because the gap that
 * separates two columns is small — around 10pt in a typical journal layout,
 * barely 2% of the page — while the page's own margins are several times
 * wider. Scanning only between the leftmost and rightmost glyph keeps those
 * margins from being mistaken for gutters.
 *
 * Coverage is counted rather than boolean: one full-width element (a running
 * head, a title, a figure) would otherwise bridge the gutter and hide it.
 */
export function detectBandCuts(items: RawItem[], width: number, body: number): number[] {
  const BIN = 2; // points
  const bins = Math.max(1, Math.ceil(width / BIN));
  const coverage = new Array<number>(bins).fill(0);

  let contentStart = Number.POSITIVE_INFINITY;
  let contentEnd = Number.NEGATIVE_INFINITY;

  for (const item of items) {
    contentStart = Math.min(contentStart, item.x);
    contentEnd = Math.max(contentEnd, item.xEnd);
    const from = Math.max(0, Math.min(bins - 1, Math.floor(item.x / BIN)));
    const to = Math.max(0, Math.min(bins - 1, Math.floor(item.xEnd / BIN)));
    for (let b = from; b <= to; b++) coverage[b] += item.str.length;
  }

  if (!Number.isFinite(contentStart) || contentEnd <= contentStart) return [];

  const peak = Math.max(...coverage);
  if (peak <= 0) return [];

  const quiet = peak * 0.06;
  const contentWidth = contentEnd - contentStart;
  const minRun = Math.max(3, Math.ceil((body * 0.8) / BIN));
  const maxRun = Math.ceil((contentWidth * 0.3) / BIN);

  // Scan strictly inside the content box so page margins cannot qualify.
  const first = Math.floor(contentStart / BIN) + 1;
  const last = Math.floor(contentEnd / BIN) - 1;

  const cuts: number[] = [];
  let run = 0;

  for (let b = first; b <= last; b++) {
    if (coverage[b] <= quiet) {
      run += 1;
      continue;
    }
    if (run >= minRun && run <= maxRun) cuts.push((b - run / 2) * BIN);
    run = 0;
  }

  return cuts;
}

/**
 * A raised, undersized reference marker — the "13" in `time stamps.13`.
 * Measured against the previous glyph run in content-stream order, which is
 * reliably the text the marker is attached to.
 */
function isReferenceMarker(
  item: RawItem,
  previous: RawItem | undefined,
  body: number
): boolean {
  if (!MARKER_TEXT.test(item.str)) return false;

  if (!previous) return item.size < body * SUPERSCRIPT_RATIO;
  if (item.size > body * SUPERSCRIPT_MAX_SIZE) return false;

  const rise = item.y - previous.y;
  return rise >= body * SUPERSCRIPT_MIN_RISE && rise <= body * SUPERSCRIPT_MAX_RISE;
}

/** Group positioned glyph runs into visual lines, split by column band. */
function buildLines(page: PageItems, pageNumber: number, body: number): Line[] {
  /** Margin strip in which running heads and folios live. */
  const edgeBand = page.height * 0.075;
  // Drop reference markers before anything else sees them: they are neither
  // prose to read nor structure to detect.
  const items = page.items.filter(
    (item, i, all) =>
      item.size >= body * SUPERSCRIPT_RATIO &&
      !isReferenceMarker(item, all[i - 1], body)
  );
  if (!items.length) return [];

  // Gutter detection first — it is the precise one, and where it fires it is
  // right. Left-edge clustering only supplies what it missed, so a page that
  // already parses correctly is untouched.
  const gutters = detectBandCuts(items, page.width, body);
  const cuts = gutters.length ? gutters : detectColumnStarts(items, body);
  const bandOf = (x: number) => cuts.filter((cut) => cut < x).length;

  // Group into rows by baseline.
  const rows: RawItem[][] = [];
  for (const item of items) {
    const tolerance = Math.max(2, item.size * 0.5);
    const row = rows.find((r) => Math.abs(r[0].y - item.y) <= tolerance);
    if (row) row.push(item);
    else rows.push([item]);
  }

  const lines: Line[] = [];
  const gapLimit = body * COLUMN_GAP_RATIO;

  for (const row of rows) {
    const sorted = row.slice().sort((a, b) => a.x - b.x);

    // Cut the row wherever a wide horizontal gap or a band boundary occurs.
    let segment: RawItem[] = [sorted[0]];
    const segments: RawItem[][] = [segment];

    for (let i = 1; i < sorted.length; i++) {
      const previous = sorted[i - 1];
      const current = sorted[i];
      const gap = current.x - previous.xEnd;
      const crossesBand = bandOf(current.x) !== bandOf(previous.x);

      if (gap > gapLimit || crossesBand) {
        segment = [current];
        segments.push(segment);
      } else {
        segment.push(current);
      }
    }

    for (const parts of segments) {
      let text = "";
      let cursor: number | null = null;

      for (const part of parts) {
        if (
          cursor !== null &&
          part.x - cursor > part.size * 0.18 &&
          !text.endsWith(" ") &&
          !part.str.startsWith(" ")
        ) {
          text += " ";
        }
        text += part.str;
        cursor = part.xEnd;
      }

      text = text.replace(/\s+/g, " ").trim();
      if (!text) continue;

      lines.push({
        text,
        size: dominant(parts.map((p) => ({ key: Math.round(p.size * 2) / 2, weight: p.str.length }))) ?? parts[0].size,
        family: dominant(parts.map((p) => ({ key: p.family, weight: p.str.length }))) ?? parts[0].family,
        bold: parts.some((p) => p.bold),
        x: parts[0].x,
        xEnd: parts[parts.length - 1].xEnd,
        y: parts[0].y,
        band: bandOf(parts[0].x),
        page: pageNumber,
        edge:
          parts[0].y >= page.height - edgeBand || parts[0].y <= edgeBand,
      });
    }
  }

  // Reading order: finish a column before moving to the next.
  return lines.sort((a, b) => (a.band !== b.band ? a.band - b.band : b.y - a.y));
}

function normalizeFurniture(text: string): string {
  return text.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Drop running heads, running feet and folios: lines in a page's margin strip
 * whose text (with digits masked) repeats across many pages.
 */
function stripFurniture(pages: Line[][]): Line[][] {
  const counts = new Map<string, number>();

  for (const lines of pages) {
    if (lines.length < 3) continue;
    for (const line of lines) {
      if (!line.edge) continue;
      const key = normalizeFurniture(line.text);
      if (key.length > 0 && key.length < 90) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }

  const threshold = Math.max(2, Math.floor(pages.length * RUNNING_HEAD_SHARE));

  return pages.map((lines) =>
    lines.filter((line) => {
      if (/^(page\s+)?[ivxlcdm\d]{1,6}$/i.test(line.text.trim())) return false;
      if (!line.edge || lines.length < 3) return true;
      return (counts.get(normalizeFurniture(line.text)) ?? 0) < threshold;
    })
  );
}

interface BodyStyle {
  size: number;
  family: string;
}

function bodyStyle(lines: Line[]): BodyStyle {
  const size =
    dominant(lines.map((l) => ({ key: Math.round(l.size * 2) / 2, weight: l.text.length }))) ?? 10;
  const family = dominant(lines.map((l) => ({ key: l.family, weight: l.text.length }))) ?? "serif";
  return { size, family };
}

interface HeadingVerdict {
  level: 1 | 2;
  /** Size-based headings stand alone; style-based ones need corroboration. */
  strong: boolean;
}

function headingVerdict(
  line: Line,
  body: BodyStyle,
  maxWords: number = MAX_HEADING_WORDS
): HeadingVerdict | null {
  const text = line.text.trim();
  if (!text || text.length > MAX_HEADING_CHARS) return null;
  if (LIST_MARKER.test(text)) return null;
  if (/[.;,:]$/.test(text) && !OUTLINE_MARKER.test(text)) return null;
  // A heading is a label, not a sentence, and not a lone symbol or dingbat.
  if (text.split(/\s+/).length > maxWords) return null;
  if (text.replace(/[^A-Za-z]/g, "").length < 3) return null;
  // Journal front matter — citations, affiliations, contact lines — is set in
  // the same contrasting style as headings but is not structure.
  if (FRONT_MATTER.test(text)) return null;

  if (line.size >= body.size * H1_RATIO) return { level: 1, strong: true };
  if (line.size >= body.size * H2_RATIO) return { level: 2, strong: true };

  // Contrasting family or weight at roughly body size: the journal-heading
  // case, where the heading is set smaller and sans-serif against serif body.
  const contrasting = line.family !== body.family || line.bold;
  if (contrasting) {
    if (OUTLINE_MARKER.test(text)) return { level: 2, strong: false };
    if (text.length <= 80) return { level: 2, strong: false };
  }

  return null;
}

/**
 * Classify every line, then demote weak headings that sit inside a long run of
 * other weak headings. A heading introduces prose; three or more contrasting
 * lines in a row are an author list, an affiliation block, a caption or a
 * table, none of which should become a section.
 *
 * A run of two survives, because a section header immediately followed by its
 * first sub-header is ordinary.
 */
const MAX_HEADING_RUN = 2;

function classifyHeadings(lines: Line[], body: BodyStyle): (1 | 2 | null)[] {
  const verdicts = lines.map((line) =>
    headingVerdict(line, body, line.joined ? MAX_JOINED_HEADING_WORDS : MAX_HEADING_WORDS)
  );
  const levels: (1 | 2 | null)[] = verdicts.map((v) => (v ? v.level : null));

  let runStart = 0;
  for (let i = 0; i <= verdicts.length; i++) {
    if (i < verdicts.length && verdicts[i]) continue;

    const run = i - runStart;
    if (run > MAX_HEADING_RUN) {
      for (let j = runStart; j < i; j++) {
        // Size-based headings are trusted even in a run; style-based are not.
        if (!verdicts[j]?.strong) levels[j] = null;
      }
    }
    runStart = i + 1;
  }

  // A weak heading must also be followed by prose: it introduces something.
  for (let i = 0; i < levels.length; i++) {
    if (!levels[i] || verdicts[i]?.strong) continue;
    if (i + 1 >= levels.length || levels[i + 1] !== null) levels[i] = null;
  }

  // A heading with nothing after it introduces nothing.
  const last = levels.length - 1;
  if (last >= 0 && levels[last] && !verdicts[last]?.strong) levels[last] = null;

  return levels;
}

/**
 * Notes an offline report can ask `assemble` to keep about what it did.
 *
 * The scanners exist so a parsing rule is measured against the real corpus
 * rather than argued about, and a rule that silently rewrites the text needs
 * this more than most: both the joins it makes and the ones it abandons are
 * things a reader would otherwise have to notice by ear.
 */
export interface AssembleNotes {
  /**
   * Headings rejoined from more than one line. `parts` are the lines as the
   * page set them and `text` is what came out — kept separately rather than
   * recoverable from each other, because a hyphenated wrap loses a character at
   * the seam and a report that reconstructed one from the other would
   * mis-attribute that as text the join had eaten.
   */
  wrapped: { parts: string[]; text: string }[];
  /** Pairs that looked wrapped but whose join stopped reading as a heading. */
  declined: string[];
}

/** Leading, in multiples of the line's own size, that still reads as one wrap. */
const WRAP_LEADING_RATIO = 1.7;

/** How near the band's right edge the first half must reach, in body sizes. */
const WRAP_FILL_SLACK = 3;

/** Most lines one heading may be rejoined from. */
const MAX_WRAP_LINES = 3;

/** Share of lines allowed to overhang the right edge before it is the edge. */
const EDGE_PERCENTILE = 0.9;

/**
 * Where a band's text block actually ends.
 *
 * The maximum would do if every page were tidy, but one overhanging run — a
 * stray footnote marker, a rule, an undetected table cell — would put the edge
 * where no prose ever reaches and switch the wrap test off for the whole page.
 * A high percentile ignores a few such lines and still lands on the measure.
 */
function rightEdgeOf(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * EDGE_PERCENTILE))];
}

/** Same type, to within the rounding pdf.js does on a transform. */
function sameType(a: Line, b: Line): boolean {
  return Math.abs(a.size - b.size) < 0.6 && a.family === b.family && a.bold === b.bold;
}

/**
 * Rejoin a heading the measure broke across two lines.
 *
 * Both halves reach `classifyHeadings` as heading-styled lines, and the rule
 * that a weak heading must introduce prose then deletes *the first half* — it
 * is followed by a heading rather than by text. So the structure map is handed
 * "Within an EDC System", and "6) What it Means to Design a Study Application"
 * is not merely missing from the map, it is glued to the end of the paragraph
 * above and read aloud there. Both halves are damaged; only one of them shows.
 *
 * The join has to be narrow, because two heading-styled lines in a row are also
 * what a section header immediately followed by its first sub-header looks
 * like, and merging those would assert a heading neither line claims. What
 * separates the two cases is physical rather than textual: a heading wraps
 * because it **ran out of measure**, so its first line reaches the right edge
 * of the text block and its continuation does not. Two consecutive headings are
 * two short lines, both well inside it.
 *
 * Everything else here corroborates that one signal — identical type, single
 * line of leading, no sentence-ending punctuation, no second outline marker —
 * and the join is abandoned outright if what comes out no longer reads as a
 * heading. Half a heading in the structure map is a defect; a paragraph
 * promoted to a heading is a worse one.
 */
function mergeWrappedHeadings(
  lines: Line[],
  body: BodyStyle,
  notes?: AssembleNotes
): Line[] {
  const edges = new Map<number, number[]>();
  for (const line of lines) {
    // A grid rides through as a stand-in line spanning the page. It ends where
    // no prose does, so it must not be allowed to define where prose ends.
    if (line.grid) continue;
    edges.set(line.band, [...(edges.get(line.band) ?? []), line.xEnd]);
  }
  const rightEdge = new Map<number, number>();
  edges.forEach((values, band) => rightEdge.set(band, rightEdgeOf(values)));

  const out: Line[] = [];
  let i = 0;

  while (i < lines.length) {
    let head = lines[i];
    let verdict = head.grid ? null : headingVerdict(head, body);
    const parts = [head.text.trim()];
    let taken = 1;

    while (verdict && taken < MAX_WRAP_LINES) {
      const next = lines[i + taken];
      if (!next || next.grid) break;
      if (next.band !== head.band || next.page !== head.page) break;
      if (!sameType(head, next)) break;

      // A wrap is one heading, so both halves are set as the same level. An H1
      // followed by its first H2 differs here and is left alone.
      const continuing = headingVerdict(next, body);
      if (!continuing || continuing.level !== verdict.level) break;

      // One line of leading. Anything more is space between two things.
      const gap = head.y - next.y;
      if (gap <= 0 || gap > head.size * WRAP_LEADING_RATIO) break;

      // The signal itself: this line ran out of room and the next one did not.
      const edge = rightEdge.get(head.band) ?? head.xEnd;
      if (head.xEnd < edge - body.size * WRAP_FILL_SLACK) break;
      if (next.xEnd >= head.xEnd) break;

      // A sentence does not wrap into a heading, and a second marker or bullet
      // is a second heading rather than the rest of this one.
      const tail = next.text.trim();
      if (/[.!?:;]$/.test(head.text.trim())) break;
      if (OUTLINE_MARKER.test(tail) || LIST_MARKER.test(tail) || NUMBERED.test(tail)) break;

      const stem = head.text.trim();
      const text =
        stem.endsWith("-") && /^[a-z]/.test(tail)
          ? stem.slice(0, -1) + tail
          : `${stem} ${tail}`;

      const candidate: Line = {
        ...head,
        text,
        xEnd: Math.max(head.xEnd, next.xEnd),
        joined: true,
      };
      const merged = headingVerdict(candidate, body, MAX_JOINED_HEADING_WORDS);
      // The join still lives by a heading's rules, and is abandoned where it
      // stops satisfying them. Half a heading in the structure map is a defect;
      // a paragraph promoted to a heading is a worse one.
      if (!merged || merged.level !== verdict.level) {
        notes?.declined.push(`${stem} / ${tail}`);
        break;
      }

      head = candidate;
      verdict = merged;
      parts.push(tail);
      taken += 1;
    }

    if (taken > 1) notes?.wrapped.push({ parts, text: head.text.trim() });
    out.push(head);
    i += taken;
  }

  return out;
}

/** Join wrapped lines into paragraphs and emit markdown. */
function toMarkdown(pages: Line[][], body: BodyStyle, notes?: AssembleNotes): string {
  const out: string[] = [];
  let paragraph = "";
  let previous: Line | null = null;

  const flush = () => {
    const text = paragraph.trim();
    if (text) out.push(text, "");
    paragraph = "";
  };

  for (const page of pages) {
    // Before classification, not after: the rule that demotes a heading
    // followed by another heading is exactly what destroys a wrapped one, so
    // the halves have to be one line by the time it runs.
    const lines = mergeWrappedHeadings(page, body, notes);
    const levels = classifyHeadings(lines, body);

    lines.forEach((line, index) => {
      // A recovered grid rides through the markdown intermediate as a fenced
      // payload, so it lands in the document at the position it occupied on
      // the page.
      if (line.grid) {
        flush();
        out.push("```fp-grid", JSON.stringify(line.grid), "```", "");
        previous = null;
        return;
      }

      const level = levels[index];

      if (level) {
        flush();
        out.push(`${level === 1 ? "#" : "##"} ${line.text}`, "");
        previous = null;
        return;
      }

      const bullet = LIST_MARKER.test(line.text);
      const numbered = NUMBERED.test(line.text);
      const text = bullet ? `- ${line.text.replace(LIST_MARKER, "")}` : line.text;

      const sameFlow = previous !== null && previous.band === line.band;
      const gap = sameFlow && previous ? previous.y - line.y : Number.POSITIVE_INFINITY;

      const newBlock =
        !previous ||
        !sameFlow ||
        bullet ||
        numbered ||
        gap > body.size * 1.75 ||
        (previous !== null &&
          line.x > previous.x + body.size * 0.8 &&
          /[.!?]["'”’)]?$/.test(previous.text));

      if (newBlock) {
        flush();
        paragraph = text;
      } else if (paragraph.endsWith("-") && /^[a-z]/.test(text)) {
        // Word broken across a line break.
        paragraph = paragraph.slice(0, -1) + text;
      } else {
        paragraph = `${paragraph} ${text}`;
      }

      previous = line;
    });
    previous = null; // never flow a paragraph across a page break blindly
  }

  flush();
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Turn extracted pages into markdown.
 *
 * `notes` is for the offline scanners, which drive this same function over the
 * real corpus so a report and the parser can never disagree about what the
 * parser does.
 */
export function assemble(pages: PageItems[], notes?: AssembleNotes): string {
  const allItems = pages.flatMap((p) => p.items);
  if (!allItems.length) return "";

  const roughBody =
    dominant(allItems.map((i) => ({ key: Math.round(i.size * 2) / 2, weight: i.str.length }))) ?? 10;

  const lined = pages.map((page, i) => {
    const grids = detectTablesOnPage(
      page.items.map((it) => ({
        str: it.str,
        x: it.x,
        width: it.xEnd - it.x,
        y: it.y,
        size: it.size,
      })),
      i + 1
    )
      .filter((t) => t.confidence >= FLATTEN_MIN_CONFIDENCE)
      .map((t) => ({ table: t, grid: toGrid(t) }))
      .filter(({ grid }) => flattenGrid(grid).length >= FLATTEN_MIN_STEPS);

    // A grid's glyphs must leave the prose stream, or the same content is both
    // flattened into steps and linearized into the unreadable run this exists
    // to replace.
    const spans = grids.map(({ table }) => {
      const ys = table.rows.map((r) => r.y);
      return { top: Math.max(...ys), bottom: Math.min(...ys) };
    });

    const prose: PageItems = {
      ...page,
      items: page.items.filter(
        (it) => !spans.some((s) => it.y <= s.top + 2 && it.y >= s.bottom - 2)
      ),
    };

    const lines = buildLines(prose, i + 1, roughBody);

    grids.forEach(({ grid }, g) => {
      lines.push({
        text: "",
        size: roughBody,
        family: "grid",
        bold: false,
        x: 0,
        xEnd: page.width,
        y: spans[g].top,
        band: 0,
        page: i + 1,
        edge: false,
        grid,
      });
    });

    return lines.sort((a, b) => (a.band !== b.band ? a.band - b.band : b.y - a.y));
  });
  const cleaned = stripFurniture(lined);
  const flat = cleaned.flat();
  if (!flat.length) return "";

  return toMarkdown(cleaned, bodyStyle(flat), notes);
}

/**
 * Extract a PDF into markdown. Runs entirely in the browser; the file never
 * leaves the machine.
 */
export async function extractPdf(
  data: ArrayBuffer,
  onProgress?: (progress: PdfExtractProgress) => void
): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  const doc = await pdfjs.getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  const pages: PageItems[] = [];

  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const styles = content.styles as Record<string, { fontFamily?: string }>;

    const items: RawItem[] = [];
    for (const raw of content.items) {
      if (!("str" in raw)) continue;
      const item = raw as TextItem;
      if (!item.str.trim()) continue;

      const size = Math.abs(item.transform[3]) || Math.abs(item.transform[0]) || 10;
      const x = item.transform[4];
      const width = item.width ?? 0;

      items.push({
        str: item.str,
        x,
        xEnd: x + width,
        y: item.transform[5],
        size,
        family: styles[item.fontName]?.fontFamily ?? "unknown",
        bold: isBoldFont(styles[item.fontName]?.fontFamily),
      });
    }

    pages.push({ items, width: viewport.width, height: viewport.height });
    page.cleanup();
    onProgress?.({ page: n, pages: doc.numPages });
  }

  await doc.destroy();
  return assemble(pages);
}

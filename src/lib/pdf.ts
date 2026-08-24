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

/** Outline markers used for headings in structured guidance documents. */
const OUTLINE_MARKER = /^(\(?[a-z]\)|\(?[ivxlcdm]{1,5}\)|\d{1,2}(\.\d{1,2}){0,3}\.?)\s+\S/i;

/** Citations, affiliations and contact lines masquerading as headings. */
const FRONT_MATTER = /@|https?:|doi\.org|et al\.|,\s*[A-Z]{2}$|^\*/;

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

  const cuts = detectBandCuts(items, page.width, body);
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

function headingVerdict(line: Line, body: BodyStyle): HeadingVerdict | null {
  const text = line.text.trim();
  if (!text || text.length > MAX_HEADING_CHARS) return null;
  if (LIST_MARKER.test(text)) return null;
  if (/[.;,:]$/.test(text) && !OUTLINE_MARKER.test(text)) return null;
  // A heading is a label, not a sentence, and not a lone symbol or dingbat.
  if (text.split(/\s+/).length > 14) return null;
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
  const verdicts = lines.map((line) => headingVerdict(line, body));
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

/** Join wrapped lines into paragraphs and emit markdown. */
function toMarkdown(pages: Line[][], body: BodyStyle): string {
  const out: string[] = [];
  let paragraph = "";
  let previous: Line | null = null;

  const flush = () => {
    const text = paragraph.trim();
    if (text) out.push(text, "");
    paragraph = "";
  };

  for (const lines of pages) {
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

/** Turn extracted pages into markdown. */
export function assemble(pages: PageItems[]): string {
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

  return toMarkdown(cleaned, bodyStyle(flat));
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

/**
 * Filtering the structure map by name.
 *
 * The map is one row per heading, and for most of this corpus that is a list
 * you can take in at a glance — twelve rows for 21 CFR Part 11, forty-five for
 * the vendor chapter. The full GCDMP is **755 rows**: 39 chapter headings and
 * 716 headings inside them. Scrolling that to find "Metrics for Data Quality"
 * is not navigation, and the rows repeat — every one of the 39 chapters has an
 * "Introduction", a "Scope", a "Minimum Standards", a "Best Practices" and a
 * "References". A bare list of matches for "minimum standards" would be
 * twenty-five identical rows.
 *
 * So a hit has to carry the chapter it belongs to, and the query has to reach
 * the chapter as well as the heading.
 */

/** The little a filter needs to know about a row of the map. */
export interface OutlineRow {
  title: string;
  /** 0 is the document title, 1 a chapter, 2 and 3 headings inside one. */
  level: number;
}

/** Case and spacing are noise here; PDF headings arrive with both. */
function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * The chapter each row sits under: the nearest row above it at a shallower
 * level, or null for a row that is already top of its document.
 *
 * Nearest-shallower rather than nearest-level-1, because the corpus does not
 * agree on where numbering starts. Three PDFs open with a level 0 document
 * title and put their chapters at level 1; the GCDMP has no level 0 at all and
 * its chapters *are* level 1; the two markdown guides start at 1 and nest to 3.
 * Asking for "the heading above this one that outranks it" is the same question
 * in all three.
 */
export function chapterTitles(rows: OutlineRow[]): (string | null)[] {
  const out: (string | null)[] = [];
  /** Innermost enclosing title at each level seen so far. */
  const stack: { level: number; title: string }[] = [];

  for (const row of rows) {
    while (stack.length && stack[stack.length - 1].level >= row.level) stack.pop();
    out.push(stack.length ? stack[stack.length - 1].title : null);
    stack.push({ level: row.level, title: row.title });
  }
  return out;
}

/**
 * Rows to show for a query, by index, or `null` for "no query" — which is not
 * the same as "no matches" and must leave the map exactly as it was.
 *
 * A row matches when the query appears in its own title **or in its chapter's**.
 * One rule, and it covers both things a reader is doing here: typing a chapter
 * name opens that chapter, typing a heading name finds it wherever it is.
 * Without the second half, "privacy" would return one row and clicking it would
 * be the only way in; with it, the Data Privacy chapter and its 30 headings come
 * back together.
 *
 * Substring, not similarity. The heading text is right there on screen and the
 * reader is completing something they can see, so a match that has to be
 * explained is worse than no match — the same reasoning as the blueprint
 * matcher, which had to refuse "Assuring Data Quality" for "Measuring Data
 * Quality" one word away.
 */
export function searchOutline(rows: OutlineRow[], query: string): number[] | null {
  const needle = normalize(query);
  if (!needle) return null;

  const chapters = chapterTitles(rows);
  const hits: number[] = [];

  for (let i = 0; i < rows.length; i++) {
    const own = normalize(rows[i].title).includes(needle);
    const chapter = chapters[i] !== null && normalize(chapters[i]!).includes(needle);
    if (own || chapter) hits.push(i);
  }
  return hits;
}

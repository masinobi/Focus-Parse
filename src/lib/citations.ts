/**
 * The regulations this corpus cites, and where each provision is discussed.
 *
 * A cross-reference in these documents almost never points somewhere the reader
 * can go. Counting them: roughly 356 across 255,000 words, and the great
 * majority name a regulation rather than a place in the text — `21 CFR Part 11
 * section 11.10`, `ICH E6 section 5.1.3`, `21 CFR Part 312 section 312.57`. Of
 * those regulations only E6 is in the library at all, so the natural feature —
 * a drawer that opens the referenced text beside the prose — would have nothing
 * to open on most clicks, and the local ones are worse: every chapter of the
 * GCDMP handbook has its own `Table 1`, so a resolver would jump confidently to
 * the wrong table most of the time.
 *
 * What the count actually reveals is more useful. The corpus is saturated with
 * citations to a small set of named regulations, the same provisions recur
 * across documents that emphasise different things about them, and that is
 * exam material. The entity index cannot see any of it: `21 CFR Part 11` is not
 * a term, it is a *provision*, and `quiz.ts` deliberately throws these away
 * (`isStructuralReference`) because "Section ____" is a lookup rather than a
 * fact.
 *
 * So: an index, keyed by regulation and provision, that says where else each
 * one is discussed.
 *
 * ## Refusing rather than guessing
 *
 * The same rule as `blueprint-coverage.ts`, for the same reason. A bare
 * `section 5.0` is not a citation — it is ambiguous between ICH E6's quality
 * management section and the fifth section of whatever document is being read,
 * and nothing in the sentence settles it. A regex generous enough to catch the
 * first will silently manufacture the second, and a wrong citation looks
 * exactly like a right one.
 *
 * A citation is therefore only recognised when a regulation is *named*: the
 * provision is read from the text following an anchor, never on its own. And a
 * bare `Part 11` is only an anchor for the parts in `PARTS`, which is a list
 * rather than a pattern — `\bPart \d+\b` matches "part 1, subpart J of this
 * chapter" forty times inside the Part 11 rule itself, and "Part 3 of the data
 * management plan" everywhere else.
 */

/** Bumped when the rules below change, so a stale index rebuilds itself. */
export const CITATION_SCHEMA = 1;

/**
 * FDA parts that are unambiguous in this corpus without "CFR" beside them.
 *
 * Deliberately short. Every entry is a rule a clinical data manager is examined
 * on; the parts left out are real CFR parts that appear only inside Part 11's
 * own scope list ("records required to be maintained by part 117 of this
 * chapter") and would bury the index in food-safety regulation.
 */
export const PARTS: Record<string, string> = {
  "11": "Electronic Records; Electronic Signatures",
  "50": "Protection of Human Subjects",
  "54": "Financial Disclosure by Clinical Investigators",
  "56": "Institutional Review Boards",
  "312": "Investigational New Drug Application",
  "314": "Applications for FDA Approval to Market a New Drug",
  "812": "Investigational Device Exemptions",
  "820": "Quality System Regulation",
};

/** Named regulations with no part or revision to canonicalise. */
const NAMED: Record<string, string> = {
  hipaa: "HIPAA",
  gdpr: "EU GDPR",
  "ich gcp": "ICH GCP",
};

export interface Citation {
  /** Canonical name, e.g. `21 CFR Part 11`, `ICH E6(R2)`, `HIPAA`. */
  regulation: string;
  /**
   * The provision within it — `11.10`, `5.1.3`, `Chapter 2`, `Appendix C` — or
   * null when the citation names only the regulation, which is most of them.
   */
  provision: string | null;
  /** As written, so a reader can see what was matched. */
  text: string;
  /** Character span within the string searched. */
  start: number;
  end: number;
}

/*
 * The anchors. Order matters: the first alternative that matches at a position
 * wins, so the more specific forms come first — `Title 21 CFR Part 11` must not
 * be read as a bare `Part 11` sitting inside it.
 */
const ANCHOR = new RegExp(
  [
    // 21 CFR 11 · 21 CFR Part 312 · Title 21 CFR Part 11
    String.raw`(?:Title\s+)?(\d{1,2})\s*C\.?F\.?R\.?\s*(?:Part\s*)?(\d{1,3})`,
    // ICH E6(R2) · ICH E6 (R3) · E6(R2)
    String.raw`(?:ICH\s+)?(E6)\s*\(\s*(R[123])\s*\)`,
    // ICH E6 · ICH E9 · ICH M2 · ICH Q9
    String.raw`ICH\s+((?:E|M|Q|S)\d{1,2})`,
    // ICH GCP · HIPAA · GDPR
    String.raw`(ICH\s+GCP|HIPAA|GDPR)`,
    // A bare part, from the list only.
    String.raw`Parts?\s+(${Object.keys(PARTS).join("|")})\b`,
  ].join("|"),
  "gi"
);

/**
 * A provision immediately following an anchor.
 *
 * Anchored at the start on purpose: this is only ever run against the slice
 * that begins where the anchor ended, so it cannot reach across a sentence and
 * attach a section number to a regulation named two clauses earlier.
 */
const PROVISION =
  /^[\s,;]*(?:(?:§+|sections?|secs?|chapters?|appendix|appendices|annexe?s?|parts?)\.?\s*)?([0-9]+(?:\.[0-9]+)*|[IVX]{1,5}\b|[A-C]\b)/i;

/** Words that read as a provision label but introduce prose, not a number. */
const PROVISION_KEYWORD =
  /^[\s,;]*(?:§+|sections?|secs?|chapters?|appendix|appendices|annexe?s?)\b/i;

function canonical(m: RegExpExecArray): string | null {
  const [, cfrTitle, cfrPart, e6, e6rev, ichCode, named, barePart] = m;

  if (cfrTitle && cfrPart) {
    // Only title 21 is in scope here; 45 CFR (HIPAA) is cited by name in this
    // corpus and 42 CFR does not appear at all.
    if (cfrTitle !== "21") return `${cfrTitle} CFR Part ${cfrPart}`;
    return `21 CFR Part ${cfrPart}`;
  }
  if (e6) return e6rev ? `ICH ${e6}(${e6rev.toUpperCase()})` : "ICH E6";
  if (ichCode) return `ICH ${ichCode.toUpperCase()}`;
  if (named) return NAMED[named.toLowerCase().replace(/\s+/g, " ")] ?? named;
  if (barePart) return `21 CFR Part ${barePart}`;
  return null;
}

/**
 * Spans a citation may not be found inside.
 *
 * URLs, and the reason is a real one from the corpus: the GCDMP bibliography
 * links `http://www.access.gpo.gov/nara/cfr/waisidx_02/45cfr164_02.html`, and
 * `45cfr164` is a perfectly good match for the CFR anchor — the pattern allows
 * the spaces to be absent because prose writes `45CFR164` too. It is a genuine
 * reference to the HIPAA Security Rule and it is still not a citation the
 * reader can act on: it is a link in a reference list, and treating one as
 * prose means every URL in the corpus becomes a candidate.
 *
 * The same idea as `inertSpans` in `sql.ts`: some regions of the text are not
 * text for this purpose.
 */
const INERT = /https?:\/\/\S+|\bwww\.\S+|\S+\.(?:html?|pdf|aspx?)\b/gi;

function inertMask(text: string): Uint8Array {
  const mask = new Uint8Array(text.length);
  INERT.lastIndex = 0;
  for (const m of text.matchAll(INERT)) {
    const start = m.index ?? 0;
    for (let i = start; i < start + m[0].length && i < text.length; i++) {
      mask[i] = 1;
    }
  }
  return mask;
}

/**
 * Every regulation cited in a stretch of text, with its provision when it has
 * one.
 *
 * Overlaps are impossible by construction — the scan advances past each match —
 * which matters because the anchors deliberately nest: `Title 21 CFR Part 11`
 * contains `Part 11`, and emitting both would double every citation in the
 * corpus.
 */
export function findCitations(text: string): Citation[] {
  const out: Citation[] = [];
  const mask = inertMask(text);
  ANCHOR.lastIndex = 0;

  let m: RegExpExecArray | null;
  while ((m = ANCHOR.exec(text)) !== null) {
    if (mask[m.index]) continue;
    const regulation = canonical(m);
    if (!regulation) continue;

    const anchorEnd = m.index + m[0].length;
    let end = anchorEnd;
    let provision: string | null = null;

    const rest = text.slice(anchorEnd, anchorEnd + 48);
    const p = PROVISION.exec(rest);
    if (p) {
      // A number on its own only counts as a provision when it is introduced as
      // one, or when it extends the part it follows: `Part 11 11.10` is a
      // provision, `Part 11 1998` is a date and `Part 11 and Part 50` is two
      // citations.
      const introduced = PROVISION_KEYWORD.test(rest);
      const extendsPart = /^\d+\.\d/.test(p[1]) || /^[IVX]{1,5}$/i.test(p[1]);
      if (introduced || extendsPart) {
        provision = p[1].toUpperCase();
        end = anchorEnd + p[0].length;
      }
    }

    out.push({
      regulation,
      provision,
      text: text.slice(m.index, end).replace(/\s+/g, " ").trim(),
      start: m.index,
      end,
    });
    ANCHOR.lastIndex = end;
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * Indexing a corpus
 * ------------------------------------------------------------------ */

export interface CitationSite {
  docId: string;
  docTitle: string;
  /** Section the citation sits in, for the label and for seeking. */
  section: number;
  sectionTitle: string;
  /** Token to seek to, so the reader can go and read the sentence. */
  tokenIndex: number;
  text: string;
}

export interface ProvisionEntry {
  provision: string | null;
  sites: CitationSite[];
  /** Documents that cite it, which is the number worth showing. */
  documents: number;
}

export interface RegulationEntry {
  regulation: string;
  /** The FDA part's official title, where this is one. */
  subtitle?: string;
  provisions: ProvisionEntry[];
  total: number;
  documents: number;
}

/** One document, reduced to what the index needs. */
export interface CitationSource {
  docId: string;
  docTitle: string;
  /** Token strings in reading order — `doc.tokens[i].text`. */
  words: string[];
  /** Section index per token. */
  sectionOf: (tokenIndex: number) => number;
  sectionTitle: (section: number) => string;
}

/**
 * Find citations across a document's tokens rather than its source.
 *
 * The source string is the wrong thing to search: a citation found there has a
 * character offset, and every consumer here wants a *token* to seek to. So the
 * tokens are joined back into text with an offset table, which costs one array
 * and makes the mapping exact rather than approximate.
 */
export function citationsInDocument(source: CitationSource): CitationSite[] {
  const offsets: number[] = [];
  let text = "";
  for (let i = 0; i < source.words.length; i++) {
    offsets.push(text.length);
    text += (i ? " " : "") + source.words[i];
    if (i) offsets[i] += 1;
  }

  /** Char offset back to the token that contains it. */
  const tokenAt = (offset: number): number => {
    let lo = 0;
    let hi = offsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (offsets[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  return findCitations(text).map((c) => {
    const tokenIndex = tokenAt(c.start);
    const section = source.sectionOf(tokenIndex);
    return {
      docId: source.docId,
      docTitle: source.docTitle,
      section,
      sectionTitle: source.sectionTitle(section),
      tokenIndex,
      text: c.text,
      regulation: c.regulation,
      provision: c.provision,
    } as CitationSite & { regulation: string; provision: string | null };
  });
}

/**
 * Roll every document's citations into one index.
 *
 * Sorted so the regulation cited across the most *documents* comes first, not
 * the one cited the most times — a regulation quoted forty times inside its own
 * text says less than one discussed by four different chapters, which is the
 * disagreement worth reading.
 */
export function buildCitationIndex(
  sites: (CitationSite & { regulation: string; provision: string | null })[]
): RegulationEntry[] {
  const byRegulation = new Map<
    string,
    Map<string, (CitationSite & { provision: string | null })[]>
  >();

  for (const site of sites) {
    const provisions = byRegulation.get(site.regulation) ?? new Map();
    const key = site.provision ?? "";
    provisions.set(key, [...(provisions.get(key) ?? []), site]);
    byRegulation.set(site.regulation, provisions);
  }

  const entries: RegulationEntry[] = [];
  for (const [regulation, provisions] of byRegulation) {
    const rows: ProvisionEntry[] = [...provisions.entries()]
      .map(([key, group]) => ({
        provision: key || null,
        sites: group,
        documents: new Set(group.map((s) => s.docId)).size,
      }))
      .sort(
        (a, b) =>
          b.documents - a.documents ||
          b.sites.length - a.sites.length ||
          (a.provision ?? "").localeCompare(b.provision ?? "")
      );

    const all = rows.flatMap((r) => r.sites);
    const part = /^21 CFR Part (\d+)$/.exec(regulation)?.[1];

    entries.push({
      regulation,
      ...(part && PARTS[part] ? { subtitle: PARTS[part] } : {}),
      provisions: rows,
      total: all.length,
      documents: new Set(all.map((s) => s.docId)).size,
    });
  }

  return entries.sort(
    (a, b) =>
      b.documents - a.documents ||
      b.total - a.total ||
      a.regulation.localeCompare(b.regulation)
  );
}

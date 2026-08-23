import { ACRONYMS, type AcronymCategory } from "./acronyms";
import { termKey } from "./review";
import type { ParsedDoc } from "./types";

/**
 * Cross-document entity index.
 *
 * Nine PDFs are loaded into this app and each one is read as if it were the
 * only one. But the corpus is not nine subjects — it is one subject written
 * down nine times, and the thing worth knowing about "protocol deviation" is
 * that ICH E6 defines it, a GCDMP chapter operationalizes it and the exam
 * guide lists it. That relationship exists in the material and the app was
 * throwing it away: there was no way to ask "where else does this come up?"
 * short of opening every document and reading for it.
 *
 * Two kinds of entity are indexed, for two different reasons:
 *
 *  - **Acronyms**, from the dictionary the reader already sees badged. These
 *    are the vocabulary the material is written in and the vocabulary a
 *    certification examines, so they are kept however rarely they appear.
 *  - **Capitalized noun phrases** mid-sentence — "Data Management Plan",
 *    "Sponsor", "Quality Tolerance Limit". A capital letter inside a sentence
 *    is the strongest signal a PDF gives that a phrase is a named thing rather
 *    than prose, and it costs nothing to read.
 *
 * What is deliberately *not* here: any attempt to decide that two differently
 * worded phrases mean the same thing. The index reports what the documents
 * say, the same way the flattener refuses to assert a column relationship the
 * table did not state.
 */

/**
 * Shape version for a stored index. Bumped when the extraction rules change,
 * which is how a stale index rebuilds itself instead of quietly reporting
 * yesterday's rules.
 */
export const ENTITY_SCHEMA = 1;

export type EntityKind = "acronym" | "term";

export interface EntityEntry {
  /**
   * Identity across documents. Shares `termKey` with the review queue, so an
   * indexed entity and the record of having failed it are the same string.
   */
  key: string;
  /** Canonical surface form, as the documents write it. */
  display: string;
  kind: EntityKind;
  category?: AcronymCategory;
  count: number;
  /** Distinct sections it appears in, capped. */
  sections: number[];
  /** Token index of the first occurrence — where "open it here" goes. */
  first: number;
}

export interface DocEntityIndex {
  docId: string;
  docTitle: string;
  schema: number;
  /** Word count of the document this was built from, to spot a stale index. */
  wordCount: number;
  builtAt: number;
  entries: EntityEntry[];
  /** Entries dropped by the per-document cap, reported rather than hidden. */
  truncated: number;
}

/** One document's account of an entity, inside the merged view. */
export interface EntityInDoc {
  docId: string;
  docTitle: string;
  count: number;
  first: number;
  sections: number;
}

export interface CorpusEntity {
  key: string;
  display: string;
  kind: EntityKind;
  category?: AcronymCategory;
  /** Occurrences across every indexed document. */
  total: number;
  docs: EntityInDoc[];
}

/**
 * Occurrences a capitalized phrase needs before it is indexed.
 *
 * One is a name that happened to be mentioned; two is a term the document is
 * using. Acronyms are exempt — a single "SUSAR" is worth knowing about.
 */
const MIN_TERM_COUNT = 2;

/**
 * Longest phrase assembled from a run of capitalized words. Counts the
 * connectors too, so "Department of Health and Human Services" fits.
 */
const MAX_PHRASE_WORDS = 8;

/**
 * Lowercase words a name is allowed to contain.
 *
 * Without this the corpus index led with "Department", "Health" and "Human
 * Services" — one agency cut into three entities by the lowercase words
 * holding its name together. A connector is only absorbed if a capitalized
 * word follows it; otherwise "the Sponsor and the site" would drag "and the"
 * into the name.
 */
const CONNECTORS = new Set([
  "of", "and", "for", "the", "to", "in", "on", "with", "at", "a", "an", "de",
]);

/** Consecutive connectors allowed inside one name. */
const MAX_CONNECTORS = 2;

/**
 * Entries kept per document. The GCDMP alone runs to hundreds of thousands of
 * words and would otherwise write an index larger than the reader can use;
 * what is dropped is reported in `truncated` rather than silently lost.
 */
const MAX_ENTRIES = 600;

/** Sections listed per entry. Enough to show spread without storing a census. */
const MAX_SECTIONS = 12;

/**
 * Capitalized words that are not names.
 *
 * Kept separate from the cloze builder's list on purpose: that one decides what
 * is worth *asking* about and errs toward keeping domain nouns, this one
 * decides what is worth *listing* and has to reject the calendar and structural
 * words that would otherwise crowd the head of a corpus index.
 */
const NOT_A_NAME = new Set([
  "the", "this", "that", "these", "those", "there", "then", "when", "where",
  "while", "which", "what", "who", "whom", "whose", "each", "every", "any",
  "all", "some", "both", "for", "from", "with", "without", "however",
  "therefore", "because", "although", "though", "since", "after", "before",
  "during", "under", "over", "into", "onto", "such", "they", "their", "them",
  "its", "his", "her", "our", "your", "and", "but", "not", "may", "must",
  "should", "would", "could", "will", "shall", "can", "has", "have", "had",
  "was", "were", "are", "been", "being", "note", "example", "see", "also",
  "january", "february", "march", "april", "june", "july", "august",
  "september", "october", "november", "december", "monday", "tuesday",
  "wednesday", "thursday", "friday", "saturday", "sunday",
  "section", "figure", "table", "chapter", "appendix", "page", "part", "step",
  "box", "annex", "version", "use",
]);

/** Punctuation shell around a token, mirroring the acronym matcher's split. */
const SHELL = /^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$/;

/** Blocks contributing nothing nameable. Code is never even spoken. */
const EXCLUDED_BLOCKS = new Set(["code"]);

interface Draft {
  key: string;
  display: string;
  kind: EntityKind;
  category?: AcronymCategory;
  count: number;
  sections: Set<number>;
  first: number;
}

function note(
  drafts: Map<string, Draft>,
  key: string,
  display: string,
  kind: EntityKind,
  tokenIndex: number,
  section: number,
  category?: AcronymCategory
): void {
  const existing = drafts.get(key);
  if (existing) {
    existing.count += 1;
    if (existing.sections.size < MAX_SECTIONS) existing.sections.add(section);
    return;
  }
  drafts.set(key, {
    key,
    display,
    kind,
    category,
    count: 1,
    sections: new Set([section]),
    first: tokenIndex,
  });
}

/**
 * Build one document's index.
 *
 * Runs over the parsed token stream rather than the source, so it sees exactly
 * the text the reader hears — column recovery, citation stripping and grid
 * flattening have all already happened.
 */
export function buildEntityIndex(doc: ParsedDoc): DocEntityIndex {
  const drafts = new Map<string, Draft>();
  /**
   * How often each word appears in ordinary lowercase. A single capitalized
   * word is only a name if the document does not also write it as a common
   * noun — "Sponsor" in ICH E6 always carries its capital, while "Data" and
   * "Management" carry one whenever they happen to open a heading.
   */
  const lower = new Map<string, number>();

  let run: { words: string[]; first: number; section: number } | null = null;
  /** Connectors held back until a capitalized word proves they belong. */
  let pending: string[] = [];

  const flush = () => {
    pending = [];
    if (!run) return;
    const display = run.words.join(" ");
    note(drafts, termKey(display), display, "term", run.first, run.section);
    run = null;
  };

  for (let i = 0; i < doc.tokens.length; i++) {
    const token = doc.tokens[i];
    const block = doc.blocks[token.block];
    if (!block || EXCLUDED_BLOCKS.has(block.kind)) {
      flush();
      continue;
    }

    // An acronym is its own entity and never folds into a phrase: "the CDM
    // Plan" is a mention of CDM, not of a term called "CDM Plan".
    if (token.acronym) {
      flush();
      note(
        drafts,
        token.acronym,
        token.acronym,
        "acronym",
        i,
        token.section,
        ACRONYMS[token.acronym]?.category
      );
      continue;
    }

    const shell = SHELL.exec(token.text);
    const core = shell?.[2] ?? "";
    const trail = shell?.[3] ?? "";

    if (/^[a-z]{2,}$/.test(core)) {
      lower.set(core, (lower.get(core) ?? 0) + 1);
    }

    // Evidence grades are shown but never spoken, so they are display
    // furniture rather than anything the document names.
    const eligible =
      core.length >= 2 &&
      !token.text.includes("[") &&
      /^[A-Z]/.test(core) &&
      /[a-z]/.test(core) &&
      !NOT_A_NAME.has(core.toLowerCase());

    if (!eligible) {
      // A lowercase connector inside an open name is held, not dropped: it
      // joins the name only if a capitalized word follows it.
      if (
        run &&
        !trail &&
        pending.length < MAX_CONNECTORS &&
        CONNECTORS.has(core.toLowerCase()) &&
        /^[a-z]+$/.test(core)
      ) {
        pending.push(core);
        continue;
      }
      flush();
      continue;
    }

    // A capital at the start of a sentence says nothing — every sentence has
    // one. Only mid-sentence capitalization is evidence of a name.
    const sentenceStart = i === doc.chunks[token.chunk]?.tokenStart;
    if (sentenceStart) {
      flush();
      continue;
    }

    if (run && run.words.length + pending.length < MAX_PHRASE_WORDS) {
      run.words.push(...pending, core);
      pending = [];
    } else {
      flush();
      run = { words: [core], first: i, section: token.section };
    }

    // Punctuation ends the phrase: "the Sponsor, the Investigator" is two
    // names, not one four-word one.
    if (trail) flush();
  }
  flush();

  const all = Array.from(drafts.values())
    .filter((d) => {
      if (d.kind === "acronym") return true;
      if (d.count < MIN_TERM_COUNT) return false;
      // Multi-word capitalization is evidence enough on its own. A lone word
      // has to earn it: the document must capitalize it at least as often as
      // it writes it plainly, or it is a common noun that got a capital from
      // a heading. Measured on this corpus, where the index otherwise led with
      // "Data", "Management" and "Standards".
      if (d.display.includes(" ")) return true;
      return d.count >= (lower.get(d.display.toLowerCase()) ?? 0);
    })
    .sort((a, b) => b.count - a.count || a.display.localeCompare(b.display));

  const kept = all.slice(0, MAX_ENTRIES);

  return {
    docId: doc.id,
    docTitle: doc.title,
    schema: ENTITY_SCHEMA,
    wordCount: doc.wordCount,
    builtAt: Date.now(),
    truncated: all.length - kept.length,
    entries: kept.map((d) => ({
      key: d.key,
      display: d.display,
      kind: d.kind,
      category: d.category,
      count: d.count,
      sections: Array.from(d.sections),
      first: d.first,
    })),
  };
}

/**
 * Fold every document's index into one corpus view.
 *
 * Ordered by how many documents an entity spans before how often it occurs: a
 * term three guidelines all reach for is the point of building this, and a
 * term one document repeats forty times is not.
 */
export function mergeEntityIndexes(indexes: DocEntityIndex[]): CorpusEntity[] {
  const merged = new Map<string, CorpusEntity>();
  /** Occurrence count behind the current display form, per key. */
  const bestCount = new Map<string, number>();

  for (const index of indexes) {
    for (const entry of index.entries) {
      const inDoc: EntityInDoc = {
        docId: index.docId,
        docTitle: index.docTitle,
        count: entry.count,
        first: entry.first,
        sections: entry.sections.length,
      };

      const existing = merged.get(entry.key);
      if (!existing) {
        merged.set(entry.key, {
          key: entry.key,
          display: entry.display,
          kind: entry.kind,
          category: entry.category,
          total: entry.count,
          docs: [inDoc],
        });
        bestCount.set(entry.key, entry.count);
        continue;
      }

      existing.total += entry.count;
      existing.docs.push(inDoc);
      if (!existing.category && entry.category) existing.category = entry.category;

      // The busiest document owns the spelling: a phrase one guideline writes
      // once in an odd form should not rename it for the whole corpus.
      if (entry.count > (bestCount.get(entry.key) ?? 0)) {
        existing.display = entry.display;
        bestCount.set(entry.key, entry.count);
      }
    }
  }

  for (const entity of merged.values()) {
    entity.docs.sort((a, b) => b.count - a.count);
  }

  return Array.from(merged.values()).sort(
    (a, b) => b.docs.length - a.docs.length || b.total - a.total
  );
}

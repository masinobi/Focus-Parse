import type { ParsedDoc } from "./types";

/**
 * Cross-guideline phrase comparison.
 *
 * The exam does not ask what a guideline says. It asks how *this* guideline
 * differs from that one on the same process — audit trails under 21 CFR Part 11
 * against audit trails in the GCDMP, sponsor oversight in E6(R3) against E6(R2).
 * Answering that meant opening two PDFs and reading for the same idea twice,
 * which is exactly the operation working memory is worst at.
 *
 * This was going to be built on the entity index, and the corpus said no. The
 * index takes *capitalized* noun phrases, and the terms worth comparing are
 * ordinary lowercase prose: measured over the twelve stored documents,
 * "audit trail" appears in ten and is indexed in none. Same for "adverse
 * event" (ten), "serious adverse event" (nine), "database lock" and "protocol
 * deviation" (eight each). A panel built on the index would have looked correct
 * and been silent on every comparison actually wanted.
 *
 * So this searches the token stream instead, the way `citationsInDocument`
 * does, and for the same reason: the thing every consumer wants back is a
 * *token* to seek to, and searching the source string yields a character
 * offset that then has to be mapped approximately. Nothing is cached. It is one
 * pass over roughly 273,000 tokens on a panel open — the same cost
 * `citationSites` already pays and argues for in its own comment.
 *
 * What this deliberately does not do is decide that two differently worded
 * phrases mean the same thing. Invariant 26: a name is matched exactly, or from
 * a listed set of forms, or not at all. "Sponsor oversight" will not find
 * "oversight by the sponsor", and the panel says so rather than implying it
 * searched for the idea.
 */

/**
 * Occurrences kept per document.
 *
 * This is a comparison, not a concordance. Three passages are enough to see how
 * a document handles a term; thirty is the reading the panel exists to avoid.
 * The true total travels alongside in `count`, so a capped document says how
 * much it is holding back rather than appearing to have three mentions.
 */
export const SITES_PER_DOC = 3;

/** Punctuation shell around a token, mirroring the acronym matcher's split. */
const SHELL = /^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$/;

export interface PhraseSite {
  /** First token of the match — where "open it here" goes. */
  token: number;
  section: number;
  sectionTitle: string;
  /** The carrier sentence, verbatim as it is displayed. */
  text: string;
  /**
   * The match is a heading rather than prose.
   *
   * Worth knowing and worth showing differently. A guideline with a section
   * *named* after the phrase is making a stronger statement about it than one
   * that mentions it in passing — but the "sentence" carrying such a match is
   * the heading, which is often the phrase and nothing else. Quoted as prose it
   * renders as an empty-looking box repeating the section label directly above
   * it, which is how it looked in the browser before this existed.
   */
  heading: boolean;
  /**
   * Where the phrase sits inside `text`, so the panel can mark it.
   *
   * Display offsets, not speech offsets. Invariant 1: the two coordinate
   * spaces diverge on any chunk containing an acronym, and this string is the
   * one on screen.
   */
  from: number;
  to: number;
}

export interface DocComparison {
  docId: string;
  docTitle: string;
  /** Every occurrence found, including any past `SITES_PER_DOC`. */
  count: number;
  sites: PhraseSite[];
}

/** A token stripped of the punctuation stuck to it, lowercased. */
function core(text: string): { lead: string; core: string } {
  const shell = SHELL.exec(text);
  if (!shell) return { lead: "", core: text.toLowerCase() };
  return { lead: shell[1], core: shell[2].toLowerCase() };
}

/**
 * Cut a query into the words that have to match, in order.
 *
 * Punctuation is dropped rather than matched: a reader typing "audit trail"
 * should find "audit trail," and one pasting "(audit trail)" out of a PDF
 * should find it too.
 */
export function phraseWords(query: string): string[] {
  return query
    .split(/\s+/)
    .map((w) => core(w).core)
    .filter(Boolean);
}

/**
 * The forms the phrase's *last* word is allowed to take.
 *
 * Guideline prose writes "the audit trail" and "audit trails" in the same
 * chapter, and a reader who types one and is told the other does not exist has
 * been lied to by the tool. So the plural is admitted — but as a *listed* set
 * built from the query, the way `acronyms.ts` builds its variant map, not as a
 * similarity score. Only the final word varies: "audit trails procedure" is a
 * different phrase from "audit trail procedure", and inflecting a word in the
 * middle of a name is how a match stops meaning anything.
 *
 * The singular is offered too, so the reader who types the plural is not
 * punished for it. `ss` is excluded because stripping it produces a stem that
 * is not a word ("process" → "proces"), and the three-character floor keeps
 * "was" from matching "wa".
 */
export function finalForms(word: string): Set<string> {
  const forms = new Set([word, word + "s", word + "es"]);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) {
    forms.add(word.slice(0, -1));
    if (word.endsWith("es")) forms.add(word.slice(0, -2));
  }
  return forms;
}

/**
 * Every place one document says the phrase.
 *
 * Returns `null` for a query with no matchable words, which is a different
 * answer from an empty result: the caller has asked nothing, rather than asked
 * something and been told no. Same distinction `searchOutline` draws.
 *
 * Furniture is skipped, and so are code blocks. A reference list carrying
 * "audit trail" inside the title of a paper is not the document's account of
 * audit trails, and neither is a SQL comment.
 */
export function findPhrase(doc: ParsedDoc, query: string): DocComparison | null {
  const words = phraseWords(query);
  if (!words.length) return null;

  const last = words.length - 1;
  // One accepted set per position, built once. Only the final position varies,
  // and when the phrase is a single word that final position is also the first.
  const forms = words.map((w, i) => (i === last ? finalForms(w) : new Set([w])));

  const sites: PhraseSite[] = [];
  let count = 0;

  for (let i = 0; i + words.length <= doc.tokens.length; i++) {
    const head = doc.tokens[i];
    if (doc.sections[head.section]?.furniture) continue;
    if (doc.blocks[head.block]?.kind === "code") continue;

    const first = core(head.text);
    if (!forms[0].has(first.core)) continue;

    // A carrier sentence is a chunk. A phrase that straddles two of them has
    // no single sentence to quote, and quoting either half would be quoting
    // the document saying something it did not say.
    let tail = first;
    let ok = true;
    for (let w = 1; w <= last; w++) {
      const token = doc.tokens[i + w];
      if (token.chunk !== head.chunk) {
        ok = false;
        break;
      }
      tail = core(token.text);
      if (!forms[w].has(tail.core)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    count += 1;
    if (sites.length < SITES_PER_DOC) {
      const end = doc.tokens[i + last];
      const section = doc.sections[head.section];
      const kind = doc.blocks[head.block]?.kind;
      sites.push({
        token: i,
        section: head.section,
        sectionTitle: section?.baseTitle ?? section?.title ?? "Unsectioned",
        text: doc.chunks[head.chunk]?.text ?? "",
        heading: kind === "h1" || kind === "h2" || kind === "h3",
        from: head.offset + first.lead.length,
        to: end.offset + tail.lead.length + tail.core.length,
      });
    }

    // Advance past the match. Overlapping hits would report "data data data" as
    // two occurrences of "data data", which is a fact about the algorithm
    // rather than about the document.
    i += last;
  }

  return { docId: doc.id, docTitle: doc.title, count, sites };
}

/**
 * The same phrase across every document that says it.
 *
 * Documents with no occurrence are dropped rather than listed as empty: the
 * point of the panel is what the guidelines say, and a column of "not
 * mentioned" is noise in a corpus where most terms are in most documents.
 * Ordered by how much each document has to say, so the guideline that treats
 * the term at length leads.
 */
export function comparePhrase(docs: ParsedDoc[], query: string): DocComparison[] | null {
  if (!phraseWords(query).length) return null;
  const found: DocComparison[] = [];
  for (const doc of docs) {
    const hit = findPhrase(doc, query);
    if (hit && hit.count > 0) found.push(hit);
  }
  return found.sort((a, b) => b.count - a.count || a.docTitle.localeCompare(b.docTitle));
}

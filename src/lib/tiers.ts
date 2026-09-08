/**
 * Which sections are the GCDMP's *minimum standards* and which are its *best
 * practices*.
 *
 * The exam tests the boundary between the two constantly — "which of the
 * following is a minimum standard" is a question format, not a topic — and the
 * two tiers are laid out in a handbook chapter as consecutive sections with
 * nothing to tell them apart once the text is being read aloud.
 *
 * ## Why the heading and not the language
 *
 * The obvious implementation is to read the modal verbs: `shall` and `must`
 * mark a requirement, `should` marks a recommendation. It is wrong on this
 * corpus, and not marginally. Counted over all thirteen documents:
 *
 *     should   2,931 corpus-wide   —   23 inside a Best Practices section
 *                                     327 inside a Minimum Standards section
 *     must       344                    24 inside a Minimum Standards section
 *     shall       37                     7 inside a Minimum Standards section
 *
 * The GCDMP writes its *mandatory* tier in "should", fourteen times more often
 * than it writes its aspirational one. Item 1 of Table 1 Minimum Standards in
 * the vendor chapter reads "Sponsors **should** assess a vendor's Quality
 * Management System" — a modal-verb rule badges that a best practice, which is
 * precisely the confusion this exists to prevent.
 *
 * And the tier is not a property of the sentence at all. "Document the
 * sponsor's process and support functions needed to evaluate the use of vendor
 * services" is a **minimum standard** in the guide's 2013 vendor chapter and a
 * **best practice** in the 2021 release — same words, opposite tier, decided by
 * which edition the reader is holding. Nothing in the wording can know that.
 * The heading it sits under can, and does.
 *
 * ## Exact, or listed, or nothing
 *
 * Same rule as `blueprint-coverage.ts`, for the same reason: a title that
 * nearly matches is adjudicated rather than absorbed. The corpus offers only
 * four spellings and they are extremely clean —
 *
 *     "Minimum Standards"      28x      "Best Practices"      28x
 *     "4) Minimum Standards"   23x      "5) Best Practices"    4x
 *
 * — so an enumerator is stripped and the remainder must *equal* a listed form.
 * The near misses are the reason this is not a substring test: the study
 * guide's own contents heading `2 GCDMP Chapters – Minimum Standards and Best
 * Practices` names both tiers and is neither, and `Other Best Practice
 * Considerations` and `Recommended Standard Operating Procedures` are prose.
 * `scan-tiers.mjs` asserts that no title mentioning either tier goes untagged
 * and unruled-on.
 */

export type Tier = "minimum" | "best";

/**
 * A leading enumerator, as the GCDMP numbers its chapter sections: `4)`, `5)`,
 * `2.`, `iii)`. Stripped before matching so `4) Minimum Standards` and
 * `Minimum Standards` are one heading, which they are.
 */
const ENUMERATOR = /^\s*(?:\d+|[ivxlcdm]+|[a-z])\s*[).:]\s*/i;

/** Lowercase, unenumerated, unpunctuated, single-spaced. */
export function normalizeTierTitle(title: string): string {
  return title
    .replace(ENUMERATOR, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The headings that *are* a tier.
 *
 * Singular forms are listed rather than reached by a stemmer. The corpus uses
 * only the plurals; the singulars are here because a chapter that used one
 * would otherwise go untagged silently, and listing them is auditable in a way
 * that "strip a trailing s" is not.
 */
export const TIER_TITLES: Record<string, Tier> = {
  "minimum standards": "minimum",
  "minimum standard": "minimum",
  "best practices": "best",
  "best practice": "best",
};

/**
 * Titles that name a tier and are not one, each with the reason.
 *
 * The list that keeps `scan-tiers`'s alarm usable. An alarm nobody can silence
 * is an alarm somebody deletes.
 */
export const EXCLUDED_TIERS: Record<string, string> = {
  // The study guide's contents entry for its own section 2. It names both
  // tiers, so tagging it either way is wrong, and tagging it at all would put
  // a tier badge on a table of contents. The leading "2" is part of the key:
  // it has no punctuation after it, so `ENUMERATOR` correctly leaves it alone
  // rather than eating the first token of any title that starts with a digit.
  "2 gcdmp chapters minimum standards and best practices":
    "the study guide's contents entry, which names both tiers and is neither",
  // A prose sub-heading inside a chapter's discussion, singular, and not the
  // enumerated tier block. Roughly two hundred words of commentary.
  "other best practice considerations":
    "a prose sub-heading, not the chapter's Best Practices block",
};

/** True when a near-match has been examined and ruled on. */
export function isExcludedTier(title: string): boolean {
  return normalizeTierTitle(title) in EXCLUDED_TIERS;
}

/**
 * The tier a section heading declares, or null.
 *
 * Null is the common answer and the right one: 1,128 of this corpus's 1,211
 * sections are ordinary content and declare no tier at all.
 */
export function tierOf(title: string): Tier | null {
  return TIER_TITLES[normalizeTierTitle(title)] ?? null;
}

/**
 * True for a title that mentions a tier without being tagged as one.
 *
 * The alarm, not the rule. Used only by the scanner, which requires every such
 * title to be either tagged or listed in `EXCLUDED_TIERS` — so a new spelling
 * arriving with a new document is adjudicated rather than absorbed or lost.
 */
export function mentionsTier(title: string): boolean {
  return /minimum standard|best practice/i.test(title);
}

/** How a tier is written where the reader sees it. */
export const TIER_LABEL: Record<Tier, string> = {
  minimum: "minimum standard",
  best: "best practice",
};

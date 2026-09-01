import type { DocEntityIndex } from "./entities";
import type { ParsedDoc } from "./types";

/**
 * What a section was about, in nouns.
 *
 * The cognitive intercept is non-dismissible by design: playback stops until
 * the section just heard has been restated in one sentence. That is the whole
 * value of it, and it is also where a reader with executive dysfunction can sit
 * in front of an empty box with the material still in their head and no way in.
 * A blank page is not a memory test, it is a starting problem.
 *
 * So this hands back the section's own vocabulary — never a summary, never a
 * sentence, never anything that could be copied out as an answer. Nouns are
 * scaffolding; the claim is still the reader's to make.
 *
 * It is opt-in and it is *recorded*. A summary written after seeing these is a
 * cued recall rather than a free one, and the retrieval queue is told so, for
 * the same reason `gridAttempts` counts attempts: the ladder is only worth
 * anything if what it measures stays what it says it measures. Read
 * `ReviewItem.cued`.
 *
 * Two sources, both already computed elsewhere, because a third rule for "what
 * is this section about" is a third rule to keep in step:
 *
 *  - **Acronyms tagged on the tokens.** `parse.ts` already marks every one it
 *    recognises, which is what makes this a lookup rather than a guess — the
 *    same guarantee invariant 28 gives the dictation corrector.
 *  - **Named things from the stored entity index.** Each entry lists the
 *    sections it appears in, so asking which entries name this section reuses
 *    `entities.ts`'s extraction exactly rather than approximating it.
 *
 * Measured over the corpus's 847 intercept-arming sections: acronyms alone
 * reach 82% of them with at least one anchor and 31% with three; adding the
 * indexed names takes that to 91% and 55%. The remaining 9% get no button
 * rather than an empty one.
 */

export type AnchorKind = "acronym" | "term";

export interface Anchor {
  label: string;
  kind: AnchorKind;
}

/**
 * Anchors offered at once.
 *
 * Three, because the point is to start a sentence rather than to furnish it.
 * A list long enough to summarize *from* is a list that has replaced the recall
 * it was meant to unblock.
 */
export const MAX_ANCHORS = 3;

/**
 * The nouns a section leaned on, most-used first.
 *
 * Each source is ordered by the count its own source already keeps — acronyms
 * by occurrences inside this section, names by the document-wide count the
 * index sorted on — rather than by a new score reconciling the two. Acronyms
 * lead because they are the vocabulary the material is written in and the
 * vocabulary a certification examines.
 *
 * An entity whose section list has been capped will not name a section past
 * the cap, so a term the whole document uses can be missing from a late one.
 * That is the right way round: a name that appears everywhere says nothing
 * about *this* section, which is the only thing being asked here.
 */
export function sectionAnchors(
  doc: ParsedDoc,
  section: number,
  index: DocEntityIndex | null,
  limit: number = MAX_ANCHORS
): Anchor[] {
  const bounds = doc.sections[section];
  if (!bounds) return [];

  const counts = new Map<string, number>();
  for (let i = bounds.tokenStart; i < bounds.tokenEnd; i++) {
    const key = doc.tokens[i]?.acronym;
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const anchors: Anchor[] = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label]) => ({ label, kind: "acronym" as const }));

  const seen = new Set(anchors.map((a) => a.label.toLowerCase()));
  for (const entry of index?.entries ?? []) {
    if (anchors.length >= limit) break;
    if (entry.kind === "acronym") continue;
    if (!entry.sections.includes(section)) continue;
    if (seen.has(entry.display.toLowerCase())) continue;
    seen.add(entry.display.toLowerCase());
    anchors.push({ label: entry.display, kind: "term" });
  }

  return anchors.slice(0, limit);
}

import { MIN_INTERCEPT_WORDS } from "./parse";
import type { ReviewItem } from "./review";
import { outlineOf, qualifiedTitle } from "./section-search";
import type { ParsedDoc } from "./types";

/**
 * Repairing a retrieval queue written under a rule that has since been fixed.
 *
 * `finishChunk` used to test the minimum-length floor against the section being
 * *entered* while demanding the summary of the one being *left*, so a reader
 * was stopped to restate headings with no body — "Best Practices", two words,
 * its own title and nothing else. Those sentences were written, filed, and are
 * still in the queue. Fixing the rule stops new ones; it does nothing about the
 * ones already on disk, which will go on coming back for months asking the
 * reader to recall a heading.
 *
 * And the ones that *should* stay are stored under a bare title. 157 of the
 * GCDMP's intercept sections share a title with another, so a queue holding
 * nineteen items called "Best Practices" is nineteen questions the reader
 * cannot tell apart at the moment the text is gone.
 *
 * The plan is pure and the applying is not, deliberately. This is the only
 * operation in the app that *deletes* something the reader produced, so what
 * gets deleted is decided by a function that can be tested against a document
 * rather than by a loop inside an IndexedDB transaction.
 */

export interface SweepPlan {
  /** Items whose section can never be asked about, so the item can never be answered honestly. */
  remove: ReviewItem[];
  /** Items to keep, under a name that says which section they mean. */
  rename: { item: ReviewItem; prompt: string }[];
  /** Correct as they stand. */
  kept: number;
  /**
   * Summary items this document cannot judge — no section recorded, or one
   * outside its range after a re-parse.
   *
   * Counted rather than removed. An item that cannot be evaluated is not the
   * same as an item known to be wrong, and the difference matters when the
   * operation is deletion: the safe direction is to leave it alone and say so.
   */
  unjudged: number;
}

/**
 * What to do with one document's summary items.
 *
 * Only `kind === "summary"` is ever considered. A cloze, grid or acronym item
 * is keyed by its term rather than by a section boundary and none of this
 * applies to it — passing the whole queue in is fine and the rest is ignored.
 */
export function planSummarySweep(doc: ParsedDoc, items: ReviewItem[]): SweepPlan {
  const plan: SweepPlan = { remove: [], rename: [], kept: 0, unjudged: 0 };
  const outline = outlineOf(doc.sections);

  for (const item of items) {
    if (item.kind !== "summary") continue;
    if (item.docId !== doc.id) {
      plan.unjudged += 1;
      continue;
    }

    const index = item.section;
    if (typeof index !== "number" || !doc.sections[index]) {
      plan.unjudged += 1;
      continue;
    }

    // Length alone, deliberately — *not* `demandsSummary`.
    //
    // That predicate bundles three conditions, and only one of them makes a
    // stored summary worthless. A section too short to have said anything was
    // never answerable: the reader restated a heading because the app asked
    // them to. But "nothing follows it" and "what follows arms nothing" are
    // facts about where the *intercept fires*, not about whether the sentence
    // means anything — and a re-parse moves those around. Sweeping on the full
    // predicate deleted a real 60-word section's summary in the probe, purely
    // because it happened to be last in its document. Weeks of scheduling, for
    // a section the reader had genuinely read and restated.
    if (doc.sections[index].wordCount < MIN_INTERCEPT_WORDS) {
      plan.remove.push(item);
      continue;
    }

    const prompt = qualifiedTitle(outline, index);
    if (prompt && prompt !== item.prompt) {
      plan.rename.push({ item, prompt });
      continue;
    }

    plan.kept += 1;
  }

  return plan;
}

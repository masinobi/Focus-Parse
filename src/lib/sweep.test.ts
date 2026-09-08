import { describe, expect, it } from "vitest";

import { parseDocument } from "./parse";
import { newReview, summaryId, type ReviewItem, type ReviewKind } from "./review";
import { planSummarySweep } from "./sweep";

/**
 * This is the only place in the app that deletes something the reader wrote.
 *
 * The failure that matters is not a crash — it is removing a summary of a real
 * section, which is weeks of spaced retrieval gone with nothing on screen to
 * say so. So the rules are pinned here, and the ones about *not* deleting are
 * pinned hardest.
 */
const DOC = `# Contents

x

# Database Closure

## Best Practices

File the documentation.

## Interim and Final Lock Distinctions

${"The sponsor holds accountability for the lock and the audit trail is what an inspector reads first. ".repeat(4)}

## Minimum Requirements for Database Lock

${"A final lock closes everything at once and is not reversed without a documented decision. ".repeat(4)}
`;

const doc = parseDocument(DOC, "sweep.md");
const at = (title: string) =>
  doc.sections.findIndex((s) => (s.baseTitle ?? s.title).trim() === title);

function item(section: number, over: Partial<ReviewItem> = {}): ReviewItem {
  const base = doc.sections[section];
  return {
    ...newReview(
      {
        id: summaryId(doc.id, section),
        docId: doc.id,
        docTitle: doc.title,
        kind: "summary" as ReviewKind,
        prompt: base?.title ?? "gone",
        answer: "The section argued something.",
        section,
      },
      0
    ),
    ...over,
  };
}

describe("planSummarySweep", () => {
  it("removes a summary of a section that can never be asked about", () => {
    // "Best Practices" is its own two-word heading and nothing else. It was
    // asked for under the old rule and can never be asked for again.
    const short = at("Best Practices");
    const plan = planSummarySweep(doc, [item(short)]);
    expect(plan.remove.map((i) => i.section)).toEqual([short]);
    expect(plan.kept).toBe(0);
  });

  it("keeps a summary of a section that still owes one", () => {
    const real = at("Interim and Final Lock Distinctions");
    const plan = planSummarySweep(doc, [item(real, { prompt: "x" })]);
    expect(plan.remove).toHaveLength(0);
    expect(plan.rename).toHaveLength(1);
  });

  it("renames a kept item to say which chapter it means", () => {
    const real = at("Interim and Final Lock Distinctions");
    const plan = planSummarySweep(doc, [item(real)]);
    expect(plan.rename[0].prompt).toBe(
      "Database Closure — Interim and Final Lock Distinctions"
    );
  });

  it("leaves an already-correct name alone", () => {
    const real = at("Interim and Final Lock Distinctions");
    const named = item(real, {
      prompt: "Database Closure — Interim and Final Lock Distinctions",
    });
    const plan = planSummarySweep(doc, [named]);
    expect(plan).toMatchObject({ kept: 1, unjudged: 0 });
    expect(plan.remove).toHaveLength(0);
    expect(plan.rename).toHaveLength(0);
  });

  it("never touches a kind that is not a summary", () => {
    // A cloze is keyed by its term, not by a section boundary. Sweeping one
    // would delete retrieval history for a word that is still in the document.
    const short = at("Best Practices");
    const cloze = item(short, { kind: "cloze" as ReviewKind, id: "d:cloze:term" });
    const plan = planSummarySweep(doc, [cloze]);
    expect(plan.remove).toHaveLength(0);
    expect(plan.rename).toHaveLength(0);
    expect(plan.kept).toBe(0);
  });

  it("will not judge an item with no section recorded", () => {
    const plan = planSummarySweep(doc, [item(0, { section: undefined })]);
    expect(plan.remove).toHaveLength(0);
    expect(plan.unjudged).toBe(1);
  });

  it("will not judge a section index the document no longer has", () => {
    // A re-parse can move boundaries. An item that cannot be evaluated is not
    // the same as one known to be wrong, and this operation deletes.
    const plan = planSummarySweep(doc, [item(0, { section: 9999 })]);
    expect(plan.remove).toHaveLength(0);
    expect(plan.unjudged).toBe(1);
  });

  it("will not judge an item belonging to another document", () => {
    const plan = planSummarySweep(doc, [item(at("Best Practices"), { docId: "other" })]);
    expect(plan.remove).toHaveLength(0);
    expect(plan.unjudged).toBe(1);
  });

  it("is idempotent: a swept queue plans no further change", () => {
    const items = doc.sections.map((_, i) => item(i));
    const first = planSummarySweep(doc, items);
    const after = items
      .filter((i) => !first.remove.includes(i))
      .map((i) => {
        const renamed = first.rename.find((r) => r.item === i);
        return renamed ? { ...i, prompt: renamed.prompt } : i;
      });
    const second = planSummarySweep(doc, after);
    expect(second.remove).toHaveLength(0);
    expect(second.rename).toHaveLength(0);
    expect(second.kept).toBe(after.length - second.unjudged);
  });
});

describe("what the sweep must not delete", () => {
  /**
   * Caught by the browser probe, not by reasoning.
   *
   * The first version swept on `demandsSummary`, which is false for the last
   * section of a document because nothing is ever crossed into. That is a fact
   * about where the intercept fires, not about whether the reader's sentence
   * means anything — and it deleted a real 60-word section's summary.
   */
  it("keeps a long section's summary even where no intercept can fire again", () => {
    const last = doc.sections.length - 1;
    expect(doc.sections[last].wordCount).toBeGreaterThan(60);
    const plan = planSummarySweep(doc, [item(last)]);
    expect(plan.remove).toHaveLength(0);
  });

  it("removes on length alone, at the same floor the intercept uses", () => {
    const short = at("Best Practices");
    const real = at("Interim and Final Lock Distinctions");
    expect(doc.sections[short].wordCount).toBeLessThan(60);
    expect(doc.sections[real].wordCount).toBeGreaterThanOrEqual(60);
    const plan = planSummarySweep(doc, [item(short), item(real)]);
    expect(plan.remove.map((i) => i.section)).toEqual([short]);
  });
});

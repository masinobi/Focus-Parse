import { describe, expect, it } from "vitest";

import { assembleExam, scoreExam, type ExamQuestion, type QuestionPool } from "./exam";
import { isStructuralReference } from "./quiz";

/**
 * `scan-exam` builds a real paper from the real corpus, which is the right way
 * to judge question *quality*. What it cannot do is put the assembler in a
 * corner: a corpus where one kind is missing entirely, or where two documents
 * offer the same fact. Those are the cases that produced the two defects found
 * by measuring — a missing kind inflating another, and one fact asked twice —
 * so they are pinned here with pools built to order.
 */

function acronym(doc: string, key: string): ExamQuestion {
  return {
    id: `${doc}:acronym:${key}`,
    kind: "acronym",
    docId: doc,
    docTitle: doc,
    acronym: key,
    prompt: `What does ${key} stand for?`,
    answer: `expansion of ${key}`,
    options: [`expansion of ${key}`, "a", "b", "c"],
  };
}

function cloze(doc: string, answer: string): ExamQuestion {
  return {
    id: `${doc}:cloze:${answer}`,
    kind: "cloze",
    docId: doc,
    docTitle: doc,
    carrier: `A sentence about ____ here.`,
    answer,
    tokenIndex: 1,
  };
}

function grid(doc: string, n: number): ExamQuestion {
  return {
    id: `${doc}:grid:${n}`,
    kind: "grid",
    docId: doc,
    docTitle: doc,
    prompt: `Grid ${n}?`,
    answer: "yes",
    options: ["yes", "no", "maybe", "never"],
    blockIndex: n,
    row: "r",
    column: "c",
    caption: null,
  };
}

function pool(doc: string, opts: { acronyms?: string[]; clozes?: string[]; grids?: number }): QuestionPool {
  return {
    docId: doc,
    docTitle: doc,
    acronym: (opts.acronyms ?? []).map((k) => acronym(doc, k)) as never,
    cloze: (opts.clozes ?? []).map((a) => cloze(doc, a)) as never,
    grid: Array.from({ length: opts.grids ?? 0 }, (_, i) => grid(doc, i)) as never,
  };
}

const many = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${prefix}${i}`);

describe("assembleExam", () => {
  it("draws from every document rather than the richest one", () => {
    const pools = [
      pool("rich", { acronyms: many("A", 12), clozes: many("c", 12), grids: 12 }),
      pool("thin", { acronyms: many("B", 2), clozes: many("d", 2) }),
      pool("mid", { acronyms: many("C", 6), clozes: many("e", 6), grids: 2 }),
    ];
    const paper = assembleExam(pools, 12, "seed");

    const docs = new Set(paper.map((q) => q.docId));
    expect(docs).toEqual(new Set(["rich", "thin", "mid"]));
    expect(paper).toHaveLength(12);
  });

  it("never asks one fact twice, even from two documents", () => {
    // Both documents define CRF and blank the same term: one fact each.
    const pools = [
      pool("one", { acronyms: ["CRF", "EDC"], clozes: ["sponsor"] }),
      pool("two", { acronyms: ["CRF", "EDC"], clozes: ["sponsor"] }),
    ];
    const paper = assembleExam(pools, 10, "seed");

    const meanings = paper.map((q) =>
      q.kind === "acronym" ? `acr:${q.acronym}` : `cloze:${q.answer}`
    );
    expect(new Set(meanings).size).toBe(meanings.length);
    // Three distinct facts exist across the two pools, so the paper is short.
    expect(paper).toHaveLength(3);
  });

  it("redistributes a missing kind instead of inflating one neighbour", () => {
    // The measured defect: no document has tables, and every grid slot fell
    // through to whichever kind came next in list order.
    const pools = [
      pool("a", { acronyms: many("A", 20), clozes: many("c", 20) }),
      pool("b", { acronyms: many("B", 20), clozes: many("d", 20) }),
    ];
    const paper = assembleExam(pools, 20, "seed");

    const clozes = paper.filter((q) => q.kind === "cloze").length;
    const acronyms = paper.filter((q) => q.kind === "acronym").length;
    expect(clozes + acronyms).toBe(20);
    // Cloze carries the larger target share, so it must not lose to acronym.
    expect(clozes).toBeGreaterThan(acronyms);
  });

  it("follows the target mix when every kind is available", () => {
    const pools = [
      pool("a", { acronyms: many("A", 20), clozes: many("c", 20), grids: 20 }),
    ];
    const paper = assembleExam(pools, 20, "seed");
    const share = (kind: string) => paper.filter((q) => q.kind === kind).length / 20;

    expect(share("cloze")).toBeCloseTo(0.45, 1);
    expect(share("acronym")).toBeCloseTo(0.35, 1);
    expect(share("grid")).toBeCloseTo(0.2, 1);
  });

  it("is deterministic, and takes its document order from the seed", () => {
    // Within a pool the assembler walks the list it was handed, in order: the
    // per-sitting variation lives in `collectQuestions`, which shuffles each
    // document's candidates by the same seed. What the seed changes *here* is
    // which document is drawn from first, which is why a one-pool paper is
    // identical across seeds and a many-pool one is not.
    const one = [pool("a", { acronyms: many("A", 20), clozes: many("c", 20), grids: 20 })];
    const ids = (pools: QuestionPool[], seed: string) =>
      assembleExam(pools, 10, seed).map((q) => q.id).join();

    expect(ids(one, "s")).toBe(ids(one, "s"));

    const several = ["a", "b", "c", "d"].map((d) =>
      pool(d, { acronyms: many(`${d}A`, 5), clozes: many(`${d}c`, 5), grids: 5 })
    );
    const orders = new Set(
      ["s1", "s2", "s3", "s4", "s5", "s6"].map((seed) => ids(several, seed))
    );
    expect(orders.size).toBeGreaterThan(1);
  });

  it("returns what it can when the corpus cannot fill the paper", () => {
    const paper = assembleExam([pool("a", { acronyms: ["X"] })], 40, "seed");
    expect(paper).toHaveLength(1);
  });
});

describe("scoreExam", () => {
  it("orders the breakdown worst-first, since it exists to say what to read", () => {
    const questions = [
      acronym("good", "A"),
      acronym("good", "B"),
      acronym("bad", "C"),
      acronym("bad", "D"),
    ];
    const answers = new Map(
      questions.map((q) => [
        q.id,
        { questionId: q.id, given: "x", correct: q.docId === "good" },
      ])
    );

    const result = scoreExam(questions, answers, 30);
    expect(result.correct).toBe(2);
    expect(result.total).toBe(4);
    expect(result.byDocument[0].label).toBe("bad");
    expect(result.byDocument[0].correct).toBe(0);
  });

  it("counts an unanswered question as wrong rather than skipping it", () => {
    const questions = [acronym("d", "A"), acronym("d", "B")];
    const result = scoreExam(questions, new Map(), 10);
    expect(result.correct).toBe(0);
    expect(result.total).toBe(2);
  });
});

describe("isStructuralReference", () => {
  it("rejects a blank that asks where a rule lives", () => {
    expect(isStructuralReference("Section ____ states that…", "4.5")).toBe(true);
    expect(isStructuralReference("see Appendix ____ for detail", "2")).toBe(true);
    expect(isStructuralReference("Table ____ lists them", "3")).toBe(true);
  });

  it("keeps a number that is a fact rather than an address", () => {
    expect(isStructuralReference("an average of ____ days to build", "68.3")).toBe(false);
    expect(isStructuralReference("retained for ____ years", "15")).toBe(false);
  });

  it("ignores non-numeric answers entirely", () => {
    expect(isStructuralReference("Section ____ states", "sponsor")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import type {
  AcronymQuestion,
  ClozeQuestion,
  ExamAnswer,
  ExamQuestion,
  ExamResult,
  GridQuestion,
} from "./exam";
import {
  examPercent,
  isExamRecord,
  recordExam,
  repeatMisses,
  trendOf,
  type ExamRecord,
} from "./history";

/**
 * A history is a claim about the past, and the failure mode is quiet.
 *
 * Nothing here can crash a reading session. If `recordExam` drops the misses,
 * or `repeatMisses` counts one sitting twice, the app carries on exactly as
 * before and simply tells the reader something untrue about their own
 * progress — which is worse than telling them nothing, because they will act
 * on it. So the rules are pinned here rather than left to be noticed.
 */

function cloze(id: string, answer: string, acronym?: string): ClozeQuestion {
  return {
    id,
    kind: "cloze",
    docId: "d1",
    docTitle: "GCDMP",
    carrier: "The ____ is required.",
    answer,
    acronym,
    section: 1,
    tokenIndex: 42,
  };
}

function acronymQ(id: string, term: string, expansion: string): AcronymQuestion {
  return {
    id,
    kind: "acronym",
    docId: "d2",
    docTitle: "ICH E6",
    prompt: `What does ${term} stand for?`,
    answer: expansion,
    acronym: term,
    options: [expansion, "something else"],
  };
}

function grid(id: string, answer: string): GridQuestion {
  return {
    id,
    kind: "grid",
    docId: "d1",
    docTitle: "GCDMP",
    prompt: "Which step?",
    answer,
    options: [answer, "other"],
    blockIndex: 3,
    row: "r",
    column: "c",
    caption: null,
  };
}

function marked(
  questions: ExamQuestion[],
  correctIds: string[],
  elapsed = 300
): ExamResult {
  const answers = new Map<string, ExamAnswer>();
  for (const q of questions) {
    const correct = correctIds.includes(q.id);
    answers.set(q.id, {
      questionId: q.id,
      given: correct ? q.answer : "",
      correct,
    });
  }
  return {
    questions,
    answers,
    correct: correctIds.length,
    total: questions.length,
    elapsed,
    byDocument: [{ label: "GCDMP", correct: correctIds.length, total: questions.length }],
    byKind: [{ label: "Terms in context", correct: correctIds.length, total: questions.length }],
  };
}

function record(at: number, correct: number, total: number, misses: string[] = []): ExamRecord {
  return {
    id: `exam:${at}`,
    at,
    correct,
    total,
    elapsed: 100,
    documents: 9,
    byDocument: [],
    byKind: [],
    missed: misses.map((term) => ({
      kind: "cloze" as const,
      docId: "d1",
      docTitle: "GCDMP",
      prompt: "carrier",
      answer: term,
      given: "",
      term,
    })),
  };
}

describe("recordExam", () => {
  it("keeps only the questions that were got wrong", () => {
    const qs = [cloze("a", "audit trail"), cloze("b", "query"), cloze("c", "monitor")];
    const r = recordExam(marked(qs, ["a"]), 9, 1000);

    expect(r.total).toBe(3);
    expect(r.correct).toBe(1);
    expect(r.missed.map((m) => m.answer)).toEqual(["query", "monitor"]);
  });

  it("keeps an unanswered question as a miss with an empty answer", () => {
    const qs = [cloze("a", "audit trail")];
    const result = marked(qs, []);
    result.answers.set("a", { questionId: "a", given: "", correct: false });

    expect(recordExam(result, 1, 1).missed[0].given).toBe("");
  });

  it("keys an acronym miss by its term, not by its expansion", () => {
    const r = recordExam(marked([acronymQ("a", "SUSAR", "suspected unexpected serious adverse reaction")], []), 1, 1);
    expect(r.missed[0].term).toBe("SUSAR");
  });

  it("keys a cloze on an acronym to the same term an acronym question uses", () => {
    const fromCloze = recordExam(marked([cloze("a", "CRFs", "CRF")], []), 1, 1);
    const fromAcronym = recordExam(marked([acronymQ("b", "CRF", "case report form")], []), 1, 2);
    // The whole reason misses are term-keyed: these are one problem.
    expect(fromCloze.missed[0].term).toBe(fromAcronym.missed[0].term);
  });

  it("takes a cloze's carrier as the prompt and everything else's prompt", () => {
    const r = recordExam(marked([cloze("a", "x"), grid("b", "y")], []), 1, 1);
    expect(r.missed[0].prompt).toBe("The ____ is required.");
    expect(r.missed[1].prompt).toBe("Which step?");
  });

  it("does not share array structure with the live result", () => {
    const result = marked([cloze("a", "x")], []);
    const r = recordExam(result, 1, 1);
    result.byDocument[0].correct = 99;
    expect(r.byDocument[0].correct).toBe(0);
  });

  it("rounds elapsed seconds, which arrive as a float from the clock", () => {
    expect(recordExam(marked([cloze("a", "x")], [], 123.456), 1, 1).elapsed).toBe(123);
  });

  it("derives an id from the time it was sat", () => {
    expect(recordExam(marked([], []), 0, 1000).id).not.toBe(
      recordExam(marked([], []), 0, 1001).id
    );
  });
});

describe("examPercent", () => {
  it("is zero for an empty paper rather than NaN", () => {
    expect(examPercent({ correct: 0, total: 0 })).toBe(0);
  });

  it("rounds", () => {
    expect(examPercent({ correct: 1, total: 3 })).toBe(33);
  });
});

describe("trendOf", () => {
  it("reports nothing on an empty history", () => {
    expect(trendOf([])).toEqual({
      papers: 0,
      latest: null,
      delta: null,
      best: 0,
      recentAverage: null,
    });
  });

  it("has no delta on a first paper", () => {
    expect(trendOf([record(1, 5, 10)]).delta).toBeNull();
  });

  it("sorts newest first whatever order it is handed", () => {
    const t = trendOf([record(1, 5, 10), record(3, 9, 10), record(2, 7, 10)]);
    expect(t.latest?.at).toBe(3);
    expect(t.delta).toBe(20);
  });

  it("takes the best from any paper, not the latest", () => {
    expect(trendOf([record(1, 10, 10), record(2, 5, 10)]).best).toBe(100);
  });

  it("averages the last three only", () => {
    const t = trendOf([
      record(1, 0, 10),
      record(2, 10, 10),
      record(3, 8, 10),
      record(4, 6, 10),
    ]);
    // 60, 80, 100 — the 0% is out of range.
    expect(t.recentAverage).toBe(80);
  });

  it("averages what there is when there are fewer than three", () => {
    expect(trendOf([record(1, 4, 10), record(2, 6, 10)]).recentAverage).toBe(50);
  });

  it("reports a fall as a negative delta", () => {
    expect(trendOf([record(1, 9, 10), record(2, 5, 10)]).delta).toBe(-40);
  });
});

describe("repeatMisses", () => {
  it("ignores a term missed only once", () => {
    expect(repeatMisses([record(1, 0, 1, ["query"])])).toEqual([]);
  });

  it("counts a term missed on two papers", () => {
    const out = repeatMisses([record(1, 0, 1, ["query"]), record(2, 0, 1, ["query"])]);
    expect(out).toHaveLength(1);
    expect(out[0].papers).toBe(2);
  });

  it("counts a term missed twice in one paper as one paper", () => {
    // Two blanks cut around the same term in one sitting is one problem, and
    // counting it as two would promote it above a term genuinely missed twice
    // weeks apart — which is the only thing this report exists to find.
    expect(repeatMisses([record(1, 0, 2, ["query", "query"])])).toEqual([]);
  });

  it("labels an acronym term by the acronym, whichever kind was missed last", () => {
    // Live data caught this: "CDISC" missed as a blank and "Clinical Data
    // Interchange Standards Consortium" missed as a definition are one row,
    // and it was named after whichever came last.
    const asCloze = recordExam(marked([cloze("a", "CDISC", "CDISC")], []), 1, 1);
    const asDefinition = recordExam(
      marked([acronymQ("b", "CDISC", "Clinical Data Interchange Standards Consortium")], []),
      1,
      2
    );
    const out = repeatMisses([asCloze, asDefinition]);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe("CDISC");
    expect(out[0].detail).toBe("Clinical Data Interchange Standards Consortium");
  });

  it("keeps the expansion once seen, even if a blank was missed after it", () => {
    const asDefinition = recordExam(
      marked([acronymQ("b", "CDISC", "Clinical Data Interchange Standards Consortium")], []),
      1,
      1
    );
    const asCloze = recordExam(marked([cloze("a", "CDISC", "CDISC")], []), 1, 2);
    const out = repeatMisses([asDefinition, asCloze]);
    expect(out[0].label).toBe("CDISC");
    expect(out[0].detail).toBe("Clinical Data Interchange Standards Consortium");
  });

  it("does not repeat an acronym as its own expansion", () => {
    // Only blanks, so the answer *is* the acronym. Writing it into `detail`
    // too would render the row as "CDISC" over "CDISC".
    const a = recordExam(marked([cloze("a", "CDISC", "CDISC")], []), 1, 1);
    const b = recordExam(marked([cloze("a", "CDISC", "CDISC")], []), 1, 2);
    expect(repeatMisses([a, b])[0].detail).toBeUndefined();
  });

  it("leaves a non-acronym term with no expansion beside it", () => {
    const a = recordExam(marked([cloze("a", "audit trail")], []), 1, 1);
    const b = recordExam(marked([cloze("b", "audit trail")], []), 1, 2);
    const out = repeatMisses([a, b]);
    expect(out[0].label).toBe("audit trail");
    expect(out[0].detail).toBeUndefined();
  });

  it("takes the most recent wording as the label", () => {
    const early = record(1, 0, 1, []);
    early.missed = [
      { kind: "cloze", docId: "d", docTitle: "T", prompt: "p", answer: "old wording", given: "", term: "k" },
    ];
    const late = record(2, 0, 1, []);
    late.missed = [
      { kind: "cloze", docId: "d", docTitle: "T", prompt: "p", answer: "new wording", given: "", term: "k" },
    ];
    expect(repeatMisses([late, early])[0].label).toBe("new wording");
  });

  it("collects the documents a term was missed in, without duplicates", () => {
    const a = record(1, 0, 1, []);
    a.missed = [
      { kind: "cloze", docId: "d1", docTitle: "GCDMP", prompt: "p", answer: "x", given: "", term: "k" },
    ];
    const b = record(2, 0, 1, []);
    b.missed = [
      { kind: "cloze", docId: "d2", docTitle: "ICH E6", prompt: "p", answer: "x", given: "", term: "k" },
    ];
    const c = record(3, 0, 1, []);
    c.missed = [
      { kind: "cloze", docId: "d1", docTitle: "GCDMP", prompt: "p", answer: "x", given: "", term: "k" },
    ];
    expect(repeatMisses([a, b, c])[0].documents).toEqual(["GCDMP", "ICH E6"]);
  });

  it("orders by how many papers", () => {
    // "b" is met first and therefore lands in the map first, so this only
    // passes if the result is genuinely sorted. Written the other way round —
    // the worst term also seen first — it passed with the sort deleted.
    const out = repeatMisses([
      record(1, 0, 1, ["b"]),
      record(2, 0, 2, ["b", "a"]),
      record(3, 0, 1, ["a"]),
      record(4, 0, 1, ["a"]),
    ]);
    expect(out.map((m) => m.term)).toEqual(["a", "b"]);
    expect(out[0].papers).toBe(3);
    expect(out[1].papers).toBe(2);
  });

  it("breaks a tie on papers with the most recently missed", () => {
    const out = repeatMisses([
      record(1, 0, 2, ["stale", "fresh"]),
      record(2, 0, 1, ["stale"]),
      record(3, 0, 1, ["fresh"]),
    ]);
    expect(out.map((m) => m.term)).toEqual(["fresh", "stale"]);
  });

  it("is unaffected by the order the records arrive in", () => {
    const rs = [record(3, 0, 1, ["a"]), record(1, 0, 1, ["a"]), record(2, 0, 1, ["b"])];
    expect(repeatMisses(rs)[0].lastAt).toBe(3);
  });
});

describe("isExamRecord", () => {
  it("accepts a real record", () => {
    expect(isExamRecord(record(1, 5, 10))).toBe(true);
  });

  it.each([
    ["null", null],
    ["a string", "exam"],
    ["no id", { at: 1, correct: 0, total: 1, missed: [] }],
    ["no timestamp", { id: "e", correct: 0, total: 1, missed: [] }],
    ["misses that are not an array", { id: "e", at: 1, correct: 0, total: 1, missed: {} }],
  ])("rejects %s", (_label, value) => {
    expect(isExamRecord(value)).toBe(false);
  });
});

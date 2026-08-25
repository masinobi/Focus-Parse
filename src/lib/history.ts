import type { ExamBreakdown, ExamKind, ExamResult } from "./exam";
import { termKey } from "./review";

/**
 * What the mock exam leaves behind.
 *
 * Every other rung of this app's enforcement ladder now records what it
 * learned — a summary at an intercept, a grid pass, a marked spot check — and
 * the coverage map exists because the third of those used to be shown for
 * eight seconds and thrown away. The paper had the same defect one rung up,
 * and a worse version of it: the mock exam is the closest thing here to the
 * actual objective, it is the only artefact that scores the whole corpus at
 * once, and its result lived entirely inside one React state variable. Closing
 * the dialog destroyed it.
 *
 * So a sitting becomes a record. The question a study tool has to be able to
 * answer is not "how did that paper go" — the marked screen already said — but
 * "is this getting better", and that one cannot be answered from a single
 * paper by construction.
 *
 * **Only the misses are kept.** A record exists to say what to do next, and a
 * question answered correctly has no next action; `byKind` and `byDocument`
 * already carry the counts a right answer contributes to. Keeping all forty
 * questions would triple the record for material the app can regenerate from
 * the documents at any time.
 */

/** One question the reader got wrong, kept so it can be looked at again. */
export interface ExamMiss {
  kind: ExamKind;
  docId: string;
  docTitle: string;
  /** What was asked: the carrier sentence for a cloze, the prompt otherwise. */
  prompt: string;
  answer: string;
  /** What the reader put. Empty when the question was left unanswered. */
  given: string;
  /**
   * The acronym this question was about, when it was about one.
   *
   * Carried separately from `answer` because the two question kinds disagree
   * about what the answer *is*: a cloze cut around "CTMS" has "CTMS" as its
   * answer, while an acronym question about the same term has the expansion.
   * Both key to the same term, so without this the repeat-miss list labels a
   * row with whichever kind happened to be missed last — "CDISC" one week and
   * "Clinical Data Interchange Standards Consortium" the next, for one row.
   */
  acronym?: string;
  /**
   * Identity of the *term*, by the same rule the retrieval queue uses.
   *
   * Keyed this way rather than by question id on purpose: "SUSAR" missed in
   * the GCDMP and "SUSAR" missed in ICH E6 are two questions and one problem,
   * and the whole point of a history is being able to say which problems keep
   * coming back. See `termKey` and invariant 11.
   */
  term: string;
}

export interface ExamRecord {
  /** Derived from the time it was sat, so a record can never collide. */
  id: string;
  at: number;
  correct: number;
  total: number;
  /** Seconds spent, which is not the same as the seconds allowed. */
  elapsed: number;
  /** How many documents were loaded when it was sat. */
  documents: number;
  byDocument: ExamBreakdown[];
  byKind: ExamBreakdown[];
  missed: ExamMiss[];
}

export function examPercent(record: Pick<ExamRecord, "correct" | "total">): number {
  return record.total ? Math.round((record.correct / record.total) * 100) : 0;
}

export function examRecordId(at: number): string {
  return `exam:${at.toString(36)}`;
}

/**
 * Reduce a marked paper to the part worth keeping.
 *
 * The misses are read off `result.questions` rather than passed in, so this is
 * the single place that decides what a miss looks like — including the term
 * key, which no caller should be computing for itself.
 */
export function recordExam(
  result: ExamResult,
  documents: number,
  at: number
): ExamRecord {
  const missed: ExamMiss[] = [];
  for (const q of result.questions) {
    const answer = result.answers.get(q.id);
    if (answer?.correct) continue;
    missed.push({
      kind: q.kind,
      docId: q.docId,
      docTitle: q.docTitle,
      prompt: q.kind === "cloze" ? q.carrier : q.prompt,
      answer: q.answer,
      given: answer?.given ?? "",
      acronym: q.kind === "grid" ? undefined : q.acronym,
      term: termKey(q.answer, q.kind === "grid" ? undefined : q.acronym),
    });
  }

  return {
    id: examRecordId(at),
    at,
    correct: result.correct,
    total: result.total,
    elapsed: Math.round(result.elapsed),
    documents,
    // Copied rather than referenced: the record is written to IndexedDB and
    // must not share structure with a live result the UI is still rendering.
    byDocument: result.byDocument.map((r) => ({ ...r })),
    byKind: result.byKind.map((r) => ({ ...r })),
    missed,
  };
}

/* ------------------------------------------------------------------ *
 * Trend
 * ------------------------------------------------------------------ */

export interface ExamTrend {
  papers: number;
  latest: ExamRecord | null;
  /**
   * Percentage points between the latest paper and the one before it, or
   * `null` when there is nothing to compare against.
   */
  delta: number | null;
  /** Best percentage scored on any paper. */
  best: number;
  /**
   * Mean of the last three papers, which is the number to believe.
   *
   * A single paper carries real sampling noise — a 20-question set is ±5
   * questions of luck, which is 25 percentage points — and two papers of
   * different lengths are not directly comparable at all. `delta` is reported
   * because a reader will look for it, but this is the figure that moves for a
   * reason.
   */
  recentAverage: number | null;
}

/** Papers newest first. Any order in, sorted here, so callers cannot get it wrong. */
export function trendOf(records: ExamRecord[]): ExamTrend {
  const sorted = [...records].sort((a, b) => b.at - a.at);
  if (!sorted.length) {
    return { papers: 0, latest: null, delta: null, best: 0, recentAverage: null };
  }

  const recent = sorted.slice(0, 3).map(examPercent);
  return {
    papers: sorted.length,
    latest: sorted[0],
    delta:
      sorted.length >= 2 ? examPercent(sorted[0]) - examPercent(sorted[1]) : null,
    best: Math.max(...sorted.map(examPercent)),
    recentAverage: Math.round(recent.reduce((a, b) => a + b, 0) / recent.length),
  };
}

/* ------------------------------------------------------------------ *
 * Repeat misses
 * ------------------------------------------------------------------ */

export interface RepeatMiss {
  term: string;
  /**
   * What to call it.
   *
   * The acronym wherever there is one, so a term met as both a blank and a
   * definition question reads the same way every time it is listed.
   */
  label: string;
  /** The expansion, when the label is an acronym and one has been seen. */
  detail?: string;
  /** Papers it has been missed on. */
  papers: number;
  /** When it was last missed. */
  lastAt: number;
  /** Documents it has been missed in, by title. */
  documents: string[];
}

/**
 * Terms missed on more than one paper.
 *
 * The retrieval queue already reschedules a missed term, and `difficulty()`
 * already reports which terms are not sticking — but both are keyed to the
 * *queue*, which forgives an item as soon as it is answered right once. A term
 * missed on three separate papers weeks apart is a different claim: it survives
 * being learned. That is the one thing a history knows that nothing else here
 * does, and it is why the misses are kept at all.
 *
 * Counted by paper rather than by occurrence, so a term blanked twice in one
 * sitting is one miss — the same reason review ids are content-derived.
 */
export function repeatMisses(records: ExamRecord[], floor = 2): RepeatMiss[] {
  const byTerm = new Map<string, RepeatMiss>();

  for (const record of [...records].sort((a, b) => a.at - b.at)) {
    const inThisPaper = new Set<string>();
    for (const miss of record.missed) {
      const entry: RepeatMiss = byTerm.get(miss.term) ?? {
        term: miss.term,
        label: miss.answer,
        papers: 0,
        lastAt: record.at,
        documents: [],
      };

      if (miss.acronym) {
        // An acronym names itself. Whichever kind of question was missed last,
        // the row reads the same, and the expansion goes beside it when a
        // definition question supplied one.
        entry.label = miss.acronym;
        if (miss.answer !== miss.acronym) entry.detail = miss.answer;
      } else {
        // Otherwise the most recent sighting: a re-parse can reword an answer,
        // and the newest form is the one the reader just saw.
        entry.label = miss.answer;
      }
      entry.lastAt = record.at;
      if (!entry.documents.includes(miss.docTitle)) entry.documents.push(miss.docTitle);
      if (!inThisPaper.has(miss.term)) {
        inThisPaper.add(miss.term);
        entry.papers += 1;
      }
      byTerm.set(miss.term, entry);
    }
  }

  return [...byTerm.values()]
    .filter((m) => m.papers >= floor)
    .sort((a, b) => b.papers - a.papers || b.lastAt - a.lastAt);
}

/** Validate a record read back from a backup file. */
export function isExamRecord(value: unknown): value is ExamRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<ExamRecord>;
  return (
    typeof r.id === "string" &&
    r.id.length > 0 &&
    typeof r.at === "number" &&
    typeof r.correct === "number" &&
    typeof r.total === "number" &&
    Array.isArray(r.missed)
  );
}

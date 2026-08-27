import { describe, expect, it } from "vitest";

import { coerceVerdict, GRADER_SYSTEM } from "./types";

/**
 * Defensive narrowing of whatever a model actually returns.
 *
 * Both providers are given a response schema, so in the ordinary case this is
 * belt and braces. It stops being belt and braces the moment a model id
 * changes, a provider relaxes enum enforcement, or a stored verdict written by
 * an older build is read back — and the failure mode is a dialog rendering
 * `undefined` at the end of an intercept, which is the most expensive moment in
 * the app to show the reader something broken.
 */

const OK = {
  verdict: "accurate",
  feedback: "You got the central point.",
  missed: [],
  contradictions: [],
  rationale: "captured",
  why: "so a change can be attributed",
};

describe("coerceVerdict", () => {
  it("accepts a well-formed verdict unchanged", () => {
    expect(coerceVerdict(OK)).toEqual(OK);
  });

  it("rejects anything without a usable verdict level", () => {
    expect(coerceVerdict(null)).toBeNull();
    expect(coerceVerdict("accurate")).toBeNull();
    expect(coerceVerdict({ ...OK, verdict: "excellent" })).toBeNull();
    expect(coerceVerdict({ ...OK, feedback: 42 })).toBeNull();
  });

  it("reads a missing rationale as not_stated rather than failing the grade", () => {
    // The rest of the grade is still usable, and "not_stated" is the reading
    // that claims least about a section nobody has judged.
    const { rationale, why, ...withoutRationale } = OK;
    void rationale;
    void why;
    const verdict = coerceVerdict(withoutRationale);
    expect(verdict).not.toBeNull();
    expect(verdict!.rationale).toBe("not_stated");
    expect(verdict!.verdict).toBe("accurate");
  });

  it("reads an invented rationale level as not_stated", () => {
    expect(coerceVerdict({ ...OK, rationale: "sort of" })!.rationale).toBe("not_stated");
  });

  it("drops a reason attached to not_stated", () => {
    // A section that gives no reason cannot also have one quoted from it. If
    // the model supplies both, the field that claims less wins.
    const verdict = coerceVerdict({
      ...OK,
      rationale: "not_stated",
      why: "because it is good practice",
    });
    expect(verdict!.why).toBe("");
  });

  it("keeps the reason when the rationale was judged", () => {
    expect(coerceVerdict({ ...OK, rationale: "missed" })!.why).toBe(
      "so a change can be attributed"
    );
  });

  it("caps the lists, and survives them being the wrong shape", () => {
    const verdict = coerceVerdict({
      ...OK,
      missed: ["a", "b", "c", "d", 5],
      contradictions: "not an array",
    });
    expect(verdict!.missed).toEqual(["a", "b", "c"]);
    expect(verdict!.contradictions).toEqual([]);
  });
});

describe("GRADER_SYSTEM", () => {
  // Whitespace-collapsed, because the prompt is a wrapped template literal and
  // an assertion that also pins where the lines break would fail on a reflow
  // that changed nothing.
  const prompt = GRADER_SYSTEM.replace(/\s+/g, " ");

  it("tells the model not to lower the verdict for a missed rationale", () => {
    // The two judgements are separate, and conflating them turns a correct
    // summary of a list into a "partial" for omitting something the section
    // never said.
    expect(prompt).toMatch(/never lower the verdict/i);
    expect(prompt).toMatch(/not_stated/);
  });

  it("forbids supplying a reason from outside the section", () => {
    expect(prompt).toMatch(/[Nn]ever supply a reason from outside the section/);
  });
});

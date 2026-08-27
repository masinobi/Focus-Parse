import { describe, expect, it } from "vitest";

import { reconcile, soundKey, spokenCandidates, SPOKEN_AS } from "./dictation";

/**
 * The corrector is more dangerous than the recognizer it repairs.
 *
 * A mangled word is visible; a substituted one is not. So most of what is
 * pinned here is restraint: what must be left exactly as the reader said it,
 * and what must not be swallowed by a match that reaches too far.
 */

const VOCAB = ["CDISC", "SDTM", "EDC", "CRF", "eCRF", "MedDRA", "SAE", "GCP"];
const fix = (text: string) => reconcile(text, VOCAB).text;

describe("soundKey", () => {
  it("ignores the vowels a recognizer varies on", () => {
    expect(soundKey("see disk")).toBe(soundKey("sea disc"));
    expect(soundKey("meddra")).toBe(soundKey("med dra"));
  });

  it("keeps the consonant order, which is the signal", () => {
    expect(soundKey("crf")).not.toBe(soundKey("cfr"));
  });

  it("collapses a doubled consonant into one sound", () => {
    expect(soundKey("collect")).toBe(soundKey("colect"));
  });
});

describe("spokenCandidates", () => {
  it("spells an acronym out the way a recognizer hears it", () => {
    expect(spokenCandidates("CRF")).toContain("see are eff");
  });

  it("always offers the written form", () => {
    expect(spokenCandidates("SDTM")).toContain("SDTM");
  });

  it("adds the listed pronunciations for the ones that are said as words", () => {
    expect(spokenCandidates("CDISC")).toContain("see disk");
  });
});

describe("reconcile", () => {
  it("repairs the mishearing that would fail a correct summary", () => {
    expect(fix("the sponsor adopted see disk standards")).toBe(
      "the sponsor adopted CDISC standards"
    );
    expect(fix("ess dee tee em maps the raw data")).toBe("SDTM maps the raw data");
    expect(fix("the e see are eff is completed by the site")).toBe(
      "the eCRF is completed by the site"
    );
  });

  it("does not eat the words either side of a match", () => {
    // `soundKey` collapses adjacent duplicate consonants, so "uses see disk"
    // and "see disk" had the same skeleton. Matching the longest window first
    // rewrote all three words as CDISC and swallowed the verb.
    expect(fix("the sponsor uses see disk standards")).toBe(
      "the sponsor uses CDISC standards"
    );
  });

  it("refuses a phrase far longer than the form it matched", () => {
    // A constructed collision, because the size guard is defence in depth and
    // the realistic cases are caught earlier by keeping the leading vowel.
    // "sees see disk" and "ceases see disk" still reduce to the same skeleton
    // as "see disk" — every leading `s` collapses into one — and only the size
    // test stops the extra word being eaten.
    expect(fix("the site sees see disk standards")).toBe(
      "the site sees CDISC standards"
    );
    expect(fix("the site ceases see disk reporting")).toBe(
      "the site ceases CDISC reporting"
    );
  });

  it("leaves an ordinary word that merely sounds similar", () => {
    expect(fix("the data is on a disk in the office")).toBe(
      "the data is on a disk in the office"
    );
    expect(fix("she discussed disc golf and disk usage")).toBe(
      "she discussed disc golf and disk usage"
    );
  });

  it("substitutes nothing the document does not contain", () => {
    // The single rule that keeps this safe. The same transcript, against a
    // document that never mentions CDISC, is left alone.
    expect(reconcile("the sponsor adopted see disk standards", ["EDC"]).text).toBe(
      "the sponsor adopted see disk standards"
    );
  });

  it("normalises a written acronym without touching its neighbours", () => {
    expect(fix("the edc system captures the crf")).toBe(
      "the EDC system captures the CRF"
    );
  });

  it("reports every change it made, and nothing it did not", () => {
    const { corrections } = reconcile("see disk governs SDTM", VOCAB);
    expect(corrections).toEqual([{ from: "see disk", to: "CDISC" }]);
    // `SDTM` was already right, so it is not a correction even though it was
    // matched — a dialog that listed it would be claiming to have fixed a word
    // the reader got right.
    expect(corrections).toHaveLength(1);
  });

  it("prefers the longer acronym when one contains the other", () => {
    expect(fix("the e see are eff replaced the see are eff")).toBe(
      "the eCRF replaced the CRF"
    );
  });

  it("returns the transcript untouched when there is no vocabulary", () => {
    const { text, corrections } = reconcile("see disk and ess dee tee em", []);
    expect(text).toBe("see disk and ess dee tee em");
    expect(corrections).toEqual([]);
  });

  it("keeps the spacing the reader dictated", () => {
    expect(fix("edc\n\nand crf")).toBe("EDC\n\nand CRF");
  });

  it("has no listed pronunciation that is an ordinary English word", () => {
    // "standard" was listed against SDTM once, which would have rewritten the
    // commonest word in this corpus. Anything here has to be nonsense outside
    // this vocabulary, or it will fire on prose.
    const ORDINARY = new Set([
      "standard", "record", "report", "data", "study", "site", "form",
      "review", "process", "system", "source", "quality", "safety",
    ]);
    for (const forms of Object.values(SPOKEN_AS)) {
      for (const form of forms) {
        expect(ORDINARY.has(form.toLowerCase())).toBe(false);
      }
    }
  });
});

import { describe, expect, it } from "vitest";

import {
  backupFilename,
  isBackup,
  isBackupDoc,
  isReviewRecord,
  isSessionRecord,
} from "./backup";

/**
 * Backup validation is the one place in this app where being wrong is
 * unrecoverable in the other direction: a restore that accepts junk writes it
 * into the only copy of the study record. None of it depends on a corpus, so
 * none of it is reachable by the scanners.
 */

const validBackup = {
  app: "focusparse",
  format: 1,
  exportedAt: 1_700_000_000_000,
  documents: [],
  sessions: [],
  reviews: [],
};

describe("isBackup", () => {
  it("accepts a well-formed envelope", () => {
    expect(isBackup(validBackup)).toBe(true);
  });

  it("rejects anything that is not this app's file", () => {
    expect(isBackup(null)).toBe(false);
    expect(isBackup("{}")).toBe(false);
    expect(isBackup({ ...validBackup, app: "something-else" })).toBe(false);
    // A JSON file of the right shape but missing a collection would import as a
    // partial restore, silently doing less than the user believes.
    expect(isBackup({ ...validBackup, reviews: undefined })).toBe(false);
    expect(isBackup({ ...validBackup, documents: "none" })).toBe(false);
  });
});

describe("record validation", () => {
  it("requires a document to carry the source the parser rebuilds from", () => {
    expect(isBackupDoc({ id: "d", title: "T", source: "# Heading" })).toBe(true);
    expect(isBackupDoc({ id: "d", title: "T", source: "   " })).toBe(false);
    expect(isBackupDoc({ id: "", title: "T", source: "x" })).toBe(false);
    expect(isBackupDoc({ title: "T", source: "x" })).toBe(false);
  });

  it("requires a session to name the document it belongs to", () => {
    expect(isSessionRecord({ docId: "d", tokenIndex: 0 })).toBe(true);
    expect(isSessionRecord({ docId: "d" })).toBe(false);
    expect(isSessionRecord({ tokenIndex: 4 })).toBe(false);
  });

  it("requires a review item to be schedulable", () => {
    const item = { id: "i", docId: "d", prompt: "p", dueAt: 1 };
    expect(isReviewRecord(item)).toBe(true);
    // No dueAt means `listDue` can never surface it: it would import and then
    // never be asked again.
    expect(isReviewRecord({ ...item, dueAt: undefined })).toBe(false);
    expect(isReviewRecord({ ...item, id: 42 })).toBe(false);
  });
});

describe("backupFilename", () => {
  it("names files so they sort chronologically in a folder", () => {
    expect(backupFilename(Date.UTC(2026, 7, 9, 12))).toMatch(
      /^focusparse-backup-2026-08-0\d\.json$/
    );
  });
});

"use client";

import * as React from "react";
import { Download, Loader2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  backupFilename,
  describeBackup,
  isBackup,
  type Backup,
  type ImportSummary,
} from "@/lib/backup";
import { db } from "@/lib/db";

/**
 * Backup and restore, on the loader.
 *
 * Deliberately two clicks apart from anything destructive: export writes a file
 * and import merges into what is already here. A chosen file is described
 * before it is applied rather than applied on selection, because "I picked the
 * wrong file" should be recoverable by not pressing the second button.
 */

interface BackupControlsProps {
  /** Called after a restore, so the loader can re-read its lists. */
  onRestored: () => void;
}

export function BackupControls({ onRestored }: BackupControlsProps) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<Backup | null>(null);
  const [summary, setSummary] = React.useState<ImportSummary | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const exportNow = async () => {
    setError(null);
    setSummary(null);
    setBusy("Collecting…");
    try {
      const backup = await db.exportAll();
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = backupFilename(backup.exportedAt);
      a.click();
      // Revoked on the next tick: revoking synchronously can beat the download
      // in some builds and produce an empty file.
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(
        `Could not build the backup: ${
          cause instanceof Error ? cause.message : "unknown error"
        }`
      );
    } finally {
      setBusy(null);
    }
  };

  const choose = async (file: File) => {
    setError(null);
    setSummary(null);
    setPending(null);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!isBackup(parsed)) {
        setError(
          `${file.name} is not a FocusParse backup. Nothing has been changed.`
        );
        return;
      }
      setPending(parsed);
    } catch {
      setError(`${file.name} could not be read as JSON. Nothing has been changed.`);
    }
  };

  const applyPending = async () => {
    if (!pending) return;
    setBusy("Restoring…");
    try {
      const result = await db.importAll(pending, (done, total, title) => {
        setBusy(done < total ? `Rebuilding ${done + 1} of ${total} — ${title}` : "Restoring…");
      });
      setSummary(result);
      setPending(null);
      onRestored();
    } catch (cause) {
      setError(
        `Restore failed part-way: ${
          cause instanceof Error ? cause.message : "unknown error"
        }. Nothing was deleted.`
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-10">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Backup
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={busy !== null}
          onClick={() => void exportNow()}
        >
          <Download className="h-3.5 w-3.5" />
          Export everything
        </Button>

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void choose(file);
            e.target.value = "";
          }}
        />
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={busy !== null}
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="h-3.5 w-3.5" />
          Restore from a file
        </Button>

        {busy && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            {busy}
          </span>
        )}
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        Documents, reading sessions and the whole review schedule, as one JSON
        file. Restoring merges — nothing is deleted, and anything newer here is
        kept.
      </p>

      {pending && (
        <div className="mt-3 rounded-md border border-primary/40 bg-primary/5 p-3">
          <p className="text-sm">{describeBackup(pending)}</p>
          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" disabled={busy !== null} onClick={() => void applyPending()}>
              Restore it
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={() => setPending(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {summary && (
        <div className="mt-3 rounded-md border bg-muted/30 p-3 text-xs">
          <p className="mb-1 font-medium text-foreground">Restored.</p>
          <ul className="space-y-0.5 text-muted-foreground">
            <li>
              Documents: {summary.documents.added} added, {summary.documents.updated}{" "}
              rebuilt
            </li>
            <li>
              Sessions: {summary.sessions.added} added, {summary.sessions.updated}{" "}
              updated, {summary.sessions.kept} already newer here
            </li>
            <li>
              Review items: {summary.reviews.added} added, {summary.reviews.updated}{" "}
              updated, {summary.reviews.kept} already newer here
            </li>
            {summary.skipped > 0 && (
              <li className="text-destructive">
                {summary.skipped} malformed {summary.skipped === 1 ? "record" : "records"}{" "}
                skipped
              </li>
            )}
          </ul>
        </div>
      )}

      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
    </div>
  );
}

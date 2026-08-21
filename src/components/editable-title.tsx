"use client";

import * as React from "react";
import { Check, Pencil, X } from "lucide-react";

import { cn } from "@/lib/utils";

interface EditableTitleProps {
  value: string;
  onCommit: (next: string) => void;
  className?: string;
  inputClassName?: string;
  /** Shown in the button's tooltip and as the input's accessible name. */
  label?: string;
}

/**
 * Click-to-rename label.
 *
 * Escape reverts and Enter commits, which is the behaviour people expect from
 * a filename field. Blur also commits: an edit abandoned by clicking elsewhere
 * is almost always meant to be kept, and Escape is right there for the times
 * it isn't.
 */
export function EditableTitle({
  value,
  onCommit,
  className,
  inputClassName,
  label = "Rename",
}: EditableTitleProps) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const inputRef = React.useRef<HTMLInputElement>(null);
  /** Set while Escape is unwinding, so the blur handler does not re-commit. */
  const cancelled = React.useRef(false);

  React.useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  React.useEffect(() => {
    if (!editing) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [editing]);

  const start = () => {
    cancelled.current = false;
    setDraft(value);
    setEditing(true);
  };

  const commit = () => {
    if (cancelled.current) return;
    setEditing(false);
    const next = draft.trim();
    if (next && next !== value) onCommit(next);
    else setDraft(value);
  };

  const cancel = () => {
    cancelled.current = true;
    setDraft(value);
    setEditing(false);
  };

  if (editing) {
    return (
      <span className="flex min-w-0 items-center gap-1">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            // Stop transport shortcuts from firing while typing a name.
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          aria-label={label}
          spellCheck={false}
          className={cn(
            "min-w-0 flex-1 rounded border border-input bg-background px-1.5 py-0.5 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring",
            inputClassName
          )}
        />
        <span className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
          <Check className="h-3 w-3" aria-hidden />
          <span className="sr-only">Enter to save</span>
          <X className="h-3 w-3" aria-hidden />
          <span className="sr-only">Escape to cancel</span>
        </span>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={start}
      title={`${label} — click to edit`}
      className={cn(
        "group/title flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-accent/60",
        className
      )}
    >
      <span className="truncate">{value}</span>
      <Pencil className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover/title:opacity-60" />
    </button>
  );
}

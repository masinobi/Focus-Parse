"use client";

import * as React from "react";
import {
  AudioLines,
  FileText,
  GraduationCap,
  Layers,
  Library,
  LineChart,
  Loader2,
  Pencil,
  Sparkles,
  Scale,
  Tags,
  Target,
  Upload,
  X,
} from "lucide-react";

import { AcronymDrill } from "@/components/acronym-drill";
import { BackupControls } from "@/components/backup-controls";
import { BlueprintPanel } from "@/components/blueprint-panel";
import { CitationIndex } from "@/components/citation-index";
import { CorpusIndex } from "@/components/corpus-index";
import { ExamHistory } from "@/components/exam-history";
import { ExamSession } from "@/components/exam-session";
import { Readiness } from "@/components/readiness";
import { ReviewSession } from "@/components/review-session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { db, type DocSummary } from "@/lib/db";
import { parseDocument } from "@/lib/parse";
import { extractPdf } from "@/lib/pdf";
import { SAMPLE_DOCUMENT } from "@/lib/sample";
import { sqlToMarkdown } from "@/lib/sql";
import { useFocusStore } from "@/store/useFocusStore";

export function DocumentLoader() {
  const [pasted, setPasted] = React.useState("");
  const [pastedName, setPastedName] = React.useState("");
  const [dragging, setDragging] = React.useState(false);
  const [recent, setRecent] = React.useState<DocSummary[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);
  /** Id of the recent document currently being renamed, if any. */
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [renameDraft, setRenameDraft] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  /** How many retrieval items are owed right now. */
  const [due, setDue] = React.useState(0);
  const [reviewing, setReviewing] = React.useState(false);
  const [indexing, setIndexing] = React.useState(false);
  const [examining, setExamining] = React.useState(false);
  const [drilling, setDrilling] = React.useState(false);
  const [reviewingPapers, setReviewingPapers] = React.useState(false);
  const [blueprint, setBlueprint] = React.useState(false);
  const [citations, setCitations] = React.useState(false);
  /** How many mock papers have been sat, for the history entry. */
  const [papers, setPapers] = React.useState(0);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const loadDoc = useFocusStore((s) => s.loadDoc);
  const hydrateSession = useFocusStore((s) => s.hydrateSession);
  const refreshWeakTerms = useFocusStore((s) => s.refreshWeakTerms);

  React.useEffect(() => {
    void db.listDocs().then(setRecent);
    void db.countDue().then(setDue);
    void db.countExams().then(setPapers);
  }, []);

  const ingest = React.useCallback(
    (source: string, name?: string) => {
      if (!source.trim()) return;
      const doc = parseDocument(source, name);
      loadDoc(doc);
      // A freshly parsed document has no stored session, but the session
      // writer waits on hydration having happened at all — so every load path
      // goes through it, including the one with nothing to restore.
      void hydrateSession(doc.id);
    },
    [loadDoc, hydrateSession]
  );

  const readFile = React.useCallback(
    async (file: File) => {
      setError(null);

      const isPdf =
        file.type === "application/pdf" || /\.pdf$/i.test(file.name);

      if (!isPdf) {
        setBusy(`Reading ${file.name}…`);
        const text = await file.text();
        setBusy(null);
        // A `.sql` file is not a document with code in it — it is mostly prose,
        // in comments, with the queries between. Parsed as plain text it reads
        // its own delimiters aloud; wrapped whole in one fence it goes silent.
        // `sqlToMarkdown` separates the two, and the markdown it produces is
        // what gets stored as `source`, so a rebuild needs nothing else.
        ingest(/\.sql$/i.test(file.name) ? sqlToMarkdown(text) : text, file.name);
        return;
      }

      try {
        setBusy("Opening PDF…");
        const buffer = await file.arrayBuffer();
        const markdown = await extractPdf(buffer, ({ page, pages }) => {
          setBusy(`Extracting text — page ${page} of ${pages}`);
        });

        if (!markdown.trim()) {
          setError(
            `No text layer found in ${file.name}. Scanned PDFs need OCR before FocusParse can read them.`
          );
          return;
        }
        ingest(markdown, file.name);
      } catch (cause) {
        setError(
          `Could not read ${file.name}: ${
            cause instanceof Error ? cause.message : "unknown error"
          }`
        );
      } finally {
        setBusy(null);
      }
    },
    [ingest]
  );

  /** Drop a stored document and its reading session. */
  const forget = async (id: string) => {
    await db.deleteDoc(id);
    setRecent(await db.listDocs());
    setDue(await db.countDue());
  };

  const commitRename = async (id: string) => {
    const next = renameDraft.trim();
    setRenamingId(null);
    const current = recent.find((r) => r.id === id);
    if (!next || !current || next === current.title) return;
    await db.renameDoc(id, next);
    setRecent(await db.listDocs());
  };

  const openRecent = async (id: string) => {
    const doc = await db.getDoc(id);
    if (!doc) return;
    loadDoc(doc);
    await hydrateSession(doc.id);
  };

  if (indexing) {
    return <CorpusIndex onBack={() => setIndexing(false)} />;
  }

  if (examining) {
    return (
      <ExamSession
        onDone={() => {
          setExamining(false);
          // An exam feeds the queue like everything else, so both the debt
          // count and the reading engine's idea of what is weak are stale.
          void db.countDue().then(setDue);
          void db.countExams().then(setPapers);
          void refreshWeakTerms();
        }}
      />
    );
  }

  if (blueprint) {
    return <BlueprintPanel onBack={() => setBlueprint(false)} />;
  }

  if (citations) {
    return <CitationIndex onBack={() => setCitations(false)} />;
  }

  if (reviewingPapers) {
    return <ExamHistory onBack={() => setReviewingPapers(false)} />;
  }

  if (drilling) {
    return (
      <AcronymDrill
        onDone={() => {
          setDrilling(false);
          // A drill feeds the queue like everything else, so both the debt
          // count and the reading engine's idea of what is weak are stale.
          void db.countDue().then(setDue);
          void refreshWeakTerms();
        }}
      />
    );
  }

  if (reviewing) {
    return (
      <ReviewSession
        onDone={() => {
          setReviewing(false);
          void db.countDue().then(setDue);
          // A warm-up is where most lapses are recorded, so the reading engine's
          // idea of what this reader keeps losing is stale the moment it ends.
          void refreshWeakTerms();
        }}
      />
    );
  }

  return (
    /* `items-center` on a scrolling flex container centres the content and then
       clips whatever overflows *above* the scroll origin, which cannot be
       scrolled back to. It looked fine for most of this project's life because
       the home screen was short. Measured at five documents: six controls —
       the corpus index, the mock exam, the citation index, blueprint coverage,
       the acronym drill and the exam date — sat above the top of the scroller
       with the scrollbar already at its end, and no gesture could reach them.
       `flex-col` plus `my-auto` centres the same way while collapsing the
       margin when there is nothing spare, which is the difference. */
    <div className="flex h-full flex-col items-center overflow-y-auto p-8">
      <div className="my-auto w-full max-w-2xl">
        <div className="mb-8 flex items-center gap-2.5">
          <AudioLines className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">FocusParse</h1>
        </div>

        <p className="mb-8 max-w-lg text-sm leading-relaxed text-muted-foreground">
          Synchronized audio-visual ingestion with active re-encoding. Load a PDF,
          markdown or text document — headings become intercept boundaries, sentences
          become the pacing unit.
        </p>

        {/* The date everything here is for. It changes the review schedule —
            an interval is capped at half the time remaining — so it belongs
            above the queue rather than in a settings panel. */}
        <Readiness due={due} onReview={() => setReviewing(true)} />

        {/* Retrieval debt comes before new material. Reading a tenth guideline
            while the first nine evaporate is motion, not progress. */}
        {due > 0 && (
          <button
            type="button"
            onClick={() => setReviewing(true)}
            className="mb-6 flex w-full items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 px-4 py-3 text-left transition-colors hover:bg-primary/10"
          >
            <Layers className="h-4 w-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 text-sm">
              <span className="font-medium">
                {due} {due === 1 ? "item is" : "items are"} due for review
              </span>
              <span className="block text-xs text-muted-foreground">
                Terms you missed and sections you summarized, asked again.
              </span>
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              ~{Math.max(1, Math.round((due * 15) / 60))} min
            </span>
          </button>
        )}

        {/* Nine guidelines on one subject are one corpus, and until this the
            app had no way to say so. */}
        {recent.length > 0 && (
          <button
            type="button"
            onClick={() => setIndexing(true)}
            className="mb-6 flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors hover:bg-accent/60"
          >
            <Library className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 text-sm">
              <span className="font-medium">Corpus index</span>
              <span className="block text-xs text-muted-foreground">
                Every term the parser found, and which of your{" "}
                {recent.length === 1 ? "document" : `${recent.length} documents`} use it.
              </span>
            </span>
          </button>
        )}

        {/* The reading tool's own machinery, pointed at the actual objective:
            a timed paper across the whole corpus rather than interruptions
            inside one document. */}
        {recent.length > 0 && (
          <button
            type="button"
            onClick={() => setExamining(true)}
            className="mb-6 flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors hover:bg-accent/60"
          >
            <GraduationCap className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 text-sm">
              <span className="font-medium">Mock exam</span>
              <span className="block text-xs text-muted-foreground">
                Acronyms, terms in context and table cells, drawn across
                everything and marked at the end.
              </span>
            </span>
          </button>
        )}

        {/* The corpus index is keyed by term, and a citation is not a term.
            `21 CFR Part 11 section 11.10` is a provision, and the question
            builders throw provisions away on purpose -- so until this, the
            thing these documents argue about most was the one thing nothing
            could show. */}
        {recent.length > 0 && (
          <button
            type="button"
            onClick={() => setCitations(true)}
            className="mb-6 flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors hover:bg-accent/60"
          >
            <Scale className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 text-sm">
              <span className="font-medium">Regulations cited</span>
              <span className="block text-xs text-muted-foreground">
                Every rule your documents cite, and which of them argue about
                the same provision.
              </span>
            </span>
          </button>
        )}

        {/* Every other account here measures the corpus against itself, so the
            one thing none of them can report is a chapter that is not in the
            corpus at all. That is what this is for. */}
        {recent.length > 0 && (
          <button
            type="button"
            onClick={() => setBlueprint(true)}
            className="mb-6 flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors hover:bg-accent/60"
          >
            <Target className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 text-sm">
              <span className="font-medium">Blueprint coverage</span>
              <span className="block text-xs text-muted-foreground">
                The exam&apos;s six domains against what you actually have —
                including the chapters it names that your library is missing.
              </span>
            </span>
          </button>
        )}

        {/* A single paper cannot say whether this is working. The history is
            where the app answers that, and where terms that survive being
            learned show up. */}
        {papers > 0 && (
          <button
            type="button"
            onClick={() => setReviewingPapers(true)}
            className="mb-6 flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors hover:bg-accent/60"
          >
            <LineChart className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 text-sm">
              <span className="font-medium">Exam history</span>
              <span className="block text-xs text-muted-foreground">
                {papers} {papers === 1 ? "paper" : "papers"} sat, how the scores
                are moving, and the terms you keep missing.
              </span>
            </span>
          </button>
        )}

        {/* The vocabulary on its own. The exam already asks these, but a
            handful at a time on a clock — and the acronyms are the one part of
            this corpus that rewards being sat down with. */}
        {recent.length > 0 && (
          <button
            type="button"
            onClick={() => setDrilling(true)}
            className="mb-6 flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors hover:bg-accent/60"
          >
            <Tags className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 text-sm">
              <span className="font-medium">Acronym drill</span>
              <span className="block text-xs text-muted-foreground">
                Every acronym your documents use, marked as you go, hardest
                first. No clock.
              </span>
            </span>
          </button>
        )}

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void readFile(file);
          }}
          className={`flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-10 transition-colors ${
            dragging ? "border-primary bg-primary/5" : "border-border"
          }`}
        >
          <Upload className="mb-3 h-5 w-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Drop a <span className="text-foreground">.pdf</span>,{" "}
            <span className="text-foreground">.md</span>,{" "}
            <span className="text-foreground">.txt</span> or{" "}
            <span className="text-foreground">.sql</span> file here
          </p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            PDFs are parsed locally — headings are recovered from the typography.
            A .sql script is split into its commentary and its queries, and each
            query is stepped in the order it is evaluated.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".md,.markdown,.txt,.sql,.pdf,text/plain,text/markdown,application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void readFile(file);
              e.target.value = "";
            }}
          />
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            disabled={busy !== null}
            onClick={() => fileRef.current?.click()}
          >
            Choose file
          </Button>

          {busy && (
            <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {busy}
            </p>
          )}

          {error && (
            <p className="mt-3 max-w-sm text-center text-xs text-destructive">
              {error}
            </p>
          )}
        </div>

        <div className="my-5 flex items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            or paste
          </span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <Textarea
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder="# Paste markdown or plain text…"
          className="min-h-[140px] resize-none font-mono text-xs"
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input
            value={pastedName}
            onChange={(e) => setPastedName(e.target.value)}
            placeholder="Name (optional)"
            aria-label="Document name"
            spellCheck={false}
            className="h-10 w-56"
          />
          <Button
            onClick={() => {
              ingest(pasted, pastedName.trim() || undefined);
              setPastedName("");
            }}
            disabled={!pasted.trim()}
          >
            Parse document
          </Button>
          <Button
            variant="ghost"
            className="gap-2"
            onClick={() => ingest(SAMPLE_DOCUMENT, "The Drift Problem")}
          >
            <Sparkles className="h-4 w-4" />
            Load the sample
          </Button>
        </div>

        {recent.length > 0 && (
          <div className="mt-10">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Recent
            </p>
            <div className="divide-y rounded-md border">
              {recent.slice(0, 8).map((item) => (
                <div
                  key={item.id}
                  className="group flex items-center transition-colors hover:bg-accent/60"
                >
                  {renamingId === item.id ? (
                    <div className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <input
                        autoFocus
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onBlur={() => void commitRename(item.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void commitRename(item.id);
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            setRenamingId(null);
                          }
                        }}
                        aria-label={`Rename ${item.title}`}
                        spellCheck={false}
                        className="min-w-0 flex-1 rounded border border-input bg-background px-1.5 py-0.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void openRecent(item.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left"
                    >
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {item.wordCount.toLocaleString()} words
                      </span>
                    </button>
                  )}

                  {renamingId !== item.id && (
                    <button
                      type="button"
                      onClick={() => {
                        setRenameDraft(item.title);
                        setRenamingId(item.id);
                      }}
                      className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                      aria-label={`Rename ${item.title}`}
                      title="Rename"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void forget(item.id)}
                    className="mr-2 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/15 hover:text-destructive focus:opacity-100 group-hover:opacity-100"
                    aria-label={`Remove ${item.title}`}
                    title="Remove from this list"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <BackupControls
          onRestored={() => {
            void db.listDocs().then(setRecent);
            void db.countDue().then(setDue);
            void refreshWeakTerms();
          }}
        />
      </div>
    </div>
  );
}

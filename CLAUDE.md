# FocusParse — working notes

Context for picking this project up cold. The README documents *what* the app
does and why each algorithm is shaped the way it is; this file covers the things
that are not in the code: environment traps, invariants that are easy to break,
how work has been verified, and what is still outstanding.

## What it is

A reading tool for studying dense clinical-data-management PDFs. It paces a
document with speech synthesis, locks a word-level highlight to the audio, and
refuses to let the reader coast past a section boundary without restating what
they just heard.

The user (Michelle, GitHub `masinobi`) is studying for the **SCDM CCDA exam**.
Source material lives in `<corpus folder>`
(it moved off the Desktop, where a shortcut now stands in its place) — nine
PDFs of GCDMP guidance, ICH E6(R3), and the SCDM exam study guide, plus one
markdown study guide. That corpus is the ground truth for every parsing
decision; test against it rather than against invented samples.

## Where things are

| | |
|---|---|
| Project | `<project folder>` |
| Remote | https://github.com/masinobi/Focus-Parse (**private**) |
| Demo | https://claude.ai/code/artifact/bb5b76a5-5b7d-4a52-abdd-324313fc7d08 (private) |
| Stack | Next.js 14 App Router · TypeScript · Tailwind · shadcn/ui · Zustand · IndexedDB · Web Speech · Web Audio · pdf.js |
| Corpus | `<corpus folder>` — **ten PDFs and three markdown files, as of 8 Sep 2026.** Two of the three are the reader's own: `CCDA Discriminator Matrix.md` (near-synonym pairs, seven tables) and `CCDA_Weeks_3-5_Gap_Review.md` (written from a scored mock paper, 21/32). They are mostly *tables*, which is what the twelfth round went and fixed. **There is also a `Cloze Deck` subfolder** of five weekly `.txt` decks plus a mistakes deck -- hand-authored, not loaded by the app, and not counted by any figure here. It was eight PDFs for most of this project’s life; `21 CFR Part 11` and `E6(R2) good clinical practice` were added on 26 Aug 2026, *during* the seventh round — which is how two probe assumptions that had nothing to do with the app came apart at once. Figures elsewhere in this file state the corpus they were measured on. **Plus, since 24 Aug 2026, a `SQL Practice - Trial Screening` subfolder**: a feasibility screen and two drill sets in T-SQL against a Synthea extract, with the CSVs beside them. It is not part of the thirteen and no figure counts it — `scan-sql` is the report that reads it. |
| Past sessions | `the Claude Code transcript folder for this project` |

**Stored shapes carry four independent version numbers.** Bump the wrong one and
either nothing migrates or everything re-parses. They are separate because they
change for different reasons:

| Constant | Where | Now | Bump when |
|---|---|---|---|
| `DB_VERSION` | `db.ts` | **4** | An object store or index is added. Every store creation is guarded by `contains`, so a fresh database and an upgraded one take the identical path. Version 4 added `exams`. **A bump silently hangs any other tab already holding the database**: the second tab blocks the upgrade, `open()` neither resolves nor rejects, so `safe()` cannot catch it and every `db.*` call awaits for ever. Cost half an hour of measuring a page that was fine. Close other tabs before verifying a bump. |
| `SCHEMA_VERSION` | `parse.ts` | **9** | The Token/Chunk/**Section**/**Block** shape changes. A stored document whose `schema` differs is rebuilt from `source` on read — which is how documents already in a reader's browser pick up parser fixes. Version 4 added `Section.furniture` and the pacing-checkpoint metadata; version 5 added `Block.sqlSteps` and `Block.sqlStepOfChunk`; version 6 stopped expanding acronyms inside grid cells, which changes every stored `Token.speechOffset` and `Chunk.speech` in a table block; version 7 marks the front of a book as furniture; version 8 reads markdown pipe tables as grids, which turns rows that were paragraphs into `table` blocks and changes every chunk, token and word count in a document holding one; version 9 records `Section.tier`. |
| `ENTITY_SCHEMA` | `entities.ts` | 1 | Entity extraction rules change. A stale index rebuilds itself rather than reporting yesterday's rules. |
| `BACKUP_FORMAT` | `backup.ts` | **2** | The backup envelope changes. Import validates per record, so a bump need not invalidate old files. Version 2 added `exams`; a version-1 file simply has no such key and reads as absent rather than malformed. |

`SessionState` deliberately has **no** version — see invariant 10. Every field
added to it since must read as `undefined` on sessions already on disk.

**How a previous session's reasoning was recovered.** The feature backlog, and
the two defects fixed most recently, were stated in a chat rather than in any
file. The CCD `list_events` tool returned `(no messages)` for that session, but
the transcripts are plain JSONL on disk at the path above: `grep -rl "<phrase>"`
across them, then JSON-parse the matching line and walk its `text` blocks. That
is how those two defects were identified rather than guessed at — worth doing
before assuming what "the outstanding work" refers to.


## The public demo

A standalone single-file demo lives at the artifact URL above. It is **not in
this repo** — it is a self-contained HTML reimplementation of the pacing engine,
the scratchpad and all four checks, with a trigger rail so a visitor can fire any
mechanism directly instead of waiting for it. Intervals are deliberately
accelerated and the page says so.

**The source now lives at `demo/index.html`.** It did not for the first six
rounds — it was written to a session-scoped scratchpad, so every change meant
fetching the published page back and rebuilding from it. That is committed now
and the recovery dance is over: edit `demo/index.html`, then publish it passing
the existing **URL**. Publishing a file path *without* the URL creates a second
artifact instead of updating this one.

**Favicon: 📖.** Recorded because it is not recoverable. The publish call
requires one and neither `action: "list"` nor `action: "read"` returns the
current value, so a redeploy that does not know it silently changes the icon the
reader finds their tab by. This one was chosen in the seventh round and may not
be what the first six used.

**Republishing takes three calls, not one.** The first publish is refused with
"you hadn't viewed the live version"; a `read` saves the full HTML to a file and
*every line* of that file has to be Read — including line 1, the injected
frame-runtime wrapper, which is ~9KB of minified JavaScript on a single line and
easy to skip. The second publish is then refused as "identical content resent
unchanged" unless the URL is fetched once more. Re-fetch, then publish. The
authored page is lines 2 to the closing `</body></html>`; line 1 is never part
of what is published.

Four things it cost to learn, all of which will bite again:

- **Write it as pure ASCII.** The wrapper owns `<head>`, so the page cannot
  declare its own charset. Curly quotes and em-dashes rendered as `â€œ` until
  every non-ASCII character became an HTML entity in markup and a `\uXXXX` escape
  in script.
- **The artifact renders inside a cross-origin iframe.** It cannot be scripted
  from the parent page and synthetic clicks do not reach it, so it cannot be
  driven by automation the way the app can.
- **A hidden browser tab shows it blank.** Chrome does not rasterize
  cross-origin subframes in a background tab, and the shell's reveal transition
  (opacity 0 → 1) stays frozen there too. This looks exactly like a broken
  artifact. `/code/frame/<uuid>` renders the same content standalone and does
  paint, which is how to check it.
- **Keep the demo's logic in step with `src/lib/quiz.ts` and `parse.ts` by
  hand.** It is a parallel implementation, so the one-blank-per-sentence fix had
  to be applied twice, and so did the seventh round's two check-builder changes:
  the cross-reference guard in `buildCloze`, and a grid speaking its cells
  without expanding acronyms. Anything fixed in the real check builders should be
  mirrored, or the demo will start demonstrating behaviour the app no longer has.
  **Mirror it so it is demonstrable, not just present** — the cross-reference
  guard needed a sentence added to the demo's own text before it did anything,
  and both were then proved load-bearing by disabling them and re-running
  (6 of 12 grid chunks diverge without the first; "4.2" is blanked out of
  "Section ____ defines the review cycle" without the second).
- **The demo must be pure ASCII, and drifts.** The wrapper owns `<head>`, so the
  page cannot declare a charset. Two em-dashes had got into JavaScript comments
  in an earlier round — invisible there, and a trap the moment that text moves
  into markup. Check with a byte scan before publishing, not by eye.

## Environment traps

These have each cost real time. Read before running anything.

**Node, npm and `gh` are on PATH — do not prepend it.** This entry used to say
the opposite, was believed for an entire session, and cost
`export PATH="/c/Program Files/nodejs:$PATH"` on every single command for no
reason. Verified in both shells: `which node` gives
`/c/Program Files/nodejs/node` under Bash, and `Get-Command node` resolves under
PowerShell. `gh auth` is already configured for `masinobi` with `repo` scope, so
pushes work.

**Never run `npm run build` while the dev server is running.** The production
build overwrites `.next` underneath the dev server and every chunk starts
500ing — the app renders as unstyled HTML. Stop the server, `rm -rf .next`,
build, then restart. This broke the app once and looked like a code bug.

**Delete `.next` before `npm run dev` after any production build.** Dev mode
tries to clear stale production output and dies with `EINVAL: readlink` on
Windows. Symptom: `next dev` exits 0 immediately at startup.

**The project was moved out of OneDrive for exactly this reason.** Do not move
it back. An earlier move also silently dropped every top-level file (configs,
`package.json`, `.git/HEAD`) while keeping subdirectories — recovery was a fresh
clone. If files go missing, clone from the remote rather than repairing.

**First request after a dev restart takes 30–60s** while Next compiles the
route. Not a hang.

**Never pipe a long-running server into `head`.** This killed the dev server
five times across two sessions and was misdiagnosed each time — recorded here
once as "exits on its own for no visible reason", which was wrong. Starting it
as `npm run dev 2>&1 | head -20` looks harmless and is not: `head` exits after
its twentieth line and closes the pipe, and the next log line Next writes goes
to a reader that is gone. The process then dies with code 0, or worse survives
with its socket still `LISTENING` while the event loop is stuck on that write —
which presents as connections accepted and never answered.

That is why the symptom always looked like something else. It fires on the
*next log line*, so it correlates with how much the app is being used rather
than with anything in the code: a page that hangs, CDP calls timing out, `/`
answering 404 forever, a PDF that "fails to ingest". One of those was nearly
committed as a parser regression.

Start it detached from any pipe — `npm run dev > /tmp/fp-dev.log 2>&1` — and
read the log file. Proved by doing exactly that and then running the full
browser probe against it: 20 log lines, all 16 checks green, server still
answering 200 afterwards.

**Check the server is alive before believing the browser.**
`curl -s -o /dev/null -w "%{http_code}" http://localhost:3000` costs nothing.
And prefer killing the one process on port 3000 (`netstat -ano | grep :3000`,
then `taskkill /F /PID <pid>`) over `taskkill /F /IM node.exe /T`, which takes
out every node process on the machine and SIGKILLs `next dev` mid-write to
`.next` — which is one way to produce the stale-cache trap below.

**A bad compile can wedge the dev server outright.** Related to the 404 trap
below but a different symptom: after one save with a half-finished JSX edit, the
server logged the syntax error and then stopped responding — no recompile on the
next save, and requests hanging until curl timed out rather than erroring. Same
cure: stop it, `rm -rf .next`, restart. Nothing was wrong with the code by then;
`tsc --noEmit` and `next lint` both passed against the file the server refused to
rebuild.

**A route that was working can start 404ing mid-session.** After Fast Refresh
logs "had to perform a full reload", the dev server's `.next` cache can corrupt
— the symptom is `⨯ SyntaxError: Unexpected end of JSON input` in the server
output, followed by every request to a route returning 404 while the server
still looks healthy. Nothing is wrong with the code. Stop the server, delete
`.next`, restart. This cost a confused detour hunting a route that had been
loading two minutes earlier.

**Reading `window` during render breaks hydration.** A `"use client"` component
is still server-rendered, so `typeof window !== "undefined"` returns false on
the server and true on the client, and React replaces the whole document with a
hydration error. `/voice-check` shipped with exactly this bug: the server
rendered the "unsupported" branch and the client rendered the controls.
Discover browser capabilities in an effect and have both sides render the same
placeholder first.

**Console errors in a reused tab are stale.** The devtools bridge accumulates
messages across navigations, so after fixing a hydration error the old stack
traces keep coming back and it looks unfixed. Verify in a fresh tab.

## Invariants that are easy to break

These are load-bearing and not obvious from reading a single file.

**1. Speech offsets, not display offsets.** Displayed text and spoken text are
*different strings*. Acronyms expand for the ear (`eCRF` → "electronic case
report form"), evidence grades are silent. Every token carries both `offset`
(display) and `speechOffset` (utterance), and `tokenAtCharIndex` searches
`speechOffset`, because that is the coordinate space `onboundary` reports. Break
this and word-level sync silently desyncs on any document containing an acronym.

**2. `seekNonce` vs `advanceToken`.** The speech engine restarts its utterance
when `seekNonce` changes. *Deliberate* position changes bump it; the engine's own
per-word `advanceToken` does not. If `advanceToken` ever bumps the nonce, every
spoken word restarts the audio.

**3. A silent token contributes no separator.** Its `speechOffset` therefore
coincides with the next token's, the boundary search resolves forward, and the
caret steps over it. That is intentional — dwelling on an unvoiced word is how
sync drifts.

**4. Grid glyphs must leave the prose stream.** A detected table is removed from
the line assembly *and* spliced back as an `fp-grid` fence. If both happen, the
same content is flattened into cards and linearized into the unreadable run the
flattener exists to replace.

**5. `intercept` and `check` are separate state, deliberately.** The cognitive
intercept's resume path is load-bearing and well-tested; the two cheap checks
(grid, cloze) live in a parallel `check` slice rather than being folded into it.
Anything that gates playback must consult *both* — `setPlaying`, `togglePlaying`
and the keyboard handler all do. Miss one and audio plays underneath an open
check.

**6. Only one check fires per sentence boundary.** `finishChunk` evaluates
intercept, then grid, then cloze, and returns on the first hit. The order is
descending cost and it is not arbitrary: stacking two stops back to back turns
enforcement into obstruction. A consequence worth knowing is that a grid ending
exactly on a section boundary loses its question to the intercept.

**7. A check must never be armed unless it can be answered.** The engine calls
`buildGridQuestion` before arming a grid check and discards the result — it is
asking whether a question exists. An armed check with nothing to render is a
dialog the reader cannot dismiss and cannot answer, which ends the session.

**8. `lastCheckToken` resets on every deliberate seek.** Otherwise skipping
forward banks credit toward a cloze check drawn over text that was skipped
rather than heard.

**9. Vigilance clears on any proven interaction.** `presence()` is folded into
`togglePlaying`, `submitSummary`, `passCheck` and `replayGrid`. Without it a
check raised moments before a pause is still open on resume with its grace
window already spent, and the reader is marked absent for coming back.

**10. `SessionState` has no schema version.** `ParsedDoc` carries one and
`db.getDoc` rebuilds a stale document from `source`; sessions have neither.
`db.getSession` hands back whatever was written, however old, so any change to
`FlowNode` or the session shape must read defensively — an added field will be
`undefined` on every session already on disk, and there is no migration path to
lean on. It is one of the reasons the retrieval queue became its own store — the
other being that reviews span every document and need their own indexes.

**11. `weakTerms` does not reset with the document.** Difficulty is a property
of the reader and the term, not of whatever is open — that is the entire point of
keying it by `termKey` rather than by review id. `loadDoc` and `clearDoc`
deliberately leave it alone, and the paths that change it (`ClozeDialog` after
marking, the loader after a warm-up, `Workspace` on open) refresh it themselves.
The engine reads it synchronously when it arms a check, so it cannot be a promise
at that point.

**12. `FlowNode.links` may be `undefined` on anything already on disk.** Same
root as invariant 10: sessions carry no schema version, so every node captured
before linking existed reads back with no `links` at all. Every consumer says
`links ?? []`. Deleting a node also strips its id from every other node's links —
a dangling id renders as a line to nowhere and survives every save.

**13. The node graph is acyclic, and the view never offers a cycle.** `linkNodes`
walks forward from the target and refuses if it reaches the source; the graph
additionally computes the head's ancestors and withholds the offer, because a
button that silently declines is worse than no button. The lane layout depends on
it. Proved load-bearing by disabling the guard and watching the same click create
the cycle.

**14. The entity index is derived, and stale-checked by word count.** `saveDoc`
syncs it, `deleteDoc` takes it with the document, and `listEntityIndexes` rebuilds
anything whose `wordCount` or `ENTITY_SCHEMA` no longer matches — which is also
how a parser change propagates into it. A rename updates the stored title without
re-walking tokens; re-indexing the 524-page GCDMP on every rename would be minutes
of work for a new name.

**15. Two column detectors, and the loose one must prove itself.**
`detectBandCuts` (a quiet vertical strip) runs first and wins wherever it fires —
it is precise, and a page it handles must not change. `detectColumnStarts` (left
edges) only supplies pages it missed, because one full-width element hides a
gutter for the entire page. The second rule is loose enough to see a column in an
indented list, so it keeps a cut only when almost no runs cross it. Removing that
straddle check would silently split single-column documents down the middle; ICH
E6 is the canary, and it must stay byte-identical.

**16. Journal furniture is marked, never removed.** `Section.furniture` is a
heuristic over recovered PDF typography, and deleting text on a heuristic is how
a real section vanishes with nobody noticing. Everything marked is still parsed,
still in the structure map, and still reachable by seeking to it. What changes:
playback will not *wander* in (`finishChunk` skips forward past it, a deliberate
seek does not), the question builders and the entity index draw nothing from it,
and it arms no intercept. Measured at 3.6% of the corpus and 11% of the EDC
implementation chapter.

**17. Every load path must go through `hydrateSession`.** The session writer
waits on `hydrated`, which only that function sets — including on the path
where there is nothing to restore. Miss it on a new code path and that
document's reading is never saved at all. The flag exists because `loadDoc`
resets captures to empty and hydration fills them a tick later: a writer that
did not wait could persist the empty state over a real session.

**18. Backups carry `source`, never parsed documents.** Measured at 21x smaller
on a real database (263KB against 5.6MB for 40k words), and it is the only form
that survives a parser change — which is the same reason `getDoc` rebuilds from
`source`. Import merges by timestamp and never deletes; an older review item
carries an older interval, and applying it over a newer one silently undoes
weeks of scheduling.

**20. Coverage may never demand what the ladder will not raise.** A coverage
map is a list of debts, and a debt the reader cannot discharge is worse than no
map — it never clears, the number never reaches the top, and after a week of
that nobody reads the panel. So every rung in `coverage.ts` mirrors a condition
in `finishChunk` rather than a property that merely looks equivalent: the
summary is owed by the section being *left* (the intercept fires on crossing
*into* one that arms it), a grid is owed only while it is still askable
(`buildGridQuestion` non-null, invariant 7) and still offered (`gridAttempts`
under `MAX_GRID_ATTEMPTS`). Three separate permanent debts came out of getting
this wrong, and none of them was visible in the unit tests that were written
first.

**21. The speed control's number is a claim the app then checks.** `rate` means
something different on every voice — 2.0x is about 1.4x on a local voice and
1.9x on a network one — so the control asks for words per minute and `pace.ts`
solves for the rate. Two consequences that must survive any change here: a
target the current voice cannot reach has to be *shown* as unreachable rather
than accepted, and the rate must only be re-solved when the reader moves
something (the target, or the voice). `rate` is a dependency of the speech
engine's effect, so a controller that corrected as it read would cancel and
restart the utterance at intervals nobody asked for.

**22. The horizon only ever shortens, and only where it is read.**
`scheduleReview` takes an optional `horizonDays` and applies it as a *cap* on
the interval it would otherwise have granted. It must never raise one, never
touch `ease`/`reps`/`lapses`, and never reach the relearning path — a failed
item comes back in ten minutes, which is sooner than any horizon and is not the
horizon's business. `undefined`/`null` has to be byte-for-byte the old
scheduler, because that is what a reader with no exam date is running. And it is
read inside `db.recordAnswer` rather than passed by each of the eight call
sites: a scheduling rule that must be remembered at every dialog, the drill, the
exam and the reading engine is one that will be missing from the ninth. Same
reasoning as invariant 17.

**23. An exam record is immutable, and outlives the document it quoted.**
`deleteDoc` takes reviews and the entity index with the document — a question
whose source text is gone can never be checked again — and deliberately does
*not* take exam records. A paper is a fact about the reader on a date; forgetting
one of the nine guidelines afterwards does not make it untrue, and each
breakdown row keeps the title it was sat under so it still reads. For the same
reason the backup importer has no newer-wins contest for papers: a record
already present is the same record.

**24. A SQL clause is a unit of evaluation, not of breath.** `sqlSteps` is
*not* index-aligned with `chunks`, unlike `steps` on a grid — the feasibility
screen's main `WHERE`, with its two `EXISTS` predicates, is 1,241 characters:
one correct step and seven times `MAX_CHUNK_CHARS`, which exists to dodge the
synthesizer's long-utterance truncation. So a long clause becomes several chunks
that are all still one step, tied together by `sqlStepOfChunk`. Never fix this by
cutting the clause instead: the moment a step boundary is anything other than a
clause boundary, the feature stops meaning what it claims. Anything reading
`sqlSteps[k]` for `chunks[k]` is wrong.

**25. Clause cutting happens at depth 0, outside strings and comments.** Every
way of getting this wrong yields a *plausible* split rather than a crash: the
query still renders, the steps still play, and the reader is quietly taught an
evaluation order that is fiction. `EXISTS (SELECT 1 FROM c WHERE ...)` must stay
one predicate of the outer `WHERE`; a `LIKE` pattern containing "select from"
must not be a clause boundary; `[Order By Date]` is a column name. `ON` belongs
to its `JOIN` and is never a clause of its own. And the `WITH` clause is
*replaced* by its CTEs' clauses, each CTE built whole before the next — ordering
them by clause rank alone interleaves two independent queries into one.

**19. `source` is a complete record.** Everything rides through the markdown
intermediate rather than a side channel, so `db.getDoc` can rebuild a document
with the current parser when `schema` is stale. Schema is currently **4**; bump
`SCHEMA_VERSION` in `src/lib/parse.ts` whenever the Token/Chunk shape changes, or
old stored documents crash playback with missing fields.

**But `source` is the *assembled* markdown, not the PDF.** Rebuilding from it
picks up every change to `parse.ts` and nothing at all from `pdf.ts` — the
extraction has already happened by the time `source` exists. A fix to heading
recovery, column detection or table flattening therefore reaches a document
already in a browser only if the PDF is ingested again. This is not a defect
(keeping 800KB of PDF per document to re-extract on every parser change is the
worse trade), but it is the difference between a fix that propagates silently
and one that has to be asked for.

**26. A name is matched exactly, or listed, or not at all.** Two modules now
map external names onto this corpus — `blueprint-coverage.ts` for GCDMP chapter
titles, `citations.ts` for regulations — and neither is allowed a similarity
score. The counterexample is in the handbook: it carries both *Assuring Data
Quality* and *Measuring Data Quality*, one word apart, and only the second is on
the exam blueprint. Every edit-distance or trigram metric pairs them, and the
failure is silent in both directions at once — the reader is told they covered a
chapter they never opened, and the real gap never appears. Fuzzy matching is
used in exactly one place, as an *alarm*: `scan-blueprint` flags any corpus title
within an edit or two that did **not** match, so a missing alias is adjudicated
rather than absorbed. Three tables carry the decisions — `ALIASES` (this *is*
that chapter), `RESEMBLES` (related, never counted), `EXCLUDED` (examined and
ruled out) — and a name in two of them is an authoring error the tests catch.

**27. A parked thought is stored and is nowhere.** `FlowNode.parked` keeps an
intrusive thought out of the list, the graph, the counts, the chain and the
intercept’s captures, while still being persisted with the token it was dropped
at. It is deliberately not a `LogicTag`: the point is that it is *outside* the
argument being built. It must never attach to the open chain or become the next
head — splicing "renew the car insurance" into entity → mechanism → output is the
whole thing this prevents — and, like `links`, it is optional, so every node
already on disk reads back without it and that has to mean "not parked".

**28. A dictated summary is repaired only from the section’s own vocabulary.**
A recognizer returns "see disk" for `CDISC` and "e see are eff" for `eCRF`, and
an uncorrected transcript fails a correct summary on the ladder’s most expensive
rung. But a corrector is more dangerous than the recognizer it repairs, because
a mangled word is visible and a substituted one is not. So nothing outside the
acronyms *this section contains* is ever substituted in, the forms matched are
derived from the acronym rather than guessed at, and every substitution is
declared on screen over the text that produced it.

**29. No source file may contain a control character.** Not style — three live
rules in this codebase were silently dead because a stray byte had replaced the
backslash escape they were written with: `pdf.ts`’s front-matter rule, `parse.ts`’s
doubled-terminator rule, and a URL mask in `citations.ts`. Each compiled, ran,
and matched nothing. `source-hygiene.test.ts` walks `src` and `scripts` and is
the only thing that sees it; TypeScript compiles it, ESLint passes it, and a diff
shows an empty space. See the working-practice note in "Outstanding" for the
mechanism that keeps producing them.

**30. A grid is spoken exactly as it is shown; prose is not.** Invariant 1 says
displayed and spoken text are different strings, and inside a sentence that is
the point — hearing "electronic case report form" is why acronyms expand. A grid
card is not a sentence: it shows one cell alone in the largest type in the app.
The argument that settles it is the check that follows, not comfort.
`buildGridQuestion` draws its answer from the raw cell value, so with expansion
on, the reader studied "case report form" and was then asked to pick `CRF` — the
study channel and the test channel disagreed on 33 of the corpus’s 262 grid
steps. Only the *speech* changes: the acronym tag stays, because it feeds the
corpus index, the acronym drill and cloze weighting.

**31. Every rung of the ladder refuses the same unfair blank.** A blank asking
where something is rather than what it says is worthless at any rung, and
`isStructuralReference` sat in `quiz.ts` being called only by `exam.ts` — so a
paper threw out "Section ____ states" while the check firing every 250 words
asked it, 72 times across 2,774 blanks. When a fairness rule is added to one
check, look for the other rung that should also be refusing it.

**34. The length floor belongs to the section being *summarized*.** The
intercept fires on crossing *into* a section with `intercept` set and asks about
the one just *left*, so testing `sections[entering].intercept` puts
`MIN_INTERCEPT_WORDS` on the wrong section entirely. It did, for a round: the
reader was stopped to restate "Best Practices", whose whole body is its own
two-word heading, and the grader was handed that heading as the section text.
21% of every intercept in this corpus was of that shape, 138 of them in the
GCDMP alone. `demandsSummary` is the one rule now, and `finishChunk` and
`buildCoverage` both read it -- they each carried their own copy and so shared
the defect exactly, which is how the coverage map came to badge a two-word
heading LOGGED.

**35. A section is named by its chapter, or it is not named.** 157 of the
GCDMP's 525 intercept sections share a title with another -- 28 "Introduction",
23 "Minimum Standards", 19 "Best Practices". The intercept prompt, the grader
payload and the retrieval queue all identified a section by that alone, and at
review the text is gone and that string is the entire question. `qualifiedTitle`
adds the enclosing chapter using the structure map's own `chapterTitles` walk,
so a section is named the same way everywhere it appears.

**36. Repairing a queue deletes only what was never answerable.** The sweep
sweeps on *length* alone, deliberately not on `demandsSummary`. That predicate
bundles three conditions and only one makes a stored sentence worthless: "too
short to have said anything" means the reader restated a heading, while
"nothing follows it" and "what follows arms nothing" are facts about where the
intercept fires, and a re-parse moves them around. Sweeping on the full
predicate deleted a real 60-word section's summary in the probe because it
happened to be last in its document. Anything the sweep cannot evaluate -- no
section recorded, a section index the document no longer has, another
document's item -- is counted and left alone.

**37. A heading never outranks the document it names.** A standalone chapter
PDF repeats its title as a running heading, and blueprint coverage let any
section match beat the document match -- so four words beat 8,377 and `Vendor
Selection and Management` read as *verified on eight words*. `Design and
Development of Data Collection Instruments` was counted at 14 and is 14,283. A
section outranks its document only at `MIN_INTERCEPT_WORDS`, the floor the
intercept, the coverage map and the sweep already share. A shorter match still
counts as coverage, because that is the only way a chapter that exists as a
heading inside the GCDMP handbook is found at all -- but within one document
and one chapter the two are exclusive in *both* directions, or 8,377 words
reads as 8,381 and trips the report's own inflation assertion.

**38. A markdown table is structure, and is never a guess.** `FLATTEN_MIN_STEPS`
exists because a grid *detected* from glyph coordinates can be half-recovered,
and confident cards of invented structure are worse than the prose they
replace. Typed pipes are not a detection, so no confidence floor applies to
them. The one thing that still refuses to fold is a table that would flatten to
no steps: the fence it emits is discarded by the line loop, so folding it would
delete the reader's text with nothing to show it ever existed.

**39. A tier is read off the heading, never out of the prose.** `shall`/`must`
mandatory and `should` advisory is the obvious rule and it is backwards on this
corpus: `should` appears 2,931 times, 327 of them *inside* sections titled
Minimum Standards against 23 inside Best Practices, and **32 of the 51 Minimum
Standards sections contain no `must` and no `shall` at all**. The GCDMP writes
its mandatory tier in "should". And the tier is not a property of the sentence
anyway -- "Document the sponsor's process and support functions" is a minimum
standard in the 2013 vendor chapter and a best practice in the 2021 release,
same words, decided by the edition. `scan-tiers` prints the modal-verb
disagreement as a standing control: if it ever comes out small, `tiers.ts` is
wrong.

**40. An absence costs nothing, and the app says so.** Nothing recorded a
missed session before this and nothing was removed to keep it that way --
`abandonCheck` already cleared, stopped, rewound and recorded nothing. What was
missing is that **no timer reached an open check**: `useVigilance` runs `if
(!enabled || !isPlaying) return` and arming a check pauses playback, so the one
state a reader most often walks away from had nothing watching it. `useReentry`
ticks on the opposite condition. The offer is an *offer* -- audio that starts by
itself in a tab someone just returned to is hostile -- and it never reports how
long the absence was, because that number has no use except to be read as a
reproach. `away` is deliberately not cleared by `notePresence`: returning is
itself a presence event, so a flag presence cleared would never be seen.

**41. A shape may replace a number; a clock may not.** `nextStop` refuses a
countdown because it moves on its own and becomes a thing to watch instead of
the text. That argument is about a *clock*, not about numbers, and the sentence
gauge satisfies it for a stated reason: it only moves when a sentence ends, a
dozen or so times per leg, so there is nothing to watch between moves. It draws
the spot-check rung only -- 250 tokens is 13 to 18 sentences and fits a row; the
summary distance is often a thousand words and stays a number.

**42. A watchdog may never be tighter than the wait it backs up.** The stall
timeout was a flat 1,600ms while the estimator grace reached 2,800ms, so a voice
the engine was still waiting for had already had its sentence abandoned -- and
`/voice-check` measured Edge's first boundaries between **575ms and 2,376ms**,
so this hit real voices on this machine. It presents as "Aria doesn't work but
Mark does", because local voices report in tens of milliseconds and never reach
either clock. `stallTimeoutFor` now takes the grace as an argument so the
ordering is structural. **Two independent constants describing one ordering will
drift; derive the second from the first.**

**Confirmed fixed by the reader in Edge on 9 Sep 2026** -- "Aria now works". The
fix shipped as a reasoned one, because nothing in this repo can execute the
speech path; the confirmation came from the machine that had the fault. Worth
recording as the shape of the whole episode: **a fix nothing here can verify is
not finished when it is pushed, it is finished when the person who reported it
says so.**

**43. Elapsed time is only speech time once the audio has started.** The
estimator interpolates the caret at a fixed words-per-minute, and it measured
from the moment the utterance was handed to `speak()` -- one cold network round
trip too early. On resume the caret walked to the end of the sentence while
nothing was audible, then froze there, because real boundaries all arrived
behind the guess and highlight movement is monotonic within an utterance.
`estimatorAnchor` uses the `start` event and returns null before it arrives:
**no basis for a guess is a reason to do nothing, not a reason to guess from the
nearest number to hand.** The fallback is the load-bearing half -- nothing
obliges an engine to fire `start`, and a missing fallback would freeze the caret
for every sentence on one that does not. **Confirmed by the reader in Edge on
9 Sep 2026** -- the caret tracks the audio through a resume. Like invariant 42,
shipped as an inference and closed by the machine that had the fault.

**32. Help offered at an intercept is recorded with the answer.** The "Stuck?"
anchors hand a reader the section's own nouns, which turns free recall into
cued recall. `ReviewItem.cued` travels with the summary so the self-grade weeks
later -- the only place that sentence is ever judged -- knows which it is
holding. It changes no interval, no ease and nothing about what the section
owes: the reader cannot un-see the anchors, and a debt that cannot be
discharged is invariant 20's whole complaint. If another rung ever offers help,
it needs the same field, for the same reason `gridAttempts` counts attempts.

**33. Anchors come from the section, never from the document.** A term the
section did not use, handed to the reader at the one moment they are being
asked what the section said, is the app putting words in their mouth --
invariant 28's argument, in a second place. Acronyms are read off the tokens of
`tokenStart..tokenEnd`; index entries qualify only if their `sections` list
names this one, which is also what keeps a *stale* index from contributing an
acronym the section no longer contains.

## How to verify work here

Unit tests would not have caught most of the real bugs in this project. What has
worked:

**Drive the running app through browser JS.** Synthesize a file drop with
`DataTransfer` on the dropzone, then poll the DOM. Instrument
`SpeechSynthesisUtterance` to capture what is actually spoken, and `AudioContext`
to inspect the audio graph. Measure — don't eyeball.

To get a real PDF into the page, copy it into `public/` and `fetch` it back as a
`File`; the in-page dropzone cannot reach the filesystem. Delete the copy after.
The same `DataTransfer` trick sets a hidden `<input type=file>`: assign
`input.files` and dispatch a `change` event, which is how the backup importer was
exercised through its actual UI rather than by calling `db.importAll` directly.

**Two browsers, and they hold different data.** The in-app Browser pane and the
user's real Chrome (`claude --chrome`) are separate profiles with separate
IndexedDB stores. Chrome holds their own reading: three documents, real
summaries, no review items — *not* the nine-PDF corpus, which is read in Edge and
is not reachable from either tool. So end-to-end checks against "the corpus" are
really checks against whatever that profile happens to hold; the nine-document
claims in this file all come from the offline scanners instead.

**Leave their data as it was found.** Verifying features that write to IndexedDB
means writing into a real study record. What worked: note the exact prior state
first, prefer a throwaway document (the sample) over a real one, and undo
afterwards — delete the test document, empty the review queue back to zero,
confirm sessions read back unchanged. Restoring is part of the verification, not
tidying after it.

**Scan the real corpus.** `node scripts/scan-tables.mjs "<folder>" --verbose`
compiles `src/lib/tables.ts` and runs that same module over every PDF, so the
report and the app cannot drift. Every threshold in `pdf.ts` and `tables.ts` came
from measuring this corpus.

`node scripts/scan-columns.mjs "<folder>"` reports column recovery. Read
*rescued* as the result (~11,500 words corpus-wide); "not rescued" is an upper
bound, not a defect count — the report's two-column test is deliberately looser
than the parser's, so it also flags single-column pages with indented numbered
clauses. See invariant 15.

`node scripts/scan-exam.mjs "<folder>" --verbose` builds a real 40-question
paper from `exam.ts` over the corpus and asserts the ways one can be quietly
unfair: an answer missing from its own options, one fact asked twice, a blank
asking for a cross-reference. It also scores a perfect paper and a blank one, so
a marker that had stopped marking would show. Current state: 40/40 assembled,
all 9 documents represented at 4-5 questions each, 18 cloze / 15 acronym / 7
grid, 0 on every must-be-zero line.

`node scripts/scan-entities.mjs "<folder>" --verbose` does the same for
`entities.ts`, across PDFs *and* markdown: it drives the same `assemble` the app
uses (exported from `pdf.ts` for exactly this — `extractPdf` itself is
browser-only, it loads the pdf.js worker from a URL). Current state on the real
nine: 524 entities, 117 in two or more documents, 52 in three or more, 0 on every
must-be-zero line. (It was 613/142 before journal furniture stopped being
indexed — 126 of those entities were author names out of bibliographies.) Both extraction rules that are not obvious — connectors
absorbed into a name, single words needing to out-number their own lowercase form
— exist because the first run over the corpus led with "Department", "Health",
"Human Services", "Data" and "Management".

`node scripts/scan-compare.mjs "<folder>" --verbose` drives `compare.ts` over
the corpus for twelve exam-relevant phrases. Its headline check slices every
quotation at the offsets the panel renders with, which is the only place
`parse.ts` and `compare.ts` are made to agree -- reaching for `speechOffset`
instead of `offset`, invariant 1 exactly, turns it red at 17. It also prints
what the entity index would have found for the same phrases, which is the
measurement the feature was redesigned around and is a *report*, not an
assertion: what the index carries is a property of the corpus. Three further
guards live below a line marked "cannot currently fail" -- they were written as
must-be-zeros and found, by breaking the module, to be restating their own
implementation.

`node scripts/scan-headings.mjs "<folder>" --verbose` reports heading recovery
and the wrapped-heading join. Current state on the real nine: 1,032 headings,
24 rejoined from two lines, 1 join declined (a RACI table row, correctly
refused), 0 that lost text, 0 that did nothing. ICH E6 and the exam study guide
are byte-identical before and after the join. Read *declined* as the number to
watch: a join is abandoned when the rejoined text stops satisfying the caps that
keep prose from being promoted, and a decline count climbing far above the joins
made would mean the caps are cutting real headings.

`node scripts/scan-coverage.mjs "<folder>" --verbose` asks the one question
`coverage.test.ts` cannot: **can a real document ever reach 100%?** It drives a
perfect reader over every document and asserts nothing is left owing, and
scores the same documents with an empty session as the control — a model that
called everything verified would pass the first test on its own. Current state:
1,102 sections, 0 still owing after a perfect reading, 0 verified after doing
nothing. It also reports that 0 of 16 tables are ones no question can be built
from, which means the guard keeping an unaskable grid out of the account is
*not exercised* by this corpus and a green there is not evidence.

`node scripts/scan-checks.mjs "<folder>" --verbose` does the same for `quiz.ts`,
and asserts the invariants that fail silently: an answer duplicated among its own
distractors, a grid replay re-asking one cell, a blank readable off its own
carrier. Note it compiles to **CommonJS**, unlike scan-tables — `quiz.ts` and
`parse.ts` import each other without file extensions, which Node's ESM resolver
rejects. Current state: 16/16 grids questionable, 0 on every must-be-zero line,
and 3 of 5
cloze windows promote a weak term into the check when one is marked as repeatedly
failed (must be > 0 — a boost that never displaces anything is a control wired to
nothing; confirmed it goes to 0 with `WEAK_BOOST` at 0).

`node scripts/scan-sql.mjs "<folder>/SQL Practice - Trial Screening" --verbose`
runs the clause splitter over the reader's real scripts, which asks something
`sql.test.ts` cannot: **does a real query survive being cut up?** Every
assertion is a conservation law, because the failure mode is not a crash — a
splitter fooled by a keyword inside a string produces steps that look entirely
reasonable and teach an evaluation order that is fiction. Current state: 3
scripts, 5 statements, 29 steps, 0 on all seven must-be-zero lines. Read the
"longest steps" list as the thing to watch; see invariant 24 for why the answer
to a long one is never a shorter clause.

Worth knowing before reading those step counts as a measure of reach: the two
drill files yield **one step each**. They are almost entirely prose in block
comments, which is the correct outcome — essentially all of the stepping lands
on the feasibility screen.

`node scripts/scan-blueprint.mjs "<folder>" --verbose` is the one report here
whose answer can be "no, and no amount of reading will fix it". It matches the
transcribed exam blueprint against the library and prints what the exam names
that the corpus does not have. Current state on the eleven: 18 chapters named,
15 verified by a perfect reading, **3 absent** — `Metrics for Clinical Trials`,
`Reports and Metrics`, `Vendor Selection and Management (Released 2021)` — and 0
on all five must-be-zero lines. The alarm to watch is "unadjudicated near
misses": a corpus title within an edit or two of a chapter name that did not
match is a missing alias, a missing resemblance, or a decision nobody has
written down. It found one on its first run (`m) Data Privacy`, a lettered
run-in sub-heading inside the DCI chapter — two hundred words, not the
twenty-page chapter) and that is now recorded in `EXCLUDED` with the reason.

`node scripts/scan-citations.mjs "<folder>" --verbose` runs the citation
recogniser over the corpus. Current state: **376 citations, 21 regulations**, 0
on all four must-be-zero lines. `21 CFR Part 11` is cited 118 times across 9 of
the 11 documents. The precision checks are the asserted ones; recall is
*reported* and the gap is meant to be wide — 287 bare section references are
left uncovered on purpose, because a bare "section 5.0" is ambiguous between a
provision of E6 and the fifth section of whatever is being read. Also read the
"parts refused" line: the whitelist in `PARTS` is what stops `\bPart \d+\b`
matching "part 1, subpart J of this chapter" forty times inside Part 11 itself,
and what it rejects is printed rather than swallowed.

**The probe now has seven paths**, four of them added in the seventh round: the
parking lot, blueprint coverage, the citation index, and the summary intercept
with dictation. Three things about the new ones are worth knowing before
touching that file.

*The intercept is portalled.* `document.body.innerText` does **not** return the
dialog’s text, so a check written against innerText reports a perfectly working
intercept as missing. Read it out of `document.querySelector("[role=dialog]")`.
Half an hour went into diagnosing an app that was fine.

*Reaching an intercept needs a fixture shaped for it.* A section arms one only
at `MIN_INTERCEPT_WORDS` (60) or more, so the fixture’s **second** section has to
be long while the first stays short enough to read through in seconds. Playback
does advance under headless Chromium — three Windows SAPI voices are present —
at roughly 115 wpm.

*Dictation is driven by replacing the recognizer constructor* with one that
reads from a script, via `addInitScript`. Everything downstream of the
constructor is the app’s own code, including the vocabulary repair. What that
cannot cover is the microphone and what Chrome actually returns for these words.

**A contrast assertion, because rendering is not the same as being visible.**
The "has minimum standards" badge used `text-destructive`, which in dark mode is
the token `0 62.8% 30.6%` — a dark red meant to sit *behind* text. It rendered,
it was in the tree, every structural check passed, and at 10px it measured
1.86:1. The probe now flattens the translucent layers behind it and asserts a
real WCAG ratio (13.91:1 now). Same lesson as the clipped `JOIN`s, third
component: nothing in the DOM says a human cannot see this.

**Two probe assumptions came apart when the corpus grew**, neither about the
app, both on the same day the reader dropped in two new PDFs. `getByRole("button",
{name: "Play"})` matches accessible names by *substring*, every word in the
reader pane is a `role="button"` span for click-to-seek, and the new smallest PDF
says "display" seven times — nine matches, strict-mode violation, dead probe.
And the exam path asserted exactly 20 questions, which was the old sample
document’s yield rather than a claim about anything; it now reads the paper’s own
denominator. **A probe that hard-codes a number measured from whichever file
happened to be smallest is testing the corpus, not the app.**

**The stepper’s path** — the third of the seven — drives it in Playwright,
and the assertion that matters could not have been written at the DOM level: the
spans existing, the classes applying and the counter incrementing would all be
equally true of a stepper that played clauses top to bottom. What it asserts is
that **the highlight moves backwards through the text on its own** —
`FROM@1 → JOIN@2 → WHERE@3 → SELECT@0`. It also asserts no clause is clipped out
of the pane, which is the lane graph's lesson applied to a second component.
23 checks, 0 failures.

**Some claims have no corpus, and a property test is the substitute.** The
exam-date horizon touches no document, so there is nothing to scan — and its
promise ("nothing is scheduled past the exam") is about a reader answering over
*weeks*, not about one call. `deadline.test.ts` therefore simulates a thousand
seeded run-ups from 1 to 120 days out at random qualities and asserts no
interval ever lands after the date. Worth knowing why there are two tests and
not one: setting the horizon share to 1.0 — schedule right up to the exam —
leaves that property **green**, because it does not actually violate it. What
catches it is the second test, that a settled item comes back five or more times
rather than once, which is the whole reason the share is a half. A single test
here would have passed the wrong rule.

**Measure a voice before trusting it.** `/voice-check` (dev route) speaks real
parser output through every installed voice and resolves each boundary event
with the same `tokenAtCharIndex` the engine uses. Word-exact pacing is a
property of the *voice*, not the app, and no amount of listening reveals which
ones have it — a voice firing no boundary events sounds identical to one that
does. Run it after installing any new voice.

Baseline on this machine (2026-08-21). **Chrome sees three voices; Edge sees
49.** All 49 are word-exact at 100% coverage and precision — including every
"Online (Natural)" cloud voice, which was the open question. Boundary events are
not the reason to avoid network voices.

**Read in Edge.** Windows "natural voices" installed through Narrator do *not*
register as system TTS voices — after installing Aria, AvaHD and AndrewHD the
speech registries were byte-identical, and Chrome still enumerated only David,
Mark and Zira. The good voices in Edge are Edge's own online set, which Chrome
will never see. Nothing in the app can change this.

The differentiator is **latency to the first boundary**, because the engine
utters one sentence at a time and pays it on every sentence:

- Local voices: 414–711ms. Network voices: 575–2376ms.
- The `Multilingual` variants are the worst of the set — Brian 2376ms, William
  2252ms, Andrew 2212ms. Over two seconds of lead-in per sentence.
- Best natural picks: **Aria 576ms**, Guy 637ms, Jenny 729ms, Christopher 760ms.
- `rate` is honoured better by the network voices (~1.9x at 2.0x) than the local
  ones (~1.7x), though 2.0x has never delivered 2.0x on any voice measured.

Two rate figures in that run are noise rather than signal — Rosa reported 4.35x
and Brian Multilingual reported nothing. The rate test is two timed utterances,
so network jitter contaminates it; treat rate on network voices as approximate.

**The estimator grace is learned, not fixed.** That measurement is why. Every
voice measured is slower to its first boundary than the old 320ms constant, so
the estimator was moving the caret on a guess at the start of most sentences —
and because highlight movement is monotonic within an utterance, the real events
then had to catch up to the guess before the caret moved again. A late voice
therefore read as a caret that lurched and then stalled.

`graceFor` now waits on what the selected voice has actually done: 1.5x its
smoothed first-boundary latency, seeded at 1200ms for an unheard network voice
and 320ms for a local one, capped at 2800ms, and dropped back to the baseline
once a voice has gone two utterances without firing anything — otherwise a
genuinely boundary-free voice would sit in silence before pacing began. A/B on
the sample document, 16 seconds each and identical reading progress: the
estimator engaged **4 times on the old constant, once on the learned grace**,
and that once is the first utterance, before there is anything to learn from.

Three separate false alarms came out of writing that probe, all from the same
root: an expanded acronym is one token spoken as several words. Boundaries land
mid-token by design, so precision must be measured against **word starts in the
spoken string** rather than token starts, and monotonicity must count only a
*strict* decrease — repeated boundaries on one token are the caret holding,
which is what the design intends. If a metric reports the same suspicious number
for every voice, suspect the metric.

**Prove an assertion can fail before trusting it.** `scan-checks.mjs` shipped for
several minutes printing `two blanks sharing one carrier: 0 (must be 0)` on a
counter that was declared and printed but never incremented — the edit that was
meant to add the increment silently matched nothing. A green that cannot go red
is worse than no check, because it reads as verification. The habit that caught
it: revert the fix, confirm the number goes non-zero, restore. It reported 3.

Related, and the reason that happened: **a string-replace edit that finds no
match does nothing and says nothing.** Assert on the match, or grep afterwards.
Two separate silent no-ops happened this way in one session.

**Sample fast enough to see the thing you are measuring.** The adaptive
estimator grace looked like a rounding error at 2-versus-1 when the badge was
polled every 400ms, because the estimator only shows for ~150ms at a time. The
real effect was 4-versus-1, visible only by counting rising edges at 50ms. If a
measured improvement looks like noise, suspect the sampling before the change.

**Beware HMR when driving the app.** Hot-reloading the store module leaves the
keyboard hook's listener detached, and *every* key silently stops working —
including `Space`, which predates any of this. It looks exactly like a keybinding
regression. Reload the page fully before concluding a key is broken; an hour went
into chasing one that was not.

**Read back from IndexedDB** to check what was actually stored, rather than
trusting the rendered view.

A project `.claude/settings.json` allowlists the read-only commands above so
they stop prompting. It deliberately does **not** allowlist `git commit`,
`git push`, or `npm run build` — the first two are outward-facing and the third
is the one that breaks a running dev server.

**`npm run probe "<corpus>"` drives the app in Playwright.** Needs a dev server
on :3000, and uses a fresh browser context every run, so it never sees or
touches the reader's own IndexedDB. It ingests a real PDF through the app's own
file input, builds a chain in the scratchpad, checks the lane graph at two
widths, then runs a 20-question exam to a marked paper and reads the review
queue back out of IndexedDB. Sixteen checks, one command, and it screenshots
both to `scripts/.probe-*.png` for eyeballing.

Three things it took to make that reliable, each of which will bite again:

- **Set a file input only after hydration.** The input exists in the
  server-rendered HTML, so Playwright fills it happily and React's `onChange`
  never runs — the app just sits there. There is no signal for "hydrated" on
  the loader (it renders identically before and after), so the probe sets the
  file and retries if the app did not react.
- **Every word in the reader is `role="button"`** for click-to-seek, so
  `getByRole("button", { name: "New" })` matched 23 elements including the word
  "new" in the document. Scope role lookups to `header`, or to a real
  attribute — the List/Graph toggle is reachable by `aria-pressed`.
- **Assert the contract, not the wish.** The first version asserted the graph
  always fits its pane; it does not, and must not — below a 124px lane floor it
  scrolls on purpose. A probe that fails on correct code is a probe that gets
  switched off, so it now asserts "fits, or is already at the floor".

**`npm test` covers what no corpus scan can reach.** The scanners measure
everything that depends on real documents, which is most of this project — but
SM-2 interval arithmetic, backup validation, the words-per-minute solver and the
coverage rules have no corpus dependency and would otherwise be uncovered. Each
of them fails silently rather than loudly: a wrong interval still returns items,
just at the wrong time; a wrong rate still reads aloud, just not at the speed on
the control; a wrong coverage rule still draws a map, one that says a section
was verified when nothing was ever asked about it. 81 tests, in
`src/lib/*.test.ts`, next to the code they pin.

Every assertion in `pace.test.ts` and `coverage.test.ts` was proved able to go
red before being trusted — dropping the fitted intercept fails five, `clamped`
stuck true and stuck false each fail two *in opposite directions*, and four
separate breaks of the coverage rules each name the tests that catch them. This
is not ceremony. `scan-checks.mjs` once shipped a counter that was declared,
printed and never incremented, and a green that cannot go red reads as
verification while being the absence of it.

**Look at it in a real browser before believing a layout.** `claude --chrome`
drives the user's own Chrome, which is the only way anything here has been seen
rather than measured. The lane graph passed every numeric check — edge paths,
lane placement, offer counts, an IndexedDB round trip — and still rendered as one
visible lane and a horizontal scrollbar, because nothing in the DOM says "this
does not fit the pane a human sees". Two screenshots found it in a minute.

**A hidden tab lies in both directions.** `Page.captureScreenshot` intermittently
times out against a tab whose `visibilityState` is `hidden`, and when it does
succeed it can return a *stale partial paint* — the first capture of the corpus
index showed the list shoved into the right half with the toolbar off-screen, and
`getBoundingClientRect` then said the list was centred at x=254 with every control
on screen. The layout was never wrong. Check `document.visibilityState` before
trusting a screenshot, and measure anything a screenshot appears to show.

Bugs found *only* by scanning real output, never by tests: the glued-citation
rule eating three digits out of DOIs (`journal.pone.0083049` → `pone.3049`); a
26-row grid reported as fragments of 6 and 10 with a data row as the header; an
evidence grade fused as `patient.[III]` that an anchored pattern missed.

## What a long document costs

`Full-GCDMP-Oct-2013.pdf` is not the same kind of object as the rest of the
corpus. Every other PDF is one GCDMP chapter or one guideline; this is the whole
compendium, and it is **6.7x larger than the next biggest**:

| | tokens | chunks | blocks | sections |
|---|---|---|---|---|
| Full GCDMP (524 pages) | 136,645 | 10,447 | **5,404** | 773 |
| ICH E6(R3), the next biggest | 28,024 | 2,328 | 1,491 | 41 |
| 21 CFR Part 11, the smallest | 2,714 | 188 | 116 | 13 |

The reader said the audio froze on it and sometimes the browser with it. It is
the document that finds anything in the app that scales with document size, and
two things did. Both are fixed. A third looked unfixable and turned out to be
mostly an artefact of measuring the development build -- which is the reason to
read this.

**How to measure it, and what the numbers mean.** Drive the real app and read
the main thread, because every candidate cause here is invisible in the source:

- A `longtask` `PerformanceObserver` over 20s of playback gives blocked time.
  Expect run-to-run variance of about a third; take three runs.
- `Performance.getMetrics` over CDP splits the same window into
  `ScriptDuration`, `RecalcStyleDuration`, `LayoutDuration` and
  `TaskOtherDuration` — the last being paint, compositing and DOM work. Four
  hypotheses died on that split alone.
- **The control is the same document in RSVP**, which plays identically with no
  flow in the pane. Without it, and without the idle control beside it, the
  flow's number means nothing. `npm run scan-perf` does all of this, and
  asserts that the control is really a control -- see below, because it was
  not, twice.
- **Say which build every number came from.** The three bullets above were
  written against `npm run dev` and the figures quoted in this section used to
  be dev figures presented as the app's. They are about three times the
  production ones.

**Do not measure with a Playwright role query.** Waiting on
`getByRole("button", {name: "Play"})` reported this document as taking **95
seconds** to open. It takes 12 in dev and under 4 in production. Every word is
a `role="button"` span for
seek-on-click, so the accessible-name scan walks 135,000 candidates and the
probe's own wait was most of what it measured.

**What was wrong, and is now fixed.** `matchAcronym` scanned all 56 keys per
token and built three template literals per key to test the plural forms —
7.6 million comparisons and 23 million throwaway strings on this document, 10%
of the whole open. It is a lookup now: `parseDocument` went from 3,879ms to
671ms. And the flow rebuilt all 5,404 React elements on every spoken word for
React to discover that one had changed; it now reuses the previous element for
every block whose relation to the caret has not moved, which halved the blocked
time. Neither of these is dev-mode-only.

**What is still wrong, and how much: measure the build you are in.** The
figures above were all taken against `npm run dev`, and the conclusion drawn
from them for a whole round -- that the remaining cost is the DOM, that only a
design change can touch it, and that the change is the reader's to make -- was
wrong, because React's development build is most of it. `npm run scan-perf`
opens this document three times in each view against whatever is on :3000.
Same machine, same document, three runs each:

| | `npm run dev` | production | flow's own share, production |
|---|---|---|---|
| open | 7.6-11.8s | 3.8-5.8s | 0.8-2.5s |
| longest unbroken block | 3.6-6.0s | 1.9-2.8s | 1.0-2.0s |
| blocked per 20s of playback | 0.89-1.41s | 0.31-0.47s | 0.28-0.45s |
| JS heap | 210-215MB | 111-112MB | 83-84MB |
| nodes | 419,642 | 419,645 | 408,981 |

**Ranges, and they matter.** Two three-run measurements of the same build an
hour apart differed by 50% on the open, and the machine had 3.7GB of 15.7GB
free at the time. The first dev/production pair taken here was not
back-to-back and made the open look 3.1x better in production; measured
back-to-back it is 1.45x. The playback ratio (about 3x) and the heap ratio
(1.9x) survive that treatment; the open ratio does not. **Take the pair
back-to-back or do not quote it.**

So the reader's recorded 7.2-second freeze is a **2-to-3-second** freeze on the
production bundle, and the flow's own contribution is **one to two seconds of
open, once, and about 1.5% of playback wall time**. That does not buy a design
change. Rendering distant blocks as plain text would still cut the node count
by about three and still cost per-word click-to-seek, acronym badges and bionic
lead-bolding away from the caret -- for a second or two, once, on the largest
document in the corpus. **Not worth it, and the reason it ever looked worth it
is that nobody had measured the build the reader would actually study in.**

What *was* worth doing is one line of README. It said `npm run dev`, so that is
what the reader was reading a 524-page book in, at roughly three times the cost
of `npm run study`. The DOM was never the lever; the build was.

**The control is the whole measurement, and it broke silently twice.** Every
number here is a difference against the same document in RSVP -- identical
parse, identical audio, no flow in the pane. The first version of `scan-perf`
switched to RSVP *after* opening the book, so both arms measured a flow-mode
open and reported them as identical: 4,791ms against 4,962ms, a clean result
meaning nothing. The second attempt picked its document by file size and
profiled an image-heavy EDC chapter instead of the GCDMP. So the script now
asserts its own control -- the RSVP arm must lay out **zero** word spans on a
warm-up document before the book is opened, the flow arm must lay out some, and
the two arms must build different DOMs -- and exits non-zero if any of those
fail. Confirmed by removing the view switch: it reports "CONTROL BROKEN" and
exits 1. **Timings stay a report**; run-to-run variance is about a third and a
threshold over that would fail for the weather.

**Do not measure with a Playwright role query, and do not pick the document by
file size.** Both traps are live in this corpus. The role query is recorded
above. The file-size one is quieter: the largest *file* here is a 3.8MB EDC
chapter full of images, while the GCDMP is 2.4MB and 6.7x more text.

**The map is 755 rows, and that was its own problem.** Not performance —
navigation. Every other document in the corpus is twelve to seventy-eight rows;
this one is 39 chapters and 716 headings inside them, and the headings repeat:
all 39 chapters carry a "Scope", a "Minimum Standards", a "References" and a
"Recommended Standard Operating Procedures". A filter that only listed matching
titles would have answered "minimum standards" with 28 identical rows, so
`section-search.ts` labels every hit with its chapter and matches a row on its
own title *or* its chapter's — which is also what makes typing a chapter name
open the chapter rather than return one row. Real queries take the map from 755
rows to 28 ("minimum standards"), 32 ("privacy") or 2 ("sae"). It filters the
*displayed* rows, not `doc.sections`: a heading split into six pacing
checkpoints is six sections and one row.

**It opened by reading its own cover aloud, and that is fixed.** "Good Clinical
Data. Management Practices. October 2013 Edition." — the title, centred across
two lines and recovered as two chapters, then the edition line, the society, and
the whole cover again on the next page. The exam study guide did the same with
"CCDA Exam" and "Study Guide".

**The fix is the convention, not the text.** A book puts its table of contents
after the cover, the title page and the copyright, and before the text, so
everything up to and including a heading that is exactly "Contents" is front
matter. Nothing on those pages says "cover"; their position does. Two guards,
both load-bearing and both break-proven: the title must match *exactly*, because
"Contents of the Data Management Plan" is the kind of heading this corpus is full
of; and it must fall in the first twelve sections, because past that a heading
called "Contents" is something else.

The wrapped-heading repair cannot help here and should not be made to. It joins a
heading that ran out of measure, detected by the first line reaching the right
edge of the text block — and a cover title is *centred*, so it reaches nothing and
the join correctly declines. Rejoining it would produce one junk chapter instead
of two.

Effect, measured across all twelve documents: **exactly two changed.** The GCDMP
marks 9 more sections as furniture and now opens on "Executive Summary" instead
of "Good Clinical Data"; the exam study guide marks 4 and opens on "1 CCDA Exam
Domains and Tasks". The other ten are byte-identical. `SCHEMA_VERSION` went to 7,
because the flag is computed at parse time and a document already in the library
would otherwise keep the old one.

**The obvious scanner assertion for this cannot fail, and is not used.** "Playback
does not start on furniture" restates `firstContentToken`, which is *defined* as
the first non-furniture section. It was written, run against the rule reverted,
and found still green. `scan-coverage` reports where each document starts speaking
instead — a human reading that list can see a cover in it. The share cap beside it
is honest about being unexercised: unanchoring the pattern *and* removing the
depth cap, the worst this rule can do, still leaves it at 0, because no heading in
these twelve documents begins with "contents" except the two real ones.

**A gap the measurements do not cover.** `useSpeechEngine`'s stall watchdog
recovers from one failure only — the engine silently dropping an utterance and
going idle, which it catches by testing `!synth.speaking && !synth.pending`. If
the platform instead wedges with `speaking` stuck true, no boundary, no `end`
and no `error` ever arrives, the watchdog re-arms for ever and the audio is dead
until the reader hits pause. That is exactly what "the audio freezes" would look
like, and this document issues **10,447 utterances in one session** against
1,600 for the next biggest, over Edge's *network* voices. It could not be
reproduced here: headless Chromium enumerates zero voices, and a headed launch
fails with `spawn UNKNOWN` in this environment. **Unverified, therefore not
fixed** — if the audio still stops after the main-thread work above, this is
where to look, and the test is whether pressing pause and play brings it back.

## Feature inventory

Dual-channel pacing (a **words-per-minute** target, solved per voice;
Standard/Bionic/RSVP) · kinetic scratchpad with
`/e` `/m` `/o` tags · cognitive intercepts at section boundaries · pacing
checkpoints every 700 words so intercepts never depend on heading recovery ·
pre-scan structure map · PDF ingestion with column/heading/furniture recovery ·
citation and superscript stripping · acronym badges (~60 CDM terms, five
categories) · kinetic visual anchors (block caret, syllabic pulse, clause
spotlight) · brown-noise masking · document renaming · optional AI summary
grading · grid detection and the matrix flattener · **grid interrogation on exit
from a matrix** · **cloze spot checks every 250 words** · **a jittered presence
check that stops the audio when nobody answers** · **a spaced-retrieval queue
that outlives the session** · **a cross-document entity index** · **linked flow
nodes with a lane graph** · **cloze weighting by what the queue says is not
sticking** · **JSON export and merge-import of everything** · **a timed mock
exam across the whole corpus** · **an acronym drill over the whole
vocabulary** · **a coverage map that reports what has been verified rather than
how far the caret got** · **a kept exam history with a repeat-miss report** ·
**an exam date that caps every review interval at half the time remaining** ·
**a T-SQL stepper that reads a query in the order it is evaluated** · **blueprint coverage, which measures the library against the published exam outline rather than against itself** · **a citation index over the regulations the corpus argues about** · **`/p` to park an intrusive thought without it entering the map** · **the distance to the next enforced stop, in words** · **dictating a summary, with the document’s own acronyms put back into the transcript** · **a grader that asks whether the summary reached the *why*, and says when the section gives none** · **a name filter over the structure map, which labels every hit with the chapter it is in** · **one phrase read across every guideline at once, quoted in context** · **the section's own nouns on request when the summary box is a blank page, recorded as a cued recall**.

Four of those are one idea, and reading them separately misses the point: grid
interrogation, cloze spot checks, the presence check and the retrieval queue.
The app used to *assume* a reader was present, enforce engagement only at
section boundaries, and let everything it produced die with the session. See
"The enforcement ladder" and "Spaced retrieval" in the README for why each
threshold is where it is.

Three more are also one idea, added later: the corpus index, the mock exam and
the cloze weighting all treat the nine PDFs as a single body of material rather
than nine separate reading sessions. The exam draws across all of them, the
index reports what they share, and difficulty is keyed by term so a word lost in
one guideline is preferred as a blank in another.

The exam history and the exam date are one idea too, and it is the only one in
this app that looks *forward*. Everything else here reports on material — how
much was read, what was verified, which terms are not sticking. Neither of those
can answer "is this working" or "is there time", because both questions need a
series and a date, and the app had neither: a marked paper died with its dialog,
and the scheduler did not know the exam existed. See "Exam history" and "The
exam date" in the README.

**Blueprint coverage is the only account in this app that is not closed.**
Every other one measures the corpus against itself — how much was read, what was
verified, which terms recur — so the one question none of them can reach is
whether the corpus is *enough*. That is the only number here more reading cannot
move, and on this library it is **two**: `Metrics for Clinical Trials` and
`Reports and Metrics`, neither of which exists in the 2013 GCDMP edition. It
read three until the twelfth round, when `Vendor Selection and Management
(Released 2021)` turned out to be sitting in the corpus under a title that
normalizes to the *other* vendor chapter's -- see invariant 37.

The coverage map is the fourth thing that belongs to the enforcement-ladder
idea above, and arguably the point of it. The ladder was already producing
per-section evidence — a summary, a grid pass, a marked spot check — and
discarding two thirds of it. Recording the third rung and rendering all three
against the structure map is what turns "43% read" into "these four sections
were read and nothing was ever asked about them".

**AI grading** is optional and provider-agnostic: `GEMINI_API_KEY` or
`ANTHROPIC_API_KEY` in `.env.local` (Gemini wins if both). The Gemini path is
verified end to end; the Claude path typechecks but has never run. Model is
`gemini-3.6-flash` — note `models.list` still advertises `gemini-2.5-flash` but
the endpoint rejects it for new keys. **Restart the dev server after changing
`.env.local`**; Next only reads it at startup.

## Outstanding

Everything here is committed and pushed on `main`, through the fifteenth round.
Permission to push is asked for each batch: it is outward-facing, and one grant
does not carry to the next.

**Where the last session left it.** Four rounds have landed. The first three
were the feature trio (entity index, node linking, adaptive difficulty), the
"other trio" (two defects, backup/restore, mock exam), and two fixes that came
out of the reader actually using it — journal furniture, and column recovery.
That last one matters most: about a fifth of the corpus's two-column pages were
being read with the columns *interleaved*, ~25,000 words, and it was found only
because the reader said one chapter felt "long and repetitive" and two headings
looked missing. **Take that kind of report seriously and measure it** — twice now
a vague complaint about the reading has turned out to be a real parser defect.

The fourth round cleared the top four of this backlog: the coverage map, the
true-WPM control, the acronym drill, and wrapped headings. What each cost is in
its own commit message; what is worth knowing here is that **three of the four
turned out to have a second problem underneath the stated one**, and in every
case the second problem was found by running the thing rather than by reasoning
about it. The drill was silently bounded by the exam's per-document cap (30
acronyms offered where the corpus uses 50). The coverage map demanded three
different debts the enforcement ladder will never raise. The wrapped-heading
join needed its looser word cap to travel with the line, or it merged a heading
and then demoted it.

The fifth round added two things that were *not* on the original list, because
the reader asked what else was worth building: keeping the mock paper, and
telling the app when the exam is. Both had the second problem underneath, and
both were again found by running it. The repeat-miss report named one term two
different ways depending on which kind of question was missed last — a cloze cut
around an acronym has the acronym as its answer, a definition question has the
expansion, and they key to the same term. And an auto-graded item can never
exceed the horizon on its first rep, so the cap could not be *seen* to work until
an item with a long earned interval was injected and answered through the real
UI: 60 days earned, 4 days to the exam, "back in 2 days" — and "back in 5
months" with the date cleared. **Assume the next item has one too, and find it
by driving the app rather than by reading the diff.**

Three assertions written this round could not go red, all caught by breaking
them on purpose: the repeat-miss ordering test (insertion order already matched
what it expected), the guard against printing an acronym as its own expansion
(only exercised by a term with no acronym), and — the interesting one — the
horizon's headline property, which stays green at a share of 1.0. See "Some
claims have no corpus" above.

The sixth round added the T-SQL stepper, and it had the second problem too —
two of them. `scan-sql` found a 1,241-character step, one correct clause and
seven times the utterance cap that exists to dodge synthesizer truncation; and
the screenshot showed every `JOIN` running off the pane edge, reachable only by
dragging a scrollbar sideways while the audio moved. Neither is visible in a
diff. **Three** of its assertions could not go red, all found by breaking them
on purpose — including the scanner's headline check, which rebuilt each
statement from its own step spans and so could never fail.

The seventh round took five features at once, at the reader’s direction, after
they asked which of a list of five suggestions were worth building. Four were
reshaped rather than built as pitched, and the reshaping was the work:

- **Blueprint coverage** was the recommendation, and it is the only thing here
  that can tell the reader to go and *find* something. Transcribed rather than
  parsed — the study guide’s domain tables are rotated and extraction
  interleaves the chapter names with task text, so a heuristic yields a
  plausible blueprint, and a domain missing two chapters reads exactly like a
  domain that only had four.
- **The cross-reference drawer became a citation index.** Counting the corpus
  first said no to the drawer: ~356 cross-references, of which the great
  majority name a regulation that is not in the library, and the local ones are
  worse — every GCDMP chapter has its own `Table 1`. What the count *did* reveal
  was that Part 11 is discussed by nine of the eleven documents, which the
  entity index structurally cannot see.
- **The countdown became a distance.** A ticking clock in the field of view is a
  thing to watch instead of the text, which is why the vigilance pill sits in a
  corner. Both rungs are reported, because naming only the summary is true and
  misleading — the cadence check interrupts four or five times inside the same
  stretch.
- **The parking lot became a tag**, because the scratchpad was already most of
  one. The gap was real and small: an untagged capture lands in the graph’s note
  lane, and the intercept shows the section’s captures *beside the summary box*,
  so a stray thought was on screen at the app’s most demanding moment.
- **Dictation was built as pitched**, with the piece the pitch did not mention:
  the recognizer does not know this vocabulary, and an uncorrected transcript
  fails a correct summary. See invariant 28.

**Adaptive contrast boosting was declined and should stay declined.** It was the
fifth suggestion and the reader excluded it. The reason to keep it excluded is
that it cannot be verified: every other rung leaves evidence a scanner can
count, and a display that changes itself on a guess about attention has no
green that can go red. It is the one thing in this file that would violate the
whole verification practice below.

**Two bugs found sideways, both pre-existing, both invisible in a diff.** A
stray control byte had replaced the backslash escape in `pdf.ts`’s front-matter
rule and `parse.ts`’s doubled-terminator rule, killing both. Reviving the first
drops three journal citation lines that were being promoted to headings — the
EDC chapters go 39/65/44 to 38/64/43, the corpus from 1,052 recovered headings
to 1,048 and 1,147 accountable sections to 1,146. See invariant 29.

**A working-practice note that has now cost time five times, and the mechanism
is finally identified.** Edits to these files are applied by scripted string
replacement, and two things go wrong silently. A replacement that does not match
is a no-op — which produced a `parse.ts` fence hook that was never installed
while everything around it was, a feature-inventory line stale for a whole
round, and a `git checkout -- .` in a recovery script that reverted every
tracked file of an in-progress change. **And a Bash heredoc collapses `\\` to
`\`**, so a Python string written as `'\\b'` arrives as `'\b'` and Python turns
it into a backspace. That is where every control character in invariant 29 came
from, including three planted *during* the seventh round — one of which
disabled a probe assertion that went on passing. **Assert on every replacement;
build backslashes with `chr(92)` or write the edit script to a file rather than
piping it through a heredoc; never run a bulk checkout to recover one file; and
read the test summary before committing, not after.**

The reader is currently working through *Electronic Data Capture — Study
Implementation and Start-up*. Documents already in their browser rebuild
themselves from `source` when opened, so they pick up anything that changes in
`parse.ts` — **but not the heading fix**, which lives in `pdf.ts` and runs before
`source` exists. Those PDFs have to be dropped in again to gain it. See
invariant 19.

Done and not to be redone: the five-item feature list's items 1 and 2 (backup,
mock exam), the entity index / node linking / adaptive difficulty trio, the two
defects (grid results surviving a reload, voice persistence), journal furniture,
column recovery, the coverage map, the words-per-minute control, the acronym
drill, wrapped headings, the exam history, the exam-date horizon, the T-SQL
stepper, and the seventh round’s five: blueprint coverage, the citation index,
the parking-lot tag, the distance to the next stop, and dictation with vocabulary
repair. The backlog below is what is left — which, of everything ever suggested,
is one item and one deliberate refusal.

**Suggested and not built.** Of the two lists ever pitched, one item remains
and one is refused.

*Remaining:* the one-key **"that sounded wrong" marker** during reading, which
stamps the current chunk and section into an exportable list. Cheap, and
justified by this project’s own history — twice a vague complaint about the
reading turned out to be a real parser defect (interleaved columns, wrapped
headings), and both times the reader had no way to record *where* it felt wrong.
Make that three: the twelfth round's markdown-table defect was found by reading
the corpus folder, and the reader had been studying through pipe-noise with no
way to say so.

*Pitched in the twelfth round and deliberately deferred:* a **discriminator
drill** for near-synonyms — `Attributable`/accountable, verification/validation,
audit/inspection. It is the reader's own diagnosed failure mode and the exam is
largely discrimination, but the honest version cannot *invent* pairs; asserting
a distinction the documents did not state is invariant 26's whole argument in a
second place. The reader already curates the pairs by hand, as two-column
tables, so the twelfth round taught the parser to read those tables instead.
**Measure whether the existing grid check already covers it before building a
second mechanism.**

*Refused, twice, for different reasons:* **hands-free/commute mode** sounds the
most attractive and is the most expensive, because the whole enforcement ladder
assumes a dialog — and recognition fails hardest on exactly the acronyms this
corpus is made of, which the seventh round now has measurements for. And
**adaptive contrast boosting**, which the reader excluded and which should stay
excluded: see the seventh-round notes above for why an unverifiable display rule
is the one feature that would undercut the practice this whole file describes.

*Built after being pitched as something else:* the blueprint-coverage item was
carried in this section for two rounds with the warning that "a sloppy mapping
produces confident wrong percentages, which is worse than no map". That warning
shaped the thing that got built — hence invariant 26, and hence the panel
reporting *absent chapters* as its headline rather than a percentage. The
percentages it does show are per-domain counts of chapters, not weights; the
guide does not publish question weights and the panel says so.

**Nothing is left of the original feature list.** The T-SQL stepper was the last
of it and shipped in the sixth round. The note that used to sit here said the
corpus contained no SQL and the item was therefore the lowest-value one — that
stopped being true on 24 Aug 2026, when the `SQL Practice - Trial Screening`
folder appeared. **Check the corpus folder before trusting any claim in this
file about what is in it.**

**Settled, do not redo: cloud TTS is not needed.** The obvious upgrade for
better voices is a neural TTS service returning audio plus word timings — Azure
emits `WordBoundary` events with the shape the engine already consumes, and it
looked like the only way to get human-sounding speech without losing word-exact
sync. Measurement killed it. Every one of the 49 English voices in Edge,
including all the cloud "Online (Natural)" ones, is word-exact at 100% coverage
and precision. There is no sync argument for taking on an API key, a per-chunk
network round trip, prefetching, an audio cache, and the loss of the "nothing
leaves the machine" property. Revisit only if a voice is needed that Edge does
not carry.

**Known rough edges**

Most of these are deliberate trade-offs with the reasoning attached; the four
marked *candidate* are things that could actually be fixed.

- Blueprint coverage matches a chapter to a *section title*, and a section is
  whatever the parser called one. A twenty-word stub whose heading happens to
  read `Data Privacy` counts as the Data Privacy chapter being partly read. The
  panel prints the word count beside every chapter, which is the honest
  mitigation; a minimum-size threshold would be an invented constant. **Thirteen
  of the sixteen chapters reporting verified are matched on single digits** —
  `Database Closure` on two words, `Edit Check Design Principles` on four. The
  twelfth round stopped such a stub *outranking a whole document* (invariant 37)
  but not it counting as coverage on its own, because a chapter that lives
  inside the GCDMP handbook has nothing else to be found by. Fixing it means
  giving the parser a notion of which sections belong to a chapter, which is a
  design change and not a threshold. *candidate*, and the largest one left in
  this list.
- Blueprint coverage says nothing about *weight*. The study guide lists tasks
  per domain and no question weights, so the panel counts tasks and refuses to
  imply more. A domain with fifteen tasks is not necessarily worth more marks.
- The ICH GCP topics are listed and not mapped to E6 chapters. The guide pairs
  them in a two-column table whose cells are both multi-line, and extraction
  interleaves them irrecoverably — a guessed pairing would read exactly like a
  real one. *candidate*, if the mapping is ever worth transcribing by hand.
- The citation index reads regulations, not local cross-references. "See Table
  1" and "section 5.0 of the protocol" are deliberately left out: the first is
  ambiguous across chapters that each have a Table 1, the second between a
  provision of E6 and a section of the document being read. `scan-citations`
  prints how many bare references that leaves uncovered (287 of 376) so the
  decision stays visible.
- Dictation is Chrome-only and sends audio to Google. The button is absent where
  no recognizer exists rather than present and inert, and the tooltip says where
  the audio goes — but it is on by presence, not by an explicit setting.
  *candidate*, if the reader wants it behind a toggle.
- The microphone path itself is unverified. The probe replaces the recognizer
  constructor with a scripted one, so everything downstream is the app’s own
  code — but what Chrome actually returns for "CDISC" spoken aloud has never
  been measured, and `SPOKEN_AS` is a considered guess at it.
- Three-letter acronyms with few consonants cannot be sound-matched safely.
  `EDC` and `SAE` reduce to skeletons too short to key on, so they are only
  repaired when the recognizer already returned something close to the written
  form. Lowering the threshold would start rewriting ordinary prose.

- Mock exam papers are only as good as the cloze carriers underneath them. The
  cross-reference filter catches "Section ____ states"; it does not catch a
  citation year in parentheses, or an answer that is a PDF extraction artefact
  ("CSUCI" appeared in one real paper). Both were visible only by reading a
  paper rather than a report.
- A grid question needs a detected table, and most guidelines in this corpus
  have none — only 4 of 9 offer any. The 20% target share for tables is
  therefore aspirational on this corpus; the shortfall redistributes to the
  other two kinds by design.
- A section can be marked verified on a spot check every blank of which was
  answered wrong. Deliberate: answering the check is what proves the reader was
  there, and answering it *correctly* is a different claim — folding the two
  together would let a section the reader has been held to three times read as
  unchecked. Recall is reported alongside, per section and per document, and
  turns red below 50%.
- *(candidate)* The reading spot check still allows "Section ____ states"
  blanks. The filter lives in `quiz.ts` and is applied only by `exam.ts`,
  because a spot check exists to prove the reader is present rather than to
  predict a result — but the case for applying it in both places is real and
  untested.
- The corpus index keeps at most 600 entries per document and renders 200 rows at
  a time. Neither cap binds on the current corpus — the GCDMP's 413 entries is the
  largest — and both are reported in the UI rather than silently applied, but a
  bigger document would start dropping its rarest terms.
- "Title" still reaches the shared head of the index, from "Title 21 CFR Part 11":
  the digits break the phrase run. Left alone on purpose — the index reports what
  the documents say, and "Title 21" is a real referenced thing.
- The entity index does not resolve synonyms. "Data Management Plan" and "DMP" are
  two entities, and deciding they are one would mean asserting a relationship the
  documents did not state.
- Card text in the lane graph clamps to two lines, and at a narrow pane that is
  about five words. The full text is on the `title` attribute, and the List view
  is one click away, but the graph is for shape rather than for reading.
- *(candidate)* Acronym expansion inside grid steps reads clumsily: "CRF
  Creation" becomes "case report form Creation". Could suppress expansion
  inside steps.
- A rejoined heading loses the hyphen at the seam: the EDC conduct chapter's
  "Mid-" / "study Protocol Updates" comes out as "Midstudy Protocol Updates".
  The paragraph assembler has always done this to a word broken across a line
  break, and the join follows it rather than inventing a second rule; a
  soft-hyphen and a real hyphenated compound are not distinguishable from the
  glyphs. One heading in the corpus.
- One rejoined heading is merged and then demoted again by the run rules —
  three or more contrasting lines in a row are a caption or an author block, not
  a section. It reads whole and in order as prose, which is the repair working
  even where it does not reach the map. `scan-headings` counts these separately
  from the joins it declined.
- A cloze carrier is only as good as the sentence the parser produced. Where PDF
  column recovery fused two lines in a document's front matter, the blank is
  presented inside that fused sentence. The builder reproduces the chunk exactly
  and deliberately does not try to detect or repair damaged extraction — verified
  that the carrier equals the raw chunk with only the answer replaced, so this is
  upstream, not a cloze bug.
- The grid check yields to the intercept when a table ends exactly on a section
  boundary, so that grid is never questioned. At most one check fires per
  boundary by design; a queue would fix it and was judged not worth the coupling.
- A voice reads at the baseline until it has been *heard* — the words-per-minute
  control shows "est." and solves `target / 185` until roughly forty words at
  one rate have gone by, which is the old behaviour and is marked as such rather
  than hidden. Switching voice often enough never to accumulate a sample would
  keep it there.
- The measured range a voice reports comes from a straight line through as
  few as two observations, so a voice read at only one rate extrapolates
  proportionally and will be wrong at the far end until a second rate is used.
  Reported honestly — the range is shown, and a target outside it is struck
  through — but it is an estimate, not a measurement, until then.
- *(candidate)* The matrix flattener was verified on the vendor-management PDF
  (2 grids, 24 steps). The 524-page GCDMP holds most of the 22 detected grids
  and has not had a full in-browser pass.
- PDF front matter is detected by title, which leaves the PRISMA
  flow-diagram fragments in the EDC chapter ("Records excluded", "Screening")
  reading as content. Seventeen words; not worth a rule shaped around one
  document's methodology figure.
- The exam date is not carried by a backup. Backups are an IndexedDB export and
  the date lives in `localStorage` beside the voice and the words-per-minute
  target; widening the format to reach in for one string was judged not worth
  it, and re-entering a date takes ten seconds. Stated in `deadline.ts` rather
  than left to be discovered after a restore.
- An exam record keeps only the questions that were got *wrong*. A right answer
  has no next action and the counts it contributes to are already in the two
  breakdowns — but it does mean the app cannot later ask "which terms have you
  always got right", and it never will from stored papers.
- The repeat-miss report is blind to papers sat before it existed: records
  written before the acronym fix carry no `acronym` field, so those rows are
  still labelled by whichever question kind was missed last. Confirmed to render
  rather than crash — invariant 10's habit applied to a store that does have a
  version — and it corrects itself as new papers accumulate.
- The horizon compresses intervals but cannot compress a *corpus*. It guarantees
  every item already in the queue comes round again before the exam; it says
  nothing about material never read, and the readiness block deliberately does
  not fold coverage in, because corpus-wide coverage means loading nine parsed
  documents and the home screen must not do that.
- *(candidate)* The readiness block reports four numbers and refuses to draw a
  conclusion from them, because the app does not know the pass mark or what a
  paper it wrote itself predicts. If the real CCDA pass mark and blueprint were
  entered by hand it could say considerably more — see the note on the content
  outline under Outstanding.
- A `.sql` file's prose is recovered from block comments that start their own
  line, and its headings from comments whose first line is a rule of `=` or `-`.
  That is exactly how the reader's three scripts are written, and it degrades to
  plain prose on a script written any other way — but a file using `--` banners
  for its section titles would come out as one long section with no intercepts.
- The two drill files step to one clause each. They are almost entirely prose,
  which is right; it just means the stepper's reach on this corpus is really the
  feasibility screen.
- A string literal containing spaces is already several tokens by the time the
  speech transform sees it, so `'%type 2 diabetes%'` is voiced as three
  fragments. Structure is what the stepper is for and structure survives;
  literals read roughly.
- A `.sql` script's queries are stepped, but nothing checks them: there is no
  grid, no cloze and no acronym drawn from SQL, so a stepped query is read and
  never asked about. The enforcement ladder still fires on the *prose* around
  it, which is where the reasoning lives.
- The stepper knows clause order, not semantics. It will confidently step a
  query that does not run.
- Scanned PDFs with no text layer are rejected rather than OCR'd.

**The ninth round** was two features the reader chose off a list of four, after
being told which were worth building and why. Both were reshaped before they
were built, and in both cases the reshaping came from a measurement taken
first.

- **Cross-guideline comparison** was pitched as a side-by-side built on the
  entity index. The index is the wrong substrate and the corpus says so
  plainly: "audit trail" is in ten of the twelve stored documents and indexed
  in *none* of them, because the extraction takes capitalized noun phrases and
  the terms worth comparing are lowercase prose. Same for "adverse event"
  (ten), "serious adverse event" (nine), "database lock" and "protocol
  deviation" (eight each). A panel on the index would have looked right and
  been silent on every comparison the exam actually asks. It is a phrase search
  over the token stream instead — the shape `citationSites` already uses, and
  its docstring already argues for. **The measurement cost one command and
  changed the design; take it before building on a derived store.**
- **The intercept anchors** were pitched as unconditional scaffolding. Handing
  a reader the section's top terms turns free recall into cued recall, and the
  same sentence is later graded by an AI that reports what was `missed` and
  self-graded by the reader weeks afterwards. Both judgements get quietly
  better for a reason that has nothing to do with recall. So it is opt-in and
  it is recorded — invariant 32.

**A live bug fell out of the probe rather than out of the feature.** The home
screen centres its content in a scrolling flex container, which clips whatever
overflows *above* the scroll origin and leaves it unreachable. Measured at five
documents: the content began 352px above the top of its own scroller, the
container under-reported `scrollHeight` by exactly that much, and the corpus
index and the exam date could not be brought into view at any scroll offset.
The reader has twelve documents. It had been shipping for most of this
project's life and every previous probe passed, because they all drove a home
screen with one document on it. `probe-ui` now asserts *reachability* — every
control visible at some scroll offset — rather than visibility.

**Four assertions written this round could not go red**, all found by breaking
things on purpose, and the two worst were in the probe rather than in the code:

- The anchor panel was selected by matching its text, and `find` over every
  `div` returns the outermost ancestor holding the phrase — the whole dialog.
  All three on-screen assertions were passing on the dictation transcript.
  **Select by an explicit hook, never by text, when the thing being asserted is
  containment.**
- "Some of the anchors are the section's own" survived drawing anchors from the
  entire document, which put a term from a chapter the reader was not being
  asked about in front of them. A `some` check cannot catch a leak; only an
  exact set can.
- The anchor cap was never reached by a fixture with three anchors in it, and
  the ordering claim could not tell "most used" from "alphabetically first" in
  a section with one acronym.

**And three more were downgraded rather than kept.** `scan-compare` prints
"site pointing outside its document", "site with an empty carrier sentence" and
"document reporting fewer than it kept" below a line saying they cannot
currently fail — each restates its own implementation, the same mistake as the
eighth round's "documents that open by reading their own cover". They are kept
because they stop being tautologies the moment the surrounding code changes,
and printed apart because a green that cannot go red must not be counted
alongside greens that can.

**Fixtures were wrong three times, and each was caught by the assertion
failing rather than by review.** "Sponsor oversight" was used as the worked
example of a paraphrase the search would refuse — it is a *heading* in ICH
E6(R3), and "Oversight by the sponsor" is a sentence in the same document. It
was written into a unit fixture, then into a probe fixture, then into the
panel's own explanatory copy, where it would have shipped as an illustration
the app itself disproves. The copy now states the rule and gives no example.

**The tenth round closed the last performance item by not doing it.** The
reader asked about the DOM-size cost. The recorded conclusion -- that it is the
DOM and nothing else, and that only a design change trading away per-word
seek, acronym badges and bionic bolding could touch it -- was drawn entirely
from `npm run dev` numbers. Production is two to three times cheaper across the
board and halves the heap, and the flow's own share of the production cost is
one to two seconds of open, once, plus about 1.5% of playback wall time. The
design change is off the table. What shipped instead was `npm run study` and a
README that no longer sends the reader to the development build to read a
524-page book in. See "What a long document costs".

**The lesson is narrower than "measure first", because that was being done.**
Every dev figure in that section was honestly measured against a real control.
The gap was never saying *which build*, so a set of true statements about
`npm run dev` sat in this file for a round reading as statements about the app.
**Name the build, the machine and the corpus beside any timing, or it will be
read as a property of the code.**

**Three ways a control can be a control and measure nothing**, all hit while
writing `scan-perf`, all of which returned clean numbers:

- Switching the view *after* opening the document, so both arms measure a
  flow-mode open. It reported 4,791ms against 4,962ms and looked like a finding.
- Picking the document by file size. The largest *file* in this corpus is an
  image-heavy EDC chapter; the GCDMP is smaller on disk and 6.7x more text.
- Comparing two arms measured an hour apart. That made the open look 3.1x
  better in production; back-to-back it is 1.45x, and two runs of the same
  build an hour apart differed by 50% with 3.7GB of 15.7GB free.

`scan-perf` now asserts the first two (zero word spans in the RSVP arm before
the book opens, some in the flow arm, different DOMs between them) and exits
non-zero when they fail. The third is a note, because nothing in the script can
see it. **A timing without its pair taken back-to-back is not a comparison.**

**The eleventh round came from a screenshot.** The reader sent one row of the
structure map -- "Best Practices", 2w, 1s, badged LOGGED -- and the sentence "I
only get graded on the title". It was literally true: they had been made to
summarize a section whose entire body is its own heading, and the grader
received that heading as the section text. See invariants 34 to 36.

**Two consumers carrying the same condition separately is how it stayed broken.**
`finishChunk` raised the intercept and `buildCoverage` reported the debt, and
invariant 20 says the second may never demand what the first will not raise.
They agreed perfectly -- on the same defect. The map badging it LOGGED was not a
second bug, it was the first one being faithfully mirrored. **When two places
must agree about a rule, give them one function, not one comment each.**

**387 passing tests said nothing.** They were green with the bug and green
without it, because the coverage fixture used a 100-word section and the floor
is 60. A test that cannot distinguish the two states is not evidence about
either. The probe's intercept fixture was 28 words and *stopped producing an
intercept* the moment the fix landed, which is the only reason the end-to-end
path got checked at all.

**The probe caught a data loss in the repair.** The first sweep swept on
`demandsSummary`, which looked obviously right and deleted a real section's
summary because it was last in its document. "The bad item is gone" was green
throughout; only the paired assertion -- "and the real one survives, renamed" --
turned red. **On any operation that deletes, assert what must survive in the
same breath as what must go.**

**The twelfth round started from a report, not from the app.** Asked what to
build next, the answer came from running `scan-blueprint --verbose` and reading
the reader's own corpus folder rather than from the feature backlog. Both items
came out of that, and neither was on any list.

**A one-line diagnosis that was wrong, and the measurement that said so.** The
blueprint reported `Vendor Selection and Management (Released 2021)` absent and
flagged it as a minimum-standards chapter, with the PDF sitting in the corpus.
The obvious fix -- move one line from `RESEMBLES` to `ALIASES` -- was reported
to the reader before the units were dumped. It was wrong twice over. Dumping
them showed a *four-word running heading* suppressing the 8,377-word document
behind it (invariant 37), and reading the guide showed the two vendor chapters
carry **different minimum standards**: what p38 calls a minimum standard, the
2021 release demotes to best practices. Normalization folds `&` into `and`, so
no title rule can separate them and document-versus-section is what does.
**Announcing a fix before dumping the data is how a report gets published with
a wrong cause attached.**

**Verified 16 of 18 is still mostly table-of-contents lines.** Thirteen of those
chapters are verified on single-digit word counts -- `Database Closure` on two.
The parser has no notion of the sections *belonging* to a chapter, so a chapter
that lives inside the handbook is found only by its heading. The word count
printed beside each row remains the only mitigation, and fixing it properly is a
design change, not a threshold.

**The probe was testing a build from before the work.** Its first run reported
zero grid entries; `next start` was still serving a production build from 13:39
and had been for the whole session, so the *earlier* green run proved nothing
about the blueprint change either. `.next/BUILD_ID` and the served
`buildId\":\"...\"` are the two-second check. **A probe that needs a server it
does not start will eventually test yesterday.**

**Three of twelve breaks did not go red, and each was a different lie.** An
fp-grid idempotence check that could never fail (the emitted JSON has no pipes
in it), a column-width guard already unreachable behind the flatten guard, and a
prose fixture one line too short to reach the loop it was aiming at. The first
became a fence-tracking assertion, the second was *deleted* rather than kept as
decoration, and the third grew a line. **Run the break before believing the
green, and delete a guard no break can reach.**

**The thirteenth round evaluated four pitches and built one.** Three of the four
described a problem the app does not have, and checking is what showed it:

- *Cross-corpus distractor injector.* `ClozeQuestion` has no `options` field at
  all -- reading cloze and exam cloze are both free response, so there were no
  distractors to inject into. Acronym options already come from the whole
  `ACRONYMS` table by category and grid options from the grid's own cells. Had
  it been built, `compare.ts` already measured the failure: "audit trail" is in
  ten of twelve documents, so a Part 11 / ICH E6 swap frequently produces a
  distractor that is *also true*, and `scan-exam`'s "marker rejects its own
  answer" cannot catch it because the marker knows one answer.
- *Pre-roll replay buffer.* A missed cloze already seeks to the exact token of
  the blank -- more precise than the five seconds proposed -- and the grid
  replays whole *on purpose*, because replaying one cell lets a reader pass by
  memorizing one card. Its proposed verification could not exist either: there
  are no tests in `src/hooks`, and headless Chromium enumerates zero voices.
- *Blueprint-weighted mock exam.* The study guide publishes no question
  weights; searched for "weight", "percentage", "% of", "number of questions"
  and every hit is unrelated prose. Weighting by task count would invent them.
  And it is not implementable regardless: **18 of 1,148 section-level units
  match a blueprint chapter, so 98.4% of questions have no domain** -- the same
  chapter-membership gap recorded above as the largest candidate.

The fourth was real and its implementation was backwards; see invariant 39.
**A pitch that names a file and a function is not evidence that it read
either.**

**The fourteenth round: the probe found an assertion that could not exist.**
The sentence gauge's *emptying* is unobservable from a browser test, and it took
running one to see why. `seekToken` sets `lastCheckToken` to the token it lands
on -- deliberately, so scrubbing cannot bank credit toward a check over unread
text -- so every seek starts a fresh leg with nothing done in it, and only
playback advances the caret against a fixed leg. Headless Chromium enumerates
zero voices. The probe asserts the row is *live* instead (11 marks to 4 on a
seek, which a static render fails) and the emptying is left to the unit tests,
with the reason written where the next person will look. **When a probe
assertion will not go green, check whether it is asking for something the app
deliberately never does before changing the app.**

**A test that passed against both rules it was written to separate.** "Keeps the
sentence the leg starts inside" asserted on `done`, which is zero under overlap
*and* under containment. It asserts on `total` now. That is the third time in
three rounds that a break-run found an assertion with no teeth -- an idempotence
check that could never fail, a guard no break could reach, and now this.
**Running the break is not a formality; it is the only thing that distinguishes
a test from a comment.**

**Playwright's synthetic clock is how a fifteen-minute timer is tested.**
`page.clock.install()` then `fastForward("10:00")` and `fastForward("06:00")`,
asserting both sides of the threshold -- an offer that appeared immediately
would satisfy "the offer appears" on its own. It is installed in the last block
of the probe and never uninstalled, because uninstalling is not part of the
stable API and nothing runs after it.

**The fifteenth round was a bug report, and the second sentence was the
diagnosis.** "The voice doesn't work on Microsoft Edge" is unactionable; "aria
doesn't work but mark does" names the fault, because those two differ in exactly
one property. **When a report names a platform, ask which instances of it fail
before touching the platform-specific code.**

**The speech path has no probe and this is what that costs.** Headless Chromium
enumerates zero voices, so `useSpeechEngine` has never been executed by any
verification in this repo -- and the two constants that contradicted each other
sat there through fourteen rounds of it. The timing policy is in
`speech-timing.ts` now purely so it can be unit-tested; the fix itself is four
lines. **Code that no harness can reach will accumulate exactly the defects a
harness would have caught, and moving it somewhere testable is usually cheaper
than the bug.** The reader confirmed the fix the same day, so the inference held
-- but the inference is all this repo had, and that is the part to fix if the
speech path is ever touched again in anger.

**A probe stub has to retire itself.** The scripted voice list leaked into the
next block, where the re-entry replay started playback and the engine assigned a
plain object to `utterance.voice` -- which throws, correctly. The stub reads a
flag now and a second `addInitScript` switches it off, because init scripts run
in the order they were added on every subsequent navigation. **A faked platform
boundary is scoped to the block that faked it, or it is the platform for
everything after.**

**A docstring that describes the symptom is not the same as one that names the
cause.** `graceFor` has said for rounds that "a late voice reads as a caret that
lurches and then stalls" -- a verbatim description of the bug reported here --
and attributed it to the estimator starting too eagerly, which sent every
previous reading of that file to the grace constants. The cause was three lines
below, in what `startedAt` was measured from. **When a comment predicts the
symptom you are chasing and the code around it looks right, suspect the
comment's diagnosis rather than assuming the bug is elsewhere.**

**Two fixes to the same file, one round apart, both from the same blind spot.**
The stall watchdog and the estimator anchor are independent defects that
survived fourteen rounds of verification for one reason: nothing in this repo
can execute `useSpeechEngine`. Both were found from a reader's sentence, not
from a test, and both were fixed by moving a decision into `speech-timing.ts`
where a test can reach it. That module did not exist two rounds ago and now
holds every number the speech path argues about.

**Corpus finding worth remembering:** there is **no Schedule of Assessments grid
anywhere in the user's PDFs** — the phrase appears seven times but always as
prose. The flattener was therefore generalized to any detected grid (22 real
ones: RACI matrices, costing tables, metrics tables) rather than built for
schedules specifically. Don't rebuild it schedule-first without new source
material.

## Working style that has fit this user

Ship complete, verified work and report honestly — including what was *not*
done and why. When a spec cannot be met as written, say so plainly rather than
approximating silently: pulse cannot sync to audio *volume* because
`SpeechSynthesis` exposes no audio stream, and that was worth stating outright.
Prefer measuring the real corpus over adding heuristics on a hunch.

They ask for verification and mean it. "I rather you check the real thing" came
after a claim that the demo was fine based on the source file rather than the
published page — and checking it properly turned up a genuinely blank render
that took real digging to explain. Do not report a thing as working on the
strength of the artifact you produced; look at the thing the user will actually
open, and say plainly when a limit stops you from looking.

Distrust a clean result as much as a broken one. Three separate false alarms
this session came from measurement code rather than the code under test: a
precision metric that punished expanded acronyms, a monotonicity check that
counted a held caret as a regression, and an assertion that could never fail.
Each announced itself the same way — an identical suspicious number across
inputs that should have differed. When a measurement surprises you, check the
measurement first.

Work in small committed steps with a message that records *why*, and re-run the
corpus scan before each one. The commit log is the only place the reasoning
survives; several decisions here would look arbitrary a month from now without
the paragraph explaining what was measured.

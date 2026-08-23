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
Source material lives in `<home>\OneDrive\Desktop\CCDA Study` — nine
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

## The public demo

A standalone single-file demo lives at the artifact URL above. It is **not in
this repo** — it is a self-contained HTML reimplementation of the pacing engine,
the scratchpad and all four checks, with a trigger rail so a visitor can fire any
mechanism directly instead of waiting for it. Intervals are deliberately
accelerated and the page says so.

**The source file does not survive the session.** It was written to a
session-scoped scratchpad, not to the repo, so a later session has no copy of it.
To change the demo, fetch the published page to recover its HTML, edit that, and
republish passing the existing **URL** — publishing a new file path without the
URL creates a second artifact instead of updating this one. If the demo is worth
keeping, the honest fix is to commit it here.

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
- **Keep the demo's logic in step with `src/lib/quiz.ts` by hand.** It is a
  parallel implementation, so the one-blank-per-sentence fix had to be applied
  twice. Anything fixed in the real check builders should be mirrored, or the
  demo will start demonstrating behaviour the app no longer has.

## Environment traps

These have each cost real time. Read before running anything.

**Node is not on PATH.** It lives at `C:\Program Files\nodejs`. Prepend it:

```bash
$env:PATH = "$env:ProgramFiles\nodejs;$env:PATH"
```

GitHub CLI is the same story — `C:\Program Files\GitHub CLI`. `gh auth` is
already configured for `masinobi` with `repo` scope, so pushes work.

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

**15. Every load path must go through `hydrateSession`.** The session writer
waits on `hydrated`, which only that function sets — including on the path
where there is nothing to restore. Miss it on a new code path and that
document's reading is never saved at all. The flag exists because `loadDoc`
resets captures to empty and hydration fills them a tick later: a writer that
did not wait could persist the empty state over a real session.

**16. Backups carry `source`, never parsed documents.** Measured at 21x smaller
on a real database (263KB against 5.6MB for 40k words), and it is the only form
that survives a parser change — which is the same reason `getDoc` rebuilds from
`source`. Import merges by timestamp and never deletes; an older review item
carries an older interval, and applying it over a newer one silently undoes
weeks of scheduling.

**17. `source` is a complete record.** Everything rides through the markdown
intermediate rather than a side channel, so `db.getDoc` can rebuild a document
with the current parser when `schema` is stale. Schema is currently **3**; bump
`SCHEMA_VERSION` in `src/lib/parse.ts` whenever the Token/Chunk shape changes, or
old stored documents crash playback with missing fields.

## How to verify work here

Unit tests would not have caught most of the real bugs in this project. What has
worked:

**Drive the running app through browser JS.** Synthesize a file drop with
`DataTransfer` on the dropzone, then poll the DOM. Instrument
`SpeechSynthesisUtterance` to capture what is actually spoken, and `AudioContext`
to inspect the audio graph. Measure — don't eyeball.

**Scan the real corpus.** `node scripts/scan-tables.mjs "<folder>" --verbose`
compiles `src/lib/tables.ts` and runs that same module over every PDF, so the
report and the app cannot drift. Every threshold in `pdf.ts` and `tables.ts` came
from measuring this corpus.

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
nine: 613 entities, 142 in two or more documents, 67 in three or more, 0 on every
must-be-zero line. Both extraction rules that are not obvious — connectors
absorbed into a name, single words needing to out-number their own lowercase form
— exist because the first run over the corpus led with "Department", "Health",
"Human Services", "Data" and "Management".

`node scripts/scan-checks.mjs "<folder>" --verbose` does the same for `quiz.ts`,
and asserts the invariants that fail silently: an answer duplicated among its own
distractors, a grid replay re-asking one cell, a blank readable off its own
carrier. Note it compiles to **CommonJS**, unlike scan-tables — `quiz.ts` and
`parse.ts` import each other without file extensions, which Node's ESM resolver
rejects. Current state: 16/16 grids questionable, 0 on every must-be-zero line, and 3 of 5
cloze windows promote a weak term into the check when one is marked as repeatedly
failed (must be > 0 — a boost that never displaces anything is a control wired to
nothing; confirmed it goes to 0 with `WEAK_BOOST` at 0).

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

## Feature inventory

Dual-channel pacing (1.0–3.0x, Standard/Bionic/RSVP) · kinetic scratchpad with
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
exam across the whole corpus**.

The last four are one idea: the app used to *assume* a reader was present and
enforce engagement only at section boundaries, and everything it produced died
with the session. See "The enforcement ladder" and "Spaced retrieval" in the
README for why each threshold is where it is.

**AI grading** is optional and provider-agnostic: `GEMINI_API_KEY` or
`ANTHROPIC_API_KEY` in `.env.local` (Gemini wins if both). The Gemini path is
verified end to end; the Claude path typechecks but has never run. Model is
`gemini-3.6-flash` — note `models.list` still advertises `gemini-2.5-flash` but
the endpoint rejects it for new keys. **Restart the dev server after changing
`.env.local`**; Next only reads it at startup.

## Outstanding

**T-SQL logical stepper** — the last item from the user's feature list. Code
blocks are currently never spoken by design; this would reverse that for SQL:
split on clauses (SELECT/FROM/WHERE/JOIN/OVER), one chunk per logical step, with
hard pauses between. Worth flagging that the CCDA corpus contains **no SQL**, so
this is the lowest-value item for the exam they are actually studying for.

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

- Mock exam papers are only as good as the cloze carriers underneath them. The
  cross-reference filter catches "Section ____ states"; it does not catch a
  citation year in parentheses, or an answer that is a PDF extraction artefact
  ("CSUCI" appeared in one real paper). Both were visible only by reading a
  paper rather than a report.
- A grid question needs a detected table, and most guidelines in this corpus
  have none — only 4 of 9 offer any. The 20% target share for tables is
  therefore aspirational on this corpus; the shortfall redistributes to the
  other two kinds by design.
- The reading spot check still allows "Section ____ states" blanks. The filter
  lives in `quiz.ts` and is applied only by `exam.ts`, because a spot check
  exists to prove the reader is present rather than to predict a result — but
  the case for applying it in both places is real and untested.

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

- Acronym expansion inside grid steps reads clumsily: "CRF Creation" becomes
  "case report form Creation". Could suppress expansion inside steps.
- A cloze carrier is only as good as the sentence the parser produced. Where PDF
  column recovery fused two lines in a document's front matter, the blank is
  presented inside that fused sentence. The builder reproduces the chunk exactly
  and deliberately does not try to detect or repair damaged extraction — verified
  that the carrier equals the raw chunk with only the answer replaced, so this is
  upstream, not a cloze bug.
- The grid check yields to the intercept when a table ends exactly on a section
  boundary, so that grid is never questioned. At most one check fires per
  boundary by design; a queue would fix it and was judged not worth the coupling.
- `rate` has never delivered what it advertises on any voice measured: 2.0x
  produces roughly 1.4x on local voices and 1.9x on network ones. The transport
  offers up to 3.0x. Either recalibrate the control or relabel it. (The related
  complaint — that every session started on the slowest voice on the machine —
  is fixed: the choice is remembered, and a fresh install prefers the measured
  fast ones over the platform default.)
- The matrix flattener was verified on the vendor-management PDF (2 grids, 24
  steps). The 524-page GCDMP holds most of the 22 detected grids and has not had
  a full in-browser pass.
- PDF front matter (author lists, affiliations) sometimes survives as a section
  in the structure map.
- Scanned PDFs with no text layer are rejected rather than OCR'd.

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

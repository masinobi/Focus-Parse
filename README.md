# FocusParse

Synchronized audio-visual ingestion with active kinetic re-encoding. Load a PDF,
markdown or plain-text document; FocusParse paces it with speech synthesis, locks a
word-level highlight to the audio, and refuses to let you coast past a section
boundary without restating what you just heard.

```bash
npm run dev
```

Then open http://localhost:3000 and hit **Load the sample**.

## Stack

Next.js 14 (App Router) · TypeScript · Tailwind CSS · shadcn/ui · Zustand · IndexedDB ·
Web Speech API · Web Audio API · pdf.js · optional Gemini or Claude summary grading.

## How the pacing works

The interesting problem is keeping the highlight exactly on the spoken word rather
than interpolating it. The approach:

1. **Parse** ([src/lib/parse.ts](src/lib/parse.ts)) turns markdown into three aligned
   arrays — `blocks` (layout), `chunks` (one sentence = one utterance), and `tokens`
   (one word). Every token stores its character offset **within its own chunk**, which
   is precisely the coordinate space `SpeechSynthesisUtterance` reports through
   `onboundary`.
2. **Speak** ([src/hooks/useSpeechEngine.ts](src/hooks/useSpeechEngine.ts)) always
   utters `chunk.text.slice(currentToken.offset)`. Because every transport action —
   play, pause, seek, sentence skip, rate change — reduces to *"speak from token N"*,
   there is one code path instead of five.
3. **Map back** — each boundary event's `charIndex` is offset-corrected and resolved to
   a token by binary search, then pushed to the store.

Sentences are capped at 180 characters and split on clause boundaries, which keeps
utterances short enough to dodge Chrome's long-utterance truncation and makes
sentence-skip feel immediate.

Three fallbacks keep it honest on weaker platforms:

- **No boundary events** (Safari, several espeak voices): an interpolating estimator
  takes over once the voice has had its grace period, and the header shows an
  `estimated pacing` badge rather than pretending the sync is exact. The grace is
  **learned per voice** rather than fixed, because every voice measured is slower
  to its first boundary than the old 320 ms constant — local ones take 310–711 ms
  and network ones 575–2376 ms. Starting the estimator while boundaries are merely
  *late* is worse than not starting it: it moves the caret on a guess, and since
  movement is monotonic within an utterance, the real events must then catch up to
  the guess before the caret moves again. The engine waits 1.5x what the selected
  voice has actually been doing, and falls back to the short baseline once a voice
  has proved it fires nothing at all.
- **Dropped utterances**: a stall watchdog advances the chunk if nothing is speaking
  and no `end` arrived.
- **Backward boundaries**: highlight movement is monotonic within an utterance.

## PDF ingestion

A PDF has no headings, paragraphs or lists — only glyphs at coordinates.
[src/lib/pdf.ts](src/lib/pdf.ts) reconstructs structure from typography and layout,
emits markdown, and hands it to the ordinary parser. Extraction runs in a worker on
the client; the file never leaves the machine.

Three things make real documents hard:

- **Columns.** Glyphs sharing a vertical position may belong to different columns or
  to a margin note; merging them by row alone produces interleaved nonsense. Gutters
  are found by scanning *character coverage* in absolute points, strictly between the
  leftmost and rightmost glyph — a journal gutter is around 10pt, barely 2% of the
  page, while the page margins are several times wider and would otherwise be
  detected instead. Counting coverage rather than treating it as boolean stops one
  full-width running head from bridging the gutter and hiding it.

  Coverage alone was not enough. One full-width element the table detector did not
  remove — a spanning heading, an undetected table — puts glyphs in the gutter bins,
  breaks the quiet run, and drops the **whole page** to single column. Measured
  before the fix: about a fifth of the two-column pages in the corpus, ~25,000 words,
  read with the columns interleaved a fragment at a time. That is worse than
  obviously broken text, because it sounds plausible and nothing announces it.

  So a second detector runs when the first finds nothing: **where the text starts**.
  A body column has one left edge shared by most of its lines, and nothing crossing
  the gutter moves it. Being the looser rule, it carries a check the first does not
  need — a proposed cut is kept only if almost no runs cross it. On a single-column
  page with numbered clauses indenting the body (ICH E6 is entirely of that shape:
  "1.1" at x=72, its text at x=112) every full-width line crosses, the cut is
  rejected, and that document parses byte-identically to before. `npm run
  scan-columns` measures both: ~11,500 words recovered across the corpus, with the
  gutter detector still preferred wherever it fires.
- **Headings are often smaller, not bigger.** In journal typesetting a heading is
  frequently set smaller and in a contrasting family against the body. Detection keys
  on any deviation from the dominant body style — size, family or weight. Because
  that signal is weak, style-based headings must also be isolated (not inside a run
  of three or more) and followed by prose, which filters author lists, affiliation
  blocks and captions.

  That last rule is also what breaks a heading the measure wrapped across two lines.
  Both halves are heading-styled, so the first is followed by a heading rather than by
  prose and gets demoted — which does not merely lose it from the structure map, it
  turns it into prose glued onto the end of the paragraph above and reads it out
  there. The chapter heading "6) What it Means to Design a Study Application Within an
  EDC System" arrived as "Within an EDC System", and elsewhere "a) Sponsor (or
  designee such as a CRO or EDC Vendor) SOPs" was being spoken in the middle of the
  sentence that followed it.

  The two halves are therefore rejoined before classification runs. The join has to be
  narrow, because two heading lines in a row are also what a section header followed
  by its first sub-header looks like, and merging those would assert a heading neither
  line claims. What separates the cases is physical rather than textual: **a heading
  wraps because it ran out of measure**, so its first line reaches the right edge of
  the text block and its continuation does not. Identical type, one line of leading, no
  sentence-ending punctuation and no second outline marker are corroboration for that
  one signal, and the join is abandoned outright if what comes out no longer reads as a
  heading — half a heading in the map is a defect, a paragraph promoted to a heading is
  a worse one. `npm run scan-headings` measures it: 24 rejoins across the corpus, one
  declined, none that lost text, and ICH E6 byte-identical.
- **Furniture.** Running heads and folios are dropped by repetition across pages
  within the margin strip.
- **Reference markers.** Superscript citations are removed. Size alone is unreliable —
  markers run 5.2–5.8pt against a body that is 9pt on one page and 10pt on the next,
  so any fixed ratio catches some and misses others. The unambiguous signal is the
  *raise*: a marker's baseline sits ~3pt above the text it follows, while a numeral
  that is not a citation (a page folio, a figure number) shares its neighbour's
  baseline exactly. Detection requires both an undersized glyph and a raised
  baseline, and the text must look like a marker (digit runs, roman numerals, or
  `*†‡§`).

Structure recovery is best-effort and varies by document — which is why it is not
load-bearing. See pacing checkpoints below.

## Citation stripping

Reference markers are noise in both channels: they clutter the line, and the
synthesizer reads them, so "time stamps.13" comes out as "time stamps thirteen".
Removal happens in two layers — geometrically during PDF extraction (above), and
textually in [src/lib/parse.ts](src/lib/parse.ts) for anything arriving as plain text:
pasted articles, markdown, and markers set inline rather than superscript.

The text rules cover bracketed *numeric* citations (`[13]`, `[8–10]`), digits fused to
a sentence end (`stamps.13`, `data."8,19`), and reference symbols fused to a word
(`Smith†`).

Bracketed **roman numerals are deliberately kept**: in GCDMP guidance `[I]`, `[III]`,
`[VI]` are evidence-grade markers stating how strong the backing for a recommendation
is. That is content, not clutter — a single GCDMP chapter carries 115 of them.

They are **shown but never spoken**. Read aloud, "[III]" lands as a bare "three" in the
middle of a paragraph and derails the sentence, so the token contributes nothing to the
utterance — not even a separator. Any trailing punctuation survives, so the synthesizer
keeps its sentence-ending pause. The grade is matched anywhere in a token rather than
as the whole of it, because it is not always spaced off: `patient.[III]` is a single
token, and an anchored pattern misses it.

A silent token's speech offset coincides with the next token's, so the boundary search
resolves forward and the caret steps over it rather than dwelling on a word that is
never voiced.

Not corrupting real numbers is the hard part, and the rules are shaped entirely around
it:

- The glued-digit rule anchors on a **letter** before the punctuation, so `312.62` and
  `21 CFR 11.10` are untouchable.
- A trailing lookahead stops it mid-identifier: in `journal.pone.0083049` the run after
  `e.` is followed by more digits. Without that guard the rule silently ate three of
  them — caught by scanning the reference list of a real document, not by unit tests.
- A URL-context check covers the case the lookahead cannot see, a DOI that *ends* in a
  digit run: `10.47912/jscdm.411` is indistinguishable from a sentence plus a marker
  except by what precedes it.

## Grid detection

[src/lib/tables.ts](src/lib/tables.ts) recovers tables from PDF glyph
coordinates. **Detection only** — nothing in it changes how a document is parsed
or spoken yet.

The signal is alignment: a run of consecutive rows that each split into three or
more cells, where those cells share column positions. Prose never produces three
aligned break positions down several consecutive lines. Cells are split at
horizontal gaps above 1.2x the body size — word spacing inside a cell stays well
under half that.

The one non-obvious rule is the row-gap tolerance. Real table rows wrap: a long
first-column label continues on the next line with nothing beside it, splitting
into one cell rather than three. Closing the run there reports a single table as
several — on one page, a 26-row costing grid came back as fragments of 6 and 10
rows with a data row mistaken for the header. Allowing two such rows inside a run
fixes it; the column check afterwards is what stops the tolerance from gluing
genuinely separate tables together.

## Matrix flattener

A detected grid does not enter the prose stream at all. Its glyphs are removed
before lines are assembled — otherwise the same content would be both flattened
into steps *and* linearized into the unreadable run this exists to replace — and
a `fp-grid` fence carrying the grid as JSON is spliced in at the position the
table occupied on the page.

Routing it through the markdown intermediate rather than a side channel keeps
`source` a complete record, so schema migration can rebuild a document without
re-reading the original file.

The parser turns each grid into a `table` block with **one chunk per step**, so
each step is its own utterance and the gaps between them are real sentence
boundaries rather than pauses the engine has to fake. Display and speech text
are identical for a step, which leaves the token/offset machinery untouched; the
cards render from the structured steps, so nothing is lost by it.

When the reading position enters a grid block the pane blacks out and the grid
plays one card at a time — row, column, value — driven by the reading position
rather than a clock of its own, so it cannot drift from the audio. A grid's
words are never laid out in the flow, so the marker left in the text is also the
only way to seek into it by hand.

Two rules keep it honest. Grids below 0.75 confidence stay as prose: a
half-recovered grid read as a sequence of confident-sounding cards asserts
structure that is not there. And a column name is used only when the header cell
*truly aligns* to the column, rather than merely falling in its bucket — header
rows are frequently laid out to a different rule than the data beneath them, a
right-aligned money column under a left-aligned label, and a name placed in the
wrong column would assert a relationship the table never stated. Where the name
cannot be recovered the step simply reads `Row: Value`.

Run detection over a corpus to measure the hit rate rather than guessing:

```bash
node scripts/scan-tables.mjs "path/to/pdfs" --verbose
```

The script compiles `tables.ts` and runs that same module, so the report and the
app can never drift apart.

## Journal furniture

A published guidance chapter is not only guidance. It opens with a citation line,
an author list and an abstract that states the whole chapter before the reader has
read it, and closes with a revision history, a competing-interests declaration and
a bibliography. Measured across the corpus that is **3.6% of everything, and 11% of
the EDC implementation chapter** — about ten minutes of listening to authors and
references, none of it examinable.

It also explains a complaint. That chapter was reported as "super long and
repetitive"; measured, six of its 1,351 sentences repeat verbatim and 2% of its
six-word phrases occur twice, most of those being citation boilerplate. What
repeats is the abstract saying in advance what the chapter then says.

Those sections are **marked, not removed** ([src/lib/parse.ts](src/lib/parse.ts)).
Detection is a heuristic over recovered typography, and deleting text on a
heuristic is how a real section disappears without anyone noticing. Marked
sections stay parsed, stay in the structure map with a `skipped` badge, and stay
reachable — seek to the references and they play. What changes is that playback
never *wanders* in, no blank or exam question is drawn from them, the entity index
ignores them (126 entities came out of author lists before this), they arm no
intercept, and the time estimate stops billing for them.

Two detection rules survived measurement, both keyed on things prose does not do:
a citation marker in a *heading*, and the run-together names PDF extraction
produces where the original had line breaks ("Redkar-Brown,Olivia"). A third —
"three or more capitalized words with a separator" — was written and then dropped:
it matches an author list, but it matches "Data Management and Quality Control"
just as well, and across the whole corpus it found only 452 further words while
changing nothing in the document that prompted the work.

## Pacing checkpoints

Intercepts cannot depend on heading recovery succeeding, so any stretch longer than
700 words is split at a paragraph boundary into `<title> (part N)`. These are ordinary
sections, so the structure map, intercepts and stored summaries work on them
unchanged. A 28,000-word guideline that yields three real headings still gets ~40
intercepts.

Conversely, sections under 60 words never arm an intercept: stopping a reader to
summarize two sentences is friction without a payoff, and it absorbs stacked headers
and the occasional false heading recovered from PDF typography.

## The enforcement ladder

An intercept costs the better part of a minute, which is why it can only fire at a
section boundary. Between two boundaries there is nothing stopping a reader from
drifting for six hundred words — and the session record afterwards looks the same
either way. Three cheaper rungs fill that gap, and the rule is that **at most one fires
per sentence boundary**, in descending cost: a boundary that owes a summary does not
also owe a grid question. The cheaper rungs come round again within a few hundred
words, so nothing is lost by yielding to the expensive one.

What separates the cheap rungs from the intercept is that the app can mark them
itself. The AI summary check is optional and networked, so it can never be the thing
that holds a reader accountable moment to moment. A recovered grid cell and a blanked
term both have exactly one right answer already sitting in the parsed document, and an
answer the app can mark is an answer it can demand.

### Grid interrogation

Leaving a `table` block arms a multiple-choice question about a cell that was just read
out — *"For Project Management, what was the Unit?"* — built by
[src/lib/quiz.ts](src/lib/quiz.ts) from the same `GridStep` data the flattener speaks.
No key, no network, no model.

Distractors are drawn from the same column first, so every wrong answer is a value the
grid actually contains somewhere it could have gone. Where a column holds fewer than
two other distinct values the pool widens to the whole grid, and where it still cannot
reach two the grid is not questioned at all.

The rule that matters is inherited from the flattener: a step with no recovered column
name is used only when its row has exactly one value. Otherwise "for this row, what was
the value?" is ambiguous, and an ambiguous question graded as wrong is worse than no
question. Option order is seeded from the block and cell rather than shuffled randomly,
so the answer never sits in a predictable slot but the same question always presents
identically.

A wrong answer **replays the grid** from its first card, and the next question draws a
different cell — getting past a matrix requires having taken the whole thing in, not
having memorized one card. Two attempts is the cap: a grid that has beaten someone
twice will not yield on the third pass, and a check with no exit is a check that ends
the session. An exhausted grid is let through and stays in the review queue.

Measured over the corpus: **all 16 grids that clear the flattener's thresholds yield an
unambiguous question** (26 with four options, 6 with three), the answer is never
duplicated among its own distractors, and a replay never re-asks the same cell.

### Cloze spot checks

Every 250 words of reading, two or three terms from the stretch just heard are put back
into the sentences they came from with the term removed. About eight seconds, marked
locally, several times between intercepts.

Candidates are ranked by salience: a recognised acronym outranks everything, because it
is the vocabulary the material is written in; then numbers, because thresholds and
timeframes are the facts a reader most reliably believes they retained and most
reliably did not; then capitalized mid-sentence words, which are a weak signal and score
accordingly. Repetition inside the window adds to the score — a term used three times
in three hundred words is load-bearing.

Three exclusions carry the quality:

- **Grids and code never supply a blank.** A grid has its own check, and code is never
  spoken, so blanking either tests eyesight rather than recall.
- **Headings never supply a blank.** A heading is a label the reader heard announced,
  not a claim they reasoned through. This was measured rather than assumed: on the
  vendor-management PDF a recovered citation line was being offered as a blank —
  "Amatya S, Edgerton D. Vendor Selection and ___." — until the rule existed.
- **A term that survives elsewhere in its own carrier is dropped**, because the blank
  could then be read straight off the page.

Grading is exact-match after normalization, and **an acronym's full expansion is
accepted for the acronym**. A reader who writes "contract research organization" where
the page said "CRO" has demonstrated more than one who typed three letters — and the
app *speaks* the expansion, so marking it wrong would punish having listened.

Every blank must be filled before the check can be marked; guessing is required,
skipping is not offered. A miss does not rewind — that is reserved for grids — it goes
into the review queue instead.

Measured over the vendor-management PDF: 33 windows, **32 produced a check**, 95 blanks,
none drawn from a heading, none readable off its own carrier.

**Which terms get blanked adapts to what you keep losing.** The review queue already
knew — it is the whole content of `lapses` and `ease` — and spent that knowledge only on
*when* to ask again, so a term failed three times in review was no likelier to be
blanked on the next pass through a document than one that had never given any trouble.
Difficulty is now keyed by *term* rather than by document, so a word lost in the GCDMP
is preferred as a blank in ICH E6, and nine documents stop each learning the same lesson
separately.

The weight is sized against the salience scale rather than layered on top of it: a fully
stuck capitalized noun (3 + 6) just outranks a fresh acronym (10), and a stuck acronym
(16) outranks everything. Any larger and the checks would stop following the text and
start being a personalized drill, which is what the review queue already is. After
marking, a blank chosen this way says so — being told a term is one you keep losing is
the point of having preferred it.

### The presence check

Every other mechanism assumes a reader is there. None of them can tell the difference
between someone following the caret and an empty chair: the synthesizer reads to both
at the same rate, the highlight tracks for both, and the session record is identical.
[src/hooks/useVigilance.ts](src/hooks/useVigilance.ts) periodically stops assuming.

After 90–135 seconds of continuous playback a small pill appears in the corner asking
for one press of `V`. Miss it by 3.5 seconds and the audio stops. This is the driver's
safety device from a train, including the part that makes it work: the cue is
peripheral and the consequence is not. Losing your place in a dense guideline is a real
cost, which is exactly why it is the right one to attach to being absent.

Three details keep it from becoming noise:

- **The interval is jittered.** A fixed period is a rhythm, and a rhythm can be
  anticipated and answered from inside the daydream the check exists to catch.
- **The cue is peripheral by design.** The reader's eyes are on the caret, and a cue
  placed there would compete with the word being spoken — the one thing this app is
  built not to do.
- **Typing in the scratchpad answers it.** Someone mid-sentence in the pad is doing the
  more demanding thing and has already proved what the check establishes. The deadline
  is anchored to the last proof of presence rather than to a fixed schedule, so they are
  never interrupted to prove it again.

Pressing `V` with nothing pending does nothing at all: a check that could be answered in
advance could be held down, and would prove nothing.

## What a grid says out loud

Acronyms expand for the ear everywhere else, and that is deliberate — hearing
"electronic case report form" inside a sentence is what the whole speech-offset
machinery exists for. A grid card is the exception, and not for comfort.

A grid card shows **one cell, alone, in the largest type in the app**. With
expansion on, the eye read `CRF` and the ear heard "case report form". The
argument that settles it is the check that follows: `buildGridQuestion` draws
its answer from the raw cell value, so the reader studied one string and was
then asked to pick the other out of four options. Study channel and test channel
disagreed on **33 of the corpus’s 262 grid steps**.

Only the speech changes. The acronym tag stays — it feeds the corpus index, the
acronym drill and cloze weighting, and dropping it would quietly remove every
grid cell from all three. Evidence-grade stripping stays too: not reading
`[III]` aloud has nothing to do with acronyms.

`scan-checks` reports it in both directions, which matters more than the check
itself. Counting *any* difference between a chunk’s speech and its text made the
control useless — killing expansion everywhere still left 373 prose chunks
"expanded" from grade stripping, so the must-be-non-zero line stayed green
through exactly the change it exists to catch. Counting only expansions, the one
thing that makes an utterance longer, takes it to 0 under that break and 3,845
when correct.

## Every rung refuses the same unfair blank

"Section ____ states that…" asks where something is, not what it says. The mock
exam has refused those since it was written — and only the mock exam did. The
rule lived in `quiz.ts` and only `exam.ts` called it, so the spot check firing
every 250 words was free to ask "Section ____ Qualification and Training
highlights…" and want "3.4". It did, **72 times across 2,774 blanks**.

The skip goes inside `carrierFor`’s occurrence loop rather than around it,
because the same answer is often a reference in one sentence and a fact in the
next: "Section 15 of the guideline" is a lookup, "retained for 15 years" is the
thing worth remembering. It shows in the numbers — 72 offending blanks became 0
while the total fell only from 2,774 to 2,760, so 58 were replaced rather than
lost.

The measurement was the bigger finding. `scan-checks` walked `.md` only, and
this corpus has one markdown guide: **five windows**. Every must-be-zero line
about cloze quality was resting on five checks, and a new cross-reference count
reads 0 over that sample whether the rule exists or not. It walks the PDFs now —
1,080 windows, 958 checks — and "windows where a weak term displaced a blank"
went from 3 to 522 on the same change.

## Did you get the why

Clinical data management is examined on why a rule exists, not only on what it
requires. Measured against the live grader before changing anything: a bare
restatement of Part 11’s audit-trail requirement and an account of what audit
trails are *for* both came back `accurate`, with nothing to tell them apart.

So the grade carries a second, separate judgement:

| | |
|---|---|
| `captured` | the section gives a reason and the summary reached it |
| `missed` | it gives one and the summary stopped at the requirement |
| `not_stated` | the section gives none — and that is normal |

**The third level is what keeps it fair.** Much of the GCDMP is lists of minimum
standards with no reasoning attached, and a grader that demanded a rationale
from a list would mark a correct summary down for omitting something the section
never said. That is the same failure as an unfair cloze: the reader learns the
check is unreliable and stops believing it. Verified against the real grader — a
bare minimum-standards list returns `not_stated`, an empty reason, and an
unchanged verdict.

The reason itself is quoted in the section’s own terms and never supplied from
outside it, however well known it is.

What is **not** settled is how cleanly the two judgements stay apart. The same
borderline summary returned three `accurate` and three `partial` across six
runs, and the pre-change prompt returned `partial` for it too — so that verdict
is unstable either way, and the sample is too small to say whether the rationale
instruction moves it. The free-tier quota ran out before a matching baseline
could be taken. The guard in place is structural rather than instructional:
`propertyOrdering` emits `verdict` before `rationale`, so the verdict is
committed to first.

## Spaced retrieval

Sessions used to end and take everything with them. A summary written at an intercept
and a term missed at a spot check were both written to IndexedDB and never surfaced
again, which meant a reader could work through a guideline exactly as intended and have
nothing left of it a fortnight later.

Those same artefacts now become review items on a widening interval
([src/lib/review.ts](src/lib/review.ts)). When anything is due, the loader offers a
warm-up **before** any document opens: retrieval debt comes before new material, because
reading a tenth guideline while the first nine evaporate is motion rather than progress.

The scheduler is plain SM-2 with a four-point grade. It needs no tuning and produces
intervals a reader can predict, which matters — a retention system that behaves
unpredictably is one that gets abandoned. A failed item returns in ten minutes rather
than tomorrow, because the point of failing is to see it again while the miss is still
felt. Ease is floored at 1.3 so a repeatedly-failed item cannot become a daily leech,
and intervals cap at six months — or at half the time remaining, once an exam date is
set. See *The exam date* below.

| Kind | Prompt | Marked by |
| --- | --- | --- |
| `cloze` | The carrier sentence, blanked | Exact match, expansions accepted |
| `grid` | The cell question and its options | The grid |
| `summary` | The section title alone | You |

A summary is the one thing the app cannot mark, because the answer key is the reader's
own sentence. It is asked from memory first, then that sentence is shown back and
self-rated — the honest version of the same loop.

Item ids are derived from content rather than generated, so missing the same term in two
different sittings advances one item's schedule instead of stacking two copies of the
same question in the queue. Forgetting a document deletes its questions with it: a
question whose source text is gone can never be checked again.

## Mock exam

Every check described above is an interruption, fired while reading, whose purpose is to
stop a reader coasting through one document. An exam is the opposite arrangement, and it
is the one that answers the question a candidate actually has: a timed set drawn across
the whole corpus at once, no feedback until the end, scored with a breakdown by document
and by question type ([src/lib/exam.ts](src/lib/exam.ts)).

Nothing new had to be invented to ask the questions. `buildGridQuestion` and `buildCloze`
already produce questions with exactly one right answer and mark them locally, and the
acronym dictionary is a definition list — which is precisely what a certification tests.
Three kinds, for three different things: **acronym definitions** (the vocabulary the
material is written in), **terms in context** (whether a claim was understood rather than
recognised), and **table cells** (whether a matrix was taken in as a structure).

Documents are loaded one at a time and released once their questions are collected —
holding nine parsed guidelines at once is hundreds of thousands of tokens for data that
is immediately discarded. Questions are drawn from a seed rather than at random, so a
score belongs to an identifiable paper rather than to an unrepeatable draw. Answers feed
the same retrieval queue everything else does, right or wrong: an exam is another way
into the study loop, not a detour from it.

Two things came out of measuring real papers rather than reasoning about them.

The **mix** is now chosen by which kind is furthest below an explicit target share
(45% terms, 35% acronyms, 20% tables) rather than by rotation. The first measured paper
came out 23 acronym, 15 cloze, 2 grid — not a weighting decision but an accident, because
a grid slot in a document with no tables fell through to the next kind in list order,
which is always acronym. Every missing table had been quietly becoming another acronym
question. The same corpus now yields 18/15/7 across all nine documents.

**Blanks that ask for a cross-reference are dropped.** A real paper asked for section 4.5
and section 4.2 of the same guidance — questions about where a rule lives rather than what
it says. A number is otherwise one of the best things to blank, so the rule keys on what
introduces it: "an average of ____ days" survives, "Section ____ states" does not.

```bash
node scripts/scan-exam.mjs "path/to/pdfs" --verbose
```

The report asserts the ways a paper can be quietly unfair — an answer missing from its own
options cannot be answered at all, and a duplicate asks one fact twice while a document
goes unexamined — and scores a perfect paper and a blank one to prove the marker moves.

## Exam history

The paper is the closest thing in this app to the actual objective, and the only artefact
that scores the whole corpus at once. Its result lived in one React state variable and was
destroyed by closing the dialog.

That is the same defect the coverage map was built to fix one rung down — evidence
produced, shown for a moment, discarded — and a worse version of it. The marked screen
already answers "how did that paper go". It cannot answer "is this getting better",
because no single paper can: that question needs a series, and there was none
([src/lib/history.ts](src/lib/history.ts)).

So a sitting becomes a record — score, time, both breakdowns, and the misses.

**Only the misses are kept.** A record exists to say what to do next, and a question
answered correctly has no next action; the counts a right answer contributes to are
already in `byKind` and `byDocument`. Keeping all forty questions would triple the record
for material the parser can regenerate from the documents at any time. The cost is real
and worth stating: the app can never later ask which terms you have *always* got right.

**Misses are keyed by term, not by question.** The same rule the retrieval queue uses:
"SUSAR" missed in the GCDMP and "SUSAR" missed in ICH E6 are two questions and one
problem. Everything below depends on that.

**The one report only a history can produce** is the terms missed on more than one paper.
The retrieval queue already reschedules a missed item — and then forgives it the moment it
comes back right, which is correct for scheduling and useless as evidence. A term missed
on three papers weeks apart has *survived being learned*, and nothing else here can see
that. Counted by paper rather than by occurrence, so a term blanked twice in one sitting
is one problem, not two.

Two things came out of running it rather than reading it.

The repeat-miss list named one term two different ways. A cloze cut around an acronym has
the acronym as its answer; a definition question about the same term has the expansion.
Both key to the same term, so the row was named after whichever kind was missed last —
"CDISC" on one paper and "Clinical Data Interchange Standards Consortium" on the next. The
miss now carries the acronym separately, the row is named after it, and the expansion sits
beside it where a definition question has supplied one.

And two assertions could not go red. The ordering test passed with the sort deleted,
because insertion order already matched what it expected; it now meets the worst term
last. The guard that stops an acronym being printed as its own expansion was only
exercised by a term that had no acronym at all.

**The trend is reported three ways because one of them lies.** A single paper carries real
sampling noise — a 20-question set moves 5 percentage points per question — and two papers
of different lengths are not directly comparable. So the change since the last paper is
shown, because a reader will look for it, next to the mean of the last three, which is the
figure that moves for a reason. The chart's 70% line is a reference to read the shape
against; this app does not know the real pass mark and does not claim one.

## The exam date

SM-2 grows an interval for as long as an item keeps coming back right, capped at six
months because past that it stops being study. That is the right shape for open-ended
retention and the wrong one for a dated exam. An item scheduled for after the date is
worth exactly nothing — and it is the items going *best* that earn the long intervals
falling off the far end. A reader six weeks out, doing everything the app asked, would sit
the paper having not seen their strongest hundred terms since the month before.

So the interval gets a horizon ([src/lib/deadline.ts](src/lib/deadline.ts)).

**Never schedule beyond half the time remaining.** Not "before the exam", which is the
obvious rule and the wrong one: an item landing the day before gets one look and no room
to recover if it fails, and near the date every item collapses onto the same day. Halving
is self-correcting — from 60 days out a term lands at 30, then 15, 7, 3, 1 — so it gets
roughly log2(days) further looks, spread out, each with time behind it to re-learn from a
miss.

**It only ever shortens.** No date, or a date that has passed, is byte-for-byte the
original scheduler; ease, reps and lapses are untouched, so a horizon that comes and goes
leaves no mark on what the queue has learned; and a failed item still returns in ten
minutes, which is sooner than any horizon and is not the horizon's business.

**It is read inside `db.recordAnswer`, not passed by each caller.** There are eight call
sites — every dialog, the drill, the exam, the reading engine — and a scheduling rule that
has to be remembered at each of them is a rule that will be missing from the ninth.

The date is kept in `localStorage` beside the voice and the words-per-minute target,
because like those it is a property of the reader rather than of any document. Unlike
those it is worth saying out loud that **a backup does not carry it**: a backup is an
IndexedDB export, and widening the format to reach in for one string is not a trade worth
making when re-entering a date takes ten seconds.

**Checked over a run-up, not over a call.** The promise is about a reader answering items
over weeks, so `deadline.test.ts` simulates a thousand seeded sequences from 1 to 120 days
out at random qualities and asserts no interval ever lands after the date. A per-call test
would pass on a rule that quietly lets an item drift past the date after five good
answers. A second test pins the reason for *half* — that a settled item comes back five or
more times rather than once — and both are needed: setting the share to 1.0 leaves the
first test green and turns only the second red.

Measured through the running app in both directions, on one item that had earned a 60-day
interval. With the exam four days out it came back **in 2 days**, matching the horizon on
the home screen. With the date cleared, the same item answered the same way came back **in
5 months**.

**The home screen reports four numbers and draws no conclusion from them**: days left, the
last three papers, what the queue owes, and the cap now in force. The app does not know
the pass mark, what a paper it wrote itself predicts, or how much of the corpus this
reader needs — so "on track" from those four numbers would be invented. What it does state
is the one thing the date actually guarantees: nothing in the queue is scheduled to come
round after the exam.

## The coverage map

Every progress indicator here reports the caret, and the caret is a claim about the
audio rather than about the reader. It advances at the same rate whether somebody is
following or the tab is minimised — which is the entire reason the enforcement ladder
exists, and it means "43% read" is the one number the ladder was built not to trust.

The ladder was already producing the answer to the harder question and throwing most
of it away. An intercept left a summary behind and a grid left a pass, but the cheap
rung — the one that fires most often and covers the most ground — was marked, shown
for eight seconds and discarded. So the app could say how far the caret had reached
and could not say which of it anyone had been made to account for.

Spot-check results are now kept, keyed by the token their window ended at, so
re-reading a stretch replaces its evidence rather than banking a second opinion about
the same words. From those three rungs the structure map reports four states per
section, and the useful one is the third:

| | |
|---|---|
| **verified** | Every rung that applies has been answered. |
| **partly** | One rung answered, another still owed. |
| **read but unchecked** | The caret went through it and nothing was ever asked. |
| **unread** | Not reached yet. |

**Four states rather than a percentage, on purpose.** Blending the rungs into one
score would invent a weighting nobody measured, and it would hide the distinction the
reader acts on: a section owing a summary and a section whose table was never answered
need different amounts of time, and a single number says neither.

**The bar is segmented by words, not by sections.** Sections in this corpus run from
forty words to nearly four thousand. "12 of 47 sections" lets a document be
four-fifths verified by section count and a third verified by anything that will be
examined.

**A rung is only owed if the ladder will actually raise it.** This is the constraint
the whole thing lives or dies by — a debt the reader cannot discharge never clears,
keeps the number off the top, and after a week of that nobody reads the panel. Three
of them were in the first version:

- The summary belongs to the section being *left*. `finishChunk` raises the intercept
  on crossing *into* a section that arms one and asks about the one just finished, so
  keying it off `section.intercept` permanently billed the last section of every
  document, plus every section followed by one that arms nothing.
- A grid with no answerable cell is never armed at all — a check that cannot be
  answered is a dialog with no exit — so it cannot be owed either.
- A grid already failed twice is never offered again. The app has given up on it; the
  map must stop billing for it.

**Answering a check and answering it correctly are different claims.** Getting through
a spot check is what proves the reader was there, so it counts toward coverage however
it was marked. Recall is reported alongside it, per section and per document, and goes
red below half. Folding the two together would let a section the reader has been held
to three times read as never checked.

Below the counts sits the one action the panel exists for: **the next section worth
your time**. Read-but-unchecked first, then partly done, then unread — cheapest
evidence first, since a section already read needs one check and a section not yet
read needs reading — and within a band the longest, where the most unaccounted-for
material is.

```bash
node scripts/scan-coverage.mjs "path/to/pdfs"
```

That report asks the question the unit tests cannot: can a real document ever reach
100%? It drives a perfect reader over each one and asserts nothing is left owing, and
scores the same documents with an empty session as a control — a model that called
everything verified would pass the first test on its own. On the nine documents:
1,102 sections, zero still owing after a perfect reading, zero verified after doing
nothing at all.

## Reading speed

The control used to be the `rate` a `SpeechSynthesisUtterance` takes, and it claimed a
number no voice has ever produced. Measured across every voice in `/voice-check`: 2.0x
delivers about 1.4x on the local voices and about 1.9x on the network ones, and the
control offered up to 3.0x. Two readers sitting at "2.0x" on two different voices are
reading at speeds a third apart, and neither is reading twice as fast as anything.

`rate` is not a lie the app can fix — the platform owns what it means. What it can stop
doing is *reporting* it as the speed. So the control asks for words per minute, and the
rate is solved for: "what rate gets this voice to 260 wpm?" is a question about that
voice, answered from what that voice has already been observed to do.

**Learned per voice, not modelled.** Words spoken and time elapsed are accumulated per
voice per rate as you read, and kept in `localStorage` beside the remembered voice —
rate is honoured differently by local and network synthesis, so a local voice's timings
say nothing about a networked one's. Two real observations beat any curve fitted here
over engines this app cannot see.

**A straight line, and the intercept is the point.** `wpm = intercept + slope × rate`,
because the measured relationship saturates: a voice at 2.0 is not twice the voice at
1.0, and a line with a positive intercept and a shallow slope is what saturation looks
like across the range a reader uses. Fitting a curve to two or three points would be
inventing precision that is not in the data.

**Solved, never servoed.** `rate` is a dependency of the speech engine's effect, so a
controller that corrected itself as it read would cancel and restart the utterance at
intervals nobody asked for — the caret jumping back to the start of a sentence for no
visible reason. The rate is re-solved only when the reader moves something: the target,
or the voice.

**It says when it cannot reach a target.** Past what the current voice has been
measured to do, the asked-for number is struck through and what will actually be read
is shown beside it. The header reports the measured pace separately, so the target and
the delivery are always both visible and are allowed to disagree.

**Uncalibrated, it is exactly the old behaviour**: `target / 185`, which is the
multiplier the control used to be, marked "est." so nobody mistakes it for a
measurement. Nobody's reading speed changes on upgrade.

Measured end to end in the running app: at the default 260 wpm target, Microsoft David
delivered 140 wpm — the old control overstated it by 46%. After one 26-second run the
app had learned it, asked 2.6x for the same target, and reported David's real range as
100–300 wpm.

## The acronym drill

The vocabulary the material is written in, and the cheapest thing to be caught out by.
The mock exam already asked acronym definitions, marked them and filed them in the
retrieval queue under an id keyed by the term rather than the document — but a handful
at a time, mixed into a forty-question paper with a clock on it. There was no way to
sit down and go through the vocabulary, which is the one part of this corpus that
rewards exactly that.

Three differences from the exam, and they are the whole design:

- **Marked as you go.** An exam withholds feedback because it is predicting a result.
  A drill exists to close the loop, and a wrong answer is worth nothing until the right
  one lands beside it.
- **No clock.** Recall under time pressure is what the exam measures. This measures
  whether the association is there at all.
- **Worst first.** The same `weakTerms` map the reading spot checks consult orders the
  set, so it opens on the terms that are not sticking rather than on the eight already
  known. Inside a weakness band the order is seeded, so a drill can be sat twice and be
  the same drill.

**The exam's per-document cap does not apply.** `PER_DOC_PER_KIND` exists so a paper is
not dominated by whichever document happens to be longest; a drill has the opposite
requirement, because a term left out of it is the term you meet on the day. Measured
from the token stream rather than from the question pools — a count taken from the same
capped source would be a check that cannot fail — the corpus uses 50 acronyms and the
capped drill was offering 30.

## The T-SQL stepper

Code blocks are never spoken here, and that is right for almost every code block:
read aloud, source is noise. SQL is the exception — not because it sounds better, but
because **the order a query is written in is not the order it is evaluated in**, and that
one fact is what makes SQL click or not.

`SELECT` is written first and happens sixth. `WHERE` runs before the columns it appears to
filter on exist. Reading a query top to bottom teaches the wrong model, and every reader
who has been confused about why a `SELECT` alias works in `ORDER BY` and not in `WHERE`
has been taught it that way.

So a statement is not read out. It is **stepped**: cut at its clauses, put into the order
the engine actually evaluates them, and played one clause per utterance — which makes the
gap between two clauses a real sentence boundary rather than a pause the engine has to
fake ([src/lib/sql.ts](src/lib/sql.ts)).

| Written | Evaluated |
| --- | --- |
| `SELECT p.PATIENT_ID` | 1. `FROM patients p` — the row source |
| `FROM patients p` | 2. `JOIN RankedLabs a ON …` — rows matched in |
| `JOIN RankedLabs a ON …` | 3. `WHERE p.DEATHDATE IS NULL` — filters rows, before any grouping |
| `WHERE p.DEATHDATE IS NULL` | 4. `SELECT p.PATIENT_ID` — what comes out, after the filters |
| `ORDER BY p.PATIENT_ID` | 5. `ORDER BY p.PATIENT_ID` — presentation order, last of all |

**The display is never reordered.** The query stays exactly as written and the caret is
what moves, walking down the text and then jumping back to the top for the `SELECT`. The
jumping is the lesson; reordering the screen to match the audio would hide the very thing
the reader is here to notice. Every clause is also clickable, which is the only way to
replay one without scrubbing through the query.

This is the same shape as the matrix flattener — one chunk per step, steps carried on the
block, the reader rendering from them. Nothing in the token or offset machinery has to
know SQL exists.

### Not being fooled

Finding clause boundaries is a lexical problem wearing a semantic hat, and every way of
getting it wrong produces a *plausible* split rather than a crash. The query still
renders, the steps still play, and the reader is quietly taught an evaluation order that
is a fiction.

- **Depth 0 only.** `EXISTS (SELECT 1 FROM conditions c WHERE …)` holds three clause
  keywords and is *one predicate* of the outer `WHERE`. Cutting on them would present a
  subquery's internals as steps of the statement containing it.
- **Strings, bracketed identifiers and comments are inert.** A `LIKE` pattern containing
  "select from" is not a clause boundary, `[Order By Date]` is a column name, and a
  semicolon inside a comment does not end a statement. Block comments nest, because T-SQL
  lets them.
- **`ON` belongs to its `JOIN`.** A join and its condition are one thought; "on
  a.PATIENT_ID = p.PATIENT_ID" as its own step gives no way to know which join it was.
- **A `WITH` is replaced by its CTEs' own clauses**, each CTE built whole before the next.
  `RankedLabs` is a five-clause query in its own right and it is the one that most needs
  stepping, because the `WHERE` inside it deliberately does *not* carry the threshold.
  Ordering the steps by clause rank alone interleaved the two CTEs — both `FROM`s, then
  both `WHERE`s — which presents two independent queries as one.

### Saying it out loud

`p.PATIENT_ID` is read as "p dot patient underscore i d" by every voice measured. Without a
transform this feature is a false promise: a step nobody can listen to is a step that is
only being looked at. So underscores become spaces, a dot between identifiers becomes a
space, operators are named, and parentheses become a space rather than nothing — deleting
them welded `TRY_CAST(RESULT_VALUE` into "try castresult value". Comment markers are shown
and never spoken, the same rule as evidence grades in prose.

The honest limit: a string literal containing spaces is already several tokens by the time
this sees it, so `'%type 2 diabetes%'` is voiced as three fragments. Structure is what the
stepper is for and structure survives; literals read roughly.

### A .sql file is not a document with code in it

It is mostly *prose*, in block comments — the problem statement, why the technique matters,
the trap — with the SQL as punctuation between. Wrapping the whole file in one fence would
silence 80% of it; feeding it in raw would read the delimiters and operators aloud as if
they were sentences.

The two are separated on the one signal that is reliable in these files: **a block comment
starting its own line is prose, everything else is SQL**. A comment whose first line is a
rule of `=` or `-` takes its next line as a heading, which is how the files are already
written — and headings are what arm the intercepts, so this is the difference between a
drill set that can be enforced and one that is only read.

Line comments stay inside the query. `-- NOTE: no 7.5 threshold here` explains why a
filter is *absent* from the clause it sits in, and moving it out destroys the only reason
it was written.

```bash
node scripts/scan-sql.mjs "path/to/SQL Practice - Trial Screening" --verbose
```

Every assertion in that report is a conservation law, because nothing downstream can tell
a wrong split from a right one: no SQL left out of every step, no step overlapping
another, no statement handed a `SELECT` belonging to its own subquery, no step spoken as
silence, no utterance over the length cap, no gap in the step-to-chunk map. On the
reader's own scripts: 3 files, 5 statements, 29 steps, zero on all seven.

Two things came out of running it rather than reading it.

That scan found a **1,241-character step** — the feasibility screen's main `WHERE` with
its two `EXISTS` predicates. One correct clause, and seven times the utterance cap that
exists to dodge the synthesizer's long-utterance truncation. A long clause is now several
chunks that are all still *one step*; cutting the clause instead would mean step
boundaries stopped meaning what this feature claims they mean.

And a screenshot showed every `JOIN` running past the pane edge, reachable only by dragging
a scrollbar sideways while the audio moved. The block wraps with a hanging indent now, and
the probe asserts directly that nothing is clipped — the same lesson the lane graph taught,
on a second component: nothing in the DOM says a human cannot see this.

## Blueprint coverage

Every account in this app is a closed system. The coverage map answers "how much
of this document have I been held to"; the corpus index answers "where else does
this term appear". Both can only report on material that is already in the
library — so the one question neither can reach is the one that decides the exam:
**what is on the blueprint that I do not have?**

That gap is invisible from inside and no amount of reading closes it. It closes
by comparing the library against an external list, which is what
[src/lib/blueprint.ts](src/lib/blueprint.ts) is: the SCDM CCDA study guide’s six
domains, their tasks, the GCDMP chapters each draws on, and the sixteen chapters
the guide gives minimum standards for.

**Transcribed, not parsed.** The obvious move is to feed the guide through
`pdf.ts` like everything else, and it is the wrong one. Its domain tables are
rotated — the task column runs diagonally across the page — and extraction
interleaves chapter names with fragments of task text and page furniture. A
heuristic over that produces a *plausible* blueprint, and a domain missing two
chapters reads exactly like a domain that only had four. Sixty lines of data
that changes when SCDM republishes, which is roughly never, beats a parser that
can be quietly wrong about the thing the whole panel is for.

### Why an alias table and not a similarity score

The handbook contains the counterexample. Its chapter list holds both

```
Assuring Data Quality      revised Oct 2013, 20 pages
Measuring Data Quality     revised Sep 2008, 12 pages
```

— different chapters about different things, one word apart, and only the second
is on the blueprint. Every edit-distance or trigram metric scores that pair as a
near-certain match, and the failure is silent in *both* directions at once: the
reader is told they covered `Measuring Data Quality` when they read `Assuring
Data Quality`, and the real chapter never shows as missing.

So a title matches a chapter exactly after normalization, or through an explicit
alias, or not at all. Three tables carry the judgements, and a title may appear
in only one of them:

| | |
|---|---|
| `ALIASES` | this title *is* that chapter |
| `RESEMBLES` | related and never counted — a later edition that re-split it |
| `EXCLUDED` | examined and ruled out, with the reason |

Fuzzy matching is used in exactly one place, and never to decide: `scan-blueprint`
flags any corpus title within an edit or two that did **not** match, so a missing
alias is adjudicated rather than absorbed. It found one on its first run —
`m) Data Privacy`, a lettered run-in sub-heading inside the DCI chapter, two
hundred words about privacy in CRF design. Matching it to the twenty-page `Data
Privacy` chapter would have reported a chapter as covered on the strength of a
paragraph.

### What it says on this library

Three chapters the exam names are not here. Two are metrics chapters that do not
exist in the 2013 GCDMP edition; the third is the 2021 vendor chapter, and it
carries minimum standards — which is where "which of the following is a minimum
standard" questions come from.

The panel puts that first and paints it differently from an unread chapter, on
purpose. Confusing "you have not read this" with "you do not have this" wastes
exactly the weeks a reader has least of.

```bash
node scripts/scan-blueprint.mjs "path/to/CCDA Study" --verbose
```

## Regulations cited

The corpus index is keyed by *term*, and a citation is not a term. `21 CFR Part
11 section 11.10` is a **provision** — and [src/lib/quiz.ts](src/lib/quiz.ts)
deliberately throws provisions away (`isStructuralReference`), because "Section
____" is a lookup rather than a fact. So the thing these documents argue about
most was the one thing nothing in the app could show.

The request that led here was an inline drawer: click a cross-reference, read it
beside the prose. Counting the corpus first said no. Of ~356 cross-references
across 255,000 words, the great majority name a regulation — 21 CFR Part 11,
Part 312, Part 56, ICH E6 — and of those only E6 is in the library, so a drawer
would have nothing to open on most clicks. The local ones are worse: every GCDMP
chapter has its own `Table 1`, so a resolver would jump confidently to the wrong
table most of the time. And a drawer is something you look at, while the audio
keeps moving.

What the count *did* reveal is worth having. **Part 11 is discussed by nine of
the eleven documents.** Four chapters describing one rule from four angles is
exactly what is hard to assemble by reading them one at a time, and it is what
the exam asks about.

### Refusing rather than guessing

Same rule as the blueprint matcher, for the same reason — an invented citation
looks exactly like a real one, in the one panel whose entire job is to say where
a rule is discussed.

- **A regulation must be named.** A bare `section 5.0` is ambiguous between ICH
  E6’s quality management section and the fifth section of the document being
  read, and nothing in the sentence settles it. The provision is only ever read
  from the text *following* a named regulation.
- **A bare `Part N` is read only for parts on a list.** `\bPart \d+\b` matches
  "part 1, subpart J of this chapter" forty times inside Part 11’s own scope
  list, and "Part 3 of the data management plan" everywhere else.
- **URLs are inert.** The GCDMP bibliography links a page whose filename is
  `45cfr164`. A real reference to the HIPAA Security Rule, and not one anybody
  can act on — admit it and every link in the corpus becomes a candidate.
- **A number following a regulation is not automatically a provision.** `Part 11
  section 11.10` is; `Part 11 1998 amendments` is a date.

Ranking is by how many *documents* cite a rule, not how often. A rule quoted
forty times inside its own text says less than one four chapters disagree about.

```bash
node scripts/scan-citations.mjs "path/to/CCDA Study" --verbose
```

The asserted numbers are all precision. Recall is reported and the gap is meant
to be wide: 287 of the corpus’s bare section references are left uncovered,
because reading them as citations would fill the index with references nobody
made.

## Parking an intrusive thought

Reading dense guidance surfaces thoughts that have nothing to do with it — an
errand, a work thing, a question about something three chapters back. Ignoring
one means ruminating on it; switching windows to write it down ends the session.

The scratchpad was already most of the answer: capture is one keystroke, and
typing in it counts as a presence check, so writing something down never
triggers the vigilance pill. What it had no answer for was a thought that is not
*about the text*. Enter commits it untagged, which puts it in the flow graph’s
note lane — so the tangent lands in the middle of the argument being built. And
the intercept shows the section’s captures beside the summary box, which means a
stray thought about the car insurance was on screen at the single most demanding
moment in the app.

So `/p`, alongside `/e` `/m` `/o`. A parked node is stored with the rest — it
survives a reload and keeps the token it was dropped at, so the reader can get
back to where they were — and it is absent from every surface where the reader
is thinking about the document: the list, the graph, the counts, the chain, the
captures. It never attaches to the open chain and never becomes the next head,
because splicing "renew the car insurance" into entity → mechanism → output is
the exact thing this prevents.

A count in the pad’s header opens a drawer with the parked thoughts, each a link
back to where it interrupted — and the drawer opens itself once when the
document runs out, which is the only moment the app already has that can offer
them back without being asked. Deliberately nothing else: no tag, no chain, no
place in the graph. A parked thought that grew features would start competing
for the attention it exists to protect.

## How far the next stop is

The structure map now carries one line: `≈250w to a spot check · ≈1,400w to a
summary`.

The request was a countdown — "1m 20s until next summary" — and a ticking clock
is the wrong shape for it. A number that moves on its own in the field of view
is a thing to watch instead of the text, which is the one behaviour this app is
built to avoid; the presence pill sits in a corner for exactly that reason.
Distance in words is the same information with none of the pull: it is in a
panel the reader opens on purpose, and it does not tick.

**Both rungs are reported.** Naming only the summary would be true and
misleading — the cadence check comes round every 250 tokens, so a reader told
"1,400 words to the next summary" will in fact be stopped four or five times
before then, and would rightly stop believing the number.

Neither figure is a promise, and the tooltip says so. A stretch with nothing
worth asking about slides the window on instead of stopping, and nothing can
know that in advance. The summary figure walks forward for a boundary that would
*actually* arm an intercept — not into furniture the engine steps over, and not
out of a section whose summary is already written — because both of those would
send the reader hunting for a stop that never comes.

Seeking resets the spot-check figure to the full interval, which is correct:
jumping over text is not reading it.

## Dictating a summary

The intercept is the ladder’s most expensive rung and the only one that asks for
manual output from someone twenty minutes into a purely auditory task. Speaking
it is the obvious win, and the obvious win has a trap in it that nothing else
here would catch.

**A recognizer does not know this vocabulary.** Said aloud, `CDISC` comes back as
"see disk", `eCRF` as "e see are eff", `SDTM` as "ess dee tee em". The reader
gives a correct summary, the grader is handed a garbled one and returns
`off_track` — a false failure on the rung that costs the most to redo, which
teaches the reader the grader is unreliable, and after that the whole
enforcement ladder is theatre.

So the transcript is reconciled against the vocabulary the section actually
contains before anyone sees it ([src/lib/dictation.ts](src/lib/dictation.ts)).

Three rules keep the corrector from being worse than the recognizer it repairs —
because a mangled word is visible and a substituted one is not:

- **Scoped to the section.** Nothing outside the acronyms *this section
  contains* is ever substituted in. The tokens already carry them, so it is a
  lookup rather than a guess. "See disk" becomes `CDISC` in a chapter about data
  standards and stays "see disk" everywhere else.
- **Derived, not guessed.** Forms are generated from the acronym: as written,
  and spelled out through a fixed table of letter names. `SPOKEN_AS` holds the
  handful said as words rather than spelled — a list, because the alternative is
  a pronunciation model and a wrong one substitutes words nobody said.
- **Declared.** Every substitution is shown, struck through, over the text that
  produced it, and the box stays editable.

Two defects came out of running it. Collapsing adjacent duplicate consonants
made "uses see disk" and "see disk" the same skeleton, so the longest-window
match rewrote three words as `CDISC` and ate the verb. And dropping every vowel
made `eCRF` and `CRF` indistinguishable, so the longer one — registered first —
took both; the leading vowel is kept now, which is what a phonetic key normally
does anyway.

The honest limits: it is Chrome-only, Chrome sends the audio to Google, and
three-letter acronyms with few consonants (`EDC`, `SAE`) reduce to skeletons too
short to key on safely — they are repaired only when the recognizer already
returned something close to the written form. The button is absent where no
recognizer exists rather than present and inert.

## The corpus index

Nine guidelines on one subject were nine separate reading sessions with no thread
between them. The corpus is not nine subjects — it is one subject written down nine
times, and the thing worth knowing about a term is that ICH E6 defines it, a GCDMP
chapter operationalizes it and the exam guide lists it. That relationship was in the
material and the app was throwing it away.

The loader opens onto every named thing the parser found, with the documents that use
it and a way into each one at the place it first appears
([src/lib/entities.ts](src/lib/entities.ts)). Terms the retrieval queue says are not
sticking are marked, because "this is in four documents and you keep losing it" is a
different instruction from "this is in four documents".

Two kinds of entity, for two different reasons. **Acronyms** come from the dictionary
already badged in the reader and are kept however rarely they appear, since they are the
vocabulary a certification examines. **Capitalized noun phrases** — "Data Management
Plan", "Quality Tolerance Limit" — are kept because a capital letter inside a sentence
is the strongest signal a PDF gives that a phrase is a named thing rather than prose.
Nothing here decides that two differently worded phrases mean the same thing; the index
reports what the documents say.

Two rules came out of running it over the real nine rather than out of a hunch. The
first pass led with "Department", "Health" and "Human Services" — one agency cut into
three by the lowercase words holding its name together — so a connector is absorbed into
a name when a capitalized word follows it. It also led with "Data", "Management" and
"Standards", common nouns that had picked up a capital from a heading, so a single-word
name must be capitalized at least as often as the document writes it plainly. Together
those took 897 entities down to 613, and the shared head became CRF, ICH, EDC, SOP,
GCDMP, "Electronic Data Capture" and "Department of Health and Human Services".

```bash
node scripts/scan-entities.mjs "path/to/pdfs" --verbose
```

Over the nine-document corpus: **613 distinct entities, 142 in two or more documents, 67
in three or more.** The report drives the same `assemble` the app uses, and asserts what
would otherwise fail silently — an entry pointing outside its own document is a dead
link, and in an index this size a dead link is invisible.

## Measuring the checks

Both check builders run over the real corpus offline, through the same modules the app
imports, so the report and the app cannot drift:

```bash
node scripts/scan-checks.mjs "path/to/pdfs" --verbose
```

Grids are read straight from PDF glyphs through `tables.ts`; prose is read from any
markdown in the folder through `parse.ts` and walked in the same fixed windows the
reading engine uses. The report asserts the invariants that would otherwise fail
silently — an answer duplicated among its own distractors, a replay re-asking one cell,
a blank readable off its own carrier.

## Summary checking (optional)

The intercept is worth more if something pushes back on the summary. Set one key in
`.env.local` (see `.env.example`) and a **Check my recall** button appears in the
intercept:

```bash
GEMINI_API_KEY=...        # or ANTHROPIC_API_KEY=...
```

Gemini wins if both are set. The route ([src/app/api/check-summary/route.ts](src/app/api/check-summary/route.ts))
imports the provider module lazily, so an unconfigured SDK is never loaded, and the
UI hides the button entirely when no key is present — the feature is additive, never
required.

Grading judges *recall against the section text only* — never writing quality, never
outside knowledge — and returns a verdict (`accurate` / `partial` / `off_track`),
one or two sentences of feedback, the load-bearing points you missed, and any claim
the section does not support. The grader is told the text came from a PDF and may
contain extraction artefacts, so you are judged on substance rather than transcription
noise.

Two deliberate constraints: the button is disabled until a summary exists, so the
check can never become the thing that produces your summary; and it never gates
resuming. Editing the summary clears the previous verdict.

## Rendering large documents

Above 3,000 words the reader marks blocks `content-visibility: auto`, letting the
browser skip layout and paint for off-screen ones. Every block stays in the DOM —
an earlier attempt used a sliding window with spacers, which meant scrolling ahead of
the playback position landed in a blank region. `contain-intrinsic-size` keeps the
scrollbar plausible before a block has ever rendered. Section rows and the WPM
readout are memoized and quantized so a spoken word re-renders one row, not a
hundred.

## State

One Zustand store ([src/store/useFocusStore.ts](src/store/useFocusStore.ts)). The one
non-obvious piece is `seekNonce`: the engine restarts its utterance when it changes,
so *deliberate* position changes bump it while the engine's own per-word
`advanceToken` does not — otherwise every spoken word would restart the audio.

WPM is measured, not assumed. Boundary events feed a rolling word/time sample (gaps
over 1.5 s are discarded as stalls) that drives the sidebar's per-section time
estimates once ~25 words have been read.

## Features

**Dual-channel pacing** — a words-per-minute target rather than a rate multiplier
(see *Reading speed* below), with Standard, Bionic (bolded leading fragment, ~45% of
each word's letters) and RSVP (single word at a fixed optimal-recognition point)
views. Click any word to seek there.

**Kinetic scratchpad** — type an idea and end it with `/e`, `/m` or `/o` to commit it
instantly as an Entity / Mechanism / Output node. No Enter, no mouse; the audio never
has to stop. `Enter` alone commits an untagged note, and `/p` parks a thought that has
nothing to do with the text — stored, retrievable, and kept out of the map entirely (see
*Parking an intrusive thought*). Nodes remember the section and word they were captured
at, and clicking their section label seeks back there.

**The captures are a graph.** Tagging said what *kind* of thing each note was and
nothing about how they connect, so "the sponsor delegates data review to the CRO, which
produces a delegation log" came out as three unrelated cards. Open a chain on a node and
every capture attaches to it and then becomes the chain itself — entity to mechanism to
output is three ordinary captures and no extra keystrokes. Anything realized later is
drawn directly: with a chain open, every node that can legally receive an edge offers
to. The Graph view lays the nodes out in `/e` `/m` `/o` lanes with the edges between
them, which is what makes an entity with no mechanism, or a mechanism producing nothing,
visible at all. Edges are kept acyclic — a cycle is not a subtler claim than a chain,
it is an unreadable one.

**Cognitive intercepts** — at every `#` / `##` boundary, playback hard-stops and a
non-dismissible full-screen dialog demands a one-sentence summary (minimum four words)
of the section just finished. Escape, outside-click and the close button are all
disabled; the only ways out are submitting or ending the session. Your own captures
for that section are hidden behind a toggle so recall comes first.

**Pre-scan structure map** — generated at load from the header hierarchy, with live
per-section time estimates, progress, and what each section has actually been asked
about (see *The coverage map* below). Pacing checkpoints are folded back into the
heading they were cut from: a 3,738-word section shows once, as "6 checkpoints",
rather than as six consecutive rows carrying the same title — which was itself a
reason a long document read as repetitive.

**Coverage** — the structure map reports what each section has been *asked about*, not
just how far the caret got, and points at the next section worth your time. See above.

**Acronym drill** — every acronym your documents use, marked as you go, hardest first,
no clock. See above.

**Exam history** — every mock paper is kept, so the app can say how the scores are
moving and which terms have survived being learned. See above.

**An exam date** — set one on the home screen and no review item is ever scheduled to
come round after it. Intervals cap at half the time remaining. See above.

**T-SQL stepper** — a `.sql` script loads as its commentary plus its queries, and each
query is read in the order the engine evaluates it while the screen shows it as written.
See above.

**Sensory masking** — brown noise under the audio, from a toggle and volume slider in
the top bar. See below.

**Renaming** — a document's name comes from its filename, or its first heading, or
"Untitled document" for pasted text with neither. Click the title in the top bar or
the structure map to rename it; Enter commits, Escape reverts, and the new name is
written straight to IndexedDB. Recent documents can be renamed in place from the
loader without opening them, and pasted text can be named up front.

## Kinetic visual anchors

Four sensory-grounding layers, each independently toggleable from the top bar and
all on by default:

- **Block caret** — a solid, unrounded block that snaps between words with
  `transition: none`. The hard edge and the instant move *are* the feature; a soft
  fade would blur the rhythm it exists to supply. Text inverts to the page
  background inside the block (measured at 13.4:1 contrast).
- **Syllabic pulse** — the active word scales to 110% on a transform, so it can never
  reflow the paragraph. The animation restarts naturally on each word because the
  class moves to a new element, and its duration is derived from measured WPM
  (`--fp-pulse-ms`) so the beat tracks the pace rather than running at a fixed rate.
  Suppressed under `prefers-reduced-motion`.
- **Clause spotlight** — everything outside the live clause drops to a low-contrast
  grey. Clause boundaries are assigned during parsing at commas, semicolons, colons
  and dashes, so this is structural rather than a fixed-width window.
- **Acronym badges** — see below.

## Acronym badges

[src/lib/acronyms.ts](src/lib/acronyms.ts) carries ~60 clinical data management terms
across five colour-coded categories (standards, data systems, regulatory, operational,
safety). The split is the point: **the eye gets a short badge, the ear gets the
expansion in full.** "eCRF" renders as a badge and is *spoken* as "electronic case
report form" — reading four letters teaches nothing, hearing the term every time
builds the association.

That required breaking an invariant the pacing engine was built on. Displayed text and
spoken text used to be the same string, which is what made word-level sync exact. Now
each chunk carries a separate `speech` string, and every token stores a `speechOffset`
alongside its display `offset`. Boundary events are resolved against `speechOffset`, so
the highlight stays on the single word "EDC" for the whole time the synthesizer is
saying "electronic data capture", then moves on correctly.

Matching is case-sensitive and whole-token, tolerating surrounding punctuation and a
plural or possessive suffix. Case-sensitivity is deliberate: `AE` is an adverse event,
`ae` is a fragment, and lowercasing would badge ordinary words like "pi".

## Brown-noise masking

[src/hooks/useBrownNoise.ts](src/hooks/useBrownNoise.ts) synthesizes brown (red) noise
on the native Web Audio API: white noise integrated with a leak term, so the signal is
a bounded random walk rather than the hiss of white noise. Two seconds are generated
once into a `Float32Array` and looped by an `AudioBufferSourceNode` — no asset to
fetch, so it starts instantly and works offline.

One ordering detail carries the algorithm: `lastOut` captures each sample *before* the
3.5x output gain, so the gain applies to the output only and never re-enters the
feedback path. Feeding it back would let the walk diverge.

Three things the browser forces:

- The `AudioContext` is constructed on the first toggle, which is a user gesture. A
  context created at mount would be born suspended.
- An `AudioBufferSourceNode` is single-use — once stopped it cannot restart — so each
  toggle-on builds a fresh node while reusing the one context.
- Gain changes are ramped, never assigned. A step change in gain is audible as a
  click, on both the toggle and the slider.

## Known limits

- PDF front matter (author lists, affiliations, citation blocks) sometimes survives
  as a section in the structure map. It is filtered where it can be recognised, but
  a line that looks typographically exactly like a heading will be read as one.
- Scanned PDFs with no text layer are rejected with a message rather than OCR'd.
- The stepper knows clause order, not semantics. It will step a query that does not run.
- A stepped query is read and never asked about: no grid, cloze or acronym is drawn from
  SQL. The enforcement ladder still fires on the prose around it, which is where the
  reasoning lives.
- A `.sql` file's headings come from comments ruled with `=` or `-`. A script that uses
  some other banner style comes out as one long section with no intercepts.
- Tables and figures are linearized into prose; they read poorly aloud. A detected grid
  and a SQL fence are the two exceptions, and each has its own reader.
- A cloze carrier is only as good as the sentence it came from. Where column recovery
  fused two lines in a PDF's front matter, the blank is presented inside that fused
  sentence — the builder reproduces the chunk exactly and does not attempt to detect or
  repair damaged extraction.
- At most one check fires per sentence boundary. A grid that ends exactly where a
  section does yields its question to the intercept, and is not asked about.
- A rejoined heading loses the hyphen at its seam — "Mid-" / "study Protocol Updates"
  comes out as "Midstudy Protocol Updates". The paragraph assembler has always done
  this to a word broken across a line break, and the join follows it rather than
  inventing a second rule; from the glyphs alone a soft hyphen and a real hyphenated
  compound are the same thing.
- A voice reads at the 185 wpm baseline until it has been *heard*. The speed control
  says "est." until roughly forty words at one rate have gone by, and a reader who
  switches voice often enough never to accumulate a sample stays there.
- A section counts as verified on a spot check every blank of which was answered wrong.
  Getting through the check is what proves someone was there; recall is reported
  separately and turns red below half.
- The exam date is not carried by a backup. It lives in `localStorage` with the voice
  and the words-per-minute target; re-entering it after a restore takes ten seconds.
- An exam record keeps only the questions that were got wrong, so the app cannot later
  say which terms you have always got right.
- Papers sat before the repeat-miss report learned about acronyms are still labelled by
  whichever question kind was missed last. They render; they correct themselves as new
  papers accumulate.
- The horizon compresses intervals; it cannot compress a corpus. It guarantees that
  everything already in the queue comes round again before the exam, and says nothing
  about material never read.

## Keyboard

| Key | Action |
| --- | --- |
| `Space` | Play / pause |
| `←` `→` | Previous / next sentence |
| `⇧←` `⇧→` | Previous / next section |
| `↑` `↓` | Reading speed ±10 wpm |
| `Home` | Back to the start |
| `Esc` | Stop |
| `V` | Answer the presence check |
| `1`–`4` | Answer a grid check |

In the scratchpad, a trailing `/e` `/m` `/o` commits a tagged node, `/p` parks an
off-topic thought, and `Enter` commits an untagged one.

Transport keys go inert while you are typing and while an intercept or a check is open.

## Backup

Everything this app produces — every summary written at an intercept, every captured
node, every review interval earned over weeks — lives in one browser's IndexedDB.
Clearing site data, resetting a browser or moving machines loses all of it, silently and
with no recovery. Export writes it to one JSON file and import merges it back
([src/lib/backup.ts](src/lib/backup.ts)).

**Documents are exported as their source, not as parsed documents.** That leans on an
invariant the app already depends on: `source` is a complete record, which is what
`db.getDoc` rebuilds from when the schema moves. Measured on a real database — 40,000
words across three documents — source-only is 263KB against 5.6MB for the parsed form,
21× smaller, and it cannot carry a stale token shape into a future parser. The entity
index is left out for the same reason: derived, and rebuilt on demand.

**Papers are carried too, at format 2.** A version-1 file simply has no such key, so it
reads as absent rather than malformed — it is still a complete backup of everything that
existed when it was taken, and refusing it would be the worst possible way to handle a
format bump. Papers need no newer-wins contest either: a marked paper never changes, so
a record already present is the same record.

**Import merges and never deletes.** Where both sides hold a record, the one touched last
wins. Restoring a three-week-old backup onto a machine that has been read on since must
not rewind that reading — an older review item carries an older interval, and applying it
would quietly undo weeks of scheduling. Validation is per-record rather than
all-or-nothing, so a file that is 99% good restores the 99% and reports the rest as
skipped instead of discarding a whole backup over one bad row.

## Persistence

IndexedDB ([src/lib/db.ts](src/lib/db.ts)), five stores: `documents` (parsed document
plus its source), `sessions` (reading position, flow nodes and their links,
summaries, which grids have been answered, and what each spot check established)
written debounced at 700 ms, `reviews` (the spaced-retrieval queue), `entities` (one
compact index per document) and `exams` (one record per mock paper sat). Every write is
best-effort — a browser in private mode loses persistence, not the reading session.

`entities` is derived data, kept only so the corpus view does not have to load nine
parsed documents — several hundred thousand tokens — to answer "where else does this
come up?". It arrived in database version 3, is rebuilt when a document's word count or
the extraction schema changes, and is deleted with its document, since nothing can
rebuild it once the source is gone. A rename updates it without re-walking the tokens.

`reviews` spans every document rather than belonging to one, and is indexed by `dueAt`
so the loader can ask what is owed without reading the whole queue, and by `docId` so
forgetting a document does not leave its questions behind. It arrived in database
version 2; the upgrade adds the store and leaves `documents` and `sessions` untouched.

`exams` arrived in database version 4, indexed by `at` so the home screen can ask for
the last few papers without reading every one ever sat. Unlike `reviews` and `entities`
it is deliberately **not** deleted with a document: those are questions about a
document and cannot outlive it, while a paper is a fact about the reader on a date, and
forgetting one guideline afterwards does not make it untrue. Each breakdown row keeps
the title it was sat under, so it still reads.

A version bump has one sharp edge worth knowing: a second tab already holding the
database blocks the upgrade, and a blocked `open()` neither resolves nor rejects — so
the best-effort wrapper cannot catch it and every call simply waits. Close other tabs
after an upgrade.

**Schema versioning.** A stored document is a snapshot of whatever the parser emitted
that day, and the token/chunk model changes as features land. Each document carries a
`schema` number; on read, a document whose version does not match the parser's is
rebuilt from its stored `source` and written back. Keeping the original source is what
makes that lossless — for PDFs the source is the extracted markdown, so migration does
not need the original file. The engine additionally falls back to display text when a
chunk has no speech string, so a stale shape degrades to reading without acronym
expansion rather than failing to play.

Some things are deliberately **not** in IndexedDB. The chosen voice and the reading
speed live in `localStorage`, along with what each voice has been measured to deliver
at each rate: none of it belongs to a document, and all of it is a property of the
voices this particular machine happens to have installed. The exam date is there for
the same reason — it belongs to the reader, not to anything they are reading — with the
consequence that a backup does not carry it.

And `sessions` carries no `schema` number of its own, which is a constraint rather
than an oversight — there is no migration path, so every field added to a session since
must read as `undefined` on the sessions already on disk. Node links, grid results and
spot-check results all arrived this way, and every consumer treats absent as empty.

## Choosing a voice

The chosen voice is remembered between sessions, and a fresh install does **not** take
the platform default. On Windows that default is David, which this project's own probe
measured as the slowest of all 49 voices to its first boundary — a latency the engine
pays once per *sentence*. The four fastest measured (Aria, Guy, Jenny, Christopher) are
preferred instead, then anything that is not David or Zira.

Word-exact pacing is a property of the **voice**, not of this app. The engine
resolves each `boundary` event's `charIndex` back to a token; a voice that fires
none falls back to the estimator, and one that fires them at offsets addressing
a different string moves the caret confidently to the wrong word. Neither
failure is audible.

`/voice-check` measures it. It speaks real parser output — deliberately
including acronyms, because expansion is what makes the displayed and spoken
strings diverge — through every installed voice, and resolves every boundary
with the same `tokenAtCharIndex` the reader uses, so a voice that passes there
passes here. It reports:

| | |
| --- | --- |
| Coverage | share of words the caret would actually visit |
| Precision | share of boundaries landing on a word start in the spoken text |
| First event | latency to the first boundary, against the 320ms estimator grace |
| Rate 1x/2x | whether the voice honours `rate` at all |
| Long text | whether a string past the 180-character cap is truncated |

Verdicts are `word-exact`, `partial`, `estimator-only` or `failed`.

**Use Edge.** Measured across 49 English voices, every one is word-exact at 100%
coverage and precision, including all the "Online (Natural)" cloud voices — so
the good-sounding voices cost nothing in sync. Chrome sees only the three
built-in Windows voices, and cannot be made to see more: the natural voices
Windows installs through Narrator are not registered as system TTS voices, so
they never reach the browser at all. The natural voices in Edge are Edge's own.

What actually separates them is latency to the first boundary event, which the
engine pays on **every sentence** because it utters one sentence at a time.
Local voices start in 414–711ms and network voices in 575–2376ms; the
`Multilingual` variants are the slowest by a wide margin. Aria (576ms), Guy and
Jenny are the quickest of the natural voices and the ones worth defaulting to.

## Browser support

Word-exact sync needs `SpeechSynthesis` boundary events: Chrome and Edge are the
reference targets. Firefox works. Safari falls back to the estimator. A browser with
no speech synthesis at all still renders and scrolls the document, with a banner
saying audio pacing is unavailable.

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
  takes over after a 320 ms grace period, and the header shows an `estimated pacing`
  badge rather than pretending the sync is exact.
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
- **Headings are often smaller, not bigger.** In journal typesetting a heading is
  frequently set smaller and in a contrasting family against the body. Detection keys
  on any deviation from the dominant body style — size, family or weight. Because
  that signal is weak, style-based headings must also be isolated (not inside a run
  of three or more) and followed by prose, which filters author lists, affiliation
  blocks and captions.
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
and intervals cap at six months.

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

**Dual-channel pacing** — 1.0x–3.0x, with Standard, Bionic (bolded leading fragment,
~45% of each word's letters) and RSVP (single word at a fixed optimal-recognition
point) views. Click any word to seek there.

**Kinetic scratchpad** — type an idea and end it with `/e`, `/m` or `/o` to commit it
instantly as an Entity / Mechanism / Output node. No Enter, no mouse; the audio never
has to stop. `Enter` alone commits an untagged note. Nodes remember the section and
word they were captured at, and clicking their section label seeks back there.

**Cognitive intercepts** — at every `#` / `##` boundary, playback hard-stops and a
non-dismissible full-screen dialog demands a one-sentence summary (minimum four words)
of the section just finished. Escape, outside-click and the close button are all
disabled; the only ways out are submitting or ending the session. Your own captures
for that section are hidden behind a toggle so recall comes first.

**Pre-scan structure map** — generated at load from the header hierarchy, with live
per-section time estimates, progress, and intercept status.

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
- Tables and figures are linearized into prose; they read poorly aloud.
- A cloze carrier is only as good as the sentence it came from. Where column recovery
  fused two lines in a PDF's front matter, the blank is presented inside that fused
  sentence — the builder reproduces the chunk exactly and does not attempt to detect or
  repair damaged extraction.
- At most one check fires per sentence boundary. A grid that ends exactly where a
  section does yields its question to the intercept, and is not asked about.

## Keyboard

| Key | Action |
| --- | --- |
| `Space` | Play / pause |
| `←` `→` | Previous / next sentence |
| `⇧←` `⇧→` | Previous / next section |
| `↑` `↓` | Speed ±0.1x |
| `Home` | Back to the start |
| `Esc` | Stop |
| `V` | Answer the presence check |
| `1`–`4` | Answer a grid check |

Transport keys go inert while you are typing and while an intercept or a check is open.

## Persistence

IndexedDB ([src/lib/db.ts](src/lib/db.ts)), three stores: `documents` (parsed document
plus its source), `sessions` (reading position, flow nodes, summaries) written debounced
at 700 ms, and `reviews` (the spaced-retrieval queue). Every write is best-effort — a
browser in private mode loses persistence, not the reading session.

`reviews` spans every document rather than belonging to one, and is indexed by `dueAt`
so the loader can ask what is owed without reading the whole queue, and by `docId` so
forgetting a document does not leave its questions behind. It arrived in database
version 2; the upgrade adds the store and leaves `documents` and `sessions` untouched.

**Schema versioning.** A stored document is a snapshot of whatever the parser emitted
that day, and the token/chunk model changes as features land. Each document carries a
`schema` number; on read, a document whose version does not match the parser's is
rebuilt from its stored `source` and written back. Keeping the original source is what
makes that lossless — for PDFs the source is the extracted markdown, so migration does
not need the original file. The engine additionally falls back to display text when a
chunk has no speech string, so a stale shape degrades to reading without acronym
expansion rather than failing to play.

## Choosing a voice

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

Verdicts are `word-exact`, `partial`, `estimator-only` or `failed`. Install
better-sounding voices first — on Windows, Settings → Accessibility → Narrator →
*Add natural voices* — then run the probe and keep the ones that survive it.

## Browser support

Word-exact sync needs `SpeechSynthesis` boundary events: Chrome and Edge are the
reference targets. Firefox works. Safari falls back to the estimator. A browser with
no speech synthesis at all still renders and scrolls the document, with a banner
saying audio pacing is unavailable.

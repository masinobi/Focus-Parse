# The enforcement ladder

What the app does at a section boundary to stop you coasting past it,
and the rules that keep a check from being unfair.

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
[src/lib/quiz.ts](../src/lib/quiz.ts) from the same `GridStep` data the flattener speaks.
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
[src/hooks/useVigilance.ts](../src/hooks/useVigilance.ts) periodically stops assuming.

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
contains before anyone sees it ([src/lib/dictation.ts](../src/lib/dictation.ts)).

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

## Summary checking (optional)

The intercept is worth more if something pushes back on the summary. Set one key in
`.env.local` (see `.env.example`) and a **Check my recall** button appears in the
intercept:

```bash
GEMINI_API_KEY=...        # or ANTHROPIC_API_KEY=...
```

Gemini wins if both are set. The route ([src/app/api/check-summary/route.ts](../src/app/api/check-summary/route.ts))
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

## Coming back

Nothing here records a missed session. Walking away costs nothing, no item is
marked wrong, and no debt accrues — a summary never written is simply not
written. That was already true; none of it had to be built.

What was missing is that **no timer reached an open check.** The vigilance
device is the app's only other clock and it deliberately does not run here:
`if (!enabled || !isPlaying) return`, and arming a check pauses playback. That
is correct for what vigilance is — it asks whether anyone is listening, and
nobody is listening to a paused document — but it left the one state a reader is
most likely to walk away from with nothing watching it. Leave an intercept open,
come back tomorrow, and the dialog is still there asking about a section whose
text left working memory hours ago. The only move is to dismiss it, which reads
as a failure and is not one.

[src/hooks/useReentry.ts](../src/hooks/useReentry.ts) ticks on the opposite
condition — only while the audio is stopped, which is also why a one-minute
interval costs nothing. After fifteen minutes it clears a stale check through
the same path a dismiss would take, so the accounting is unchanged; what changes
is who has to do it.

Then an **offer**, not an action. Audio that starts by itself in a tab someone
has just come back to is hostile, and the reader may have been away for a reason
that makes a replay pointless. It says what happened in the past tense, offers
to replay the last two sentences, and can be dismissed.

It never says how long you were gone. That number has no use except to be read
as a reproach.

Two details that are easy to get backwards:

- The offer is **not** cleared by ordinary interaction. Returning to the tab is
  itself a presence event, so a flag that presence cleared would be set and unset
  in the same instant and the offer made for you would never appear.
- The pre-roll counts back over what was **spoken**, skipping journal furniture.
  Playback never enters a reference list, so replaying "the last two sentences"
  out of one would be replaying something you have never heard.

## The sentence gauge

The structure map reports the distance to the next spot check in words, and that
number is staying. The reason a countdown clock was refused still holds — a
ticking clock in the field of view is a thing to watch instead of the text — but
that argument is about a *clock*. It does not settle whether a number is the
right shape for the answer.

"≈180w to a spot check" is a quantity you have to convert before it means
anything, and converting it is precisely the work that a tired brain cannot
spare. [src/lib/gauge.ts](../src/lib/gauge.ts) draws the same fact as a row of
marks, one per sentence, emptying as sentences finish.

It satisfies the constraint the clock failed, for a reason worth being explicit
about: **it only moves when a sentence ends.** A clock moves on its own, which
is what makes it a thing to watch. This moves on an event you caused, a dozen or
so times per leg, so there is nothing to watch between moves.

It draws the **spot-check** rung and not the summary. A 250-token leg is thirteen
to eighteen sentences, which is a readable row at a readable size; the distance
to the next summary is often over a thousand words, where one mark per sentence
is a hundred hairlines and a proportional bar is the progress bar the header
already has. That figure stays a number.

Like the numbers beside it, the row is the **earliest** a stop can come rather
than a promise that it will: `buildCloze` can find nothing worth asking in a
stretch, and the engine then slides the window on instead of stopping.

A leg longer than the row has marks is scaled and *says* it has been, in the
tooltip — a gauge that silently changed what a mark meant would be a different
measurement wearing the same row. On this corpus it does not happen.

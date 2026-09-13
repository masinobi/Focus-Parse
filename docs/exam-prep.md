# Exam preparation

Scheduling, mock papers, and the accounts that answer what the corpus
cannot: what is on the blueprint that you do not have.

## Spaced retrieval

Sessions used to end and take everything with them. A summary written at an intercept
and a term missed at a spot check were both written to IndexedDB and never surfaced
again, which meant a reader could work through a guideline exactly as intended and have
nothing left of it a fortnight later.

Those same artefacts now become review items on a widening interval
([src/lib/review.ts](../src/lib/review.ts)). When anything is due, the loader offers a
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

Every check in [the enforcement ladder](enforcement-ladder.md) is an interruption, fired while reading, whose purpose is to
stop a reader coasting through one document. An exam is the opposite arrangement, and it
is the one that answers the question a candidate actually has: a timed set drawn across
the whole corpus at once, no feedback until the end, scored with a breakdown by document
and by question type ([src/lib/exam.ts](../src/lib/exam.ts)).

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
([src/lib/history.ts](../src/lib/history.ts)).

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

So the interval gets a horizon ([src/lib/deadline.ts](../src/lib/deadline.ts)).

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

## Blueprint coverage

Every account in this app is a closed system. The coverage map answers "how much
of this document have I been held to"; the corpus index answers "where else does
this term appear". Both can only report on material that is already in the
library — so the one question neither can reach is the one that decides the exam:
**what is on the blueprint that I do not have?**

That gap is invisible from inside and no amount of reading closes it. It closes
by comparing the library against an external list, which is what
[src/lib/blueprint.ts](../src/lib/blueprint.ts) is: the SCDM CCDA study guide’s six
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
| `DOCUMENT_ALIASES` | this title is that chapter **when it stands as a whole document** |
| `RESEMBLES` | related and never counted — a later edition that re-split it |
| `EXCLUDED` | examined and ruled out, with the reason |

`DOCUMENT_ALIASES` has one entry and exists because this corpus holds two
chapters whose titles are identical after normalization: the guide gives
separate minimum standards for `Vendor Selection and Management` and for
`Vendor Selection and Management (Released 2021)`, and they are not the same
list — what the first calls a minimum standard, the 2021 release demotes to a
best practice. Normalization folds `&` into `and`, so no title rule can tell
them apart. Document-versus-section can: the 2021 release is a standalone
article, and the 2013 chapter exists only as a heading inside the handbook.

A second rule keeps a heading from speaking for the document it names. A
standalone chapter PDF repeats its own title as a running heading, and a section
match used to beat a document match unconditionally — so four words beat 8,377
and the chapter read as *verified on eight*. A section outranks its document
only once it is 60 words, the same floor the intercept and the queue sweep use.

Fuzzy matching is used in exactly one place, and never to decide: `scan-blueprint`
flags any corpus title within an edit or two that did **not** match, so a missing
alias is adjudicated rather than absorbed. It found one on its first run —
`m) Data Privacy`, a lettered run-in sub-heading inside the DCI chapter, two
hundred words about privacy in CRF design. Matching it to the twenty-page `Data
Privacy` chapter would have reported a chapter as covered on the strength of a
paragraph.

### What it says on this library

Two chapters the exam names are not here, and both are metrics chapters that do
not exist in the 2013 GCDMP edition. It read three until the vendor chapter
turned out to be in the library already, filed under the other vendor chapter's
name.

Read the word count printed beside each row before trusting the state. Thirteen
of the sixteen chapters that report as verified are matched only by their entry
in the handbook's contents — `Database Closure` on two words. The parser has no
notion of which sections *belong* to a chapter, so a chapter carried inside the
handbook is found by its heading and nothing else.

The panel puts that first and paints it differently from an unread chapter, on
purpose. Confusing "you have not read this" with "you do not have this" wastes
exactly the weeks a reader has least of.

```bash
node scripts/scan-blueprint.mjs "path/to/CCDA Study" --verbose
```

## Minimum standards and best practices

The exam asks *"which of the following is a minimum standard"* as a question
format, not as a topic. A GCDMP chapter answers it by laying the two tiers out
as consecutive sections — and once the text is being read aloud, nothing
distinguishes them. 51 sections of this corpus are one tier and 32 are the
other, 27,177 words between them.

[src/lib/tiers.ts](../src/lib/tiers.ts) tags them, and the interesting part is what
it refuses to do.

### The rule that looks right and is backwards

The obvious implementation reads the modal verbs: `shall` and `must` mark a
requirement, `should` marks a recommendation. Counted over all thirteen
documents:

```
should  2931 corpus-wide    327 inside a Minimum Standards section
                             23 inside a Best Practices section
must     344                 24 inside a Minimum Standards section
shall     37                  7 inside a Minimum Standards section

Minimum Standards sections containing no "must" and no "shall":  32 of 51
```

The GCDMP writes its **mandatory** tier in "should", fourteen times more often
than it writes its aspirational one — and a keyword rule would miss 63% of those
sections outright while badging them recommendations. Item 1 of Table 1
*Minimum Standards* in the vendor chapter reads "Sponsors **should** assess a
vendor's Quality Management System."

The deeper reason is that the tier is not a property of the sentence at all.
"Document the sponsor's process and support functions needed to evaluate the use
of vendor services" is a **minimum standard** in the guide's 2013 vendor chapter
and a **best practice** in the 2021 release — the same words, the opposite tier,
decided by which edition you are holding. Nothing in the wording can know that.
The heading it sits under can.

### Exact, or listed, or nothing

Same rule as the blueprint matcher. An enumerator is stripped — the corpus
writes `4) Minimum Standards` and `Minimum Standards` for one heading — and the
remainder must *equal* a listed form. The near misses are why this is not a
substring test:

| title | why it is not a tier |
|---|---|
| `2 GCDMP Chapters – Minimum Standards and Best Practices` | the study guide's contents entry; it names both and is neither |
| `Other Best Practice Considerations` | a prose sub-heading, not the chapter's tier block |

A substring rule tags the first of those eight times and takes the minimum count
from 51 to 59. `scan-tiers.mjs` requires every title naming a tier to be either
tagged or written down with a reason, so a fourteenth document arriving with a
fifth spelling is adjudicated rather than absorbed.

That scanner also prints the modal-verb disagreement every run, as a standing
control on its own reasoning. If that number ever comes out small, the argument
above is wrong and `tiers.ts` should be rewritten to read the prose.

```bash
node scripts/scan-tiers.mjs "path/to/CCDA Study" --verbose
```

### In the app

A badge on the structure-map row and beside the heading in the reading pane, and
a **tier filter** in the map that composes with the text filter rather than
replacing it — "minimum standards in the vendor chapter" is the question it is
for, and either control alone answers half of it.

The filter is absent where a document declares no tier. ICH E6, 21 CFR Part 11
and your own notes carry no GCDMP tier headings, and a control that can only
ever return nothing is worse than no control.

The badge is deliberately neither red nor green. The map already spends
`text-destructive` on "read but never checked" and `text-output` on "verified",
and a tier in either colour would read as a verdict on the reader rather than a
fact about the document.

## Regulations cited

The corpus index is keyed by *term*, and a citation is not a term. `21 CFR Part
11 section 11.10` is a **provision** — and [src/lib/quiz.ts](../src/lib/quiz.ts)
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

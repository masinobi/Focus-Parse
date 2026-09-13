# Ingestion

A PDF has no headings, paragraphs or lists — only glyphs at coordinates.
This is how a document is reconstructed from them, and what is thrown away.

## PDF ingestion

A PDF has no headings, paragraphs or lists — only glyphs at coordinates.
[src/lib/pdf.ts](../src/lib/pdf.ts) reconstructs structure from typography and layout,
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
load-bearing. See [pacing checkpoints](pacing.md#pacing-checkpoints).

## Citation stripping

Reference markers are noise in both channels: they clutter the line, and the
synthesizer reads them, so "time stamps.13" comes out as "time stamps thirteen".
Removal happens in two layers — geometrically during PDF extraction (above), and
textually in [src/lib/parse.ts](../src/lib/parse.ts) for anything arriving as plain text:
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

[src/lib/tables.ts](../src/lib/tables.ts) recovers tables from PDF glyph
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

**A markdown pipe table takes the same route** ([src/lib/md-tables.ts](../src/lib/md-tables.ts)).
None of the coordinate recovery applies — the author typed the structure — but
until the parser learned to fold one, a table written in markdown arrived as
paragraphs of pipes: read aloud as "pipe Attributable pipe Who recorded the
data pipe", and invisible to the grid check. Folding happens on the parser's
working copy of the lines, so the stored `source` is still the markdown you
supplied and the fold re-runs on every rebuild. Escaped `\|` stays a character,
cells are stripped of their inline markdown, ragged rows are snapped to the
header's width, and a table inside a code fence is left alone.

The confidence floor below does **not** apply to a typed table — pipes are not a
detection — but one rule does: a table that would flatten to no steps is left as
prose. The fence it would emit is discarded by the line loop, so folding it
would delete your text with nothing to show it had been there.

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

Those sections are **marked, not removed** ([src/lib/parse.ts](../src/lib/parse.ts)).
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
fake ([src/lib/sql.ts](../src/lib/sql.ts)).

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

## The corpus index

Nine guidelines on one subject were nine separate reading sessions with no thread
between them. The corpus is not nine subjects — it is one subject written down nine
times, and the thing worth knowing about a term is that ICH E6 defines it, a GCDMP
chapter operationalizes it and the exam guide lists it. That relationship was in the
material and the app was throwing it away.

The loader opens onto every named thing the parser found, with the documents that use
it and a way into each one at the place it first appears
([src/lib/entities.ts](../src/lib/entities.ts)). Terms the retrieval queue says are not
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

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
is. That is content, not clutter — a single GCDMP chapter carries 114 of them.

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

## Pacing checkpoints

Intercepts cannot depend on heading recovery succeeding, so any stretch longer than
700 words is split at a paragraph boundary into `<title> (part N)`. These are ordinary
sections, so the structure map, intercepts and stored summaries work on them
unchanged. A 28,000-word guideline that yields three real headings still gets ~40
intercepts.

Conversely, sections under 60 words never arm an intercept: stopping a reader to
summarize two sentences is friction without a payoff, and it absorbs stacked headers
and the occasional false heading recovered from PDF typography.

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

## Keyboard

| Key | Action |
| --- | --- |
| `Space` | Play / pause |
| `←` `→` | Previous / next sentence |
| `⇧←` `⇧→` | Previous / next section |
| `↑` `↓` | Speed ±0.1x |
| `Home` | Back to the start |
| `Esc` | Stop |

Transport keys go inert while you are typing and while an intercept is open.

## Persistence

IndexedDB ([src/lib/db.ts](src/lib/db.ts)), two stores: `documents` (parsed document
plus its source) and `sessions` (reading position, flow nodes, summaries), written
debounced at 700 ms. Every write is best-effort — a browser in private mode loses
persistence, not the reading session.

**Schema versioning.** A stored document is a snapshot of whatever the parser emitted
that day, and the token/chunk model changes as features land. Each document carries a
`schema` number; on read, a document whose version does not match the parser's is
rebuilt from its stored `source` and written back. Keeping the original source is what
makes that lossless — for PDFs the source is the extracted markdown, so migration does
not need the original file. The engine additionally falls back to display text when a
chunk has no speech string, so a stale shape degrades to reading without acronym
expansion rather than failing to play.

## Browser support

Word-exact sync needs `SpeechSynthesis` boundary events: Chrome and Edge are the
reference targets. Firefox works. Safari falls back to the estimator. A browser with
no speech synthesis at all still renders and scrolls the document, with a banner
saying audio pacing is unavailable.

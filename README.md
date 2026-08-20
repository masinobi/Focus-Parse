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
Web Speech API · pdf.js · optional Gemini or Claude summary grading.

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
- **Furniture.** Running heads, folios and footnote markers are dropped by repetition
  across pages within the margin strip, and by relative glyph size.

Structure recovery is best-effort and varies by document — which is why it is not
load-bearing. See pacing checkpoints below.

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

## Browser support

Word-exact sync needs `SpeechSynthesis` boundary events: Chrome and Edge are the
reference targets. Firefox works. Safari falls back to the estimator. A browser with
no speech synthesis at all still renders and scrolls the document, with a banner
saying audio pacing is unavailable.

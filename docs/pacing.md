# Reading and pacing

How the highlight stays on the spoken word, what happens when a platform
refuses to help, and the sensory layers laid over the text.

## Read with a production build

**Use `npm run study` to read, not `npm run dev`.** It builds once and serves the
production bundle. On the 524-page GCDMP the difference is not cosmetic — across
several three-run measurements on one machine:

| | `npm run dev` | `npm run study` |
|---|---|---|
| time to open | 7.6–11.8s | **3.8–5.8s** |
| longest unbroken freeze | 3.6–6.0s | **1.9–2.8s** |
| main thread blocked per 20s of playback | 0.89–1.41s | **0.31–0.47s** |
| memory | 210–215MB | **111–112MB** |

Ranges, not points, because the spread between runs on one build is wide enough
to swallow a careless comparison — the memory figure is the only one that barely
moves. Measure your own with `npm run scan-perf "<corpus folder>"` against
whichever server is running.

React's development build ships `validateProperty`, `warnOnInvalidKey` and the
rest of its diagnostics, and a document that lays out 135,000 word spans pays
for every one of them. `npm run dev` remains the right command for working *on*
FocusParse — it just costs roughly twice to three times as much to read with.

If you switch back to `npm run dev` after a build, delete `.next` first.

## How the pacing works

The interesting problem is keeping the highlight exactly on the spoken word rather
than interpolating it. The approach:

1. **Parse** ([src/lib/parse.ts](../src/lib/parse.ts)) turns markdown into three aligned
   arrays — `blocks` (layout), `chunks` (one sentence = one utterance), and `tokens`
   (one word). Every token stores its character offset **within its own chunk**, which
   is precisely the coordinate space `SpeechSynthesisUtterance` reports through
   `onboundary`.
2. **Speak** ([src/hooks/useSpeechEngine.ts](../src/hooks/useSpeechEngine.ts)) always
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

## Pacing checkpoints

Intercepts cannot depend on heading recovery succeeding, so any stretch longer than
700 words is split at a paragraph boundary into `<title> (part N)`. These are ordinary
sections, so the structure map, intercepts and stored summaries work on them
unchanged. A 28,000-word guideline that yields three real headings still gets ~40
intercepts.

Conversely, sections under 60 words never arm an intercept: stopping a reader to
summarize two sentences is friction without a payoff, and it absorbs stacked headers
and the occasional false heading recovered from PDF typography.

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

[src/lib/acronyms.ts](../src/lib/acronyms.ts) carries ~60 clinical data management terms
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

[src/hooks/useBrownNoise.ts](../src/hooks/useBrownNoise.ts) synthesizes brown (red) noise
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

## Rendering large documents

Above 3,000 words the reader marks blocks `content-visibility: auto`, letting the
browser skip layout and paint for off-screen ones. Every block stays in the DOM —
an earlier attempt used a sliding window with spacers, which meant scrolling ahead of
the playback position landed in a blank region. `contain-intrinsic-size` keeps the
scrollbar plausible before a block has ever rendered. Section rows and the WPM
readout are memoized and quantized so a spoken word re-renders one row, not a
hundred.

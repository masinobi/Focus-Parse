# Speech and voices

Choosing a voice out of the hundred-odd a browser installs, and the two
clocks that used to disagree over a network voice.

## Choosing a voice

Edge installs well over a hundred voices, all named with the same decoration —
"Microsoft Aria Online (Natural) - English (United States)" — and the old
control was a `<select>`, which is right for five options and wrong for a
hundred and forty.

It is a dialog now with a filter. Every whitespace-separated term has to match
somewhere in the voice's name, its language tag, or the words describing where
it runs, so all of these work:

| typed | finds |
|---|---|
| `aria` | the one voice |
| `kingdom` or `en-GB` | the British voices, either spelling |
| `local` | the voices that need no network |
| `cloud english` | English voices synthesized over the network |

Two terms **narrow**; there is no scoring and no nearest match. A voice that
matches nothing returns nothing, and the platform's own order is preserved so a
voice does not move under the cursor on every keystroke. That is the same rule
the blueprint matcher follows and for the same reason — a wrong voice picked off
a confident-looking list is a whole session read in the wrong accent.

Each row shows whether the voice runs **on this machine** or **over the
network**, which the old control could not show at all and which turns out to
be the first thing worth knowing.

## Why a network voice used to go silent

Two clocks run over every utterance, and they disagreed.

The **estimator grace** is how long the engine waits for a real `boundary` event
before it starts interpolating the caret. It is generous on purpose and learned
per voice: 1,200ms for a network voice never heard from, then that voice's own
measured latency plus half again, up to 2,800ms.

The **stall watchdog** is the other one. It decides the platform dropped the
utterance entirely, abandons the sentence and starts the next. It was a flat
1,600ms, armed before `speak()` was even called.

So the watchdog was tighter than the wait it exists to back up. A voice the
estimator was still patiently waiting for at 2,000ms had already had its
sentence given up on at 1,600 — silently, because an abandoned sentence and a
finished one look identical from the outside.

This was not a theoretical margin. The voice-preference list in the engine is
ordered by a `/voice-check` run on this machine, and its own note records that
**across 49 voices in Edge the first boundary arrived between 575ms and
2,376ms**. Every voice in the slow half of that measured range was having its
sentences abandoned before it had said a word.

Local voices report in tens of milliseconds and never came near either clock,
which is why the symptom reads as *"this particular voice is broken"* rather
than as a bug in the engine.

[src/lib/speech-timing.ts](../src/lib/speech-timing.ts) now derives the watchdog
from the grace instead of declaring it alongside: `stallTimeoutFor(grace,
boundarySeen)` cannot be shorter than the wait it backs up, and tightens back to
the flat timeout once a boundary has arrived, since a voice that has reported is
known reachable and a later silence is a real drop.

The policy lives in its own module for one reason: **headless Chromium
enumerates zero voices**, so the speech engine has no browser probe and never
will. Moving the numbers somewhere a unit test can reach them is the only way
they are checked at all.

Confirmed on the machine that had the fault — Aria speaks again in Edge, 9 Sep
2026. Nothing in this repo could establish that, which is why it is written down
here rather than left to the test suite.

### And why the caret used to run ahead of it

Fixing the first fault exposed a second one behind it. On resuming, the caret
would walk to the end of the sentence before anything was audible, then sit
frozen there while the audio caught up.

The estimator interpolates the caret at a fixed words-per-minute for engines
that fire no word boundaries. That arithmetic is only meaningful measured from
the moment audio *began*, and it was measured from the moment the utterance was
handed to `speak()` — which on a network voice is one cold round trip earlier.
So the wait was spent as though it were speech: `elapsed / msPerWord` walked the
caret to the end of the chunk, and when the audio finally started every real
boundary arrived behind the guess. Highlight movement is monotonic within an
utterance, so the caret could not come back.

The engine listens for the `start` event now and anchors to it. Before it
arrives there is no basis for a guess, so nothing is interpolated and the stall
watchdog owns that window. A voice still gets a fixed number of utterances to
prove it reports starts at all — nothing in the spec obliges an engine to, and a
missing fallback would freeze the caret for every sentence on one that does
not.

Confirmed in Edge on 9 Sep 2026: the caret tracks the audio through a resume.
Both of these faults were reported in a sentence and closed by the same reader
trying it again, because nothing in this repo can execute the speech path.

### If a voice still fails

Open **`/voice-check`**. It speaks a fixed passage through every installed voice,
measures the first boundary, checks the offsets against the same
`tokenAtCharIndex` the engine uses, and gives each voice a verdict. "Copy report"
puts the whole table on the clipboard.

## Which voice you get by default

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

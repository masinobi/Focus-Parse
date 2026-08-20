export const SAMPLE_DOCUMENT = `# The Drift Problem

Reading failure is rarely a comprehension failure. It is an attention failure that
comprehension gets blamed for. The eyes keep moving, the page keeps turning, and
somewhere around the third paragraph the internal narrator quietly stops narrating.
Nothing announces the moment. You discover it retroactively, at the bottom of a page
you cannot summarize.

This document exists to be read inside FocusParse, so it doubles as a test fixture:
it has major headers, sub-headers, lists, a quotation, and a code block that is shown
but never spoken.

## Why Silent Reading Drifts

Silent reading is unusually easy to fake. There is no external signal that stops when
attention stops. Compare that to a conversation, where a three-second gap is
immediately obvious to both participants, or to driving, where drift produces
feedback within a second.

The absence of feedback is the whole problem. A reader who has drifted looks exactly
like a reader who has not.

- The eye can traverse a line without lexical access.
- Subvocalization stops before the page-turning habit does.
- Familiar phrasing is especially dangerous: fluency feels like understanding.

> Rereading a passage until it feels familiar produces confidence, not retention.
> Familiarity is the cheapest possible signal, and the brain accepts it anyway.

## Dual-Channel Ingestion

Pairing audio with synchronized visual highlighting closes the feedback gap. Audio
sets an external pace that does not wait for you, and the highlight makes your
position unambiguous at every moment.

The effect is not that you read faster. The effect is that you notice, within about
a second, that you have stopped reading. Recovery becomes cheap because the position
is never lost.

Three view modes trade off differently against that goal:

1. Standard keeps normal typography and adds only the moving highlight.
2. Bionic bolds the leading fragment of each word, giving the saccade a target.
3. RSVP removes eye movement entirely by presenting one word at a time in place.

RSVP is the most aggressive and the least forgiving. It is excellent for a first
structural pass and poor for anything you intend to remember without re-encoding.

## Active Re-Encoding

Ingestion alone is not learning. The step that converts exposure into retention is
re-encoding: restating the material in a form you generated yourself.

The three tags in the scratchpad exist to make that restatement structural rather
than verbatim:

- Entity: a thing that exists in the model. A system, a person, a variable.
- Mechanism: something that acts on an entity, or how an entity changes.
- Output: what falls out of the mechanism. A consequence, a result, a claim.

Almost any explanatory text decomposes into those three. If you cannot place a
sentence into one of them, you have found the part you did not actually understand,
which is exactly the useful signal.

Code is displayed but never read aloud, because listening to punctuation is a fast
way to lose the thread:

\`\`\`ts
function retention(exposure: number, reEncoding: number): number {
  return exposure * Math.max(0.1, reEncoding);
}
\`\`\`

## The Intercept

The last mechanism is the least comfortable. At every major structural boundary,
playback stops and refuses to continue until you have typed one sentence describing
what you just heard.

This is deliberately annoying. The annoyance is the mechanism. A summary you cannot
produce is a section you did not process, and discovering that at the boundary costs
you thirty seconds. Discovering it at the end of the document costs you the document.

Two rules make the intercept work:

1. Write it before you look back at the text. A summary reconstructed from the page
   is a transcription, not a recall.
2. One sentence, not three. The constraint forces you to choose what mattered, and
   that choice is the actual comprehension test.

# Practice Protocol

Start at a rate that feels slightly too fast, around 1.4x. Discomfort is the point:
a pace you are comfortable with is a pace that leaves room for drift.

Capture two or three tagged nodes per section. Fewer than that and you are passively
listening. More than that and you are transcribing, which is the same passivity
wearing a more industrious costume.

When the intercept fires, resist the urge to scroll back. Type the sentence you
actually have, even if it is worse than the one you could reconstruct. The gap
between those two sentences is the honest measure of what the pass bought you.
`;

---
name: FocusParse
description: A reading room that keeps you honest — paced speech, a caret locked to the voice, and checks you cannot coast past.
colors:
  ink: "hsl(240 10% 3.9%)"
  paper: "hsl(0 0% 98%)"
  graphite: "hsl(240 3.7% 15.9%)"
  pewter: "hsl(240 5% 64.9%)"
  focus-ring: "hsl(240 4.9% 83.9%)"
  primary-ink: "hsl(240 5.9% 10%)"
  signal-amber: "hsl(47 96% 60%)"
  entity-sky: "hsl(199 89% 60%)"
  entity-sky-ink: "hsl(199 90% 8%)"
  mechanism-violet: "hsl(271 91% 72%)"
  mechanism-violet-ink: "hsl(271 90% 10%)"
  output-green: "hsl(142 69% 58%)"
  output-green-ink: "hsl(142 80% 8%)"
  alarm-oxblood: "hsl(0 62.8% 30.6%)"
  alarm: "hsl(0 84% 70%)"
  paper-light: "hsl(0 0% 100%)"
  ink-light: "hsl(240 10% 3.9%)"
  mist-light: "hsl(240 4.8% 95.9%)"
  hairline-light: "hsl(240 5.9% 90%)"
  pewter-light: "hsl(240 3.8% 46.1%)"
  signal-amber-light: "hsl(47 96% 53%)"
  alarm-red-light: "hsl(0 84.2% 60.2%)"
typography:
  display:
    fontFamily: "Iowan Old Style, Charter, Georgia, Cambria, ui-serif, serif"
    fontSize: "3rem"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Inter, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.333
    letterSpacing: "-0.025em"
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Inter, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.025em"
  reading:
    fontFamily: "Iowan Old Style, Charter, Georgia, Cambria, ui-serif, serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.85
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Inter, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
    fontFeature: "\"rlig\" 1, \"calt\" 1"
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Inter, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.33
    letterSpacing: "0.05em"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.625
rounded:
  none: "0px"
  word: "3px"
  sm: "4px"
  md: "6px"
  lg: "8px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  section: "40px"
components:
  button-primary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.primary-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "hsl(0 0% 98% / 0.9)"
    textColor: "{colors.primary-ink}"
  button-outline:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  button-outline-hover:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.paper}"
  button-ghost-hover:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.paper}"
  input:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "40px"
  badge-entity:
    backgroundColor: "{colors.entity-sky}"
    textColor: "{colors.entity-sky-ink}"
    rounded: "{rounded.md}"
    padding: "0px 6px"
  badge-mechanism:
    backgroundColor: "{colors.mechanism-violet}"
    textColor: "{colors.mechanism-violet-ink}"
    rounded: "{rounded.md}"
    padding: "0px 6px"
  badge-output:
    backgroundColor: "{colors.output-green}"
    textColor: "{colors.output-green-ink}"
    rounded: "{rounded.md}"
    padding: "0px 6px"
  kbd-hint:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.pewter}"
    typography: "{typography.mono}"
    rounded: "{rounded.sm}"
    padding: "2px 6px"
  word-caret:
    backgroundColor: "{colors.signal-amber}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
  presence-pill:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.signal-amber}"
    rounded: "{rounded.full}"
    padding: "8px 16px"
---

# Design System: FocusParse

## Overview

**Creative North Star: "The Kind Invigilator"**

FocusParse is an exam hall run by a proctor who wants you to pass. The room is
quiet and dark, the document is the only thing lit, and nothing on the walls asks
for attention. Then, at a section boundary, a spot check or a silence that lasts
too long, the invigilator steps forward: the screen stops, the question fills it,
and there is no way round it except answering. The interface's whole personality
lives in that contrast. It is calm for long stretches, unmistakable when it
interrupts, and never accusatory: someone coming back after a break gets a replay,
not a reprimand.

The system is dense, flat and built on zinc neutrals. It is a working tool for
long sessions, so the chrome recedes: hairline borders, tonal panels, one warm
colour. That colour, Signal Amber, means "here, now": the word being spoken, or
a moment that needs your answer. Typography splits into two voices. The serif
belongs to the document being read; the system sans belongs to everything the
app says about it.

The interface reports honestly. Numbers that are estimates say "est.", a target
the voice cannot reach is struck through beside what it will really do, and
coverage shows what was *verified*, not how far the caret travelled. Visual
design follows suit: a display that changes itself on a guess about attention
was explicitly refused, and so was a ticking clock in the field of view.

**Key Characteristics:**
- Dark by default today. Light is meant to be a first-class reader's choice but is not yet designed.
- One warm accent (Signal Amber) against cool zinc neutrals.
- Serif for the text being read; sans for the instrument around it.
- Flat at rest. Anything that floats is interrupting you.
- Dashed borders mean "empty, optional or not yet verified".
- Keyboard-first: every reading and check path shows its key.

## Colors

Cool, near-colourless zinc neutrals, one warm signal, and three category hues for
the reader's own captures.

### Primary
- **Signal Amber** (`signal-amber`): the reading position and anything that
  demands a response. It fills the block caret (with Ink text on it), tints the
  active word at 28% with a 2px underline in the full colour, marks the intercept's
  shield icon, and outlines and colours the "Still there?" presence pill. It
  measures 13.4:1 on Ink.
- **Paper** (`paper`): primary action fill (Play, Parse document) with Primary
  Ink text, and the main text colour. In this system the "primary" button is the
  brightest thing on screen after the caret, not a brand hue.

### Secondary
- **Entity Sky** (`entity-sky`): `/e` captures and Entity nodes; also borrowed
  by the *standard* acronym badge category.
- **Mechanism Violet** (`mechanism-violet`): `/m` captures and Mechanism nodes;
  also the *data* acronym category.
- **Output Green** (`output-green`): `/o` captures and Output nodes; also the
  *operational* acronym category.
  Each has a matching dark `-ink` text colour for use on its own fill. The hues
  are current practice, **not a commitment**: a redesign may change them, as long
  as the three stay mutually distinct and readable as fills and as text.

### Neutral
- **Ink** (`ink`): page background, card and popover fill, and the text colour
  on any amber or Paper fill.
- **Graphite** (`graphite`): one value serving as border, input stroke, muted
  panel, hover fill and secondary button. Translucent steps of it (`/20`, `/30`,
  `/40`) make the inset panels in dialogs and the code blocks.
- **Pewter** (`pewter`): secondary text, captions, keyboard hints and section
  metadata. It measures 7.8:1 on Ink. Read words fade to Pewter at 70%. Outside
  the live clause, the clause spotlight takes peripheral text down to Pewter at 28%
  on purpose.
- **Focus Ring** (`focus-ring`): the 2px keyboard focus ring, offset by 2px.
- **Alarm Oxblood** (`alarm-oxblood`): the destructive fill. It is a *background*
  red.
- **Alarm** (`--alarm`, `text-alarm`): red for *text*: errors, a missed count,
  an unreachable speed, "read but never checked". `0 84% 70%` on Ink measures
  7.07:1; the light value is `0 72% 42%`. The regulatory acronym badge uses it
  too.
- **Light-theme set** (`*-light`): the shadcn zinc defaults that sit unused in
  `:root`. They are recorded so a light theme can start from them, not because
  they have been designed (see Do's and Don'ts).

### Named Rules
**The Signal Rule.** Signal Amber means "here, now, or answer me". It never
decorates, never marks a category, and never appears on a screen where neither
the reading position nor a demand for a response is present. (The acronym
*safety* badge currently borrows it, which is the one standing exception and
should be retired.)

**The Oxblood-Is-A-Floor Rule.** Alarm Oxblood is a fill. As text on Ink it
measured 1.86:1 and was caught by the probe once already. Red *text* is
`text-alarm`, never `text-destructive`; every text use in the app was moved to
it on 5 Oct 2026, including the top bar's clamped-wpm figure and the "Presence
check missed" toast.

## Typography

**Reading Font:** Iowan Old Style (with Charter, Georgia, Cambria, serif)
**UI Font:** the platform system sans (Segoe UI on Windows; Inter, Roboto, Helvetica Neue and Arial as fallbacks)
**Mono Font:** ui-monospace (SFMono, Menlo, Consolas)

**Character:** The serif is the document's voice: bookish, wide-set and slow,
chosen for long reading. The system sans is the app's voice: neutral and native,
so the app adds nothing between the reader and the text. All typefaces are
system-installed. No web fonts load, which keeps the app offline-clean.

### Hierarchy
- **Display** (400, 3rem, line-height 1, tight tracking): the single word in RSVP
  view, in the reading serif. It is the largest type in the app and is used
  nowhere else.
- **Headline** (700, 1.5rem, tight): document `#` headings inside the reader, in
  sans. The intercept's question title, the returning home's wordmark and the
  sample heading on the first-run home also sit at 1.5rem.
- **Title** (600, 1.25rem, tight): `##` headings in the reader.
- **Reading** (400, 1.0625rem / 17px, line-height 1.85, max 62ch): the document
  body. Paper at 90%. Headings within the text switch to sans; prose stays serif.
- **Body** (400, 0.875rem, 1.43): app copy, buttons, row titles, dialog prose.
- **Label** (600, 0.75rem, letter-spacing 0.05em, UPPERCASE): pane headings
  ("STRUCTURE", "VERIFIED"), lane headings ("ENTITY").
- **Mono** (0.75rem, 1.625): keyboard hints, `.sql` blocks, preformatted text.

### Named Rules
**The Two Voices Rule.** Serif is only ever the text being read (and the RSVP
word). Everything the app says (controls, counts, headings it recovered,
feedback) is sans. Mixing them blurs the line between the document and the
instrument.

**The 62ch Rule.** The reading measure is capped at 62 characters. A wide line
is the enemy of pacing; never widen it to fill a pane.

**The 12px Floor.** The user's direction for controls is "calm but
unmistakable", and dyslexia and reading load are hard requirements. Nothing in
the reader, the structure map, Notes, the top bar or the three checks is set
below 12px (measured: zero elements under 12px with a check open over the
reader). The library-side tools (review, corpus index, citation index,
blueprint, compare, `/voice-check`) still carry thirteen 10–11px labels;
that is the remaining debt, to be raised when touched. New work sets nothing
below 12px.

## Layout

**The app shell is a full-viewport instrument.** `100dvh`, with the body's
overflow hidden. A top bar wraps onto a second row when narrow. Below it, a
horizontal resizable split remembers its sizes: the **reading pane** starts at 55%
(minimum 35%) and the **scratchpad** at 45% (minimum 25%), joined by a gripped
handle. The reading pane holds the structure map as a collapsible left sidebar
and the reader column, with a strip of key hints pinned to its foot. Each region
scrolls on its own. A first session (a document opened from the first-run home)
starts with the map folded and the top bar cut to transport, speed, voice and
New; the rest arrives behind the first check, never mid-reading.

**The home screen is a single column.** It is at most 672px wide, centred with
32px padding, and scrolls. Vertical centring uses `my-auto` inside the scroller,
never `justify-center`, because a centred flex scroller clips anything that
overflows above its origin. That clipping shipped once and hid controls when
many documents were loaded. Feature entries stack as full-width bordered rows,
24px apart.

**Interruptions are full-screen.** The intercept fills the viewport with no
radius and no border. Its content sits in the same 672px column, padded 24px
across and 40px down, so a check reads like a page of its own rather than a
pop-up over the work.

**Spacing** runs on Tailwind's 4px grid. Dense chrome uses 8 to 16px (top bar
`10px 16px`, control groups 4px apart). Content blocks use 24 to 40px (heading
margins of 28, 36 and 40px). Dialog panels pad 24px.

**Responsive behaviour is desktop-first, with a phone layout.** Long sessions at
a desk are the use, so the split is the primary layout. Three rules keep the
reading column its own:
- **The map opens where there is room.** It opens by default only at 1440px
  and wider; below that it starts folded to its rail, and the reader's own
  choice is remembered (`focusparse:map`). Open beside the 55% panel it left the
  column 233px at 1024 wide.
- **Below 768px it is one pane at a time.** Reader or Notes, switched from a
  48px bar at the bottom, both kept mounted so a half-typed note survives. The
  map opens *over* the reader. The top bar drops the wordmark text and the word
  counter, and folds views, anchors, presence and noise behind "Options". The
  key strip is not shown on touch.
- **Scrolling containers centre with `my-auto` or `min-h-full`, never a pinned
  `justify-center`.** The home, the three checks and the Notes empty state all
  clipped their own tops once.
The lane graph keeps its deliberate 124px lane floor, below which it scrolls
rather than squeezing.

## Elevation & Depth

Flat today, with depth from **tone and hairlines**: Ink surfaces, Graphite
borders, Graphite-tinted inset panels. Shadows exist only on things that float
over the work, and the user has left the question **open**: flatness is current
practice, not a rule. Layering may be introduced if it serves the
calm-but-unmistakable direction.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)`):
  the presence pill, the missed-check toast and modal dialogs.
- **Rest** (`box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05)`): two incidental uses.
  Effectively invisible on Ink.
- **Veil**: modal overlays are black at 80% with a 4px backdrop blur. The
  presence pill sits on Ink at 95% with a backdrop blur.

### Named Rules
**The Interruption Floats Rule (current practice).** Anything that floats over
the reading is something the reader must deal with now. Nothing decorative
floats. Keep this pairing if layering is introduced, so elevation keeps its
meaning.

## Shapes

Gently rounded and mostly rectangular, with a base radius of 8px (`--radius:
0.5rem`). Panels, rows and dropzones use 8px; buttons, inputs, badges and inset
panels use 6px; key hints and micro-chips use 4px; pills and the scrollbar thumb
are fully round.

Two shapes are deliberate exceptions and carry meaning:
- **The block caret is square.** The active word in caret mode loses its 3px
  rounding and its colour transition, and snaps between words instantly. The
  hard edge and the instant move *are* the rhythm; a soft fade would blur it.
- **Dashed borders mean "not yet"**: the empty dropzone (including the
  first-run home's "read your own" panel), the "next section worth your time"
  card, the intercept's anchors panel and its one-time rule note, the
  scratchpad's worked-example capture (shown until the reader has one, never
  stored), SQL and preformatted blocks shown as raw material, and the sentence
  gauge's marks. Solid borders mean settled structure.

Borders are 1px Graphite throughout. Acronym badges draw a 1px border in their
own text colour (`currentColor`).

## Components

### Buttons
Calm controls today, meant to become unmistakable.
- **Shape:** gently rounded (6px). The default height is 40px; the top bar uses
  32px variants.
- **Primary:** a Paper fill with Primary Ink text, 8px × 16px. It is reserved for
  the one action that moves things forward (Play/Pause, Parse document, submit a
  summary).
- **Outline:** an Ink fill with a Graphite stroke; on hover it fills with Graphite.
- **Ghost:** no fill at rest, a Graphite fill on hover. Used for icon controls
  (previous/next sentence) and dense toolbars.
- **Focus:** a 2px Focus Ring offset by 2px on keyboard focus only. Disabled
  controls drop to 50% opacity and ignore the pointer.

### Segmented Toggles
The view switch (Standard / Bionic / RSVP) and the anchor toggles (block caret,
syllabic pulse, clause spotlight, acronym badges) sit as a row of buttons inside
one 1px bordered, 6px-rounded group with 2px of inner padding. The selected
segment fills with Graphite. The List/Graph toggle exposes `aria-pressed`.

### Chips and Badges
- **Capture tags:** solid category fills (Entity Sky, Mechanism Violet, Output
  Green) with their dark `-ink` text, plus a tiny icon. Commands render as chips
  (`/e`, `/m`, `/o`) in the scratchpad header.
- **Acronym badges:** outlined in `currentColor`, 0.82em, semibold, uppercase,
  tracked. Their colour follows the acronym's category.
- **Status chips** in the structure map (SKIPPED, INTERCEPT, LOGGED, tier badges)
  are Graphite-filled, uppercase and tracked, at 12px.

### Inputs / Fields
- **Style:** an Ink fill, a 1px Graphite stroke, 6px radius, 40px tall. Text
  areas grow (the scratchpad, the paste box, the intercept summary at
  `min-height: 120px`, base size, relaxed leading).
- **Focus:** the same 2px Focus Ring with a 2px offset.
- **Placeholders** are Pewter and carry real instructions ("Type the idea, then
  /e, /m or /o to commit it — or /p to park it…").

### Rows and Panels
Home-screen entries (Corpus index, Mock exam, Blueprint coverage…) are
full-width buttons: 1px border, 8px radius, 12px × 16px padding, a 16px Pewter
icon, a Body title over a Pewter caption, and a right-aligned count. On hover
they fill with Graphite at 60%. The one recommended entry gets a Paper-tinted
border (40%) and fill (5%).

### Keyboard Hints
A `kbd` in mono: a Graphite fill, a 1px border and a 4px radius, beside a Pewter
label. They are pinned in a strip under the reader and repeated inside the
presence pill. Every transport and check action has one.

### The Caret and Its Anchors (signature)
The word being spoken is the brightest thing on screen:
- **Highlight (default):** Signal Amber at 28% with a 2px amber underline.
- **Block caret:** a solid amber block, square-cornered, Ink text at weight 500,
  with no transition.
- **Syllabic pulse:** the active word scales to 1.1 and back. The duration is
  set from the measured pace, so the beat follows the voice. It is switched off
  under `prefers-reduced-motion`.
- **Clause spotlight:** everything outside the live clause drops to Pewter at
  28%, so only the clause being spoken is bright.
- **Bionic:** the leading ~45% of each word is bold Paper.

### The Intercept (signature)
A full-screen, non-dismissible page with no close button, no Escape and no
outside-click. There is no label above the question: an amber shield hangs
beside the 1.5rem question title, and the chapter follows below it in sentence
case ("In …"). A large summary box comes next, with quiet secondary affordances
in a row beneath it: dictation, "Stuck?" anchors, and show/hide your captures.
Until the reader has answered one in this browser, the intercept adds one
dashed note stating the rule once, together with the way out. The reader's own
captures stay hidden behind a toggle so recall comes first. The primary ("Log
it and resume") is never greyed out: pressed too early, the word count beneath
the box says what is missing. The only exit is a muted ghost, "Come back to
this later", which pauses at the start of the section being asked about, so
coming back means hearing it again and meeting the same check.

### The Presence Pill (signature)
A fully rounded pill fixed 24px from the bottom-right corner. It is outlined and
lettered in Signal Amber over Ink at 95% with a backdrop blur, with a hand icon,
"Still there?" and the `V` key. It enters with the 160ms node-in ease. If the
check is missed it becomes a rectangular, Oxblood-bordered toast with a single
action.

### Flow Nodes and the Lane Graph
Captures render as cards with a 1px border and 6px radius, a category chip, the
section they came from (a link that seeks), and the text at 0.875rem. Actions
appear on hover or focus-within. In the Graph view, nodes sit in three labelled
lanes (ENTITY, MECHANISM, OUTPUT), joined by edges coloured by the source's
category. The open chain's head is outlined in Paper.

### The Sentence Gauge
The distance to the next spot check is drawn as a row of dashed marks that empty
as sentences finish, beside the same figure in words. It is a shape that only
moves at sentence ends, never a clock.

## Do's and Don'ts

### Do:
- **Do** keep Signal Amber for the reading position and for demands on the
  reader (the Signal Rule).
- **Do** set prose being read in the serif at 17px / 1.85, capped at 62ch, and
  everything the app says in the system sans (the Two Voices Rule).
- **Do** make interruptions full-screen or floating, and keep calm surfaces flat.
  If you add layering, elevation must still mean "this needs you".
- **Do** use a dashed border for empty, optional or unverified states, and a
  solid one for settled structure.
- **Do** give every reading and check action a visible key hint, and keep the
  2px offset Focus Ring on every focusable control.
- **Do** honour `prefers-reduced-motion`: any motion tied to the caret must have
  a still fallback.
- **Do** show estimates as estimates ("est.", struck-through unreachable
  targets). Visual honesty is part of the system.
- **Do** set new UI text at 12px or above, with hit targets that a tired or
  dyslexic reader cannot miss (the 12px Floor).
- **Do** design both themes properly. Light is meant to be first-class and needs
  its own decisions, not an automatic inversion.

### Don't:
- **Don't** use Alarm Oxblood as text on Ink (1.86:1). Use `text-alarm`, a red that clears
  4.5:1.
- **Don't** put a ticking clock or countdown in the field of view. Distances
  move only when a sentence ends.
- **Don't** let the display change itself on a guess about attention (adaptive
  contrast boosting was refused because nothing can verify it).
- **Don't** soften the caret: no rounding or transition on the block caret, and
  no easing between words.
- **Don't** widen the reading measure to fill a pane, or set reading text in the
  UI sans.
- **Don't** ship the light tokens as they stand. Signal Amber Light measures
  1.57:1 on white and Entity Sky 2.86:1, so neither can be text in a light theme.
- **Don't** centre content vertically with `justify-center` inside a scrolling
  container. It clips what overflows above and makes controls unreachable.
- **Don't** let anything purely decorative float over the reading pane.

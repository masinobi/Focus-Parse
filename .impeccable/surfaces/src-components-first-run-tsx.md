---
version: 1
slug: "src-components-first-run-tsx"
primary_target: "src/components/first-run.tsx"
related_targets: ["src/components/document-loader.tsx"]
---

## Scope

First-run home (empty library: no documents, no reviews due, no papers sat) and the first session through the first intercept. Visitor mode: Operate. The returning-reader home is out of scope and unchanged.

## Audience and job

A stranger from the README/demo link, or an attention-challenged reader holding a document they dread. Success: they hear the voice, watch the caret, and meet the first check.

## Constraints

Exam date, export and every exam-prep entry stay hidden until a document exists; restoring a backup stays reachable through one quiet link. Checks keep their strictness. No autoplay, no ticking clock, no jargon ("ingestion", "re-encoding") on the home. Code-led build (no image generation).

## Direction contract

THESIS: The home is the mechanism, not a description of it: the sample's real opening with the caret on the first word the voice will say, and Play beneath. Refuses the category default of a pitch paragraph over a dropzone and a feature list.

OWN-WORLD: DESIGN.md unchanged. Ink ground, sans heading over reading serif at large size, Signal Amber block caret, Paper primary button, dashed "not yet" panel for the reader's own document.

STORY: The visitor reads one real sentence, learns in one plain line that the app reads aloud and stops to ask, sees how far away the first check is, presses Play or Space, and the same lines become the reader's first lines as speech starts. About twenty seconds later the first check arrives and says its rule once.

FIRST VIEWPORT: Single column ~42rem, left-aligned, vertically centred. Small wordmark; the sample heading (sans, 1.5rem) with the amber caret on its first word; the first two sentences in the reading serif at ~1.4 to 1.9rem; one plain line; Play the sample (Paper, 48px) with "First check in about N seconds" and a Space key hint; below, a dashed row: "Or read your own" with Choose a file and Paste text. The whole page accepts a drop.

FORM: "Hear it before you choose", position 5 of 6 on the ordered list (the dealt lead). Signature interaction: a view transition carries the heading and sentence into the reader's first two blocks; reduced motion cuts. Seed key 47d02e44.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## First session (confirmed in the brief)

The scratchpad's empty state shows one worked example capture (dashed, never stored) until the reader makes their own. The first intercept a browser shows adds one note stating the rule, once. The intercept carries no label above its question.

## Decided after the build

- Exam date and export stay hidden on a first visit, but a quiet "Used FocusParse before? Restore from a backup" link sits under the dashed row; a restore that brings a library ends the first run.
- The scratchpad pane is titled "Notes" (was "Re-encoding").
- The plain line is the user's wording: "FocusParse reads a document aloud and keeps your place word by word. It stops at the end of each section to ask what you just heard."

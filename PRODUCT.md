# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: readers who struggle to stay with dense text.** People whose attention
slides off long, technical documents (ADHD and similar) and who need the reading
itself to hold them, not just a nicer page. They bring their own PDFs, markdown or
plain text, usually something they are obliged to absorb rather than choose to.
Their job is to get through the material *and keep it*: hear it, follow it, be
made to restate it, and have it come back before it fades.

**Exam preparation is one use among several, not the definition of the product.**
The app was built by its author (Michelle Asinobi) to read the 524-page GCDMP for
the SCDM CCDA exam, and that corpus remains the proving ground for every parsing
and pacing decision. Future work should serve the general attention-challenged
reader first; certification candidates are an important subset of them.

## Product Purpose

FocusParse paces a document with speech synthesis, locks a word-level highlight to
the audio, and refuses to let the reader coast past a section boundary without
restating what they just heard. It exists because passive reading of dense
material fails silently: the eyes keep moving after comprehension has stopped.

Success means a reader finishes a document they would otherwise have abandoned or
skimmed, and can show (through summaries, checks and later retrieval) that the
material landed, rather than merely that the caret reached the end.

## Positioning

Most readers and text-to-speech tools *assume* the reader is present. FocusParse
*verifies* it. The enforcement ladder (section-boundary intercepts demanding a
one-sentence summary, cloze spot checks, grid interrogation on leaving a table,
and a jittered presence check that stops the audio when nobody answers) turns
reading into evidence, and that evidence feeds a spaced-retrieval queue and a
coverage map that reports what was *verified*, not how far the caret got.

It is also local by construction: no account, no server, no upload. Documents,
notes and schedules live in the reader's own browser.

## Operating Context

- **Long, solitary study sessions** on a laptop or desktop, often with headphones,
  over documents of hundreds of pages. Sessions are interrupted and resumed;
  "coming back" after time away is a designed path, not an edge case.
- **Eyes and ears at once.** The audio runs while the reader watches the caret,
  types captures into the scratchpad without stopping playback, and answers checks.
  Keyboard-first: transport, speed, check answers and scratchpad tags all have keys.
- **The reader's own documents**: regulatory guidance, standards, study guides,
  their own notes and drill sheets, and `.sql` scripts. Quality of ingestion from
  real PDFs is part of the experience.
- **Browser speech is the voice.** Voices come from the visitor's machine and
  browser, so the app sounds different on every computer. Chrome and Edge are the
  reference targets (Edge has the best Windows voices); Firefox works; Safari falls
  back to an estimated caret.
- **Two public surfaces**: the app itself (focus-parse.vercel.app, deployed with no
  API key) and a self-contained guided demo (`demo/index.html`, GitHub Pages) that
  drives the browser's synthesizer through a fixed passage with every check
  triggerable by hand.

## Capabilities and Constraints

**Confirmed capabilities** (full inventory in `README.md` and `docs/`):
dual-channel pacing at a words-per-minute target with Standard, Bionic and RSVP
views; click-to-seek; kinetic visual anchors (block caret, syllabic pulse, clause
spotlight); brown-noise masking; a kinetic scratchpad (`/e` `/m` `/o` tags for
Entity / Mechanism / Output nodes, `/p` to park an off-topic thought, chains and a
lane graph); a pre-scan structure map with time estimates, coverage and search;
the enforcement ladder; spaced retrieval with an optional exam date that caps
intervals; mock exams, exam history and an acronym drill; blueprint coverage and
tier badges; a T-SQL stepper; summary dictation; optional AI grading of a summary
("Check my recall", Gemini or Anthropic key, absent on the public deployment);
JSON export and merge-import.

**Hard constraints:**
- No account, no backend storage, no network dependency for reading. Everything
  persists in IndexedDB / `localStorage` in the reader's browser.
- The public deployment runs with no API key; any key-dependent UI must disappear
  cleanly when the grading route reports itself unconfigured.
- `SpeechSynthesis` exposes no audio stream: nothing can sync to audio *volume*,
  and the speech path cannot be browser-probed (headless Chromium has zero voices).
- Transport keys go inert while typing and while a check is open.
- Reading should be done on a production build; the dev build costs two to three
  times as much on a long document.

**Terminology in use:** intercept, spot check (cloze), grid check / grid
interrogation, presence check, enforcement ladder, structure map, scratchpad,
capture, chain, lanes, park, coverage, verified, blueprint, tier (minimum standard /
best practice), caret, clause spotlight, syllabic pulse, re-entry ("coming back"),
sentence gauge.

**Decided direction, not yet built:**
- **Exam-prep features generalise.** Blueprint gaps, tier badges, mock exams and
  the exam date are currently CCDA/GCDMP-specific (the blueprint is transcribed
  from SCDM's study guide). Future work should make them work for any
  certification or outline rather than hard-coding one.
- **Strictness becomes tunable.** Enforcement stays strict by default, but readers
  may eventually tune check frequency or intensity. Today intercepts are
  non-dismissible (no Escape, no outside-click, no close) and that is the default
  to preserve.

**Open:** how a general (non-exam) reader first meets the exam-prep layer; what
the tunable strictness controls are and what their floor is.

## Brand Commitments

- Name: **FocusParse**. Author: Michelle Asinobi (GitHub `masinobi`). MIT licence.
- No logo or mark exists in the repository.
- The docs' voice (plain, exact, candid about limits, no hype) is the incumbent
  voice but is **not binding** on future UI copy; the user left it open to change.

## Evidence on Hand

- `docs/media/reading.gif`: a real recording (Edge, bundled sample) of the caret
  tracking speech and an intercept firing at a section boundary.
- `demo/index.html`: the self-contained guided demo.
- `src/lib/sample.ts`: a sample document written to be read in the app.
- `docs/`: long design notes with real measurements, including ones that turned
  out wrong (`docs/engineering-log.md`).
- `src/lib/blueprint.ts`: the CCDA blueprint transcribed from SCDM's published
  study guide.

**Absent, and not to be fabricated:** user testimonials, user counts or adoption
figures, outcome or efficacy claims (exam pass rates, retention gains), press, or
any corpus documents (the guidelines it was built against are published elsewhere
and not redistributable).

## Product Principles

1. **Presence is verified, not assumed.** Every feature should either hold
   attention or produce evidence that it was held. A display that reports progress
   without verification is the failure this product exists to fix.
2. **Strict by default, kind in manner.** Checks are hard to dismiss because
   coasting is the failure mode; they may become tunable, but should never become
   accusatory. Coming back after time away is met with a replay, not a penalty.
3. **Never break the flow to capture.** Recording a thought, tagging it or parking
   it must not require stopping the audio or reaching for the mouse.
4. **Honest accounting.** Report what is true and say what cannot be known: an
   estimated speed says "est.", an unmatched chapter is not guessed at, a wrong
   match is worse than none.
5. **The reader's material stays theirs.** Local, accountless and private by
   construction; nothing optional (like AI grading) may become a dependency.

## Accessibility & Inclusion

Hard requirements for future UI work:

- **ADHD / sustained attention.** Minimise distraction and ambient motion outside
  the reading focus; motion that exists must serve the caret or a check. Interruption
  and resumption are first-class. `prefers-reduced-motion` is already honoured and
  must stay honoured.
- **Dyslexia / reading load.** Typography, line length, spacing and the Bionic and
  RSVP views are accessibility features, not style choices, and should be judged on
  legibility and decoding load first.
- Keyboard operation of every reading and check path is established and must be
  preserved.

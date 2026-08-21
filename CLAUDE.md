# FocusParse — working notes

Context for picking this project up cold. The README documents *what* the app
does and why each algorithm is shaped the way it is; this file covers the things
that are not in the code: environment traps, invariants that are easy to break,
how work has been verified, and what is still outstanding.

## What it is

A reading tool for studying dense clinical-data-management PDFs. It paces a
document with speech synthesis, locks a word-level highlight to the audio, and
refuses to let the reader coast past a section boundary without restating what
they just heard.

The user (Michelle, GitHub `masinobi`) is studying for the **SCDM CCDA exam**.
Source material lives in `<home>\OneDrive\Desktop\CCDA Study` — nine
PDFs of GCDMP guidance, ICH E6(R3), and the SCDM exam study guide, plus one
markdown study guide. That corpus is the ground truth for every parsing
decision; test against it rather than against invented samples.

## Where things are

| | |
|---|---|
| Project | `<project folder>` |
| Remote | https://github.com/masinobi/Focus-Parse (**private**) |
| Stack | Next.js 14 App Router · TypeScript · Tailwind · shadcn/ui · Zustand · IndexedDB · Web Speech · Web Audio · pdf.js |

## Environment traps

These have each cost real time. Read before running anything.

**Node is not on PATH.** It lives at `C:\Program Files\nodejs`. Prepend it:

```bash
$env:PATH = "$env:ProgramFiles\nodejs;$env:PATH"
```

GitHub CLI is the same story — `C:\Program Files\GitHub CLI`. `gh auth` is
already configured for `masinobi` with `repo` scope, so pushes work.

**Never run `npm run build` while the dev server is running.** The production
build overwrites `.next` underneath the dev server and every chunk starts
500ing — the app renders as unstyled HTML. Stop the server, `rm -rf .next`,
build, then restart. This broke the app once and looked like a code bug.

**Delete `.next` before `npm run dev` after any production build.** Dev mode
tries to clear stale production output and dies with `EINVAL: readlink` on
Windows. Symptom: `next dev` exits 0 immediately at startup.

**The project was moved out of OneDrive for exactly this reason.** Do not move
it back. An earlier move also silently dropped every top-level file (configs,
`package.json`, `.git/HEAD`) while keeping subdirectories — recovery was a fresh
clone. If files go missing, clone from the remote rather than repairing.

**First request after a dev restart takes 30–60s** while Next compiles the
route. Not a hang.

## Invariants that are easy to break

These are load-bearing and not obvious from reading a single file.

**1. Speech offsets, not display offsets.** Displayed text and spoken text are
*different strings*. Acronyms expand for the ear (`eCRF` → "electronic case
report form"), evidence grades are silent. Every token carries both `offset`
(display) and `speechOffset` (utterance), and `tokenAtCharIndex` searches
`speechOffset`, because that is the coordinate space `onboundary` reports. Break
this and word-level sync silently desyncs on any document containing an acronym.

**2. `seekNonce` vs `advanceToken`.** The speech engine restarts its utterance
when `seekNonce` changes. *Deliberate* position changes bump it; the engine's own
per-word `advanceToken` does not. If `advanceToken` ever bumps the nonce, every
spoken word restarts the audio.

**3. A silent token contributes no separator.** Its `speechOffset` therefore
coincides with the next token's, the boundary search resolves forward, and the
caret steps over it. That is intentional — dwelling on an unvoiced word is how
sync drifts.

**4. Grid glyphs must leave the prose stream.** A detected table is removed from
the line assembly *and* spliced back as an `fp-grid` fence. If both happen, the
same content is flattened into cards and linearized into the unreadable run the
flattener exists to replace.

**5. `source` is a complete record.** Everything rides through the markdown
intermediate rather than a side channel, so `db.getDoc` can rebuild a document
with the current parser when `schema` is stale. Schema is currently **3**; bump
`SCHEMA_VERSION` in `src/lib/parse.ts` whenever the Token/Chunk shape changes, or
old stored documents crash playback with missing fields.

## How to verify work here

Unit tests would not have caught most of the real bugs in this project. What has
worked:

**Drive the running app through browser JS.** Synthesize a file drop with
`DataTransfer` on the dropzone, then poll the DOM. Instrument
`SpeechSynthesisUtterance` to capture what is actually spoken, and `AudioContext`
to inspect the audio graph. Measure — don't eyeball.

**Scan the real corpus.** `node scripts/scan-tables.mjs "<folder>" --verbose`
compiles `src/lib/tables.ts` and runs that same module over every PDF, so the
report and the app cannot drift. Every threshold in `pdf.ts` and `tables.ts` came
from measuring this corpus.

**Read back from IndexedDB** to check what was actually stored, rather than
trusting the rendered view.

Bugs found *only* by scanning real output, never by tests: the glued-citation
rule eating three digits out of DOIs (`journal.pone.0083049` → `pone.3049`); a
26-row grid reported as fragments of 6 and 10 with a data row as the header; an
evidence grade fused as `patient.[III]` that an anchored pattern missed.

## Feature inventory

Dual-channel pacing (1.0–3.0x, Standard/Bionic/RSVP) · kinetic scratchpad with
`/e` `/m` `/o` tags · cognitive intercepts at section boundaries · pacing
checkpoints every 700 words so intercepts never depend on heading recovery ·
pre-scan structure map · PDF ingestion with column/heading/furniture recovery ·
citation and superscript stripping · acronym badges (~60 CDM terms, five
categories) · kinetic visual anchors (block caret, syllabic pulse, clause
spotlight) · brown-noise masking · document renaming · optional AI summary
grading · grid detection and the matrix flattener.

**AI grading** is optional and provider-agnostic: `GEMINI_API_KEY` or
`ANTHROPIC_API_KEY` in `.env.local` (Gemini wins if both). The Gemini path is
verified end to end; the Claude path typechecks but has never run. Model is
`gemini-3.6-flash` — note `models.list` still advertises `gemini-2.5-flash` but
the endpoint rejects it for new keys. **Restart the dev server after changing
`.env.local`**; Next only reads it at startup.

## Outstanding

**T-SQL logical stepper** — the last item from the user's feature list. Code
blocks are currently never spoken by design; this would reverse that for SQL:
split on clauses (SELECT/FROM/WHERE/JOIN/OVER), one chunk per logical step, with
hard pauses between. Worth flagging that the CCDA corpus contains **no SQL**, so
this is the lowest-value item for the exam they are actually studying for.

**Known rough edges**

- Acronym expansion inside grid steps reads clumsily: "CRF Creation" becomes
  "case report form Creation". Could suppress expansion inside steps.
- The matrix flattener was verified on the vendor-management PDF (2 grids, 24
  steps). The 524-page GCDMP holds most of the 22 detected grids and has not had
  a full in-browser pass.
- PDF front matter (author lists, affiliations) sometimes survives as a section
  in the structure map.
- Scanned PDFs with no text layer are rejected rather than OCR'd.

**Corpus finding worth remembering:** there is **no Schedule of Assessments grid
anywhere in the user's PDFs** — the phrase appears seven times but always as
prose. The flattener was therefore generalized to any detected grid (22 real
ones: RACI matrices, costing tables, metrics tables) rather than built for
schedules specifically. Don't rebuild it schedule-first without new source
material.

## Working style that has fit this user

Ship complete, verified work and report honestly — including what was *not*
done and why. When a spec cannot be met as written, say so plainly rather than
approximating silently: pulse cannot sync to audio *volume* because
`SpeechSynthesis` exposes no audio stream, and that was worth stating outright.
Prefer measuring the real corpus over adding heuristics on a hunch.

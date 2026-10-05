# CLAUDE.md

The working notes are [docs/engineering-log.md](docs/engineering-log.md), and
they are imported below, so they load whether or not you go looking. **Read them
before changing anything** — they carry the invariants, the traps that have
already cost a round, and the measurements that turned out to be wrong.

This file is the orientation: what is true right now, and what has bitten
people who assumed otherwise.

## Where things are

| | |
|---|---|
| Repo | https://github.com/masinobi/Focus-Parse — **public** since 13 Sep 2026, MIT |
| App | https://focus-parse.vercel.app — rebuilt from `main` on every push, no API key set |
| Demo | https://masinobi.github.io/Focus-Parse/ — `demo/index.html`, deployed when `demo/` changes |
| Front page | `README.md`, with the depth in `docs/` |
| Product | `PRODUCT.md` — who it is for (readers whose attention slides off dense text; exam prep is one use among several), what is decided but unbuilt, and the hard accessibility needs |
| Design system | `DESIGN.md`, with `.impeccable/design.json` beside it — the visual system as shipped. Read it before any UI change |
| Surface briefs | `.impeccable/surfaces/` — the plan a surface was built to. The first-run home has one |

## Before the first commit of a session

- **A push is outward-facing three ways**: public repo, CI, and two
  redeployments. Ask for each batch; one grant does not carry to the next.
- **Never commit a local path.** They were rewritten out of all 98 commits for
  exactly this reason. The scanners take their corpus as an argument — keep it
  that way.
- **`npm run study` to read, `npm run dev` to work.** Never `npm run build`
  while a dev server is running, and delete `.next` before `npm run dev` after
  a production build.
- **`main` moves on GitHub too.** The README gets edited in the web UI, and a
  push was rejected for it on 5 Oct 2026. Fetch before branching and before
  pushing; put local commits on top of `origin/main` rather than forcing.
- **Backslashes do not survive a shell heredoc** (`\\` collapses to `\`). Build
  them with `chr(92)` / `String.fromCharCode(92)`, or write the edit script with
  the Write tool. This has cost a round twice.

## What counts as done here

`npm test`, `npm run typecheck` and `npm run lint` are what CI runs, and they
are not sufficient. The two layers that catch real breakage need things a
runner does not have:

```bash
npm run probe "<corpus folder>"        # a real browser, driven through the app
npm run scan-checks "<corpus folder>"  # one of thirteen scanners over real PDFs
```

**Prove an assertion can fail before trusting it.** In every round that went
looking, assertions turned up that passed against both rules they were written
to separate — and each was found by deliberately breaking the thing it checked,
never by reading it. A green that cannot go red is worse than no check.

**Distrust a clean result as much as a broken one.** When a measurement
surprises you, check the measurement first.

**The speech path has no browser probe and never will** — headless Chromium
enumerates zero voices. That is why the timing policy lives in
`src/lib/speech-timing.ts`, where a unit test can reach the numbers.

## Before changing the interface

- **An empty library is a different home.** No documents, no reviews due and
  no papers sat renders `FirstRun` (`src/components/first-run.tsx`), not the
  full loader: the sample's opening with the caret on it, Play, and a
  restore-from-backup link. The exam date, export and corpus tools are absent
  there by design. Every fresh browser context, so every probe run, starts on
  this page. The probe's file input still works because it selects
  `input[accept*="pdf"]`; anything looking for "Load the sample", "Parse
  document" or the exam date will not find it on a first visit.
- **A document opened from that page is a first session.** The reader holds
  back the view switch, anchors, presence and noise toggles, the measured-pace
  readout and two key hints, and folds the structure map, until the first
  check of any rung is raised (`firstSession` in the store). A script that
  opens its first document from a fresh context and then reaches for any of
  those will not find them: `probe-ui` unfolds the map, `scan-perf` reopens
  its warm-up from the library.
- **Select by hook, never by copy.** The intercept carries
  `data-check="intercept"`. The probe used to match its eyebrow text, which
  was deleted as design copy, and the probe would have gone silently blind.
- **The first-run view transition cannot be seen headless.** Screenshots do
  not capture view-transition pseudo-elements. Check the move from the home
  into the reader in Edge.
- **DESIGN.md records defects as rules, not as precedent.** Red text is
  `text-alarm`; `text-destructive` is the 1.86:1 fill and must not come back as
  text. The 12px floor holds across the reader path; thirteen 10–11px labels
  remain in the library tools. The light-theme tokens are still undesigned. Do
  not copy any of these into new work.
- **The reader lays out three ways.** Below 768px one pane at a time (reader or
  Notes, bottom switch); the map opens by default only at 1440px and wider and
  otherwise remembers the reader's choice (`focusparse:map`). The Browser pane
  only fires `resize`/media-query events when it paints a frame, so after
  resizing it, take a screenshot before measuring or the layout reads stale.
- **`.impeccable/review/`, `questions/`, `critique/` and `hook.cache.json` are gitignored**
  working files. The design sidecar and surface briefs are committed.

@docs/engineering-log.md

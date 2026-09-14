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

## Before the first commit of a session

- **A push is outward-facing three ways**: public repo, CI, and two
  redeployments. Ask for each batch; one grant does not carry to the next.
- **Never commit a local path.** They were rewritten out of all 98 commits for
  exactly this reason. The scanners take their corpus as an argument — keep it
  that way.
- **`npm run study` to read, `npm run dev` to work.** Never `npm run build`
  while a dev server is running, and delete `.next` before `npm run dev` after
  a production build.
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

@docs/engineering-log.md

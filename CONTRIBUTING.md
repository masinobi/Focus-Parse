# Contributing

This started as one person's tool for passing one exam, and it is shaped by
that. Issues and pull requests are welcome; what follows is how the project
decides whether a change is finished, because it is not the usual list.

## Before anything

Read [docs/engineering-log.md](docs/engineering-log.md). It carries the
invariants, the traps that have already cost a round of work, and — more useful
than either — the measurements that turned out to be wrong. Most of the rules
below exist because something plausible was believed for a while.

## Running the checks

```bash
npm test             # 477 unit tests
npm run typecheck
npm run lint
```

CI runs exactly these three. Two further layers do not run there and are the
ones that catch real breakage:

```bash
npx playwright install chromium
npm run probe "<corpus folder>"        # drives a real browser through the app
npm run scan-checks "<corpus folder>"  # and twelve more scanners; see the README
```

The scanners compile the same modules the app imports and run them over real
documents. **A parser that is green on fixtures and wrong on a real PDF is the
failure mode this project exists to avoid**, so a change to parsing, coverage,
checks or the blueprint should be accompanied by the output of the relevant
scanner before and after.

No corpus ships with the repository — the documents it was built against are
published guidance that is not mine to redistribute. Any folder of PDFs,
markdown or text will do; the scanners print what they found, and the lines
marked `(must be 0)` are the ones that matter.

## What a finished change looks like

- **Prove an assertion can fail before trusting it.** If you add a check, break
  the thing it checks and watch it go red. A green that cannot go red is worse
  than no check, and this project has shipped six of them and had to delete
  them later.
- **Distrust a clean result as much as a broken one.** When a measurement
  surprises you, check the measurement first.
- **Small commits, and the message records *why*.** The diff already says what.
- **Report honestly, including what was not done.** A pull request that says
  which part it left unfinished and why is more useful than one that implies
  it did everything.

## Things that are deliberate, not oversights

- **A name is matched exactly, or from a listed set, or not at all.** There is
  no fuzzy matching or similarity scoring anywhere a document, chapter or voice
  is identified. A confident wrong match is worse than no match — it reports
  coverage the reader does not have.
- **A tier is read off the heading, never inferred from the prose.** The modal
  verb rule that looks right is backwards on this corpus, and
  [docs/exam-prep.md](docs/exam-prep.md) shows the counts.
- **The speech engine has no browser probe.** Headless Chromium enumerates zero
  voices, on every platform tried. Speech timing policy lives in
  `src/lib/speech-timing.ts` specifically so that unit tests can reach the
  numbers a browser test cannot.
- **Nothing leaves the machine.** Documents, notes and review schedules live in
  the reader's own IndexedDB. The one optional network call is summary grading,
  behind an API key the reader supplies.

# Security

## Reporting a vulnerability

Open a [private security advisory](https://github.com/masinobi/Focus-Parse/security/advisories/new).
Please do not open a public issue for anything exploitable.

This is a small project maintained by one person, so expect a reply in days
rather than hours.

## What this app handles

Worth knowing before you look for a vulnerability, because it narrows the
surface considerably:

- **There is no server and no account.** FocusParse is a Next.js app that runs
  locally. Documents, notes, summaries and review schedules are stored in the
  browser's own IndexedDB and never leave the machine.
- **There is one outbound call, and it is optional.** If — and only if — a
  `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` is present in `.env.local`, the
  *Check my recall* button sends the section text and the reader's written
  summary to that provider for grading. With no key the button never appears —
  the dialog asks the local server whether a provider is configured and hides
  the feature when it is not — and nothing leaves the machine.
- **The key is read server-side.** It is used in a route handler and is never
  exposed to the browser. `.env` and `.env*.local` are gitignored; a scan of
  every blob in the repository's history found no key ever committed.
- **Uploaded documents are parsed in the browser** by pdf.js. A malicious PDF is
  a plausible attack surface and is the first place worth looking.

## What is out of scope

- The absence of authentication. There is nothing to authenticate to.
- Data being readable by anyone with access to the machine and browser profile.
  That is what local-first means here, and it is stated in the README.
- Anything requiring the attacker to already have the reader's API key.

# State, persistence and backup

One Zustand store, five IndexedDB stores, and one JSON file that is the
only thing standing between weeks of scheduling and a cleared browser.

## State

One Zustand store ([src/store/useFocusStore.ts](../src/store/useFocusStore.ts)). The one
non-obvious piece is `seekNonce`: the engine restarts its utterance when it changes,
so *deliberate* position changes bump it while the engine's own per-word
`advanceToken` does not — otherwise every spoken word would restart the audio.

WPM is measured, not assumed. Boundary events feed a rolling word/time sample (gaps
over 1.5 s are discarded as stalls) that drives the sidebar's per-section time
estimates once ~25 words have been read.

## Persistence

IndexedDB ([src/lib/db.ts](../src/lib/db.ts)), five stores: `documents` (parsed document
plus its source), `sessions` (reading position, flow nodes and their links,
summaries, which grids have been answered, and what each spot check established)
written debounced at 700 ms, `reviews` (the spaced-retrieval queue), `entities` (one
compact index per document) and `exams` (one record per mock paper sat). Every write is
best-effort — a browser in private mode loses persistence, not the reading session.

`entities` is derived data, kept only so the corpus view does not have to load nine
parsed documents — several hundred thousand tokens — to answer "where else does this
come up?". It arrived in database version 3, is rebuilt when a document's word count or
the extraction schema changes, and is deleted with its document, since nothing can
rebuild it once the source is gone. A rename updates it without re-walking the tokens.

`reviews` spans every document rather than belonging to one, and is indexed by `dueAt`
so the loader can ask what is owed without reading the whole queue, and by `docId` so
forgetting a document does not leave its questions behind. It arrived in database
version 2; the upgrade adds the store and leaves `documents` and `sessions` untouched.

`exams` arrived in database version 4, indexed by `at` so the home screen can ask for
the last few papers without reading every one ever sat. Unlike `reviews` and `entities`
it is deliberately **not** deleted with a document: those are questions about a
document and cannot outlive it, while a paper is a fact about the reader on a date, and
forgetting one guideline afterwards does not make it untrue. Each breakdown row keeps
the title it was sat under, so it still reads.

A version bump has one sharp edge worth knowing: a second tab already holding the
database blocks the upgrade, and a blocked `open()` neither resolves nor rejects — so
the best-effort wrapper cannot catch it and every call simply waits. Close other tabs
after an upgrade.

**Schema versioning.** A stored document is a snapshot of whatever the parser emitted
that day, and the token/chunk model changes as features land. Each document carries a
`schema` number; on read, a document whose version does not match the parser's is
rebuilt from its stored `source` and written back. Keeping the original source is what
makes that lossless — for PDFs the source is the extracted markdown, so migration does
not need the original file. The engine additionally falls back to display text when a
chunk has no speech string, so a stale shape degrades to reading without acronym
expansion rather than failing to play.

Some things are deliberately **not** in IndexedDB. The chosen voice and the reading
speed live in `localStorage`, along with what each voice has been measured to deliver
at each rate: none of it belongs to a document, and all of it is a property of the
voices this particular machine happens to have installed. The exam date is there for
the same reason — it belongs to the reader, not to anything they are reading — with the
consequence that a backup does not carry it.

And `sessions` carries no `schema` number of its own, which is a constraint rather
than an oversight — there is no migration path, so every field added to a session since
must read as `undefined` on the sessions already on disk. Node links, grid results and
spot-check results all arrived this way, and every consumer treats absent as empty.

## Backup

Everything this app produces — every summary written at an intercept, every captured
node, every review interval earned over weeks — lives in one browser's IndexedDB.
Clearing site data, resetting a browser or moving machines loses all of it, silently and
with no recovery. Export writes it to one JSON file and import merges it back
([src/lib/backup.ts](../src/lib/backup.ts)).

**Documents are exported as their source, not as parsed documents.** That leans on an
invariant the app already depends on: `source` is a complete record, which is what
`db.getDoc` rebuilds from when the schema moves. Measured on a real database — 40,000
words across three documents — source-only is 263KB against 5.6MB for the parsed form,
21× smaller, and it cannot carry a stale token shape into a future parser. The entity
index is left out for the same reason: derived, and rebuilt on demand.

**Papers are carried too, at format 2.** A version-1 file simply has no such key, so it
reads as absent rather than malformed — it is still a complete backup of everything that
existed when it was taken, and refusing it would be the worst possible way to handle a
format bump. Papers need no newer-wins contest either: a marked paper never changes, so
a record already present is the same record.

**Import merges and never deletes.** Where both sides hold a record, the one touched last
wins. Restoring a three-week-old backup onto a machine that has been read on since must
not rewind that reading — an older review item carries an older interval, and applying it
would quietly undo weeks of scheduling. Validation is per-record rather than
all-or-nothing, so a file that is 99% good restores the 99% and reports the rest as
skipped instead of discarding a whole backup over one bad row.

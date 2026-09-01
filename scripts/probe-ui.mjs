/**
 * Browser probe.
 *
 * This project's real bugs are found by driving the running app, not by reading
 * it — but every previous round did that by hand, through whichever browser
 * tooling was to hand, and that tooling lies. A screenshot of a tab whose
 * `visibilityState` is `hidden` can return a *stale partial paint* that looks
 * like a layout bug and is not; a dead dev server presents as a frozen
 * renderer. Both cost real time. Playwright removes the ambiguity: a fresh
 * context, a real paint, and assertions that either hold or do not.
 *
 *   node scripts/probe-ui.mjs "C:/path/to/corpus" [--headed]
 *
 * A dev server must already be running on :3000. Each run gets a brand-new
 * browser context, so it never sees — or touches — the reader's IndexedDB.
 *
 * Three paths are covered, each of which has already shipped a defect:
 *
 *   1. The lane graph must fit the pane it lives in. It once rendered as one
 *      visible lane and a horizontal scrollbar, which every DOM-level check
 *      passed, because nothing in the DOM says "a human cannot see this".
 *   2. The mock exam must run from setup to a marked paper. Its assembler has
 *      twice produced a paper that was quietly wrong rather than broken.
 *   3. The T-SQL stepper must read a query in evaluation order while showing it
 *      as written. Every DOM-level fact about it — the spans exist, the classes
 *      are applied, the counter increments — would be just as true of a stepper
 *      that played the clauses top to bottom, so the assertion has to be that
 *      the highlight moves *backwards* through the text on its own.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const dir = process.argv[2];
const headed = process.argv.includes("--headed");
if (!dir) {
  console.error("usage: node scripts/probe-ui.mjs <corpus folder> [--headed]");
  process.exit(1);
}

const BASE = "http://localhost:3000";

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

/**
 * A dead dev server looks exactly like a hung page, so rule it out first — but
 * a *live* one answers 404 for up to a minute after a restart while Next
 * compiles the route on demand. Wait for a real 200 rather than for any reply.
 */
const READY_TIMEOUT_MS = 180_000;
const startedWaiting = Date.now();
let reachable = false;
while (Date.now() - startedWaiting < READY_TIMEOUT_MS) {
  reachable = await fetch(BASE).then(
    (r) => r.ok,
    () => false
  );
  if (reachable) break;
  await new Promise((r) => setTimeout(r, 2000));
}
if (!reachable) {
  console.error(`No dev server answering on ${BASE}. Start one with \`npm run dev\`.`);
  process.exit(1);
}

const pdfs = readdirSync(dir).filter((f) => /\.pdf$/i.test(f));
if (!pdfs.length) {
  console.error(`No PDFs in ${dir}.`);
  process.exit(1);
}
// The smallest real document: enough acronyms and prose to examine, and the
// least time spent in pdf.js. Chosen by size rather than by name — sorting the
// filenames picked a 3.4MB one and made every run slower for no reason.
const sample = pdfs
  .map((f) => ({ f, size: statSync(join(dir, f)).size }))
  .sort((a, b) => a.size - b.size)[0];

const browser = await chromium.launch({ headless: !headed });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

/**
 * The `.next` cache corrupts often enough to be in the working notes, and its
 * signature is nasty: the server keeps answering 200 for the page while every
 * script chunk 404s, so the HTML renders, React never hydrates, and every
 * interaction silently does nothing. Caught here it is one line; caught by the
 * first `waitFor` it is a two-minute timeout that says "button not visible".
 */
const deadChunks = new Set();
page.on("response", (r) => {
  if (r.status() >= 400 && r.url().includes("/_next/static/")) deadChunks.add(r.url());
});

/** Ingest a real PDF through the app's own file input. */
async function loadDocument() {
  // Not `networkidle`: the workspace polls an API endpoint while it is open, so
  // the network never goes idle and the wait would burn its whole timeout. The
  // retry below is what actually handles hydration.
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  // A cold dev server compiles assets on demand, so the very first request can
  // 404 one versioned file and then succeed on a reload. Only a *repeat*
  // failure is the stale-cache trap; failing on first sight cried wolf.
  if (deadChunks.size) {
    deadChunks.clear();
    await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForTimeout(1500);
  }

  if (deadChunks.size) {
    console.error(
      [
        "",
        `${deadChunks.size} static chunks 404'd twice, so nothing on the page is`,
        "interactive. This is the stale-.next trap: stop the dev server,",
        "delete .next, and start it again.",
        "",
        `  e.g. ${[...deadChunks][0]}`,
      ].join("\n")
    );
    await browser.close();
    process.exit(1);
  }

  /**
   * Retried, because setting the file before React has hydrated drops it
   * silently: the input exists in the server-rendered HTML, so Playwright
   * happily fills it and no handler ever runs. There is no reliable signal for
   * "hydrated" on this page — it renders the same before and after — so the
   * honest fix is to set the file and check whether the app reacted.
   */
  // `exact` matters more than it looks. Without it the accessible-name match is
  // a substring one, every word of the document is a `role="button"` span for
  // seek-on-click, and any document containing "display" resolves this to nine
  // elements and throws on strict mode. It went unnoticed until the corpus
  // grew and the smallest PDF changed to one that says "display" seven times.
  const playing = page.getByRole("button", { name: "Play", exact: true });
  const working = page.getByText(/Opening PDF|Extracting text|Reading /);
  const input = 'input[type="file"][accept*="pdf"]';

  // Let React attach before the first try. Without this the first attempt is
  // always wasted, and the retry used to be wasted too — see below.
  await page.waitForTimeout(2000);

  for (let attempt = 1; attempt <= 3; attempt++) {
    // Cleared first, because setting the *same* file again is not a change:
    // the input already holds it, no change event fires, and the retry is a
    // silent no-op. That defeated the retry entirely until it was found.
    await page.setInputFiles(input, []);
    await page.setInputFiles(input, join(dir, sample.f));

    // Retry only when the app did not react *at all* — that is the hydration
    // case. Once it is visibly parsing, setting the file again would restart
    // the parse and race two of them, which is how this probe first failed on
    // a 28,000-word guideline.
    const reacted = await playing
      .or(working)
      .first()
      .waitFor({ timeout: 20_000 })
      .then(() => true, () => false);

    if (!reacted) {
      if (attempt === 3) throw new Error(`${sample.f} never reached the app`);
      await page.waitForTimeout(1000);
      continue;
    }

    // Generous: a cold dev server compiles the workspace on this first render,
    // on top of parsing the PDF.
    await playing.waitFor({ timeout: 240_000 });
    return;
  }
}

/** Commit one scratchpad node through the real `/e` `/m` `/o` trigger path. */
async function capture(text, trigger) {
  const pad = page.locator("textarea").first();
  await pad.fill(text);
  await pad.fill(`${text} ${trigger}`);
  await page.waitForTimeout(120);
}

/* ---- 1. The lane graph fits its pane ------------------------------- */

console.log(`\n=== lane graph ===`);
await loadDocument();

await capture("The sponsor keeps accountability", "/e");
await page.locator('button[aria-label="Chain from here"]').first().click();
await capture("Qualification audit before selection", "/m");
await capture("A signed management plan", "/o");
/* ---- Distance to the next stop -------------------------------------- *
 *
 * Checked on a real PDF, because the claim depends on real section structure:
 * a document whose next boundary arms nothing, or arms an intercept into
 * furniture the engine steps over, must not be told a summary is coming.
 *
 * The check that matters is that the figure *moves*. A constant would render
 * identically and satisfy any assertion about the text being present.
 */
const stopLine = () =>
  page.evaluate(() => {
    const m = document.body.innerText.match(/≈([\d,]+)w to a spot check(?:.*?≈([\d,]+)w to a summary)?/);
    return m ? { check: m[1], summary: m[2] ?? null, raw: m[0] } : null;
  });

const stopBefore = await stopLine();
check(
  "the sidebar says how far the next stop is",
  stopBefore !== null,
  stopBefore?.raw ?? "no distance line"
);
check(
  "both rungs are reported, not just the summary",
  Boolean(stopBefore?.check && stopBefore?.summary),
  stopBefore?.raw ?? "—"
);

// Seek forward by clicking a word well down the pane, then read it again.
//
// The *summary* figure is the one asserted on, not the spot check. Seeking
// resets `lastCheckToken` to wherever you landed — jumping over text is not
// reading it, so the cadence window restarts — which means the spot-check
// figure correctly sits at the full interval after any seek. Asserting that it
// moved failed against an app that was behaving properly.
await page.locator("span[data-token]").nth(60).click();
await page.waitForTimeout(400);
const stopAfter = await stopLine();
check(
  "the distance to a summary moves as the caret does",
  Boolean(stopAfter?.summary) && stopAfter.summary !== stopBefore?.summary,
  `${stopBefore?.summary ?? "?"}w then ${stopAfter?.summary ?? "?"}w`
);
check(
  "seeking restarts the cadence window rather than carrying it",
  stopAfter?.check === stopBefore?.check,
  `${stopBefore?.check ?? "?"} then ${stopAfter?.check ?? "?"}`
);

// Scoped by `aria-pressed`: every word in the reader pane is a `role="button"`
// for click-to-seek, so an unscoped role lookup matches the document's prose.
await page.locator("button[aria-pressed]", { hasText: "Graph" }).click();
await page.waitForTimeout(400);

/** Must match MIN_NODE_W in flow-graph.tsx. */
const MIN_NODE_W = 124;

/**
 * Measured at two widths, because the shipped defect only appeared at the
 * default split: a probe checking one width would have passed while the feature
 * was unusable.
 *
 * The contract is not "always fits" — it is "shrinks to fit, down to a floor,
 * then scrolls honestly". So a narrow pane may overflow, but only with the
 * lanes already at their minimum. Overflow *while lanes are still wide* is the
 * bug; overflow at the floor is the designed fallback. Asserting the stronger
 * thing would fail on correct code, which is how a probe gets switched off.
 */
for (const width of [1280, 1000]) {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForTimeout(500);

  const box = await page.evaluate(() => {
    const el = document.querySelector(".fp-scroll.h-full.overflow-auto");
    if (!el) return null;
    const card = document.querySelector('div[style*="height: 66px"]');
    return {
      overflow: el.scrollWidth - el.clientWidth,
      pane: el.clientWidth,
      nodeWidth: card ? Math.round(card.getBoundingClientRect().width) : 0,
      lanes: [...document.querySelectorAll("div")].filter(
        (d) => d.className.includes("uppercase tracking-wider") && d.style.width
      ).length,
      edges: document.querySelectorAll("svg path[marker-end]").length,
    };
  });

  const fits = box !== null && (box.overflow <= 0 || box.nodeWidth <= MIN_NODE_W);
  check(
    `graph fits the pane, or is at its floor, at ${width}px`,
    fits,
    box
      ? `pane ${box.pane}px, lanes ${box.nodeWidth}px, overflow ${box.overflow}px`
      : "no graph found"
  );
  check(`three lanes visible at ${width}px`, box?.lanes === 3, `${box?.lanes} lanes`);
  check(`chain drew its edges at ${width}px`, box?.edges === 2, `${box?.edges} edges`);
}

await page.setViewportSize({ width: 1280, height: 900 });
await page.screenshot({ path: "scripts/.probe-graph.png" });

/* ---- 2. The exam runs to a marked paper ---------------------------- */

console.log(`\n=== mock exam ===`);
await page.locator("header").getByRole("button", { name: "New" }).click();
await page.getByRole("button", { name: /Mock exam/ }).click();
await page.getByRole("button", { name: "20 questions" }).click();
await page.getByRole("button", { name: "Start" }).click();

// Building re-parses the document, which is the slowest step in the app.
await page.getByText("Marked at the end, not now.").waitFor({ timeout: 180_000 });
check("exam started", true);

const clockAtStart = await page.locator("header, div").getByText(/^\d+:\d\d$/).first().textContent();

let answered = 0;
for (let i = 0; i < 25; i++) {
  if (await page.getByRole("button", { name: "Back to documents" }).isVisible()) break;

  const blank = page.locator('input[aria-label="Missing term"]');
  if (await blank.count()) {
    await blank.fill("a deliberately wrong answer");
    await page.getByRole("button", { name: "Answer" }).click();
  } else {
    const options = page.locator("button.w-full.rounded-md.border");
    if (!(await options.count())) break;
    await options.first().click();
  }
  answered += 1;
  await page.waitForTimeout(80);
}

// The paper's own denominator, not a number written down here. This used to
// assert exactly 20, which was the yield of whichever PDF happened to be the
// smallest in the corpus — so growing the corpus by one document broke a probe
// that was testing nothing about the app. What is actually worth asserting is
// that every question the exam built was put to the reader, and that the queue
// received one item for each: both survive a corpus of any size.
const paperTotal = Number(
  (await page.evaluate(() => (document.body.innerText.match(/\d+ of (\d+) — \d+%/) ?? [])[1])) ?? 0
);
check("the paper had questions to ask", paperTotal > 0, `${paperTotal} questions`);
check(
  "every question was presented",
  answered === paperTotal,
  `answered ${answered} of ${paperTotal}`
);

const marked = await page.getByRole("button", { name: "Back to documents" }).isVisible();
check("paper was marked", marked);

const report = await page.evaluate(() => {
  const text = document.body.innerText;
  return {
    hasScore: /\d+ of \d+ — \d+%/.test(text),
    hasByDocument: text.includes("BY DOCUMENT"),
    hasByKind: text.includes("BY QUESTION TYPE"),
    hasMisses: text.includes("WHAT YOU MISSED"),
    queued: /in the review queue/.test(text),
  };
});
check("score reported", report.hasScore);
check("broken down by document", report.hasByDocument);
check("broken down by question type", report.hasByKind);
check("misses listed with their answers", report.hasMisses);
check("misses queued for review", report.queued);

const reviews = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const req = indexedDB.open("focusparse");
      req.onsuccess = () => {
        const get = req.result.transaction("reviews").objectStore("reviews").getAll();
        get.onsuccess = () => resolve(get.result.length);
        get.onerror = () => resolve(-1);
      };
      req.onerror = () => resolve(-1);
    })
);
check(
  "the queue actually received them",
  reviews === paperTotal,
  `${reviews} items for ${paperTotal} questions`
);

await page.screenshot({ path: "scripts/.probe-exam.png", fullPage: true });

/* ---- The SQL stepper ------------------------------------------------ *
 *
 * The third path, and the one with the most to go wrong that a DOM check
 * cannot see. The claim is that the query is *shown* as written and *read* in
 * evaluation order, which means the only convincing evidence is the highlight
 * moving backwards through the text on its own. Everything else — the spans
 * exist, the classes are applied, the counter increments — would be equally
 * true of a stepper that played the clauses top to bottom.
 */
console.log(`
=== T-SQL stepper ===`);

const SQL_FIXTURE = `/* =============================================================
   Probe query
   ============================================================= */

SELECT p.PATIENT_ID, a.RESULT_NUM
FROM patients p
JOIN RankedLabs a ON a.PATIENT_ID = p.PATIENT_ID AND a.rn = 1
WHERE p.DEATHDATE IS NULL
  AND EXISTS (SELECT 1 FROM conditions c WHERE c.PATIENT_ID = p.PATIENT_ID)
ORDER BY p.PATIENT_ID;`;

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.waitForTimeout(2000);
await page.setInputFiles('input[type="file"][accept*="pdf"]', {
  name: "probe.sql",
  mimeType: "text/plain",
  buffer: Buffer.from(SQL_FIXTURE, "utf8"),
});
await page.getByRole("button", { name: "Play", exact: true }).waitFor({ timeout: 120_000 });

const spans = page.locator("[data-sql-step]");
check("the query rendered as steps", (await spans.count()) === 5, `${await spans.count()} clauses`);

const stepState = async () => {
  return page.evaluate(() => {
    const all = [...document.querySelectorAll("[data-sql-step]")];
    const active = all.find((s) => s.className.includes("ring-1"));
    if (!active) return null;
    return {
      step: Number(active.getAttribute("data-sql-step")),
      written: all.indexOf(active),
      text: active.textContent.replace(/\s+/g, " ").trim().slice(0, 30),
    };
  });
};

// The clause written first is not the clause evaluated first, and this is the
// cheapest place to see it: click the topmost clause on screen and read back
// which step it is.
await spans.first().click();
await page.waitForTimeout(400);
const topmost = await stepState();
check("clicking a clause seeks to it", topmost !== null, topmost?.text ?? "nothing highlighted");
check(
  "exactly one clause is lit",
  (await page.locator("[data-sql-step]").evaluateAll(
    (els) => els.filter((e) => e.className.includes("ring-1")).length
  )) === 1
);
check(
  "the clause written first is not the one evaluated first",
  topmost !== null && topmost.written === 0 && topmost.step > 0,
  `${topmost?.text} is step ${(topmost?.step ?? -1) + 1}`
);

// Now start from the step that really is first. `spans.first()` is written
// order, which is exactly the confusion this feature exists to correct — and
// it is what made this probe fail against a working app on its first run.
await page.locator('[data-sql-step="0"]').click();
await page.waitForTimeout(400);
const seeded = await stepState();
check("the first step is the row source", /^FROM/.test(seeded?.text ?? ""), seeded?.text ?? "");

await page.getByRole("button", { name: "Play", exact: true }).click();
const walk = [];
for (let i = 0; i < 240; i++) {
  await page.waitForTimeout(250);
  const now = await stepState();
  if (now && (!walk.length || walk[walk.length - 1].step !== now.step)) walk.push(now);
  if (walk.length >= 2 && walk[walk.length - 1].written < walk[walk.length - 2].written) break;
}
const jumped = walk.length >= 2 && walk[walk.length - 1].written < walk[walk.length - 2].written;
check(
  "the caret jumps backwards through the query",
  jumped,
  walk.map((w) => `${w.text.split(" ")[0]}@${w.written}`).join(" → ")
);
check(
  "the steps played are in evaluation order",
  walk.every((w, i) => i === 0 || w.step > walk[i - 1].step),
  walk.map((w) => w.step).join(",")
);

await page.getByRole("button", { name: "Pause" }).click().catch(() => {});
await page.locator("pre").first().scrollIntoViewIfNeeded();

// The lane graph's lesson applied to a second component: nothing in the DOM
// says a human cannot see this. A clause running past the pane edge is a
// clause the reader would have to drag a scrollbar to follow, while the audio
// moves — and every JOIN in this fixture did exactly that before the block
// started wrapping.
const clipped = await page.evaluate(() => {
  const pre = document.querySelector("pre");
  if (!pre) return { pre: 0, steps: 0 };
  const edge = pre.getBoundingClientRect().right;
  const steps = [...document.querySelectorAll("[data-sql-step]")].filter(
    (s) => s.getBoundingClientRect().right > edge + 1
  ).length;
  return { pre: Math.max(0, pre.scrollWidth - pre.clientWidth), steps };
});
check("the query fits the pane", clipped.pre === 0, `${clipped.pre}px of overflow`);
check("no clause is clipped out of view", clipped.steps === 0, `${clipped.steps} clipped`);

await page.screenshot({ path: "scripts/.probe-sql.png" });

/* ---- The parking lot ------------------------------------------------- *
 *
 * The claim is a negative one and it is spread over four surfaces: a parked
 * thought is stored, and is nowhere the reader is thinking about the document.
 * Every one of those surfaces reads from the same `nodes` array, so the way
 * this breaks is that one of them forgets to filter — and a unit test on the
 * predicate would not notice, because the predicate would still be correct.
 */
console.log(`
=== parking lot ===`);

// Its own fixture rather than whatever the previous path left loaded.
//
// This ran against the SQL document the stepper path had ingested, which was
// fine until the end-of-document check needed the *last token* to be clickable:
// a SQL block renders its tokens inside a `<pre>` and the last `span[data-token]`
// on the page is not the last token of the document. The path was depending on
// a neighbour's state for no reason.
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.waitForTimeout(1500);
await page.setInputFiles('input[type="file"][accept*="pdf"]', {
  name: "Parking probe.md",
  mimeType: "text/markdown",
  buffer: Buffer.from(
    [
      "# Records",
      "",
      "Records must be attributable and legible. The sponsor keeps the audit",
      "trail for every change made after entry, and the CRF is completed by the",
      "site before review.",
      "",
      "# Coding",
      "",
      "MedDRA codes adverse events and the version in force is recorded.",
      "",
    ].join("\n"),
    "utf8"
  ),
});
await page.getByRole("button", { name: "Play", exact: true }).waitFor({ timeout: 120_000 });
await page.locator("button[aria-pressed]", { hasText: "List" }).click();
await page.waitForTimeout(300);

// A real capture first, with the chain open. Parking against an empty pad
// would pass every check below trivially -- "the count did not move" is true of
// zero, and "the chain is untouched" is true when there is no chain -- and the
// first version of this path did exactly that, reporting 0 vs 0.
await capture("Records must be attributable", "/e");
await page.locator('button[aria-label="Chain from here"]').first().click();
await page.waitForTimeout(200);

const headerCount = async () =>
  Number(
    ((await page.getByText(/^\d+ nodes?$/).first().textContent()) ?? "0").replace(
      /\D/g,
      ""
    )
  );
const nodesBefore = await headerCount();
check("the pad has something to protect", nodesBefore === 1, `${nodesBefore} nodes`);

await capture("Renew the car insurance before Friday", "/p");

const park = await page.evaluate(() => {
  const text = document.body.innerText;
  return {
    badge: (text.match(/(\d+) parked/) ?? [])[1],
    inList: /Renew the car insurance/.test(text),
    chaining: /Chaining from/.test(text)
      ? (text.match(/Chaining from\s*(.+)/) ?? [])[1]
      : null,
  };
});
const nodesAfter = await headerCount();

check("a parked thought is stored", park.badge === "1", `${park.badge ?? "no"} parked`);
check(
  "a parked thought stays out of the map",
  !park.inList,
  park.inList ? "it rendered in the list" : "absent from the list"
);
check(
  "the chain still points at the real capture",
  (park.chaining ?? "").includes("attributable"),
  `chaining from "${park.chaining ?? "nothing"}"`
);
check(
  "the node count did not move",
  nodesAfter === nodesBefore && nodesBefore > 0,
  `${nodesBefore} before, ${nodesAfter} after`
);

// The drawer hands it back.
await page.locator("button", { hasText: /\d+ parked/ }).first().click();
await page.waitForTimeout(250);
const backAgain = /Renew the car insurance/.test(
  await page.evaluate(() => document.body.innerText)
);
check(
  "the drawer hands the thought back",
  backAgain,
  backAgain ? "recovered" : "the drawer did not show it"
);

// And it is still absent from the graph.
await page.locator("button[aria-pressed]", { hasText: "Graph" }).click();
await page.waitForTimeout(400);
const graphText = await page.evaluate(
  () => document.querySelector(".fp-scroll.h-full.overflow-auto")?.textContent ?? ""
);
// The end of a document is the only moment the app already has that could
// offer the parked thoughts back without being asked. Seeking to the last token
// is how the reader gets there without waiting out the whole document.
await page.locator("button[aria-pressed]", { hasText: "List" }).click();
await page.waitForTimeout(250);
// Close it first, so an already-open drawer cannot pass this by standing still.
if (await page.locator("button", { hasText: /\d+ parked/ }).first().getAttribute("aria-pressed") === "true") {
  await page.locator("button", { hasText: /\d+ parked/ }).first().click();
  await page.waitForTimeout(200);
}
const hiddenBefore = !/Renew the car insurance/.test(
  await page.evaluate(() => document.body.innerText)
);

// There is no End binding — the transport keys stop at Home. The last rendered
// token is the last token, because the reader pane is not virtualized.
await page.locator("span[data-token]").last().click();
await page.waitForTimeout(700);
const offered = await page.evaluate(() => document.body.innerText);
check(
  "the drawer was shut before the document ended",
  hiddenBefore,
  hiddenBefore ? "shut" : "it was already open, so the next check proves nothing"
);
check(
  "reaching the end offers the parked thoughts back",
  /Renew the car insurance/.test(offered) && /end of the document/.test(offered),
  /Renew the car insurance/.test(offered) ? "offered" : "nothing was offered"
);

check(
  "a parked thought never draws in the graph",
  !/Renew the car insurance/.test(graphText) && /attributable/.test(graphText),
  /attributable/.test(graphText) ? "the real node drew, the parked one did not" : "the graph is empty"
);

/* ---- Blueprint coverage --------------------------------------------- *
 *
 * The fourth path. Everything else this probe drives reports on the corpus;
 * this panel reports on what the corpus is *missing*, which means the claim
 * that has to survive a real browser is a negative one — a chapter named by the
 * exam that nothing in the library matches.
 *
 * The fixture is built to spring the trap the matcher exists to avoid. It
 * carries a heading called "Assuring Data Quality", which is a real GCDMP
 * chapter that is *not* on the blueprint and is one word from "Measuring Data
 * Quality", which is. If any similarity scoring ever creeps into the matcher,
 * "Measuring Data Quality" quietly stops being reported as absent and this goes
 * red. A DOM check that only confirmed the panel rendered would not.
 */
console.log(`
=== blueprint coverage ===`);

const BLUEPRINT_FIXTURE = `# Data Privacy

Data privacy must be maintained to protect the confidentiality of personal
data of study participants throughout the conduct of the trial.

# Edit Check Design Principles

Edit checks should be specified before programming begins, and each check
should state the discrepancy it raises and the action expected of the site.

# Assuring Data Quality

Quality assurance is the planned and systematic set of activities that
establish confidence that the trial is conducted to good clinical practice.

# Electronic Data Capture-Study Implementation and Start-up

Study start-up in an electronic data capture study covers system
configuration, user acceptance testing, site training and go-live.
`;

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.waitForTimeout(2000);
await page.setInputFiles('input[type="file"][accept*="pdf"]', {
  name: "Blueprint probe.md",
  mimeType: "text/markdown",
  buffer: Buffer.from(BLUEPRINT_FIXTURE, "utf8"),
});
await page.getByRole("button", { name: "Play", exact: true }).waitFor({ timeout: 120_000 });

// Back to the library, then into the panel.
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.getByRole("button", { name: /Blueprint coverage/ }).click();
await page.getByRole("heading", { name: "Blueprint coverage" }).waitFor({ timeout: 30_000 });
await page.getByText(/chapters? (is|are) named by the exam/).waitFor({ timeout: 30_000 });

const bp = await page.evaluate(() => {
  const text = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  const missing = [...document.querySelectorAll("section")].find((s) =>
    /named by the\s+exam and not in your library/.test(text(s))
  );
  const rows = [...document.querySelectorAll("li")].map(text);
  const missingItems = missing
    ? [...missing.querySelectorAll("li")].map(text)
    : [];
  const sections = [...document.querySelectorAll("section")];
  return {
    // Every chapter the blueprint names has a row in the full list.
    listed: (text(document.body).match(/Every chapter the blueprint names \((\d+)\)/) ?? [])[1],
    missingItems,
    // The absent block must come before the per-domain block, and must not be
    // painted in the same language as an unread chapter.
    missingIsFirst: missing ? sections.indexOf(missing) === 0 : false,
    missingIsDestructive: missing
      ? missing.className.includes("destructive")
      : false,
    rowCount: rows.length,
    body: text(document.body),
    overflow: Math.max(
      0,
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    ),
  };
});

const missingText = bp.missingItems.join(" | ");

check(
  "every blueprint chapter is listed",
  bp.listed === "18",
  `listed ${bp.listed ?? "none"}`
);
check(
  "a chapter the library has is not called missing",
  !/Data Privacy/.test(missingText) && !/Edit Check Design Principles/.test(missingText),
  missingText.slice(0, 90)
);
check(
  "a chapter the library lacks is called missing",
  /Reports and Metrics/.test(missingText),
  missingText.slice(0, 90)
);
// The trap, and the reason the fixture says "Assuring Data Quality".
//
// The first version of this asserted that "Measuring Data Quality" appeared in
// the full chapter list, which it always does — the list renders all eighteen
// whatever their state — so it stayed green with fuzzy matching deliberately
// switched on. What has to be true is that the chapter is still reported
// *absent*: the fixture supplies its one-word neighbour and nothing else, so
// the moment anything scores similarity it drops out of the missing block.
check(
  "the nearest neighbour did not silently satisfy a chapter",
  /Measuring Data Quality/.test(missingText),
  "Measuring Data Quality is no longer reported missing"
);
check(
  "a resemblance is offered without being counted",
  /which covers related ground under a different name/.test(missingText),
  "no resemblance note rendered"
);
check(
  "the gap is stated before the progress",
  bp.missingIsFirst,
  "the missing block is not the first section"
);
check(
  "a missing chapter is not painted like an unread one",
  bp.missingIsDestructive,
  "the missing block reuses ordinary styling"
);
check("the panel fits its pane", bp.overflow === 0, `${bp.overflow}px of overflow`);
// The same lesson as the clipped JOINs, on a third component: nothing in the
// DOM says a human cannot read this. The first version of the "has minimum
// standards" badge used `text-destructive`, which in dark mode is the token
// `0 62.8% 30.6%` — a dark red meant to sit *behind* text. It rendered, it was
// in the tree, every structural check passed, and it was invisible.
const contrast = await page.evaluate(() => {
  const parse = (c) => (c.match(/[\d.]+/g) ?? []).map(Number);
  const over = (fg, bg) => {
    const a = fg[3] ?? 1;
    return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));
  };
  const lum = (rgb) => {
    const [r, g, b] = rgb.map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  const badge = [...document.querySelectorAll("span")].find(
    (el) => el.textContent?.trim() === "has minimum standards"
  );
  if (!badge) return { found: false };

  // Flatten every translucent layer between the badge and an opaque ancestor.
  const layers = [];
  for (let el = badge; el; el = el.parentElement) {
    const bg = parse(getComputedStyle(el).backgroundColor);
    if (bg.length && (bg[3] ?? 1) > 0) layers.push(bg);
    if ((bg[3] ?? 1) === 1) break;
  }
  let ground = layers.pop() ?? [0, 0, 0];
  while (layers.length) ground = over(layers.pop(), ground);

  const fg = over(parse(getComputedStyle(badge).color), ground);
  const [a, b] = [lum(fg), lum(ground)].sort((x, y) => y - x);
  return { found: true, ratio: (a + 0.05) / (b + 0.05) };
});

check(
  "the standards badge is legible against what is behind it",
  contrast.found && contrast.ratio >= 4.5,
  contrast.found ? `contrast ${contrast.ratio.toFixed(2)}:1` : "badge not rendered"
);


await page.screenshot({ path: "scripts/.probe-blueprint.png", fullPage: true });

/* ---- The citation index --------------------------------------------- *
 *
 * Driven on the real corpus document the probe loaded first, because the claim
 * is about what a citation recogniser does to actual regulatory prose. The
 * fixture-sized version of this check would pass on a recogniser that matched
 * every number in the document.
 */
console.log(`
=== citation index ===`);

// A second document that cites the same rule, so "discussed by more than one
// document" is a claim this can actually test. The probe's library otherwise
// holds one real PDF, and the multi-document ranking would be vacuously true.
//
// It also carries two decoys: a bare section number and a table reference,
// which are exactly what a generous pattern turns into regulations.
const CITE_FIXTURE = `# Records and signatures

Electronic records must satisfy 21 CFR Part 11 section 11.10, and the audit
trail requirements in Part 11 section 11.10(e) apply to every change.

# Governance

Sponsor oversight follows ICH E6(R2), Chapter 5, and the investigator duties in
ICH E6(R2), Chapter 4. See section 5.0 of the protocol and Table 1 above for
the study-specific detail.
`;

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.waitForTimeout(1500);
await page.setInputFiles('input[type="file"][accept*="pdf"]', {
  name: "Citation probe.md",
  mimeType: "text/markdown",
  buffer: Buffer.from(CITE_FIXTURE, "utf8"),
});
await page.getByRole("button", { name: "Play", exact: true }).waitFor({ timeout: 120_000 });

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.getByRole("button", { name: /Regulations cited/ }).click();
await page.getByRole("heading", { name: "Regulations cited" }).waitFor({ timeout: 30_000 });

const cites = await page.evaluate(() => {
  const text = document.body.innerText;
  const rows = [...document.querySelectorAll("li > button[aria-expanded]")].map(
    (b) => (b.textContent ?? "").replace(/\s+/g, " ").trim()
  );
  return {
    rows,
    overflow: Math.max(
      0,
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    ),
  };
});

check(
  "the corpus's regulations are listed",
  cites.rows.length >= 2,
  `${cites.rows.length} regulations`
);
check(
  "Part 11 is found, and carries its official title",
  cites.rows.some(
    (r) => r.startsWith("21 CFR Part 11") && /Electronic Records/.test(r)
  ),
  cites.rows[0]?.slice(0, 60) ?? "no rows"
);
check(
  "ICH E6 keeps the revision it was cited with",
  cites.rows.some((r) => r.startsWith("ICH E6(R2)")),
  cites.rows.map((r) => r.split(/\d/)[0]).join(" | ").slice(0, 70)
);
check(
  "a rule two documents argue about is ranked first",
  /in [2-9]\d* documents/.test(cites.rows[0] ?? ""),
  cites.rows[0]?.slice(0, 60) ?? "no rows"
);
check(
  "the decoys were refused",
  !cites.rows.some((r) => /^(Section|Table|Figure|Chapter)\b/.test(r)),
  cites.rows.find((r) => /^(Section|Table|Figure|Chapter)/.test(r)) ?? "none admitted"
);

// Expanding a rule shows its provisions and a way into the text.
await page.locator("li > button[aria-expanded]").first().click();
await page.waitForTimeout(300);
const expanded = await page.evaluate(() => document.body.innerText);
check(
  "expanding a rule names the provision it was cited by",
  /§ 11\.10/.test(expanded),
  (expanded.match(/§ [\d.]+/g) ?? []).slice(0, 3).join(", ") || "no provisions shown"
);

check("the citation panel fits its pane", cites.overflow === 0, `${cites.overflow}px`);

await page.screenshot({ path: "scripts/.probe-citations.png", fullPage: true });

/* ---- The summary intercept, and dictating into it -------------------- *
 *
 * The one path here that needs a device this machine does not have. A real
 * recognizer wants a microphone and a network service, so the constructor is
 * replaced with one that reads from a script -- everything downstream of it is
 * the app's own code, including the reconciliation that this feature exists
 * for.
 *
 * What that leaves untested is the microphone itself and whatever Chrome's
 * transcription actually returns for these words. The unit tests cover the
 * repair; nothing here can cover the hearing.
 *
 * Two things about reaching an intercept at all, both of which cost time to
 * find. A section arms one only at 60 words or more (MIN_INTERCEPT_WORDS), so
 * the fixture's *second* section has to be long while the first stays short
 * enough to read through quickly. And the dialog is portalled: it is in the
 * DOM and `document.body.innerText` does not return it, so a check written
 * against innerText reports a working intercept as missing.
 */
console.log(`
=== summary intercept ===`);

const HEARD = "the see are eff must not identify a participant and edc keeps an audit trail";

const INTERCEPT_FIXTURE = `# Data privacy in trials

The sponsor holds accountability and the CRF must not identify a participant.
EDC systems keep an audit trail of every change made after entry.

# Coding dictionaries and their upkeep

MedDRA is used to code adverse events and CDISC standards govern the format of
a submission. A coding dictionary is versioned, and the version in force at the
time of coding has to be recorded so that a later reviewer can reproduce the
decision. Upversioning is a planned activity with its own impact assessment,
because a term that moved between system organ classes changes the analysis
that reads it. The data manager keeps the mapping, the medical monitor approves
the changes, and both are recorded in the trial master file for inspection.
`;

await page.addInitScript((script) => {
  class ScriptedRecognition {
    constructor() {
      this.lang = "en-US";
      this.continuous = false;
      this.interimResults = false;
      this.onresult = null;
      this.onerror = null;
      this.onend = null;
    }
    start() {
      setTimeout(() => {
        this.onresult?.({ results: [[{ transcript: script }]] });
      }, 60);
    }
    stop() {
      this.onend?.();
    }
  }
  Object.defineProperty(window, "webkitSpeechRecognition", {
    value: ScriptedRecognition,
    configurable: true,
  });
  Object.defineProperty(window, "SpeechRecognition", {
    value: ScriptedRecognition,
    configurable: true,
  });
}, HEARD);

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.waitForTimeout(2000);
await page.setInputFiles('input[type="file"][accept*="pdf"]', {
  name: "Intercept probe.md",
  mimeType: "text/markdown",
  buffer: Buffer.from(INTERCEPT_FIXTURE, "utf8"),
});
await page.getByRole("button", { name: "Play", exact: true }).waitFor({ timeout: 120_000 });
await page.getByRole("button", { name: "Play", exact: true }).click();

// Read the dialog out of the portal, not out of innerText.
const dialogText = async () =>
  page.evaluate(
    () => document.querySelector("[role=dialog]")?.textContent?.replace(/\s+/g, " ") ?? ""
  );

let opened = false;
for (let i = 0; i < 24 && !opened; i++) {
  await page.waitForTimeout(2500);
  opened = /Cognitive intercept/.test(await dialogText());
}

check(
  "crossing a section boundary demands a summary",
  opened,
  opened ? "the dialog opened" : "no intercept in 60s"
);

if (opened) {
  const before = await dialogText();
  check(
    "the intercept names the section just finished",
    /Data privacy in trials/.test(before),
    before.slice(0, 70)
  );

  const mic = page.getByRole("button", { name: /Speak it/ });
  check("dictation is offered where the platform has a recognizer", await mic.isVisible());

  await mic.click();
  await page.waitForTimeout(900);

  const typed = await page
    .locator("[role=dialog] textarea")
    .inputValue()
    .catch(() => "");
  const after = await dialogText();

  check(
    "what was heard reaches the box",
    /must not identify a participant/.test(typed),
    JSON.stringify(typed.slice(0, 64))
  );
  check(
    "the terms the recognizer mangled are put back",
    /\bCRF\b/.test(typed) && /\bEDC\b/.test(typed),
    JSON.stringify(typed.slice(0, 64))
  );
  check(
    "the repair is declared rather than made silently",
    /Heard and corrected/.test(after) && /see are eff/.test(after),
    after.slice(after.indexOf("Heard and corrected"), after.indexOf("Heard and corrected") + 60) ||
      "nothing declared"
  );

  /* The anti-paralysis scaffold.
   *
   * The intercept is non-dismissible by design, which is the whole value of it
   * and also where a reader can sit in front of an empty box with the material
   * still in their head and no way in. The anchors are the section's own nouns
   * -- never a sentence, never anything that could be copied out as an answer.
   *
   * What has to be true on screen is that they came from *this* section and
   * that the help was counted. A cued recall recorded as a free one quietly
   * inflates every later judgement of the same sentence: the grader's "missed"
   * list shrinks and the self-grade weeks later is made against a sentence
   * whose nouns were supplied.
   */
  const stuck = page.getByRole("button", { name: /Stuck\?/ });
  check(
    "a section with named terms offers a way out of the blank page",
    await stuck.isVisible(),
    "the anchors are on offer"
  );

  await stuck.click();
  await page.waitForTimeout(400);
  const scaffold = await page.evaluate(() => {
    const dialog = document.querySelector("[role=dialog]");
    // Selected by an explicit hook, not by matching text. `find` over every
    // div returns the outermost ancestor containing the phrase -- which is the
    // whole dialog -- and every assertion below then passes on the dictation
    // transcript rather than on the anchors. It did, first time round.
    const panel = dialog.querySelector("[data-anchor-panel]");
    if (!panel) return null;
    const chips = [...panel.querySelectorAll("[data-anchor]")].map((c) =>
      (c.textContent || "").trim()
    );
    return { chips, text: (panel.textContent || "").replace(/\s+/g, " ") };
  });

  // Exactly the two acronyms the summarized section contains, and nothing
  // else. "Some of them are right" is not the claim: the fixture's *other*
  // section carries MedDRA and CDISC, and drawing anchors from the whole
  // document instead of the section slips CDISC in here -- which is a term
  // the reader is being asked to summarize a section that never used. A
  // `some` check passes straight through that; this one does not.
  const OWN = ["CRF", "EDC"];
  check(
    "the anchors are the section's own terms and no others",
    scaffold !== null &&
      scaffold.chips.length > 0 &&
      scaffold.chips.every((c) => OWN.includes(c)),
    scaffold ? JSON.stringify(scaffold.chips) : "no panel"
  );

  check(
    "nothing offered is long enough to be an answer",
    scaffold !== null &&
      scaffold.chips.every((c) => c.split(/\s+/).length <= 8) &&
      !/\./.test(scaffold.chips.join("")),
    scaffold
      ? `longest ${Math.max(...scaffold.chips.map((c) => c.split(/\s+/).length))} words`
      : "no panel"
  );

  check(
    "the help says it was counted",
    scaffold !== null && /cued recall/i.test(scaffold.text),
    "the cost is stated where the choice is made"
  );

  await page.screenshot({ path: "scripts/.probe-intercept.png", fullPage: true });

  // And it must survive the trip to disk, because the self-grade weeks later
  // is the only place this sentence is ever judged.
  await page.locator("[role=dialog] textarea").fill(
    "The section argued that identifiers must be removed before any transfer."
  );
  await page.getByRole("button", { name: /Log it and resume/ }).click();
  await page.waitForTimeout(1500);

  const stored = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open("focusparse");
        req.onsuccess = () => {
          const all = req.result
            .transaction("reviews", "readonly")
            .objectStore("reviews")
            .getAll();
          all.onsuccess = () =>
            resolve(
              all.result.map((r) => ({ kind: r.kind, cued: r.cued ?? null }))
            );
          all.onerror = () => resolve([]);
        };
        req.onerror = () => resolve([]);
      })
  );

  const summaries = stored.filter((r) => r.kind === "summary");
  check(
    "the summary is filed as a cued recall",
    summaries.length > 0 && summaries.some((r) => r.cued === true),
    `${summaries.length} summaries, ${
      summaries.filter((r) => r.cued === true).length
    } cued`
  );
  check(
    "nothing that never saw an anchor is marked as though it had",
    stored.filter((r) => r.kind !== "summary").every((r) => r.cued !== true),
    `${stored.length - summaries.length} auto-graded items, none cued`
  );
}

/* ---- Structure filter ------------------------------------------------ *
 *
 * The map is one row per heading, which is a glance for most of this corpus and
 * 755 rows for the full GCDMP. What makes a plain list of matches useless at
 * that size is that the headings repeat: every one of its 39 chapters has a
 * "Scope", a "Minimum Standards" and a "Recommended Standard Operating
 * Procedures". So the assertion that matters is not that filtering narrows the
 * list -- it is that each surviving row says which chapter it is in, and that
 * those labels differ.
 *
 * The fixture is three chapters sharing three heading names: the same ambiguity
 * at a size a probe can assert exactly. It is also over the row count at which
 * the box appears at all, and its first two chapters alone are under it, so both
 * sides of that threshold are covered.
 */
console.log(`
=== structure filter ===`);

const FILTER_CHAPTERS = [
  `# Data Privacy

Personal data of study participants must be protected throughout the trial.

## Scope

This chapter covers the handling of personal data across the study lifecycle.

## Minimum Standards

Redact personal data before transfer and record who authorized the transfer.

## Lab Data

Laboratory results arrive from outside the sponsor and carry identifiers.

## Data Transfers

Every transfer is specified, tested against a sample, and reconciled.

## Computer and Network Security

Access is granted by role and reviewed whenever a role changes.

## Recommended Standard Operating Procedures

A procedure for redaction, one for transfer, and one for breach reporting.`,
  `# Vendor Selection and Management

A vendor is selected against stated criteria and managed against a contract.

## Scope

This chapter covers selection, qualification, oversight and closeout.

## Minimum Standards

Qualify the vendor before selection and audit against the signed plan.

## Assessing Need

Decide what work leaves the sponsor before deciding who will do it.

## Request for Proposal

The proposal states the deliverables, the timeline and the acceptance test.

## Qualification Audit

The audit happens before the contract is signed, not after the work starts.

## Oversight Meetings

Oversight is a standing meeting with a written record and an action list.

## Study Closeout Oversight

Closeout returns the data, the documentation and the outstanding queries.

## Recommended Standard Operating Procedures

A procedure for selection, one for qualification, and one for closeout.`,
  `# Serious Adverse Event Data Reconciliation

Safety and clinical hold the same events in two systems and must agree.

## Scope

This chapter covers reconciliation between the safety and clinical databases.

## Minimum Standards

Reconcile at agreed intervals and before every interim analysis and lock.

## Reconciliation Frequency

Frequency follows enrolment rate rather than the calendar.

## Fields Compared

Onset date, term, seriousness, outcome and causality are compared every time.

## Discrepancy Resolution

A discrepancy is owned by one group and closed with a documented decision.

## Recommended Standard Operating Procedures

A procedure for frequency, one for comparison and one for resolution.`
];

/** Load markdown straight through the app's own file input. */
async function loadMarkdown(name, text) {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(2000);
  await page.setInputFiles('input[type="file"][accept*="pdf"]', {
    name,
    mimeType: "text/markdown",
    buffer: Buffer.from(text, "utf8"),
  });
  await page.getByRole("button", { name: "Play", exact: true }).waitFor({ timeout: 120_000 });
}

const filterBox = () => page.getByLabel("Filter sections by name");
const mapRows = () => page.locator("aside nav button").count();
/** Each row flattened to one line, so a chapter label shows up in its text. */
const mapText = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("aside nav button")].map((b) =>
      (b.innerText || "").replace(/\s+/g, " ").trim()
    )
  );

await loadMarkdown("Filter probe short.md", FILTER_CHAPTERS.slice(0, 2).join("\n\n"));
const shortRows = await mapRows();
check(
  "a map short enough to read has no filter box",
  shortRows > 0 && (await filterBox().count()) === 0,
  `${shortRows} rows, no box`
);

await loadMarkdown("Filter probe.md", FILTER_CHAPTERS.join("\n\n"));
const allRows = await mapRows();
check(
  "a longer map gets one, and it counts the rows",
  (await filterBox().count()) === 1 &&
    (await filterBox().getAttribute("placeholder")) === `Filter ${allRows} sections`,
  `${allRows} rows -- ${await filterBox().getAttribute("placeholder")}`
);

await filterBox().fill("minimum standards");
await page.waitForTimeout(300);
const repeated = await mapText();
check(
  "a heading every chapter shares comes back once per chapter",
  repeated.length === 3 && repeated.every((t) => /Minimum Standards/.test(t)),
  `${repeated.length} rows`
);
check(
  "and each one says which chapter it is in",
  new Set(repeated.map((t) => t.split("Minimum Standards")[0].trim())).size === 3,
  JSON.stringify(repeated.map((t) => t.split("Minimum Standards")[0].trim()))
);

await filterBox().fill("privacy");
await page.waitForTimeout(300);
const chapterRows = await mapText();
check(
  "a chapter's name brings the chapter and its headings",
  chapterRows.length === 7 &&
    /Data Privacy/.test(chapterRows[0]) &&
    chapterRows.some((t) => /Lab Data/.test(t)) &&
    !chapterRows.some((t) => /Assessing Need/.test(t)),
  `${chapterRows.length} rows, none of them from another chapter`
);

/*
 * The refusal. A heading one word away from a real one must return nothing --
 * the rule the blueprint matcher is held to, for the same reason: a match the
 * reader cannot explain is worse than no match. Any similarity scoring added
 * here turns this green into a list.
 */
await filterBox().fill("maximum standards");
await page.waitForTimeout(300);
const missText = await page.locator("aside nav").innerText();
check(
  "a near miss matches nothing, and says so rather than showing an empty list",
  (await mapRows()) === 0 && /Nothing in this document is called/.test(missText),
  missText.replace(/\s+/g, " ").slice(0, 46)
);

await filterBox().fill("qualification audit");
await page.waitForTimeout(300);
await page.locator("aside nav button").first().click();
await page.waitForTimeout(500);
const seeked = await page.evaluate(() => {
  const active = document.querySelector(".fp-word-active");
  const at = active ? Number(active.getAttribute("data-token")) : -1;
  const around = [...document.querySelectorAll("span[data-token]")]
    .filter((w) => Math.abs(Number(w.dataset.token) - at) < 6)
    .map((w) => w.textContent)
    .join(" ");
  return { at, around };
});
check(
  "clicking a filtered row seeks to that heading",
  seeked.at > 0 && /Qualification Audit/i.test(seeked.around),
  `token ${seeked.at}: ${JSON.stringify(seeked.around.slice(0, 44))}`
);

await page.getByLabel("Clear the filter").click();
await page.waitForTimeout(300);
check(
  "clearing gives the whole map back",
  (await mapRows()) === allRows,
  `${await mapRows()} rows`
);

await page.screenshot({ path: "scripts/.probe-filter.png", fullPage: false });

/* ---- Reading highlight ---------------------------------------------- *
 *
 * The flow hands React the *same element object* for every block whose
 * relationship to the caret has not changed, which is what stops a 5,404-block
 * document rebuilding its whole list on every spoken word. The failure mode of
 * that cache is not a crash: it is a highlight that is quietly out of date, and
 * every DOM-level fact about the pane would still hold — the spans exist, one
 * of them is active, the classes are applied.
 *
 * So the check has to be a seek *backwards*. Going forward, "read" only ever
 * spreads, and a cache that never invalidated anything would still look right.
 * Coming back, every block between the two positions has to give up its read
 * state, and a stale element cannot.
 */
console.log(`
=== reading highlight ===`);

const HIGHLIGHT_FIXTURE = `# Query Management

A query is raised when data on the form contradicts the protocol, the
source, or itself. The site answers it and the answer is recorded against
the original value rather than replacing it.

# Database Lock

Lock is the point after which no value changes without a documented
authorization. Everything owed to the study must be closed before it.

# Audit Trail

The audit trail records who changed what, when, and why, and it is the
evidence that the rest of the account can be believed at all.
`;

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.waitForTimeout(2000);
await page.setInputFiles('input[type="file"][accept*="pdf"]', {
  name: "Highlight probe.md",
  mimeType: "text/markdown",
  buffer: Buffer.from(HIGHLIGHT_FIXTURE, "utf8"),
});
await page.getByRole("button", { name: "Play", exact: true }).waitFor({ timeout: 120_000 });

/** What the pane says about the reading position, read from the DOM alone. */
const highlightState = () =>
  page.evaluate(() => {
    const words = [...document.querySelectorAll("span[data-token]")];
    const active = words.filter((w) => w.classList.contains("fp-word-active"));
    const read = words.filter((w) => w.classList.contains("fp-word-read"));
    const at = active.length === 1 ? Number(active[0].dataset.token) : -1;
    return {
      actives: active.length,
      at,
      // The two numbers a stale element gets wrong: something marked read that
      // the caret has not reached, and something ahead of it left unmarked.
      readAhead: read.filter((w) => Number(w.dataset.token) > at).length,
      unreadBehind: words.filter(
        (w) =>
          Number(w.dataset.token) < at && !w.classList.contains("fp-word-read")
      ).length,
    };
  });

const wordCount = await page.locator("span[data-token]").count();
const deep = Math.floor(wordCount * 0.8);
const shallow = Math.floor(wordCount * 0.1);

await page.locator("span[data-token]").nth(deep).click();
await page.waitForTimeout(400);
const forward = await highlightState();

check(
  "seeking forward leaves exactly one active word, where it was clicked",
  forward.actives === 1 && forward.at === deep,
  `${forward.actives} active, at token ${forward.at} (clicked ${deep})`
);
check(
  "everything before it is marked read, and nothing after it is",
  forward.unreadBehind === 0 && forward.readAhead === 0,
  `${forward.unreadBehind} unread behind, ${forward.readAhead} read ahead`
);

await page.locator("span[data-token]").nth(shallow).click();
await page.waitForTimeout(400);
const back = await highlightState();

check(
  "seeking backwards moves the active word back",
  back.actives === 1 && back.at === shallow,
  `${back.actives} active, at token ${back.at} (clicked ${shallow})`
);
check(
  "and the blocks it left take their read marks off again",
  back.readAhead === 0,
  back.readAhead === 0
    ? `${deep - shallow} tokens released`
    : `${back.readAhead} words still marked read ahead of the caret`
);

/* ---- Home screen reachability --------------------------------------- *
 *
 * `items-center` on a scrolling flex container centres the content and then
 * clips whatever overflows above the scroll origin — and that part cannot be
 * scrolled back to, because the scrollbar is already at zero. Every DOM-level
 * fact about the home screen stays true while this is broken: the buttons
 * exist, they have labels, they are not `display: none`, and `scrollHeight`
 * even reports a smaller number than the content actually needs.
 *
 * Measured before the fix, at five documents: the corpus index and the exam
 * date could not be brought into view at any scroll position, and the content
 * began 352px above the top of its own scroller. The reader has twelve
 * documents.
 *
 * So the assertion is reachability, not visibility: every control must be
 * fully inside the scroller at *some* scroll offset.
 */
console.log(`
=== home screen reachability ===`);

for (let i = 1; i <= 5; i++) {
  await loadMarkdown(`Reach probe ${i}.md`, `# Chapter ${i}

The audit trail is reviewed before the database is locked.`);
}

await page.locator("header").getByRole("button", { name: "New" }).click();
await page.waitForTimeout(1000);

const reach = await page.evaluate(() => {
  const scroller = document.querySelector(".overflow-y-auto");
  const max = scroller.scrollHeight - scroller.clientHeight;
  const box = scroller.getBoundingClientRect();
  const labels = [...document.querySelectorAll("button")]
    .map((b) => (b.innerText || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const unreachable = [];
  for (const label of new Set(labels)) {
    let seen = false;
    for (let top = 0; top <= max + 1; top += 50) {
      scroller.scrollTop = Math.min(top, max);
      const el = [...document.querySelectorAll("button")].find(
        (b) => (b.innerText || "").replace(/\s+/g, " ").trim() === label
      );
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.top >= box.top - 1 && r.bottom <= box.bottom + 1) {
        seen = true;
        break;
      }
    }
    if (!seen) unreachable.push(label.slice(0, 40));
  }
  // Back to the origin *before* measuring it. The sweep above leaves the
  // scroller wherever the last control happened to come into view, and
  // reading the offset there says nothing about where the content starts.
  scroller.scrollTop = 0;
  const above = Math.round(
    scroller.firstElementChild.getBoundingClientRect().top - scroller.getBoundingClientRect().top
  );
  return { controls: new Set(labels).size, unreachable, above };
});

check(
  "every home-screen control can be scrolled to",
  reach.unreachable.length === 0,
  reach.unreachable.length === 0
    ? `${reach.controls} controls, all reachable`
    : `unreachable: ${reach.unreachable.join(", ")}`
);
check(
  "the home screen does not start above its own scroll origin",
  reach.above >= 0,
  `content begins ${reach.above}px from the top of the scroller`
);

/* ---- Cross-document comparison -------------------------------------- *
 *
 * The panel quotes a sentence out of one document and marks the phrase inside
 * it, and the mark is placed by character offsets computed in a different
 * module from the one that produced the sentence. Every DOM-level fact about
 * that would be just as true of a mark in the wrong place — the <mark> exists,
 * it has text in it, the quotation is a real sentence from a real document.
 *
 * So the assertion is that the marked text *is the phrase that was searched
 * for*. That is the on-screen form of the check `scan-compare` makes offline,
 * and it is the one an offset bug cannot survive.
 *
 * The other half is the dead end. Only capitalized names are indexed, so an
 * ordinary lowercase term reaches an empty corpus index and reads as "not in
 * these documents" — measured: "audit trail" is in ten of the twelve corpus
 * documents and indexed in none. The escape out of that empty state has to be
 * there, and has to work.
 */
console.log(`
=== cross-document comparison ===`);

const COMPARE_A = `# Electronic Records

Persons who use closed systems shall employ secure, computer-generated,
time-stamped audit trails. The audit trail shall record the operator entry and
the date. Audit trail documentation shall be retained.

# Electronic Signatures

A signature shall be linked to its respective record so that it cannot be
excised, copied or otherwise transferred.`;

const COMPARE_B = `# Database Closure

The audit trail should be reviewed before the database is locked, and the
review recorded.

# Metrics for Data Quality

Quality is measured against the plan agreed at the start of the study.`;

const COMPARE_C = `# Vendor Selection

Oversight of the vendor is retained by the sponsor, and the sponsor may not
delegate it.

# Contracting

A contract states the deliverables and the acceptance criteria for each.`;

await loadMarkdown("Part 11 probe.md", COMPARE_A);
await loadMarkdown("GCDMP probe.md", COMPARE_B);
await loadMarkdown("Vendor probe.md", COMPARE_C);

await page.locator("header").getByRole("button", { name: "New" }).click();
await page.getByRole("button", { name: /Corpus index/ }).click();
await page.getByLabel("Search the corpus index").waitFor({ timeout: 60_000 });

// The dead end: a lowercase prose term is in every document and in no index.
await page.getByLabel("Search the corpus index").fill("audit trail");
await page.waitForTimeout(400);
const escape = page.getByRole("button", { name: /Search the documents for/ });
check(
  "a lowercase term finds nothing in the index and offers the documents instead",
  await escape.isVisible(),
  "empty index state carries the way out"
);

await escape.click();
await page.getByLabel("Phrase to compare across documents").waitFor({ timeout: 30_000 });
await page.waitForTimeout(1200);

const compared = await page.evaluate(() => {
  const marks = [...document.querySelectorAll("mark")];
  const cards = [...document.querySelectorAll("button")].filter((b) =>
    b.querySelector("mark")
  );
  const titles = [...document.querySelectorAll("div")]
    .map((d) => (d.firstElementChild && d.firstElementChild.textContent) || "")
    .filter((t) => /probe\.md$/.test(t.trim()));
  return {
    marked: marks.map((m) => m.textContent.trim()),
    quotes: cards.map((b) => (b.innerText || "").replace(/\s+/g, " ").trim()),
    bodyText: document.body.innerText,
  };
});

check(
  "every mark is the phrase that was searched for",
  compared.marked.length > 0 &&
    compared.marked.every((m) => /^audit trails?$/i.test(m)),
  `${compared.marked.length} marks: ${JSON.stringify(compared.marked.slice(0, 4))}`
);

// A heading match is quoted as itself and labelled as such, so it is exempt
// from needing surrounding prose — the label is what carries the meaning.
const prose = compared.quotes.filter((q) => !/a section of its own/.test(q));
check(
  "every prose mark sits inside more sentence than itself",
  prose.length > 0 &&
    prose.every((q) => /audit trails?/i.test(q)) &&
    prose.every((q) => q.replace(/audit trails?/i, "").trim().length > 20),
  `${prose.length} prose quotations, ${
    compared.quotes.length - prose.length
  } headings, shortest prose ${Math.min(
    ...prose.map((q) => q.split(/\s+/).length)
  )} words`
);

check(
  "both documents that say it are shown",
  /Part 11 probe/.test(compared.bodyText) && /GCDMP probe/.test(compared.bodyText),
  "two guidelines side by side"
);

check(
  "the document that never says it is not shown",
  !/Vendor probe/.test(compared.bodyText),
  "silent documents dropped rather than listed empty"
);

await page.screenshot({ path: "scripts/.probe-compare.png", fullPage: false });

// A paraphrase must be refused on screen, not only in the unit tests. The
// phrase here is the reversal rather than a reworded one: measured over the
// corpus, "sponsor oversight" IS present -- E6(R3) carries it as a heading and
// "oversight by the sponsor" as a sentence -- so the obvious example would have
// asserted something false.
await page.getByLabel("Phrase to compare across documents").fill("trail audit");
await page.waitForTimeout(1200);
const refused = await page.evaluate(() => document.body.innerText);
check(
  "a paraphrase is refused rather than approximated",
  /No document says/.test(refused),
  /No document says/.test(refused)
    ? "'trail audit' does not find 'audit trail' — order is part of the phrase"
    : `still showing: ${JSON.stringify(refused.replace(/\s+/g, " ").slice(0, 200))}`
);

// And the quotation is a way into the document, not just a picture of one.
await page.getByLabel("Phrase to compare across documents").fill("audit trail");
await page.waitForTimeout(1200);
await page.locator("button:has(mark)").first().click();
await page.getByRole("button", { name: "Play", exact: true }).waitFor({ timeout: 120_000 });
await page.waitForTimeout(600);
const landed = await page.evaluate(() => {
  const active = document.querySelector(".fp-word-active");
  const at = active ? Number(active.getAttribute("data-token")) : -1;
  const around = [...document.querySelectorAll("span[data-token]")]
    .filter((w) => Math.abs(Number(w.dataset.token) - at) < 4)
    .map((w) => w.textContent)
    .join(" ");
  return { at, around };
});
check(
  "clicking a quotation opens that document at that sentence",
  landed.at >= 0 && /audit/i.test(landed.around),
  `token ${landed.at}: ${JSON.stringify(landed.around.slice(0, 40))}`
);

/* ---- Report -------------------------------------------------------- */

check("no console errors", consoleErrors.length === 0, consoleErrors[0] ?? "");

await browser.close();

console.log(`\n=== probe ===`);
console.log(`  document: ${sample.f} (${Math.round(sample.size / 1024)}KB)`);
console.log(`  clock at first question: ${clockAtStart ?? "—"}`);
console.log(
  `  screenshots: .probe-graph, .probe-exam, .probe-sql, .probe-blueprint, .probe-citations, .probe-intercept, .probe-filter, .probe-compare (.png, in scripts/)`
);
console.log(`  failures: ${failures.length}   (must be 0)`);
if (failures.length) {
  for (const f of failures) console.log(`    - ${f}`);
  process.exit(1);
}

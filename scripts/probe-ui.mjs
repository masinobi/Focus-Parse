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
 * Two paths are covered, both of which have already shipped a defect:
 *
 *   1. The lane graph must fit the pane it lives in. It once rendered as one
 *      visible lane and a horizontal scrollbar, which every DOM-level check
 *      passed, because nothing in the DOM says "a human cannot see this".
 *   2. The mock exam must run from setup to a marked paper. Its assembler has
 *      twice produced a paper that was quietly wrong rather than broken.
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
  const playing = page.getByRole("button", { name: "Play" });
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

check("every question was presented", answered === 20, `answered ${answered}`);

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
check("the queue actually received them", reviews === 20, `${reviews} items`);

await page.screenshot({ path: "scripts/.probe-exam.png", fullPage: true });

/* ---- Report -------------------------------------------------------- */

check("no console errors", consoleErrors.length === 0, consoleErrors[0] ?? "");

await browser.close();

console.log(`\n=== probe ===`);
console.log(`  document: ${sample.f} (${Math.round(sample.size / 1024)}KB)`);
console.log(`  clock at first question: ${clockAtStart ?? "—"}`);
console.log(`  screenshots: scripts/.probe-graph.png, scripts/.probe-exam.png`);
console.log(`  failures: ${failures.length}   (must be 0)`);
if (failures.length) {
  for (const f of failures) console.log(`    - ${f}`);
  process.exit(1);
}

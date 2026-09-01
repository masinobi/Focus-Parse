/**
 * What a 524-page book costs the main thread, and how much of that is the DOM.
 *
 *   node scripts/scan-perf.mjs "C:/path/to/corpus" [--runs 3]
 *
 * A server must already be on :3000 — **which build it is, is the whole
 * point**. Run it against `npm run dev` and against `npm run start` and compare
 * the two; the numbers differ by about three, and the conclusion recorded in
 * CLAUDE.md for a whole round was drawn from the dev one.
 *
 * Fresh browser context per run, so the reader's IndexedDB is never touched.
 *
 * **The control is the same document in RSVP**: identical parse, identical
 * audio, no flow in the pane. Everything here is a difference against it, and a
 * difference against a broken control is worse than no number at all — so the
 * two things that make the control a control are asserted rather than assumed:
 *
 *   - The view must be switched *before* the book is opened. The first version
 *     switched after, so both arms measured a flow-mode open and reported them
 *     as identical — correctly, and uselessly.
 *   - The RSVP arm must actually be in RSVP, which is checked by counting the
 *     word spans it lays out on a warm-up document. That number is zero in
 *     RSVP and non-zero in the flow, and it is the only thing standing between
 *     this report and a page of numbers comparing the flow with itself.
 *
 * Timings are a *report*, not an assertion. Run-to-run variance is about a
 * third on this machine and a threshold over it would fail for the weather.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node scripts/scan-perf.mjs <corpus folder> [--runs N]");
  process.exit(1);
}
const runsFlag = process.argv.indexOf("--runs");
const RUNS = runsFlag > 0 ? Number(process.argv[runsFlag + 1]) : 3;
const PLAY_MS = 20_000;
const BASE = "http://localhost:3000";

// By name, not by file size: the biggest *file* in this corpus is an
// image-heavy EDC chapter, and the document that matters is the one with
// 136,645 tokens in it.
const named = readdirSync(dir).find((f) => /GCDMP.*\.pdf$/i.test(f));
if (!named) {
  console.error(`no GCDMP pdf in ${dir}`);
  process.exit(1);
}
const big = { f: named, size: statSync(join(dir, named)).size };

const OBSERVER = `
  window.__blocked = 0;
  window.__longest = 0;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__blocked += e.duration;
        if (e.duration > window.__longest) window.__longest = e.duration;
      }
    }).observe({ entryTypes: ["longtask"] });
  } catch {}
  window.__resetBlocked = () => {
    window.__blocked = 0;
    window.__longest = 0;
  };
`;

const WARMUP = ["# Warm up", "", "One short line of prose."].join("\n");

/**
 * Never a role query. Every word carries `role="button"` for seek-on-click, so
 * an accessible-name scan walks 135,000 candidates and reports its own cost as
 * the app's — the 95-second open that turned out to be 13.
 */
const clickHeader = (page, label) =>
  page.evaluate((want) => {
    const buttons = [...document.querySelectorAll("header button")];
    const hit =
      want === "Play"
        ? buttons.find((x) => (x.textContent || "").trim() === "Play")
        : buttons.find((x) => new RegExp(want, "i").test(x.textContent || ""));
    if (!hit) return false;
    hit.click();
    return true;
  }, label);

const waitForReader = (page, timeout) =>
  page.waitForFunction(() => /Play/.test(document.body.innerText), null, { timeout });

async function measure(mode) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(OBSERVER);

  // Node count and heap from the renderer. `performance.memory` reports the JS
  // heap only, and most of what 409,000 DOM nodes weigh is not on it.
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  const metric = async (name) => {
    const { metrics } = await cdp.send("Performance.getMetrics");
    return metrics.find((m) => m.name === name)?.value ?? 0;
  };

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForTimeout(2500);

  await page.evaluate(() => window.__resetBlocked());
  await page.waitForTimeout(PLAY_MS);
  const idle = await page.evaluate(() => window.__blocked);

  // Reach the header with a document small enough to cost nothing, set the
  // view there, and only then open the book.
  await page.setInputFiles('input[type="file"][accept*="pdf"]', {
    name: "warmup.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(WARMUP, "utf8"),
  });
  await waitForReader(page, 120_000);
  if (mode === "rsvp") {
    if (!(await clickHeader(page, "RSVP"))) throw new Error("no RSVP control");
    await page.waitForTimeout(500);
  }
  const spansOnWarmup = await page.evaluate(
    () => document.querySelectorAll("span[data-token]").length
  );
  await page.locator("header").getByRole("button", { name: "New" }).click();
  await page.waitForTimeout(600);

  await page.evaluate(() => window.__resetBlocked());
  const started = Date.now();
  await page.setInputFiles('input[type="file"][accept*="pdf"]', join(dir, big.f));
  await waitForReader(page, 300_000);
  const openMs = Date.now() - started;
  await page.waitForTimeout(1500);
  const open = await page.evaluate(() => ({
    blocked: window.__blocked,
    longest: window.__longest,
  }));

  const nodes = await page.evaluate(() => {
    let n = 0;
    const walk = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ALL);
    while (walk.nextNode()) n += 1;
    return { document: n, words: document.querySelectorAll("span[data-token]").length };
  });

  await page.evaluate(() => window.__resetBlocked());
  if (!(await clickHeader(page, "Play"))) throw new Error("no Play button");
  await page.waitForTimeout(PLAY_MS);
  const play = await page.evaluate(() => ({
    blocked: window.__blocked,
    longest: window.__longest,
  }));

  const heapMb = (await metric("JSHeapUsedSize")) / 1_048_576;
  await browser.close();
  return { openMs, open, nodes, play, idle, spansOnWarmup, heapMb };
}

console.log(`document: ${big.f} (${Math.round(big.size / 1024)}KB)`);
console.log(`server:   ${BASE}   runs: ${RUNS}\n`);

const results = { flow: [], rsvp: [] };
for (let r = 0; r < RUNS; r++) {
  for (const mode of ["flow", "rsvp"]) {
    const m = await measure(mode);
    results[mode].push(m);
    console.log(
      `  run ${r + 1} ${mode.padEnd(4)}  open ${String(Math.round(m.openMs)).padStart(6)}ms` +
        `  longest ${String(Math.round(m.open.longest)).padStart(5)}ms` +
        `  nodes ${m.nodes.document.toLocaleString().padStart(8)}` +
        `  play ${(m.play.blocked / 1000).toFixed(2)}s` +
        `  heap ${Math.round(m.heapMb)}MB`
    );
  }
}

const avg = (xs, f) => xs.reduce((s, x) => s + f(x), 0) / xs.length;
const d = (f) => avg(results.flow, f) - avg(results.rsvp, f);

console.log(`\n=== ${RUNS} runs ===`);
for (const mode of ["flow", "rsvp"]) {
  const rs = results[mode];
  console.log(
    `  ${mode.padEnd(5)} open ${String(Math.round(avg(rs, (x) => x.openMs))).padStart(6)}ms` +
      `   longest block ${String(Math.round(avg(rs, (x) => x.open.longest))).padStart(5)}ms` +
      `   nodes ${Math.round(avg(rs, (x) => x.nodes.document)).toLocaleString().padStart(8)}` +
      `   blocked/${PLAY_MS / 1000}s ${(avg(rs, (x) => x.play.blocked) / 1000).toFixed(2)}s` +
      `   heap ${Math.round(avg(rs, (x) => x.heapMb))}MB`
  );
}

console.log(`\n=== what the flow costs over RSVP ===`);
console.log(`  open                  ${Math.round(d((x) => x.openMs))}ms`);
console.log(`  longest single block  ${Math.round(d((x) => x.open.longest))}ms`);
console.log(
  `  blocked per ${PLAY_MS / 1000}s      ${(d((x) => x.play.blocked) / 1000).toFixed(2)}s`
);
console.log(`  heap                  ${Math.round(d((x) => x.heapMb))}MB`);
console.log(`  nodes                 ${Math.round(d((x) => x.nodes.document)).toLocaleString()}`);

// The only assertions here. Everything above is a difference against the RSVP
// arm, and both of these are ways that difference silently becomes a comparison
// of the flow with itself.
const rsvpSpans = results.rsvp.reduce((s, x) => s + x.spansOnWarmup, 0);
const flowSpans = results.flow.reduce((s, x) => s + x.spansOnWarmup, 0);
const nodeGap = Math.round(d((x) => x.nodes.document));
console.log(`\n=== control ===`);
console.log(`  word spans laid out by the rsvp arm before opening: ${rsvpSpans}   (must be 0)`);
console.log(`  word spans laid out by the flow arm: ${flowSpans}   (must be > 0)`);
console.log(`  nodes the flow adds over rsvp: ${nodeGap.toLocaleString()}   (must be > 0)`);
console.log(
  `  idle control: ${(avg(results.flow, (x) => x.idle) / 1000).toFixed(2)}s blocked per ${
    PLAY_MS / 1000
  }s with nothing loaded`
);

const broken = [];
if (rsvpSpans !== 0) broken.push("the rsvp arm rendered a flow");
if (flowSpans <= 0) broken.push("the flow arm rendered no words");
if (nodeGap <= 0) broken.push("the two arms built the same DOM");
if (broken.length) {
  console.log(`\n  CONTROL BROKEN: ${broken.join("; ")} — the differences above mean nothing.`);
  process.exit(1);
}

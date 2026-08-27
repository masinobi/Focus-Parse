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

/* ---- Report -------------------------------------------------------- */

check("no console errors", consoleErrors.length === 0, consoleErrors[0] ?? "");

await browser.close();

console.log(`\n=== probe ===`);
console.log(`  document: ${sample.f} (${Math.round(sample.size / 1024)}KB)`);
console.log(`  clock at first question: ${clockAtStart ?? "—"}`);
console.log(`  screenshots: .probe-graph.png, .probe-exam.png, .probe-sql.png, .probe-blueprint.png (in scripts/)`);
console.log(`  failures: ${failures.length}   (must be 0)`);
if (failures.length) {
  for (const f of failures) console.log(`    - ${f}`);
  process.exit(1);
}

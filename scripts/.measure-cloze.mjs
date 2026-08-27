import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
const OUT = process.argv[3];
const load = createRequire(import.meta.url);
const { parseDocument } = load(join(OUT, "parse.js"));
const { assemble, isBoldFont } = load(join(OUT, "pdf.js"));
const { buildCloze, isStructuralReference, BLANK } = load(join(OUT, "quiz.js"));
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const dir = process.argv[2];
const STEP = 250;

async function pagesOf(path) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), isEvalSupported: false, useSystemFonts: true }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const styles = content.styles ?? {};
    const items = [];
    for (const raw of content.items) {
      if (!("str" in raw) || !raw.str.trim()) continue;
      const size = Math.abs(raw.transform[3]) || Math.abs(raw.transform[0]) || 10;
      const x = raw.transform[4];
      const family = styles[raw.fontName]?.fontFamily ?? "unknown";
      items.push({ str: raw.str, x, xEnd: x + (raw.width ?? 0), y: raw.transform[5], size, family, bold: isBoldFont(family) });
    }
    pages.push({ items, width: viewport.width, height: viewport.height });
    page.cleanup();
  }
  await doc.destroy();
  return pages;
}

let windows = 0, checks = 0, blanks = 0, structural = 0, leaked = 0;
const samples = [];
for (const f of readdirSync(dir).filter((x) => /\.(pdf|md)$/i.test(x))) {
  const src = /\.pdf$/i.test(f) ? assemble(await pagesOf(join(dir, f))) : readFileSync(join(dir, f), "utf8");
  if (!src.trim()) continue;
  const doc = parseDocument(src, f);
  for (let from = 0; from + STEP <= doc.tokens.length; from += STEP) {
    windows++;
    const c = buildCloze(doc, from, from + STEP);
    if (!c) continue;
    checks++;
    for (const b of c.blanks) {
      blanks++;
      if (b.carrier.includes(b.answer)) leaked++;
      if (isStructuralReference(b.carrier, b.answer)) {
        structural++;
        if (samples.length < 6) samples.push(f.slice(0, 22) + "  " + JSON.stringify(b.carrier.replace(/\s+/g, " ").slice(0, 62)) + " = " + b.answer);
      }
    }
  }
}
console.log("windows walked:", windows, " produced a check:", checks, " blanks:", blanks);
console.log("blanks asking for a cross-reference:", structural,
  blanks ? "(" + ((structural / blanks) * 100).toFixed(2) + "% of blanks)" : "");
console.log("answers visible in their own carrier:", leaked);
for (const s of samples) console.log("   ", s);

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
const OUT = process.argv[3];
const load = createRequire(import.meta.url);
const { parseDocument } = load(join(OUT, "parse.js"));
const { assemble, isBoldFont } = load(join(OUT, "pdf.js"));
const { matchAcronym, spokenForm } = load(join(OUT, "acronyms.js"));
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const dir = process.argv[2];

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

let gridBlocks = 0, gridSteps = 0, stepsWithAcronym = 0, prose = 0, proseTokens = 0;
const samples = [];
for (const f of readdirSync(dir).filter((x) => /\.(pdf|md)$/i.test(x))) {
  const src = /\.pdf$/i.test(f) ? assemble(await pagesOf(join(dir, f))) : readFileSync(join(dir, f), "utf8");
  if (!src.trim()) continue;
  const doc = parseDocument(src, f);
  for (const b of doc.blocks) {
    if (b.kind !== "table" || !b.steps?.length) continue;
    gridBlocks++;
    for (const s of b.steps) {
      gridSteps++;
      const text = [s.row, s.column, s.value].filter(Boolean).join(" ");
      const hits = text.split(/\s+/).filter((w) => matchAcronym(w));
      if (hits.length) {
        stepsWithAcronym++;
        if (samples.length < 8) samples.push({ f: f.slice(0, 26), text: text.slice(0, 52), hits: hits.map((h) => h + " -> " + spokenForm(h).slice(0, 34)) });
      }
    }
  }
  for (const t of doc.tokens) { proseTokens++; if (t.acronym) prose++; }
}
console.log("grid blocks:", gridBlocks, " grid steps:", gridSteps);
console.log("grid steps containing an expanding acronym:", stepsWithAcronym,
  gridSteps ? "(" + Math.round((stepsWithAcronym / gridSteps) * 100) + "%)" : "");
console.log("acronym tokens corpus-wide:", prose, "of", proseTokens);
for (const s of samples) console.log("   ", s.f.padEnd(28), JSON.stringify(s.text), "|", s.hits.join(" ; "));

/**
 * pdf.js runs its parser in a Web Worker. Bundling that worker through webpack
 * is fragile across Next versions, so we serve it as a static asset instead and
 * keep the copy in sync with whatever pdfjs-dist version is installed.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const source = join(dirname(require.resolve("pdfjs-dist/package.json")), "build", "pdf.worker.min.mjs");
const target = join(root, "public", "pdf.worker.min.mjs");

mkdirSync(join(root, "public"), { recursive: true });
copyFileSync(source, target);
console.log(`pdf worker -> ${target}`);

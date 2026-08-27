import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The only thing this file is for: `@/` resolves.
 *
 * Every test until now lived in `src/lib`, where the modules import each other
 * relatively so the offline scanners can compile them standalone. The store
 * does not — it is application code and uses the app's own alias — so it could
 * not be imported by a test at all, and the first attempt to write one failed
 * on `Cannot find package '@/lib/db'`.
 *
 * Nothing else is configured. The default node environment is deliberate: a
 * test that needs a DOM is a test that has drifted into being a component test,
 * and this project drives components in a real browser through
 * `scripts/probe-ui.mjs` instead.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});

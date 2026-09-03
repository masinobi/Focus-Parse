/**
 * Open FocusParse for reading, from a double-click.
 *
 * `npm run study` is `next build && next start`, and the build is about forty
 * seconds. Paying that every time the reader wants to sit down and read is how
 * a person ends up typing `npm run dev` instead — which is the whole problem
 * this script exists downstream of, because the development bundle costs two to
 * three times as much to read a 524-page book in. See "What a long document
 * costs" in CLAUDE.md.
 *
 * So: build only when something has actually changed, then serve, then open the
 * browser once the server really answers.
 *
 * **The staleness check must never skip a rebuild onto a development build.**
 * That would silently hand the reader the slow bundle behind a script whose
 * entire purpose is to avoid it, and nothing on screen would say so. The test
 * is `.next/BUILD_ID`, and it is safe for a measured reason: `next dev` deletes
 * `BUILD_ID`, `prerender-manifest.json` and `export-marker.json` on startup.
 * Checked by running `next dev` over a production build and watching all three
 * disappear. So the marker's presence means a production build, and a dev run
 * is indistinguishable from no build at all — which is the safe direction to
 * fail in.
 */
import { spawn, spawnSync } from "node:child_process";
import { createConnection } from "node:net";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT) || 3000;
const URL = `http://localhost:${PORT}`;
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

/** Everything whose change should invalidate a build. */
const WATCH_DIRS = ["src", "public"];
const WATCH_FILES = [
  "package.json",
  "package-lock.json",
  "next.config.mjs",
  "tailwind.config.ts",
  "postcss.config.mjs",
  "tsconfig.json",
  // NEXT_PUBLIC_* values are inlined at build time. A key change is rare and a
  // needless rebuild is cheaper than a stale one.
  ".env.local",
];

function newestMtime(path) {
  if (!existsSync(path)) return 0;
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = stat.mtimeMs;
  for (const entry of readdirSync(path)) {
    newest = Math.max(newest, newestMtime(join(path, entry)));
  }
  return newest;
}

function portInUse(port) {
  return new Promise((done) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    const settle = (answer) => {
      socket.destroy();
      done(answer);
    };
    socket.setTimeout(1200);
    socket.on("connect", () => settle(true));
    socket.on("error", () => settle(false));
    socket.on("timeout", () => settle(false));
  });
}

/**
 * Which build is answering on this port, by asking it.
 *
 * Next states this in the page it serves: the RSC payload carries
 * `buildId\":\"development\"` from `next dev` and `buildId\":\"<hash>\"` from a
 * production build, and the string "development" appears nowhere else in a
 * production page. Checked both ways by serving each and reading the bytes,
 * rather than inferred from chunk-name shapes, which change between Next
 * versions.
 *
 * `null` means something answered but was not a Next app, or nothing answered.
 */
async function servingBuild(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const found = /buildId\\?":\\?"([^"\\]+)/.exec(await res.text());
    return found ? found[1] : null;
  } catch {
    return null;
  }
}

async function serverAnswers(url, attempts) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

function openBrowser(url) {
  if (process.platform === "win32") {
    // The empty "" is the window title `start` would otherwise take the URL as.
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
  } else if (process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  }
}

/**
 * Wrapped in a function so the success paths can `return`.
 *
 * `process.exit()` immediately after spawning the detached browser tears down
 * a libuv handle that is still initializing, and Windows aborts the process
 * with "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" *after* the
 * message the reader wanted. Found by running it. Only the failure paths exit
 * hard, and none of those has spawned anything.
 */
async function main() {
  // Plain ASCII in everything this script prints itself, so a machine where the
  // codepage switch does not take still reads correctly. The .cmd sets UTF-8 for
  // Next's own box-drawing output, which is not ours to change.
  console.log("\n  FocusParse - study mode\n");

  if (!existsSync(join(root, "node_modules"))) {
    console.error("  Dependencies are not installed. Run `npm install` here first.\n");
    process.exitCode = 1;
    return;
  }

  const buildId = join(root, ".next", "BUILD_ID");
  const builtAt = existsSync(buildId) ? statSync(buildId).mtimeMs : 0;
  const currentBuild = builtAt ? readFileSync(buildId, "utf8").trim() : null;

  // Something on the port is not automatically a problem, and refusing outright
  // would make the common case a dead end: close the window without the server
  // dying, click again, get told no. So ask what is answering.
  if (await portInUse(PORT)) {
    const serving = await servingBuild(URL);

    if (serving === "development") {
      console.error(
        `  \`npm run dev\` is already serving port ${PORT}.\n\n` +
          `  Stop it before studying. The development build costs two to three\n` +
          `  times as much to read a long document in, which is the whole reason\n` +
          `  this script exists, and it cannot replace a server it did not start.\n`
      );
      process.exitCode = 1;
      return;
    }

    if (serving) {
      console.log(`  A production build is already serving ${URL}. Opening it.\n`);
      if (currentBuild && serving !== currentBuild) {
        console.log(
          `  It is not the newest build here. Close its window and click again\n` +
            `  if you want your latest changes.\n`
        );
      }
      openBrowser(URL);
      return;
    }

    console.error(
      `  Something that is not FocusParse is using port ${PORT}.\n\n` +
        `  Stop it, or set a different port:  set PORT=3001\n`
    );
    process.exitCode = 1;
    return;
  }

  const changedAt = Math.max(
    ...WATCH_DIRS.map((d) => newestMtime(join(root, d))),
    ...WATCH_FILES.map((f) => newestMtime(join(root, f)))
  );

  if (builtAt === 0) {
    console.log("  No production build here yet - building. This takes about a minute.\n");
  } else if (changedAt > builtAt) {
    console.log("  Something changed since the last build - rebuilding.\n");
  } else {
    console.log("  Build is current. Starting straight up.\n");
  }

  if (builtAt === 0 || changedAt > builtAt) {
    const built = spawnSync(npm, ["run", "build"], {
      cwd: root,
      stdio: "inherit",
      shell: true,
    });
    if (built.status !== 0) {
      console.error("\n  The build failed. Nothing was started.\n");
      process.exitCode = built.status ?? 1;
      return;
    }
  }

  console.log(`\n  Serving ${URL}\n  Close this window to stop.\n`);

  const server = spawn(npm, ["run", "start"], { cwd: root, stdio: "inherit", shell: true });
  server.on("exit", (code) => {
    process.exitCode = code ?? 0;
  });

  if (await serverAnswers(URL, 40)) {
    openBrowser(URL);
  } else {
    console.error(`\n  The server did not answer on ${URL}. Leaving it running.\n`);
  }
}

await main();

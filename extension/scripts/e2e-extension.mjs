/**
 * Real-extension E2E: relaunch the dedicated CDP Chrome (profile preserved, so
 * the Naver session carries over) with the unpacked extension loaded, then drive
 * the actual workspace flow end to end:
 *   board tab -> workspace tab -> free preview collection -> export worker ->
 *   .xlsx download -> validate the workbook.
 *
 * Usage: node scripts/e2e-extension.mjs
 * Env:
 *   KEEP_CHROME=1  reuse an existing 9222 session (must already have the ext loaded)
 *   EXT_ID=<id>    extension id when the MV3 worker is dormant
 *   BOARD_URL=...  board to collect from
 */
import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, strFromU8 } from "fflate";

const require = createRequire("/home/giwan/Projects/reviewboost/package.json");
const { chromium } = require("playwright");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXT_DIR = resolve(root, "dist");
const PORT = 9222;
const PROFILE = `${process.env.HOME}/chrome-cdp-profile`;
const OUT = "/tmp/nce-spike";
mkdirSync(OUT, { recursive: true });

const BOARD_URL = process.env.BOARD_URL || "https://cafe.naver.com/f-e/cafes/10094408/menus/90";
const BOARD_NEEDLE = "menus/90";

async function cdpAlive() {
  return new Promise((r) => {
    import("node:net").then((net) => {
      const s = net.connect(PORT, "127.0.0.1");
      s.once("connect", () => { s.destroy(); r(true); });
      s.once("error", () => r(false));
    });
  });
}

const KEEP = process.env.KEEP_CHROME === "1";
let chrome = null;
if (KEEP) {
  if (!(await cdpAlive())) { console.error("KEEP_CHROME=1 but no 9222 session"); process.exit(9); }
} else {
  try { execSync('pkill -f "chrome-cdp-profile" || true'); } catch { /* none */ }
  await new Promise((r) => setTimeout(r, 1800));
  chrome = spawn(
    "/usr/lib/chromium/chromium",
    [
      `--user-data-dir=${PROFILE}`,
      "--class=cdpchrome",
      "--no-first-run",
      "--no-default-browser-check",
      `--remote-debugging-port=${PORT}`,
      `--load-extension=${EXT_DIR}`,
      "--ozone-platform=wayland",
      "about:blank"
    ],
    { stdio: "ignore", detached: true }
  );
  chrome.unref();
  console.log("launched chromium pid", chrome.pid);
}

let browser = null;
for (let i = 0; i < 40 && !browser; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); } catch { /* retry */ }
}
if (!browser) { console.error("CDP connect failed"); process.exit(2); }
const ctx = browser.contexts()[0];

let extId = process.env.EXT_ID || null;
if (!extId) {
  for (let i = 0; i < 30 && !extId; i++) {
    const sw = ctx.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"));
    if (sw) extId = new URL(sw.url()).host;
    if (!extId) await new Promise((r) => setTimeout(r, 500));
  }
}
if (!extId) { console.error("extension id unknown (set EXT_ID=...)"); process.exit(3); }
console.log("extension id:", extId);

// 1) open the cafe board as a normal top-level tab (content script injects there)
const boardPage = await ctx.newPage();
await boardPage.goto(BOARD_URL, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
await boardPage.waitForTimeout(6000);
const boardTitle = await boardPage.title();
const articleCount = await boardPage.$$eval('a[href*="/articles/"]', (els) => els.length).catch(() => 0);
console.log("board:", boardTitle.slice(0, 40), "| article links:", articleCount);

// 2) open an extension page (wakes the workspace), find the board tab id, then
//    navigate that page to the workspace with explicit context.
const wsPage = await ctx.newPage();
await wsPage.goto(`chrome-extension://${extId}/workspace.html`, { waitUntil: "domcontentloaded" });
const chromeTabId = await wsPage.evaluate(
  (needle) =>
    new Promise((res) => chrome.tabs.query({}, (tabs) => res(tabs.find((t) => t.url && t.url.includes(needle))?.id ?? -1))),
  BOARD_NEEDLE
);
console.log("chrome tab id:", chromeTabId);
if (chromeTabId < 0) { console.error("board tab not found via chrome.tabs"); process.exit(4); }

const params = new URLSearchParams({
  tabId: String(chromeTabId),
  cafeId: (BOARD_URL.match(/cafes\/(\d+)/) || [])[1] || "",
  boardId: BOARD_NEEDLE.split("/")[1] || "",
  cafeName: "soho",
  boardName: "자유 수다 게시판"
});
await wsPage.goto(`chrome-extension://${extId}/workspace.html?${params.toString()}`, { waitUntil: "domcontentloaded" });
await wsPage.waitForTimeout(1800);

await wsPage.fill("#max-posts", "5").catch(() => {});
await wsPage.uncheck("#include-members").catch(() => {});
const startBtn = wsPage.locator("#btn-preview");
console.log("preview button enabled:", await startBtn.isEnabled().catch(() => false));
await startBtn.click();

let summary = "";
for (let i = 0; i < 60; i++) {
  await wsPage.waitForTimeout(1000);
  summary = (await wsPage.locator("#result-summary").textContent().catch(() => "")) || "";
  const hidden = await wsPage.locator("#result").evaluate((el) => el.classList.contains("hidden")).catch(() => true);
  if (!hidden && /게시글\s*\d/.test(summary)) break;
  const err = await wsPage.locator("#error-text").textContent().catch(() => "");
  const errHidden = await wsPage.locator("#error").evaluate((el) => el.classList.contains("hidden")).catch(() => true);
  if (err && !errHidden) { console.log("ERROR:", err); break; }
}
console.log("result summary:", summary);

// 3) download the workbook
let xlsxPath = null;
try {
  const [download] = await Promise.all([
    wsPage.waitForEvent("download", { timeout: 30000 }),
    wsPage.locator("#btn-download").click()
  ]);
  xlsxPath = `${OUT}/ext-e2e-${Date.now()}.xlsx`;
  await download.saveAs(xlsxPath);
} catch (e) {
  console.log("download failed:", e.message.slice(0, 120));
}

if (xlsxPath) {
  const bytes = new Uint8Array(readFileSync(xlsxPath));
  const files = unzipSync(bytes);
  const wb = strFromU8(files["xl/workbook.xml"]);
  const sheets = [...wb.matchAll(/name="([^"]+)"/g)].map((m) => m[1]);
  const sst = strFromU8(files["xl/sharedStrings.xml"]);
  console.log("downloaded:", xlsxPath, bytes.length, "bytes");
  console.log("workbook sheets:", sheets);
  console.log("has real cafe data:", /10094408/.test(sst));
}

console.log("EXTENSION E2E DONE");
if (!KEEP && chrome) { try { process.kill(chrome.pid, "SIGTERM"); } catch { /* gone */ } }
await browser.close().catch(() => {});

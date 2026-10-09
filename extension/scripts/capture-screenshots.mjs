/**
 * Capture real store screenshots from the loaded extension + generate banner
 * assets. Relaunches the dedicated CDP Chrome with the unpacked build.
 *
 * Usage: node scripts/capture-screenshots.mjs
 * Output: store-assets/*.png
 */
import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire("/home/giwan/Projects/reviewboost/package.json");
const { chromium } = require("playwright");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXT_DIR = resolve(root, "dist");
const PORT = 9222;
const PROFILE = `${process.env.HOME}/chrome-cdp-profile`;
const OUT = resolve(root, "store-assets");
mkdirSync(OUT, { recursive: true });

try { execSync('pkill -f "chrome-cdp-profile" || true'); } catch { /* none */ }
await new Promise((r) => setTimeout(r, 1800));
const chrome = spawn(
  "/usr/lib/chromium/chromium",
  [`--user-data-dir=${PROFILE}`, "--class=cdpchrome", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${PORT}`, `--load-extension=${EXT_DIR}`, "--ozone-platform=wayland", "about:blank"],
  { stdio: "ignore", detached: true }
);
chrome.unref();

let browser = null;
for (let i = 0; i < 40 && !browser; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); } catch { /* retry */ }
}
const ctx = browser.contexts()[0];
let extId = null;
for (let i = 0; i < 30 && !extId; i++) {
  const sw = ctx.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"));
  if (sw) extId = new URL(sw.url()).host;
  if (!extId) await new Promise((r) => setTimeout(r, 500));
}
if (!extId) { console.error("extension id not found"); process.exit(3); }
console.log("extension id:", extId);

async function shot(page, path) {
  try {
    const cdp = await page.context().newCDPSession(page);
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path, Buffer.from(data, "base64"));
    await cdp.detach().catch(() => {});
    console.log("saved", path);
  } catch (e) {
    console.log("shot failed", path, e.message.slice(0, 80));
  }
}

async function shotEl(locator, path) {
  try {
    await locator.screenshot({ path, animations: "disabled", timeout: 15000 });
    console.log("saved", path);
  } catch (e) {
    console.log("shot failed", path, e.message.slice(0, 80));
  }
}

async function run() {
  // 1) real workspace screenshot
  const board = await ctx.newPage();
  await board.goto("https://cafe.naver.com/f-e/cafes/10094408/menus/90", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await board.waitForTimeout(6000);

  const ws = await ctx.newPage();
  await ws.setViewportSize({ width: 1280, height: 800 });
  await ws.goto(`chrome-extension://${extId}/workspace.html`, { waitUntil: "domcontentloaded" });
  const tabId = await ws.evaluate((needle) => new Promise((res) => chrome.tabs.query({}, (t) => res(t.find((x) => x.url && x.url.includes(needle))?.id ?? -1))), "menus/90");
  const params = new URLSearchParams({ tabId: String(tabId), cafeId: "10094408", boardId: "90", cafeName: "셀러오션", boardName: "자유 수다 게시판" });
  await ws.goto(`chrome-extension://${extId}/workspace.html?${params}`, { waitUntil: "domcontentloaded" });
  await ws.waitForTimeout(1500);
  await ws.fill("#max-posts", "5").catch(() => {});
  await ws.uncheck("#include-members").catch(() => {});
  await ws.click("#btn-preview");
  for (let i = 0; i < 60; i++) {
    await ws.waitForTimeout(1000);
    const hidden = await ws.locator("#result").evaluate((el) => el.classList.contains("hidden")).catch(() => true);
    if (!hidden) break;
  }
  await ws.waitForTimeout(1200);
  await shot(ws, resolve(OUT, "screenshot-1-workspace.png"));

  // 2) popup screenshot
  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 360, height: 560 });
  await popup.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: "domcontentloaded" });
  await popup.waitForTimeout(1500);
  await shot(popup, resolve(OUT, "screenshot-2-popup.png"));

  // 3) board context screenshot (Chrome requires 1280x800)
  await board.setViewportSize({ width: 1280, height: 800 });
  await shot(board, resolve(OUT, "screenshot-3-board.png"));

  // 4) banner assets (marquee 1400x560, promo tile 440x280)
  const banner = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
body{margin:0;font-family:-apple-system,"Malgun Gothic",sans-serif}
.mq{width:1400px;height:560px;background:linear-gradient(135deg,#03c75a 0%,#02a94b 60%,#017a37 100%);color:#fff;display:flex;flex-direction:column;justify-content:center;padding:0 90px;box-sizing:border-box}
.mq h1{font-size:62px;margin:0 0 12px;letter-spacing:-1px}
.mq p{font-size:26px;margin:0;opacity:.95}
.mq .tags{margin-top:26px;font-size:20px;opacity:.9}
.tile{width:440px;height:280px;background:linear-gradient(135deg,#03c75a,#017a37);color:#fff;display:flex;flex-direction:column;justify-content:center;align-items:center;box-sizing:border-box;text-align:center;font-family:-apple-system,"Malgun Gothic",sans-serif}
.tile .t{font-size:30px;font-weight:800;margin-bottom:8px}
.tile .s{font-size:15px;opacity:.95}
</style></head><body>
<div class="mq"><h1>네이버 카페 데이터 → 엑셀</h1><p>게시글·댓글·작성자(권한 시 회원)를 .xlsx로 저장</p><div class="tags">수집 데이터는 내 컴퓨터에만 · 공개 콘텐츠는 로그인 없이</div></div>
<div class="tile"><div class="t">카페 엑셀 내보내기</div><div class="s">게시글·댓글·작성자 → .xlsx</div></div>
</body></html>`;
  const bannerPage = await ctx.newPage();
  await bannerPage.setContent(banner, { waitUntil: "load" });
  await shotEl(bannerPage.locator(".mq"), resolve(OUT, "marquee-1400x560.png"));
  await shotEl(bannerPage.locator(".tile"), resolve(OUT, "promo-tile-440x280.png"));
}

try {
  await run();
} finally {
  await browser.close().catch(() => {});
  try { process.kill(chrome.pid, "SIGTERM"); } catch { /* gone */ }
  console.log("screenshots done ->", OUT);
}


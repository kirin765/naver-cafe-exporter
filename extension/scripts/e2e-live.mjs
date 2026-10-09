/**
 * Live E2E against a real Naver Cafe via CDP (port 9222).
 *
 * Bundles scripts/live-harness.ts, then drives the real collector/export pipeline
 * with live board HTML + article/comment JSON fetched from the authenticated
 * session. Produces a real .xlsx and prints counts.
 *
 * Usage: node scripts/e2e-live.mjs [cafeVanity] [menuId] [maxPosts]
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const require = createRequire("/home/giwan/Projects/reviewboost/package.json");
const { chromium } = require("playwright");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = "/tmp/nce-spike";
mkdirSync(OUT, { recursive: true });

const vanity = process.argv[2] || "soho";
const menuId = process.argv[3] || "90";
const maxPosts = Number(process.argv[4] || "10");
const maxComments = 30;

// 1) bundle the harness (esbuild from the extension's node_modules)
await build({
  entryPoints: [resolve(root, "scripts/live-harness.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["jsdom"],
  outfile: resolve(root, "scripts", ".live-harness.mjs")
});
const harness = await import(`${resolve(root, "scripts", ".live-harness.mjs")}?t=${Date.now()}`);

// 2) connect CDP and locate the cafe page (or open one)
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = browser.contexts()[0];
let page = ctx.pages().find((p) => p.url().includes(vanity));
if (!page) {
  page = ctx.pages()[0];
  await page.goto(`https://cafe.naver.com/${vanity}`, { waitUntil: "domcontentloaded", timeout: 60000 });
}

const cafeFrame = () =>
  page.frames().find((f) => /\/f-e\/cafes\/\d+/.test(f.url())) ||
  page.frames().find((f) => /cafe\.naver\.com/.test(f.url()) && f !== page.mainFrame());

// 3) navigate to the board and capture real info
await page.goto(`https://cafe.naver.com/f-e/cafes/10094408/menus/${menuId}`, {
  waitUntil: "domcontentloaded",
  timeout: 60000
}).catch(() => {});
await page.waitForTimeout(5000);

// resolve cafeId from the menu page URL
const boardUrl = () => {
  const f = page.frames().find((x) => /menus\/\d+/.test(x.url())) || cafeFrame();
  return f ? f.url() : page.url();
};
const cafeId = (boardUrl().match(/cafes\/(\d+)/) || [])[1];
if (!cafeId) {
  console.error("cafeId not resolved from", boardUrl());
  process.exit(2);
}
console.log("cafeId", cafeId, "menuId", menuId);

async function gotoBoardPage(n) {
  const f = page.frames().find((x) => /menus\/\d+/.test(x.url())) || cafeFrame();
  if (n > 1) {
    const before = await f.evaluate(() => document.querySelector('a[href*="/articles/"]')?.getAttribute("href") || "");
    await f.evaluate((target) => {
      const btn = Array.from(document.querySelectorAll("button, a")).find((b) => (b.textContent || "").trim() === String(target));
      if (btn) btn.click();
    }, n);
    await page.waitForTimeout(3500);
  }
  const html = await f.content();
  return { html, url: f.url() };
}

const source = {
  board: (pageNo) => gotoBoardPage(pageNo),
  article: async (postId) => {
    const f = cafeFrame();
    return f.evaluate(async (args) => {
      const r = await fetch(args.url, { credentials: "include", headers: { accept: "application/json" } });
      return r.json();
    }, {
      url: `https://article.cafe.naver.com/gw/v4/cafes/${cafeId}/articles/${postId}?query=&menuId=${menuId}&useCafeId=true&requestFrom=A`
    });
  },
  comments: async (postId, pageNo) => {
    const f = cafeFrame();
    return f.evaluate(async (args) => {
      const r = await fetch(args.url, { credentials: "include", headers: { accept: "application/json" } });
      return r.json();
    }, {
      url: `https://article.cafe.naver.com/gw/v4/cafes/${cafeId}/articles/${postId}/comments/pages/${pageNo}?requestFrom=A&orderBy=asc`
    });
  }
};

const filters = {
  cafeId,
  boardId: menuId,
  boardName: "라이브 테스트",
  dateFrom: null,
  dateTo: null,
  maxPosts,
  includeComments: process.argv[5] !== "nocomments",
  includeBody: true,
  includeMembers: false
};

const outPath = `${OUT}/${vanity}-${Date.now()}.xlsx`;
const result = await harness.runLive(source, {
  filters,
  cafeId,
  menuId,
  articleUrl: (postId) => `https://cafe.naver.com/f-e/cafes/${cafeId}/articles/${postId}?menuid=${menuId}`,
  outPath,
  maxPosts,
  maxComments
});

console.log("RESULT:", JSON.stringify(result, null, 2));
console.log("workbook:", outPath, existsSync(outPath) ? "(" + result.workbookBytes + " bytes)" : "MISSING");
writeFileSync(`${OUT}/${vanity}-summary.json`, JSON.stringify(result, null, 2));
await browser.close().catch(() => {});

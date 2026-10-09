import { build } from "esbuild";
import { copyFileSync, cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = (process.argv[2] || "chrome").toLowerCase();

if (!["chrome", "firefox", "all"].includes(target)) {
  console.error(`unknown build target "${target}" — expected chrome | firefox | all`);
  process.exit(1);
}

/**
 * Chrome(MV3 service worker)과 Firefox(MV3 event page)는 manifest/background
 * 형태가 다르다. 각 엔트리는 자체 완결 IIFE로 번들되어 런타임 import가 없다.
 * Firefox는 promise 기반 `browser.*`를 쓰므로 `lib/webext.ts`가 chrome으로 별칭한다.
 */
const entries = [
  { in: "src/content/index.ts", out: "content" },
  { in: "src/background/service-worker.ts", out: "service-worker" },
  { in: "src/popup/popup.ts", out: "popup" },
  { in: "src/workspace/workspace.ts", out: "workspace" },
  { in: "src/workspace/export-worker.ts", out: "export-worker" }
];

async function buildBrowser(browser) {
  const isFirefox = browser === "firefox";
  const outdir = resolve(root, isFirefox ? "dist-firefox" : "dist");

  rmSync(outdir, { recursive: true, force: true });
  mkdirSync(outdir, { recursive: true });

  await Promise.all(
    entries.map((e) =>
      build({
        entryPoints: [resolve(root, e.in)],
        outfile: resolve(outdir, `${e.out}.js`),
        bundle: true,
        format: "iife",
        target: isFirefox ? "firefox115" : "chrome110",
        minify: true,
        legalComments: "none"
      })
    )
  );

  cpSync(resolve(root, "public"), outdir, { recursive: true });
  rmSync(resolve(outdir, "manifest.firefox.json"), { force: true });
  if (isFirefox) {
    copyFileSync(resolve(root, "public", "manifest.firefox.json"), resolve(outdir, "manifest.json"));
  }
  console.log(`built ${browser} -> ${outdir}`);
}

if (target === "chrome" || target === "all") await buildBrowser("chrome");
if (target === "firefox" || target === "all") await buildBrowser("firefox");

import { zipSync } from "fflate";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** dist-firefox/ 를 AMO 제출용 ZIP 으로 묶는다 (manifest가 ZIP 루트). */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist-firefox");
const manifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));

const files = {};
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else files[relative(dist, full).split(sep).join("/")] = readFileSync(full);
  }
};
walk(dist);

const out = resolve(root, `naver-cafe-exporter-firefox-v${manifest.version}.zip`);
writeFileSync(out, zipSync(files, { level: 9 }));
console.log(`packaged firefox -> ${out}`);

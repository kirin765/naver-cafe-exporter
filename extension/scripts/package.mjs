import { zipSync } from "fflate";
import { readFileSync, readdirSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * dist/ 를 스토어 제출용 ZIP 으로 묶는다 (manifest가 ZIP 루트). Node 내장 zip이
 * 없어 이미 의존성인 fflate를 쓴다. Chrome/Edge/Whale은 동일 MV3 빌드를 공유하므로
 * 같은 zip을 복사해 이름만 바꾼다.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function zipDir(dist) {
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
  return { manifest, bytes: zipSync(files, { level: 9 }) };
}

const { manifest, bytes } = zipDir(resolve(root, "dist"));
const base = `naver-cafe-exporter-v${manifest.version}`;
const chromeZip = resolve(root, `${base}.zip`);
writeFileSync(chromeZip, bytes);
copyFileSync(chromeZip, resolve(root, `${base}-edge.zip`));
copyFileSync(chromeZip, resolve(root, `${base}-whale.zip`));
console.log(`packaged chrome/edge/whale -> ${chromeZip} (+ -edge, -whale)`);

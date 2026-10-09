import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  server: {
    fs: {
      // Allow importing sanitized fixtures from the repository-root fixtures/ dir.
      allow: [root, resolve(root, "..")]
    }
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "jsdom"
  }
});

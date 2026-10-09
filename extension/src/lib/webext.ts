/**
 * Cross-browser shim.
 *
 * Chrome MV3 exposes the promise-based `chrome.*` namespace. Firefox exposes the
 * promise-based `browser.*` namespace (its `chrome.*` is callback-only in most
 * APIs). Bundling this first and, on Firefox, aliasing `chrome` to `browser`
 * lets the same application code run on both engines.
 */
declare const browser: unknown;

const g = globalThis as unknown as { browser?: unknown; chrome?: unknown };
if (typeof g.browser !== "undefined") {
  g.chrome = g.browser;
}

export {};

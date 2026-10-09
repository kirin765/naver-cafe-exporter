/**
 * Extension-wide constants.
 *
 * PRODUCT_ORIGIN is a placeholder for the still-undecided product domain
 * (plan.md section 10). Change it here and in public/manifest.json together.
 */
export const PRODUCT_ORIGIN = "https://naver-cafe-exporter.onnurimun.com";

export const API = {
  linkStart: `${PRODUCT_ORIGIN}/api/extension/link/start`,
  linkRedeem: `${PRODUCT_ORIGIN}/api/extension/link/redeem`,
  linkStatus: `${PRODUCT_ORIGIN}/api/extension/link/status`,
  entitlement: `${PRODUCT_ORIGIN}/api/entitlement`,
  checkout: `${PRODUCT_ORIGIN}/api/billing/checkout`,
  portal: `${PRODUCT_ORIGIN}/api/billing/portal`
} as const;

export const CONNECT_PAGE = `${PRODUCT_ORIGIN}/extension-connect`;

/** chrome.storage.local keys. Keep every key prefixed with `nce_`. */
export const STORAGE_KEYS = {
  auth: "nce_auth",
  entitlement: "nce_entitlement",
  prefs: "nce_prefs",
  historyMirror: "nce_history_mirror"
} as const;

/** IndexedDB database name + generation. Bump generation to invalidate. */
export const DB_NAME = "nce_store";
export const DB_GENERATION = 1;

export const EXTENSION_VERSION = "0.1.0";

/** Conservative per-request throttle while running a collection (not a claim about Naver's limit). */
export const REQUEST_DELAY_MIN_MS = 1000;
export const REQUEST_DELAY_MAX_MS = 2000;

/** Timezone used for date filtering and display normalization. */
export const TIMEZONE = "Asia/Seoul";

/** Entitlement cache lifetime (bounded by plan: at most 24h, never past the paid/grace deadline). */
export const ENTITLEMENT_CACHE_MS = 24 * 60 * 60 * 1000;

/** Grace window the UI explains for past_due renewals (server decides actual access). */
export const GRACE_MS = 3 * 24 * 60 * 60 * 1000;

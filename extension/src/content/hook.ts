/**
 * MAIN-world capture hook for Naver Cafe's internal JSON requests.
 *
 * Content scripts run in an isolated world and cannot see the page's fetch/XHR.
 * The service worker injects `captureHookMainWorld` with
 * `chrome.scripting.executeScript({ world: "MAIN" })`; it records the most recent
 * matching request descriptor on a DOM attribute the isolated content script can
 * read. The content script then replays that request with its own page cursor.
 *
 * The captured endpoint is a replaceable adapter, not a stable contract.
 */

export type CapturedRequest = {
  url: string;
  method: string;
  body: string | null;
  headers: Record<string, string>;
};

const CAPTURE_ATTR = "data-nce-capture";

/** Runs in the page's MAIN world. Must be self-contained (serialized as a function). */
export function captureHookMainWorld(): void {
  const w = window as unknown as Record<string, unknown>;
  if (w.__nceCaptureInstalled) return;
  w.__nceCaptureInstalled = true;

  const setCapture = (url: unknown, method: unknown, body: unknown, headers: unknown): void => {
    try {
      const normalised: Record<string, string> = {};
      if (headers && typeof headers === "object") {
        for (const [k, v] of Object.entries(headers as Record<string, unknown>)) normalised[k] = String(v);
      }
      document.documentElement.setAttribute(
        CAPTURE_ATTR,
        JSON.stringify({
          url: String(url),
          method: String(method || "GET").toUpperCase(),
          body: typeof body === "string" ? body : null,
          headers: normalised,
          capturedAt: Date.now()
        })
      );
    } catch {
      /* quota or serialization failure is non-fatal */
    }
  };

  const shouldCapture = (url: string): boolean =>
    /ArticleList\.nhn|ArticleRead\.nhn|\/articles(\?|\/|$)|comment|member|menu/i.test(url);

  const proto = XMLHttpRequest.prototype;
  const origOpen = proto.open;
  proto.open = function (this: XMLHttpRequest & { __nceUrl?: string; __nceMethod?: string; __nceHeaders?: Record<string, string> }, method: string, url: string | URL) {
    try {
      this.__nceUrl = String(url);
      this.__nceMethod = String(method);
      this.__nceHeaders = {};
    } catch {
      /* ignore */
    }
    return origOpen.apply(this, arguments as never);
  };
  const origSet = proto.setRequestHeader;
  proto.setRequestHeader = function (this: XMLHttpRequest & { __nceHeaders?: Record<string, string> }, key: string, value: string) {
    try {
      if (this.__nceHeaders) this.__nceHeaders[String(key)] = String(value);
    } catch {
      /* ignore */
    }
    return origSet.apply(this, arguments as never);
  };
  const origSend = proto.send;
  proto.send = function (this: XMLHttpRequest & { __nceUrl?: string; __nceMethod?: string; __nceHeaders?: Record<string, string> }, body?: Document | XMLHttpRequestBodyInit | null) {
    try {
      const url = this.__nceUrl ?? "";
      if (url && shouldCapture(url)) {
        setCapture(url, this.__nceMethod || "GET", typeof body === "string" ? body : null, this.__nceHeaders);
      }
    } catch {
      /* ignore */
    }
    return origSend.apply(this, arguments as never);
  };

  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
      try {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input?.url ?? "";
        if (url && shouldCapture(url)) {
          setCapture(url, (init?.method ?? "GET") as string, init?.body, init?.headers);
        }
      } catch {
        /* ignore */
      }
      return origFetch.apply(this, arguments as never);
    };
  }
}

/** content script → service worker: install the MAIN-world hook. */
export function installCaptureHook(): void {
  try {
    void chrome.runtime.sendMessage({ type: "INSTALL_HOOK" } as never).catch(() => {});
  } catch {
    /* SW cold start is fine; the DOM path still works */
  }
}

export function readCapturedRequest(): CapturedRequest | null {
  try {
    const raw = document.documentElement.getAttribute(CAPTURE_ATTR);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CapturedRequest> & { capturedAt?: number };
    if (!parsed.url) return null;
    return {
      url: parsed.url,
      method: parsed.method ?? "GET",
      body: parsed.body ?? null,
      headers: parsed.headers ?? {}
    };
  } catch {
    return null;
  }
}

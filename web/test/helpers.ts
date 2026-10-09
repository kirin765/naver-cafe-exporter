import type { AddressInfo } from "node:net";
import { loadConfig, type Config } from "../src/config";
import { openDb, type Store } from "../src/db";
import { FakePaddleClient, type PaddleClient } from "../src/paddle";
import { createServer, type Deps } from "../src/handlers";
import type { Mailer } from "../src/mail";

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    ...loadConfig({}),
    appBaseUrl: "http://127.0.0.1",
    paddleEnv: "sandbox",
    paddleApiKey: "test_key",
    paddleWebhookSecret: "whsec_test",
    paddlePriceId: "pri_test",
    dbPath: ":memory:",
    devLogEmail: true,
    ...overrides
  };
}

export type TestServer = {
  base: string;
  store: Store;
  paddle: FakePaddleClient;
  config: Config;
  nowRef: { value: number };
  deps: Deps;
  close: () => Promise<void>;
};

export async function boot(opts: {
  config?: Partial<Config>;
  paddle?: FakePaddleClient;
  now?: number;
  mailer?: Mailer | null;
} = {}): Promise<TestServer> {
  const store = openDb(":memory:");
  const paddle = opts.paddle ?? new FakePaddleClient();
  const config = testConfig(opts.config);
  const nowRef = { value: opts.now ?? Date.parse("2026-01-15T00:00:00Z") };
  const deps: Deps = { store, paddle, config, now: () => nowRef.value, ...(opts.mailer ? { mailer: opts.mailer } : {}) };
  const server = createServer(deps);

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;
  config.appBaseUrl = base;

  return {
    base,
    store,
    paddle,
    config,
    nowRef,
    deps,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          store.close();
          resolve();
        });
      })
  };
}

export function getCookie(res: Response, name = "sid"): string | null {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  const cookies = headers.getSetCookie?.() ?? [];
  for (const cookie of cookies) {
    if (cookie.startsWith(`${name}=`)) return cookie.split(";")[0];
  }
  const raw = res.headers.get("set-cookie");
  if (raw) {
    const match = new RegExp(`${name}=([^;]+)`).exec(raw);
    if (match) return `${name}=${match[1]}`;
  }
  return null;
}

export async function postJson(
  base: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
}

export async function login(base: string, email: string): Promise<string> {
  const res = await postJson(base, "/api/auth/magic-link", { email });
  const data = (await res.json()) as { devLink?: string };
  if (!data.devLink) throw new Error("no devLink returned");
  const verify = await fetch(data.devLink, { redirect: "manual" });
  const cookie = getCookie(verify);
  if (!cookie) throw new Error("no session cookie set");
  return cookie;
}

export async function startLink(
  base: string,
  cookie: string,
  args: { challenge: string; installId: string }
): Promise<{ requestId: string; verificationUrl: string; expiresAt: string }> {
  const res = await postJson(base, "/api/extension/link/start", args);
  if (!res.ok) throw new Error(`link start failed: ${res.status}`);
  return (await res.json()) as { requestId: string; verificationUrl: string; expiresAt: string };
}

export async function approveLink(base: string, cookie: string, requestId: string): Promise<Response> {
  return postJson(base, "/api/extension/link/approve", { requestId }, { cookie });
}

export async function redeemLink(
  base: string,
  args: { requestId: string; challenge: string; verifier: string; installId: string }
): Promise<Response> {
  return postJson(base, "/api/extension/link/redeem", args);
}

import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import type { Config } from "./config";
import {
  newCheckoutIntentId,
  newLinkRequestId,
  newMagicToken,
  newSessionToken,
  type Store,
  type UserRow
} from "./db";
import {
  normalizeAdjustmentPayload,
  normalizeSubscriptionPayload,
  normalizeTransactionPayload,
  type PaddleClient
} from "./paddle";
import { verifyPaddleSignature } from "./paddleSignatures";
import { hashEquals, linkHashesForChallenge, randomToken, sha256Hex } from "./extensionLink";
import { magicLinkMessage, type Mailer } from "./mail";
import {
  applyAdjustment,
  applySubscriptionEvent,
  applyTransactionCompleted,
  buildEntitlementToken,
  computeAccess,
  processPendingCancellations,
  toMillis,
  type Entitlement
} from "./billing";
import * as pages from "./pages";

export type Deps = {
  store: Store;
  paddle: PaddleClient;
  config: Config;
  now: () => number;
  /** SMTP mailer for magic-link sign-in; when absent, dev logging is used. */
  mailer?: Mailer | null;
};

type Json = Record<string, unknown>;

const MAX_BODY_BYTES = 1 * 1024 * 1024;
const CHECKOUT_INTENT_TTL_MS = 30 * 60 * 1000;
const COOKIE_NAME = "sid";

function nowIso(ms: number): string {
  return new Date(ms).toISOString();
}

function readRaw(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("payload_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function parseBody(req: IncomingMessage): Promise<{ raw: string; json: Json | null; form: URLSearchParams | null }> {
  const raw = (await readRaw(req)).toString("utf8");
  const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return { raw, json: null, form: new URLSearchParams(raw) };
  }
  if (!raw) return { raw, json: {}, form: null };
  try {
    const parsed = JSON.parse(raw);
    return { raw, json: parsed && typeof parsed === "object" ? (parsed as Json) : {}, form: null };
  } catch {
    return { raw, json: null, form: null };
  }
}

function corsHeaders(req: IncomingMessage): Record<string, string> {
  const origin = String(req.headers.origin ?? "");
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type,authorization",
    Vary: "Origin"
  };
}

function sendJson(res: ServerResponse, req: IncomingMessage, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...corsHeaders(req)
  });
  res.end(payload);
}

function sendHtml(res: ServerResponse, req: IncomingMessage, status: number, html: string): void {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    ...corsHeaders(req)
  });
  res.end(html);
}

function redirect(res: ServerResponse, req: IncomingMessage, location: string, extra: Record<string, string> = {}): void {
  res.writeHead(302, { location, ...extra, ...corsHeaders(req) });
  res.end();
}

function apiError(res: ServerResponse, req: IncomingMessage, status: number, code: string, message: string): void {
  sendJson(res, req, status, { error: { code, message } });
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(header ?? "").split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function bearerToken(req: IncomingMessage): string | null {
  const header = String(req.headers.authorization ?? "");
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

type AuthResult = { user: UserRow; via: "session" | "extension" };

async function authenticate(deps: Deps, req: IncomingMessage): Promise<AuthResult | null> {
  const now = deps.now();

  const bearer = bearerToken(req);
  if (bearer) {
    const session = deps.store.getExtensionSession(bearer);
    if (session && session.revoked_at == null && session.expires_at > now) {
      const user = deps.store.getUserById(session.user_id);
      if (user) return { user, via: "extension" };
    }
  }

  const sid = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (sid) {
    const session = deps.store.getSession(sid);
    if (session && session.expires_at > now) {
      const user = deps.store.getUserById(session.user_id);
      if (user) return { user, via: "session" };
    }
  }

  return null;
}

function entitlementFor(deps: Deps, user: UserRow): Entitlement {
  const state = deps.store.loadBillingState({ userId: user.id });
  const entitlement = computeAccess(state, deps.now(), deps.config.entitlementTtlMs, deps.config.graceMs);
  entitlement.accountEmail = user.email;
  return entitlement;
}

function sessionCookie(token: string, maxAgeSeconds: number): string {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleMagicLink(deps: Deps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { json, form } = await parseBody(req);
  const emailRaw = String((json?.email ?? form?.get("email")) ?? "").trim();
  const next = String((json?.next ?? form?.get("next")) ?? "/account");
  const isForm = form !== null;

  if (!emailRaw) {
    if (isForm) return redirect(res, req, `/login?error=${encodeURIComponent("이메일을 입력해 주세요.")}`);
    return apiError(res, req, 400, "invalid_email", "email is required");
  }

  const now = deps.now();
  const user = deps.store.findOrCreateUserByEmail(emailRaw, now);
  const token = newMagicToken();
  deps.store.createMagicLink(token, user.id, now + deps.config.linkTtlMs);

  const devLink = `${deps.config.appBaseUrl}/auth/verify?token=${token}`;
  if (deps.mailer) {
    try {
      await deps.mailer.send(magicLinkMessage({ to: user.email, link: devLink }));
    } catch (error) {
      console.error("[magic-link] send failed", error);
      if (isForm) return redirect(res, req, "/login?error=send_failed");
      return apiError(res, req, 502, "mail_send_failed", "failed to send login email");
    }
  } else if (deps.config.devLogEmail) {
    console.log(`[magic-link] ${user.email}: ${devLink}`);
  }

  if (isForm) {
    const target = `/login?sent=1&next=${encodeURIComponent(next)}`;
    return redirect(res, req, target);
  }

  const body: Json = { ok: true };
  if (!deps.mailer && deps.config.devLogEmail) body.devLink = devLink;
  sendJson(res, req, 200, body);
}

async function handleVerify(deps: Deps, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const token = url.searchParams.get("token");
  if (!token) return redirect(res, req, "/login?error=invalid");
  const now = deps.now();
  const userId = deps.store.consumeMagicLink(token, now);
  if (!userId) return redirect(res, req, "/login?error=expired");

  const sessionToken = newSessionToken();
  deps.store.createSession(sessionToken, userId, now + deps.config.sessionTtlMs);
  const maxAge = Math.floor(deps.config.sessionTtlMs / 1000);
  redirect(res, req, "/account", { "set-cookie": sessionCookie(sessionToken, maxAge) });
}

async function handleLinkStart(deps: Deps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { json } = await parseBody(req);
  const challenge = String(json?.challenge ?? "").trim();
  const installId = String(json?.installId ?? "").trim();
  if (!challenge || !installId) {
    return apiError(res, req, 400, "invalid_request", "challenge and installId are required");
  }

  const now = deps.now();
  const hashes = linkHashesForChallenge(challenge);
  const id = newLinkRequestId();
  const expiresAt = now + deps.config.linkTtlMs;
  deps.store.createLinkRequest({
    id,
    challengeHash: hashes.challengeHash,
    verifierHash: hashes.verifierHash,
    installId,
    expiresAt
  });

  sendJson(res, req, 200, {
    requestId: id,
    verificationUrl: `${deps.config.appBaseUrl}/extension-connect?request=${id}`,
    expiresAt: nowIso(expiresAt)
  });
}

async function handleExtensionConnect(deps: Deps, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const requestId = String(url.searchParams.get("request") ?? "").trim();
  const now = deps.now();
  const link = requestId ? deps.store.getLinkRequest(requestId) : null;
  if (!link) return sendHtml(res, req, 404, pages.errorPage("연결 요청을 찾을 수 없습니다."));
  if (link.expires_at <= now) return sendHtml(res, req, 410, pages.errorPage("연결 요청이 만료되었습니다. 확장 프로그램에서 다시 시도해 주세요."));

  const auth = await authenticate(deps, req);
  if (!auth) {
    const next = encodeURIComponent(`/extension-connect?request=${encodeURIComponent(requestId)}`);
    return redirect(res, req, `/login?next=${next}`);
  }

  sendHtml(
    res,
    req,
    200,
    pages.extensionConnectPage({
      requestId,
      email: auth.user.email,
      alreadyApproved: link.approved_at != null
    })
  );
}

async function handleLinkApprove(deps: Deps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = await authenticate(deps, req);
  if (!auth || auth.via === "extension") return apiError(res, req, 401, "unauthorized", "login required");

  const { json } = await parseBody(req);
  const requestId = String(json?.requestId ?? "").trim();
  const now = deps.now();
  const link = requestId ? deps.store.getLinkRequest(requestId) : null;
  if (!link) return apiError(res, req, 404, "not_found", "request not found");
  if (link.expires_at <= now) return apiError(res, req, 410, "expired", "request expired");
  if (link.redeemed_at != null) return apiError(res, req, 409, "already_redeemed", "request already redeemed");

  deps.store.approveLinkRequest(requestId, auth.user.id, now);
  sendJson(res, req, 200, { ok: true });
}

async function handleLinkRedeem(deps: Deps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { json } = await parseBody(req);
  const requestId = String(json?.requestId ?? "").trim();
  const challenge = String(json?.challenge ?? "").trim();
  const verifier = String(json?.verifier ?? "").trim();
  const installId = String(json?.installId ?? "").trim();

  if (!requestId || !challenge || !verifier || !installId) {
    return apiError(res, req, 400, "invalid_request", "requestId, challenge, verifier and installId are required");
  }

  const now = deps.now();
  const link = deps.store.getLinkRequest(requestId);
  if (!link) return apiError(res, req, 404, "not_found", "request not found");
  if (link.expires_at <= now) return apiError(res, req, 410, "expired", "request expired");
  if (link.redeemed_at != null) return apiError(res, req, 409, "already_redeemed", "request already redeemed");
  if (link.approved_at == null) return apiError(res, req, 409, "not_approved", "request not approved");
  if (link.install_id !== installId) return apiError(res, req, 403, "install_mismatch", "installId mismatch");
  if (!hashEquals(link.challenge_hash, sha256Hex(challenge))) return apiError(res, req, 403, "challenge_mismatch", "challenge mismatch");
  if (!hashEquals(link.verifier_hash, sha256Hex(verifier))) return apiError(res, req, 403, "verifier_mismatch", "verifier mismatch");
  if (!link.user_id) return apiError(res, req, 409, "not_approved", "request not approved");

  if (!deps.store.redeemLinkRequest(requestId, now)) {
    return apiError(res, req, 409, "already_redeemed", "request already redeemed");
  }

  const token = randomToken(32);
  const expiresAt = now + deps.config.sessionTtlMs;
  deps.store.createExtensionSession(token, link.user_id, installId, expiresAt);
  const user = deps.store.getUserById(link.user_id);

  sendJson(res, req, 200, {
    token,
    expiresAt: nowIso(expiresAt),
    accountEmail: user?.email ?? null
  });
}

function handleLinkStatus(deps: Deps, req: IncomingMessage, res: ServerResponse, url: URL): void {
  const requestId = String(url.searchParams.get("requestId") ?? "").trim();
  const link = requestId ? deps.store.getLinkRequest(requestId) : null;
  if (!link) return apiError(res, req, 404, "not_found", "request not found");
  sendJson(res, req, 200, {
    approved: link.approved_at != null,
    redeemed: link.redeemed_at != null,
    expiresAt: nowIso(link.expires_at)
  });
}

async function handleEntitlement(deps: Deps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = await authenticate(deps, req);
  if (!auth) return apiError(res, req, 401, "unauthorized", "authentication required");

  const entitlement = entitlementFor(deps, auth.user);
  const token = buildEntitlementToken(entitlement, deps.config.entitlementTtlMs, deps.now());
  sendJson(res, req, 200, { ...entitlement, entitlementToken: token });
}

async function handleCheckout(deps: Deps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = await authenticate(deps, req);
  if (!auth) return apiError(res, req, 401, "unauthorized", "authentication required");

  const now = deps.now();
  const existing = deps.store.findRecentCheckoutIntent(auth.user.id, now);
  if (existing) {
    return sendJson(res, req, 200, { url: existing.url, transactionId: existing.transaction_id });
  }

  const customerId = deps.store.getPaddleCustomer(auth.user.id);
  const result = await deps.paddle.createCheckout({
    userId: auth.user.id,
    email: auth.user.email,
    customerId,
    priceId: deps.config.paddlePriceId,
    successUrl: `${deps.config.appBaseUrl}/account?checkout=success`
  });

  deps.store.createCheckoutIntent({
    id: newCheckoutIntentId(),
    userId: auth.user.id,
    transactionId: result.transactionId,
    url: result.url,
    createdAt: now,
    expiresAt: now + CHECKOUT_INTENT_TTL_MS
  });

  sendJson(res, req, 200, { url: result.url, transactionId: result.transactionId });
}

async function handlePortal(deps: Deps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = await authenticate(deps, req);
  if (!auth) return apiError(res, req, 401, "unauthorized", "authentication required");

  let customerId = deps.store.getPaddleCustomer(auth.user.id);
  if (!customerId) {
    const customer = await deps.paddle.createCustomer({ email: auth.user.email, userId: auth.user.id });
    customerId = customer.id;
    deps.store.setPaddleCustomer(auth.user.id, customerId);
  }

  const result = await deps.paddle.createPortal(customerId);
  sendJson(res, req, 200, { url: result.url });
}

async function handleAccount(deps: Deps, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const auth = await authenticate(deps, req);
  if (!auth) return redirect(res, req, "/login?next=/account");

  const entitlement = entitlementFor(deps, auth.user);
  const state = deps.store.loadBillingState({ userId: auth.user.id });
  const subscriptions = Object.values(state.subscriptions);
  const cancelAtPeriodEnd = subscriptions.some((s) => s.cancelAtPeriodEnd && s.currentPeriodEnd != null && s.currentPeriodEnd > deps.now());

  sendHtml(
    res,
    req,
    200,
    pages.accountPage({
      email: auth.user.email,
      active: entitlement.active,
      status: entitlement.status,
      paidUntil: entitlement.paidUntil,
      graceUntil: entitlement.graceUntil,
      revoked: entitlement.revoked,
      revokeReason: entitlement.revokeReason,
      cancelAtPeriodEnd,
      portalAvailable: true,
      checkoutSuccess: url.searchParams.get("checkout") === "success"
    })
  );
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

function extractEventId(body: Json): string | null {
  const direct = body.event_id ?? body.notification_id;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const data = body.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const id = (data as Json).id;
    if (typeof id === "string" && id.trim()) return `evt_${id}`;
  }
  return null;
}

async function handleWebhook(deps: Deps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const raw = (await readRaw(req)).toString("utf8");
  const signature = req.headers["paddle-signature"];
  const sigHeader = Array.isArray(signature) ? signature[0] : signature ?? null;

  if (!deps.config.paddleWebhookSecret) {
    return apiError(res, req, 500, "webhook_not_configured", "webhook secret is not configured");
  }

  if (!verifyPaddleSignature(raw, sigHeader, deps.config.paddleWebhookSecret, { nowMs: deps.now() })) {
    return apiError(res, req, 401, "invalid_signature", "invalid signature");
  }

  let body: Json;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("bad body");
    body = parsed as Json;
  } catch {
    return apiError(res, req, 400, "invalid_body", "invalid JSON body");
  }

  const eventId = extractEventId(body);
  if (!eventId) return apiError(res, req, 400, "invalid_body", "missing event id");

  if (deps.store.hasProcessedEvent(eventId)) {
    return sendJson(res, req, 200, { ok: true, duplicate: true });
  }

  const eventType = String(body.event_type ?? "").trim();
  const data = body.data;
  const occurredAt = toMillis(body.occurred_at as string | number | null | undefined) ?? deps.now();
  const now = deps.now();

  const state = deps.store.loadBillingState();

  switch (eventType) {
    case "subscription.created":
    case "subscription.updated":
    case "subscription.canceled": {
      const normalized = normalizeSubscriptionPayload(data);
      if (normalized) applySubscriptionEvent(state, { ...normalized, occurredAt });
      break;
    }
    case "transaction.completed": {
      const normalized = normalizeTransactionPayload(data);
      if (normalized) applyTransactionCompleted(state, { ...normalized, occurredAt });
      break;
    }
    case "adjustment.created":
    case "adjustment.updated": {
      const normalized = normalizeAdjustmentPayload(data);
      if (normalized) applyAdjustment(state, { ...normalized, occurredAt }, now);
      break;
    }
    default:
      break;
  }

  deps.store.saveBillingState(state);

  try {
    if (state.pendingActions.some((a) => a.kind === "cancel_subscription" && a.status !== "done")) {
      await processPendingCancellations(state, deps.paddle, now);
      deps.store.saveBillingState(state);
    }
  } catch (error) {
    console.error("[webhook] pending cancellation processing failed", error);
  }

  deps.store.markProcessedEvent(eventId, now);
  sendJson(res, req, 200, { ok: true });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function handleRequest(deps: Deps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", deps.config.appBaseUrl);
  const pathname = url.pathname;
  const method = (req.method ?? "GET").toUpperCase();

  if (method === "OPTIONS") {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }

  if (pathname === "/health" && method === "GET") return sendJson(res, req, 200, { ok: true });

  if (pathname === "/api/auth/magic-link" && method === "POST") return handleMagicLink(deps, req, res);
  if (pathname === "/auth/verify" && method === "GET") return handleVerify(deps, req, res, url);

  if (pathname === "/api/extension/link/start" && method === "POST") return handleLinkStart(deps, req, res);
  if (pathname === "/api/extension/link/approve" && method === "POST") return handleLinkApprove(deps, req, res);
  if (pathname === "/api/extension/link/redeem" && method === "POST") return handleLinkRedeem(deps, req, res);
  if (pathname === "/api/link/status" && method === "GET") return handleLinkStatus(deps, req, res, url);

  if (pathname === "/api/entitlement" && method === "GET") return handleEntitlement(deps, req, res);
  if (pathname === "/api/billing/checkout" && method === "POST") return handleCheckout(deps, req, res);
  if (pathname === "/api/billing/portal" && method === "POST") return handlePortal(deps, req, res);
  if (pathname === "/api/webhooks/paddle" && method === "POST") return handleWebhook(deps, req, res);

  if (pathname === "/" && method === "GET") return sendHtml(res, req, 200, pages.homePage());
  if (pathname === "/login" && method === "GET") {
    return sendHtml(
      res,
      req,
      200,
      pages.loginPage({
        error: url.searchParams.get("error"),
        next: url.searchParams.get("next"),
        sent: url.searchParams.get("sent") === "1"
      })
    );
  }
  if (pathname === "/extension-connect" && method === "GET") return handleExtensionConnect(deps, req, res, url);
  if (pathname === "/account" && method === "GET") return handleAccount(deps, req, res, url);
  if (pathname === "/pricing" && method === "GET") return sendHtml(res, req, 200, pages.pricingPage());
  if (pathname === "/privacy" && method === "GET") return sendHtml(res, req, 200, pages.privacyPage());
  if (pathname === "/terms" && method === "GET") return sendHtml(res, req, 200, pages.termsPage());
  if (pathname === "/refund" && method === "GET") return sendHtml(res, req, 200, pages.refundPage());

  return sendHtml(res, req, 404, pages.notFoundPage());
}

export function createServer(deps: Deps): http.Server {
  return http.createServer((req, res) => {
    handleRequest(deps, req, res).catch((error) => {
      console.error("[server] request failed", error);
      try {
        apiError(res, req, 500, "internal_error", "internal error");
      } catch {
        // response already sent
      }
    });
  });
}

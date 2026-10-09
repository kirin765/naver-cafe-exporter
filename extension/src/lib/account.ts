import type { EntitlementResponse } from "../../../shared/schema";
import { API, STORAGE_KEYS } from "./config";
import { applyServerEntitlement, type CachedEntitlement } from "./entitlement";
import type { AccountState } from "./messages";

type StoredAuth = {
  token: string | null;
  tokenExpiresAt: string | null;
  email: string | null;
  installId: string;
  requestId: string | null;
  challenge: string | null;
  verifier: string | null;
};

function randomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return base64url(arr);
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return base64url(new Uint8Array(digest));
}

async function loadAuth(): Promise<StoredAuth> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.auth);
  const stored = (data[STORAGE_KEYS.auth] as Partial<StoredAuth>) ?? {};
  return {
    token: stored.token ?? null,
    tokenExpiresAt: stored.tokenExpiresAt ?? null,
    email: stored.email ?? null,
    installId: stored.installId ?? randomToken(16),
    requestId: stored.requestId ?? null,
    challenge: stored.challenge ?? null,
    verifier: stored.verifier ?? null
  };
}

async function saveAuth(auth: StoredAuth): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.auth]: auth });
}

export async function getAccount(): Promise<AccountState> {
  const auth = await loadAuth();
  await saveAuth(auth); // persist a freshly generated install id
  const connected = Boolean(auth.token) && (!auth.tokenExpiresAt || Date.parse(auth.tokenExpiresAt) > Date.now());
  return {
    connected,
    email: auth.email,
    token: connected ? auth.token : null,
    tokenExpiresAt: auth.tokenExpiresAt
  };
}

/**
 * Begin the account-link flow. The verifier never leaves the extension; only its
 * hash is sent. The user approves the request on the product website.
 */
export async function startLink(): Promise<{ verificationUrl: string; requestId: string }> {
  const auth = await loadAuth();
  const challenge = randomToken(32);
  const verifier = randomToken(32);
  const challengeHash = await sha256Base64Url(challenge);
  const verifierHash = await sha256Base64Url(verifier);

  const res = await fetch(API.linkStart, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ challenge: challengeHash, verifier: verifierHash, installId: auth.installId })
  });
  if (!res.ok) throw new Error("계정 연결을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  const data = (await res.json()) as { requestId: string; verificationUrl: string };
  await saveAuth({ ...auth, challenge, verifier, requestId: data.requestId });
  return data;
}

/** Poll the link request; once approved, redeem it for an extension token. */
export async function redeemLink(): Promise<AccountState> {
  const auth = await loadAuth();
  if (!auth.requestId || !auth.challenge || !auth.verifier) {
    return getAccount();
  }
  const status = await fetch(`${API.linkStatus}?requestId=${encodeURIComponent(auth.requestId)}`);
  if (status.ok) {
    const data = (await status.json()) as { approved?: boolean };
    if (!data.approved) return getAccount();
  }
  const res = await fetch(API.linkRedeem, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestId: auth.requestId,
      challenge: auth.challenge,
      verifier: auth.verifier,
      installId: auth.installId
    })
  });
  if (!res.ok) throw new Error("계정 연결 승인을 확인하지 못했습니다.");
  const data = (await res.json()) as { token: string; expiresAt: string; accountEmail: string | null };
  await saveAuth({
    ...auth,
    token: data.token,
    tokenExpiresAt: data.expiresAt,
    email: data.accountEmail,
    requestId: null,
    challenge: null,
    verifier: null
  });
  return getAccount();
}

export async function disconnect(): Promise<void> {
  const auth = await loadAuth();
  await chrome.storage.local.remove([STORAGE_KEYS.auth, STORAGE_KEYS.entitlement]);
  await saveAuth({ ...auth, token: null, tokenExpiresAt: null, email: null });
}

export async function getCachedEntitlement(): Promise<CachedEntitlement | null> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.entitlement);
  return (data[STORAGE_KEYS.entitlement] as CachedEntitlement | undefined) ?? null;
}

/**
 * Fetch the current entitlement and cache it. The server bounds the offline
 * token's `localUntil` (at most 24h, never past the paid/grace deadline).
 */
export async function refreshEntitlement(): Promise<CachedEntitlement | null> {
  const auth = await loadAuth();
  if (!auth.token) return getCachedEntitlement();
  let res: Response;
  try {
    res = await fetch(API.entitlement, { headers: { authorization: `Bearer ${auth.token}` } });
  } catch {
    return getCachedEntitlement();
  }
  if (res.status === 401) {
    await saveAuth({ ...auth, token: null, tokenExpiresAt: null });
    return null;
  }
  if (!res.ok) return getCachedEntitlement();
  const body = (await res.json()) as EntitlementResponse & { entitlementToken?: string };
  const cache = applyServerEntitlement(body, body.entitlementToken ?? null, Date.now());
  await chrome.storage.local.set({ [STORAGE_KEYS.entitlement]: cache });
  return cache;
}

export async function startCheckout(priceId?: string): Promise<string | null> {
  const auth = await loadAuth();
  const res = await fetch(API.checkout, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {})
    },
    body: JSON.stringify({ priceId })
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { url?: string };
  return data.url ?? null;
}

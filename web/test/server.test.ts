import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { challengeForVerifier } from "../src/extensionLink";
import { signPaddleBody } from "../src/paddleSignatures";
import { approveLink, boot, login, postJson, redeemLink, startLink, type TestServer } from "./helpers";

const EMAIL = "server-user@example.com";
const INSTALL = "install_server";
const SECRET = "whsec_test";

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

describe("http server", () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await boot();
  });

  afterEach(async () => {
    await server.close();
  });

  async function sendWebhook(event: unknown, secret = SECRET, tsOverride?: number): Promise<Response> {
    const body = JSON.stringify(event);
    const ts = tsOverride ?? Math.floor(server.nowRef.value / 1000);
    const header = signPaddleBody(body, secret, ts);
    return fetch(`${server.base}/api/webhooks/paddle`, {
      method: "POST",
      headers: { "content-type": "application/json", "paddle-signature": header },
      body
    });
  }

  it("responds to health checks", async () => {
    const res = await fetch(`${server.base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("runs the full account, link, entitlement and billing flow", async () => {
    const now = server.nowRef.value;

    const cookie = await login(server.base, EMAIL);
    const user = server.store.getUserByEmail(EMAIL);
    expect(user).not.toBeNull();
    const userId = user!.id;

    const free = await fetch(`${server.base}/api/entitlement`, { headers: { cookie } });
    expect(free.status).toBe(200);
    const freeBody = (await free.json()) as { active: boolean; plan: string };
    expect(freeBody.active).toBe(false);
    expect(freeBody.plan).toBe("free");

    const verifier = "server-verifier";
    const challenge = challengeForVerifier(verifier);
    const start = await startLink(server.base, cookie, { challenge, installId: INSTALL });

    const connect = await fetch(`${server.base}/extension-connect?request=${start.requestId}`, {
      headers: { cookie }
    });
    expect(connect.status).toBe(200);
    expect(await connect.text()).toContain("확장 프로그램 연결");

    const approved = await approveLink(server.base, cookie, start.requestId);
    expect(approved.status).toBe(200);

    const redeemed = await redeemLink(server.base, {
      requestId: start.requestId,
      challenge,
      verifier,
      installId: INSTALL
    });
    expect(redeemed.status).toBe(200);
    const redeemBody = (await redeemed.json()) as { token: string; accountEmail: string | null };
    expect(redeemBody.accountEmail).toBe(EMAIL);

    const extEntitlement = await fetch(`${server.base}/api/entitlement`, {
      headers: { authorization: `Bearer ${redeemBody.token}` }
    });
    expect(extEntitlement.status).toBe(200);

    const checkout1 = await postJson(server.base, "/api/billing/checkout", {}, { cookie });
    expect(checkout1.status).toBe(200);
    const checkoutBody1 = (await checkout1.json()) as { url: string; transactionId: string | null };
    expect(checkoutBody1.url).toBeTruthy();

    const checkout2 = await postJson(server.base, "/api/billing/checkout", {}, { cookie });
    const checkoutBody2 = (await checkout2.json()) as { url: string };
    expect(checkoutBody2.url).toBe(checkoutBody1.url);

    const portal = await postJson(server.base, "/api/billing/portal", {}, { cookie });
    expect(portal.status).toBe(200);
    const portalBody = (await portal.json()) as { url: string };
    expect(portalBody.url).toBeTruthy();

    const subEvent = {
      event_id: "evt_sub_1",
      event_type: "subscription.updated",
      occurred_at: iso(now),
      data: {
        id: "sub_1",
        customer_id: "ctm_1",
        status: "active",
        custom_data: { user_id: userId },
        current_billing_period: { starts_at: iso(now - 1000), ends_at: iso(now + 30 * 24 * 60 * 60 * 1000) }
      }
    };
    const txnEvent = {
      event_id: "evt_txn_1",
      event_type: "transaction.completed",
      occurred_at: iso(now + 1000),
      data: {
        id: "txn_1",
        customer_id: "ctm_1",
        subscription_id: "sub_1",
        status: "completed",
        currency_code: "KRW",
        custom_data: { user_id: userId },
        billing_period: { starts_at: iso(now - 1000), ends_at: iso(now + 30 * 24 * 60 * 60 * 1000) },
        details: { totals: { total: "4900" } }
      }
    };

    expect((await sendWebhook(subEvent)).status).toBe(200);
    expect((await sendWebhook(txnEvent)).status).toBe(200);

    const paid = await fetch(`${server.base}/api/entitlement`, { headers: { cookie } });
    const paidBody = (await paid.json()) as { active: boolean; plan: string; paidUntil: string | null };
    expect(paidBody.active).toBe(true);
    expect(paidBody.plan).toBe("paid");
    expect(paidBody.paidUntil).not.toBeNull();

    const refundEvent = {
      event_id: "evt_adj_1",
      event_type: "adjustment.created",
      occurred_at: iso(now + 2000),
      data: {
        id: "adj_1",
        action: "refund",
        status: "approved",
        transaction_id: "txn_1",
        subscription_id: "sub_1",
        currency_code: "KRW",
        totals: { total: "-4900" }
      }
    };
    expect((await sendWebhook(refundEvent)).status).toBe(200);

    const revoked = await fetch(`${server.base}/api/entitlement`, { headers: { cookie } });
    const revokedBody = (await revoked.json()) as { active: boolean; revoked: boolean };
    expect(revokedBody.active).toBe(false);
    expect(revokedBody.revoked).toBe(true);

    const duplicate = await sendWebhook(subEvent);
    const duplicateBody = (await duplicate.json()) as { duplicate?: boolean };
    expect(duplicateBody.duplicate).toBe(true);
  });

  it("rejects a webhook with a bad signature and accepts a good one", async () => {
    const bad = await sendWebhook({ event_id: "evt_bad", event_type: "transaction.completed", data: {} }, "wrong_secret");
    expect(bad.status).toBe(401);

    const good = await sendWebhook({
      event_id: "evt_good",
      event_type: "transaction.completed",
      occurred_at: iso(server.nowRef.value),
      data: { id: "txn_x", customer_id: "ctm_x", status: "completed" }
    });
    expect(good.status).toBe(200);
  });

  it("rejects a replayed (stale) webhook signature", async () => {
    const stale = await sendWebhook(
      { event_id: "evt_stale", event_type: "transaction.completed", data: {} },
      SECRET,
      Math.floor(server.nowRef.value / 1000) - 10_000
    );
    expect(stale.status).toBe(401);
  });

  it("does not leak a reusable token in the magic-link response unless dev logging is on", async () => {
    const res = await postJson(server.base, "/api/auth/magic-link", { email: "nobody@example.com" });
    const body = (await res.json()) as { ok: boolean; devLink?: string };
    expect(body.ok).toBe(true);
    expect(body.devLink).toContain("/auth/verify?token=");
  });
});

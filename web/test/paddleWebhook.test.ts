import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  extractCustomerEmail,
  extractCustomerId,
  extractPriceId,
  extractUserId,
  normalizeAdjustmentPayload,
  normalizeSubscriptionPayload,
  normalizeTransactionPayload
} from "../src/paddle";
import { parsePaddleSignature, signPaddleBody, verifyPaddleSignature } from "../src/paddleSignatures";
import { openDb } from "../src/db";

describe("parsePaddleSignature", () => {
  it("parses comma-separated header", () => {
    expect(parsePaddleSignature("ts=123,h1=abc")).toEqual({ ts: "123", h1: "abc" });
  });

  it("parses semicolon-separated header", () => {
    expect(parsePaddleSignature("ts=123; h1=abc")).toEqual({ ts: "123", h1: "abc" });
  });

  it("returns null when a component is missing", () => {
    expect(parsePaddleSignature("h1=abc")).toBeNull();
    expect(parsePaddleSignature(null)).toBeNull();
  });
});

describe("verifyPaddleSignature", () => {
  const secret = "whsec_test";
  const body = '{"hello":"world"}';
  const nowMs = 1_700_000_000_000;
  const ts = String(nowMs / 1000);
  const h1 = createHmac("sha256", secret).update(`${ts}:${body}`, "utf8").digest("hex");

  it("accepts a fresh matching signature", () => {
    expect(verifyPaddleSignature(body, `ts=${ts};h1=${h1}`, secret, { nowMs })).toBe(true);
  });

  it("rejects a replay outside the tolerance window", () => {
    expect(verifyPaddleSignature(body, `ts=${ts};h1=${h1}`, secret, { nowMs: nowMs + 301_000 })).toBe(false);
  });

  it("honors an overridden tolerance", () => {
    expect(
      verifyPaddleSignature(body, `ts=${ts};h1=${h1}`, secret, {
        nowMs: nowMs + 301_000,
        toleranceSeconds: 600
      })
    ).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifyPaddleSignature('{"hello":"tampered"}', `ts=${ts};h1=${h1}`, secret, { nowMs })).toBe(false);
  });

  it("rejects a mismatched digest length", () => {
    expect(verifyPaddleSignature(body, "ts=1;h1=x", secret, { toleranceSeconds: Infinity })).toBe(false);
  });

  it("signs and verifies round-trip", () => {
    const header = signPaddleBody(body, secret, ts);
    expect(verifyPaddleSignature(body, header, secret, { nowMs })).toBe(true);
  });
});

describe("payload helpers", () => {
  it("extracts customer id, email, user id and price id with priority", () => {
    const payload = {
      customer_id: "ctm_primary",
      customer: { id: "ctm_secondary", email_address: "User@Example.com" },
      custom_data: { user_id: "user_custom" },
      metadata: { user_id: "user_meta" },
      items: [{ price: { id: "pri_1" } }]
    };
    expect(extractCustomerId(payload)).toBe("ctm_primary");
    expect(extractCustomerEmail(payload)).toBe("user@example.com");
    expect(extractUserId(payload)).toBe("user_custom");
    expect(extractPriceId(payload)).toBe("pri_1");
  });

  it("normalizes a subscription payload with items array/object", () => {
    const normalized = normalizeSubscriptionPayload({
      id: "sub_1",
      customer_id: "ctm_1",
      status: "active",
      items: { data: [{ price: { id: "pri_1" } }] },
      current_billing_period: { starts_at: "2026-01-01T00:00:00Z", ends_at: "2026-02-01T00:00:00Z" },
      scheduled_change: { action: "cancel" }
    });
    expect(normalized).toMatchObject({
      id: "sub_1",
      customerId: "ctm_1",
      status: "active",
      priceId: "pri_1",
      cancelAtPeriodEnd: true
    });
  });

  it("returns null when subscription identifiers are missing", () => {
    expect(normalizeSubscriptionPayload({ customer_id: "ctm_1" })).toBeNull();
    expect(normalizeSubscriptionPayload({ id: "sub_1" })).toBeNull();
  });

  it("normalizes a transaction payload", () => {
    const normalized = normalizeTransactionPayload({
      id: "txn_1",
      customer_id: "ctm_1",
      subscription_id: "sub_1",
      status: "completed",
      currency_code: "KRW",
      custom_data: { user_id: "usr_1" },
      billing_period: { starts_at: "2026-01-01T00:00:00Z", ends_at: "2026-02-01T00:00:00Z" },
      details: { totals: { total: "4900" } }
    });
    expect(normalized).toMatchObject({
      id: "txn_1",
      customerId: "ctm_1",
      subscriptionId: "sub_1",
      userId: "usr_1",
      amount: 4900,
      currency: "KRW"
    });
  });

  it("normalizes an adjustment payload and takes absolute amount", () => {
    const normalized = normalizeAdjustmentPayload({
      id: "adj_1",
      action: "refund",
      status: "approved",
      transaction_id: "txn_1",
      subscription_id: "sub_1",
      currency_code: "KRW",
      totals: { total: "-4900" }
    });
    expect(normalized).toMatchObject({
      id: "adj_1",
      action: "refund",
      status: "approved",
      transactionId: "txn_1",
      amount: 4900
    });
  });
});

describe("processed event dedupe", () => {
  it("tracks processed event ids once", () => {
    const store = openDb(":memory:");
    expect(store.hasProcessedEvent("evt_1")).toBe(false);
    store.markProcessedEvent("evt_1", 1000);
    expect(store.hasProcessedEvent("evt_1")).toBe(true);
    store.markProcessedEvent("evt_1", 2000);
    expect(store.hasProcessedEvent("evt_1")).toBe(true);
    store.close();
  });
});

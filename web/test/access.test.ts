import { describe, expect, it } from "vitest";
import {
  entitlementOfflineValid,
  evaluateAccess,
  parseEntitlementToken
} from "../../shared/schema";
import {
  applySubscriptionEvent,
  buildEntitlementToken,
  computeAccess,
  emptyBillingState
} from "../src/billing";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-01-15T00:00:00Z");
const TTL = 24 * 60 * 60 * 1000;
const GRACE = 3 * DAY;

function stateWith(status: string, periodEnd: number | null, cancelAtPeriodEnd = false) {
  const state = emptyBillingState();
  applySubscriptionEvent(state, {
    id: "sub_1",
    customerId: "ctm_1",
    status,
    userId: "usr_1",
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd,
    occurredAt: NOW
  });
  return state;
}

describe("evaluateAccess (shared)", () => {
  it("grants access for an active subscription", () => {
    const decision = evaluateAccess({
      now: NOW,
      status: "active",
      currentPeriodEnd: NOW + 10 * DAY,
      cancelAtPeriodEnd: false,
      graceMs: GRACE,
      revoked: false
    });
    expect(decision.active).toBe(true);
    expect(decision.plan).toBe("paid");
  });

  it("continues access through the paid period after scheduled cancellation", () => {
    const decision = evaluateAccess({
      now: NOW,
      status: "active",
      currentPeriodEnd: NOW + 10 * DAY,
      cancelAtPeriodEnd: true,
      graceMs: GRACE,
      revoked: false
    });
    expect(decision.active).toBe(true);
    expect(decision.grace).toBe(false);
  });

  it("applies past_due grace for three days", () => {
    const decision = evaluateAccess({
      now: NOW,
      status: "past_due",
      currentPeriodEnd: NOW - DAY,
      cancelAtPeriodEnd: false,
      graceMs: GRACE,
      revoked: false
    });
    expect(decision.active).toBe(true);
    expect(decision.grace).toBe(true);
  });

  it("denies access once grace is exhausted", () => {
    const decision = evaluateAccess({
      now: NOW + 4 * DAY,
      status: "past_due",
      currentPeriodEnd: NOW - DAY,
      cancelAtPeriodEnd: false,
      graceMs: GRACE,
      revoked: false
    });
    expect(decision.active).toBe(false);
  });

  it("treats paused and canceled as free", () => {
    for (const status of ["paused", "canceled"]) {
      const decision = evaluateAccess({
        now: NOW,
        status,
        currentPeriodEnd: NOW + 10 * DAY,
        cancelAtPeriodEnd: false,
        graceMs: GRACE,
        revoked: false
      });
      expect(decision.active).toBe(false);
    }
  });

  it("lets revocation win over an active status", () => {
    const decision = evaluateAccess({
      now: NOW,
      status: "active",
      currentPeriodEnd: NOW + 10 * DAY,
      cancelAtPeriodEnd: false,
      graceMs: GRACE,
      revoked: true
    });
    expect(decision.active).toBe(false);
    expect(decision.reason).toBe("revoked");
  });
});

describe("computeAccess", () => {
  it("returns paid access for an active subscription", () => {
    const entitlement = computeAccess(stateWith("active", NOW + 10 * DAY), NOW, TTL, GRACE);
    expect(entitlement.active).toBe(true);
    expect(entitlement.plan).toBe("paid");
    expect(entitlement.paidUntil).toBe(new Date(NOW + 10 * DAY).toISOString());
  });

  it("continues through a scheduled cancellation", () => {
    const entitlement = computeAccess(stateWith("active", NOW + 10 * DAY, true), NOW, TTL, GRACE);
    expect(entitlement.active).toBe(true);
    expect(entitlement.graceUntil).toBeNull();
  });

  it("returns grace and then free as the grace window elapses", () => {
    const state = stateWith("past_due", NOW - DAY);
    const inGrace = computeAccess(state, NOW, TTL, GRACE);
    expect(inGrace.active).toBe(true);
    expect(inGrace.graceUntil).toBe(new Date(NOW - DAY + GRACE).toISOString());

    const expired = computeAccess(state, NOW + 4 * DAY, TTL, GRACE);
    expect(expired.active).toBe(false);
    expect(expired.plan).toBe("free");
  });

  it("returns free for paused or canceled subscriptions", () => {
    expect(computeAccess(stateWith("paused", NOW + 10 * DAY), NOW, TTL, GRACE).active).toBe(false);
    expect(computeAccess(stateWith("canceled", NOW - DAY), NOW, TTL, GRACE).active).toBe(false);
  });
});

describe("bounded offline entitlement token", () => {
  it("bounds localUntil by the ttl for an active subscription", () => {
    const entitlement = computeAccess(stateWith("active", NOW + 10 * DAY), NOW, TTL, GRACE);
    entitlement.accountEmail = "user@example.com";
    const token = buildEntitlementToken(entitlement, TTL, NOW);

    const parsed = parseEntitlementToken(token);
    expect(parsed).not.toBeNull();
    expect(parsed?.active).toBe(true);
    expect(parsed?.localUntil).toBe(new Date(NOW + TTL).toISOString());
    expect(parsed?.accountEmail).toBe("user@example.com");

    expect(entitlementOfflineValid(parsed, NOW + 1000)).toBe(true);
    expect(entitlementOfflineValid(parsed, NOW + TTL + 1000)).toBe(false);
  });

  it("never extends beyond the paid deadline", () => {
    const entitlement = computeAccess(stateWith("active", NOW + 60 * 60 * 1000), NOW, TTL, GRACE);
    const token = buildEntitlementToken(entitlement, TTL, NOW);
    const parsed = parseEntitlementToken(token);
    expect(parsed?.localUntil).toBe(new Date(NOW + 60 * 60 * 1000).toISOString());
  });

  it("bounds localUntil by the grace deadline", () => {
    const entitlement = computeAccess(stateWith("past_due", NOW - DAY), NOW, TTL, GRACE);
    const token = buildEntitlementToken(entitlement, TTL, NOW);
    const parsed = parseEntitlementToken(token);
    expect(parsed?.localUntil).toBe(new Date(NOW + TTL).toISOString());
    expect(entitlementOfflineValid(parsed, NOW + 1000)).toBe(true);
  });

  it("never extends localUntil beyond the grace deadline", () => {
    const entitlement = computeAccess(stateWith("past_due", NOW - DAY), NOW, 10 * DAY, GRACE);
    const token = buildEntitlementToken(entitlement, 10 * DAY, NOW);
    const parsed = parseEntitlementToken(token);
    expect(parsed?.localUntil).toBe(new Date(NOW - DAY + GRACE).toISOString());
  });
});

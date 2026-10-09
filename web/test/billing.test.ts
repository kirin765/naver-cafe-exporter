import { describe, expect, it } from "vitest";
import {
  applyAdjustment,
  applySubscriptionEvent,
  applyTransactionCompleted,
  computeAccess,
  emptyBillingState,
  processPendingCancellations,
  type BillingState
} from "../src/billing";
import { FakePaddleClient } from "../src/paddle";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-01-15T00:00:00Z");
const PERIOD_END = NOW + 20 * DAY;
const TOTAL = 4900;
const TTL = 24 * 60 * 60 * 1000;
const GRACE = 3 * DAY;

function withSub(
  state: BillingState,
  opts: {
    id?: string;
    customerId?: string;
    userId?: string | null;
    status?: string;
    periodEnd?: number | null;
    cancelAtPeriodEnd?: boolean;
    occurredAt?: number;
  } = {}
): void {
  applySubscriptionEvent(state, {
    id: opts.id ?? "sub_1",
    customerId: opts.customerId ?? "ctm_1",
    status: opts.status ?? "active",
    userId: opts.userId === undefined ? "usr_1" : opts.userId,
    currentPeriodEnd: opts.periodEnd === undefined ? PERIOD_END : opts.periodEnd,
    cancelAtPeriodEnd: opts.cancelAtPeriodEnd ?? false,
    occurredAt: opts.occurredAt ?? NOW
  });
}

function withTxn(
  state: BillingState,
  opts: {
    id?: string;
    customerId?: string;
    subscriptionId?: string;
    userId?: string | null;
    periodEnd?: number | null;
    amount?: number;
    occurredAt?: number;
  } = {}
): void {
  applyTransactionCompleted(state, {
    id: opts.id ?? "txn_1",
    customerId: opts.customerId ?? "ctm_1",
    subscriptionId: opts.subscriptionId ?? "sub_1",
    status: "completed",
    userId: opts.userId === undefined ? "usr_1" : opts.userId,
    paidPeriodEnd: opts.periodEnd === undefined ? PERIOD_END : opts.periodEnd,
    amount: opts.amount ?? TOTAL,
    currency: "KRW",
    occurredAt: opts.occurredAt ?? NOW
  });
}

function withAdjustment(
  state: BillingState,
  opts: {
    id?: string;
    action?: string;
    status?: string;
    transactionId?: string | null;
    subscriptionId?: string | null;
    amount?: number;
    occurredAt?: number;
    now?: number;
  } = {}
): void {
  const occurredAt = opts.occurredAt ?? NOW + 1000;
  applyAdjustment(
    state,
    {
      id: opts.id ?? "adj_1",
      action: opts.action ?? "refund",
      status: opts.status ?? "approved",
      transactionId: opts.transactionId === undefined ? "txn_1" : opts.transactionId,
      subscriptionId: opts.subscriptionId === undefined ? "sub_1" : opts.subscriptionId,
      amount: opts.amount ?? TOTAL,
      currency: "KRW",
      occurredAt
    },
    opts.now ?? occurredAt
  );
}

describe("applyAdjustment / revocation", () => {
  it("revokes on an approved-at-creation full refund and schedules cancellation", () => {
    const state = emptyBillingState();
    withSub(state);
    withTxn(state);
    withAdjustment(state, { status: "approved" });

    expect(state.revocations).toHaveLength(1);
    expect(state.revocations[0].reason).toBe("refund");
    expect(state.pendingActions.some((a) => a.kind === "cancel_subscription")).toBe(true);

    const entitlement = computeAccess(state, NOW + 2000, TTL, GRACE);
    expect(entitlement.active).toBe(false);
    expect(entitlement.revoked).toBe(true);
  });

  it("revokes only after a pending refund is later approved", () => {
    const state = emptyBillingState();
    withSub(state);
    withTxn(state);
    withAdjustment(state, { status: "pending_approval" });
    expect(computeAccess(state, NOW + 1500, TTL, GRACE).revoked).toBe(false);

    withAdjustment(state, { status: "approved", occurredAt: NOW + 2000 });
    expect(computeAccess(state, NOW + 3000, TTL, GRACE).revoked).toBe(true);
  });

  it("does not revoke for pending, rejected, partial or historical refunds", () => {
    for (const status of ["pending_approval", "rejected"]) {
      const state = emptyBillingState();
      withSub(state);
      withTxn(state);
      withAdjustment(state, { status });
      expect(computeAccess(state, NOW + 2000, TTL, GRACE).revoked).toBe(false);
    }

    const partial = emptyBillingState();
    withSub(partial);
    withTxn(partial);
    withAdjustment(partial, { amount: 1000 });
    expect(computeAccess(partial, NOW + 2000, TTL, GRACE).revoked).toBe(false);

    const historical = emptyBillingState();
    withSub(historical, { periodEnd: PERIOD_END });
    withTxn(historical, { periodEnd: PERIOD_END - 30 * DAY });
    withAdjustment(historical, { amount: TOTAL });
    expect(computeAccess(historical, NOW + 2000, TTL, GRACE).revoked).toBe(false);
  });

  it("revokes on cumulative approved refunds that reach the transaction total", () => {
    const state = emptyBillingState();
    withSub(state);
    withTxn(state);
    withAdjustment(state, { id: "adj_a", amount: 2450, occurredAt: NOW + 1000 });
    expect(computeAccess(state, NOW + 1500, TTL, GRACE).revoked).toBe(false);
    withAdjustment(state, { id: "adj_b", amount: 2450, occurredAt: NOW + 2000 });
    expect(computeAccess(state, NOW + 3000, TTL, GRACE).revoked).toBe(true);
  });

  it("handles a chargeback and clears it on reversal", () => {
    const state = emptyBillingState();
    withSub(state);
    withTxn(state);
    withAdjustment(state, { id: "adj_cb", action: "chargeback", amount: TOTAL });
    expect(state.revocations[0].reason).toBe("chargeback");
    expect(computeAccess(state, NOW + 2000, TTL, GRACE).revoked).toBe(true);

    withAdjustment(state, { id: "adj_rev", action: "chargeback_reverse", amount: TOTAL, occurredAt: NOW + 3000 });
    expect(state.revocations).toHaveLength(0);
    expect(computeAccess(state, NOW + 4000, TTL, GRACE).revoked).toBe(false);
  });

  it("handles refund-before-transaction ordering", () => {
    const state = emptyBillingState();
    withSub(state);
    withAdjustment(state, { status: "approved" });
    expect(computeAccess(state, NOW + 1500, TTL, GRACE).revoked).toBe(false);

    withTxn(state, { occurredAt: NOW + 2000 });
    expect(computeAccess(state, NOW + 3000, TTL, GRACE).revoked).toBe(true);
  });
});

describe("event ordering", () => {
  it("does not let an older subscription event overwrite newer state", () => {
    const state = emptyBillingState();
    withSub(state, { status: "active", occurredAt: NOW });
    applySubscriptionEvent(state, {
      id: "sub_1",
      customerId: "ctm_1",
      status: "past_due",
      userId: "usr_1",
      currentPeriodEnd: PERIOD_END,
      cancelAtPeriodEnd: false,
      occurredAt: NOW - 1000
    });
    expect(state.subscriptions.sub_1.status).toBe("active");
  });

  it("does not let an older adjustment event overwrite newer state", () => {
    const state = emptyBillingState();
    withSub(state);
    withTxn(state);
    withAdjustment(state, { status: "approved", occurredAt: NOW + 1000 });

    withAdjustment(state, { status: "pending_approval", occurredAt: NOW + 500 });
    expect(state.adjustments.adj_1.status).toBe("approved");
    expect(computeAccess(state, NOW + 2000, TTL, GRACE).revoked).toBe(true);
  });

  it("does not restore revoked access when active/completed events are replayed", () => {
    const state = emptyBillingState();
    withSub(state);
    withTxn(state);
    withAdjustment(state, { status: "approved" });

    withSub(state, { status: "active", occurredAt: NOW + 5000 });
    withTxn(state, { occurredAt: NOW + 6000 });

    const entitlement = computeAccess(state, NOW + 7000, TTL, GRACE);
    expect(entitlement.revoked).toBe(true);
    expect(entitlement.active).toBe(false);
  });

  it("keeps a separate valid purchase eligible", () => {
    const state = emptyBillingState();
    withSub(state);
    withTxn(state);
    withAdjustment(state, { status: "approved" });

    withSub(state, {
      id: "sub_2",
      customerId: "ctm_2",
      userId: "usr_1",
      status: "active",
      periodEnd: PERIOD_END + 60 * DAY,
      occurredAt: NOW + 5000
    });

    const entitlement = computeAccess(state, NOW + 7000, TTL, GRACE);
    expect(entitlement.active).toBe(true);
    expect(entitlement.revoked).toBe(false);
  });
});

describe("cancellation worker", () => {
  it("retries a failed cancellation until it succeeds", async () => {
    const state = emptyBillingState();
    withSub(state);
    withTxn(state);
    withAdjustment(state, { status: "approved" });

    const paddle = new FakePaddleClient({ failCancel: true });
    await processPendingCancellations(state, paddle, NOW + 1000);
    expect(state.pendingActions[0].status).toBe("failed");
    expect(state.pendingActions[0].attempts).toBe(1);

    paddle.failCancel = false;
    await processPendingCancellations(state, paddle, NOW + 2000);
    expect(state.pendingActions[0].status).toBe("done");
    expect(state.pendingActions[0].attempts).toBe(2);
    expect(paddle.calls.filter((c) => c.method === "cancelSubscription")).toHaveLength(2);
  });
});

describe("grace", () => {
  it("allows access during past_due grace and revokes it after expiry", () => {
    const state = emptyBillingState();
    withSub(state, { status: "past_due", periodEnd: NOW - DAY });

    const inGrace = computeAccess(state, NOW, TTL, GRACE);
    expect(inGrace.active).toBe(true);
    expect(inGrace.graceUntil).not.toBeNull();

    const expired = computeAccess(state, NOW + 4 * DAY, TTL, GRACE);
    expect(expired.active).toBe(false);
  });
});

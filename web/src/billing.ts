import {
  evaluateAccess,
  type EntitlementResponse,
  type SignedEntitlement
} from "../../shared/schema";
import type { PaddleClient } from "./paddle";

export type SubscriptionState = {
  id: string;
  userId: string | null;
  status: string;
  currentPeriodStart: number | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  updatedAt: number;
};

export type TransactionState = {
  id: string;
  userId: string | null;
  subscriptionId: string | null;
  status: string;
  paidPeriodStart: number | null;
  paidPeriodEnd: number | null;
  amount: number | null;
  currency: string | null;
  createdAt: number;
};

export type AdjustmentState = {
  id: string;
  action: string;
  status: string;
  transactionId: string | null;
  subscriptionId: string | null;
  amount: number;
  currency: string | null;
  periodStart: number | null;
  periodEnd: number | null;
  createdAt: number;
  updatedAt: number;
};

export type RevocationState = {
  userId: string;
  subscriptionId: string;
  periodEnd: number | null;
  reason: string;
  createdAt: number;
};

export type PendingActionState = {
  id: string;
  kind: string;
  subscriptionId: string;
  status: string;
  attempts: number;
  createdAt: number;
  updatedAt: number;
};

export type BillingState = {
  customers: Record<string, string>;
  customerToUser: Record<string, string>;
  subscriptions: Record<string, SubscriptionState>;
  transactions: Record<string, TransactionState>;
  adjustments: Record<string, AdjustmentState>;
  revocations: RevocationState[];
  pendingActions: PendingActionState[];
};

export function emptyBillingState(): BillingState {
  return {
    customers: {},
    customerToUser: {},
    subscriptions: {},
    transactions: {},
    adjustments: {},
    revocations: [],
    pendingActions: []
  };
}

export function toMillis(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Math.abs(value) >= 1_000_000_000_000 ? value : value * 1000;
  }
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return toMillis(Number(trimmed));
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

export type SubscriptionEventInput = {
  id: string;
  customerId: string;
  status: string;
  userId: string | null;
  priceId?: string | null;
  currentPeriodStart?: string | number | null;
  currentPeriodEnd?: string | number | null;
  cancelAtPeriodEnd: boolean;
  occurredAt: number;
};

export function applySubscriptionEvent(state: BillingState, payload: SubscriptionEventInput): BillingState {
  const existing = state.subscriptions[payload.id];
  if (existing && payload.occurredAt < existing.updatedAt) return state;

  const userId =
    payload.userId ?? existing?.userId ?? (payload.customerId ? state.customerToUser[payload.customerId] ?? null : null);

  if (payload.customerId && userId) {
    state.customers[userId] = payload.customerId;
    state.customerToUser[payload.customerId] = userId;
  }

  const periodEnd = toMillis(payload.currentPeriodEnd);
  const periodStart = toMillis(payload.currentPeriodStart);

  state.subscriptions[payload.id] = {
    id: payload.id,
    userId,
    status: String(payload.status),
    currentPeriodStart: periodStart ?? existing?.currentPeriodStart ?? null,
    currentPeriodEnd: periodEnd ?? existing?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: payload.cancelAtPeriodEnd,
    updatedAt: payload.occurredAt
  };

  return state;
}

export type TransactionEventInput = {
  id: string;
  customerId: string | null;
  subscriptionId: string | null;
  status: string;
  userId: string | null;
  paidPeriodStart?: string | number | null;
  paidPeriodEnd?: string | number | null;
  amount?: number | null;
  currency?: string | null;
  occurredAt: number;
};

export function applyTransactionCompleted(state: BillingState, payload: TransactionEventInput): BillingState {
  const existing = state.transactions[payload.id];
  const userId =
    payload.userId ??
    existing?.userId ??
    (payload.customerId ? state.customerToUser[payload.customerId] ?? null : null);

  if (payload.customerId && userId) {
    state.customers[userId] = payload.customerId;
    state.customerToUser[payload.customerId] = userId;
  }

  const subscriptionId = payload.subscriptionId ?? existing?.subscriptionId ?? null;

  state.transactions[payload.id] = {
    id: payload.id,
    userId,
    subscriptionId,
    status: String(payload.status),
    paidPeriodStart: toMillis(payload.paidPeriodStart) ?? existing?.paidPeriodStart ?? null,
    paidPeriodEnd: toMillis(payload.paidPeriodEnd) ?? existing?.paidPeriodEnd ?? null,
    amount: payload.amount ?? existing?.amount ?? null,
    currency: payload.currency ?? existing?.currency ?? null,
    createdAt: existing?.createdAt ?? payload.occurredAt
  };

  if (subscriptionId && userId) {
    const sub = state.subscriptions[subscriptionId];
    if (sub && !sub.userId) sub.userId = userId;
  }

  if (subscriptionId) reevaluateSubscription(state, subscriptionId, payload.occurredAt);
  return state;
}

export type AdjustmentEventInput = {
  id: string;
  action: string;
  status: string;
  transactionId: string | null;
  subscriptionId: string | null;
  amount: number;
  currency?: string | null;
  periodStart?: string | number | null;
  periodEnd?: string | number | null;
  occurredAt: number;
};

export function applyAdjustment(state: BillingState, payload: AdjustmentEventInput, now: number): BillingState {
  const existing = state.adjustments[payload.id];
  if (existing && payload.occurredAt < existing.updatedAt) return state;

  let subscriptionId = payload.subscriptionId ?? existing?.subscriptionId ?? null;
  const transactionId = payload.transactionId ?? existing?.transactionId ?? null;
  if (!subscriptionId && transactionId) {
    subscriptionId = state.transactions[transactionId]?.subscriptionId ?? null;
  }

  state.adjustments[payload.id] = {
    id: payload.id,
    action: String(payload.action),
    status: String(payload.status),
    transactionId,
    subscriptionId,
    amount: Number(payload.amount ?? 0),
    currency: payload.currency ?? existing?.currency ?? null,
    periodStart: toMillis(payload.periodStart) ?? existing?.periodStart ?? null,
    periodEnd: toMillis(payload.periodEnd) ?? existing?.periodEnd ?? null,
    createdAt: existing?.createdAt ?? payload.occurredAt,
    updatedAt: payload.occurredAt
  };

  if (subscriptionId) reevaluateSubscription(state, subscriptionId, now ?? payload.occurredAt);
  return state;
}

function coversCurrentPeriod(transaction: TransactionState, subscription: SubscriptionState): boolean {
  if (subscription.currentPeriodEnd == null) return true;
  if (transaction.paidPeriodEnd == null) return true;
  return transaction.paidPeriodEnd >= subscription.currentPeriodEnd;
}

function computeRevocationReason(state: BillingState, subscription: SubscriptionState): string | null {
  for (const transaction of Object.values(state.transactions)) {
    if (transaction.subscriptionId !== subscription.id) continue;
    if (!coversCurrentPeriod(transaction, subscription)) continue;
    const amount = transaction.amount ?? 0;
    if (amount <= 0) continue;

    let net = 0;
    let sawChargeback = false;
    for (const adjustment of Object.values(state.adjustments)) {
      if (adjustment.transactionId !== transaction.id) continue;
      if (String(adjustment.status).trim().toLowerCase() !== "approved") continue;
      const action = String(adjustment.action).trim().toLowerCase();
      if (action.endsWith("_reverse")) {
        net -= Math.abs(adjustment.amount);
      } else if (action === "chargeback") {
        net += Math.abs(adjustment.amount);
        sawChargeback = true;
      } else if (action === "refund") {
        net += Math.abs(adjustment.amount);
      }
    }

    if (net >= amount) return sawChargeback ? "chargeback" : "refund";
  }
  return null;
}

export function reevaluateSubscription(state: BillingState, subscriptionId: string, now: number): BillingState {
  const subscription = state.subscriptions[subscriptionId];
  if (!subscription) return state;

  state.revocations = state.revocations.filter((r) => r.subscriptionId !== subscriptionId);

  const reason = computeRevocationReason(state, subscription);
  if (reason) {
    state.revocations.push({
      userId: subscription.userId ?? "",
      subscriptionId,
      periodEnd: subscription.currentPeriodEnd,
      reason,
      createdAt: now
    });
    ensurePendingCancellation(state, subscriptionId, now);
  }

  return state;
}

function ensurePendingCancellation(state: BillingState, subscriptionId: string, now: number): void {
  const id = `pa_cancel_${subscriptionId}`;
  const existing = state.pendingActions.find((a) => a.id === id);
  if (existing) return;
  state.pendingActions.push({
    id,
    kind: "cancel_subscription",
    subscriptionId,
    status: "pending",
    attempts: 0,
    createdAt: now,
    updatedAt: now
  });
}

export async function processPendingCancellations(
  state: BillingState,
  paddle: PaddleClient,
  now: number
): Promise<BillingState> {
  for (const action of state.pendingActions) {
    if (action.kind !== "cancel_subscription") continue;
    if (action.status === "done") continue;
    try {
      await paddle.cancelSubscription(action.subscriptionId);
      action.status = "done";
      action.attempts += 1;
      action.updatedAt = now;
    } catch {
      action.status = "failed";
      action.attempts += 1;
      action.updatedAt = now;
    }
  }
  return state;
}

function isRevoked(state: BillingState, subscription: SubscriptionState): boolean {
  return state.revocations.some((revocation) => {
    if (revocation.subscriptionId !== subscription.id) return false;
    if (revocation.periodEnd == null || subscription.currentPeriodEnd == null) return true;
    return subscription.currentPeriodEnd <= revocation.periodEnd;
  });
}

export type Entitlement = EntitlementResponse & { accountEmail: string | null };

export function computeAccess(
  state: BillingState,
  now: number,
  ttlMs: number,
  graceMs: number
): Entitlement {
  const subscriptions = Object.values(state.subscriptions);

  let best: { subscription: SubscriptionState; grace: boolean } | null = null;
  let anyRevoked = false;
  let revokeReason: string | null = null;
  let latestStatus = "inactive";
  let latestUpdated = -1;

  for (const subscription of subscriptions) {
    const revoked = isRevoked(state, subscription);
    if (revoked) {
      anyRevoked = true;
      const revocation = state.revocations.find((r) => r.subscriptionId === subscription.id);
      if (revocation) revokeReason = revocation.reason;
    }
    if (subscription.updatedAt >= latestUpdated) {
      latestUpdated = subscription.updatedAt;
      latestStatus = String(subscription.status).trim().toLowerCase() || "inactive";
    }

    const decision = evaluateAccess({
      now,
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      graceMs,
      revoked
    });

    if (decision.active) {
      if (!best || (!best.grace && decision.grace)) {
        best = { subscription, grace: decision.grace };
      }
    }
  }

  if (best) {
    const periodEnd = best.subscription.currentPeriodEnd;
    const graceUntil = best.grace && periodEnd != null ? periodEnd + graceMs : null;
    const deadline = graceUntil ?? periodEnd;
    const localUntil = new Date(deadline != null ? Math.min(now + ttlMs, deadline) : now + ttlMs).toISOString();
    return {
      active: true,
      plan: "paid",
      status: String(best.subscription.status).trim().toLowerCase() || "active",
      paidUntil: periodEnd != null ? new Date(periodEnd).toISOString() : null,
      graceUntil: graceUntil != null ? new Date(graceUntil).toISOString() : null,
      revoked: false,
      revokeReason: null,
      localUntil,
      checkedAt: new Date(now).toISOString(),
      accountEmail: null
    };
  }

  return {
    active: false,
    plan: "free",
    status: latestStatus,
    paidUntil: null,
    graceUntil: null,
    revoked: anyRevoked,
    revokeReason: anyRevoked ? revokeReason : null,
    localUntil: new Date(now).toISOString(),
    checkedAt: new Date(now).toISOString(),
    accountEmail: null
  };
}

/**
 * Plain base64 JSON voucher. The distributed extension cannot verify an HMAC,
 * so this is explicitly not tamper-proof; it only deters casual misuse by
 * bounding the honored expiry to the paid/grace deadline.
 */
export function buildEntitlementToken(entitlement: Entitlement, ttlMs: number, now: number): string {
  const deadlines = [entitlement.paidUntil, entitlement.graceUntil]
    .map((iso) => (iso ? Date.parse(iso) : Number.NaN))
    .filter((ms) => Number.isFinite(ms));

  const hardDeadline = deadlines.length ? Math.max(...deadlines) : Number.POSITIVE_INFINITY;
  const localUntilMs = entitlement.active ? Math.min(now + ttlMs, hardDeadline) : now;

  const payload: SignedEntitlement = {
    active: entitlement.active,
    plan: entitlement.plan,
    localUntil: new Date(localUntilMs).toISOString(),
    accountEmail: entitlement.accountEmail ?? null,
    issuedAt: new Date(now).toISOString()
  };

  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

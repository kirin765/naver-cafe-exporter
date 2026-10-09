import { DatabaseSync } from "node:sqlite";
import { randomId, randomToken, randomUserId } from "./extensionLink";
import {
  emptyBillingState,
  type AdjustmentState,
  type BillingState,
  type PendingActionState,
  type RevocationState,
  type SubscriptionState,
  type TransactionState
} from "./billing";

export type UserRow = { id: string; email: string; created_at: number };
export type SessionRow = { token: string; user_id: string; expires_at: number };
export type ExtensionSessionRow = {
  token: string;
  user_id: string;
  install_id: string | null;
  expires_at: number;
  revoked_at: number | null;
};
export type LinkRequestRow = {
  id: string;
  user_id: string | null;
  challenge_hash: string;
  verifier_hash: string;
  install_id: string;
  expires_at: number;
  approved_at: number | null;
  redeemed_at: number | null;
};
export type CheckoutIntentRow = {
  id: string;
  user_id: string;
  transaction_id: string | null;
  url: string;
  created_at: number;
  expires_at: number;
};

export type Store = {
  readonly db: DatabaseSync;
  close(): void;

  findOrCreateUserByEmail(email: string, now: number): UserRow;
  getUserByEmail(email: string): UserRow | null;
  getUserById(id: string): UserRow | null;

  createSession(token: string, userId: string, expiresAt: number): void;
  getSession(token: string): SessionRow | null;
  deleteSession(token: string): void;

  createMagicLink(token: string, userId: string, expiresAt: number): void;
  consumeMagicLink(token: string, now: number): string | null;

  createExtensionSession(token: string, userId: string, installId: string | null, expiresAt: number): void;
  getExtensionSession(token: string): ExtensionSessionRow | null;
  revokeExtensionSession(token: string, now: number): void;

  createLinkRequest(row: {
    id: string;
    challengeHash: string;
    verifierHash: string;
    installId: string;
    expiresAt: number;
  }): void;
  getLinkRequest(id: string): LinkRequestRow | null;
  approveLinkRequest(id: string, userId: string, now: number): boolean;
  redeemLinkRequest(id: string, now: number): boolean;

  setPaddleCustomer(userId: string, customerId: string): void;
  getPaddleCustomer(userId: string): string | null;
  getUserIdByCustomer(customerId: string): string | null;

  loadBillingState(filter?: { userId?: string }): BillingState;
  saveBillingState(state: BillingState): void;

  hasProcessedEvent(eventId: string): boolean;
  markProcessedEvent(eventId: string, now: number): void;

  createCheckoutIntent(row: {
    id: string;
    userId: string;
    transactionId: string | null;
    url: string;
    createdAt: number;
    expiresAt: number;
  }): void;
  findRecentCheckoutIntent(userId: string, now: number): CheckoutIntentRow | null;
};

function boolToInt(value: boolean): number {
  return value ? 1 : 0;
}

function intToBool(value: unknown): boolean {
  return Number(value ?? 0) !== 0;
}

function numOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function strOrNull(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value);
  return s === "" ? null : s;
}

const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS magic_links (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE TABLE IF NOT EXISTS extension_sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  install_id TEXT,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE TABLE IF NOT EXISTS link_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  challenge_hash TEXT NOT NULL,
  verifier_hash TEXT NOT NULL,
  install_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  approved_at INTEGER,
  redeemed_at INTEGER
);
CREATE TABLE IF NOT EXISTS paddle_customers (
  user_id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  status TEXT,
  current_period_start INTEGER,
  current_period_end INTEGER,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  subscription_id TEXT,
  status TEXT,
  paid_period_start INTEGER,
  paid_period_end INTEGER,
  created_at INTEGER NOT NULL DEFAULT 0,
  amount INTEGER,
  currency TEXT
);
CREATE TABLE IF NOT EXISTS adjustments (
  id TEXT PRIMARY KEY,
  action TEXT,
  status TEXT,
  transaction_id TEXT,
  subscription_id TEXT,
  amount INTEGER,
  currency TEXT,
  period_start INTEGER,
  period_end INTEGER,
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS revocations (
  user_id TEXT,
  subscription_id TEXT,
  period_end INTEGER,
  reason TEXT,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS processed_events (
  event_id TEXT PRIMARY KEY,
  processed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pending_actions (
  id TEXT PRIMARY KEY,
  kind TEXT,
  subscription_id TEXT,
  status TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER,
  updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS checkout_intents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  transaction_id TEXT,
  url TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
`;

export function openDb(path = ":memory:"): Store {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(DDL);

  const stmt = {
    insertUser: db.prepare("INSERT OR IGNORE INTO users (id, email, created_at) VALUES (?, ?, ?)"),
    selectUserByEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
    selectUserById: db.prepare("SELECT * FROM users WHERE id = ?"),
    insertSession: db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)"),
    selectSession: db.prepare("SELECT * FROM sessions WHERE token = ?"),
    deleteSession: db.prepare("DELETE FROM sessions WHERE token = ?"),
    insertMagic: db.prepare("INSERT INTO magic_links (token, user_id, expires_at) VALUES (?, ?, ?)"),
    consumeMagic: db.prepare(
      "UPDATE magic_links SET consumed_at = ? WHERE token = ? AND consumed_at IS NULL AND expires_at > ?"
    ),
    selectMagic: db.prepare("SELECT * FROM magic_links WHERE token = ?"),
    insertExtSession: db.prepare(
      "INSERT INTO extension_sessions (token, user_id, install_id, expires_at) VALUES (?, ?, ?, ?)"
    ),
    selectExtSession: db.prepare("SELECT * FROM extension_sessions WHERE token = ?"),
    revokeExtSession: db.prepare("UPDATE extension_sessions SET revoked_at = ? WHERE token = ?"),
    insertLink: db.prepare(
      "INSERT INTO link_requests (id, challenge_hash, verifier_hash, install_id, expires_at) VALUES (?, ?, ?, ?, ?)"
    ),
    selectLink: db.prepare("SELECT * FROM link_requests WHERE id = ?"),
    approveLink: db.prepare(
      "UPDATE link_requests SET approved_at = ?, user_id = ? WHERE id = ? AND redeemed_at IS NULL"
    ),
    redeemLink: db.prepare(
      "UPDATE link_requests SET redeemed_at = ? WHERE id = ? AND redeemed_at IS NULL AND approved_at IS NOT NULL"
    ),
    upsertCustomer: db.prepare(
      "INSERT INTO paddle_customers (user_id, customer_id) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET customer_id = excluded.customer_id"
    ),
    selectCustomerByUser: db.prepare("SELECT customer_id FROM paddle_customers WHERE user_id = ?"),
    selectUserByCustomer: db.prepare("SELECT user_id FROM paddle_customers WHERE customer_id = ?"),
    upsertSubscription: db.prepare(`
      INSERT INTO subscriptions (id, user_id, status, current_period_start, current_period_end, cancel_at_period_end, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        user_id = excluded.user_id,
        status = excluded.status,
        current_period_start = excluded.current_period_start,
        current_period_end = excluded.current_period_end,
        cancel_at_period_end = excluded.cancel_at_period_end,
        updated_at = excluded.updated_at
    `),
    upsertTransaction: db.prepare(`
      INSERT INTO transactions (id, user_id, subscription_id, status, paid_period_start, paid_period_end, created_at, amount, currency)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        user_id = excluded.user_id,
        subscription_id = excluded.subscription_id,
        status = excluded.status,
        paid_period_start = excluded.paid_period_start,
        paid_period_end = excluded.paid_period_end,
        created_at = excluded.created_at,
        amount = excluded.amount,
        currency = excluded.currency
    `),
    upsertAdjustment: db.prepare(`
      INSERT INTO adjustments (id, action, status, transaction_id, subscription_id, amount, currency, period_start, period_end, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        action = excluded.action,
        status = excluded.status,
        transaction_id = excluded.transaction_id,
        subscription_id = excluded.subscription_id,
        amount = excluded.amount,
        currency = excluded.currency,
        period_start = excluded.period_start,
        period_end = excluded.period_end,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `),
    insertRevocation: db.prepare(
      "INSERT INTO revocations (user_id, subscription_id, period_end, reason, created_at) VALUES (?, ?, ?, ?, ?)"
    ),
    deleteAllRevocations: db.prepare("DELETE FROM revocations"),
    insertPendingAction: db.prepare(
      "INSERT INTO pending_actions (id, kind, subscription_id, status, attempts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ),
    deleteAllPendingActions: db.prepare("DELETE FROM pending_actions"),
    selectAllCustomers: db.prepare("SELECT * FROM paddle_customers"),
    selectAllSubscriptions: db.prepare("SELECT * FROM subscriptions"),
    selectAllTransactions: db.prepare("SELECT * FROM transactions"),
    selectAllAdjustments: db.prepare("SELECT * FROM adjustments"),
    selectAllRevocations: db.prepare("SELECT * FROM revocations"),
    selectAllPendingActions: db.prepare("SELECT * FROM pending_actions"),
    hasEvent: db.prepare("SELECT event_id FROM processed_events WHERE event_id = ?"),
    insertEvent: db.prepare("INSERT OR IGNORE INTO processed_events (event_id, processed_at) VALUES (?, ?)"),
    insertCheckoutIntent: db.prepare(
      "INSERT INTO checkout_intents (id, user_id, transaction_id, url, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)"
    ),
    selectRecentIntent: db.prepare(
      "SELECT * FROM checkout_intents WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1"
    )
  };

  const store: Store = {
    db,
    close() {
      db.close();
    },

    findOrCreateUserByEmail(email, now) {
      const normalized = String(email ?? "").trim().toLowerCase();
      const existing = stmt.selectUserByEmail.get(normalized) as UserRow | undefined;
      if (existing) return existing;
      const id = randomUserId();
      stmt.insertUser.run(id, normalized, now);
      const row = stmt.selectUserByEmail.get(normalized) as UserRow | undefined;
      if (!row) throw new Error("failed to create user");
      return row;
    },
    getUserByEmail(email) {
      const normalized = String(email ?? "").trim().toLowerCase();
      return (stmt.selectUserByEmail.get(normalized) as UserRow | undefined) ?? null;
    },
    getUserById(id) {
      return (stmt.selectUserById.get(id) as UserRow | undefined) ?? null;
    },

    createSession(token, userId, expiresAt) {
      stmt.insertSession.run(token, userId, expiresAt);
    },
    getSession(token) {
      return (stmt.selectSession.get(token) as SessionRow | undefined) ?? null;
    },
    deleteSession(token) {
      stmt.deleteSession.run(token);
    },

    createMagicLink(token, userId, expiresAt) {
      stmt.insertMagic.run(token, userId, expiresAt);
    },
    consumeMagicLink(token, now) {
      const result = stmt.consumeMagic.run(now, token, now);
      if (Number(result.changes) === 0) return null;
      const row = stmt.selectMagic.get(token) as { user_id: string } | undefined;
      return row?.user_id ?? null;
    },

    createExtensionSession(token, userId, installId, expiresAt) {
      stmt.insertExtSession.run(token, userId, installId, expiresAt);
    },
    getExtensionSession(token) {
      return (stmt.selectExtSession.get(token) as ExtensionSessionRow | undefined) ?? null;
    },
    revokeExtensionSession(token, now) {
      stmt.revokeExtSession.run(now, token);
    },

    createLinkRequest(row) {
      stmt.insertLink.run(row.id, row.challengeHash, row.verifierHash, row.installId, row.expiresAt);
    },
    getLinkRequest(id) {
      return (stmt.selectLink.get(id) as LinkRequestRow | undefined) ?? null;
    },
    approveLinkRequest(id, userId, now) {
      return Number(stmt.approveLink.run(now, userId, id).changes) > 0;
    },
    redeemLinkRequest(id, now) {
      return Number(stmt.redeemLink.run(now, id).changes) > 0;
    },

    setPaddleCustomer(userId, customerId) {
      stmt.upsertCustomer.run(userId, customerId);
    },
    getPaddleCustomer(userId) {
      const row = stmt.selectCustomerByUser.get(userId) as { customer_id: string } | undefined;
      return row?.customer_id ?? null;
    },
    getUserIdByCustomer(customerId) {
      const row = stmt.selectUserByCustomer.get(customerId) as { user_id: string } | undefined;
      return row?.user_id ?? null;
    },

    loadBillingState(filter) {
      const state = emptyBillingState();

      for (const row of stmt.selectAllCustomers.all() as Record<string, unknown>[]) {
        const userId = String(row.user_id);
        const customerId = String(row.customer_id);
        state.customers[userId] = customerId;
        state.customerToUser[customerId] = userId;
      }

      for (const row of stmt.selectAllSubscriptions.all() as Record<string, unknown>[]) {
        const userId = strOrNull(row.user_id);
        if (filter?.userId && userId !== filter.userId) continue;
        const subscription: SubscriptionState = {
          id: String(row.id),
          userId,
          status: String(row.status ?? ""),
          currentPeriodStart: numOrNull(row.current_period_start),
          currentPeriodEnd: numOrNull(row.current_period_end),
          cancelAtPeriodEnd: intToBool(row.cancel_at_period_end),
          updatedAt: Number(row.updated_at ?? 0)
        };
        state.subscriptions[subscription.id] = subscription;
      }

      for (const row of stmt.selectAllTransactions.all() as Record<string, unknown>[]) {
        const userId = strOrNull(row.user_id);
        if (filter?.userId && userId !== filter.userId) continue;
        const transaction: TransactionState = {
          id: String(row.id),
          userId,
          subscriptionId: strOrNull(row.subscription_id),
          status: String(row.status ?? ""),
          paidPeriodStart: numOrNull(row.paid_period_start),
          paidPeriodEnd: numOrNull(row.paid_period_end),
          amount: numOrNull(row.amount),
          currency: strOrNull(row.currency),
          createdAt: Number(row.created_at ?? 0)
        };
        state.transactions[transaction.id] = transaction;
      }

      for (const row of stmt.selectAllAdjustments.all() as Record<string, unknown>[]) {
        const adjustment: AdjustmentState = {
          id: String(row.id),
          action: String(row.action ?? ""),
          status: String(row.status ?? ""),
          transactionId: strOrNull(row.transaction_id),
          subscriptionId: strOrNull(row.subscription_id),
          amount: Number(row.amount ?? 0),
          currency: strOrNull(row.currency),
          periodStart: numOrNull(row.period_start),
          periodEnd: numOrNull(row.period_end),
          createdAt: Number(row.created_at ?? 0),
          updatedAt: Number(row.updated_at ?? 0)
        };
        if (filter?.userId) {
          const linkedSub = adjustment.subscriptionId ? state.subscriptions[adjustment.subscriptionId] : undefined;
          const linkedTxn = adjustment.transactionId ? state.transactions[adjustment.transactionId] : undefined;
          if (!linkedSub && !linkedTxn) continue;
        }
        state.adjustments[adjustment.id] = adjustment;
      }

      for (const row of stmt.selectAllRevocations.all() as Record<string, unknown>[]) {
        const userId = strOrNull(row.user_id);
        if (filter?.userId && userId !== filter.userId) continue;
        const revocation: RevocationState = {
          userId: userId ?? "",
          subscriptionId: String(row.subscription_id),
          periodEnd: numOrNull(row.period_end),
          reason: String(row.reason ?? ""),
          createdAt: Number(row.created_at ?? 0)
        };
        state.revocations.push(revocation);
      }

      for (const row of stmt.selectAllPendingActions.all() as Record<string, unknown>[]) {
        const subscriptionId = String(row.subscription_id);
        if (filter?.userId && !state.subscriptions[subscriptionId]) continue;
        const action: PendingActionState = {
          id: String(row.id),
          kind: String(row.kind ?? ""),
          subscriptionId,
          status: String(row.status ?? "pending"),
          attempts: Number(row.attempts ?? 0),
          createdAt: Number(row.created_at ?? 0),
          updatedAt: Number(row.updated_at ?? 0)
        };
        state.pendingActions.push(action);
      }

      return state;
    },

    saveBillingState(state) {
      db.exec("BEGIN");
      try {
        for (const [userId, customerId] of Object.entries(state.customers)) {
          stmt.upsertCustomer.run(userId, customerId);
        }
        for (const subscription of Object.values(state.subscriptions)) {
          stmt.upsertSubscription.run(
            subscription.id,
            subscription.userId,
            subscription.status,
            subscription.currentPeriodStart,
            subscription.currentPeriodEnd,
            boolToInt(subscription.cancelAtPeriodEnd),
            subscription.updatedAt
          );
        }
        for (const transaction of Object.values(state.transactions)) {
          stmt.upsertTransaction.run(
            transaction.id,
            transaction.userId,
            transaction.subscriptionId,
            transaction.status,
            transaction.paidPeriodStart,
            transaction.paidPeriodEnd,
            transaction.createdAt,
            transaction.amount,
            transaction.currency
          );
        }
        for (const adjustment of Object.values(state.adjustments)) {
          stmt.upsertAdjustment.run(
            adjustment.id,
            adjustment.action,
            adjustment.status,
            adjustment.transactionId,
            adjustment.subscriptionId,
            adjustment.amount,
            adjustment.currency,
            adjustment.periodStart,
            adjustment.periodEnd,
            adjustment.createdAt,
            adjustment.updatedAt
          );
        }
        stmt.deleteAllRevocations.run();
        for (const revocation of state.revocations) {
          stmt.insertRevocation.run(
            revocation.userId,
            revocation.subscriptionId,
            revocation.periodEnd,
            revocation.reason,
            revocation.createdAt
          );
        }
        stmt.deleteAllPendingActions.run();
        for (const action of state.pendingActions) {
          stmt.insertPendingAction.run(
            action.id,
            action.kind,
            action.subscriptionId,
            action.status,
            action.attempts,
            action.createdAt,
            action.updatedAt
          );
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },

    hasProcessedEvent(eventId) {
      return stmt.hasEvent.get(eventId) !== undefined;
    },
    markProcessedEvent(eventId, now) {
      stmt.insertEvent.run(eventId, now);
    },

    createCheckoutIntent(row) {
      stmt.insertCheckoutIntent.run(row.id, row.userId, row.transactionId, row.url, row.createdAt, row.expiresAt);
    },
    findRecentCheckoutIntent(userId, now) {
      return (stmt.selectRecentIntent.get(userId, now) as CheckoutIntentRow | undefined) ?? null;
    }
  };

  return store;
}

export function newLinkRequestId(): string {
  return randomId("req");
}

export function newSessionToken(): string {
  return randomToken(32);
}

export function newMagicToken(): string {
  return randomToken(32);
}

export function newCheckoutIntentId(): string {
  return randomId("ci");
}

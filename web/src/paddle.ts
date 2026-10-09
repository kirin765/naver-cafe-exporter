import { paddleApiBase, type PaddleEnv } from "./config";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function asTrimmedString(value: unknown): string | null {
  const v = String(value ?? "").trim();
  return v || null;
}

function asNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Normalized shapes
// ---------------------------------------------------------------------------

export type NormalizedSubscription = {
  id: string;
  customerId: string;
  status: string;
  userId: string | null;
  priceId: string | null;
  currentPeriodStart: string | number | null;
  currentPeriodEnd: string | number | null;
  cancelAtPeriodEnd: boolean;
};

export type NormalizedTransaction = {
  id: string;
  customerId: string | null;
  subscriptionId: string | null;
  status: string;
  userId: string | null;
  priceId: string | null;
  paidPeriodStart: string | number | null;
  paidPeriodEnd: string | number | null;
  amount: number | null;
  currency: string | null;
};

export type NormalizedAdjustment = {
  id: string;
  action: string;
  status: string;
  transactionId: string | null;
  subscriptionId: string | null;
  amount: number;
  currency: string | null;
  periodStart: string | number | null;
  periodEnd: string | number | null;
};

// ---------------------------------------------------------------------------
// Payload helpers
// ---------------------------------------------------------------------------

export function extractCustomerId(data: unknown): string | null {
  const record = asRecord(data);
  if (!record) return null;

  const customer = asRecord(record.customer);
  return (
    asTrimmedString(record.customer_id) ??
    asTrimmedString(customer?.id) ??
    asTrimmedString(record.customer)
  );
}

export function extractCustomerEmail(data: unknown): string | null {
  const record = asRecord(data);
  if (!record) return null;

  const customer = asRecord(record.customer);
  const email =
    asTrimmedString(customer?.email_address) ??
    asTrimmedString(record.customer_email) ??
    asTrimmedString(record.email);
  return email ? email.toLowerCase() : null;
}

export function extractUserId(data: unknown): string | null {
  const record = asRecord(data);
  if (!record) return null;

  const customData = asRecord(record.custom_data);
  const metadata = asRecord(record.metadata);
  return asTrimmedString(customData?.user_id) ?? asTrimmedString(metadata?.user_id);
}

export function extractPriceId(data: unknown): string | null {
  const record = asRecord(data);
  if (!record) return null;

  const items = asRecord(record.items);
  const entries = Array.isArray(record.items)
    ? record.items
    : Array.isArray(items?.data)
      ? (items?.data as unknown[])
      : [];
  const first = asRecord(entries[0]);
  const firstPrice = asRecord(first?.price);

  return asTrimmedString(firstPrice?.id) ?? asTrimmedString(first?.price_id);
}

export function normalizeSubscriptionPayload(data: unknown): NormalizedSubscription | null {
  const record = asRecord(data);
  if (!record) return null;

  const id = asTrimmedString(record.id);
  const customerId = extractCustomerId(record);
  if (!id || !customerId) return null;

  const currentBillingPeriod = asRecord(record.current_billing_period);
  const scheduledChange = asRecord(record.scheduled_change);

  return {
    id,
    customerId,
    status: String(record.status ?? ""),
    userId: extractUserId(record),
    priceId: extractPriceId(record),
    currentPeriodStart: (currentBillingPeriod?.starts_at as string | number | null | undefined) ?? null,
    currentPeriodEnd: (currentBillingPeriod?.ends_at as string | number | null | undefined) ?? null,
    cancelAtPeriodEnd: String(scheduledChange?.action ?? "").trim() === "cancel"
  };
}

function extractBillingPeriod(record: UnknownRecord): { start: string | number | null; end: string | number | null } {
  const direct = asRecord(record.billing_period);
  if (direct) {
    return {
      start: (direct.starts_at as string | number | null | undefined) ?? null,
      end: (direct.ends_at as string | number | null | undefined) ?? null
    };
  }
  const items = Array.isArray(record.items) ? record.items : asRecord(record.items)?.data;
  const entries = Array.isArray(items) ? items : [];
  for (const entry of entries) {
    const item = asRecord(entry);
    const bp = asRecord(item?.billing_period);
    if (bp) {
      return {
        start: (bp.starts_at as string | number | null | undefined) ?? null,
        end: (bp.ends_at as string | number | null | undefined) ?? null
      };
    }
  }
  return { start: null, end: null };
}

export function normalizeTransactionPayload(data: unknown): NormalizedTransaction | null {
  const record = asRecord(data);
  if (!record) return null;
  const id = asTrimmedString(record.id);
  if (!id) return null;

  const period = extractBillingPeriod(record);
  const details = asRecord(record.details);
  const totals = asRecord(details?.totals);
  const rawAmount = totals?.total ?? totals?.grand_total ?? record.total ?? record.amount;

  return {
    id,
    customerId: extractCustomerId(record),
    subscriptionId:
      asTrimmedString(record.subscription_id) ?? asTrimmedString(record.subscription) ?? null,
    status: String(record.status ?? ""),
    userId: extractUserId(record),
    priceId: extractPriceId(record),
    paidPeriodStart: period.start,
    paidPeriodEnd: period.end,
    amount: asNumber(rawAmount),
    currency: asTrimmedString(record.currency_code) ?? asTrimmedString(record.currency)
  };
}

export function normalizeAdjustmentPayload(data: unknown): NormalizedAdjustment | null {
  const record = asRecord(data);
  if (!record) return null;
  const id = asTrimmedString(record.id);
  if (!id) return null;

  const totals = asRecord(record.totals);
  const rawAmount = totals?.total ?? totals?.grand_total ?? record.amount;
  const amount = Math.abs(asNumber(rawAmount) ?? 0);

  return {
    id,
    action: String(record.action ?? ""),
    status: String(record.status ?? ""),
    transactionId: asTrimmedString(record.transaction_id) ?? asTrimmedString(record.transaction) ?? null,
    subscriptionId: asTrimmedString(record.subscription_id) ?? asTrimmedString(record.subscription) ?? null,
    amount,
    currency: asTrimmedString(record.currency_code) ?? asTrimmedString(record.currency),
    periodStart: (asRecord(record.billing_period)?.starts_at as string | number | null | undefined) ?? null,
    periodEnd: (asRecord(record.billing_period)?.ends_at as string | number | null | undefined) ?? null
  };
}

// ---------------------------------------------------------------------------
// Client interface
// ---------------------------------------------------------------------------

export type CreateCheckoutArgs = {
  userId: string;
  priceId: string;
  successUrl: string;
  email?: string | null;
  customerId?: string | null;
  transactionId?: string | null;
};

export type CheckoutResult = {
  url: string;
  transactionId: string | null;
};

export type CreateCustomerArgs = {
  email: string;
  userId: string;
};

export interface PaddleClient {
  createCheckout(args: CreateCheckoutArgs): Promise<CheckoutResult>;
  createCustomer(args: CreateCustomerArgs): Promise<{ id: string }>;
  createPortal(customerId: string): Promise<{ url: string }>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  getSubscription(subscriptionId: string): Promise<NormalizedSubscription | null>;
  getTransaction(transactionId: string): Promise<NormalizedTransaction | null>;
  listAdjustments(args: { transactionId: string }): Promise<NormalizedAdjustment[]>;
}

type PaddleRequestErrorInfo = {
  status: number;
  code: string;
  message: string;
  raw?: unknown;
};

export class PaddleRequestError extends Error {
  info: PaddleRequestErrorInfo;

  constructor(info: PaddleRequestErrorInfo) {
    super(info.message);
    this.name = "PaddleRequestError";
    this.info = info;
  }
}

export class HttpPaddleClient implements PaddleClient {
  private readonly apiKey: string;
  private readonly env: PaddleEnv;

  constructor(apiKey: string, env: PaddleEnv) {
    this.apiKey = apiKey;
    this.env = env;
  }

  private async request<T = unknown>(
    path: string,
    method: "GET" | "POST" = "POST",
    body?: Record<string, unknown>
  ): Promise<T> {
    if (!path.startsWith("/")) throw new Error("Paddle request path must start with '/'");

    const res = await fetch(`${paddleApiBase(this.env)}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        "paddle-version": "1"
      },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {})
    });

    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (!res.ok) {
      const parsed = asRecord(json);
      const nested = asRecord(parsed?.error);
      const message =
        asTrimmedString(nested?.detail) ??
        asTrimmedString(nested?.message) ??
        `Paddle request failed (${res.status})`;
      throw new PaddleRequestError({
        status: res.status,
        code: asTrimmedString(nested?.code) ?? "paddle_request_failed",
        message,
        raw: json ?? text
      });
    }

    const outer = asRecord(json);
    return ((outer?.data ?? json) as T);
  }

  async createCheckout(args: CreateCheckoutArgs): Promise<CheckoutResult> {
    const transaction = await this.request<UnknownRecord>("/transactions", "POST", {
      items: [{ price_id: args.priceId, quantity: 1 }],
      ...(args.customerId ? { customer_id: args.customerId } : {}),
      custom_data: { user_id: args.userId },
      checkout: { url: args.successUrl }
    });

    const checkout = asRecord(transaction?.checkout);
    const url = asTrimmedString(checkout?.url);
    if (!url) throw new PaddleRequestError({ status: 500, code: "checkout_url_missing", message: "Paddle did not return a checkout URL" });
    return { url, transactionId: asTrimmedString(transaction?.id) };
  }

  async createCustomer(args: CreateCustomerArgs): Promise<{ id: string }> {
    const customer = await this.request<UnknownRecord>("/customers", "POST", {
      email: args.email,
      custom_data: { user_id: args.userId }
    });
    const id = asTrimmedString(customer?.id);
    if (!id) throw new PaddleRequestError({ status: 500, code: "customer_id_missing", message: "Paddle did not return a customer id" });
    return { id };
  }

  async createPortal(customerId: string): Promise<{ url: string }> {
    const session = await this.request<UnknownRecord>(
      `/customers/${encodeURIComponent(customerId)}/portal-sessions`,
      "POST",
      {}
    );
    const urls = asRecord(session?.urls);
    const general = asRecord(urls?.general);
    const url = asTrimmedString(general?.url) ?? asTrimmedString(session?.url);
    if (!url) throw new PaddleRequestError({ status: 500, code: "portal_url_missing", message: "Paddle did not return a portal URL" });
    return { url };
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    await this.request(`/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, "POST", {
      effective_from: "immediately"
    });
  }

  async getSubscription(subscriptionId: string): Promise<NormalizedSubscription | null> {
    const data = await this.request(`/subscriptions/${encodeURIComponent(subscriptionId)}`, "GET");
    return normalizeSubscriptionPayload(data);
  }

  async getTransaction(transactionId: string): Promise<NormalizedTransaction | null> {
    const data = await this.request(`/transactions/${encodeURIComponent(transactionId)}`, "GET");
    return normalizeTransactionPayload(data);
  }

  async listAdjustments(args: { transactionId: string }): Promise<NormalizedAdjustment[]> {
    const data = await this.request<unknown>(
      `/adjustments?transaction_id=${encodeURIComponent(args.transactionId)}`,
      "GET"
    );
    const record = asRecord(data);
    const rows = Array.isArray(data)
      ? data
      : Array.isArray(record?.data)
        ? (record?.data as unknown[])
        : [];
    return rows.map(normalizeAdjustmentPayload).filter((x): x is NormalizedAdjustment => x !== null);
  }
}

// ---------------------------------------------------------------------------
// Fake client for tests
// ---------------------------------------------------------------------------

export type FakePaddleOptions = {
  checkoutUrl?: string;
  portalUrl?: string;
  failCancel?: boolean;
  failPortal?: boolean;
  failCheckout?: boolean;
};

export class FakePaddleClient implements PaddleClient {
  checkoutUrl: string;
  portalUrl: string;
  failCancel: boolean;
  failPortal: boolean;
  failCheckout: boolean;

  readonly calls: { method: string; args: unknown }[] = [];
  private seq = 0;

  constructor(opts: FakePaddleOptions = {}) {
    this.checkoutUrl = opts.checkoutUrl ?? "https://sandbox-checkout.paddle.test/txn_fake";
    this.portalUrl = opts.portalUrl ?? "https://sandbox-portal.paddle.test/session_fake";
    this.failCancel = opts.failCancel ?? false;
    this.failPortal = opts.failPortal ?? false;
    this.failCheckout = opts.failCheckout ?? false;
  }

  async createCheckout(args: CreateCheckoutArgs): Promise<CheckoutResult> {
    this.calls.push({ method: "createCheckout", args });
    if (this.failCheckout) throw new PaddleRequestError({ status: 500, code: "fake_checkout_failed", message: "fake checkout failure" });
    this.seq += 1;
    return { url: this.checkoutUrl, transactionId: `txn_fake_${this.seq}` };
  }

  async createCustomer(args: CreateCustomerArgs): Promise<{ id: string }> {
    this.calls.push({ method: "createCustomer", args });
    this.seq += 1;
    return { id: `ctm_fake_${this.seq}` };
  }

  async createPortal(customerId: string): Promise<{ url: string }> {
    this.calls.push({ method: "createPortal", args: { customerId } });
    if (this.failPortal) throw new PaddleRequestError({ status: 500, code: "fake_portal_failed", message: "fake portal failure" });
    return { url: this.portalUrl };
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    this.calls.push({ method: "cancelSubscription", args: { subscriptionId } });
    if (this.failCancel) throw new PaddleRequestError({ status: 500, code: "fake_cancel_failed", message: "fake cancel failure" });
  }

  async getSubscription(subscriptionId: string): Promise<NormalizedSubscription | null> {
    this.calls.push({ method: "getSubscription", args: { subscriptionId } });
    return null;
  }

  async getTransaction(transactionId: string): Promise<NormalizedTransaction | null> {
    this.calls.push({ method: "getTransaction", args: { transactionId } });
    return null;
  }

  async listAdjustments(args: { transactionId: string }): Promise<NormalizedAdjustment[]> {
    this.calls.push({ method: "listAdjustments", args });
    return [];
  }
}

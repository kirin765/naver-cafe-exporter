import { describe, expect, it } from "vitest";
import { applyServerEntitlement, localPaidAccess, shouldRefresh } from "../src/lib/entitlement";
import { parseEntitlementToken } from "../../shared/schema";
import type { EntitlementResponse } from "../../shared/schema";

function token(payload: Record<string, unknown>): string {
  return btoa(JSON.stringify(payload));
}

function entitlement(overrides: Partial<EntitlementResponse> = {}): EntitlementResponse {
  return {
    active: true,
    plan: "paid",
    status: "active",
    paidUntil: new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString(),
    graceUntil: null,
    revoked: false,
    revokeReason: null,
    localUntil: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    checkedAt: new Date().toISOString(),
    ...overrides
  };
}

describe("entitlement cache", () => {
  it("round-trips a token and parses it", () => {
    const t = token({ active: true, plan: "paid", localUntil: new Date(Date.now() + 1000).toISOString(), accountEmail: "a@b.c", issuedAt: "" });
    const parsed = parseEntitlementToken(t);
    expect(parsed?.active).toBe(true);
    expect(parsed?.plan).toBe("paid");
  });

  it("refreshes when there is no cache", () => {
    expect(shouldRefresh(null, Date.now())).toBe(true);
  });

  it("refreshes after 24h", () => {
    const now = Date.now();
    const cache = applyServerEntitlement(entitlement(), token({ active: true, plan: "paid", localUntil: new Date(now + 3600_000).toISOString(), accountEmail: null, issuedAt: "" }), now);
    expect(shouldRefresh(cache, now + 1000)).toBe(false);
    expect(shouldRefresh(cache, now + 25 * 3600_000)).toBe(true);
  });

  it("honors a paid token until it expires", () => {
    const now = Date.now();
    const entitlementUntil = new Date(now + 3600_000).toISOString();
    const cache = applyServerEntitlement(
      entitlement({ localUntil: entitlementUntil }),
      token({ active: true, plan: "paid", localUntil: entitlementUntil, accountEmail: null, issuedAt: "" }),
      now
    );
    expect(localPaidAccess(cache, now).active).toBe(true);
    expect(localPaidAccess(cache, now + 2 * 3600_000).active).toBe(false);
  });

  it("returns free when no cache exists", () => {
    expect(localPaidAccess(null, Date.now()).plan).toBe("free");
  });
});

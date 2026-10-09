/**
 * Versioned contracts shared by the browser extension and the product backend.
 *
 * This module must stay dependency-free (plain TypeScript) so it can be bundled
 * into the MV3 extension (esbuild/IIFE) and imported by the Node backend
 * (esbuild/CJS or ESM) without a build-order dependency.
 */

export const SCHEMA_VERSION = 1 as const;
export const APP_VERSION = "0.1.0";

// ---------------------------------------------------------------------------
// Datasets and records
// ---------------------------------------------------------------------------

export type Dataset = "posts" | "comments" | "members" | "authors";
export const DATASETS: readonly Dataset[] = ["posts", "comments", "members", "authors"];

/** How the source exposed an identifier. `absent` means no id at all. */
export type IdType =
  | "member_key"
  | "login_id"
  | "display_id"
  | "masked_id"
  | "nickname_only"
  | "absent";

export type IdentityStatus = "resolved" | "unresolved";

export type PostRecord = {
  cafeId: string;
  boardId: string;
  boardName: string;
  postId: string;
  title: string;
  bodyText: string;
  authorKey: string;
  nickname: string;
  displayedId: string;
  idType: IdType;
  createdAt: string | null;
  updatedAt: string | null;
  viewCount: number | null;
  commentCount: number | null;
  sourceUrl: string;
};

export type CommentRecord = {
  cafeId: string;
  postId: string;
  commentId: string;
  parentCommentId: string | null;
  authorKey: string;
  nickname: string;
  displayedId: string;
  idType: IdType;
  bodyText: string;
  createdAt: string | null;
  sourceUrl: string;
};

export type MemberRecord = {
  cafeId: string;
  memberKey: string;
  nickname: string;
  displayedId: string;
  idType: IdType;
  grade: string | null;
  joinedAt: string | null;
  sourceUrl: string;
};

export type AuthorRecord = {
  cafeId: string;
  authorKey: string;
  nickname: string;
  displayedId: string;
  idType: IdType;
  identityStatus: IdentityStatus;
  observedPostCount: number;
  observedCommentCount: number;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
};

export type RecordByDataset = {
  posts: PostRecord;
  comments: CommentRecord;
  members: MemberRecord;
  authors: AuthorRecord;
};

/** The stable primary key of a record inside a single job. */
export function recordId(dataset: Dataset, rec: RecordByDataset[Dataset]): string {
  switch (dataset) {
    case "posts":
      return (rec as PostRecord).postId;
    case "comments":
      return (rec as CommentRecord).commentId;
    case "members":
      return (rec as MemberRecord).memberKey;
    case "authors":
      return (rec as AuthorRecord).authorKey;
  }
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

export type AccessCode =
  | "public"
  | "login_required"
  | "membership_required"
  | "approval_required"
  | "grade_required"
  | "denied"
  | "unknown";

export type AccessState = {
  scope: string;
  code: AccessCode;
  /** Only present when the source itself exposes the required grade name. */
  requiredGrade: string | null;
  httpStatus: number | null;
  message: string;
};

/** Korean user-facing copy, kept in one place so UI and tests agree. */
export const ACCESS_MESSAGES: Record<AccessCode, string> = {
  public: "공개 콘텐츠입니다. 로그인 없이 수집할 수 있습니다.",
  login_required: "이 콘텐츠를 수집하려면 네이버 로그인이 필요합니다.",
  membership_required: "카페 가입 또는 가입 승인이 필요합니다.",
  approval_required: "카페 가입 승인 대기 중입니다. 승인 후 다시 확인해 주세요.",
  grade_required: "등업 후 이용 가능한 게시판입니다.",
  denied: "현재 계정으로 접근할 수 없습니다.",
  unknown: "현재 계정으로 접근할 수 없습니다."
};

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export type JobStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";

export type WorkStatus = "pending" | "in_progress" | "blocked_access" | "done" | "skipped";

export type JobPhase =
  | "idle"
  | "detect"
  | "posts"
  | "post_detail"
  | "comments"
  | "members"
  | "authors"
  | "finalize";

export type JobFilters = {
  cafeId: string;
  boardId: string;
  boardName: string;
  /** Inclusive lower bound on post publication time (ISO, Asia/Seoul applied upstream). */
  dateFrom: string | null;
  /** Exclusive upper bound (ISO). */
  dateTo: string | null;
  maxPosts: number;
  includeComments: boolean;
  includeBody: boolean;
  includeMembers: boolean;
};

export type CoverageEntry = {
  requested: boolean;
  available: boolean;
  collected: number;
  deferred: number;
  skipped: number;
  note: string;
};

export type Coverage = {
  posts: CoverageEntry;
  comments: CoverageEntry;
  members: CoverageEntry;
  authors: CoverageEntry;
};

export type Counters = {
  posts: number;
  comments: number;
  members: number;
};

export type JobCounters = {
  committed: Counters;
  deferred: number;
  skipped: number;
};

export type Job = {
  jobId: string;
  revision: number;
  schemaVersion: number;
  appVersion: string;
  status: JobStatus;
  phase: JobPhase;
  preview: boolean;
  filters: JobFilters;
  cursors: Record<string, string | null>;
  counters: JobCounters;
  coverage: Coverage;
  runnerToken: string | null;
  runnerGeneration: number;
  createdAt: number;
  updatedAt: number;
  observationStartedAt: number;
  observationEndedAt: number | null;
  lastError: string | null;
  /** Bounded entitlement honored for this job's paid access, if any. */
  entitlementExpiresAt: string | null;
};

export type WorkItem = {
  workId: string;
  jobId: string;
  dataset: Dataset;
  /** Scope key, e.g. `post:{postId}` for comment/detail work. */
  scope: string;
  status: WorkStatus;
  sourceUrl: string;
  cursor: string | null;
  denialReason: string | null;
  attempts: number;
  lastAttemptAt: number | null;
};

// ---------------------------------------------------------------------------
// Resource limits / retention
// ---------------------------------------------------------------------------

export const LIMITS = {
  previewPosts: 20,
  previewComments: 100,
  previewDirectory: 20,
  maxPosts: 5000,
  maxComments: 50000,
  maxMembers: 20000,
  /** Normalized-text budget per job (bytes of UTF-8). */
  perJobTextBytes: 100 * 1024 * 1024,
  /** Overall extension-origin budget across all jobs (bytes). */
  overallBytes: 500 * 1024 * 1024,
  /** Fraction of the browser-reported quota to keep as headroom. */
  browserHeadroomRatio: 0.2,
  retentionDays: 7,
  retentionJobs: 5,
  requestDelayMinMs: 1000,
  requestDelayMaxMs: 2000
} as const;

// ---------------------------------------------------------------------------
// Export metadata
// ---------------------------------------------------------------------------

export type RecoveryRecord = {
  scope: string;
  dataset: Dataset;
  recoveredAt: number;
  note: string;
};

// ---------------------------------------------------------------------------
// Backend API (extension <-> product server)
// ---------------------------------------------------------------------------

export type LinkStartRequest = { challenge: string; installId: string };
export type LinkStartResponse = { requestId: string; verificationUrl: string; expiresAt: string };

export type LinkRedeemRequest = {
  requestId: string;
  challenge: string;
  verifier: string;
  installId: string;
};
export type LinkRedeemResponse = {
  token: string;
  expiresAt: string;
  accountEmail: string | null;
};

export type EntitlementResponse = {
  active: boolean;
  plan: "free" | "paid";
  status: string;
  /** End of the currently paid period (ISO) or null for free. */
  paidUntil: string | null;
  /** End of the recovery grace window (ISO) or null. */
  graceUntil: string | null;
  revoked: boolean;
  revokeReason: string | null;
  /** Opaque, signed, offline-honorable token; extension trusts it until expiry. */
  localUntil: string;
  checkedAt: string;
};

export type CheckoutRequest = { priceId?: string };
export type CheckoutResponse = { url: string; transactionId: string | null };

export type PortalResponse = { url: string };

export type ApiError = { error: { code: string; message: string } };

// ---------------------------------------------------------------------------
// Pure entitlement evaluation (shared by server and tests)
// ---------------------------------------------------------------------------

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "completed"
  | "paid"
  | "canceled"
  | "paused"
  | "inactive";

const ACTIVE_STATUSES = new Set<SubscriptionStatus>(["trialing", "active", "completed", "paid"]);

export function isActiveSubscriptionStatus(status: string): boolean {
  return ACTIVE_STATUSES.has(String(status).trim().toLowerCase() as SubscriptionStatus);
}

export type AccessInput = {
  now: number;
  status: string;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  /** Milliseconds of grace after the paid period ends on a failed renewal. */
  graceMs: number;
  /** True when a confirmed full refund / chargeback revoked the current period. */
  revoked: boolean;
};

export type AccessDecision = {
  active: boolean;
  plan: "free" | "paid";
  /** true when collection should pause but local downloads remain allowed. */
  grace: boolean;
  reason: string;
};

/**
 * Derive product access from the paid period, subscription status, grace
 * deadline and persisted revocations together. A revocation always wins over a
 * replayed active status.
 */
export function evaluateAccess(input: AccessInput): AccessDecision {
  if (input.revoked) {
    return { active: false, plan: "free", grace: false, reason: "revoked" };
  }
  const status = String(input.status).trim().toLowerCase();
  if (status === "past_due") {
    const deadline = (input.currentPeriodEnd ?? 0) + input.graceMs;
    if (input.currentPeriodEnd != null && input.now <= deadline) {
      return { active: true, plan: "paid", grace: true, reason: "past_due_grace" };
    }
    return { active: false, plan: "free", grace: false, reason: "past_due_expired" };
  }
  if (isActiveSubscriptionStatus(status)) {
    if (input.currentPeriodEnd != null && input.now > input.currentPeriodEnd + input.graceMs) {
      return { active: false, plan: "free", grace: false, reason: "period_expired" };
    }
    return { active: true, plan: "paid", grace: false, reason: status };
  }
  return { active: false, plan: "free", grace: false, reason: status || "inactive" };
}

// ---------------------------------------------------------------------------
// Bounded offline entitlement token
// ---------------------------------------------------------------------------

export type SignedEntitlement = {
  active: boolean;
  plan: "free" | "paid";
  localUntil: string;
  accountEmail: string | null;
  issuedAt: string;
};

/**
 * The extension cannot verify the HMAC (no shared secret in a distributed
 * client) so it treats the token as an opaque voucher and only checks that the
 * embedded expiry has not passed. The server issues it; it deters casual
 * tampering but is explicitly not tamper-proof.
 */
export function parseEntitlementToken(token: string | null): SignedEntitlement | null {
  if (!token) return null;
  try {
    const json = JSON.parse(atob(token));
    if (!json || typeof json !== "object") return null;
    const localUntil = String((json as SignedEntitlement).localUntil ?? "");
    if (!localUntil || Number.isNaN(Date.parse(localUntil))) return null;
    return {
      active: Boolean((json as SignedEntitlement).active),
      plan: (json as SignedEntitlement).plan === "paid" ? "paid" : "free",
      localUntil,
      accountEmail: (json as SignedEntitlement).accountEmail ?? null,
      issuedAt: String((json as SignedEntitlement).issuedAt ?? "")
    };
  } catch {
    return null;
  }
}

/** Honor a stored token only while it has not expired (offline path). */
export function entitlementOfflineValid(
  token: SignedEntitlement | null,
  now = Date.now()
): boolean {
  if (!token) return false;
  return token.active && Date.parse(token.localUntil) > now;
}

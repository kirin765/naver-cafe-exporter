import { ACCESS_MESSAGES, type AccessCode, type AccessState } from "../../../shared/schema";

export type AccessSignal = {
  scope: string;
  httpStatus?: number | null;
  /** Text/JSON body snippet used only for classification, never persisted. */
  body?: string | null;
  /** URL after redirects, when known. */
  finalUrl?: string | null;
  /** True when a Naver session was present for the request. */
  loggedIn?: boolean;
  /** Grade name only when the source itself exposes it. */
  requiredGrade?: string | null;
};

const GRADE_PATTERN = /등업|등급|레벨|grade|level/i;

/**
 * Classify source-confirmed access from the actual response. Classification is
 * deliberately conservative: an unclear denial becomes `denied`, never a guess
 * about the reason.
 */
export function classifyAccess(signal: AccessSignal): AccessState {
  const body = signal.body ?? "";
  const finalUrl = signal.finalUrl ?? "";
  const status = signal.httpStatus ?? null;

  const state = (code: AccessCode, requiredGrade: string | null = null): AccessState => ({
    scope: signal.scope,
    code,
    requiredGrade,
    httpStatus: status,
    message: requiredGrade && code === "grade_required"
      ? `${ACCESS_MESSAGES.grade_required} (필요 등급: ${requiredGrade})`
      : ACCESS_MESSAGES[code]
  });

  if (/nid\.naver\.com|로그인이?\s*필요|login required/i.test(finalUrl) ||
      /로그인이?\s*필요|네이버\s*로그인/i.test(body)) {
    return state("login_required");
  }

  if (/가입\s*승인|승인\s*대기|가입\s*신청/i.test(body)) {
    return state("approval_required");
  }

  if (GRADE_PATTERN.test(body) || signal.requiredGrade) {
    return state("grade_required", signal.requiredGrade ?? null);
  }

  if (/카페\s*가입|회원\s*가입|가입이?\s*필요|멤버\s*전용|멤버만/i.test(body)) {
    return state("membership_required");
  }

  if (status != null && (status === 401 || status === 403)) {
    return state(signal.loggedIn ? "denied" : "login_required");
  }

  if (status != null && status >= 400) {
    return state("denied");
  }

  if (status != null && status >= 200 && status < 300) {
    // A 200 with a login form still means login is required.
    if (/<input[^>]+type=["']password["']/i.test(body) && /login|로그인/i.test(body)) {
      return state("login_required");
    }
    return state("public");
  }

  return state("unknown");
}

export function isAccessBlocked(state: AccessState): boolean {
  return state.code !== "public";
}

/** Error surfaced when a source-confirmed block prevents collection. */
export function accessError(state: AccessState): Error & { access?: AccessState } {
  const err = new Error(state.message) as Error & { access?: AccessState; code?: string };
  err.code = "ACCESS";
  err.access = state;
  return err;
}

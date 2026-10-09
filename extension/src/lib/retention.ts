import type { Job } from "../../../shared/schema";
import { LIMITS } from "../../../shared/schema";

/** A partial job is still retryable while it has deferred (blocked) work. */
export function isRetryable(job: Pick<Job, "status" | "counters">): boolean {
  return job.counters.deferred > 0;
}

/** Running, paused and retryable partial jobs must never be auto-cleaned. */
export function isProtected(job: Pick<Job, "status" | "counters">): boolean {
  if (job.status === "running" || job.status === "paused" || job.status === "queued") return true;
  if (job.status === "partial") return isRetryable(job);
  return false;
}

/** Finished = terminal and not protected. */
export function isFinished(job: Pick<Job, "status" | "counters">): boolean {
  return (
    job.status === "completed" ||
    job.status === "cancelled" ||
    job.status === "failed" ||
    (job.status === "partial" && !isRetryable(job))
  );
}

export type RetentionPolicy = { days: number; maxJobs: number };

export const DEFAULT_RETENTION: RetentionPolicy = {
  days: LIMITS.retentionDays,
  maxJobs: LIMITS.retentionJobs
};

/**
 * Choose finished jobs to delete. A job is eligible after `days`, and if more
 * than `maxJobs` finished jobs exist the oldest are removed first. Protected
 * jobs are never returned. Order is oldest-first.
 */
export function selectRetentionCandidates(
  jobs: Job[],
  now: number,
  policy: RetentionPolicy = DEFAULT_RETENTION
): string[] {
  const finished = jobs
    .filter((j) => isFinished(j))
    .sort((a, b) => a.updatedAt - b.updatedAt);
  const cutoff = now - policy.days * 24 * 60 * 60 * 1000;

  const candidates = new Set<string>();
  for (const job of finished) {
    if (job.updatedAt < cutoff) candidates.add(job.jobId);
  }
  const overflow = finished.length - policy.maxJobs;
  if (overflow > 0) {
    for (let i = 0; i < overflow; i++) candidates.add(finished[i].jobId);
  }
  return [...candidates];
}

export type StorageCheck = {
  /** Bytes used by this extension origin, if known. */
  usage: number | null;
  /** Browser-reported quota, if known. */
  quota: number | null;
  persisted: boolean;
};

export type StorageDecision = {
  ok: boolean;
  level: "ok" | "warn" | "full" | "unknown";
  message: string;
  /** Free bytes we still consider safe to use. */
  safeBudget: number | null;
};

/**
 * Combine the app's own 500 MB budget with a headroom check against the
 * browser-reported quota. Estimates are advisory: every write must still handle
 * quota failures.
 */
export function evaluateStorage(
  check: StorageCheck,
  appBudgetBytes: number = LIMITS.overallBytes
): StorageDecision {
  if (check.usage == null) {
    return { ok: true, level: "unknown", message: "저장 공간 정보를 확인할 수 없습니다.", safeBudget: appBudgetBytes };
  }
  if (check.usage >= appBudgetBytes) {
    return {
      ok: false,
      level: "full",
      message: "이 브라우저의 내보내기 저장 공간 한도(500MB)에 도달했습니다. 오래된 작업을 내려받거나 삭제해 주세요.",
      safeBudget: 0
    };
  }
  if (check.quota != null) {
    const headroom = check.quota * LIMITS.browserHeadroomRatio;
    const permitted = check.quota - headroom;
    if (check.usage >= permitted) {
      return {
        ok: false,
        level: "full",
        message: "브라우저 저장 공간이 부족합니다. 오래된 작업을 정리한 뒤 다시 시도해 주세요.",
        safeBudget: 0
      };
    }
    const remaining = Math.min(appBudgetBytes - check.usage, permitted - check.usage);
    const level = remaining < appBudgetBytes * 0.15 ? "warn" : "ok";
    return {
      ok: true,
      level,
      message: check.persisted
        ? "저장 공간이 충분합니다."
        : "브라우저가 저장 공간을 보장하지 않습니다. 결과를 내려받아 보관해 주세요.",
      safeBudget: remaining
    };
  }
  return { ok: true, level: "unknown", message: "저장 공간 여유를 확인하고 있습니다.", safeBudget: appBudgetBytes - check.usage };
}

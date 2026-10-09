import { describe, expect, it } from "vitest";
import {
  evaluateStorage,
  isFinished,
  isProtected,
  selectRetentionCandidates,
  DEFAULT_RETENTION
} from "../src/lib/retention";
import type { Job } from "../../shared/schema";

function job(overrides: Partial<Job>): Job {
  return {
    jobId: "j1",
    revision: 0,
    schemaVersion: 1,
    appVersion: "0",
    status: "completed",
    phase: "finalize",
    preview: false,
    filters: {
      cafeId: "c",
      boardId: "b",
      boardName: "",
      dateFrom: null,
      dateTo: null,
      maxPosts: 1,
      includeComments: false,
      includeBody: false,
      includeMembers: false
    },
    cursors: {},
    counters: { committed: { posts: 0, comments: 0, members: 0 }, deferred: 0, skipped: 0 },
    coverage: {
      posts: { requested: true, available: true, collected: 0, deferred: 0, skipped: 0, note: "" },
      comments: { requested: false, available: false, collected: 0, deferred: 0, skipped: 0, note: "" },
      members: { requested: false, available: false, collected: 0, deferred: 0, skipped: 0, note: "" },
      authors: { requested: true, available: true, collected: 0, deferred: 0, skipped: 0, note: "" }
    },
    runnerToken: null,
    runnerGeneration: 0,
    createdAt: 0,
    updatedAt: 0,
    observationStartedAt: 0,
    observationEndedAt: null,
    lastError: null,
    entitlementExpiresAt: null,
    ...overrides
  };
}

const DAY = 24 * 60 * 60 * 1000;

describe("retention protection", () => {
  it("protects running/paused/queued and retryable partial jobs", () => {
    expect(isProtected(job({ status: "running" }))).toBe(true);
    expect(isProtected(job({ status: "paused" }))).toBe(true);
    expect(isProtected(job({ status: "partial", counters: { committed: { posts: 1, comments: 0, members: 0 }, deferred: 2, skipped: 0 } }))).toBe(true);
    expect(isProtected(job({ status: "partial" }))).toBe(false);
  });

  it("treats non-retryable partial as finished", () => {
    expect(isFinished(job({ status: "partial" }))).toBe(true);
    expect(isFinished(job({ status: "failed" }))).toBe(true);
    expect(isFinished(job({ status: "running" }))).toBe(false);
  });
});

describe("selectRetentionCandidates", () => {
  it("deletes finished jobs older than the retention window", () => {
    const now = 100 * DAY;
    const old = job({ jobId: "old", status: "completed", updatedAt: now - 8 * DAY });
    const fresh = job({ jobId: "fresh", status: "completed", updatedAt: now - 1 * DAY });
    expect(selectRetentionCandidates([old, fresh], now)).toEqual(["old"]);
  });

  it("removes the oldest once finished jobs exceed the cap", () => {
    const now = 1 * DAY;
    const jobs = Array.from({ length: 7 }, (_, i) =>
      job({ jobId: `j${i}`, status: "completed", updatedAt: now - i * 1000 })
    );
    const candidates = selectRetentionCandidates(jobs, now, { ...DEFAULT_RETENTION, days: 999 });
    expect(candidates.length).toBe(2);
    expect(candidates).toContain("j6");
    expect(candidates).toContain("j5");
  });

  it("never returns protected jobs", () => {
    const now = 100 * DAY;
    const running = job({ jobId: "r", status: "running", updatedAt: 0 });
    expect(selectRetentionCandidates([running], now)).toEqual([]);
  });
});

describe("evaluateStorage", () => {
  it("warns when the app budget is exceeded", () => {
    const decision = evaluateStorage({ usage: 600 * 1024 * 1024, quota: 2 * 1024 * 1024 * 1024, persisted: true });
    expect(decision.ok).toBe(false);
    expect(decision.level).toBe("full");
  });

  it("keeps 20% headroom against the browser quota", () => {
    const decision = evaluateStorage({ usage: 850, quota: 1000, persisted: true }, 1000);
    expect(decision.ok).toBe(false);
  });

  it("reports unknown when usage is unavailable", () => {
    expect(evaluateStorage({ usage: null, quota: null, persisted: false }).level).toBe("unknown");
  });
});

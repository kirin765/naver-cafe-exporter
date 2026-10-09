import { describe, expect, it } from "vitest";
import {
  acquireLease,
  canTransition,
  createJob,
  initialCoverage,
  releaseLease,
  terminalStatus,
  transition,
  workIdFor
} from "../src/lib/jobs";
import type { JobFilters } from "../../shared/schema";

const filters: JobFilters = {
  cafeId: "c1",
  boardId: "b1",
  boardName: "자유",
  dateFrom: null,
  dateTo: null,
  maxPosts: 100,
  includeComments: true,
  includeBody: true,
  includeMembers: false
};

describe("job lifecycle", () => {
  it("creates a queued job with requested coverage", () => {
    const job = createJob(filters, false);
    expect(job.status).toBe("queued");
    expect(job.coverage.posts.requested).toBe(true);
    expect(job.coverage.comments.requested).toBe(true);
    expect(job.coverage.members.requested).toBe(false);
  });

  it("validates transitions", () => {
    expect(canTransition("queued", "running")).toBe(true);
    expect(canTransition("running", "paused")).toBe(true);
    expect(canTransition("paused", "running")).toBe(true);
    expect(canTransition("partial", "running")).toBe(true);
    expect(canTransition("completed", "running")).toBe(false);
    expect(canTransition("cancelled", "running")).toBe(false);
  });

  it("throws on an invalid transition", () => {
    const job = createJob(filters, false);
    expect(() => transition({ ...job, status: "completed" }, "running")).toThrow();
  });

  it("acquires a lease and fences generations", () => {
    const job = createJob(filters, false);
    const leased = acquireLease(job, "tok1", 1000);
    expect(leased.status).toBe("running");
    expect(leased.runnerToken).toBe("tok1");
    expect(leased.runnerGeneration).toBe(1);
    const again = acquireLease(leased, "tok2", 2000);
    expect(again.runnerGeneration).toBe(2);
    expect(releaseLease(again).runnerToken).toBeNull();
  });

  it("derives terminal status from deferred/skipped", () => {
    const job = createJob(filters, false);
    expect(terminalStatus(job)).toBe("completed");
    expect(terminalStatus({ ...job, counters: { ...job.counters, deferred: 1 } })).toBe("partial");
    expect(terminalStatus({ ...job, counters: { ...job.counters, skipped: 1 } })).toBe("partial");
  });

  it("builds stable work ids", () => {
    expect(workIdFor("comments", "post:p1", null)).toBe("comments|post:p1|root");
    expect(workIdFor("comments", "post:p1", "c5")).toBe("comments|post:p1|c5");
  });

  it("initial coverage reflects member flag", () => {
    const coverage = initialCoverage({ ...filters, includeMembers: true });
    expect(coverage.members.requested).toBe(true);
  });
});

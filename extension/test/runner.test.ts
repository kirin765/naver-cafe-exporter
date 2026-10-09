import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/lib/memory-store";
import { requeueBlocked, runJob, type CafeSource, type RunnerDeps } from "../src/lib/runner";
import { createJob } from "../src/lib/jobs";
import type { DatasetTaskResult } from "../src/lib/types";
import type { RawComment, RawMember, RawPost } from "../src/lib/normalize";
import type { AccessCode, AccessState, JobFilters } from "../../shared/schema";

const noSleep = async (): Promise<void> => {};
const zero = (): number => 0;

function state(code: AccessCode): AccessState {
  return { scope: "s", code, requiredGrade: null, httpStatus: null, message: code };
}
const pub = (): AccessState => state("public");

class FakeSource implements CafeSource {
  posts: RawPost[][];
  comments: Record<string, RawComment[][]>;
  members: RawMember[][];
  postAccess: AccessState = pub();
  commentAccess: Record<string, AccessState> = {};
  memberAccess: AccessState = pub();
  detailAccess: AccessState = pub();
  detailFails = new Set<string>();

  constructor(opts: {
    posts: RawPost[][];
    comments?: Record<string, RawComment[][]>;
    members?: RawMember[][];
  }) {
    this.posts = opts.posts;
    this.comments = opts.comments ?? {};
    this.members = opts.members ?? [];
  }

  private slice<T>(pages: T[][], cursor: string | null): { items: T[]; next: string | null; total: number } {
    const idx = cursor ? Number(cursor) : 0;
    const items = pages[idx] ?? [];
    const next = idx + 1 < pages.length ? String(idx + 1) : null;
    const total = pages.reduce((acc, p) => acc + p.length, 0);
    return { items, next, total };
  }

  async checkAccess(): Promise<AccessState> {
    return this.memberAccess;
  }
  async listPosts(cursor: string | null): Promise<DatasetTaskResult> {
    const { items, next, total } = this.slice(this.posts, cursor);
    return { dataset: "posts", scope: "board", items: items as unknown as Record<string, unknown>[], nextCursor: next, total, access: this.postAccess };
  }
  async getPostDetail(postId: string): Promise<{ item: Record<string, unknown>; access: AccessState }> {
    if (this.detailFails.has(postId)) return { item: {}, access: this.postAccess };
    return { item: { postId, bodyText: `본문 ${postId}`, viewCount: 5 }, access: this.detailAccess };
  }
  async listComments(postId: string, cursor: string | null): Promise<DatasetTaskResult> {
    const pages = this.comments[postId] ?? [];
    const { items, next, total } = this.slice(pages, cursor);
    return {
      dataset: "comments",
      scope: `post:${postId}`,
      items: items as unknown as Record<string, unknown>[],
      nextCursor: next,
      total,
      access: this.commentAccess[postId] ?? pub()
    };
  }
  async listMembers(cursor: string | null): Promise<DatasetTaskResult> {
    const { items, next, total } = this.slice(this.members, cursor);
    return { dataset: "members", scope: "directory", items: items as unknown as Record<string, unknown>[], nextCursor: next, total, access: this.memberAccess };
  }
}

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

function deps(store: MemoryStore, source: FakeSource, overrides: Partial<RunnerDeps> = {}): RunnerDeps {
  return { store, source, sleep: noSleep, delayMs: zero, now: () => Date.now(), onEvent: () => {}, ...overrides };
}

function sample() {
  const posts: RawPost[][] = [
    [
      { postId: "p1", title: "1", nickname: "A", memberKey: "m1", createdAt: "2026-10-01" },
      { postId: "p2", title: "2", nickname: "B", createdAt: "2026-10-02" }
    ],
    [{ postId: "p3", title: "3", nickname: "A", memberKey: "m1", createdAt: "2026-10-03" }]
  ];
  const comments: Record<string, RawComment[][]> = {
    p1: [[{ commentId: "c1", postId: "p1", nickname: "C", bodyText: "댓글1" }], [{ commentId: "c2", postId: "p1", parentCommentId: "c1", nickname: "C", bodyText: "답글" }]],
    p2: [],
    p3: []
  };
  return { posts, comments };
}

describe("runJob", () => {
  it("collects posts, bodies, comments and authors to completion", async () => {
    const store = new MemoryStore();
    const source = new FakeSource(sample());
    const job = createJob(filters, false);
    await store.createJob(job);

    const done = await runJob(job.jobId, deps(store, source));
    expect(done.status).toBe("completed");
    const posts = await store.getRecords(job.jobId, "posts");
    const comments = await store.getRecords(job.jobId, "comments");
    const authors = await store.getRecords(job.jobId, "authors");
    expect(posts).toHaveLength(3);
    expect(posts.find((p) => p.postId === "p1")?.bodyText).toBe("본문 p1");
    expect(comments).toHaveLength(2);
    expect(comments.find((c) => c.commentId === "c2")?.parentCommentId).toBe("c1");
    // A appears in both posts, so one aggregated author row.
    expect(authors.find((a) => a.nickname === "A")?.observedPostCount).toBe(2);
  });

  it("respects the maxPosts cap and date filter", async () => {
    const store = new MemoryStore();
    const source = new FakeSource(sample());
    const job = createJob({ ...filters, maxPosts: 1 }, false);
    await store.createJob(job);
    const done = await runJob(job.jobId, deps(store, source));
    expect(done.status).toBe("completed");
    expect(await store.countRecords(job.jobId, "posts")).toBe(1);

    const store2 = new MemoryStore();
    const source2 = new FakeSource(sample());
    const job2 = createJob(
      { ...filters, dateFrom: "2026-10-02T00:00:00+09:00", dateTo: "2026-10-03T00:00:00+09:00" },
      false
    );
    await store2.createJob(job2);
    await runJob(job2.jobId, deps(store2, source2));
    const posts = await store2.getRecords(job2.jobId, "posts");
    expect(posts.map((p) => p.postId).sort()).toEqual(["p2"]);
  });

  it("defers a blocked comment scope and reports partial", async () => {
    const store = new MemoryStore();
    const source = new FakeSource(sample());
    source.commentAccess.p1 = state("login_required");
    const job = createJob(filters, false);
    await store.createJob(job);
    const done = await runJob(job.jobId, deps(store, source));
    expect(done.status).toBe("partial");
    expect(done.counters.deferred).toBeGreaterThanOrEqual(1);
    expect(await store.countRecords(job.jobId, "posts")).toBe(3);
    // p2/p3 comments were empty and processed fine.
    expect(done.coverage.comments.available).toBe(false);
  });

  it("recovers deferred work after requeue and completes without duplicates", async () => {
    const store = new MemoryStore();
    const source = new FakeSource(sample());
    source.commentAccess.p1 = state("login_required");
    const job = createJob(filters, false);
    await store.createJob(job);
    const first = await runJob(job.jobId, deps(store, source));
    expect(first.status).toBe("partial");
    const postsBefore = await store.countRecords(job.jobId, "posts");

    source.commentAccess.p1 = pub();
    await requeueBlocked(store, job.jobId);
    const second = await runJob(job.jobId, deps(store, source));
    expect(second.status).toBe("completed");
    expect(second.counters.deferred).toBe(0);
    expect(await store.countRecords(job.jobId, "posts")).toBe(postsBefore);
    expect(await store.countRecords(job.jobId, "comments")).toBe(2);
  });

  it("pauses when the whole board is blocked", async () => {
    const store = new MemoryStore();
    const source = new FakeSource(sample());
    source.postAccess = state("membership_required");
    const job = createJob(filters, false);
    await store.createJob(job);
    const done = await runJob(job.jobId, deps(store, source));
    expect(done.status).toBe("paused");
    expect(done.coverage.posts.available).toBe(false);
    expect(await store.countRecords(job.jobId, "posts")).toBe(0);
  });

  it("applies preview caps", async () => {
    const store = new MemoryStore();
    const many: RawPost[][] = [Array.from({ length: 25 }, (_, i) => ({ postId: `p${i}`, nickname: "n", createdAt: "2026-10-01" }))];
    const source = new FakeSource({ posts: many });
    const job = createJob({ ...filters, includeBody: false, includeComments: false }, true);
    await store.createJob(job);
    const done = await runJob(job.jobId, deps(store, source));
    expect(done.status).toBe("completed");
    expect(await store.countRecords(job.jobId, "posts")).toBe(20);
  });

  it("collects members when requested", async () => {
    const store = new MemoryStore();
    const source = new FakeSource({
      posts: [[{ postId: "p1", nickname: "A", createdAt: "2026-10-01" }]],
      members: [[{ memberKey: "m1", nickname: "회원", grade: "정회원" }]]
    });
    const job = createJob({ ...filters, includeBody: false, includeComments: false, includeMembers: true }, false);
    await store.createJob(job);
    const done = await runJob(job.jobId, deps(store, source));
    expect(done.status).toBe("completed");
    expect(await store.countRecords(job.jobId, "members")).toBe(1);
  });
});

describe("lease + isolation", () => {
  it("rejects a stale runner token", async () => {
    const store = new MemoryStore();
    const job = createJob(filters, false);
    await store.createJob(job);
    const stale = await store.commitBatch({ job, runnerToken: "wrong", records: [], work: [] });
    expect(stale).toEqual({ ok: false, reason: "stale_runner" });
    await store.saveJob({ ...job, runnerToken: "tok" });
    const ok = await store.commitBatch({ job: { ...job, runnerToken: "tok" }, runnerToken: "tok", records: [], work: [] });
    expect(ok).toEqual({ ok: true });
  });

  it("keeps jobs isolated and deleting one preserves the other", async () => {
    const store = new MemoryStore();
    const source = new FakeSource(sample());
    const a = createJob(filters, false);
    const b = createJob({ ...filters, includeComments: false, includeBody: false }, false);
    await store.createJob(a);
    await store.createJob(b);
    await runJob(a.jobId, deps(store, source));
    await runJob(b.jobId, deps(store, source));
    const aPosts = await store.countRecords(a.jobId, "posts");
    const bPosts = await store.countRecords(b.jobId, "posts");
    expect(aPosts).toBe(3);
    expect(bPosts).toBe(3);
    await store.deleteJob(a.jobId);
    expect(await store.countRecords(a.jobId, "posts")).toBe(0);
    expect(await store.countRecords(b.jobId, "posts")).toBe(3);
    expect((await store.getJob(b.jobId))?.status).toBe("completed");
  });
});

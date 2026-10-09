import type {
  AccessState,
  Coverage,
  CoverageEntry,
  Dataset,
  Job,
  JobPhase,
  PostRecord,
  WorkItem
} from "../../../shared/schema";
import { LIMITS } from "../../../shared/schema";
import { CollectError, type DatasetTaskResult } from "./types";
import { acquireLease, newRunnerToken, releaseLease, transition, workIdFor } from "./jobs";
import {
  aggregateAuthors,
  normalizeComment,
  normalizeMember,
  normalizePost,
  type RawComment,
  type RawMember,
  type RawPost
} from "./normalize";
import type { JobStore } from "./store";

export interface CafeSource {
  checkAccess(dataset: Dataset, scope: string): Promise<AccessState>;
  listPosts(cursor: string | null, maxItems: number): Promise<DatasetTaskResult>;
  getPostDetail(postId: string): Promise<{ item: Record<string, unknown>; access: AccessState }>;
  listComments(postId: string, cursor: string | null, maxItems: number): Promise<DatasetTaskResult>;
  listMembers(cursor: string | null, maxItems: number): Promise<DatasetTaskResult>;
}

export type RunnerEvent =
  | { type: "phase"; phase: JobPhase }
  | { type: "progress"; dataset: Dataset; collected: number; total: number | null }
  | { type: "status"; status: Job["status"] };

export type RunnerDeps = {
  store: JobStore;
  source: CafeSource;
  sleep: (ms: number) => Promise<void>;
  delayMs: () => number;
  now: () => number;
  pageLimit?: number;
  onEvent?: (event: RunnerEvent) => void;
  shouldCancel?: () => boolean;
  /** Request a resumable pause; the job keeps its cursors and committed data. */
  shouldPause?: () => boolean;
};

const PREVIEW_CAPS = {
  posts: LIMITS.previewPosts,
  comments: LIMITS.previewComments,
  members: LIMITS.previewDirectory
} as const;

const HARD_CAPS = {
  posts: LIMITS.maxPosts,
  comments: LIMITS.maxComments,
  members: LIMITS.maxMembers
} as const;

export function effectiveCaps(job: Job): { posts: number; comments: number; members: number } {
  const branch = job.preview ? PREVIEW_CAPS : HARD_CAPS;
  return {
    posts: Math.min(job.filters.maxPosts, branch.posts),
    comments: branch.comments,
    members: branch.members
  };
}

function coverageWith(job: Job, dataset: Dataset, patch: Partial<CoverageEntry>): Coverage {
  return { ...job.coverage, [dataset]: { ...job.coverage[dataset], ...patch } };
}

function withPhase(job: Job, phase: JobPhase, now: number): Job {
  return { ...job, phase, updatedAt: now };
}

function ctx(job: Job): { cafeId: string; boardId: string; boardName: string } {
  return { cafeId: job.filters.cafeId, boardId: job.filters.boardId, boardName: job.filters.boardName };
}

/** Choose the resume phase from pending work; blocked work is not retried automatically. */
export function resumePhase(job: Job, work: WorkItem[]): JobPhase {
  const pending = work.filter((w) => w.status === "pending" || w.status === "in_progress");
  if (pending.some((w) => w.dataset === "posts")) return "post_detail";
  if (pending.some((w) => w.dataset === "comments")) return "comments";
  if (pending.some((w) => w.dataset === "members")) return "authors";
  if (job.counters.committed.posts === 0 && !job.coverage.posts.available) return "posts";
  return "finalize";
}

/**
 * Reset access-blocked work to pending so the next run retries it. Intended for
 * the explicit "접근 권한 다시 확인 후 재수집" action, not automatic polling.
 */
export async function requeueBlocked(store: JobStore, jobId: string, now = Date.now()): Promise<Job | null> {
  const job = await store.getJob(jobId);
  if (!job) return null;
  const work = await store.getWorkItems(jobId);
  const blocked = work.filter((w) => w.status === "blocked_access");
  for (const item of blocked) {
    item.status = "pending";
    item.denialReason = null;
    item.lastAttemptAt = now;
  }
  if (blocked.length > 0) await store.saveWork(blocked);
  const coverage: Coverage = {
    ...job.coverage,
    posts: { ...job.coverage.posts, available: true },
    comments: { ...job.coverage.comments, available: job.filters.includeComments },
    members: { ...job.coverage.members, available: job.filters.includeMembers }
  };
  const next: Job = {
    ...job,
    coverage,
    phase: resumePhase({ ...job, coverage }, work),
    status: job.status === "completed" ? "partial" : job.status,
    updatedAt: now
  };
  await store.saveJob(next);
  return next;
}

/**
 * Run (or resume) a job to completion, one page at a time. Every page is
 * committed atomically with its cursor and lease token; a stale token aborts
 * the commit and the run.
 */
export async function runJob(jobId: string, deps: RunnerDeps): Promise<Job> {
  const { store, now } = deps;
  let job = await store.getJob(jobId);
  if (!job) throw new CollectError("UNKNOWN", "작업을 찾을 수 없습니다.");
  if (job.status === "completed" || job.status === "cancelled") return job;

  job = acquireLease(job, newRunnerToken(), now());
  if (job.phase === "finalize" || job.phase === "idle") {
    const work = await store.getWorkItems(jobId);
    const phase = resumePhase(job, work);
    if (phase !== "finalize") job = withPhase(job, phase, now());
  }
  await store.saveJob(job);
  const token = job.runnerToken as string;
  deps.onEvent?.({ type: "status", status: job.status });

  try {
    let guard = 0;
    while (job.status === "running" && guard++ < 5000) {
      if (deps.shouldCancel?.()) {
        job = transition(job, "cancelled", now());
        break;
      }
      if (deps.shouldPause?.()) {
        job = transition(job, "paused", now());
        break;
      }
      deps.onEvent?.({ type: "phase", phase: job.phase });
      switch (job.phase) {
        case "detect":
        case "idle":
          job = await saveAtomic(deps, token, withPhase(job, "posts", now()));
          break;
        case "posts":
          job = await collectPosts(job, deps, token);
          break;
        case "post_detail":
          job = await collectDetails(job, deps, token);
          break;
        case "comments":
          job = await collectComments(job, deps, token);
          break;
        case "authors":
          job = await collectAuthorsAndMembers(job, deps, token);
          break;
        case "finalize":
          job = await finalize(job, deps, now());
          break;
        default:
          job = withPhase(job, "finalize", now());
      }
    }
  } catch (err) {
    job = handleRunError(job, err, now());
  }

  job = releaseLease(job, now());
  await store.saveJob(job);
  deps.onEvent?.({ type: "status", status: job.status });
  return job;
}

async function saveAtomic(deps: RunnerDeps, token: string, job: Job): Promise<Job> {
  const result = await deps.store.commitBatch({ job, runnerToken: token, records: [], work: [] });
  if (!result.ok) throw new CollectError("UNKNOWN", `작업 상태 저장 실패: ${result.reason}`);
  return job;
}

// ---------------------------------------------------------------------------
// Phase: post list
// ---------------------------------------------------------------------------

async function collectPosts(job: Job, deps: RunnerDeps, token: string): Promise<Job> {
  const { source, store, now } = deps;
  const caps = effectiveCaps(job);
  let cursor = job.cursors.posts ?? null;

  while (job.counters.committed.posts < caps.posts) {
    if (deps.shouldCancel?.()) break;
    const remaining = caps.posts - job.counters.committed.posts;
    const result = await source.listPosts(cursor, Math.min(deps.pageLimit ?? 30, remaining));
    if (!result.access || result.access.code !== "public") {
      return handleBoardBlocked(job, result.access, now());
    }

    const normalized = (result.items as unknown as RawPost[]).map((raw) => normalizePost(raw, ctx(job)));
    const accepted = normalized.filter((p) => withinDateRange(job, p.createdAt));
    const existing = await store.getRecords(job.jobId, "posts");
    const selected = dedupeById([...existing, ...accepted], (p) => p.postId).slice(0, caps.posts);

    const work: WorkItem[] = [];
    for (const post of selected) {
      if (job.filters.includeBody) work.push(makeWork(job, "posts", `detail:${post.postId}`, now()));
      if (job.filters.includeComments) work.push(makeWork(job, "comments", `post:${post.postId}`, now()));
    }

    const next: Job = {
      ...job,
      cursors: { ...job.cursors, posts: result.nextCursor },
      coverage: coverageWith(job, "posts", {
        collected: selected.length,
        available: true,
        note: accepted.length < normalized.length ? "일부 게시글은 날짜 조건으로 제외되었습니다." : ""
      }),
      counters: { ...job.counters, committed: { ...job.counters.committed, posts: selected.length } },
      updatedAt: now()
    };

    const committed = await store.commitBatch({
      job: next,
      runnerToken: token,
      records: [{ dataset: "posts", items: selected }],
      work
    });
    if (!committed.ok) throw new CollectError("UNKNOWN", `배치 저장 실패: ${committed.reason}`);

    job = next;
    deps.onEvent?.({ type: "progress", dataset: "posts", collected: selected.length, total: result.total });

    if (!result.nextCursor || selected.length >= caps.posts) break;
    await deps.sleep(deps.delayMs());
    cursor = result.nextCursor;
  }

  job = withPhase(
    job,
    job.filters.includeBody ? "post_detail" : job.filters.includeComments ? "comments" : "authors",
    now()
  );
  await store.saveJob(job);
  return job;
}

// ---------------------------------------------------------------------------
// Phase: post detail (body)
// ---------------------------------------------------------------------------

async function collectDetails(job: Job, deps: RunnerDeps, token: string): Promise<Job> {
  const { source, store, now } = deps;
  const pending = (await store.getWorkItems(job.jobId)).filter(
    (w) => w.dataset === "posts" && w.status === "pending"
  );

  for (const item of pending) {
    if (deps.shouldCancel?.()) break;
    const postId = item.scope.replace(/^detail:/, "");
    const posts = await store.getRecords(job.jobId, "posts");
    const existing = posts.find((p) => p.postId === postId);
    try {
      const { item: detail, access } = await source.getPostDetail(postId);
      if (access.code !== "public") {
        item.status = "blocked_access";
        item.denialReason = access.message;
      } else if (existing) {
        const merged = normalizePost({ ...(existing as unknown as RawPost), ...(detail as RawPost), postId }, ctx(job));
        const next: PostRecord = {
          ...existing,
          title: merged.title || existing.title,
          bodyText: merged.bodyText || existing.bodyText,
          createdAt: existing.createdAt ?? merged.createdAt,
          updatedAt: merged.updatedAt ?? existing.updatedAt,
          viewCount: merged.viewCount ?? existing.viewCount,
          commentCount: merged.commentCount ?? existing.commentCount
        };
        item.status = "done";
        const committed = await store.commitBatch({
          job,
          runnerToken: token,
          records: [{ dataset: "posts", items: [next] }],
          work: [item]
        });
        if (!committed.ok) throw new CollectError("UNKNOWN", `배치 저장 실패: ${committed.reason}`);
      } else {
        item.status = "skipped";
        item.denialReason = "게시글을 찾을 수 없습니다.";
      }
    } catch (err) {
      if (err instanceof CollectError && err.code === "NETWORK") {
        item.status = "pending";
        item.denialReason = err.message;
      } else {
        item.status = "skipped";
        item.denialReason = err instanceof Error ? err.message : "알 수 없는 오류";
      }
    }
    item.attempts += 1;
    item.lastAttemptAt = now();
    await store.saveWork([item]);
    await deps.sleep(deps.delayMs());
  }

  job = withPhase(job, job.filters.includeComments ? "comments" : "authors", now());
  await store.saveJob(job);
  return job;
}

// ---------------------------------------------------------------------------
// Phase: comments
// ---------------------------------------------------------------------------

async function collectComments(job: Job, deps: RunnerDeps, token: string): Promise<Job> {
  const { source, store, now } = deps;
  if (!job.filters.includeComments) {
    job = withPhase(job, "authors", now());
    await store.saveJob(job);
    return job;
  }
  const caps = effectiveCaps(job);
  const pending = (await store.getWorkItems(job.jobId)).filter(
    (w) => w.dataset === "comments" && w.status === "pending"
  );

  for (const item of pending) {
    if (deps.shouldCancel?.()) break;
    if (job.counters.committed.comments >= caps.comments) {
      job = coverageLimitNote(job, "comments");
      await store.saveJob(job);
      break;
    }
    const postId = item.scope.replace(/^post:/, "");
    let cursor = item.cursor;
    while (job.counters.committed.comments < caps.comments) {
      const remaining = caps.comments - job.counters.committed.comments;
      const result = await source.listComments(postId, cursor, Math.min(deps.pageLimit ?? 50, remaining));
      if (result.access.code !== "public") {
        item.status = "blocked_access";
        item.denialReason = result.access.message;
        item.attempts += 1;
        item.lastAttemptAt = now();
        await store.saveWork([item]);
        break;
      }
      const comments = (result.items as unknown as RawComment[]).map((raw) =>
        normalizeComment({ ...raw, postId } as RawComment, ctx(job))
      );
      const existing = await store.getRecords(job.jobId, "comments");
      const merged = dedupeById([...existing, ...comments], (c) => c.commentId).slice(0, caps.comments);

      item.cursor = result.nextCursor;
      item.attempts += 1;
      item.lastAttemptAt = now();
      item.status = result.nextCursor ? "in_progress" : "done";
      const next: Job = {
        ...job,
        coverage: coverageWith(job, "comments", { collected: merged.length, available: true }),
        counters: { ...job.counters, committed: { ...job.counters.committed, comments: merged.length } },
        updatedAt: now()
      };
      const committed = await store.commitBatch({
        job: next,
        runnerToken: token,
        records: [{ dataset: "comments", items: merged }],
        work: [item]
      });
      if (!committed.ok) throw new CollectError("UNKNOWN", `배치 저장 실패: ${committed.reason}`);
      job = next;
      deps.onEvent?.({ type: "progress", dataset: "comments", collected: merged.length, total: result.total });

      if (!result.nextCursor || comments.length === 0) break;
      cursor = result.nextCursor;
      await deps.sleep(deps.delayMs());
    }
    if (item.status === "in_progress") item.status = "done";
    await store.saveWork([item]);
    await deps.sleep(deps.delayMs());
  }

  job = withPhase(job, "authors", now());
  await store.saveJob(job);
  return job;
}

// ---------------------------------------------------------------------------
// Phase: authors + members
// ---------------------------------------------------------------------------

async function collectAuthorsAndMembers(job: Job, deps: RunnerDeps, token: string): Promise<Job> {
  const { store, now } = deps;
  const posts = await store.getRecords(job.jobId, "posts");
  const comments = await store.getRecords(job.jobId, "comments");
  const authors = aggregateAuthors(posts, comments);

  job = { ...job, coverage: coverageWith(job, "authors", { collected: authors.length, available: true }), updatedAt: now() };
  const committed = await store.commitBatch({
    job,
    runnerToken: token,
    records: [{ dataset: "authors", items: authors }],
    work: []
  });
  if (!committed.ok) throw new CollectError("UNKNOWN", `배치 저장 실패: ${committed.reason}`);

  if (job.filters.includeMembers) job = await collectMembers(job, deps, token);

  job = withPhase(job, "finalize", now());
  await store.saveJob(job);
  return job;
}

async function collectMembers(job: Job, deps: RunnerDeps, token: string): Promise<Job> {
  const { source, store, now } = deps;
  const caps = effectiveCaps(job);
  const workItem = makeWork(job, "members", "directory", now());

  const access = await source.checkAccess("members", "directory");
  if (access.code !== "public") {
    workItem.status = "blocked_access";
    workItem.denialReason = access.message;
    workItem.attempts = 1;
    await store.saveWork([workItem]);
    await store.saveJob(job);
    return job;
  }

  let cursor = job.cursors.members ?? null;
  while (job.counters.committed.members < caps.members) {
    if (deps.shouldCancel?.()) break;
    const result = await source.listMembers(cursor, Math.min(deps.pageLimit ?? 50, caps.members - job.counters.committed.members));
    if (result.access.code !== "public") {
      workItem.status = "blocked_access";
      workItem.denialReason = result.access.message;
      await store.saveWork([workItem]);
      break;
    }
    const normalized = (result.items as unknown as RawMember[]).map((raw) => normalizeMember(raw, { cafeId: job.filters.cafeId }));
    const existing = await store.getRecords(job.jobId, "members");
    const members = dedupeById([...existing, ...normalized], (m) => m.memberKey).slice(0, caps.members);
    const next: Job = {
      ...job,
      cursors: { ...job.cursors, members: result.nextCursor },
      coverage: coverageWith(job, "members", { collected: members.length, available: true }),
      counters: { ...job.counters, committed: { ...job.counters.committed, members: members.length } },
      updatedAt: now()
    };
    const committed = await store.commitBatch({
      job: next,
      runnerToken: token,
      records: [{ dataset: "members", items: members }],
      work: [workItem]
    });
    if (!committed.ok) throw new CollectError("UNKNOWN", `배치 저장 실패: ${committed.reason}`);
    job = next;
    deps.onEvent?.({ type: "progress", dataset: "members", collected: members.length, total: result.total });
    if (!result.nextCursor || normalized.length === 0) break;
    await deps.sleep(deps.delayMs());
    cursor = result.nextCursor;
  }

  if (workItem.status !== "blocked_access") {
    workItem.status = "done";
    await store.saveWork([workItem]);
  }
  if (job.counters.committed.members >= caps.members) job = coverageLimitNote(job, "members");
  return job;
}

// ---------------------------------------------------------------------------
// Finalize, errors, helpers
// ---------------------------------------------------------------------------

async function finalize(job: Job, deps: RunnerDeps, now: number): Promise<Job> {
  const work = await deps.store.getWorkItems(job.jobId);
  const coverage: Coverage = {
    ...job.coverage,
    posts: { ...job.coverage.posts },
    comments: { ...job.coverage.comments },
    members: { ...job.coverage.members }
  };

  for (const dataset of ["posts", "comments", "members"] as const) {
    const items = work.filter((w) => w.dataset === dataset);
    if (items.length === 0 && dataset !== "posts") continue;
    coverage[dataset].deferred = items.filter((w) => w.status === "blocked_access").length;
    coverage[dataset].skipped = items.filter((w) => w.status === "skipped").length;
    coverage[dataset].available = !items.some((w) => w.status === "blocked_access");
  }
  // Board-level block: no post data and the list itself was denied.
  if (!coverage.posts.available && job.counters.committed.posts === 0) {
    coverage.posts.deferred = Math.max(coverage.posts.deferred, 1);
  }
  if (!job.filters.includeComments) {
    coverage.comments.deferred = 0;
    coverage.comments.skipped = 0;
  }
  if (!job.filters.includeMembers) {
    coverage.members.deferred = 0;
    coverage.members.skipped = 0;
  }

  const deferred = coverage.posts.deferred + coverage.comments.deferred + coverage.members.deferred;
  const skipped = coverage.posts.skipped + coverage.comments.skipped + coverage.members.skipped;
  const counters = { ...job.counters, deferred, skipped };

  return {
    ...job,
    coverage,
    counters,
    status: deferred > 0 || skipped > 0 ? "partial" : "completed",
    phase: "finalize",
    observationEndedAt: now,
    updatedAt: now
  };
}

function coverageLimitNote(job: Job, dataset: Dataset): Job {
  const prev = job.coverage[dataset].note;
  return {
    ...job,
    coverage: coverageWith(job, dataset, {
      note: [prev, "설정한 수집 한도에 도달하여 일부만 포함했습니다."].filter(Boolean).join(" ")
    })
  };
}

function handleBoardBlocked(job: Job, access: AccessState, now: number): Job {
  const covered = job.counters.committed.posts > 0;
  const next: Job = {
    ...job,
    coverage: coverageWith(job, "posts", { available: false, note: access?.message ?? "접근 권한이 없습니다." }),
    lastError: access?.message ?? "접근 권한이 없습니다.",
    updatedAt: now
  };
  return covered ? { ...next, status: "partial", observationEndedAt: now } : { ...next, status: "paused" };
}

function handleRunError(job: Job, err: unknown, now: number): Job {
  const message = err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.";
  if (err instanceof CollectError && err.code === "ACCESS") {
    return { ...job, status: "paused", lastError: message, updatedAt: now };
  }
  const hasData = job.counters.committed.posts > 0 || job.counters.committed.comments > 0;
  return {
    ...job,
    status: hasData ? "partial" : "failed",
    lastError: message,
    observationEndedAt: now,
    updatedAt: now
  };
}

function withinDateRange(job: Job, createdAt: string | null): boolean {
  if (!createdAt) return true;
  const ts = Date.parse(createdAt);
  if (!Number.isFinite(ts)) return true;
  if (job.filters.dateFrom && ts < Date.parse(job.filters.dateFrom)) return false;
  if (job.filters.dateTo && ts >= Date.parse(job.filters.dateTo)) return false;
  return true;
}

function dedupeById<T>(items: T[], key: (item: T) => string): T[] {
  const map = new Map<string, T>();
  for (const item of items) map.set(key(item), item);
  return [...map.values()];
}

function makeWork(job: Job, dataset: Dataset, scope: string, now: number): WorkItem {
  return {
    workId: workIdFor(dataset, scope, null),
    jobId: job.jobId,
    dataset,
    scope,
    status: "pending",
    sourceUrl: `cafe:${job.filters.cafeId}/${job.filters.boardId}`,
    cursor: null,
    denialReason: null,
    attempts: 0,
    lastAttemptAt: now
  };
}

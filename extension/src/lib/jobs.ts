import type {
  Coverage,
  Dataset,
  Job,
  JobFilters,
  JobPhase,
  JobStatus,
  WorkItem,
  WorkStatus
} from "../../../shared/schema";
import { DATASETS, SCHEMA_VERSION } from "../../../shared/schema";
import { EXTENSION_VERSION } from "./config";

export function newJobId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `job_${Date.now().toString(36)}_${rand}`;
}

export function newRunnerToken(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function initialCoverage(filters: JobFilters): Coverage {
  const make = (requested: boolean) => ({
    requested,
    available: requested,
    collected: 0,
    deferred: 0,
    skipped: 0,
    note: ""
  });
  return {
    posts: make(true),
    comments: make(filters.includeComments),
    members: make(filters.includeMembers),
    authors: make(true)
  };
}

export function createJob(filters: JobFilters, preview: boolean, now = Date.now()): Job {
  return {
    jobId: newJobId(),
    revision: 0,
    schemaVersion: SCHEMA_VERSION,
    appVersion: EXTENSION_VERSION,
    status: "queued",
    phase: "detect",
    preview,
    filters,
    cursors: {},
    counters: {
      committed: { posts: 0, comments: 0, members: 0 },
      deferred: 0,
      skipped: 0
    },
    coverage: initialCoverage(filters),
    runnerToken: null,
    runnerGeneration: 0,
    createdAt: now,
    updatedAt: now,
    observationStartedAt: now,
    observationEndedAt: null,
    lastError: null,
    entitlementExpiresAt: null
  };
}

const TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  queued: ["running", "cancelled", "failed"],
  running: ["paused", "completed", "partial", "failed", "cancelled"],
  paused: ["running", "cancelled", "failed"],
  partial: ["running", "cancelled", "failed", "completed"],
  completed: [],
  cancelled: [],
  failed: []
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  if (from === to) return true;
  return TRANSITIONS[from].includes(to);
}

export function transition(job: Job, to: JobStatus, now = Date.now()): Job {
  if (!canTransition(job.status, to)) {
    throw new Error(`invalid job transition ${job.status} -> ${to}`);
  }
  return { ...job, status: to, updatedAt: now };
}

/** Acquire/replace the runner lease. A new generation fences stale runners. */
export function acquireLease(job: Job, token = newRunnerToken(), now = Date.now()): Job {
  return {
    ...job,
    runnerToken: token,
    runnerGeneration: job.runnerGeneration + 1,
    status: job.status === "queued" ? "running" : transition(job, "running", now).status,
    phase: job.phase === "idle" ? "posts" : job.phase,
    updatedAt: now
  };
}

export function releaseLease(job: Job, now = Date.now()): Job {
  return { ...job, runnerToken: null, updatedAt: now };
}

/** Decide the terminal status once work is exhausted. */
export function terminalStatus(job: Job): JobStatus {
  if (job.counters.deferred > 0 || job.counters.skipped > 0) return "partial";
  return "completed";
}

export function workIdFor(dataset: Dataset, scope: string, cursor: string | null): string {
  return `${dataset}|${scope}|${cursor ?? "root"}`;
}

export function makeWorkItem(
  jobId: string,
  dataset: Dataset,
  scope: string,
  status: WorkStatus,
  sourceUrl: string,
  now = Date.now()
): WorkItem {
  return {
    workId: workIdFor(dataset, scope, null),
    jobId,
    dataset,
    scope,
    status,
    sourceUrl,
    cursor: null,
    denialReason: null,
    attempts: 0,
    lastAttemptAt: now
  };
}

export function nextPhase(phase: JobPhase, job: Job): JobPhase {
  const order: JobPhase[] = ["detect", "posts", "post_detail", "comments", "authors", "finalize"];
  const includeComments = job.filters.includeComments;
  const sequence = order.filter((p) => (p === "comments" ? includeComments : true));
  const idx = sequence.indexOf(phase);
  return sequence[Math.min(idx + 1, sequence.length - 1)] ?? "finalize";
}

/** Apply preview caps for a preview job. */
export function previewCaps(limits: { posts: number; comments: number; members: number }): {
  posts: number;
  comments: number;
  members: number;
} {
  return limits;
}

export function datasetRequested(job: Job, dataset: Dataset): boolean {
  switch (dataset) {
    case "posts":
      return true;
    case "comments":
      return job.filters.includeComments;
    case "members":
      return job.filters.includeMembers;
    case "authors":
      return true;
  }
}

export function allDatasets(): Dataset[] {
  return [...DATASETS];
}

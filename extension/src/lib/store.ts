import type { Dataset, Job, RecordByDataset, WorkItem } from "../../../shared/schema";

export type AnyRecord = RecordByDataset[Dataset];

/** Records grouped by dataset for a single atomic commit. */
export type BatchRecords = {
  dataset: Dataset;
  items: AnyRecord[];
};

export type BatchCommit = {
  /** Full next job snapshot; its runnerToken must match the persisted lease. */
  job: Job;
  /** Token the runner believes it holds; a mismatch aborts the whole commit. */
  runnerToken: string;
  records: BatchRecords[];
  work: WorkItem[];
};

export type CommitResult = { ok: true } | { ok: false; reason: "stale_runner" | "missing_job" };

/**
 * Persistence boundary used by the runner and UI. The IndexedDB implementation
 * is authoritative; the in-memory implementation exists for tests.
 */
export interface JobStore {
  createJob(job: Job): Promise<void>;
  getJob(jobId: string): Promise<Job | null>;
  listJobs(): Promise<Job[]>;
  /** Replace a job snapshot without a lease check (used for status changes). */
  saveJob(job: Job): Promise<void>;
  /** Atomic record + work + job commit guarded by the runner lease token. */
  commitBatch(batch: BatchCommit): Promise<CommitResult>;
  deleteJob(jobId: string): Promise<void>;
  getRecords<T extends Dataset>(jobId: string, dataset: T): Promise<RecordByDataset[T][]>;
  countRecords(jobId: string, dataset: Dataset): Promise<number>;
  getWorkItems(jobId: string): Promise<WorkItem[]>;
  /** Persist work-item status changes outside a runner batch (e.g. requeue). */
  saveWork(items: WorkItem[]): Promise<void>;
  getMeta<T>(key: string): Promise<T | null>;
  setMeta(key: string, value: unknown): Promise<void>;
  /** Estimated bytes used by the extension origin, or null when unknown. */
  usageEstimate(): Promise<number | null>;
}

/** Deep-ish clone so callers cannot mutate persisted state by reference. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

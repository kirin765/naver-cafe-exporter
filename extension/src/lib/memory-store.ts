import { recordId, type Dataset, type Job, type RecordByDataset, type WorkItem } from "../../../shared/schema";
import { clone, type BatchCommit, type CommitResult, type JobStore } from "./store";

/** In-memory JobStore used by unit tests. Mirrors IndexedDB semantics. */
export class MemoryStore implements JobStore {
  private jobs = new Map<string, Job>();
  private records = new Map<string, Map<string, RecordByDataset[Dataset]>>();
  private work = new Map<string, Map<string, WorkItem>>();
  private meta = new Map<string, unknown>();
  private usageBytes = 0;

  private recordsKey(jobId: string, dataset: Dataset): string {
    return `${jobId}::${dataset}`;
  }

  private workKey(jobId: string): string {
    return jobId;
  }

  async createJob(job: Job): Promise<void> {
    this.jobs.set(job.jobId, clone(job));
  }

  async getJob(jobId: string): Promise<Job | null> {
    const job = this.jobs.get(jobId);
    return job ? clone(job) : null;
  }

  async listJobs(): Promise<Job[]> {
    return [...this.jobs.values()].map(clone).sort((a, b) => b.createdAt - a.createdAt);
  }

  async saveJob(job: Job): Promise<void> {
    this.jobs.set(job.jobId, clone(job));
  }

  async commitBatch(batch: BatchCommit): Promise<CommitResult> {
    const current = this.jobs.get(batch.job.jobId);
    if (!current) return { ok: false, reason: "missing_job" };
    if (current.runnerToken !== batch.runnerToken) return { ok: false, reason: "stale_runner" };

    for (const group of batch.records) {
      const key = this.recordsKey(batch.job.jobId, group.dataset);
      let bucket = this.records.get(key);
      if (!bucket) {
        bucket = new Map();
        this.records.set(key, bucket);
      }
      for (const item of group.items) {
        const id = recordId(group.dataset, item);
        bucket.set(id, clone(item));
      }
    }
    const workBucket = this.work.get(this.workKey(batch.job.jobId)) ?? new Map<string, WorkItem>();
    for (const item of batch.work) {
      workBucket.set(item.workId, clone(item));
    }
    this.work.set(this.workKey(batch.job.jobId), workBucket);
    this.jobs.set(batch.job.jobId, clone(batch.job));
    this.usageBytes = this.estimateUsage();
    return { ok: true };
  }

  async deleteJob(jobId: string): Promise<void> {
    this.jobs.delete(jobId);
    for (const dataset of ["posts", "comments", "members", "authors"] as Dataset[]) {
      this.records.delete(this.recordsKey(jobId, dataset));
    }
    this.work.delete(this.workKey(jobId));
    this.usageBytes = this.estimateUsage();
  }

  async getRecords<T extends Dataset>(jobId: string, dataset: T): Promise<RecordByDataset[T][]> {
    const bucket = this.records.get(this.recordsKey(jobId, dataset));
    return bucket ? ([...bucket.values()] as RecordByDataset[T][]) : [];
  }

  async countRecords(jobId: string, dataset: Dataset): Promise<number> {
    return this.records.get(this.recordsKey(jobId, dataset))?.size ?? 0;
  }

  async getWorkItems(jobId: string): Promise<WorkItem[]> {
    return [...(this.work.get(this.workKey(jobId))?.values() ?? [])].map(clone);
  }

  async saveWork(items: WorkItem[]): Promise<void> {
    for (const item of items) {
      const bucket = this.work.get(this.workKey(item.jobId)) ?? new Map<string, WorkItem>();
      bucket.set(item.workId, clone(item));
      this.work.set(this.workKey(item.jobId), bucket);
    }
  }

  async getMeta<T>(key: string): Promise<T | null> {
    return (this.meta.get(key) as T | undefined) ?? null;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    this.meta.set(key, clone(value));
  }

  async usageEstimate(): Promise<number | null> {
    return this.usageBytes;
  }

  private estimateUsage(): number {
    let bytes = 0;
    for (const job of this.jobs.values()) bytes += JSON.stringify(job).length;
    for (const bucket of this.records.values()) {
      for (const rec of bucket.values()) bytes += JSON.stringify(rec).length;
    }
    return bytes;
  }
}

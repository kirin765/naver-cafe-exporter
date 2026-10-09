import { recordId, type Dataset, type Job, type RecordByDataset, type WorkItem } from "../../../shared/schema";
import { DB_GENERATION, DB_NAME } from "./config";
import { clone, type BatchCommit, type CommitResult, type JobStore } from "./store";

const STORE_JOBS = "jobs";
const STORE_RECORDS = "records";
const STORE_WORK = "work";
const STORE_META = "meta";
const META_GENERATION = "generation";

function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export class IdbStore implements JobStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactory = indexedDB) {}

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const request = this.factory.open(DB_NAME, DB_GENERATION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_JOBS)) {
          db.createObjectStore(STORE_JOBS, { keyPath: "jobId" });
        }
        if (!db.objectStoreNames.contains(STORE_RECORDS)) {
          const store = db.createObjectStore(STORE_RECORDS, { keyPath: ["jobId", "datasetId", "recordId"] });
          store.createIndex("by_job_dataset", ["jobId", "datasetId"]);
        }
        if (!db.objectStoreNames.contains(STORE_WORK)) {
          const store = db.createObjectStore(STORE_WORK, { keyPath: ["jobId", "workId"] });
          store.createIndex("by_job", "jobId");
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.dbPromise;
  }

  /** Verify the persisted generation; a mismatch means data was invalidated. */
  async ensureGeneration(): Promise<boolean> {
    const db = await this.open();
    const tx = db.transaction(STORE_META, "readwrite");
    const store = tx.objectStore(STORE_META);
    const existing = await req<{ key: string; value: number } | undefined>(store.get(META_GENERATION));
    const ok = !existing || existing.value === DB_GENERATION;
    store.put({ key: META_GENERATION, value: DB_GENERATION });
    await txDone(tx);
    return ok;
  }

  async createJob(job: Job): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(STORE_JOBS, "readwrite");
    tx.objectStore(STORE_JOBS).put(clone(job));
    await txDone(tx);
  }

  async getJob(jobId: string): Promise<Job | null> {
    const db = await this.open();
    const tx = db.transaction(STORE_JOBS, "readonly");
    const value = await req<Job | undefined>(tx.objectStore(STORE_JOBS).get(jobId));
    return value ?? null;
  }

  async listJobs(): Promise<Job[]> {
    const db = await this.open();
    const tx = db.transaction(STORE_JOBS, "readonly");
    const values = await req<Job[]>(tx.objectStore(STORE_JOBS).getAll());
    return values.sort((a, b) => b.createdAt - a.createdAt);
  }

  async saveJob(job: Job): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(STORE_JOBS, "readwrite");
    tx.objectStore(STORE_JOBS).put(clone(job));
    await txDone(tx);
  }

  async commitBatch(batch: BatchCommit): Promise<CommitResult> {
    const db = await this.open();
    const tx = db.transaction([STORE_JOBS, STORE_RECORDS, STORE_WORK], "readwrite");
    try {
      const jobs = tx.objectStore(STORE_JOBS);
      const current = await req<Job | undefined>(jobs.get(batch.job.jobId));
      if (!current) {
        tx.abort();
        return { ok: false, reason: "missing_job" };
      }
      if (current.runnerToken !== batch.runnerToken) {
        tx.abort();
        return { ok: false, reason: "stale_runner" };
      }

      const records = tx.objectStore(STORE_RECORDS);
      for (const group of batch.records) {
        for (const item of group.items) {
          records.put({
            jobId: batch.job.jobId,
            datasetId: group.dataset,
            recordId: recordId(group.dataset, item),
            value: clone(item)
          });
        }
      }

      const work = tx.objectStore(STORE_WORK);
      for (const item of batch.work) {
        work.put({ jobId: batch.job.jobId, workId: item.workId, value: clone(item) });
      }

      jobs.put(clone(batch.job));
      await txDone(tx);
      return { ok: true };
    } catch (err) {
      try {
        tx.abort();
      } catch {
        /* already aborted */
      }
      throw err;
    }
  }

  async deleteJob(jobId: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction([STORE_JOBS, STORE_RECORDS, STORE_WORK], "readwrite");
    tx.objectStore(STORE_JOBS).delete(jobId);
    const records = tx.objectStore(STORE_RECORDS);
    const recordIndex = records.index("by_job_dataset");
    const recordKeys = await req<IDBValidKey[]>(recordIndex.getAllKeys(IDBKeyRange.bound([jobId], [jobId, []])));
    for (const key of recordKeys) records.delete(key);

    const work = tx.objectStore(STORE_WORK);
    const workIndex = work.index("by_job");
    const workKeys = await req<IDBValidKey[]>(workIndex.getAllKeys(IDBKeyRange.only(jobId)));
    for (const key of workKeys) work.delete(key);

    await txDone(tx);
  }

  async getRecords<T extends Dataset>(jobId: string, dataset: T): Promise<RecordByDataset[T][]> {
    const db = await this.open();
    const tx = db.transaction(STORE_RECORDS, "readonly");
    const index = tx.objectStore(STORE_RECORDS).index("by_job_dataset");
    const rows = await req<Array<{ value: RecordByDataset[T] }>>(
      index.getAll(IDBKeyRange.only([jobId, dataset]))
    );
    return rows.map((r) => r.value);
  }

  async countRecords(jobId: string, dataset: Dataset): Promise<number> {
    const db = await this.open();
    const tx = db.transaction(STORE_RECORDS, "readonly");
    const index = tx.objectStore(STORE_RECORDS).index("by_job_dataset");
    return req<number>(index.count(IDBKeyRange.only([jobId, dataset])));
  }

  async getWorkItems(jobId: string): Promise<WorkItem[]> {
    const db = await this.open();
    const tx = db.transaction(STORE_WORK, "readonly");
    const index = tx.objectStore(STORE_WORK).index("by_job");
    const rows = await req<Array<{ value: WorkItem }>>(index.getAll(IDBKeyRange.only(jobId)));
    return rows.map((r) => r.value);
  }

  async saveWork(items: WorkItem[]): Promise<void> {
    if (items.length === 0) return;
    const db = await this.open();
    const tx = db.transaction(STORE_WORK, "readwrite");
    const store = tx.objectStore(STORE_WORK);
    for (const item of items) store.put({ jobId: item.jobId, workId: item.workId, value: clone(item) });
    await txDone(tx);
  }

  async getMeta<T>(key: string): Promise<T | null> {
    const db = await this.open();
    const tx = db.transaction(STORE_META, "readonly");
    const row = await req<{ key: string; value: T } | undefined>(tx.objectStore(STORE_META).get(key));
    return row ? row.value : null;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(STORE_META, "readwrite");
    tx.objectStore(STORE_META).put({ key, value });
    await txDone(tx);
  }

  async usageEstimate(): Promise<number | null> {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
    const estimate = await navigator.storage.estimate();
    return estimate.usage ?? null;
  }
}

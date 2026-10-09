import { DATASETS } from "../../../shared/schema";
import { buildWorkbook } from "../lib/export";
import { IdbStore } from "../lib/idb-store";

/**
 * Export web worker. Reading records and generating the workbook off the main
 * thread keeps the workspace responsive; the main thread can terminate the
 * worker to cancel an export.
 */

type ExportRequest = { type: "export"; jobId: string };

self.onmessage = async (event: MessageEvent<ExportRequest>) => {
  const data = event.data;
  if (!data || data.type !== "export") return;
  try {
    const store = new IdbStore();
    const job = await store.getJob(data.jobId);
    if (!job) {
      postMessage({ type: "export-error", message: "작업을 찾을 수 없습니다." });
      return;
    }
    const posts = await store.getRecords(data.jobId, "posts");
    const comments = await store.getRecords(data.jobId, "comments");
    const members = await store.getRecords(data.jobId, "members");
    const authors = await store.getRecords(data.jobId, "authors");
    void DATASETS;
    const bytes = buildWorkbook({
      job,
      posts,
      comments,
      members,
      authors,
      coverage: job.coverage,
      recovery: [],
      now: Date.now()
    });
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    (postMessage as (message: unknown, transfer?: Transferable[]) => void)({ type: "export-done", bytes }, [buffer]);
  } catch (err) {
    postMessage({ type: "export-error", message: err instanceof Error ? err.message : "엑셀 생성에 실패했습니다." });
  }
};

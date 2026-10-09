import type { AccessState, Dataset } from "../../../shared/schema";
import type { CafeSource } from "../lib/runner";
import { CollectError, type DatasetTaskResult } from "../lib/types";

/**
 * CafeSource implementation that forwards tasks to the open Cafe content script
 * via `chrome.tabs.sendMessage`. Progress is broadcast by the content script and
 * surfaced through the workspace's runtime message listener.
 */
export class TabCafeSource implements CafeSource {
  constructor(private readonly tabId: number) {}

  private async run(message: Record<string, unknown>): Promise<DatasetTaskResult> {
    if (!this.tabId) {
      throw new CollectError("NOT_CAFE", "카페 탭을 찾을 수 없습니다. 카페 게시판을 연 뒤 다시 시도해 주세요.");
    }
    let response: unknown;
    try {
      // Target the top frame; its adapter searches same-origin child frames
      // (legacy `cafe_main` iframe) so the correct document is always used.
      response = await chrome.tabs.sendMessage(this.tabId, message, { frameId: 0 });
    } catch {
      throw new CollectError("NOT_CAFE", "카페 페이지와 통신하지 못했습니다. 탭을 새로고침해 주세요.");
    }
    const typed = response as { type?: string; code?: string; message?: string } & DatasetTaskResult;
    if (typed?.type === "TASK_ERROR") {
      throw new CollectError((typed.code as never) ?? "UNKNOWN", typed.message ?? "수집 중 오류가 발생했습니다.");
    }
    return typed as DatasetTaskResult;
  }

  async checkAccess(dataset: Dataset, scope: string): Promise<AccessState> {
    try {
      const response = (await chrome.tabs.sendMessage(
        this.tabId,
        { type: "CHECK_ACCESS", dataset, scope },
        { frameId: 0 }
      )) as AccessState;
      return response;
    } catch {
      return {
        scope,
        code: "unknown",
        requiredGrade: null,
        httpStatus: null,
        message: "접근 권한을 확인하지 못했습니다. 카페 탭을 새로고침해 주세요."
      };
    }
  }

  async listPosts(cursor: string | null, maxItems: number): Promise<DatasetTaskResult> {
    return this.run({ type: "RUN_TASK", taskId: `posts:${cursor ?? "1"}`, dataset: "posts", scope: "board", cursor, maxItems });
  }

  async getPostDetail(postId: string): Promise<{ item: Record<string, unknown>; access: AccessState }> {
    const result = await this.run({
      type: "RUN_TASK",
      taskId: `detail:${postId}`,
      dataset: "posts",
      scope: `detail:${postId}`,
      cursor: null,
      maxItems: 1
    });
    return { item: result.items[0] ?? {}, access: result.access };
  }

  async listComments(postId: string, cursor: string | null, maxItems: number): Promise<DatasetTaskResult> {
    return this.run({
      type: "RUN_TASK",
      taskId: `comments:${postId}:${cursor ?? "1"}`,
      dataset: "comments",
      scope: `post:${postId}`,
      cursor,
      maxItems
    });
  }

  async listMembers(cursor: string | null, maxItems: number): Promise<DatasetTaskResult> {
    return this.run({
      type: "RUN_TASK",
      taskId: `members:${cursor ?? "1"}`,
      dataset: "members",
      scope: "directory",
      cursor,
      maxItems
    });
  }
}

import type { AccessState, Dataset, JobFilters } from "../../../shared/schema";
import type { CollectErrorCode, DatasetTaskResult } from "./types";

/** Detected cafe/board context from a content script. */
export type CafeContext = {
  cafeId: string | null;
  cafeName: string;
  cafeUrl: string | null;
  boardId: string | null;
  boardName: string;
  articleId: string | null;
  layout: "legacy" | "new" | "unknown";
};

export type PongResponse = { type: "PONG"; ctx: CafeContext };

/** popup / workspace → content script */
export type ContentRequest =
  | { type: "PING" }
  | { type: "CHECK_ACCESS"; dataset: Dataset; scope: string }
  | {
      type: "RUN_TASK";
      taskId: string;
      dataset: Dataset;
      scope: string;
      cursor: string | null;
      maxItems: number;
    }
  | { type: "CANCEL_TASK"; taskId?: string };

/** content script → workspace (broadcast) */
export type StreamMessage =
  | { type: "PROGRESS"; taskId: string; dataset: Dataset; collected: number; total: number | null }
  | { type: "TASK_RESULT"; taskId: string; result: DatasetTaskResult }
  | { type: "TASK_ERROR"; taskId: string; code: CollectErrorCode; message: string; access?: AccessState };

/** popup → background/workspace */
export type OpenWorkspaceRequest = {
  type: "OPEN_WORKSPACE";
  tabId: number;
  ctx: CafeContext;
  url: string;
};

export type PageContextResponse = { type: "PAGE_CONTEXT"; ctx: CafeContext; tabId: number; url: string };

/* ------------------------------------------------------------------ */
/* Account linking (workspace <-> background <-> product website)      */
/* ------------------------------------------------------------------ */

export type AccountState = {
  connected: boolean;
  email: string | null;
  token: string | null;
  tokenExpiresAt: string | null;
};

export type AccountRequest =
  | { type: "ACCOUNT_STATUS" }
  | { type: "ACCOUNT_LINK_START" }
  | { type: "ACCOUNT_DISCONNECT" }
  | { type: "ACCOUNT_REFRESH_ENTITLEMENT" };

export type AccountResponse =
  | { type: "ACCOUNT_STATUS_RESULT"; state: AccountState }
  | { type: "ACCOUNT_LINK_STARTED"; verificationUrl: string; requestId: string }
  | { type: "ACCOUNT_ERROR"; message: string }
  | { type: "ENTITLEMENT_RESULT"; active: boolean; plan: "free" | "paid"; reason: string };

/** Fired by background when a link flow completes (poll success). */
export type AccountLinkedBroadcast = {
  type: "ACCOUNT_LINKED";
  email: string | null;
};

export type JobStartRequest = {
  type: "JOB_START";
  jobId: string;
};

export type WorkspaceRequest = JobStartRequest | { type: "JOB_PAUSE"; jobId: string } | { type: "JOB_CANCEL"; jobId: string };

export type StartJobOptions = {
  filters: JobFilters;
  preview: boolean;
  tabId: number;
};

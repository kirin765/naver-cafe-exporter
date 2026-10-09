import type { AccessState, Dataset } from "../../../shared/schema";

/** Terminal error codes surfaced by the collector to the UI. */
export type CollectErrorCode =
  | "NOT_CAFE"
  | "NO_BOARD"
  | "LOGIN"
  | "ACCESS"
  | "BLOCKED"
  | "EMPTY"
  | "NETWORK"
  | "UNSUPPORTED"
  | "QUOTA"
  | "CANCELLED"
  | "UNKNOWN";

export class CollectError extends Error {
  code: CollectErrorCode;
  access?: AccessState;
  constructor(code: CollectErrorCode, message: string, access?: AccessState) {
    super(message);
    this.code = code;
    this.access = access;
    this.name = "CollectError";
  }
}

export type PageResult<T> = {
  items: T[];
  total: number | null;
  hasNext: boolean;
  nextCursor: string | null;
};

export type ListRequest = {
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
};

export type CollectOptions = {
  maxItems: number;
  delayMs: () => number;
  sleep: (ms: number) => Promise<void>;
  onProgress?: (collected: number, total: number | null) => void;
  shouldCancel?: () => boolean;
  /** Bounded transient retry budget. */
  maxRetries?: number;
};

export type RunOptions = {
  onProgress?: (phase: string, collected: number, total: number | null) => void;
  shouldCancel?: () => boolean;
};

/** A single dataset collection request routed to a content script. */
export type DatasetTask = {
  dataset: Dataset;
  scope: string;
  cursor: string | null;
  maxItems: number;
};

export type DatasetTaskResult = {
  dataset: Dataset;
  scope: string;
  items: Record<string, unknown>[];
  nextCursor: string | null;
  total: number | null;
  access: AccessState;
  skipped?: number;
  deferred?: Array<{ scope: string; reason: string }>;
};

export function isCollectError(err: unknown): err is CollectError {
  return err instanceof CollectError;
}

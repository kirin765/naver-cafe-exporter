import { CollectError, type PageResult, type CollectOptions } from "./types";

const DEFAULT_MAX_RETRIES = 3;

/**
 * Shared pagination loop: polite delay, item limit, cancellation, bounded
 * transient retry and backoff. Terminal errors (access/login/blocked) are
 * propagated immediately; transient (`NETWORK`) errors retry a small number of
 * times and, if items were already collected, stop with what we have.
 */
export async function paginate<T>(
  fetchPage: (cursor: string | null) => Promise<PageResult<T>>,
  opts: CollectOptions
): Promise<T[]> {
  const out: T[] = [];
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  let cursor: string | null = null;
  const seenCursors = new Set<string>();

  for (let guard = 0; guard < 10_000; guard++) {
    if (opts.shouldCancel?.()) break;

    let res: PageResult<T>;
    try {
      res = await withRetry(fetchPage, cursor, opts.sleep, maxRetries);
    } catch (err) {
      if (out.length > 0 && !(err instanceof CollectError && err.code !== "NETWORK")) break;
      throw err;
    }

    if (res.items.length === 0) break;
    out.push(...res.items);
    opts.onProgress?.(out.length, res.total);

    if (out.length >= opts.maxItems) break;
    if (!res.hasNext) break;

    const next = res.nextCursor;
    if (!next) break;
    // Repeated cursor or no progress → stop rather than loop forever.
    if (seenCursors.has(next)) break;
    seenCursors.add(next);
    cursor = next;

    await opts.sleep(opts.delayMs());
  }

  return out.slice(0, opts.maxItems);
}

async function withRetry<T>(
  fetchPage: (cursor: string | null) => Promise<PageResult<T>>,
  cursor: string | null,
  sleep: (ms: number) => Promise<void>,
  maxRetries: number
): Promise<PageResult<T>> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fetchPage(cursor);
    } catch (err) {
      if (err instanceof CollectError && err.code !== "NETWORK") throw err;
      lastErr = err;
      if (attempt < maxRetries) await sleep(300 * Math.pow(2, attempt));
    }
  }
  throw lastErr ?? new CollectError("NETWORK", "데이터를 불러오지 못했습니다.");
}

export function randomDelay(min: number, max: number): () => number {
  return () => min + Math.floor(Math.random() * Math.max(0, max - min));
}

export function realSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

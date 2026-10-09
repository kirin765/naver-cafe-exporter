/**
 * Live E2E harness (not part of the extension build). Bundled by scripts/e2e-live.mjs
 * and driven from Node with Playwright: it feeds live Naver Cafe responses through
 * the real runner, normalization, and export pipeline.
 */
import { JSDOM } from "jsdom";
import type { AccessState, Coverage, Job, JobFilters } from "../../shared/schema";
import { parseArticleGw, parseCommentsGw, parsePostList, detectNextPage } from "../src/content/adapters";
import { buildWorkbook } from "../src/lib/export";
import { createJob } from "../src/lib/jobs";
import { MemoryStore } from "../src/lib/memory-store";
import { runJob, type CafeSource } from "../src/lib/runner";

const jsdom = new JSDOM("<!doctype html><html><body></body></html>");
(globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = jsdom.window.DOMParser as unknown as typeof DOMParser;

export type LiveSource = {
  board: (page: number) => Promise<{ html: string; url: string }>;
  article: (postId: string) => Promise<unknown>;
  comments: (postId: string, page: number) => Promise<unknown>;
};

export type RunOptions = {
  filters: JobFilters;
  cafeId: string;
  menuId: string | null;
  articleUrl: (postId: string) => string;
  outPath: string;
  maxPosts: number;
  maxComments: number;
};

export type RunResult = {
  status: Job["status"];
  counts: Job["counters"]["committed"];
  coverage: Coverage;
  workbookBytes: number;
  previewTitles: string[];
};

export async function runLive(source: LiveSource, options: RunOptions): Promise<RunResult> {
  const publicAccess = (scope: string): AccessState => ({
    scope,
    code: "public",
    requiredGrade: null,
    httpStatus: 200,
    message: "public"
  });

  const cafeSource: CafeSource = {
    checkAccess: async (dataset, scope) => publicAccess(`${dataset}:${scope}`),
    listPosts: async (cursor) => {
      const page = Number(cursor ?? "1") || 1;
      const { html, url } = await source.board(page);
      const doc = new JSDOM(html).window.document;
      const parsed = parsePostList(doc as unknown as Document, url);
      return {
        dataset: "posts",
        scope: "board",
        items: parsed.items.slice(0, options.maxPosts) as unknown as Record<string, unknown>[],
        nextCursor: detectNextPage(doc as unknown as Document, page),
        total: parsed.total,
        access: publicAccess("posts")
      };
    },
    getPostDetail: async (postId) => {
      const json = await source.article(postId);
      const item = parseArticleGw(json, {
        cafeId: options.cafeId,
        menuId: options.menuId,
        menuName: "",
        sourceUrl: options.articleUrl(postId)
      });
      return { item: (item ?? {}) as unknown as Record<string, unknown>, access: publicAccess(`detail:${postId}`) };
    },
    listComments: async (postId, cursor) => {
      const page = Number(cursor ?? "1") || 1;
      const json = await source.comments(postId, page);
      const parsed = parseCommentsGw(json, postId, options.articleUrl(postId), page);
      // Cap per source so a busy board does not crawl forever.
      const remaining = options.maxComments;
      return {
        dataset: "comments",
        scope: `post:${postId}`,
        items: parsed.items.slice(0, remaining) as unknown as Record<string, unknown>[],
        nextCursor: parsed.hasNext && parsed.items.length > 0 ? parsed.nextCursor : null,
        total: parsed.total,
        access: publicAccess(`comments:${postId}`)
      };
    },
    listMembers: async () => ({
      dataset: "members",
      scope: "directory",
      items: [],
      nextCursor: null,
      total: 0,
      access: {
        scope: "directory",
        code: "unknown",
        requiredGrade: null,
        httpStatus: null,
        message: "member directory not verified"
      }
    })
  };

  const store = new MemoryStore();
  const job = createJob(options.filters, false);
  await store.createJob(job);
  const done = await runJob(job.jobId, {
    store,
    source: cafeSource,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    delayMs: () => 250,
    now: () => Date.now()
  });

  const posts = await store.getRecords(job.jobId, "posts");
  const bytes = buildWorkbook({
    job: done,
    posts,
    comments: await store.getRecords(job.jobId, "comments"),
    members: await store.getRecords(job.jobId, "members"),
    authors: await store.getRecords(job.jobId, "authors"),
    coverage: done.coverage,
    now: Date.now()
  });

  const { writeFileSync } = await import("node:fs");
  writeFileSync(options.outPath, bytes);

  return {
    status: done.status,
    counts: done.counters.committed,
    coverage: done.coverage,
    workbookBytes: bytes.length,
    previewTitles: posts.slice(0, 5).map((p) => p.title)
  };
}

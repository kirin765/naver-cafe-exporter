import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { MemoryStore } from "../src/lib/memory-store";
import { runJob, type CafeSource } from "../src/lib/runner";
import { createJob } from "../src/lib/jobs";
import { buildWorkbook } from "../src/lib/export";
import type { DatasetTaskResult } from "../src/lib/types";
import type { RawComment, RawMember, RawPost } from "../src/lib/normalize";
import type { AccessState, JobFilters } from "../../shared/schema";

const pub: AccessState = { scope: "s", code: "public", requiredGrade: null, httpStatus: null, message: "public" };

class FixtureSource implements CafeSource {
  constructor(
    private posts: RawPost[],
    private comments: Record<string, RawComment[]>,
    private members: RawMember[]
  ) {}

  async checkAccess(): Promise<AccessState> {
    return pub;
  }
  async listPosts(): Promise<DatasetTaskResult> {
    return { dataset: "posts", scope: "board", items: this.posts as never, nextCursor: null, total: this.posts.length, access: pub };
  }
  async getPostDetail(postId: string): Promise<{ item: Record<string, unknown>; access: AccessState }> {
    return { item: { postId, bodyText: `본문 ${postId}` }, access: pub };
  }
  async listComments(postId: string): Promise<DatasetTaskResult> {
    return {
      dataset: "comments",
      scope: `post:${postId}`,
      items: (this.comments[postId] ?? []) as never,
      nextCursor: null,
      total: (this.comments[postId] ?? []).length,
      access: pub
    };
  }
  async listMembers(): Promise<DatasetTaskResult> {
    return { dataset: "members", scope: "directory", items: this.members as never, nextCursor: null, total: this.members.length, access: pub };
  }
}

const filters: JobFilters = {
  cafeId: "12345678",
  boardId: "5",
  boardName: "자유게시판",
  dateFrom: null,
  dateTo: null,
  maxPosts: 5000,
  includeComments: true,
  includeBody: true,
  includeMembers: true
};

describe("end-to-end: collect -> persist -> export", () => {
  it("produces a multi-sheet workbook with cross-sheet keys", async () => {
    const store = new MemoryStore();
    const source = new FixtureSource(
      [
        { postId: "p1", title: "게시글 1", nickname: "홍길동", memberKey: "mk1", createdAt: "2026.10.09. 13:20", viewCount: "1,234" },
        { postId: "p2", title: "게시글 2", nickname: "김철수", createdAt: "2026.10.08. 09:00" }
      ],
      {
        p1: [
          { commentId: "c1", postId: "p1", nickname: "댓글러", bodyText: "댓글" },
          { commentId: "c2", postId: "p1", parentCommentId: "c1", nickname: "댓글러", bodyText: "답글" }
        ]
      },
      [{ memberKey: "mk1", nickname: "홍길동", displayedId: "ho***", grade: "정회원", joinedAt: "2024-01-02" }]
    );

    const job = createJob(filters, false, 1_700_000_000_000);
    await store.createJob(job);

    const done = await runJob(job.jobId, {
      store,
      source,
      sleep: async () => {},
      delayMs: () => 0,
      now: () => 1_700_000_100_000
    });

    expect(done.status).toBe("completed");
    expect(done.counters.committed).toEqual({ posts: 2, comments: 2, members: 1 });

    const bytes = buildWorkbook({
      job: done,
      posts: await store.getRecords(job.jobId, "posts"),
      comments: await store.getRecords(job.jobId, "comments"),
      members: await store.getRecords(job.jobId, "members"),
      authors: await store.getRecords(job.jobId, "authors"),
      coverage: done.coverage,
      now: 1_700_000_200_000
    });

    const files = unzipSync(bytes);
    const workbook = strFromU8(files["xl/workbook.xml"] as Uint8Array);
    for (const name of ["게시글", "댓글", "회원", "작성자", "내보내기 정보"]) {
      expect(workbook).toContain(`name="${name}"`);
    }

    const sst = strFromU8(files["xl/sharedStrings.xml"] as Uint8Array);
    // author_key from posts must be traceable to the author sheet.
    expect(sst).toContain("m:12345678:mk1");
    // masked member id is preserved verbatim.
    expect(sst).toContain("ho***");
    // coverage/limit metadata present in the information sheet.
    expect(sst).toContain("committed_posts");
    expect(sst).toContain("schema_version");
  });
});

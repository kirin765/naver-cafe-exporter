import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { buildExportSheets, buildWorkbook, LONG_TEXT_LIMIT, suggestedFilename } from "../src/lib/export";
import { createJob } from "../src/lib/jobs";
import type { CommentRecord, Job, JobFilters, PostRecord } from "../../shared/schema";

const filters: JobFilters = {
  cafeId: "cafe1",
  boardId: "b1",
  boardName: "자유게시판",
  dateFrom: null,
  dateTo: null,
  maxPosts: 100,
  includeComments: true,
  includeBody: true,
  includeMembers: false
};

function makeJob(): Job {
  const job = createJob(filters, false, 1_700_000_000_000);
  job.counters.committed = { posts: 1, comments: 1, members: 0 };
  job.coverage.posts.collected = 1;
  job.coverage.comments.collected = 1;
  job.coverage.authors.collected = 1;
  return job;
}

const post: PostRecord = {
  cafeId: "cafe1",
  boardId: "b1",
  boardName: "자유게시판",
  postId: "p1",
  title: "제목",
  bodyText: "본문",
  authorKey: "m:cafe1:1",
  nickname: "작성자",
  displayedId: "1",
  idType: "member_key",
  createdAt: "2026-10-09T04:20:00.000Z",
  updatedAt: null,
  viewCount: 10,
  commentCount: 1,
  sourceUrl: "https://cafe.naver.com/ArticleRead.nhn?articleid=p1"
};

const comment: CommentRecord = {
  cafeId: "cafe1",
  postId: "p1",
  commentId: "c1",
  parentCommentId: null,
  authorKey: "n:cafe1:댓글러",
  nickname: "댓글러",
  displayedId: "",
  idType: "nickname_only",
  bodyText: "댓글",
  createdAt: "2026-10-09T05:00:00.000Z",
  sourceUrl: ""
};

describe("buildExportSheets", () => {
  it("omits comments/members sheets when not requested and keeps info", () => {
    const job = createJob({ ...filters, includeComments: false, includeMembers: false }, false);
    const { sheets } = buildExportSheets({ job, posts: [], comments: [], members: [], authors: [], coverage: job.coverage });
    const names = sheets.map((s) => s.name);
    expect(names).toContain("게시글");
    expect(names).toContain("작성자");
    expect(names).toContain("내보내기 정보");
    expect(names).not.toContain("댓글");
    expect(names).not.toContain("회원");
  });

  it("links long text through the 긴 텍스트 sheet", () => {
    const job = makeJob();
    const longBody = "가".repeat(LONG_TEXT_LIMIT + 500);
    const { sheets, longTextRows } = buildExportSheets({
      job,
      posts: [{ ...post, bodyText: longBody }],
      comments: [],
      members: [],
      authors: [],
      coverage: job.coverage
    });
    const longSheet = sheets.find((s) => s.name === "긴 텍스트");
    expect(longSheet).toBeDefined();
    expect(longTextRows).toHaveLength(2);
    // Reconstruct from continuation rows.
    const rebuilt = longTextRows
      .sort((a, b) => a.part - b.part)
      .map((r) => r.text)
      .join("");
    expect(rebuilt).toBe(longBody);
    expect(longTextRows[0].key).toBe("p1");
    expect(longTextRows[0].field).toBe("body_text");
  });

  it("records coverage and limits in the info sheet", () => {
    const job = makeJob();
    const { sheets } = buildExportSheets({
      job,
      posts: [post],
      comments: [comment],
      members: [],
      authors: [],
      coverage: job.coverage,
      sourceTotals: { posts: 42 }
    });
    const info = sheets.find((s) => s.name === "내보내기 정보");
    const fields = info?.rows.map((r) => r[0]);
    expect(fields).toContain("job_id");
    expect(fields).toContain("posts_source_total");
    expect(fields).toContain("committed_posts");
  });
});

describe("buildWorkbook", () => {
  it("returns a valid zip containing the sheets", () => {
    const job = makeJob();
    const bytes = buildWorkbook({
      job,
      posts: [post],
      comments: [comment],
      members: [],
      authors: [],
      coverage: job.coverage
    });
    const files = Object.keys(unzipSync(bytes));
    expect(files).toContain("xl/worksheets/sheet1.xml");
    const sst = strFromU8(unzipSync(bytes)["xl/sharedStrings.xml"] as Uint8Array);
    expect(sst).toContain("작성자");
  });
});

describe("suggestedFilename", () => {
  it("uses the cafe id and a timestamp", () => {
    expect(suggestedFilename("1234", new Date("2026-10-09T04:20:00Z"))).toMatch(
      /^naver-cafe_1234_\d{8}-\d{4}\.xlsx$/
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  aggregateAuthors,
  normalizeComment,
  normalizeMember,
  normalizePost,
  parseKoreanDate,
  resolveAuthor
} from "../src/lib/normalize";

describe("resolveAuthor", () => {
  it("prefers the member key", () => {
    const a = resolveAuthor("c1", { memberKey: "mk1", loginId: "id", displayedId: "d", nickname: "n" });
    expect(a.idType).toBe("member_key");
    expect(a.identityStatus).toBe("resolved");
    expect(a.authorKey).toBe("m:c1:mk1");
  });

  it("falls back to login id", () => {
    const a = resolveAuthor("c1", { loginId: "hong", nickname: "홍" });
    expect(a.idType).toBe("login_id");
    expect(a.identityStatus).toBe("resolved");
  });

  it("detects masked displayed ids", () => {
    const a = resolveAuthor("c1", { displayedId: "ho***", nickname: "홍" });
    expect(a.idType).toBe("masked_id");
    expect(a.identityStatus).toBe("unresolved");
  });

  it("marks nickname-only identities unresolved", () => {
    const a = resolveAuthor("c1", { nickname: "닉네임" });
    expect(a.idType).toBe("nickname_only");
    expect(a.identityStatus).toBe("unresolved");
  });

  it("returns an absent identity when nothing is available", () => {
    const a = resolveAuthor("c1", {});
    expect(a.idType).toBe("absent");
  });
});

describe("parseKoreanDate", () => {
  it("treats a naive wall-clock string as KST", () => {
    expect(parseKoreanDate("2026.10.09. 13:20")).toBe("2026-10-09T04:20:00.000Z");
  });

  it("parses a date-only KST value", () => {
    expect(parseKoreanDate("2026-10-09")).toBe("2026-10-08T15:00:00.000Z");
  });

  it("keeps explicit timezone ISO values", () => {
    expect(parseKoreanDate("2026-10-09T13:20:00Z")).toBe("2026-10-09T13:20:00.000Z");
  });

  it("parses epoch seconds and milliseconds", () => {
    expect(parseKoreanDate(1700000000)).toBe("2023-11-14T22:13:20.000Z");
    expect(parseKoreanDate(1700000000000)).toBe("2023-11-14T22:13:20.000Z");
  });

  it("leaves unresolvable relative labels unknown", () => {
    expect(parseKoreanDate("방금")).toBeNull();
    expect(parseKoreanDate("3분 전")).toBeNull();
    expect(parseKoreanDate("")).toBeNull();
  });
});

describe("normalizePost / comment / member", () => {
  const ctx = { cafeId: "c1", boardId: "b1", boardName: "자유게시판" };

  it("normalizes a post and preserves unicode", () => {
    const post = normalizePost(
      {
        postId: "p1",
        title: "제목 😀",
        bodyText: "본문",
        nickname: "작성자",
        createdAt: "2026.10.09. 13:20",
        viewCount: "1,234",
        commentCount: "5회"
      },
      ctx
    );
    expect(post.title).toBe("제목 😀");
    expect(post.viewCount).toBe(1234);
    expect(post.commentCount).toBe(5);
    expect(post.boardName).toBe("자유게시판");
  });

  it("keeps parent comment id for replies", () => {
    const c = normalizeComment(
      { commentId: "c9", postId: "p1", parentCommentId: "c1", bodyText: "답글", nickname: "n" },
      ctx
    );
    expect(c.parentCommentId).toBe("c1");
    expect(c.postId).toBe("p1");
  });

  it("normalizes members with grade and joined date", () => {
    const m = normalizeMember(
      { memberKey: "mk1", nickname: "회원", displayedId: "me***", grade: "정회원", joinedAt: "2024-01-02" },
      ctx
    );
    expect(m.grade).toBe("정회원");
    expect(m.joinedAt).toBe("2024-01-01T15:00:00.000Z");
    expect(m.idType).toBe("member_key");
  });
});

describe("aggregateAuthors", () => {
  const ctx = { cafeId: "c1" };

  it("aggregates counts and marks unresolved authors", () => {
    const posts = [
      normalizePost({ postId: "p1", nickname: "A", createdAt: "2026-01-01" }, ctx),
      normalizePost({ postId: "p2", memberKey: "mk1", nickname: "B", createdAt: "2026-01-02" }, ctx)
    ];
    const comments = [normalizeComment({ commentId: "c1", postId: "p1", nickname: "A" }, ctx)];
    const authors = aggregateAuthors(posts, comments);
    const a = authors.find((x) => x.nickname === "A");
    const b = authors.find((x) => x.nickname === "B");
    expect(a?.observedPostCount).toBe(1);
    expect(a?.observedCommentCount).toBe(1);
    expect(a?.identityStatus).toBe("unresolved");
    expect(b?.identityStatus).toBe("resolved");
  });

  it("does not merge different nicknames", () => {
    const posts = [
      normalizePost({ postId: "p1", nickname: "같은닉", createdAt: "2026-01-01" }, ctx),
      normalizePost({ postId: "p2", nickname: "다른닉", createdAt: "2026-01-01" }, ctx)
    ];
    expect(aggregateAuthors(posts, [])).toHaveLength(2);
  });
});

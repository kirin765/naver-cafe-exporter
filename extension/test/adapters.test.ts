import { describe, expect, it } from "vitest";
import {
  detectAccessFromDocument,
  detectNextPage,
  extractPostId,
  parseArticle,
  parseArticleGw,
  parseComments,
  parseCommentsGw,
  parseCommentsJson,
  parseMembers,
  parseMembersJson,
  parsePostList,
  parsePostListJson
} from "../src/content/adapters";

import boardListHtml from "../../fixtures/legacy-board-list.html?raw";
import newBoardListHtml from "../../fixtures/new-board-list.html?raw";
import articleHtml from "../../fixtures/article.html?raw";
import commentsHtml from "../../fixtures/comments.html?raw";
import membersHtml from "../../fixtures/members.html?raw";
import loginHtml from "../../fixtures/access-login-required.html?raw";
import gradeHtml from "../../fixtures/access-grade-required.html?raw";
import postsJson from "../../fixtures/posts.json?raw";
import commentsJson from "../../fixtures/comments.json?raw";
import membersJson from "../../fixtures/members.json?raw";
import gwArticle from "../../fixtures/gw-article.json?raw";
import gwComments from "../../fixtures/gw-comments.json?raw";

function doc(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("extractPostId", () => {
  it("reads legacy and new article urls", () => {
    expect(extractPostId("/ArticleRead.nhn?clubid=1&articleid=1001")).toBe("1001");
    expect(extractPostId("https://cafe.naver.com/f-e/cafes/1/articles/2002")).toBe("2002");
    expect(extractPostId("https://cafe.naver.com/mycafe/3003")).toBe("3003");
  });
});

describe("DOM adapters", () => {
  it("parses the board list", () => {
    const page = parsePostList(doc(boardListHtml), "https://cafe.naver.com/ArticleList.nhn");
    expect(page.items).toHaveLength(2);
    const first = page.items[0];
    expect(first.postId).toBe("1001");
    expect(first.title).toBe("첫 게시글 😀");
    expect(first.nickname).toBe("홍길동");
    expect(first.viewCount).toBe(1234);
    expect(first.commentCount).toBe(5);
    expect(page.nextCursor).toBe("2");
  });

  it("parses an article body", () => {
    const post = parseArticle(doc(articleHtml), "1001", "https://cafe.naver.com/ArticleRead.nhn?articleid=1001");
    expect(post.title).toBe("게시글 제목");
    expect(post.bodyText).toContain("본문 내용입니다");
    expect(post.nickname).toBe("작성자닉");
  });

  it("parses comments and replies", () => {
    const page = parseComments(doc(commentsHtml), "1001", "https://cafe.naver.com/ArticleRead.nhn");
    expect(page.items).toHaveLength(2);
    const reply = page.items.find((c) => c.commentId === "c2");
    expect(reply?.parentCommentId).toBe("c1");
    expect(reply?.bodyText).toBe("답글입니다");
  });

  it("parses the member directory", () => {
    const page = parseMembers(doc(membersHtml), "https://cafe.naver.com/CafeMemberList.nhn");
    expect(page.items).toHaveLength(1);
    expect(page.items[0].memberKey).toBe("mk1");
    expect(page.items[0].grade).toBe("정회원");
  });
});

describe("access detection", () => {
  it("detects login requirement", () => {
    expect(detectAccessFromDocument(doc(loginHtml), "board").code).toBe("login_required");
  });

  it("detects a required grade and names it", () => {
    const state = detectAccessFromDocument(doc(gradeHtml), "board");
    expect(state.code).toBe("grade_required");
    expect(state.requiredGrade).toBe("준회원");
  });

  it("detects membership-required and denied states from page text", () => {
    const membership = doc("<html><body>카페 가입 후 이용할 수 있습니다.</body></html>");
    expect(detectAccessFromDocument(membership, "board").code).toBe("membership_required");
    const denied = doc("<html><body>삭제된 게시글이거나 접근할 수 없습니다.</body></html>");
    expect(detectAccessFromDocument(denied, "board").code).toBe("denied");
    const approval = doc("<html><body>가입 승인 대기 중입니다.</body></html>");
    expect(detectAccessFromDocument(approval, "board").code).toBe("approval_required");
  });
});

describe("JSON adapters", () => {
  it("parses posts json", () => {
    const page = parsePostListJson(JSON.parse(postsJson), "https://cafe.naver.com");
    expect(page.items).toHaveLength(1);
    expect(page.items[0].postId).toBe("1001");
    expect(page.items[0].memberKey).toBe("mk1");
    expect(page.total).toBe(2);
    expect(page.hasNext).toBe(true);
    expect(page.nextCursor).toBe("2");
  });

  it("parses comments json", () => {
    const page = parseCommentsJson(JSON.parse(commentsJson), "1001", "https://cafe.naver.com");
    expect(page.items).toHaveLength(2);
    expect(page.items[1].parentCommentId).toBe("c1");
    expect(page.hasNext).toBe(false);
  });

  it("parses members json", () => {
    const page = parseMembersJson(JSON.parse(membersJson), "https://cafe.naver.com");
    expect(page.items).toHaveLength(1);
    expect(page.items[0].grade).toBe("정회원");
  });
});

describe("new /f-e layout (live-verified structure)", () => {
  it("parses the board list table with nickname/date/view/comment", () => {
    const page = parsePostList(doc(newBoardListHtml), "https://cafe.naver.com/f-e/cafes/10094408/menus/90");
    expect(page.items).toHaveLength(2);
    expect(page.items[0].postId).toBe("1001");
    expect(page.items[0].title).toBe("첫 게시글 😀");
    expect(page.items[0].nickname).toBe("홍길동");
    expect(page.items[0].viewCount).toBe(523);
    expect(page.items[0].commentCount).toBe(12);
  });

  it("detects the next page from the pager", () => {
    expect(detectNextPage(doc(newBoardListHtml), 1)).toBe("2");
    // A pager that only shows the current page with no next arrow stops.
    const last = new DOMParser().parseFromString(
      '<body><div class="pagination"><button class="btn number on">10</button></div></body>',
      "text/html"
    );
    expect(detectNextPage(last, 10)).toBeNull();
  });

  it("parses the article detail GW response", () => {
    const post = parseArticleGw(JSON.parse(gwArticle), {
      cafeId: "10094408",
      menuId: "90",
      menuName: "",
      sourceUrl: "https://cafe.naver.com/f-e/cafes/10094408/articles/4108669"
    });
    expect(post?.postId).toBe("4108669");
    expect(post?.title).toBe("중국생산 어떻게 생각하세요?");
    expect(post?.bodyText).toContain("본문 내용입니다");
    expect(post?.memberKey).toBe("FAKE_member_key_0001");
    expect(post?.boardName).toContain("수다 게시판");
    expect(post?.createdAt).toBe(1791428692110);
    expect(post?.viewCount).toBe("95");
  });

  it("parses the comments GW response and drops deleted items", () => {
    const page = parseCommentsGw(
      JSON.parse(gwComments),
      "4108669",
      "https://cafe.naver.com/f-e/cafes/10094408/articles/4108669",
      1
    );
    expect(page.items).toHaveLength(2);
    expect(page.items[0].bodyText).toBe("첫 댓글");
    expect(page.items[1].parentCommentId).toBe("100096860");
    expect(page.total).toBe(2);
    expect(page.hasNext).toBe(false);
  });
});

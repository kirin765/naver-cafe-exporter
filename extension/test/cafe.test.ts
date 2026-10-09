import { describe, expect, it } from "vitest";
import { buildArticleUrl, buildBoardUrl, contextFromUrl, parseCafeUrl } from "../src/lib/cafe";

describe("parseCafeUrl", () => {
  it("parses the new /f-e/cafes board route", () => {
    const info = parseCafeUrl("https://cafe.naver.com/f-e/cafes/12345678/menus/5");
    expect(info).toEqual({ cafeId: "12345678", cafeVanity: null, boardId: "5", articleId: null, layout: "new" });
  });

  it("parses the new article route", () => {
    const info = parseCafeUrl("https://cafe.naver.com/f-e/cafes/123/articles/999");
    expect(info.layout).toBe("new");
    expect(info.cafeId).toBe("123");
    expect(info.articleId).toBe("999");
  });

  it("parses the legacy ArticleList frame URL", () => {
    const info = parseCafeUrl(
      "https://cafe.naver.com/ArticleList.nhn?search.clubid=123&search.menuid=5&search.boardtype=L"
    );
    expect(info.cafeId).toBe("123");
    expect(info.boardId).toBe("5");
    expect(info.layout).toBe("legacy");
  });

  it("parses the legacy ArticleRead URL", () => {
    const info = parseCafeUrl("https://cafe.naver.com/ArticleRead.nhn?clubid=123&articleid=42&menuid=5");
    expect(info.cafeId).toBe("123");
    expect(info.articleId).toBe("42");
    expect(info.boardId).toBe("5");
  });

  it("treats a vanity path as the cafe url", () => {
    const info = parseCafeUrl("https://cafe.naver.com/mycafe123");
    expect(info.cafeVanity).toBe("mycafe123");
    expect(info.layout).toBe("legacy");
  });

  it("parses a vanity article url", () => {
    const info = parseCafeUrl("https://cafe.naver.com/mycafe123/777");
    expect(info.cafeVanity).toBe("mycafe123");
    expect(info.articleId).toBe("777");
  });

  it("does not treat app routes as a vanity", () => {
    const info = parseCafeUrl("https://cafe.naver.com/MyCafeIntro.nhn?clubid=9");
    expect(info.cafeVanity).toBeNull();
    expect(info.cafeId).toBe("9");
  });
});

describe("builders + context", () => {
  it("builds a new-layout board url", () => {
    expect(buildBoardUrl({ cafeId: "1", cafeVanity: null, boardId: "2", layout: "new" })).toBe(
      "https://cafe.naver.com/f-e/cafes/1/menus/2"
    );
  });

  it("builds a legacy board url", () => {
    expect(buildBoardUrl({ cafeId: "1", cafeVanity: null, boardId: "2", layout: "legacy" })).toContain(
      "ArticleList.nhn?search.clubid=1"
    );
  });

  it("builds an article url per layout", () => {
    expect(buildArticleUrl({ cafeId: "1", cafeVanity: null, boardId: "2", layout: "new" }, "99")).toBe(
      "https://cafe.naver.com/f-e/cafes/1/articles/99"
    );
    expect(buildArticleUrl({ cafeId: "1", cafeVanity: null, boardId: "2", layout: "legacy" }, "99")).toContain(
      "articleid=99"
    );
  });

  it("derives a context from a url", () => {
    const ctx = contextFromUrl("https://cafe.naver.com/f-e/cafes/7/menus/3");
    expect(ctx.cafeId).toBe("7");
    expect(ctx.boardId).toBe("3");
    expect(ctx.layout).toBe("new");
  });
});

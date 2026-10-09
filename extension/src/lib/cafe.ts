import type { CafeContext } from "./messages";

export type CafeUrlInfo = {
  cafeId: string | null;
  cafeVanity: string | null;
  boardId: string | null;
  articleId: string | null;
  layout: "legacy" | "new" | "unknown";
};

export function isCafeHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "cafe.naver.com" || h === "m.cafe.naver.com";
}

/** Path segments that are Naver Cafe app routes, never a cafe vanity URL. */
const RESERVED_SEGMENTS = new Set([
  "f-e",
  "cafe",
  "mycafe",
  "widget",
  "link",
  "static",
  "img"
]);

function firstSegment(pathname: string): string | null {
  const seg = pathname.split("/").filter(Boolean)[0];
  return seg ?? null;
}

function isReserved(seg: string | null): boolean {
  if (!seg) return false;
  const lower = seg.toLowerCase();
  return RESERVED_SEGMENTS.has(lower) || lower.endsWith(".nhn") || lower.endsWith(".nhn");
}

/**
 * Parse a Naver Cafe URL (either the legacy `ArticleList.nhn?...` frame URL or
 * the newer `/f-e/cafes/{id}/menus/{id}` route) into identifiers. Unknown URLs
 * return nulls rather than guessing.
 */
export function parseCafeUrl(input: string): CafeUrlInfo {
  let url: URL;
  try {
    url = new URL(input, "https://cafe.naver.com");
  } catch {
    return { cafeId: null, cafeVanity: null, boardId: null, articleId: null, layout: "unknown" };
  }

  const q = url.searchParams;
  const newRoute = url.pathname.match(/\/f-e\/cafes\/(\d+)(?:\/menus\/(\d+))?(?:\/articles\/(\d+))?/);

  if (newRoute) {
    const menuFromQuery = q.get("menuid") ?? q.get("menuId");
    return {
      cafeId: newRoute[1] ?? null,
      cafeVanity: null,
      boardId: newRoute[2] ?? menuFromQuery ?? null,
      articleId: newRoute[3] ?? null,
      layout: "new"
    };
  }

  const legacyClub = q.get("search.clubid") ?? q.get("clubid") ?? q.get("clubId");
  const legacyMenu = q.get("search.menuid") ?? q.get("menuid") ?? q.get("menuId");
  const legacyArticle = q.get("articleid") ?? q.get("articleId");

  const segments = url.pathname.split("/").filter(Boolean);
  const seg0 = firstSegment(url.pathname);
  const vanity = isReserved(seg0) ? null : seg0;

  // Legacy vanity article URL: cafe.naver.com/{cafeUrl}/{articleId}
  const numericSecond = segments[1] && /^\d+$/.test(segments[1]) ? segments[1] : null;

  if (legacyClub || legacyMenu || legacyArticle || vanity) {
    return {
      cafeId: legacyClub,
      cafeVanity: vanity,
      boardId: legacyMenu,
      articleId: legacyArticle ?? numericSecond,
      layout: "legacy"
    };
  }

  return { cafeId: null, cafeVanity: null, boardId: null, articleId: null, layout: "unknown" };
}

/** Build the canonical board (post list) URL for a given layout. */
export function buildBoardUrl(
  info: Pick<CafeUrlInfo, "cafeId" | "cafeVanity" | "boardId" | "layout">
): string | null {
  if (info.layout === "new" && info.cafeId && info.boardId) {
    return `https://cafe.naver.com/f-e/cafes/${info.cafeId}/menus/${info.boardId}`;
  }
  if (info.cafeId && info.boardId) {
    return `https://cafe.naver.com/ArticleList.nhn?search.clubid=${encodeURIComponent(
      info.cafeId
    )}&search.menuid=${encodeURIComponent(info.boardId)}&search.boardtype=L`;
  }
  if (info.cafeVanity) {
    return `https://cafe.naver.com/${encodeURIComponent(info.cafeVanity)}`;
  }
  return null;
}

export function buildArticleUrl(
  info: Pick<CafeUrlInfo, "cafeId" | "cafeVanity" | "boardId" | "layout">,
  articleId: string
): string {
  if (info.layout === "new" && info.cafeId) {
    return `https://cafe.naver.com/f-e/cafes/${info.cafeId}/articles/${articleId}`;
  }
  const club = info.cafeId ?? info.cafeVanity ?? "";
  const menu = info.boardId ? `&menuid=${encodeURIComponent(info.boardId)}` : "";
  return `https://cafe.naver.com/ArticleRead.nhn?clubid=${encodeURIComponent(club)}&articleid=${encodeURIComponent(
    articleId
  )}${menu}`;
}

export function emptyContext(): CafeContext {
  return {
    cafeId: null,
    cafeName: "",
    cafeUrl: null,
    boardId: null,
    boardName: "",
    articleId: null,
    layout: "unknown"
  };
}

/**
 * Derive a best-effort context from a URL. Cafe/board display names require the
 * DOM and are filled in by the content script.
 */
export function contextFromUrl(url: string): CafeContext {
  const info = parseCafeUrl(url);
  return {
    ...emptyContext(),
    cafeId: info.cafeId,
    boardId: info.boardId,
    articleId: info.articleId,
    layout: info.layout,
    cafeUrl: info.cafeVanity ? `https://cafe.naver.com/${info.cafeVanity}` : null
  };
}

import type { AccessCode, AccessState } from "../../../shared/schema";
import { ACCESS_MESSAGES } from "../../../shared/schema";
import type { RawComment, RawMember, RawPost } from "../lib/normalize";

/**
 * Source adapters for Naver Cafe.
 *
 * Naver renders two layouts (legacy `ArticleList.nhn` inside the `cafe_main`
 * iframe, and the newer `/f-e/cafes/...` route) with no stable public contract.
 * These adapters parse whichever DOM/JSON is present and are intentionally
 * defensive: unknown fields are omitted, never guessed. Exact selectors and any
 * internal JSON endpoint must be confirmed with the live access spike
 * (docs/naver-access.md) and treated as replaceable.
 */

export type ParsedPage<T> = {
  items: T[];
  total: number | null;
  hasNext: boolean;
  nextCursor: string | null;
};

function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function textOf(root: ParentNode, selectors: string[]): string {
  for (const selector of selectors) {
    const el = root.querySelector(selector);
    if (el) {
      const text = cleanText(el.textContent);
      if (text) return text;
    }
  }
  return "";
}

function numberFrom(root: ParentNode, selectors: string[]): number | null {
  const raw = textOf(root, selectors).replace(/[^\d]/g, "");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function absolutize(href: string, baseUrl: string): string {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

export function extractPostId(href: string): string | null {
  try {
    const url = new URL(href, "https://cafe.naver.com");
    const legacy = url.searchParams.get("articleid") ?? url.searchParams.get("articleId");
    if (legacy) return legacy;
    const m = url.pathname.match(/\/articles\/(\d+)/);
    if (m) return m[1];
    const vanity = url.pathname.match(/^\/[^/]+\/(\d+)$/);
    return vanity ? vanity[1] : null;
  } catch {
    return null;
  }
}

export function extractCommentId(href: string): string | null {
  try {
    const url = new URL(href, "https://cafe.naver.com");
    return url.searchParams.get("commentid") ?? url.searchParams.get("commentId");
  } catch {
    return null;
  }
}

const POST_LINK_SELECTORS = [
  'a[href*="ArticleRead.nhn"]',
  'a[href*="/articles/"]',
  'a.article'
];

function candidateRows(doc: Document): HTMLAnchorElement[] {
  for (const selector of POST_LINK_SELECTORS) {
    const links = Array.from(doc.querySelectorAll<HTMLAnchorElement>(selector));
    if (links.length > 0) return links;
  }
  return [];
}

export function parsePostList(doc: Document, baseUrl: string): ParsedPage<RawPost> {
  const links = candidateRows(doc);
  const posts = new Map<string, RawPost>();

  for (const link of links) {
    const href = link.getAttribute("href") ?? "";
    const postId = extractPostId(href);
    if (!postId || posts.has(postId)) continue;
    const row: Element = link.closest("tr, li, article, .board-list-item, .board-list-item-wrap") ?? link;
    posts.set(postId, {
      postId,
      title: cleanText(link.textContent),
      nickname: textOf(row, [".nickname", ".name", ".txt_name", ".writer", ".p-nick", "[class*='nick']"]),
      displayedId: textOf(row, [".id", ".p-id", "[class*='user-id']"]),
      memberKey: null,
      createdAt: textOf(row, [".date", ".td_date", "time", ".type_date", "[class*='date']"]),
      viewCount: numberFrom(row, [".type_readCount", ".view", ".td_view", "[class*='view']", "[class*='count_view']"]),
      commentCount: numberFrom(row, [".cmt", ".type_commentCount", ".comment", ".td_comment", "[class*='comment']", "[class*='reply']"]),
      sourceUrl: absolutize(href, baseUrl)
    });
  }

  const nextLink = doc.querySelector<HTMLAnchorElement>(
    'a.next, a[class*="next"], .pagination a[href*="page="].on + a, .pgR'
  );
  const currentPage = currentPageFrom(doc);
  const hasNext = Boolean(nextLink) || posts.size > 0;
  return {
    items: [...posts.values()],
    total: numberFrom(doc, [".total", "[class*='total']", ".article-count"]),
    hasNext,
    nextCursor: hasNext && currentPage > 0 ? String(currentPage + 1) : null
  };
}

function currentPageFrom(doc: Document): number {
  const active = doc.querySelector("[class*='page'] .on, .pagination .on, [aria-current='page']");
  const raw = cleanText(active?.textContent).replace(/[^\d]/g, "");
  const page = Number(raw);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

export function parseArticle(doc: Document, postId: string, baseUrl: string): RawPost {
  const title =
    textOf(doc, [".article_title", ".title_text", "h3.title", "[class*='article_title']"]) ||
    cleanText(doc.title);
  const body =
    textOf(doc, [
      ".article_viewer .content",
      ".se-main-container",
      "#postContent",
      ".article_viewer",
      "[class*='article_view']",
      ".content"
    ]) || "";
  const authorBlock = doc.querySelector(".article_info, .writer_info, [class*='writer']");
  return {
    postId,
    title,
    bodyText: body,
    nickname: authorBlock ? textOf(authorBlock, [".nickname", ".name", ".txt_name", "[class*='nick']"]) : "",
    displayedId: authorBlock ? textOf(authorBlock, [".id", "[class*='id']"]) : "",
    memberKey: null,
    createdAt: textOf(doc, [".article_info .date", ".date", "time", "[class*='date']"]),
    viewCount: numberFrom(doc, [".view", "[class*='count_view']", "[class*='view']"]),
    commentCount: numberFrom(doc, [".comment", "[class*='comment']"]),
    sourceUrl: baseUrl
  };
}

export function parseComments(doc: Document, postId: string, baseUrl: string): ParsedPage<RawComment> {
  const nodes = Array.from(
    doc.querySelectorAll<HTMLElement>(
      "#commentList li, .comment_list li, ul.comment_list > li, .comment-list > li, [class*='comment_item']"
    )
  );
  const comments = new Map<string, RawComment>();
  for (const node of nodes) {
    const rawId =
      node.getAttribute("data-commentid") ??
      node.getAttribute("data-comment-id") ??
      extractCommentId(node.querySelector("a")?.getAttribute("href") ?? "") ??
      "";
    const commentId = rawId.trim();
    if (!commentId || comments.has(commentId)) continue;
    const parentId =
      node.getAttribute("data-parent-commentid") ?? node.getAttribute("data-parent-id") ?? null;
    comments.set(commentId, {
      commentId,
      postId,
      parentCommentId: parentId,
      nickname: textOf(node, [".nickname", ".name", ".txt_name", "[class*='nick']"]),
      displayedId: textOf(node, [".id", "[class*='id']"]),
      memberKey: null,
      bodyText: textOf(node, [".comment_text", ".text", ".content", "[class*='comment_text']"]),
      createdAt: textOf(node, [".date", "time", "[class*='date']"]),
      sourceUrl: baseUrl
    });
  }
  return {
    items: [...comments.values()],
    total: numberFrom(doc, [".comment_total", "[class*='comment_total']"]),
    hasNext: false,
    nextCursor: null
  };
}

export function parseMembers(doc: Document, baseUrl: string): ParsedPage<RawMember> {
  const rows = Array.from(doc.querySelectorAll<HTMLElement>("table.member_list tbody tr, .member_list li, table tbody tr"));
  const members = new Map<string, RawMember>();
  for (const row of rows) {
    const nickname = textOf(row, [".nickname", ".name", ".txt_name", "[class*='nick']"]);
    const displayedId = textOf(row, [".id", "[class*='id']"]);
    const memberKey = (row.getAttribute("data-memberkey") ?? row.getAttribute("data-user-id") ?? displayedId) || nickname;
    if (!memberKey) continue;
    members.set(memberKey, {
      memberKey,
      nickname,
      displayedId,
      grade: textOf(row, [".grade", ".level", "[class*='grade']"]) || null,
      joinedAt: textOf(row, [".join_date", ".date", "[class*='join']"]) || null,
      sourceUrl: baseUrl
    });
  }
  const nextLink = doc.querySelector<HTMLAnchorElement>(".pagination .on + a, a.next");
  return {
    items: [...members.values()],
    total: numberFrom(doc, [".total", "[class*='total']"]),
    hasNext: Boolean(nextLink) || members.size > 0,
    nextCursor: null
  };
}

/** Best-effort access classification from the rendered page. */
export function detectAccessFromDocument(doc: Document, scope: string, _loggedIn = false): AccessState {
  const text = cleanText(doc.body?.textContent ?? "").slice(0, 4000);
  const code: AccessCode = (() => {
    if (/가입\s*승인|승인\s*대기/.test(text)) return "approval_required";
    if (/등업|등급\s*이상|레벨\s*이상/.test(text)) return "grade_required";
    if (/카페\s*가입|회원\s*가입|가입이?\s*필요|멤버\s*전용|멤버만/.test(text)) return "membership_required";
    if (/로그인이?\s*필요|네이버\s*로그인|로그인\s*후/.test(text)) return "login_required";
    if (/접근할\s*수\s*없|권한이\s*없|삭제된\s*게시글|존재하지\s*않는/.test(text)) return "denied";
    return "public";
  })();
  const requiredGrade = code === "grade_required" ? extractGradeName(text) : null;
  return {
    scope,
    code,
    requiredGrade,
    httpStatus: null,
    message: requiredGrade ? `${ACCESS_MESSAGES.grade_required} (필요 등급: ${requiredGrade})` : ACCESS_MESSAGES[code]
  };
}

function extractGradeName(text: string): string | null {
  const m = text.match(/([가-힣A-Za-z0-9]+)\s*등급\s*이상/) ?? text.match(/([가-힣A-Za-z0-9]+)\s*이상/);
  return m ? m[1] : null;
}

/* ------------------------------------------------------------------ */
/* Defensive JSON parsing (internal endpoints are replaceable)         */
/* ------------------------------------------------------------------ */

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    for (const key of ["articles", "items", "list", "comments", "members", "contents", "data", "result"]) {
      if (Array.isArray(rec[key])) return rec[key] as unknown[];
    }
  }
  return [];
}

function pick(rec: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const v = rec[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

export function parsePostListJson(json: unknown, baseUrl: string): ParsedPage<RawPost> {
  const container = (json ?? {}) as Record<string, unknown>;
  const rows = asArray(json).filter((r): r is Record<string, unknown> => !!r && typeof r === "object");
  const items: RawPost[] = rows.map((rec) => {
    const postId = pick(rec, ["articleId", "articleid", "postId", "id"]);
    return {
      postId,
      title: pick(rec, ["subject", "title", "articleTitle"]),
      nickname: pick(rec, ["writerNickname", "nickname", "writerName", "memberName"]),
      displayedId: pick(rec, ["writerId", "memberId", "userId", "writerMemberId"]),
      memberKey: pick(rec, ["memberKey", "memberNo", "memberSeq"]) || null,
      createdAt: pick(rec, ["writeDate", "createdAt", "regDate", "date"]),
      viewCount: pick(rec, ["readCount", "viewCount"]) || null,
      commentCount: pick(rec, ["commentCount", "replyCount"]) || null,
      sourceUrl: postId ? `${baseUrl}#${postId}` : baseUrl
    };
  });
  const total = Number(pick(container, ["totalCount", "total", "count"])) || null;
  const page = Number(pick(container, ["page", "currentPage"])) || 1;
  const more = container["hasNext"] ?? container["more"];
  const hasNext = typeof more === "boolean" ? more : items.length > 0;
  return { items, total, hasNext, nextCursor: hasNext ? String(page + 1) : null };
}

export function parseCommentsJson(json: unknown, postId: string, baseUrl: string): ParsedPage<RawComment> {
  const rows = asArray(json).filter((r): r is Record<string, unknown> => !!r && typeof r === "object");
  const items: RawComment[] = rows.map((rec) => ({
    commentId: pick(rec, ["commentId", "id", "commentid"]),
    postId,
    parentCommentId: pick(rec, ["parentCommentId", "parentId"]) || null,
    nickname: pick(rec, ["writerNickname", "nickname", "memberName"]),
    displayedId: pick(rec, ["writerId", "memberId", "userId"]),
    memberKey: pick(rec, ["memberKey", "memberNo"]) || null,
    bodyText: pick(rec, ["content", "body", "commentContent", "text"]),
    createdAt: pick(rec, ["writeDate", "createdAt", "regDate", "date"]),
    sourceUrl: baseUrl
  }));
  const container = (json ?? {}) as Record<string, unknown>;
  const page = Number(pick(container, ["page", "currentPage"])) || 1;
  const more = container["hasNext"];
  return {
    items,
    total: Number(pick(container, ["totalCount", "total"])) || null,
    hasNext: typeof more === "boolean" ? more : items.length > 0,
    nextCursor: (typeof more === "boolean" ? more : items.length > 0) ? String(page + 1) : null
  };
}

export function parseMembersJson(json: unknown, baseUrl: string): ParsedPage<RawMember> {
  const rows = asArray(json).filter((r): r is Record<string, unknown> => !!r && typeof r === "object");
  const items: RawMember[] = rows.map((rec) => ({
    memberKey: pick(rec, ["memberKey", "memberNo", "memberId", "id"]) || pick(rec, ["nickname"]),
    nickname: pick(rec, ["nickname", "memberName"]),
    displayedId: pick(rec, ["memberId", "userId", "id"]),
    grade: pick(rec, ["grade", "level", "memberLevel"]) || null,
    joinedAt: pick(rec, ["joinDate", "joinedAt", "regDate"]) || null,
    sourceUrl: baseUrl
  }));
  const container = (json ?? {}) as Record<string, unknown>;
  const page = Number(pick(container, ["page"])) || 1;
  const more = container["hasNext"];
  return {
    items,
    total: Number(pick(container, ["totalCount", "total"])) || null,
    hasNext: typeof more === "boolean" ? more : items.length > 0,
    nextCursor: (typeof more === "boolean" ? more : items.length > 0) ? String(page + 1) : null
  };
}

/* ------------------------------------------------------------------ */
/* Verified Naver Cafe JSON APIs (live spike 2026-10-09)               */
/* ------------------------------------------------------------------ */

/**
 * Compute the next page cursor from the rendered pagination. Works for both the
 * legacy pager and the new `.btn.number` pager. `currentPage` should come from
 * the URL (`?page=N`) when available.
 */
export function detectNextPage(doc: Document, currentPage: number): string | null {
  const numbers = Array.from(doc.querySelectorAll("button, a"))
    .map((e) => Number(cleanText(e.textContent)))
    .filter((n) => Number.isInteger(n) && n > 0 && n < 100000);
  const hasNextArrow = Boolean(
    doc.querySelector(
      'button[class*="next"], a[class*="next"], [aria-label*="다음"], [class*="pagination"] [class*="next"]'
    )
  );
  const max = numbers.length ? Math.max(...numbers) : currentPage;
  if (hasNextArrow || max > currentPage) return String(currentPage + 1);
  return null;
}

export function htmlToText(html: string): string {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  return cleanText(doc.body?.textContent ?? "");
}

export type GwArticleContext = {
  cafeId: string;
  menuId: string | null;
  menuName: string;
  sourceUrl: string;
};

/** Parse `article.cafe.naver.com/gw/v4/cafes/{id}/articles/{id}`. */
export function parseArticleGw(json: unknown, ctx: GwArticleContext): RawPost | null {
  const result = (json as { result?: Record<string, unknown> })?.result;
  const article = result?.article as Record<string, unknown> | undefined;
  if (!article) return null;
  const writer = (article.writer ?? {}) as Record<string, unknown>;
  const menu = (article.menu ?? {}) as Record<string, unknown>;
  const postId = pick(article, ["id", "articleId"]);
  if (!postId) return null;
  return {
    postId,
    title: pick(article, ["subject"]),
    bodyText: htmlToText(pick(article, ["contentHtml", "content"])),
    nickname: pick(writer, ["nick", "nickname"]),
    displayedId: "",
    memberKey: pick(writer, ["memberKey"]) || null,
    createdAt:
      typeof article.writeDate === "number" ? (article.writeDate as number) : pick(article, ["writeDate"]),
    viewCount: pick(article, ["readCount"]),
    commentCount: pick(article, ["commentCount"]),
    boardId: pick(menu, ["id"]) || ctx.menuId,
    boardName: htmlToText(pick(menu, ["name"])) || ctx.menuName,
    sourceUrl: ctx.sourceUrl
  };
}

/** Parse `article.cafe.naver.com/gw/v4/cafes/{id}/articles/{id}/comments/pages/{page}`. */
export function parseCommentsGw(
  json: unknown,
  postId: string,
  sourceUrl: string,
  page: number
): ParsedPage<RawComment> {
  const result = (json as { result?: Record<string, unknown> })?.result;
  const comments = result?.comments as { items?: unknown[] } | undefined;
  const rows = Array.isArray(comments?.items) ? (comments?.items as unknown[]) : [];
  const items: RawComment[] = rows
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .filter((r) => r.isDeleted !== true)
    .map((rec) => {
      const writer = (rec.writer ?? {}) as Record<string, unknown>;
      const id = pick(rec, ["id", "commentId"]);
      const refId = pick(rec, ["refId"]);
      const isRef = rec.isRef === true || (refId && refId !== id);
      return {
        commentId: id,
        postId,
        parentCommentId: isRef ? refId : null,
        nickname: pick(writer, ["nick", "nickname"]),
        displayedId: "",
        memberKey: pick(writer, ["memberKey"]) || null,
        bodyText: pick(rec, ["content", "body"]),
        createdAt:
          typeof rec.updateDate === "number" ? (rec.updateDate as number) : pick(rec, ["updateDate", "writeDate"]),
        sourceUrl
      };
    })
    .filter((c) => c.commentId);
  const hasNext = result?.hasNext === true;
  return {
    items,
    total: Number(pick((result ?? {}) as Record<string, unknown>, ["displayCommentCount"])) || null,
    hasNext,
    nextCursor: hasNext ? String(page + 1) : null
  };
}

export function isLikelyLoginRequired(finalUrl: string, doc?: Document): boolean {
  if (/nid\.naver\.com/.test(finalUrl)) return true;
  if (doc && detectAccessFromDocument(doc, "board").code === "login_required") return true;
  return false;
}

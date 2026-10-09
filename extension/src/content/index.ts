import "../lib/webext";
import type { AccessState, Dataset } from "../../../shared/schema";
import { ACCESS_MESSAGES } from "../../../shared/schema";
import { isCafeHost, parseCafeUrl } from "../lib/cafe";
import type { CafeContext, ContentRequest, PongResponse } from "../lib/messages";
import { CollectError, type DatasetTaskResult } from "../lib/types";
import {
  detectAccessFromDocument,
  detectNextPage,
  parseArticle,
  parseArticleGw,
  parseComments,
  parseCommentsGw,
  parseMembers,
  parsePostList
} from "./adapters";
import { installCaptureHook } from "./hook";

/**
 * Content adapter for Naver Cafe, running inside the cafe page/`cafe_main`
 * frame. Verified live against `cafe.naver.com/soho` (2026-10-09):
 *  - board list: new `/f-e/cafes/{id}/menus/{menuId}` SPA, parsed from the DOM
 *    and paginated by clicking `.btn.number` (URL keeps `?page=N`);
 *  - article detail: `https://article.cafe.naver.com/gw/v4/cafes/{cafeId}/articles/{articleId}`
 *  - comments: `.../articles/{articleId}/comments/pages/{page}`.
 * Both JSON endpoints are same-site and readable with `credentials: "include"`.
 * The member-directory path is NOT verified; it stays conditional.
 */

if (isCafeHost(location.hostname)) installCaptureHook();

const ARTICLE_HOST = "https://article.cafe.naver.com";

function detectContext(): CafeContext {
  const info = parseCafeUrl(location.href);
  const cafeName =
    document.querySelector<HTMLElement>(".cafe_name, .cafe-name, [class*='cafe_name'], .cafe-name-text")?.textContent?.trim() ??
    "";
  const boardName =
    document.querySelector<HTMLElement>(".board_name, .menu_name, [class*='board_name'], [class*='menu_name']")?.textContent?.trim() ??
    document.title.split(" : ")[0]?.trim() ??
    "";
  return {
    cafeId: info.cafeId,
    cafeName,
    cafeUrl: info.cafeVanity ? `https://cafe.naver.com/${info.cafeVanity}` : null,
    boardId: info.boardId,
    boardName,
    articleId: info.articleId,
    layout: info.layout
  };
}

function broadcastProgress(taskId: string, dataset: Dataset, collected: number, total: number | null): void {
  try {
    void chrome.runtime.sendMessage({ type: "PROGRESS", taskId, dataset, collected, total }).catch(() => {});
  } catch {
    /* no listener */
  }
}

/** Same-origin documents reachable from this frame (Naver renders the board in
 *  a same-origin `cafe_main` iframe on some layouts). */
function sameOriginDocuments(): Document[] {
  const docs: Document[] = [document];
  const walk = (doc: Document, depth: number): void => {
    if (depth > 2) return;
    for (const el of Array.from(doc.querySelectorAll("iframe"))) {
      try {
        const child = (el as HTMLIFrameElement).contentDocument;
        if (child && child !== doc && !docs.includes(child)) {
          docs.push(child);
          walk(child, depth + 1);
        }
      } catch {
        /* cross-origin frame */
      }
    }
  };
  walk(document, 0);
  return docs;
}

/** The document that actually contains the article list, plus its URL. */
function boardDocument(): { doc: Document; url: string } {
  for (const doc of sameOriginDocuments()) {
    if (doc.querySelectorAll('a[href*="/articles/"]').length > 0) {
      let url = location.href;
      try {
        url = doc.defaultView?.location.href ?? url;
      } catch {
        /* keep current */
      }
      return { doc, url };
    }
  }
  return { doc: document, url: location.href };
}

function pageFromUrl(url: string): number {
  try {
    const n = Number(new URL(url).searchParams.get("page"));
    return Number.isFinite(n) && n > 0 ? n : 1;
  } catch {
    return 1;
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function waitForListChange(doc: Document, previousHref: string): Promise<void> {
  await waitFor(() => {
    const first = doc.querySelector<HTMLAnchorElement>('a[href*="/articles/"]');
    return !!first && (first.getAttribute("href") ?? "") !== previousHref;
  });
}

function clickPager(doc: Document, target: number): boolean {
  const buttons = Array.from(doc.querySelectorAll<HTMLElement>("button, a"));
  const btn = buttons.find((b) => (b.textContent ?? "").trim() === String(target));
  if (!btn) return false;
  btn.click();
  return true;
}

async function fetchGwJson(url: string): Promise<{ status: number; json: unknown }> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: "include", headers: { accept: "application/json" } });
  } catch {
    throw new CollectError("NETWORK", "네트워크 오류로 데이터를 불러오지 못했습니다.");
  }
  // Throttling / transient server errors are retryable (bounded backoff upstream).
  if (res.status === 429 || res.status >= 500) {
    throw new CollectError("NETWORK", `일시적인 오류가 발생했습니다(status ${res.status}).`);
  }
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

function accessForStatus(status: number, scope: string): AccessState {
  const code = status === 401 ? "login_required" : status === 403 ? "denied" : "unknown";
  return { scope, code, requiredGrade: null, httpStatus: status, message: ACCESS_MESSAGES[code] };
}

function articleUrl(postId: string, menuId: string | null): string {
  const info = parseCafeUrl(location.href);
  if (info.layout === "new" && info.cafeId) {
    return `https://cafe.naver.com/f-e/cafes/${info.cafeId}/articles/${postId}${menuId ? `?menuid=${menuId}` : ""}`;
  }
  const club = info.cafeId ?? "";
  const menu = menuId ? `&menuid=${menuId}` : "";
  return `https://cafe.naver.com/ArticleRead.nhn?clubid=${club}&articleid=${postId}${menu}`;
}

async function runListPosts(task: { cursor: string | null }, taskId: string): Promise<DatasetTaskResult> {
  const chosen = boardDocument();
  const info = parseCafeUrl(chosen.url);
  const isNew = info.layout === "new" || chosen.url.includes("/f-e/");
  const targetPage = Number(task.cursor ?? String(pageFromUrl(chosen.url))) || 1;
  let access = detectAccessFromDocument(chosen.doc, "posts");

  if (isNew && targetPage > 1 && access.code === "public") {
    const before = chosen.doc.querySelector<HTMLAnchorElement>('a[href*="/articles/"]')?.getAttribute("href") ?? "";
    if (clickPager(chosen.doc, targetPage)) await waitForListChange(chosen.doc, before);
    access = detectAccessFromDocument(chosen.doc, "posts");
  }

  const parsed = isNew ? parsePostList(chosen.doc, chosen.url) : await parseListLegacy();
  const nextCursor = isNew ? detectNextPage(chosen.doc, targetPage) : parsed.hasNext ? parsed.nextCursor : null;
  broadcastProgress(taskId, "posts", parsed.items.length, parsed.total);
  return {
    dataset: "posts",
    scope: "board",
    items: parsed.items as unknown as Record<string, unknown>[],
    nextCursor,
    total: parsed.total,
    access
  };
}

async function parseListLegacy(): Promise<ReturnType<typeof parsePostList>> {
  const chosen = boardDocument();
  const info = parseCafeUrl(chosen.url);
  const page = pageFromUrl(chosen.url);
  if (page > 1 && info.cafeId && info.boardId) {
    const url = `https://cafe.naver.com/ArticleList.nhn?search.clubid=${info.cafeId}&search.menuid=${info.boardId}&search.boardtype=L&page=${page}`;
    try {
      const res = await fetch(url, { credentials: "include", headers: { accept: "text/html" } });
      const doc = new DOMParser().parseFromString(await res.text(), "text/html");
      return parsePostList(doc, url);
    } catch {
      /* fall back to current document */
    }
  }
  return parsePostList(chosen.doc, chosen.url);
}

async function runDetail(task: { scope: string }, taskId: string): Promise<DatasetTaskResult> {
  const postId = task.scope.replace(/^detail:/, "");
  const info = parseCafeUrl(location.href);
  const isNew = info.layout === "new" || location.href.includes("/f-e/");

  if (isNew && info.cafeId) {
    const url = `${ARTICLE_HOST}/gw/v4/cafes/${info.cafeId}/articles/${postId}?query=&menuId=${info.boardId ?? ""}&useCafeId=true&requestFrom=A`;
    const { status, json } = await fetchGwJson(url);
    const access = status >= 400 ? accessForStatus(status, `detail:${postId}`) : detectAccessFromDocument(document, `detail:${postId}`);
    if (status >= 400 || access.code !== "public") {
      return { dataset: "posts", scope: task.scope, items: [], nextCursor: null, total: 0, access };
    }
    const item = parseArticleGw(json, {
      cafeId: info.cafeId,
      menuId: info.boardId,
      menuName: "",
      sourceUrl: articleUrl(postId, info.boardId)
    });
    if (!item) throw new CollectError("UNSUPPORTED", "게시글 본문을 해석하지 못했습니다.");
    broadcastProgress(taskId, "posts", 1, 1);
    return { dataset: "posts", scope: task.scope, items: [item as unknown as Record<string, unknown>], nextCursor: null, total: 1, access };
  }

  // Legacy: parse the article document (fetch fallback to the current page).
  let doc = document;
  let access = detectAccessFromDocument(doc, `detail:${postId}`);
  if (info.articleId !== postId || access.code !== "public") {
    try {
      const res = await fetch(articleUrl(postId, info.boardId), { credentials: "include" });
      doc = new DOMParser().parseFromString(await res.text(), "text/html");
      access = detectAccessFromDocument(doc, `detail:${postId}`);
    } catch {
      throw new CollectError("NETWORK", "게시글을 불러오지 못했습니다.");
    }
  }
  const item = parseArticle(doc, postId, articleUrl(postId, info.boardId));
  broadcastProgress(taskId, "posts", 1, 1);
  return { dataset: "posts", scope: task.scope, items: [item as unknown as Record<string, unknown>], nextCursor: null, total: 1, access };
}

async function runComments(
  task: { scope: string; cursor: string | null; maxItems: number },
  taskId: string
): Promise<DatasetTaskResult> {
  const postId = task.scope.replace(/^post:/, "");
  const info = parseCafeUrl(location.href);
  const isNew = info.layout === "new" || location.href.includes("/f-e/");
  const page = Number(task.cursor ?? "1") || 1;

  if (isNew && info.cafeId) {
    const url = `${ARTICLE_HOST}/gw/v4/cafes/${info.cafeId}/articles/${postId}/comments/pages/${page}?requestFrom=A&orderBy=asc`;
    const { status, json } = await fetchGwJson(url);
    if (status >= 400) {
      return { dataset: "comments", scope: task.scope, items: [], nextCursor: null, total: null, access: accessForStatus(status, `comments:${postId}`) };
    }
    const parsed = parseCommentsGw(json, postId, articleUrl(postId, info.boardId), page);
    const items = parsed.items.slice(0, task.maxItems);
    broadcastProgress(taskId, "comments", items.length, parsed.total);
    return {
      dataset: "comments",
      scope: task.scope,
      items: items as unknown as Record<string, unknown>[],
      nextCursor: parsed.hasNext ? parsed.nextCursor : null,
      total: parsed.total,
      access: { scope: `comments:${postId}`, code: "public", requiredGrade: null, httpStatus: status, message: ACCESS_MESSAGES.public }
    };
  }

  const parsed = parseComments(document, postId, articleUrl(postId, info.boardId));
  broadcastProgress(taskId, "comments", parsed.items.length, parsed.total);
  return {
    dataset: "comments",
    scope: task.scope,
    items: parsed.items as unknown as Record<string, unknown>[],
    nextCursor: parsed.hasNext ? parsed.nextCursor : null,
    total: parsed.total,
    access: detectAccessFromDocument(document, `comments:${postId}`)
  };
}

function runMembers(taskId: string): DatasetTaskResult {
  const access = detectAccessFromDocument(document, "directory");
  const parsed = parseMembers(document, location.href);
  const available = access.code === "public" && parsed.items.length > 0;
  broadcastProgress(taskId, "members", parsed.items.length, parsed.total);
  return {
    dataset: "members",
    scope: "directory",
    items: available ? (parsed.items as unknown as Record<string, unknown>[]) : [],
    nextCursor: null,
    total: parsed.total,
    access: available
      ? access
      : {
          ...access,
          code: "unknown",
          message: "회원 디렉터리는 접근 권한이 확인된 경우에만 지원됩니다. 현재 화면에서는 회원 목록을 확인할 수 없습니다."
        }
  };
}

function runCheckAccess(req: { scope: string }): AccessState {
  return detectAccessFromDocument(document, req.scope);
}

chrome.runtime.onMessage.addListener((req: ContentRequest, _sender, sendResponse) => {
  if (req.type === "PING") {
    const resp: PongResponse = { type: "PONG", ctx: detectContext() };
    sendResponse(resp);
    return;
  }
  if (req.type === "CHECK_ACCESS") {
    sendResponse(runCheckAccess(req));
    return;
  }
  if (req.type === "CANCEL_TASK") {
    sendResponse({ ok: true });
    return;
  }
  if (req.type === "RUN_TASK") {
    const task = req as Extract<ContentRequest, { type: "RUN_TASK" }>;
    void (async () => {
      try {
        let result: DatasetTaskResult;
        if (task.dataset === "posts" && task.scope.startsWith("detail:")) result = await runDetail(task, task.taskId);
        else if (task.dataset === "posts") result = await runListPosts(task, task.taskId);
        else if (task.dataset === "comments") result = await runComments(task, task.taskId);
        else result = runMembers(task.taskId);
        sendResponse(result);
      } catch (err) {
        const code = err instanceof CollectError ? err.code : "UNKNOWN";
        const message = err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.";
        sendResponse({ type: "TASK_ERROR", taskId: task.taskId, code, message });
      }
    })();
    return true;
  }
});

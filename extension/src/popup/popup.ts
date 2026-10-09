import "../lib/webext";
import type { AccessState } from "../../../shared/schema";
import { PRODUCT_ORIGIN, STORAGE_KEYS } from "../lib/config";
import type { CafeContext, PongResponse } from "../lib/messages";

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
};

const ctxEl = el<HTMLDivElement>("ctx");
const accessEl = el<HTMLDivElement>("access");
const openBtn = el<HTMLButtonElement>("open");
const connectBtn = el<HTMLButtonElement>("connect");

let tabId = 0;
let ctx: CafeContext | null = null;

function workspaceUrl(): string {
  const params = new URLSearchParams({
    tabId: String(tabId),
    cafeId: ctx?.cafeId ?? "",
    boardId: ctx?.boardId ?? "",
    cafeName: ctx?.cafeName ?? "",
    boardName: ctx?.boardName ?? ""
  });
  return chrome.runtime.getURL(`workspace.html?${params.toString()}`);
}

function renderAccess(state: AccessState | null): void {
  if (!state) return;
  accessEl.textContent = state.message;
  accessEl.classList.remove("hidden");
  accessEl.classList.toggle("public", state.code === "public");
}

async function init(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? 0;
  if (!tabId || !tab?.url || !/cafe\.naver\.com/.test(tab.url)) {
    ctxEl.textContent = "네이버 카페 페이지에서 실행해 주세요.";
    return;
  }
  try {
    const pong = (await chrome.tabs.sendMessage(tabId, { type: "PING" }, { frameId: 0 })) as PongResponse | undefined;
    ctx = pong?.ctx ?? null;
  } catch {
    ctxEl.textContent = "카페 페이지와 통신하지 못했습니다. 탭을 새로고침해 주세요.";
    return;
  }
  const cafe = ctx?.cafeName || (ctx?.cafeId ? `카페 ${ctx.cafeId}` : "카페 미감지");
  const board = ctx?.boardName || (ctx?.boardId ? `게시판 ${ctx.boardId}` : "게시판 미감지");
  ctxEl.textContent = `${cafe} · ${board}`;
  openBtn.disabled = !(ctx?.cafeId && ctx?.boardId);

  if (ctx?.cafeId && ctx?.boardId) {
    try {
      const state = (await chrome.tabs.sendMessage(
        tabId,
        { type: "CHECK_ACCESS", dataset: "posts", scope: "board" },
        { frameId: 0 }
      )) as AccessState;
      renderAccess(state);
    } catch {
      /* access display is best-effort */
    }
  }

  const data = await chrome.storage.local.get(STORAGE_KEYS.auth);
  const auth = data[STORAGE_KEYS.auth] as { token?: string } | undefined;
  if (auth?.token) connectBtn.textContent = "계정 관리 / 구독";
}

openBtn.addEventListener("click", () => {
  if (!tabId) return;
  void chrome.tabs.create({ url: workspaceUrl() });
  window.close();
});

connectBtn.addEventListener("click", () => {
  void chrome.tabs.create({ url: `${PRODUCT_ORIGIN}/login` });
});

void init();

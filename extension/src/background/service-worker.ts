import "../lib/webext";
import { captureHookMainWorld } from "../content/hook";
import type { OpenWorkspaceRequest } from "../lib/messages";

/**
 * MV3 service worker: event-driven only. It does not run the crawler (the open
 * workspace tab owns the collection loop). Responsibilities:
 *  - inject the MAIN-world capture hook into verified Cafe frames;
 *  - open the export workspace tab;
 *  - handle website → extension messages via externally_connectable.
 */

function isCafeUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "cafe.naver.com" || host === "m.cafe.naver.com";
  } catch {
    return false;
  }
}

chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
  const type = (msg as { type?: string })?.type;
  if (type === "INSTALL_HOOK") {
    const tabId = sender.tab?.id;
    const frameId = sender.frameId;
    if (tabId != null && isCafeUrl(sender.tab?.url ?? sender.origin)) {
      void chrome.scripting
        .executeScript({
          target: { tabId, ...(frameId != null ? { frameIds: [frameId] } : {}) },
          world: "MAIN",
          func: captureHookMainWorld
        })
        .catch(() => {});
    }
    return false;
  }
  if (type === "OPEN_WORKSPACE") {
    const req = msg as OpenWorkspaceRequest;
    const params = new URLSearchParams({
      tabId: String(req.tabId),
      cafeId: req.ctx.cafeId ?? "",
      boardId: req.ctx.boardId ?? "",
      cafeName: req.ctx.cafeName ?? "",
      boardName: req.ctx.boardName ?? ""
    });
    void chrome.tabs.create({ url: chrome.runtime.getURL(`workspace.html?${params.toString()}`) }).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }
  return false;
});

/** Website → extension (approved product origin only). */
chrome.runtime.onMessageExternal?.addListener((msg: unknown, _sender, sendResponse) => {
  const type = (msg as { type?: string })?.type;
  if (type === "PING") {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
  }
  return false;
});

chrome.runtime.onInstalled?.addListener(() => {
  // Reserved for future one-time setup (e.g. usage tips, default prefs).
});

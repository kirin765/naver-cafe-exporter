import "../lib/webext";
import type {
  Coverage,
  Dataset,
  Job,
  JobFilters,
  PostRecord
} from "../../../shared/schema";
import { LIMITS } from "../../../shared/schema";
import {
  getAccount,
  getCachedEntitlement,
  refreshEntitlement,
  startCheckout,
  startLink,
  redeemLink
} from "../lib/account";
import { PRODUCT_ORIGIN } from "../lib/config";
import { localPaidAccess, shouldRefresh } from "../lib/entitlement";
import { suggestedFilename } from "../lib/export";
import { createJob } from "../lib/jobs";
import { IdbStore } from "../lib/idb-store";
import type { AccountState, CafeContext, PongResponse } from "../lib/messages";
import { randomDelay, realSleep } from "../lib/collector";
import { REQUEST_DELAY_MAX_MS, REQUEST_DELAY_MIN_MS } from "../lib/config";
import { evaluateStorage, selectRetentionCandidates } from "../lib/retention";
import { requeueBlocked, runJob } from "../lib/runner";
import { TabCafeSource } from "./tab-source";

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
};

const store = new IdbStore();

const ui = {
  accountStatus: el<HTMLSpanElement>("account-status"),
  btnConnect: el<HTMLButtonElement>("btn-connect"),
  storageStatus: el<HTMLSpanElement>("storage-status"),
  ctxLabel: el<HTMLDivElement>("ctx-label"),
  accessBanner: el<HTMLDivElement>("access-banner"),
  btnRecheckContext: el<HTMLButtonElement>("btn-recheck-context"),
  dateFrom: el<HTMLInputElement>("date-from"),
  dateTo: el<HTMLInputElement>("date-to"),
  maxPosts: el<HTMLInputElement>("max-posts"),
  includeComments: el<HTMLInputElement>("include-comments"),
  includeBody: el<HTMLInputElement>("include-body"),
  includeMembers: el<HTMLInputElement>("include-members"),
  btnPreview: el<HTMLButtonElement>("btn-preview"),
  btnFull: el<HTMLButtonElement>("btn-full"),
  btnPause: el<HTMLButtonElement>("btn-pause"),
  btnCancel: el<HTMLButtonElement>("btn-cancel"),
  hint: el<HTMLDivElement>("hint"),
  error: el<HTMLElement>("error"),
  errorText: el<HTMLDivElement>("error-text"),
  errorDismiss: el<HTMLButtonElement>("error-dismiss"),
  progress: el<HTMLElement>("progress"),
  phase: el<HTMLSpanElement>("phase"),
  progressText: el<HTMLSpanElement>("progress-text"),
  barFill: el<HTMLDivElement>("bar-fill"),
  counts: el<HTMLDivElement>("counts"),
  result: el<HTMLElement>("result"),
  resultSummary: el<HTMLDivElement>("result-summary"),
  coverage: el<HTMLDivElement>("coverage"),
  previewTable: el<HTMLTableElement>("preview-table"),
  previewNote: el<HTMLParagraphElement>("preview-note"),
  btnDownload: el<HTMLButtonElement>("btn-download"),
  btnResume: el<HTMLButtonElement>("btn-resume"),
  btnDelete: el<HTMLButtonElement>("btn-delete"),
  jobsList: el<HTMLUListElement>("jobs-list"),
  jobsEmpty: el<HTMLParagraphElement>("jobs-empty")
};

const params = new URLSearchParams(location.search);
let tabId = Number(params.get("tabId") ?? "0");
let ctx: CafeContext = {
  cafeId: params.get("cafeId") || null,
  cafeName: params.get("cafeName") || "",
  cafeUrl: null,
  boardId: params.get("boardId") || null,
  boardName: params.get("boardName") || "",
  articleId: null,
  layout: "unknown"
};

let currentJob: Job | null = null;
let running = false;
let cancelRequested = false;
let pauseRequested = false;
let account: AccountState = { connected: false, email: null, token: null, tokenExpiresAt: null };

const STATUS_LABELS: Record<Job["status"], string> = {
  queued: "대기",
  running: "수집 중",
  paused: "일시정지",
  completed: "완료",
  partial: "일부만 완료",
  failed: "실패",
  cancelled: "취소됨"
};

const PHASE_LABELS: Record<string, string> = {
  detect: "카페 확인",
  posts: "게시글 수집",
  post_detail: "본문 수집",
  comments: "댓글 수집",
  members: "회원 수집",
  authors: "작성자 정리",
  finalize: "마무리",
  idle: "준비"
};

function showError(message: string): void {
  ui.errorText.textContent = message;
  ui.error.classList.remove("hidden");
}

function setBusy(busy: boolean): void {
  running = busy;
  ui.btnPreview.disabled = busy;
  ui.btnFull.disabled = busy;
  ui.btnPause.classList.toggle("hidden", !busy);
  ui.btnCancel.classList.toggle("hidden", !busy);
  ui.btnConnect.disabled = busy;
}

function kstIso(date: string, endOfDay = false): string | null {
  if (!date) return null;
  const suffix = endOfDay ? "23:59:59" : "00:00:00";
  const parsed = new Date(`${date}T${suffix}+09:00`);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function buildFilters(): JobFilters {
  return {
    cafeId: ctx.cafeId ?? "",
    boardId: ctx.boardId ?? "",
    boardName: ctx.boardName,
    dateFrom: kstIso(ui.dateFrom.value),
    dateTo: kstIso(ui.dateTo.value, true),
    maxPosts: Math.max(1, Math.min(LIMITS.maxPosts, Number(ui.maxPosts.value) || 500)),
    includeComments: ui.includeComments.checked,
    includeBody: ui.includeBody.checked,
    includeMembers: ui.includeMembers.checked
  };
}

async function refreshContext(): Promise<void> {
  if (!tabId) {
    renderContext();
    return;
  }
  try {
    const pong = (await chrome.tabs.sendMessage(tabId, { type: "PING" }, { frameId: 0 })) as PongResponse | undefined;
    const p = pong?.ctx;
    if (p) {
      // Merge only non-empty fields: with all_frames injection the first reply
      // may come from an unrelated frame, and must not wipe the URL context.
      ctx = {
        cafeId: p.cafeId ?? ctx.cafeId,
        boardId: p.boardId ?? ctx.boardId,
        articleId: p.articleId ?? ctx.articleId,
        cafeName: p.cafeName || ctx.cafeName,
        boardName: p.boardName || ctx.boardName,
        cafeUrl: p.cafeUrl ?? ctx.cafeUrl,
        layout: p.layout !== "unknown" ? p.layout : ctx.layout
      };
    }
  } catch {
    ui.accessBanner.textContent = "카페 탭과 통신하지 못했습니다. 탭을 새로고침해 주세요.";
    ui.accessBanner.classList.remove("hidden");
  }
  renderContext();
}

function renderContext(): void {
  const cafe = ctx.cafeName || (ctx.cafeId ? `카페 ${ctx.cafeId}` : "카페 미감지");
  const board = ctx.boardName || (ctx.boardId ? `게시판 ${ctx.boardId}` : "게시판 미감지");
  ui.ctxLabel.textContent = `${cafe} · ${board}`;
  const ready = Boolean(ctx.cafeId && ctx.boardId);
  ui.btnPreview.disabled = !ready || running;
  ui.btnFull.disabled = !ready || running;
  if (!ready) {
    ui.accessBanner.textContent = "게시판(게시글 목록) 화면에서 실행해 주세요.";
    ui.accessBanner.classList.remove("hidden", "public");
  }
}

async function refreshAccount(): Promise<void> {
  account = await getAccount();
  ui.accountStatus.textContent = account.connected ? account.email ?? "계정 연결됨" : "무료(미연결)";
  ui.btnConnect.textContent = account.connected ? "계정 관리" : "계정 연결";
  let cache = await getCachedEntitlement();
  if (account.connected && shouldRefresh(cache)) {
    cache = await refreshEntitlement();
  }
  const access = localPaidAccess(cache, Date.now());
  if (access.plan === "paid") {
    ui.accountStatus.textContent = `${account.email ?? "유료"} · 유료 이용 중`;
  }
}

async function updateStorage(): Promise<void> {
  let usage: number | null = null;
  let quota: number | null = null;
  let persisted = false;
  try {
    persisted = (await navigator.storage.persisted?.()) ?? false;
    const estimate = await navigator.storage.estimate?.();
    usage = estimate?.usage ?? null;
    quota = estimate?.quota ?? null;
  } catch {
    /* estimates are advisory */
  }
  const decision = evaluateStorage({ usage, quota, persisted });
  ui.storageStatus.textContent = decision.level === "unknown" ? "" : decision.message;
  return decision.ok ? undefined : showError(decision.message);
}

async function cleanupRetention(): Promise<void> {
  const jobs = await store.listJobs();
  const candidates = selectRetentionCandidates(jobs, Date.now());
  for (const jobId of candidates) await store.deleteJob(jobId);
}

async function startJob(preview: boolean): Promise<void> {
  if (!ctx.cafeId || !ctx.boardId) {
    showError("게시판(게시글 목록) 화면에서 실행해 주세요.");
    return;
  }
  if (!preview) {
    const cache = await getCachedEntitlement();
    const access = localPaidAccess(cache, Date.now());
    if (!access.active) {
      showError("전체 수집은 유료 이용이 필요합니다. 계정을 연결하고 ₩4,900 구독을 시작해 주세요.");
      return;
    }
  }
  let persistedNote = "";
  try {
    const granted = (await navigator.storage.persist?.()) ?? false;
    persistedNote = granted ? "" : "브라우저가 저장 공간을 보장하지 않아 결과를 내려받아 보관하는 것을 권장합니다.";
  } catch {
    /* ignore */
  }

  const job = createJob(buildFilters(), preview, Date.now());
  await store.createJob(job);
  ui.progress.classList.remove("hidden");
  ui.result.classList.add("hidden");
  ui.error.classList.add("hidden");
  ui.hint.textContent = persistedNote;
  await runCurrent(job.jobId);
}

async function runCurrent(jobId: string): Promise<void> {
  const job = await store.getJob(jobId);
  if (!job) return;
  currentJob = job;
  setBusy(true);
  cancelRequested = false;
  pauseRequested = false;
  ui.phase.textContent = PHASE_LABELS[job.phase] ?? job.phase;
  ui.progressText.textContent = "시작 중…";

  const source = new TabCafeSource(tabId);
  try {
    const done = await runJob(jobId, {
      store,
      source,
      sleep: realSleep,
      delayMs: randomDelay(REQUEST_DELAY_MIN_MS, REQUEST_DELAY_MAX_MS),
      now: () => Date.now(),
      onEvent: (event) => {
        if (event.type === "phase") ui.phase.textContent = PHASE_LABELS[event.phase] ?? event.phase;
        if (event.type === "progress") {
          ui.progressText.textContent = `${event.dataset} ${event.collected.toLocaleString()}개`;
          if (event.total) {
            ui.barFill.style.width = `${Math.min(100, Math.round((event.collected / event.total) * 100))}%`;
          }
        }
      },
      shouldCancel: () => cancelRequested,
      shouldPause: () => pauseRequested
    });
    currentJob = done;
    await renderResult(done);
  } catch (err) {
    showError(err instanceof Error ? err.message : "수집 중 오류가 발생했습니다.");
  } finally {
    setBusy(false);
    await refreshJobs();
    await cleanupRetention();
  }
}

async function renderResult(job: Job): Promise<void> {
  ui.result.classList.remove("hidden");
  ui.resultSummary.textContent = `${STATUS_LABELS[job.status]} · 게시글 ${job.counters.committed.posts.toLocaleString()} · 댓글 ${job.counters.committed.comments.toLocaleString()} · 작성자 ${job.coverage.authors.collected.toLocaleString()}${job.preview ? " (미리보기)" : ""}`;
  renderCoverage(job.coverage, job);
  await renderPreview(job);

  const resumable = job.status === "paused" || job.status === "failed" || (job.status === "partial" && job.counters.deferred > 0);
  ui.btnResume.classList.toggle("hidden", !resumable);
  ui.btnResume.textContent = job.counters.deferred > 0 ? "접근 권한 다시 확인 후 재수집" : "이어서 수집";
}

function renderCoverage(coverage: Coverage, job: Job): void {
  ui.coverage.innerHTML = "";
  const labels: Record<Dataset, string> = { posts: "게시글", comments: "댓글", members: "회원", authors: "작성자" };
  for (const dataset of ["posts", "comments", "members", "authors"] as Dataset[]) {
    const c = coverage[dataset];
    if (!c.requested && dataset !== "authors") continue;
    const chip = document.createElement("span");
    chip.className = `chip${c.deferred > 0 || c.skipped > 0 ? " warn" : ""}`;
    const extra: string[] = [];
    if (c.deferred > 0) extra.push(`보류 ${c.deferred}`);
    if (c.skipped > 0) extra.push(`제외 ${c.skipped}`);
    if (!c.available) extra.push("접근 제한");
    chip.textContent = `${labels[dataset]} ${c.collected.toLocaleString()}${extra.length ? ` (${extra.join(", ")})` : ""}`;
    ui.coverage.appendChild(chip);
  }
  if (job.lastError) ui.previewNote.textContent = `참고: ${job.lastError}`;
}

async function renderPreview(job: Job): Promise<void> {
  const head = ui.previewTable.querySelector("thead") as HTMLTableSectionElement;
  const body = ui.previewTable.querySelector("tbody") as HTMLTableSectionElement;
  head.innerHTML = "";
  body.innerHTML = "";
  const posts = await store.getRecords(job.jobId, "posts");
  const columns = ["post_id", "title", "nickname", "created_at"];
  const headerRow = document.createElement("tr");
  for (const c of columns) {
    const th = document.createElement("th");
    th.textContent = c;
    headerRow.appendChild(th);
  }
  head.appendChild(headerRow);
  for (const post of posts.slice(0, 20) as PostRecord[]) {
    const tr = document.createElement("tr");
    for (const value of [post.postId, post.title, post.nickname, post.createdAt ?? ""]) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
  ui.previewNote.textContent = posts.length > 20 ? `상위 20개만 표시합니다. 전체 ${posts.length.toLocaleString()}개는 엑셀에서 확인하세요.` : "";
}

async function download(job: Job): Promise<void> {
  ui.btnDownload.disabled = true;
  ui.btnDownload.textContent = "엑셀 생성 중…";
  try {
    const worker = new Worker("export-worker.js");
    const bytes = await new Promise<Uint8Array>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<{ type: string; bytes?: Uint8Array; message?: string }>) => {
        if (event.data.type === "export-done" && event.data.bytes) resolve(event.data.bytes);
        else reject(new Error(event.data.message ?? "엑셀 생성에 실패했습니다."));
      };
      worker.onerror = () => reject(new Error("엑셀 생성 중 오류가 발생했습니다."));
      worker.postMessage({ type: "export", jobId: job.jobId });
    });
    worker.terminate();
    const blob = new Blob([bytes as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = suggestedFilename(job.filters.cafeId || "cafe", new Date());
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (err) {
    showError(err instanceof Error ? err.message : "엑셀 생성에 실패했습니다.");
  } finally {
    ui.btnDownload.disabled = false;
    ui.btnDownload.textContent = "엑셀 내려받기";
  }
}

async function resumeJob(job: Job): Promise<void> {
  if (job.counters.deferred > 0) {
    const cache = await getCachedEntitlement();
    if (!job.preview && !localPaidAccess(cache, Date.now()).active) {
      showError("접근 권한 재확인 후 재수집은 유료 이용이 필요합니다.");
      return;
    }
    await requeueBlocked(store, job.jobId);
  }
  await runCurrent(job.jobId);
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function refreshJobs(): Promise<void> {
  const jobs = await store.listJobs();
  ui.jobsList.innerHTML = "";
  ui.jobsEmpty.classList.toggle("hidden", jobs.length > 0);
  for (const job of jobs.slice(0, 10)) {
    const li = document.createElement("li");
    const info = document.createElement("div");
    const title = document.createElement("div");
    title.textContent = `${job.filters.boardName || job.filters.boardId || "게시판"} · ${STATUS_LABELS[job.status]}`;
    const sub = document.createElement("div");
    sub.className = "j-sub";
    sub.textContent = `게시글 ${job.counters.committed.posts.toLocaleString()} · 댓글 ${job.counters.committed.comments.toLocaleString()} · ${fmtTime(job.updatedAt)}`;
    info.append(title, sub);

    const actions = document.createElement("div");
    actions.className = "j-actions";
    const open = document.createElement("button");
    open.className = "secondary";
    open.textContent = "열기";
    open.addEventListener("click", () => {
      currentJob = job;
      void renderResult(job);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    const del = document.createElement("button");
    del.className = "ghost";
    del.textContent = "삭제";
    del.addEventListener("click", async () => {
      await store.deleteJob(job.jobId);
      if (currentJob?.jobId === job.jobId) {
        currentJob = null;
        ui.result.classList.add("hidden");
      }
      await refreshJobs();
    });
    actions.append(open, del);
    li.append(info, actions);
    ui.jobsList.appendChild(li);
  }
}

async function onConnect(): Promise<void> {
  if (!account.connected) {
    try {
      const { verificationUrl } = await startLink();
      await chrome.tabs.create({ url: verificationUrl });
      ui.hint.textContent = "브라우저에서 계정 연결을 승인한 뒤 아래 버튼을 눌러 주세요.";
      ui.btnConnect.textContent = "승인 확인";
      account = { ...account, token: "pending" };
    } catch (err) {
      showError(err instanceof Error ? err.message : "계정 연결을 시작하지 못했습니다.");
    }
    return;
  }
  if (account.token === "pending") {
    const state = await redeemLink();
    account = state;
    if (state.connected) {
      await refreshEntitlement();
      ui.hint.textContent = "계정이 연결되었습니다.";
    }
    await refreshAccount();
    return;
  }
  const cache = await getCachedEntitlement();
  const access = localPaidAccess(cache, Date.now());
  if (access.active) {
    await chrome.tabs.create({ url: `${PRODUCT_ORIGIN}/account` });
    return;
  }
  const url = await startCheckout();
  if (url) await chrome.tabs.create({ url });
  else showError("구독 결제 페이지를 열지 못했습니다. 잠시 후 다시 시도해 주세요.");
}

ui.btnPreview.addEventListener("click", () => void startJob(true));
ui.btnFull.addEventListener("click", () => void startJob(false));
ui.btnPause.addEventListener("click", () => {
  pauseRequested = true;
  ui.hint.textContent = "일시정지 중…";
});
ui.btnCancel.addEventListener("click", () => {
  cancelRequested = true;
});
ui.btnDownload.addEventListener("click", () => {
  if (currentJob) void download(currentJob);
});
ui.btnDelete.addEventListener("click", async () => {
  if (!currentJob) return;
  await store.deleteJob(currentJob.jobId);
  currentJob = null;
  ui.result.classList.add("hidden");
  await refreshJobs();
});
ui.btnResume.addEventListener("click", () => {
  if (currentJob) void resumeJob(currentJob);
});
ui.btnRecheckContext.addEventListener("click", () => void refreshContext());
ui.btnConnect.addEventListener("click", () => void onConnect());
ui.errorDismiss.addEventListener("click", () => ui.error.classList.add("hidden"));

chrome.runtime.onMessage.addListener((msg: { type?: string; dataset?: string; collected?: number; total?: number | null }) => {
  if (msg?.type === "PROGRESS" && running) {
    ui.progressText.textContent = `${msg.dataset} ${(msg.collected ?? 0).toLocaleString()}개`;
    if (msg.total) ui.barFill.style.width = `${Math.min(100, Math.round(((msg.collected ?? 0) / msg.total) * 100))}%`;
  }
});

async function init(): Promise<void> {
  await store.ensureGeneration();
  const capsNote = `미리보기는 최대 ${LIMITS.previewPosts}개, 전체 수집은 한 번에 최대 ${LIMITS.maxPosts.toLocaleString()}개까지 가능합니다.`;
  ui.hint.textContent = capsNote;
  await refreshContext();
  await refreshAccount();
  await refreshJobs();
  await updateStorage();
}

void init();

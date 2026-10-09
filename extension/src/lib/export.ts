import type {
  AuthorRecord,
  CommentRecord,
  Coverage,
  Dataset,
  Job,
  MemberRecord,
  PostRecord,
  RecoveryRecord
} from "../../../shared/schema";
import { DATASETS, LIMITS } from "../../../shared/schema";
import { formatKst } from "./normalize";
import { buildXlsx, type SheetSpec, type SheetValue } from "./xlsx";

/** Excel's hard cell-text limit is 32,767; split well below it for safety. */
export const LONG_TEXT_LIMIT = 30000;

export type ExportInput = {
  job: Job;
  posts: PostRecord[];
  comments: CommentRecord[];
  members: MemberRecord[];
  authors: AuthorRecord[];
  coverage: Coverage;
  recovery?: RecoveryRecord[];
  sourceTotals?: Partial<Record<Dataset, number | null>>;
  now?: number;
};

export const POST_HEADERS = [
  "cafe_id",
  "board_id",
  "board_name",
  "post_id",
  "title",
  "body_text",
  "author_key",
  "nickname",
  "displayed_id",
  "id_type",
  "created_at",
  "updated_at",
  "view_count",
  "comment_count",
  "source_url"
] as const;

export const COMMENT_HEADERS = [
  "cafe_id",
  "post_id",
  "comment_id",
  "parent_comment_id",
  "author_key",
  "nickname",
  "displayed_id",
  "id_type",
  "body_text",
  "created_at",
  "source_url"
] as const;

export const MEMBER_HEADERS = [
  "cafe_id",
  "member_key",
  "nickname",
  "displayed_id",
  "id_type",
  "grade",
  "joined_at",
  "source_url"
] as const;

export const AUTHOR_HEADERS = [
  "cafe_id",
  "author_key",
  "nickname",
  "displayed_id",
  "id_type",
  "identity_status",
  "observed_post_count",
  "observed_comment_count",
  "first_observed_at",
  "last_observed_at"
] as const;

type LongTextRow = { dataset: Dataset; key: string; field: string; part: number; text: string };

function splitLongText(text: string): string[] {
  if (text.length <= LONG_TEXT_LIMIT) return [text];
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += LONG_TEXT_LIMIT) {
    parts.push(text.slice(i, i + LONG_TEXT_LIMIT));
  }
  return parts;
}

function cellForLongText(
  text: string | null,
  longRows: LongTextRow[],
  dataset: Dataset,
  key: string,
  field: string
): string {
  const value = text ?? "";
  if (value.length <= LONG_TEXT_LIMIT) return value;
  const parts = splitLongText(value);
  parts.forEach((part, idx) => {
    longRows.push({ dataset, key, field, part: idx + 1, text: part });
  });
  return parts[0];
}

function sortPosts(posts: PostRecord[]): PostRecord[] {
  return [...posts].sort(
    (a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.postId.localeCompare(b.postId)
  );
}
function sortComments(comments: CommentRecord[]): CommentRecord[] {
  return [...comments].sort(
    (a, b) =>
      a.postId.localeCompare(b.postId) ||
      (a.createdAt ?? "").localeCompare(b.createdAt ?? "") ||
      a.commentId.localeCompare(b.commentId)
  );
}
function sortMembers(members: MemberRecord[]): MemberRecord[] {
  return [...members].sort((a, b) => a.memberKey.localeCompare(b.memberKey));
}
function sortAuthors(authors: AuthorRecord[]): AuthorRecord[] {
  return [...authors].sort((a, b) => a.authorKey.localeCompare(b.authorKey));
}

/** Build the worksheet specs for a job, including the optional 긴 텍스트 sheet. */
export function buildExportSheets(input: ExportInput): { sheets: SheetSpec[]; longTextRows: LongTextRow[] } {
  const longRows: LongTextRow[] = [];
  const sheets: SheetSpec[] = [];

  const posts = sortPosts(input.posts);
  const comments = sortComments(input.comments);
  const members = sortMembers(input.members);
  const authors = sortAuthors(input.authors);

  if (input.coverage.posts.requested) {
    sheets.push({
      name: "게시글",
      headers: [...POST_HEADERS],
      numericColumns: new Set([12, 13]),
      rows: posts.map((p) => [
        p.cafeId,
        p.boardId,
        p.boardName,
        p.postId,
        p.title,
        cellForLongText(input.job.filters.includeBody ? p.bodyText : "", longRows, "posts", p.postId, "body_text"),
        p.authorKey,
        p.nickname,
        p.displayedId,
        p.idType,
        formatKst(p.createdAt),
        formatKst(p.updatedAt),
        p.viewCount,
        p.commentCount,
        p.sourceUrl
      ])
    });
  }

  if (input.coverage.comments.requested) {
    sheets.push({
      name: "댓글",
      headers: [...COMMENT_HEADERS],
      rows: comments.map((c) => [
        c.cafeId,
        c.postId,
        c.commentId,
        c.parentCommentId ?? "",
        c.authorKey,
        c.nickname,
        c.displayedId,
        c.idType,
        cellForLongText(c.bodyText, longRows, "comments", c.commentId, "body_text"),
        formatKst(c.createdAt),
        c.sourceUrl
      ])
    });
  }

  if (input.coverage.members.requested && members.length > 0) {
    sheets.push({
      name: "회원",
      headers: [...MEMBER_HEADERS],
      rows: members.map((m) => [
        m.cafeId,
        m.memberKey,
        m.nickname,
        m.displayedId,
        m.idType,
        m.grade ?? "",
        formatKst(m.joinedAt),
        m.sourceUrl
      ])
    });
  }

  if (input.coverage.authors.requested) {
    sheets.push({
      name: "작성자",
      headers: [...AUTHOR_HEADERS],
      numericColumns: new Set([6, 7]),
      rows: authors.map((a) => [
        a.cafeId,
        a.authorKey,
        a.nickname,
        a.displayedId,
        a.idType,
        a.identityStatus,
        a.observedPostCount,
        a.observedCommentCount,
        formatKst(a.firstObservedAt),
        formatKst(a.lastObservedAt)
      ])
    });
  }

  if (longRows.length > 0) {
    const sorted = [...longRows].sort(
      (a, b) =>
        a.dataset.localeCompare(b.dataset) ||
        a.key.localeCompare(b.key) ||
        a.field.localeCompare(b.field) ||
        a.part - b.part
    );
    sheets.push({
      name: "긴 텍스트",
      headers: ["dataset", "record_key", "field", "part", "text"],
      numericColumns: new Set([3]),
      rows: sorted.map((r) => [r.dataset, r.key, r.field, r.part, r.text])
    });
  }

  sheets.push(infoSheet(input));
  return { sheets, longTextRows: longRows };
}

export function buildWorkbook(input: ExportInput): Uint8Array {
  const { sheets } = buildExportSheets(input);
  return buildXlsx(sheets);
}

function infoSheet(input: ExportInput): SheetSpec {
  const { job, coverage } = input;
  const now = input.now ?? Date.now();
  const rows: SheetValue[][] = [];
  const push = (field: string, value: SheetValue): void => {
    rows.push([field, value]);
  };

  push("job_id", job.jobId);
  push("revision", job.revision);
  push("status", job.status);
  push("preview", job.preview ? "예" : "아니오");
  push("schema_version", job.schemaVersion);
  push("extension_version", job.appVersion);
  push("cafe_id", job.filters.cafeId);
  push("board_id", job.filters.boardId);
  push("board_name", job.filters.boardName);
  push("date_from", job.filters.dateFrom ?? "");
  push("date_to", job.filters.dateTo ?? "");
  push("max_posts", job.filters.maxPosts);
  push("include_comments", job.filters.includeComments ? "예" : "아니오");
  push("include_body", job.filters.includeBody ? "예" : "아니오");
  push("include_members", job.filters.includeMembers ? "예" : "아니오");
  push("observation_started", formatKst(new Date(job.observationStartedAt).toISOString()));
  push(
    "observation_ended",
    job.observationEndedAt ? formatKst(new Date(job.observationEndedAt).toISOString()) : ""
  );
  push("exported_at", formatKst(new Date(now).toISOString()));
  push("timezone", "Asia/Seoul");
  push("committed_posts", job.counters.committed.posts);
  push("committed_comments", job.counters.committed.comments);
  push("committed_members", job.counters.committed.members);
  push("deferred_items", job.counters.deferred);
  push("skipped_items", job.counters.skipped);

  for (const d of DATASETS) {
    const c = coverage[d];
    push(`${d}_requested`, c.requested ? "예" : "아니오");
    push(`${d}_available`, c.available ? "예" : "아니오");
    push(`${d}_collected`, c.collected);
    push(`${d}_deferred`, c.deferred);
    push(`${d}_skipped`, c.skipped);
    if (c.note) push(`${d}_note`, c.note);
    const sourceTotal = input.sourceTotals?.[d];
    push(`${d}_source_total`, sourceTotal == null ? "확인 불가" : sourceTotal);
  }

  push("limit_posts", LIMITS.maxPosts);
  push("limit_comments", LIMITS.maxComments);
  push("limit_members", LIMITS.maxMembers);
  push("limit_text_bytes", LIMITS.perJobTextBytes);

  for (const r of input.recovery ?? []) {
    push(`recovered_${r.dataset}_${r.scope}`, `${formatKst(new Date(r.recoveredAt).toISOString())} ${r.note}`);
  }
  if (job.lastError) push("last_error", job.lastError);

  // `=`/`+`/`-`/`@` leading characters are safe because these cells are written
  // as shared strings, never formulas.
  return { name: "내보내기 정보", headers: ["field", "value"], rows, columnWidths: [28, 60] };
}

export function suggestedFilename(cafeId: string, now = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(
    now.getMinutes()
  )}`;
  const safe = cafeId.replace(/[^0-9A-Za-z_-]/g, "_") || "cafe";
  return `naver-cafe_${safe}_${stamp}.xlsx`;
}

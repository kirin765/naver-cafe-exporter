import type {
  AuthorRecord,
  CommentRecord,
  IdType,
  MemberRecord,
  PostRecord
} from "../../../shared/schema";
import { TIMEZONE } from "./config";

export type RawAuthorRef = {
  memberKey?: string | number | null;
  loginId?: string | null;
  displayedId?: string | null;
  nickname?: string | null;
};

export type RawPost = RawAuthorRef & {
  postId: string;
  title?: string | null;
  bodyText?: string | null;
  createdAt?: string | number | null;
  updatedAt?: string | number | null;
  viewCount?: string | number | null;
  commentCount?: string | number | null;
  sourceUrl?: string | null;
  boardId?: string | null;
  boardName?: string | null;
};

export type RawComment = RawAuthorRef & {
  commentId: string;
  postId?: string | null;
  parentCommentId?: string | null;
  bodyText?: string | null;
  createdAt?: string | number | null;
  sourceUrl?: string | null;
};

export type RawMember = RawAuthorRef & {
  memberKey?: string | number | null;
  grade?: string | null;
  joinedAt?: string | number | null;
  sourceUrl?: string | null;
};

export type NormalizeContext = {
  cafeId: string;
  boardId?: string;
  boardName?: string;
};

function pickString(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

function toInt(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : null;
  const cleaned = String(v).replace(/[,\s회개]/g, "");
  if (!/^[+-]?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const KST_OFFSET = "+09:00";

/**
 * Parse a Naver-style timestamp. Naver renders local (KST) wall-clock strings
 * without a timezone, so an unambiguous KST value is normalized to ISO. Unknown
 * values stay null rather than being guessed.
 */
export function parseKoreanDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) {
    const ms = Math.abs(v) >= 1_000_000_000_000 ? v : v * 1000;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  let s = String(v).trim();
  if (!s) return null;

  // Naive relative labels cannot be resolved to an absolute instant.
  if (/방금|초 전|분 전|시간 전|일 전/.test(s)) return null;

  if (/^\d{13,}$/.test(s)) return parseKoreanDate(Number(s));
  if (/^\d{10}$/.test(s)) return parseKoreanDate(Number(s) * 1000);

  // "2026.10.09. 13:20", "2026-10-09 13:20:30", "2026/10/09" (Naver renders KST wall clock).
  const m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})\.?\s*(?:(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const [, y, mo, d, h = "0", mi = "0", se = "0"] = m;
    const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T${h.padStart(2, "0")}:${mi.padStart(
      2,
      "0"
    )}:${se.padStart(2, "0")}${KST_OFFSET}`;
    const parsed = new Date(iso);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  }

  // ISO strings with an explicit timezone are trusted as-is.
  if (/[tT]|[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    const parsed = new Date(s);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  }
  return null;
}

export type ResolvedAuthor = {
  authorKey: string;
  nickname: string;
  displayedId: string;
  idType: IdType;
  identityStatus: "resolved" | "unresolved";
};

/**
 * Resolve an observed author to a stable, cafe-scoped key. Prefer member key,
 * then login id, then a displayed (often masked) id, then nickname-only.
 * Nicknames are not unique, so nickname-only identities are explicitly marked
 * unresolved instead of being claimed as a person.
 */
export function resolveAuthor(cafeId: string, raw: RawAuthorRef): ResolvedAuthor {
  const memberKey = pickString(raw.memberKey);
  const loginId = pickString(raw.loginId);
  const displayedId = pickString(raw.displayedId);
  const nickname = pickString(raw.nickname);

  if (memberKey) {
    return {
      authorKey: `m:${cafeId}:${memberKey}`,
      nickname,
      displayedId: displayedId || loginId || memberKey,
      idType: "member_key",
      identityStatus: "resolved"
    };
  }
  if (loginId) {
    return {
      authorKey: `l:${cafeId}:${loginId}`,
      nickname,
      displayedId: displayedId || loginId,
      idType: "login_id",
      identityStatus: "resolved"
    };
  }
  if (displayedId) {
    return {
      authorKey: `d:${cafeId}:${displayedId}`,
      nickname,
      displayedId,
      idType: /[*＊]/.test(displayedId) ? "masked_id" : "display_id",
      identityStatus: "unresolved"
    };
  }
  if (nickname) {
    return {
      authorKey: `n:${cafeId}:${nickname}`,
      nickname,
      displayedId: "",
      idType: "nickname_only",
      identityStatus: "unresolved"
    };
  }
  return {
    authorKey: `x:${cafeId}:unknown`,
    nickname: "",
    displayedId: "",
    idType: "absent",
    identityStatus: "unresolved"
  };
}

export function normalizePost(raw: RawPost, ctx: NormalizeContext): PostRecord {
  const author = resolveAuthor(ctx.cafeId, raw);
  return {
    cafeId: ctx.cafeId,
    boardId: ctx.boardId ?? pickString(raw.boardId),
    boardName: ctx.boardName ?? pickString(raw.boardName),
    postId: pickString(raw.postId),
    title: pickString(raw.title),
    bodyText: pickString(raw.bodyText),
    authorKey: author.authorKey,
    nickname: author.nickname,
    displayedId: author.displayedId,
    idType: author.idType,
    createdAt: parseKoreanDate(raw.createdAt),
    updatedAt: parseKoreanDate(raw.updatedAt),
    viewCount: toInt(raw.viewCount),
    commentCount: toInt(raw.commentCount),
    sourceUrl: pickString(raw.sourceUrl)
  };
}

export function normalizeComment(raw: RawComment, ctx: NormalizeContext): CommentRecord {
  const author = resolveAuthor(ctx.cafeId, raw);
  return {
    cafeId: ctx.cafeId,
    postId: pickString((raw as { postId?: unknown }).postId),
    commentId: pickString(raw.commentId),
    parentCommentId: pickString(raw.parentCommentId) || null,
    authorKey: author.authorKey,
    nickname: author.nickname,
    displayedId: author.displayedId,
    idType: author.idType,
    bodyText: pickString(raw.bodyText),
    createdAt: parseKoreanDate(raw.createdAt),
    sourceUrl: pickString(raw.sourceUrl)
  };
}

export function normalizeMember(raw: RawMember, ctx: NormalizeContext): MemberRecord {
  const author = resolveAuthor(ctx.cafeId, raw);
  return {
    cafeId: ctx.cafeId,
    memberKey: author.authorKey,
    nickname: author.nickname,
    displayedId: author.displayedId,
    idType: author.idType,
    grade: pickString(raw.grade) || null,
    joinedAt: parseKoreanDate(raw.joinedAt),
    sourceUrl: pickString(raw.sourceUrl)
  };
}

/** Aggregate observed authors from posts and comments, preserving unresolved status. */
export function aggregateAuthors(
  posts: PostRecord[],
  comments: CommentRecord[]
): AuthorRecord[] {
  const map = new Map<string, AuthorRecord>();
  const touch = (
    ref: {
      authorKey: string;
      nickname: string;
      displayedId: string;
      idType: IdType;
      cafeId: string;
    },
    kind: "post" | "comment",
    at: string | null
  ): void => {
    let rec = map.get(ref.authorKey);
    if (!rec) {
      rec = {
        cafeId: ref.cafeId,
        authorKey: ref.authorKey,
        nickname: ref.nickname,
        displayedId: ref.displayedId,
        idType: ref.idType,
        identityStatus:
          ref.idType === "member_key" || ref.idType === "login_id" ? "resolved" : "unresolved",
        observedPostCount: 0,
        observedCommentCount: 0,
        firstObservedAt: at,
        lastObservedAt: at
      };
      map.set(ref.authorKey, rec);
    }
    if (kind === "post") rec.observedPostCount += 1;
    else rec.observedCommentCount += 1;
    if (at) {
      if (!rec.firstObservedAt || at < rec.firstObservedAt) rec.firstObservedAt = at;
      if (!rec.lastObservedAt || at > rec.lastObservedAt) rec.lastObservedAt = at;
    }
    // Fill in a better nickname/displayed id if a later observation has one.
    if (!rec.nickname && ref.nickname) rec.nickname = ref.nickname;
    if (!rec.displayedId && ref.displayedId) rec.displayedId = ref.displayedId;
  };

  for (const p of posts) touch(p, "post", p.createdAt);
  for (const c of comments) touch(c, "comment", c.createdAt);
  return [...map.values()];
}

/** Format an ISO instant for display in Asia/Seoul (used by previews and info sheet). */
export function formatKst(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

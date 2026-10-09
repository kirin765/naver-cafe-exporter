import { createHmac, timingSafeEqual } from "node:crypto";

export type PaddleSignature = {
  ts: string;
  h1: string;
};

const DEFAULT_TOLERANCE_SECONDS = 300;

function asTrimmedString(value: unknown): string | null {
  const v = String(value ?? "").trim();
  return v || null;
}

export function parsePaddleSignature(sigHeader: string | null): PaddleSignature | null {
  const header = String(sigHeader ?? "").replace(/;/g, ",");
  const parts = header
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  const ts = asTrimmedString(parts.find((p) => p.startsWith("ts="))?.slice(3));
  const h1 = asTrimmedString(parts.find((p) => p.startsWith("h1="))?.slice(3));
  if (!ts || !h1) return null;
  return { ts, h1 };
}

export function verifyPaddleSignature(
  rawBody: string,
  sigHeader: string | null,
  secret: string,
  opts: { toleranceSeconds?: number; nowMs?: number } = {}
): boolean {
  const parsed = parsePaddleSignature(sigHeader);
  if (!parsed) return false;

  const tolerance = opts.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (Number.isFinite(tolerance)) {
    const tsSeconds = Number(parsed.ts);
    if (!Number.isFinite(tsSeconds)) return false;
    const nowMs = opts.nowMs ?? Date.now();
    if (Math.abs(nowMs - tsSeconds * 1000) > tolerance * 1000) return false;
  }

  const signedPayload = `${parsed.ts}:${rawBody}`;
  const digest = createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");

  const expected = Buffer.from(digest, "utf8");
  const incoming = Buffer.from(parsed.h1, "utf8");
  if (expected.length !== incoming.length) return false;
  return timingSafeEqual(expected, incoming);
}

export function signPaddleBody(rawBody: string, secret: string, ts: number | string): string {
  const timestamp = String(ts);
  const h1 = createHmac("sha256", secret).update(`${timestamp}:${rawBody}`, "utf8").digest("hex");
  return `ts=${timestamp};h1=${h1}`;
}

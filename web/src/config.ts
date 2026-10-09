export type PaddleEnv = "sandbox" | "live";

export type Config = {
  port: number;
  host: string;
  appBaseUrl: string;
  paddleEnv: PaddleEnv;
  paddleApiKey: string;
  paddleWebhookSecret: string;
  paddlePriceId: string;
  dbPath: string;
  sessionTtlMs: number;
  linkTtlMs: number;
  entitlementTtlMs: number;
  graceMs: number;
  devLogEmail: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function readString(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = String(env[name] ?? "").trim();
  return value || fallback;
}

function readInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = String(env[name] ?? "").trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBool(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = String(env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function readPaddleEnv(env: NodeJS.ProcessEnv): PaddleEnv {
  const value = String(env.PADDLE_ENV ?? "").trim().toLowerCase();
  return value === "live" ? "live" : "sandbox";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: readInt(env, "PORT", 3001),
    host: readString(env, "HOST", "127.0.0.1"),
    appBaseUrl: readString(env, "APP_BASE_URL", "http://localhost:3001").replace(/\/$/, ""),
    paddleEnv: readPaddleEnv(env),
    paddleApiKey: String(env.PADDLE_API_KEY ?? "").trim(),
    paddleWebhookSecret: String(env.PADDLE_WEBHOOK_SECRET ?? "").trim(),
    paddlePriceId: String(env.PADDLE_PRICE_ID ?? "").trim(),
    dbPath: readString(env, "DB_PATH", ":memory:"),
    sessionTtlMs: readInt(env, "SESSION_TTL_MS", 30 * DAY_MS),
    linkTtlMs: readInt(env, "LINK_TTL_MS", 10 * 60 * 1000),
    entitlementTtlMs: readInt(env, "ENTITLEMENT_TTL_MS", DAY_MS),
    graceMs: readInt(env, "GRACE_MS", 3 * DAY_MS),
    devLogEmail: readBool(env, "DEV_LOG_EMAIL", true),
    smtpHost: String(env.SMTP_HOST ?? "").trim(),
    smtpPort: readInt(env, "SMTP_PORT", 587),
    smtpSecure: readBool(env, "SMTP_SECURE", false),
    smtpUser: String(env.SMTP_USER ?? "").trim(),
    smtpPass: String(env.SMTP_PASS ?? "").trim(),
    smtpFrom: String(env.SMTP_FROM ?? "").trim()
  };
}

export function paddleApiBase(env: PaddleEnv): string {
  return env === "live" ? "https://api.paddle.com" : "https://sandbox-api.paddle.com";
}

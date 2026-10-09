# 네이버 카페 엑셀 내보내기 — web (product website + backend)

Self-contained Node 22 TypeScript package for the product account, Paddle billing,
extension linking, and entitlement API. **Runtime uses only Node built-ins**
(`node:http`, `node:sqlite`, `node:crypto`, `node:url`). No framework, no runtime
dependencies.

## Quick start

```bash
cd web
npm install
npm run build     # esbuild -> dist/server.mjs
npm start         # node dist/server.mjs
```

Other scripts:

```bash
npm run typecheck # tsc --noEmit
npm test          # vitest run
```

Default server: `http://localhost:3001` (`PORT`).

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3001` | HTTP listen port |
| `APP_BASE_URL` | `http://localhost:3001` | Public base URL used in magic links / checkout redirects (production: `https://naver-cafe-exporter.onnurimun.com`) |
| `SMTP_HOST` | *(empty)* | SMTP host for magic-link email; when empty, dev-log fallback |
| `SMTP_PORT` | `587` | SMTP port (use 465 with `SMTP_SECURE=true` for Gmail) |
| `SMTP_SECURE` | `false` | `true` for implicit TLS (port 465) |
| `SMTP_USER` / `SMTP_PASS` | *(empty)* | SMTP credentials (Gmail app password) |
| `SMTP_FROM` | *(empty)* | From address |
| `PADDLE_ENV` | `sandbox` | `sandbox` or `live` |
| `PADDLE_API_KEY` | *(empty)* | Paddle server API key (server-side only) |
| `PADDLE_WEBHOOK_SECRET` | *(empty)* | Paddle webhook signing secret |
| `PADDLE_PRICE_ID` | *(empty)* | The single ₩4,900/month price id (`pri_...`) |
| `DB_PATH` | `:memory:` | SQLite file path (`:memory:` for tests/dev) |
| `SESSION_TTL_MS` | 30 days | Login + extension session lifetime |
| `LINK_TTL_MS` | 10 min | Extension link request lifetime |
| `ENTITLEMENT_TTL_MS` | 24 h | Max offline entitlement cache; never beyond paid/grace deadline |
| `GRACE_MS` | 3 days | Past-due recovery grace |
| `DEV_LOG_EMAIL` | `true` | Console-log magic links; also returns `devLink` in the JSON response |

Paddle API base is selected automatically: sandbox → `https://sandbox-api.paddle.com`,
live → `https://api.paddle.com`.

## Sandbox vs live

Keep sandbox and live keys, products, prices, and webhook destinations separate.
Set `PADDLE_ENV=sandbox` (default) with sandbox credentials for testing; switch to
`PADDLE_ENV=live` with live credentials for production. Secrets are read from the
environment and never embedded in the client bundle.

## Paddle catalog

Create one product with one monthly recurring price:

```json
{
  "unit_price": { "amount": "4900", "currency_code": "KRW" },
  "billing_cycle": { "interval": "month", "frequency": 1 },
  "tax_mode": "internal"
}
```

Set `PADDLE_PRICE_ID` to that price id. KRW is zero-decimal, so `4900` = ₩4,900.

## Webhook setup

Point a Paddle webhook destination at:

```
POST {APP_BASE_URL}/api/webhooks/paddle
```

Subscribe to `subscription.created`, `subscription.updated`, `subscription.canceled`,
`transaction.completed`, `adjustment.created`, `adjustment.updated`. Set the
destination's signing secret as `PADDLE_WEBHOOK_SECRET`.

The handler reads the raw body, verifies `Paddle-Signature` (HMAC-SHA256 over
`${ts}:${rawBody}`, 300 s replay tolerance), deduplicates by event id in
`processed_events`, reconciles subscription/transaction/adjustment state, and
persists an explicit revocation + retryable cancellation action for confirmed full
refunds / chargebacks.

## API surface

| Endpoint | Responsibility |
| --- | --- |
| `POST /api/auth/magic-link` | One-time email login link (always 200; no account enumeration) |
| `GET /auth/verify?token=` | Consume the one-time token, set `sid` cookie |
| `POST /api/extension/link/start` | Begin a short-lived account-link flow |
| `POST /api/extension/link/approve` | Approve a link request (web session) |
| `POST /api/extension/link/redeem` | Exchange approved proof for an extension session |
| `GET /api/link/status?requestId=` | Poll link request state |
| `GET /api/entitlement` | Current export permission + bounded offline token |
| `POST /api/billing/checkout` | Account-bound checkout for the server-selected price |
| `POST /api/billing/portal` | Paddle customer portal URL |
| `POST /api/webhooks/paddle` | Verify and persist billing changes |
| `GET /health` | `{ "ok": true }` |

Pages: `/`, `/login`, `/extension-connect`, `/account`, `/pricing`, `/privacy`,
`/terms`, `/refund`.

## Data handling

The backend stores only product-account email/session data, revocable extension
tokens, and Paddle customer/subscription/transaction/adjustment mappings plus a
processed-event ledger. **Collected cafe data, Naver cookies, member IDs, post
bodies, and Excel files never reach the backend.** Diagnostics are limited to
adapter version, error codes, and counts.

## Deployment

Hosting, product domain, and email delivery are deferred decisions. Run the built
`dist/server.mjs` under a process manager behind an HTTPS reverse proxy, and set
`APP_BASE_URL` to the public origin. The in-memory default `DB_PATH` is for
development/tests only; production must use a persistent file path and backups.

# Naver Cafe Exporter implementation plan

Date: 2026-10-09

Status: planning; implementation has not started.

Build **네이버 카페 엑셀 내보내기**, a browser extension that exports accessible cafe posts, comments, members, and author identifiers to Excel. Use `/home/giwan/Projects/reviewboost/extension` as the implementation reference. Sell one paid plan through Paddle at **₩4,900 per month**.

Technically, this is a **browser-based scraper with a bounded crawler**: scraping extracts structured records, while crawling follows the selected board and comment pagination. Customer-facing wording should be “네이버 카페 데이터 → 엑셀” or “네이버 카페 엑셀 내보내기.”

## 1. Product decisions

| Area | Decision |
| --- | --- |
| Primary users | Cafe operators and authorized staff who need recurring backups, activity reports, and member administration exports |
| Interface | Korean UI; extension popup for entry and a full extension tab for collection progress, preview, and downloads |
| Initial browser | Chrome Manifest V3; test the Chromium build on Edge and Whale before claiming support |
| Payment | Paddle Billing, ₩4,900/month, one recurring plan |
| Collection | Runs in the user's browser; public content works without Naver login, and restricted content uses the user's existing session and permissions |
| Data location | Extracted cafe records and generated files remain on the user's computer |
| Backend | Product account, subscription, extension authorization, and minimal operational records |
| Reference | Reuse ReviewBoost patterns selectively; ship a separate product, extension ID, account scope, and billing catalog |
| Scope of this document | Engineering and launch plan; business GO/KILL decisions remain in the existing `llm-wiki` bet ledger |

Defaults proposed below—preview limits, job limits, retention, and access grace periods—are implementation starting points. The requested extension format, Paddle integration, and ₩4,900 monthly price are fixed requirements.

## 2. What the extension exports

### Posts and comments

Select a cafe and one board, a date range, and a maximum post count. Collect accessible post metadata and optionally the post body, comments, and replies. Preserve original URLs and source IDs so exported records can be traced back to their source.

The first release supports one cafe and one active job at a time. Start with one board per job; all-board traversal can follow once individual board pagination is reliable. Date filtering uses post publication time in Asia/Seoul. “Include comments” means comments on the selected posts, including replies; it does not promise a cafe-wide feed of comments created in that date range.

### Cafe membership and grade restrictions

Naver login is optional when the selected board (게시판), posts, or comments are publicly readable. Allow anonymous collection of that content without a login prompt. When a source requires login, use the user's Naver session and verify its read access. If access requires cafe membership (가입), membership approval, or a higher member grade through 등업, the user must complete those steps in Naver Cafe before collecting that content. Buying the exporter subscription grants product features only; it does not grant cafe membership, a higher grade, or access to restricted boards.

Check source access before offering a full collection run, separately from the paid subscription check. Use the actual source response as the authority; a visible board name or readable post list does not prove access to post bodies or comments. Grade names and requirements can differ by cafe, so do not hard-code a universal level hierarchy.

| Source access state | Extension behavior |
| --- | --- |
| Publicly readable without login | Allow anonymous collection; do not require Naver login or cafe membership |
| Login required by the source | Show “이 콘텐츠를 수집하려면 네이버 로그인이 필요합니다” and let the user log in on Naver |
| Cafe membership or approval required | Show “카페 가입 또는 가입 승인이 필요합니다” when confirmed by the source |
| Higher grade required | Show “등업 후 이용 가능한 게시판입니다”; include the required grade only when exposed by the source |
| Other or unclear access denial | Show “현재 계정으로 접근할 수 없습니다” without guessing the reason |
| Read access confirmed | Allow collection within the verified scope and the product plan's limits |

For a blocked selected board, prevent collection and provide “카페에서 확인” and “접근 권한 다시 확인” actions. The user handles joining and 등업 directly in Cafe; the extension does not automate those requirements. After access changes, recheck before starting or resuming. If an individual post or comment section is restricted during a run, defer that scope in a persisted retry queue and record an access-denied reason in the export summary. If access to the entire selected board is lost, pause the job and retain committed results. Report a partial export rather than an empty or complete dataset when restrictions prevent coverage.

Evaluate access per dataset and item. A login requirement for comments or one post must not block collection of other publicly readable content. Offer collection of the accessible subset and label omitted scopes in the preview and workbook. Detect login requirements from source-confirmed behavior, not merely from the absence of a Naver session.

Provide “접근 권한 다시 확인 후 재수집” for deferred items after login, 가입, or 등업. Recheck the original scope, then retry the stored items and cursors without restarting completed work. This action requires current paid entitlement for full jobs; it never forces Naver login for public content.

### Members and author IDs

These are distinct datasets and must stay distinct in the UI and workbook:

| Dataset | Meaning | Availability |
| --- | --- | --- |
| 회원 | Entries from an accessible member directory or operator member-management screen | Conditional on actual account permissions and verified source support |
| 작성자 | Unique authors observed in the selected posts and comments | Available when those records expose an author reference |
| 아이디 | The exact identifier supplied by the source, with its type and visibility recorded | May be a member key, displayed ID, masked ID, or absent |

**Observed authors are not a complete member roster.** Nicknames are not unique identities. Do not turn an opaque member key into a claimed Naver login ID, infer email addresses from IDs, or reconstruct masked values. Deduplicate by stable, cafe-scoped identifiers when available. When identity is uncertain, preserve separate observations and mark them unresolved.

Member export remains part of the intended product. If live validation cannot establish a supported member-directory path, release posts/comments/authors first and explicitly mark directory export as unavailable; do not advertise complete “회원 DB” coverage.

### MVP features

- Current cafe/board detection and clear login/access status.
- Post metadata, optional plain-text body, comments/replies, and observed author extraction.
- Permission-dependent member-directory export after validation.
- Date range, maximum posts, include-comments, include-body, and selected-column controls.
- Progress by phase, committed record counts, deferred/skipped items, pause/resume, access recheck and retry, cancel, and partial export.
- Preview rows before downloading a multi-sheet `.xlsx` file.
- Recent local jobs, resumable checkpoints, and per-job or all-data deletion.
- Product account connection, checkout, subscription status, and billing-management link.

Defer Firefox, scheduled unattended runs, multiple concurrent cafes, cloud data sync, attachment downloads, analytics dashboards, CRM integrations, and CSV until after MVP. Do not add automated posting, messaging, or contact enrichment.

## 3. User flow and pricing

1. Install the extension and open a cafe in a browser tab. Naver login is optional for publicly readable content.
2. Click the icon. Detect the cafe, board, and available export modes. Check actual source access; allow anonymous collection where supported and explain any source-required login, 가입, or 등업 requirement before checkout.
3. Open the export workspace; choose source, filters, and columns.
4. Run a free local preview of up to 20 posts and up to 100 comments total, or 20 directory entries. Show that a preview is incomplete; no card or product account is required.
5. To run a full export, connect a product account and purchase the ₩4,900 monthly subscription on the product website.
6. Return to the workspace. Once server-side payment verification grants access, start collection.
7. Download the workbook, inspect partial/skipped counts, and optionally delete the local job.
8. Open account settings to manage billing or cancel renewal through Paddle's customer portal.

Paid access includes all supported export modes, filters, resume, and repeated exports. Do not impose a monthly row quota initially. Use disclosed per-job resource limits instead: provisionally 5,000 selected posts, 50,000 comments, or 20,000 directory entries, with a 100 MB normalized-text storage budget. A separate overall local-storage budget and browser quota checks apply across all jobs. Reaching a limit produces a partial result and an explanation, never silent truncation. Validate and adjust these limits with benchmarks before publishing them.

Proposed Korean checkout promise: **월 4,900원, 매월 자동 결제, 언제든 다음 결제 해지**. Target a tax-inclusive ₩4,900 total for Korean buyers and verify it in checkout. Subscription expiry does not block downloading retained local results; normal local retention still applies. Paid entitlement controls new collection and resumption.

## 4. Validate Naver access before building the full UI

Use an authorized test cafe containing representative posts, nested replies, and member roles. Test a logged-out session, a logged-in non-member, a member below a board's required grade, a member with sufficient grade, and an operator. Include pending membership approval where applicable. Save sanitized fixtures and findings in `docs/naver-access.md`.

- Identify cafe ID, board ID, post ID, source URLs, and the correct frame in legacy iframe and newer page layouts.
- Observe actual browser requests and rendered data for lists, details, comments, replies, and member screens. Record pagination, available fields, and permission requirements.
- Determine whether each source can be read through same-origin requests, a narrowly scoped extension request, or DOM parsing. An internal JSON endpoint is a replaceable adapter, not a stable public contract.
- Test date ordering, pinned posts, deleted/inaccessible posts, empty boards, and replies loaded separately from top-level comments.
- Verify that a readable board list can coexist with restricted post bodies/comments. Test access rechecks after joining or 등업 and job behavior after membership removal or grade reduction. Record source-confirmed denial reasons without guessing from HTTP status alone.
- Measure identifier availability for each account role. Distinguish masked IDs, member keys, and missing identifiers in fixtures.
- Test session expiry and request throttling. Stop on authentication challenges; surface the required user action.
- Verify logged-out collection of public posts and comments independently. For mixed public/restricted sources, confirm that only the restricted scope needs login and that accessible records remain exportable.
- Do not assume that ReviewBoost's request technique works unchanged on Cafe. Chrome content scripts still face cross-origin restrictions even with extension host permissions. See [Chrome network request documentation](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests).

Exit criterion: produce one verified workbook from a small live job, with counts compared against the selected source records, and an explicit support matrix for all four dataset types. Naver endpoint names and full-member coverage remain unverified until this step.

## 5. Architecture and ReviewBoost reuse

```text
Naver cafe tab / relevant frame
    ↕ narrowly scoped collection messages
Content adapter: source requests and parsing
    ↕ validated result batches
Extension workspace tab: job runner, preview, export worker
    ↔ IndexedDB: records, checkpoints, job history
    ↕ authentication and entitlement messages only
Extension service worker
    ↔ Product API and account database
         ↔ Paddle API and signed webhooks

Product website → login / checkout / billing portal
Excel worker → local .xlsx download
```

The open workspace tab owns the collection loop. The service worker handles event-driven messaging and authorization, not a long-running in-memory crawler. MV3 workers can unload when idle, so persisted checkpoints are required. See [Chrome service worker documentation](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers).

### Reuse from ReviewBoost

| Reference | Reuse or change |
| --- | --- |
| `scripts/build.mjs`, TypeScript and esbuild setup | Reuse the lightweight extension build pattern |
| `src/popup/`, `src/lib/messages.ts` | Adapt entry UI, typed commands, progress, and error responses |
| `src/content/` collection patterns | Reuse adapter boundaries and cancellation concepts; implement Cafe-specific sources |
| `src/lib/xlsx.ts` and `fflate` | Reuse OOXML/ZIP primitives and tests; replace the review-specific single-sheet schema |
| `src/lib/history.ts` | Reuse history UX; store large records in IndexedDB instead of copying them into `chrome.storage.local` |
| Background account bridge | Reuse the connection concept; implement strict origin checks and single-use authorization exchange |
| Store assets and build notes | Reuse the release workflow with new branding and permission explanations |

The inspected XLSX implementation searches shared strings with `indexOf` and creates the workbook synchronously. For this product, use a `Map` for string indexing and a Web Worker for export generation, then benchmark memory consumption. Do not copy shopping-site permissions, ReviewBoost account tokens, review schemas, or analytics upload flows.

### Proposed repository structure

```text
extension/
  public/                  manifest, popup/workspace HTML, styles, icons
  src/background/          account bridge and browser event handling
  src/content/             cafe detection, frame routing, source adapters
  src/workspace/           collection UI and job controller
  src/lib/                 schemas, normalization, persistence, export
  test/                    fixture, job recovery, and workbook tests
  scripts/                 build and package
web/                       product website, account UI, API, Paddle integration
shared/                    versioned API and entitlement schemas
fixtures/                  sanitized Naver response/DOM samples
docs/                      access findings, release checklist, support matrix
```

Use TypeScript/esbuild for the extension, following ReviewBoost. Proposed website/backend: a small Next.js application with PostgreSQL and established authentication, using email magic links initially. Choose compatible package versions when implementation begins. Use mise, respect any project runtime settings and lockfile, and avoid introducing competing lockfiles. Hosting and the product domain are deployment decisions, not requirements for the initial local collector.

## 6. Collection reliability and permissions

Model jobs as `queued → running → paused/completed/partial/failed/cancelled`; explicitly allow `paused` and retryable `partial` jobs to return to `running`. Persist a unique `jobId`, fixed source/filter configuration, schema version, current phase, per-scope cursors, committed counts, source identity, and last error. New exports always receive a new `jobId`.

- Process one source request at a time. Start with a conservative 1–2 second interval and tune from authorized testing; this is not a claimed Naver rate limit.
- Commit each batch, discovered work items, counters, and next cursor atomically in IndexedDB. Advance only after persistence succeeds. Scope every record to its job: `(jobId, cafeId, postId)`, `(jobId, cafeId, postId, commentId)`, and `(jobId, cafeId, memberKey)`. Scope author observations and aggregates to `jobId` as well.
- Store independent record copies for different jobs in MVP. A later export must not overwrite earlier job data. Resuming a job only changes that job; increment its result revision and observation window when new data is committed. An already downloaded workbook remains unchanged.
- Treat lists as changing datasets. Deduplicate across pages and record the job's observation window; do not claim a transactional snapshot.
- Maintain separate post-detail and comment cursors. Repeated cursors or pages with no new IDs trigger a partial result instead of an infinite loop.
- Respect `Retry-After` on throttling, use bounded backoff for temporary errors, and stop after a small retry budget. Do not rotate accounts or proxies.
- Distinguish a single unavailable post from a job-wide expired session. Preserve committed rows in both cases. If a session expires, recheck source access: continue publicly readable scopes and defer scopes that require authentication in the persisted retry queue, recording any coverage change.
- Pause on tab closure, navigation that removes the source, browser restart, sleep, or workspace closure. Resume explicitly after revalidating cafe and session context; detect account changes where the source exposes identity.
- Use an atomically acquired runner lease with an owner/generation token. Verify the current token before scheduling requests and inside each batch commit so a previously suspended runner cannot overwrite a replacement runner's progress. Cancellation stops scheduling new requests and safely settles any in-flight batch.
- Store large data in extension-origin IndexedDB. Use `chrome.storage.local` only for small preferences and metadata; restrict token storage from content scripts.

### Deferred work and access recovery

Persist work items separately from pagination, keyed by job, dataset, source record or scope, and phase. Include `status` (`pending`, `in_progress`, `blocked_access`, `done`, or `skipped`), source IDs/URL, next cursor, source-confirmed denial reason, last attempt time, and attempt count. Persist a blocked scope even when its records cannot yet be enumerated. Recover interrupted `in_progress` work as pending after validating runner ownership.

Advancing the board cursor must never erase unfinished post-detail or comment work. Public work continues while restricted work remains `blocked_access`. When accessible work is exhausted, use `partial` if blocked or skipped scopes remain; use `paused` when a job-wide condition prevents further work. Mark `completed` only when the requested scope has been exhausted without omissions. Keep counts for deferred, permanently skipped, and successfully collected items separate.

On “접근 권한 다시 확인 후 재수집,” revalidate the cafe, current session where required, and product-plan access: paid entitlement for full jobs, or the original free-preview limits for preview jobs. Retry eligible blocked work once per user action within the original filters and job limits; retain still-blocked items without an automatic polling loop. A confirmed deleted item becomes `skipped`. Upsert recovered records within the same job and preserve completed fields when a later response is less complete. Record recovery timestamps and extended observation coverage in the workbook. Resource limits require a narrower new job, and missing local data requires recollection; neither is an access retry.

Start with `activeTab`, `scripting`, and `storage`. Add only source-specific optional host permissions demonstrated necessary by the spike, plus the product API origin. Avoid blanket `*.naver.com`, cookies, history, and debugger permissions. Add download permissions only if the chosen implementation needs the downloads API. Frame injection must target verified Cafe frames, not arbitrary embedded pages.

Render source text as text, never executable HTML. Validate message type, payload size, origin, sender tab/frame, and allowed operation. Content/page code must not gain arbitrary fetch access or read product-account tokens.

## 7. Excel contract and local retention

| Sheet | Core columns |
| --- | --- |
| 게시글 | cafe_id, board_id/name, post_id, title, body_text if selected, author_key, nickname, displayed_id, id_type, created_at, updated_at if exposed, view/comment counts if exposed, source_url |
| 댓글 | cafe_id, post_id, comment_id, parent_comment_id, author_key, nickname, displayed_id, id_type, body_text, created_at, source_url |
| 회원 | cafe_id, member_key, nickname, displayed_id, id_type, grade/joined_at if exposed, source_url |
| 작성자 | cafe_id, author_key, nickname, displayed_id, id_type, identity_status, observed_post_count, observed_comment_count, first/last observed activity |
| 내보내기 정보 | job ID/revision, source/filter settings, observation and recovery timestamps/timezone, schema/extension version, per-dataset coverage, counts, limits reached, deferred/skipped/error summary |

Use Korean display headers with stable internal field names. Omit an unselected dataset sheet; record unavailable requested datasets in the information sheet. Source totals and counts observed in the chosen export are different fields.

- Store identifiers as text to preserve leading zeros and long IDs.
- Keep source timestamps and normalize unambiguous display values to Asia/Seoul; retain unknown timestamps as unknown.
- Encode source strings as text cells, including values beginning with `=`, `+`, `-`, or `@`. Escape XML and strip invalid control characters.
- Preserve long bodies through numbered continuation rows in an optional `긴 텍스트` sheet, linked by source record/field. Split below Excel cell-text limits and test reconstruction; never truncate silently.
- Use readable widths, frozen headers, filters, and deterministic sheet/row ordering. Export in a worker and offer cancellation before download.
- Suggested filename: `naver-cafe_{cafeId}_{YYYYMMDD-HHmm}.xlsx`.
- Default local retention for finished jobs: 7 days after finishing or 5 finished jobs, whichever removes older results first. Finished jobs include completed, cancelled, failed, and non-resumable partial results. Running, paused, and retryable partial jobs are protected from automatic cleanup and require explicit deletion. Show retention status and explain that cleanup runs when the extension next runs; browser-downloaded files are managed separately by the user.

### Local storage budget and recovery

- Request persistent storage with `navigator.storage.persist()` from the extension workspace and check the result. If unavailable or denied, allow collection with a visible best-effort retention status and encourage downloading results. Do not assume IndexedDB is protected from eviction. Chrome documents persistence and quota behavior in its [extension storage guide](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies).
- Use a provisional 500 MB overall extension-origin storage budget across job data, queues, indexes, and metadata, in addition to the 100 MB per-job normalized-text cap. Check `navigator.storage.estimate()` before starting/resuming and periodically during collection. Reserve at least 20% of the reported browser quota as headroom; the app budget and browser headroom checks both apply. Estimates are advisory, so every write must also handle quota failures.
- Clean up only finished jobs already eligible under the displayed retention policy. If space remains insufficient, pause collection and offer download/delete controls for retained jobs. Never silently delete protected work or newer results to make space. Generate workbook blobs on demand rather than retaining duplicate files in IndexedDB.
- On `QuotaExceededError`, abort the batch without advancing its cursor, preserve the last committed checkpoint, and offer partial export. Resume only after rechecking capacity. If even error metadata cannot be persisted, report the failure in the current UI and recover from the last durable checkpoint next time.
- Delete records, work queues, checkpoints, and history by `jobId` only. Stop and invalidate the runner before deleting an unfinished job, and reject stale batch writes so deleted records cannot reappear. Deleting one job must not change another job's data or counts.
- On startup, validate the database generation, per-job record counts, and checkpoints. IndexedDB is authoritative; a small history index in `chrome.storage.local` is only a mirror and may lag after a crash. Rebuild a stale mirror from valid database records rather than treating a mismatch alone as data loss. If data required by a durable checkpoint is missing, or a previously indexed job has disappeared, show “로컬 수집 데이터가 없어 다시 수집해야 합니다,” disable invalid resume, and offer recollection as a new job. Do not represent missing data as an empty successful export. If all local state is gone, history cannot be recovered from the backend; previously downloaded Excel files remain separate.

The backend must never receive collected member IDs, post bodies, comments, Naver cookies, or Excel files. Diagnostics use adapter version, error code, timings, and counts; sanitize URLs and avoid source text in logs.

## 8. Paddle billing and entitlement

### Catalog and checkout

Create one product and one monthly recurring price in sandbox first:

```json
{
  "unit_price": { "amount": "4900", "currency_code": "KRW" },
  "billing_cycle": { "interval": "month", "frequency": 1 },
  "tax_mode": "internal"
}
```

This is the relevant price configuration excerpt, not a complete API request. KRW uses zero decimal places, so `4900` means ₩4,900. Paddle currently lists a ₩980 minimum charge. See [supported currencies](https://developer.paddle.com/concepts/sell/supported-currencies/) and [price creation](https://developer.paddle.com/api-reference/prices/create-price/).

Use an approved HTTPS product website for checkout. Keep Paddle.js on that website and package all extension executable code locally, consistent with [Chrome's remote-code policy](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code?hl=en). Keep API keys and webhook secrets server-side. Separate sandbox/live keys, products, prices, and webhook destinations.

The server chooses the allowed price and associates checkout with the authenticated internal user. Do not trust a client-supplied price, email match alone, or arbitrary customer/subscription ID as proof of ownership. Make checkout creation idempotent and prevent accidental duplicate subscriptions. A success redirect displays “결제 확인 중” until verified access is available.

### Account and extension connection

Keep the product account separate from Naver login. Product sign-in is required to verify a paid subscription, but paid users can collect public content while logged out of Naver. Free previews require neither a product account nor Naver login when the source is public. The extension initiates a short-lived linking request with a random challenge. After web login, the user authorizes that request; the extension proves possession of its verifier to redeem a single-use code. Bind the exchange to the requesting installation, expire it quickly, and issue revocable, limited-scope tokens.

Expose only the exact production website origin to any external messaging bridge. Validate the sender and pending challenge, and never put reusable tokens in URLs or expose them to Cafe page scripts. Provide sign-out and session revocation. Use a maintained authentication library/provider rather than implementing password handling.

### Backend surface

| Endpoint | Responsibility |
| --- | --- |
| `POST /api/extension/link/start` | Begin a short-lived account-link flow |
| `POST /api/extension/link/redeem` | Exchange approved proof for an extension session |
| `GET /api/entitlement` | Return current export permission and its validity window |
| `POST /api/billing/checkout` | Create an account-bound checkout for the server-selected monthly price |
| `POST /api/billing/portal` | Create a portal session for the authenticated account's customer |
| `POST /api/webhooks/paddle` | Verify and persist billing changes |

Persist users, revocable extension sessions, Paddle customer mappings, subscription access fields, transaction-to-paid-period mappings, adjustment state, explicit access-revocation reasons, a unique processed-event ledger, and durable pending billing actions. Avoid storing complete payment payloads indefinitely. Back up the billing database and test restoration.

### Webhooks and access rules

Verify `Paddle-Signature` against the untouched raw request body with the official SDK before accepting an event. Persist verified events durably, deduplicate by event ID, and process with retries. See [Paddle signature verification](https://developer.paddle.com/webhooks/about/signature-verification/).

Use subscription lifecycle events, `transaction.completed`, `adjustment.created`, and `adjustment.updated` to reconcile paid access. Handle duplicate and out-of-order delivery per entity; do not let an older event overwrite newer state or discard an adjustment because a different entity has a newer event. Re-fetch the relevant subscription, transaction, and adjustments when ambiguous, and run periodic reconciliation for missed events. Paddle describes a small local access-state cache in its [provisioning guide](https://developer.paddle.com/build/subscriptions/provision-access-webhooks/).

Paddle records refunds as separate adjustments while retaining the original transaction. Some live refunds are already approved at creation, so listening only for `adjustment.updated` misses them. Persist both adjustment event types, including action, status, related transaction/subscription, amount, and covered billing period. Pending or rejected refunds do not revoke access. See [Paddle refunds](https://developer.paddle.com/build/transactions/create-transaction-adjustments/) and [adjustment events](https://developer.paddle.com/webhooks/adjustments/adjustment-updated/).

### Refunds, revocation, and future billing

Proposed MVP policy: a confirmed full refund covering the current paid period revokes that period's collection entitlement and triggers immediate cancellation of the affected subscription to stop future renewals. A confirmed chargeback also revokes the affected subscription's entitlement and triggers cancellation. Persist the revocation and pending cancellation action together; execute the Paddle cancellation through an idempotent, retryable worker and reconcile until cancellation is confirmed. Show cancellation as pending if the provider call fails, and alert operations rather than reporting that renewal has stopped. See [Paddle cancellation](https://developer.paddle.com/build/subscriptions/cancel-subscriptions/).

Calculate full-refund coverage from cumulative approved refund adjustments against the original transaction, accounting for reversals. Partial refunds and refunds of historical periods do not automatically revoke an unrelated current paid period or cancel renewal. Publish these distinctions in the refund policy. A refund pending approval does not delay a separately requested subscription cancellation.

Derive access from the paid period, subscription status, grace deadline, and persisted revocations together. A refund/chargeback revocation takes precedence over an `active` subscription or replayed `transaction.completed`; reconciliation must not erase it. Re-evaluate confirmed adjustment reversals explicitly. Do not automatically restart a canceled subscription or resume billing after a reversal; a canceled customer needs a new explicit checkout to subscribe again. Preserve historical revocations, scoped to the affected subscription and period, without blocking a separately verified new purchase.

Proposed product policy:

| Billing condition | Export access |
| --- | --- |
| Verified active paid subscription without an applicable revocation | Start/resume full jobs |
| Cancellation scheduled at period end | Continue through the paid period |
| Past due | 3-day recovery grace from the first failed renewal; show a payment-update link |
| Paused, canceled after the paid period, or grace exhausted | Preview only; retain access to local downloads |
| Confirmed full refund for current access period or chargeback | Persist revocation, stop issuing paid entitlements, and cancel the affected subscription; reconcile until cancellation is confirmed |
| Pending/rejected refund, partial refund, or historical-period refund | Apply the explicit adjustment policy; do not revoke an unrelated paid period |
| Backend temporarily unavailable | Honor a previously signed entitlement until its bounded expiry; after expiry, pause new collection and allow local export |

No paid free trial initially. Refresh entitlements at job start/resume and periodically during a run. Proposed cache lifetime is at most 24 hours and never beyond the paid/grace deadline; revocation may therefore take up to that window. Keep already collected rows when access expires. Local license checks discourage casual misuse but cannot make a locally distributed collector tamper-proof.

### Economics and launch verification

Paddle advertises standard pricing of 5% + US$0.50 per checkout and invites sellers of products under US$10 to discuss bespoke pricing. Confirm the applicable agreement for ₩4,900 subscriptions before launch; do not treat the headline rate as a confirmed contract. See [Paddle pricing](https://www.paddle.com/pricing).

Track contribution per subscriber as collected price minus included tax, actual Paddle fees, refunds/chargebacks, hosting, email, and support cost. Use actual settlement statements for KRW conversion effects. Keep the requested ₩4,900 price; the local collection architecture should keep variable infrastructure cost low. Do not introduce an annual plan or change pricing without a separate product decision.

## 9. Delivery sequence and acceptance criteria

Indicative effort for one developer: 3–5 working weeks, excluding external approvals and unexpected Naver access constraints.

| Phase | Work | Completion evidence |
| --- | --- | --- |
| 0 — Access spike, 2–3 days | Verify page/frame paths, four dataset capabilities, IDs, pagination, and first workbook | Sanitized fixtures, support matrix, live count comparison; unsupported member paths explicitly recorded |
| 1 — Collector, 4–6 days | Separate extension scaffold, Cafe adapters, filters, runner, persistence | Jobs retain independent data; access recovery revisits deferred items without duplicates or lost cursors |
| 2 — Export experience, 3–4 days | Korean workspace, previews, multi-sheet workbook, limits, retention | Excel opens without repair warnings; quota failures, missing data, and per-job deletion preserve valid results |
| 3 — Paid access, 4–6 days | Account linking, website, Paddle sandbox, webhook state, portal | Purchases grant access; adjustment events revoke correctly, cancellation retries complete, and stale events cannot restore refunded access |
| 4 — Release, 3–5 days | Browser testing, resource benchmarks, onboarding, store assets, operational checks | Reproducible package, published support matrix, approved billing setup and store listing |

Before implementation, read any newly added project `AGENTS.md`. Preserve existing environment/credential management; do not copy secrets from ReviewBoost into this repository.

### Required verification

- Fixture tests: missing/masked IDs, duplicate nicknames, Unicode, legacy/new layouts, pinned posts, empty pages, inaccessible items, nested replies, changing pagination, and schema drift.
- Recovery tests: worker restart, workspace/source tab closure, browser restart, stale cursor, storage failure, simultaneous workspace tabs, lease takeover with a late old-runner response, and account/session changes.
- Job isolation tests: export the same source twice after it changes, verify the earlier job is unchanged, delete either job, and verify the other remains intact. Resume/deletion and delayed-response races must not recreate deleted records or corrupt counters.
- Storage tests: persistence denied, low reported quota, actual quota failure despite an optimistic estimate, overall budget reached with protected jobs, eligible retention cleanup, partial/full database loss, and retained history pointing to missing data. Failed batches must not advance checkpoints.
- Access tests: anonymous public collection without a login prompt, mixed public/restricted scopes, logged-in non-member, pending approval, insufficient/sufficient grade, restricted details behind a visible list, successful recheck after 가입/등업, and access loss mid-job. Verify paid public collection without Naver login and continuation of public scopes after session expiry. A paid account must remain blocked from Naver content it cannot read; restricted scopes must appear in partial-export coverage.
- Deferred-work tests: advance board pagination past a blocked post/comment scope, restart the browser, gain access, and recover only the deferred work through the recheck action. Still-blocked items remain queued without automatic polling; completed rows and original filters remain intact, and unresolved omissions keep the result partial.
- Workbook tests: correct cross-sheet keys, text-safe identifiers and formulas, XML escaping, continuation rows, partial coverage labels, and manual opening in Excel or LibreOffice.
- Billing integration tests: raw-body signature rejection, duplicate/out-of-order events, duplicate checkout attempts, wrong-account access, delayed webhook, renewal failure, grace expiry, scheduled cancellation, and reconciliation after downtime. Cover approved-at-creation and later-approved refunds, pending/rejected/partial/historical refunds, cumulative full refunds, chargebacks/reversals, refund-before-transaction event ordering, and cancellation API failure/retry. Replayed active/completed events must not restore revoked access; a separate valid purchase must remain eligible. Add approved-at-creation fixtures because sandbox refund approval timing differs from live behavior.
- Browser smoke tests: Chrome first; test Edge and Whale independently before adding them to supported-browser claims.
- Performance tests: benchmark the provisional job caps on a documented ordinary desktop; confirm progress remains responsive, export is cancellable, and memory/storage limits produce recoverable partial results.
- Network inspection: verify that collection payloads and Naver credentials never reach the product backend or analytics.

## 10. Release boundaries and unresolved choices

Keep collection within the current user's accessible, authorized scope, consistent with this repository's stated purpose. Do not implement login/CAPTCHA bypass, access to hidden/deleted records, or mass contact-data resale. Review applicable source terms and store/payment requirements for the actual implemented behavior before commercial publication; access to a page alone is not a product-wide authorization claim.

Publish a product privacy page, terms, cancellation/refund terms, support contact, permissions explanation, and examples of the actual exported fields. Store copy must distinguish directory members from observed authors and disclose incomplete or masked identifiers. Submit the real product behavior for Paddle and browser-store review; approval is not assumed.

Remaining decisions to resolve during the relevant phases:

- Product name, domain, branding, and support address.
- Verified member-directory availability and whether it ships in the first release.
- Exact identifier fields and minimum browser versions supported by live testing.
- Hosting/authentication provider and email delivery setup.
- Applicable Paddle small-ticket fees, tax-inclusive checkout behavior, and production account/domain approval.
- Final job caps and local retention after benchmarks and beta feedback.

The first implementation task is the Naver access spike and a small local Excel export. Billing and the polished workspace follow once the source capabilities are demonstrated.

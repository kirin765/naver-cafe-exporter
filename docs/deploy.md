# 배포 정보 (VPS)

제품 웹/백엔드는 Vercel이 아니라 **apps VPS**(systemd + Cloudflare tunnel)에서 실행한다.
(웹 백엔드는 `node:sqlite`를 쓰므로 서버리스/영속 디스크가 없는 Vercel 대신 VPS를 선택.)

| 항목 | 값 |
| --- | --- |
| 공개 URL | `https://naver-cafe-exporter.onnurimun.com` |
| VPS | `49.247.192.39` (Tailscale `100.65.186.87`, root SSH 키) |
| 앱 경로 | `/opt/apps/naver-cafe-exporter` (소유 `appuser`) |
| systemd | `app-naver-cafe-exporter.service`, `127.0.0.1:3016` 바인딩 |
| 아티팩트 | `web/dist/server.mjs` (esbuild 번들, `node:sqlite`만 external) |
| DB | `/opt/apps/naver-cafe-exporter/data/app.sqlite` |
| env | `/opt/apps/naver-cafe-exporter/.env.production.local` (600, appuser) |
| tunnel | `apps-vpc` (id `be7005be-…`), hostname은 `cafe24-vps-migrate/scripts/add_public_hostname.py`로 추가 |

## 배포 절차 (코드 변경 시)

```bash
# 로컬
cd web && npm run typecheck && npm test && npm run build      # -> dist/server.mjs
O="-o BatchMode=yes -o HostKeyAlias=49.247.192.39"
scp $O dist/server.mjs root@100.65.186.87:/opt/apps/naver-cafe-exporter/server.mjs
ssh $O root@100.65.186.87 'chown appuser:appuser /opt/apps/naver-cafe-exporter/server.mjs && systemctl restart app-naver-cafe-exporter'
# 검증
ssh $O root@100.65.186.87 'curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3016/health'
curl -s -o /dev/null -w "%{http_code}\n" https://naver-cafe-exporter.onnurimun.com/health
```

새 호스트명/포트를 바꿀 때만 `add_public_hostname.py <host> <port>`를 다시 실행한다(멱등).

## env 키 (`/opt/apps/naver-cafe-exporter/.env.production.local`)

| 키 | 값/상태 |
| --- | --- |
| `HOST` / `PORT` | `127.0.0.1` / `3016` |
| `APP_BASE_URL` | `https://naver-cafe-exporter.onnurimun.com` |
| `DB_PATH` | `/opt/apps/naver-cafe-exporter/data/app.sqlite` |
| `DEV_LOG_EMAIL` | `false` (운영에서 매직링크 로그/응답 노출 금지) |
| `PADDLE_ENV` | `live` |
| `PADDLE_API_KEY` | 설정됨(서버 측 전용) |
| `PADDLE_PRICE_ID` | `pri_01m4fgdrzx382yqdq47mfh5hk2` (₩4,900/월, KRW, tax internal) |
| `PADDLE_WEBHOOK_SECRET` | 설정됨 |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | `smtp.gmail.com` / `465` / `true` |
| `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | 설정됨(Gmail 앱 비밀번호, 서버 측 전용) |

## 인증

Clerk를 쓰지 않고 **magic-link(이메일 일회용 링크)** 로 로그인한다. SMTP가 없으면
dev 폴백으로 링크를 로그/응답에 남기는데, 운영에서는 `DEV_LOG_EMAIL=false`라
로그인 메일이 실제로 발송되지 않는다. 운영은 위 SMTP 설정으로 실제 발송한다.

## 남은 작업 (사용자 입력 필요)

1. (선택) `/opt/vps-ops/inventory.json`에 앱 등록 → vps-ops 상태 점검 대상 포함.
2. (선택) Paddle 웹훅 이벤트가 실제 결제에서 오는지 확인하려면 대시보드의
   notification destination `https://naver-cafe-exporter.onnurimun.com/api/webhooks/paddle`가
   위 signing secret과 연결돼 있는지 점검.

## 주의

- `node:sqlite`는 실험 기능이라 journal에 경고가 남을 수 있다(동작에는 문제 없음).
- 서비스는 loopback(127.0.0.1:3016)에만 바인딩되며 공개는 tunnel을 통해서만 이뤄진다.
- env 파일은 `appuser:appuser` 600. 값을 회수/출력하지 않는다.

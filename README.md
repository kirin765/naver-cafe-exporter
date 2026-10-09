# naver-cafe-exporter

네이버 카페 데이터(게시글·댓글·작성자·회원)를 접근 가능한 범위에서 **엑셀(.xlsx)** 로
내보내는 Chrome MV3 익스텐션과, Paddle 구독(월 ₩4,900)을 처리하는 제품 웹/백엔드.

- 설계·정책·검증 계획: [`plan.md`](./plan.md)
- 접근성 지원 매트릭스(미검증): [`docs/naver-access.md`](./docs/naver-access.md)
- 공유 계약(레코드·API·한도): [`shared/schema.ts`](./shared/schema.ts)

> **상태:** 엔지니어링 구현 완료 + 라이브 검증 진행(익스텐션 + 웹 백엔드 + 테스트).
> 게시글/본문/댓글 경로는 `cafe.naver.com/soho`에서 **실제 응답으로 검증**했고,
> **unpacked 익스텐션을 실제 Chrome에 로드해** 미리보기→엑셀 다운로드까지 E2E 성공
> (2026-10-09, `docs/naver-access.md`). 제품 도메인은 `https://naver-cafe-exporter.onnurimun.com`
> (apps VPS + Cloudflare tunnel, 배포 절차 `docs/deploy.md`), 로그인은 이메일
> magic-link. 회원 디렉터리 경로는 확정하지 못해 비활성 상태다.

## 수집 데이터는 내 컴퓨터에만

수집 레코드와 생성 파일은 익스텐션-오리진 IndexedDB와 로컬 디스크에 저장된다.
백엔드는 계정·구독·권한만 다루며 **회원 ID, 게시글 본문, 댓글, 네이버 쿠키, 엑셀 파일을
받지 않는다.**

## 구성

```
extension/   Chrome MV3 익스텐션 (TypeScript + esbuild + vitest)
web/         제품 웹/백엔드 (Node 22 built-ins + node:sqlite, Paddle)
shared/      익스텐션·백엔드가 공유하는 버전드 계약
fixtures/    비식별화된 네이버 응답/DOM 샘플
docs/        접근성·지원 매트릭스
```

### 익스텐션

```bash
cd extension
npm install
npm run typecheck     # tsc --noEmit
npm test              # vitest run (단위 + 통합 e2e)
npm run build         # -> extension/dist (unpacked 로드)
npm run e2e:live      # 실제 soho 데이터로 러너+엑셀 파이프라인 (CDP 9222)
npm run e2e:extension # unpacked 익스텐션을 Chrome에 로드해 UI 전체 흐름 검증
npm run package:all   # Chrome/Edge/Whale + Firefox 제출용 zip
```

스토어 제출: [`extension/STORE_LISTING.md`](./extension/STORE_LISTING.md)
(Chrome, Edge, Whale, Firefox 등록정보·권한 사유·절차). 빌드 산출물은
`extension/*.zip`, 스크린샷/배너는 `extension/store-assets/`.

`chrome://extensions` → 개발자 모드 → “압축해제된 확장 프로그램을 로드”로
`extension/dist`를 선택한다. 카페 게시판을 연 뒤 아이콘 → “수집 화면 열기”.

주요 모듈:

| 경로 | 역할 |
| --- | --- |
| `src/lib/runner.ts` | 페이지 단위 수집 루프, 원자적 배치 커밋, runner lease, 재확인 |
| `src/lib/db.ts` 계열 (`idb-store.ts`, `memory-store.ts`) | IndexedDB 저장소(테스트용 in-memory 동일 인터페이스) |
| `src/lib/xlsx.ts`, `src/lib/export.ts` | Map 기반 문자열 인덱싱, 다중 시트, 긴 텍스트 분할 |
| `src/lib/access.ts`, `src/content/adapters.ts` | 접근 판정과 레거시/신규 레이아웃 파싱 |
| `src/content/index.ts` | 카페 페이지 태스크 실행(목록/본문/댓글/회원) |
| `src/workspace/workspace.ts` | 수집 UI, 미리보기, 엑셀 생성(Web Worker), 작업 이력 |

### 웹/백엔드

```bash
cd web
npm install
npm run typecheck
npm test              # Paddle 서명/빌링/링크/서버 통합 테스트
npm run build && npm start
```

엔드포인트: `POST /api/extension/link/start|redeem`, `GET /api/entitlement`,
`POST /api/billing/checkout|portal`, `POST /api/webhooks/paddle`, `GET /health`.
Paddle 가격: KRW 4,900/월(`tax_mode: internal`). 샌드박스 우선.

## 테스트 커버리지

- 익스텐션: 카페 URL/식별자 파싱, 날짜(KST) 정규화, 마스킹·중복 닉네임, 접근 판정,
  페이지네이션/재시도, 작업 상태 머신, 저장소 lease, 재확인 후 복구, 작업 격리,
  엑셀(OXML 무결성·수식 안전·긴 텍스트 재구성), 리텐션/저장공간, 오프라인 권한,
  어댑터 파싱(픽스처), 그리고 수집→저장→엑셀 end-to-end.
- 백엔드: Paddle 서명 검증/재전송 차단, 승인 시점 환불·부분/이력 환불·차지백·복원,
  중복/순서 뒤바뀜 이벤트, 취소 재시도, 유예 만료, 링크 흐름(verifier/만료/재사용),
  서버 통합(매직링크→링크→권한→체크아웃→웹훅).

## 법적 고지

네이버 카페 약관과 robots 규칙은 자동 수집을 제한한다. **소유·운영하거나 적법한
근거가 있는 카페에 한해** 사용한다. 로그인/캡차 우회, 숨김·삭제 콘텐츠 접근, 대량
연락처 재판매는 구현 범위가 아니다.

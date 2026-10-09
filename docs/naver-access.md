# 네이버 카페 접근성 검증 (Access spike) — 지원 매트릭스

> Status: **부분 검증 완료 (2026-10-09, CDP 실측)**. 게시글/본문/댓글 경로는
> `cafe.naver.com/soho`에서 실제 응답으로 확인했다. 회원 디렉터리는 관리자
> 계정(`dfmapia2`)에서 접근을 시도했으나 목록 경로를 확정하지 못했다. 회원
> 내보내기는 **미확인**이며 첫 릴리스에서 명시적으로 제외/비활성 상태다.

## 실측 검증 결과 (2026-10-09)

검증 카페: `cafe.naver.com/soho` (cafeId `10094408`), 로그인 세션 사용.
CDP(9222)로 실제 브라우저 네트워크를 관찰해 아래를 확정했다.

| 항목 | 실측 결과 | 상태 |
| --- | --- | --- |
| 게시판 목록 | `/f-e/cafes/{cafeId}/menus/{menuId}` React SPA, 목록은 **DOM 렌더**. 페이지네이션은 `.btn.number` 클릭(URL `?page=N` 유지) | ✅ 검증 |
| 게시글 본문 | `GET https://article.cafe.naver.com/gw/v4/cafes/{cafeId}/articles/{articleId}?menuId={menuId}&useCafeId=true&requestFrom=A` → `result.article` (`subject`, `contentHtml`, `writer.memberKey`, `writer.nick`, `writeDate`(epoch ms), `readCount`, `commentCount`) | ✅ 검증 |
| 댓글·답글 | `GET .../articles/{articleId}/comments/pages/{page}?requestFrom=A&orderBy=asc` → `result.comments.items` (`id`, `refId`, `isRef`, `writer.memberKey`, `writer.nick`, `content`, `updateDate`), `result.hasNext`, `result.displayCommentCount` | ✅ 검증 |
| 요청 방식 | content script에서 `fetch(..., { credentials: "include" })` (same-site, CORS 허용). 커스텀 `requestFrom` 헤더를 붙이면 preflight로 실패하므로 헤더는 `accept`만 사용 | ✅ 검증 |
| 작성자 | 게시글·댓글의 `writer.memberKey` + `nick`에서 파생 | ✅ 검증(파생) |
| 회원 디렉터리 | `ca-fe/manage/cafes/{cafeId}/members`는 200이나 SPA가 렌더되지 않음(본문 0). 레거시 `CafeMemberList.nhn` 등은 404. 접근 가능한 회원 목록 경로 미확정 | ❌ 미확인 |

라이브 파이프라인 결과(soho, 8게시글 / 댓글 30 상한): 실제 러너·정규화·엑셀
생성으로 워크북 생성 확인. `extension/scripts/e2e-live.mjs` 참고.
(실측치: 게시글 8, 댓글 131, 작성자 68 — 댓글은 게시글별 실제 총 댓글 수.)

### identifier 관측

- `writer.memberKey`는 해시 형태의 **카페 스코프 키**이며 네이버 로그인 ID가 아니다.
- 표시 ID(마스킹)나 이메일은 응답에 없으므로 추론하지 않는다. 게시글/댓글에는
  `nick`만 있고 별도 표시 ID가 없어 `id_type`은 대체로 `member_key` 또는
  `nickname_only`가 된다.

## 2차 실측 (2026-10-09): 익명 접근 · 레거시 레이아웃 · 실제 익스텐션 E2E

- **익명(쿠키 없음) 접근**: soho 게시판 HTML은 200(앱 셸)이지만
  · 게시글 본문 API `GET .../articles/{id}` → **401**
  · 댓글 API `GET .../comments/pages/1` → **403**
  즉 "목록 셸은 공개, 본문·댓글은 로그인 필요"인 혼합 스코프다. 어댑터는
  401→`login_required`, 403→`denied`로 매핑한다.
- **레거시 레이아웃**: soho·dfmapia2 모두 `ArticleList.nhn`이 서버렌더 HTML이
  아니라 새 SPA 셸(`/f-e/`)을 반환했다. 관측된 두 카페 기준으로 레거시 DOM 파서는
  실질적으로 사용되지 않는다(폴백으로만 유지). 다른 카페에서 레거시가 남아 있는지
  추가 표본이 필요하다.
- **실제 익스텐션 E2E** (`extension/scripts/e2e-extension.mjs`, unpacked 로드):
  Chrome에서 게시판 탭 → 워크스페이스 → 무료 미리보기 → export Web Worker →
  `.xlsx` 다운로드까지 실제 UI로 성공(미리보기 5게시글·100댓글·49작성자, 한도 캡 준수).
  이 과정에서 **다중 프레임 PING/메시지가 잘못된 프레임으로 전달되는 버그**를 발견해
  수정했다(최상위 프레임 타깃 + 동일출처 iframe 문서 탐색).

## 검증 대상 계정 역할

| 역할 | 확인할 것 | 상태 |
| --- | --- | --- |
| 로그아웃 | 게시판 셸 200, 본문 401/댓글 403 | 일부 실측 |
| 로그인(멤버) | 목록·본문·댓글 수집 | 실측 완료 |
| 로그인·비회원 | 목록 공개 + 본문/댓글 제한 | 미실시 |
| 가입 승인 대기 | `approval_required` 판정 | 미실시 (계정 필요) |
| 등급 부족 | `grade_required` + 필요 등급명 | 미실시 (계정 필요) |
| 운영자 | 회원 관리 화면 접근 | 시도, 미확정 |

## 지원 매트릭스

| 데이터셋 | 소스 경로 | 상태 | 비고 |
| --- | --- | --- | --- |
| 게시글 (메타) | `/f-e/.../menus/{id}` DOM | ✅ 검증 | `soho` |
| 게시글 본문 | `article.cafe.naver.com/gw/v4/.../articles/{id}` | ✅ 검증 | `contentHtml`→텍스트 |
| 댓글·답글 | `.../articles/{id}/comments/pages/{n}` | ✅ 검증 | `isRef`/`refId`로 답글 판별 |
| 작성자 | 게시글·댓글 `writer`에서 파생 | ✅ 검증(파생) | 동일성 확정 아님 |
| 회원 | 관리자 회원 목록 | ❌ 미확인 | 릴리스에서 제외/비활성 |

## 접근 상태 → 동작

`extension/src/lib/access.ts`(순수 함수)와
`extension/src/content/adapters.ts:detectAccessFromDocument`가 담당. 실제 응답을 권위로 삼는다.

| 판정 | 사용자 문구 | 동작 |
| --- | --- | --- |
| `public` | 공개 콘텐츠 안내 | 익명 수집 허용 |
| `login_required` | 이 콘텐츠를 수집하려면 네이버 로그인이 필요합니다 | 네이버 로그인, 공개 스코프 계속 수집 |
| `membership_required` | 카페 가입 또는 가입 승인이 필요합니다 | 카페에서 가입 후 재확인 |
| `approval_required` | 카페 가입 승인 대기 중입니다 | 승인 후 재확인 |
| `grade_required` | 등업 후 이용 가능한 게시판입니다 | 응답이 노출한 등급명만 표시 |
| `denied` | 현재 계정으로 접근할 수 없습니다 | 이유 추정 금지 |
| `unknown` | 현재 계정으로 접근할 수 없습니다 | 추정 금지 |

## 재확인·재수집

- `수집 화면 → 접근 권한 다시 확인`: `requeueBlocked()`가 `blocked_access` 작업을
  `pending`으로 되돌리고 원래 필터·커서·완료 데이터를 유지한 채 재시도한다.
- 자동 폴링 없음. 사용자가 한 번 누를 때 한 번만 재시도.
- 게시판 전체 접근이 사라지면 `paused`로 멈추고 커밋 결과 보존, 일부만 막히면
  `partial`로 내보내고 `내보내기 정보` 시트에 보류/제외 건수 기록.

## 남은 검증 (릴리스 전)

1. 로그아웃/비회원/승인대기/등급부족 역할별 실제 판정과 혼합 스코프 동작.
2. 회원 디렉터리 경로 확정(가능할 때만 기능 노출).
3. 레거시 레이아웃(`ArticleList.nhn`이 실제 HTML을 반환하는 카페) 파서 검증.
4. 세션 만료·요청 제한(429) 시 동작과 `Retry-After` 처리.
5. 삭제/비공개 글, 빈 게시판, 고정글, 댓글 페이지네이션 경계.

## 현재 파서가 사용하는 셀렉터/엔드포인트

- 목록: `a[href*="/articles/"]`, 행에서 `.nickname`, `.type_date`, `.type_readCount`,
  `.cmt`(댓글수), `.list`계열. 페이지네이션 `.btn.number` / next 화살표.
- 본문/댓글: 위 GW JSON 엔드포인트(검증됨).
- 레거시 폴백: `ArticleList.nhn`/`ArticleRead.nhn` DOM 파싱.
- 회원: `table.member_list tbody tr` + `data-memberkey` (미검증).

이 값들은 **교체 가능한 어댑터**이며 라이브 변화 시 수정한다.

# 스토어 제출 패키지 — 네이버 카페 엑셀 내보내기

업로드 아티팩트(manifest가 ZIP 루트):

| 스토어 | 파일 |
| --- | --- |
| Chrome Web Store | `naver-cafe-exporter-v0.1.0.zip` |
| Microsoft Edge | `naver-cafe-exporter-v0.1.0-edge.zip` |
| Naver Whale | `naver-cafe-exporter-v0.1.0-whale.zip` |
| Firefox (AMO) | `naver-cafe-exporter-firefox-v0.1.0.zip` |

Chrome/Edge/Whale은 동일 MV3 빌드를 공유한다(이름만 다름). Firefox는 `manifest.firefox.json`
(background scripts + `browser_specific_settings.gecko`) 빌드다.

빌드/패키징: `npm run package:all` (= `build:all` + `package.mjs` + `package-firefox.mjs`).

**Chrome Web Store 제출 계정: `happylife2080100@gmail.com`** (ReviewBoost와 동일 계정).

## 제출 전 필수 선행 작업

1. **공개 URL 살아있어야 함** (심사관이 확인):
   - 개인정보처리방침: `https://naver-cafe-exporter.onnurimun.com/privacy` (200)
   - 이용약관/환불: `/terms`, `/refund` (200)
   - 홈페이지/지원: `https://naver-cafe-exporter.onnurimun.com/`
2. **스크린샷**: `store-assets/screenshot-1-workspace.png`(640×400) 사용. 필요 시 추가 캡처.
3. (선택) 프로모 이미지: `store-assets/marquee-1400x560.png`, `store-assets/promo-tile-440x280.png`.
4. Chrome 개발자 등록(미등록 시 1회 $5). Edge/Firefox/Whale은 각 스토어 계정 필요.

---

## 스토어 등록정보 (복사용)

**항목 이름 (Chrome 75자 이내)**
```
네이버 카페 엑셀 내보내기 — 게시글·댓글·작성자 데이터 저장
```

**요약 / 짧은 설명 (132자 이내)**
```
접근 가능한 네이버 카페 게시글·댓글·작성자(권한 시 회원)를 엑셀(.xlsx)로 저장합니다. 수집 데이터는 내 컴퓨터에만 남습니다. 무료 미리보기 제공.
```

**자세한 설명**
```
네이버 카페의 접근 가능한 데이터를 엑셀(.xlsx) 파일로 정리해 주는 도구입니다. 재방문 점검, 활동 리포트, 보관용으로 활용할 수 있습니다.

무엇을 내보내나요
· 게시글: 제목, 본문(선택), 작성일, 조회·댓글 수, 원문 URL
· 댓글·답글: 내용, 작성일, 답글 관계, 원문 URL
· 작성자: 선택한 게시글·댓글에서 관측된 작성자와 식별자 유형(멤버키·표시ID·마스킹·닉네임만)
· 회원: 접근 권한이 확인된 경우에만 제공(운영자 화면). 지원되지 않으면 제외됩니다.

사용 방법
1. 카페의 게시판(게시글 목록) 화면을 엽니다.
2. 확장 아이콘 → "수집 화면 열기".
3. 기간·최대 게시글 수·댓글/본문 포함 여부를 정합니다.
4. 무료 미리보기(최대 20개)로 먼저 확인한 뒤, 전체 수집으로 엑셀을 내려받습니다.

요금
무료 미리보기는 카드 등록 없이 사용할 수 있습니다. 전체 수집은 월 4,900원 정기결제입니다. 언제든 다음 결제를 해지할 수 있으며, 이미 저장된 로컬 결과 다운로드는 유지됩니다.

개인정보
수집은 사용자의 브라우저에서 실행되고, 게시글·댓글·회원 데이터와 쿠키는 제품 서버로 전송되지 않습니다. 서버는 로그인(magic-link)과 구독 확인에 필요한 최소 정보만 다룹니다.

지원 범위와 한계
· 공개로 읽을 수 있는 콘텐츠는 네이버 로그인 없이 수집할 수 있습니다.
· 카페 가입·가입 승인·등업이 필요한 콘텐츠는 카페에서 조건을 완료해야 수집할 수 있습니다.
· 닉네임은 고유 식별자가 아니며, 마스킹·불완전 식별자는 그대로 표기합니다.
· 로그인/캡차 우회, 숨김·삭제 콘텐츠 접근, 연락처 재판매는 지원하지 않습니다.

홈페이지: https://naver-cafe-exporter.onnurimun.com/
개인정보처리방침: https://naver-cafe-exporter.onnurimun.com/privacy
문의: support@onnurimun.com
```

**카테고리**: 생산성(Productivity) — Tools 계열
**언어**: 한국어

## 개인정보/권한 사유 (Chrome "개인정보 보호" 탭 복사용)

**단일 목적**
```
현재 카페의 접근 가능한 게시글·댓글·작성자(권한 시 회원) 데이터를 사용자의 컴퓨터에서 엑셀(.xlsx)로 내보내는 단일 목적입니다.
```

**권한 사유**
```
- activeTab: 사용자가 실행한 현재 카페 탭에서만 동작합니다.
- scripting: 카페 페이지에 내부 요청 캡처 훅을 주입하기 위해 필요합니다(레거시 레이아웃 대응).
- storage: 수집 내역·설정·로그인 세션을 확장 프로그램 로컬에 저장합니다.
- unlimitedStorage: 장기 수집 시 IndexedDB 용량 확보.
- 호스트 cafe.naver.com / *.cafe.naver.com: 카페 목록·본문·댓글을 읽고 article.cafe.naver.com JSON을 호출합니다.
- 호스트 naver-cafe-exporter.onnurimun.com: 로그인(magic-link)과 구독 권한 확인 API 호출.
  수집한 카페 데이터는 이 호스트로 전송하지 않습니다.
```

**원격 코드**: 사용하지 않습니다(모든 코드는 패키지에 포함).

## 데이터 공개(Data usage) 체크
```
- 수집한 카페 게시글·댓글·회원/작성자 데이터는 제품 서버로 전송하지 않습니다.
- 사용자 컴퓨터(브라우저 IndexedDB/다운로드 파일)에만 저장됩니다.
- 인증 정보(magic-link 세션, 구독 상태)만 서버에서 처리합니다.
- 데이터를 제3자에게 판매하지 않습니다.
```

---

## 스토어별 제출 절차

### Chrome Web Store
1. `happylife2080100@gmail.com`으로 https://chrome.google.com/webstore/devconsole 로그인.
2. "새 항목" → `naver-cafe-exporter-v0.1.0.zip` 업로드.
3. 위 등록정보·권한 사유·개인정보 입력, 스크린샷 업로드.
4. "검토를 위해 제출". 통과 시 자동 게시.

### Microsoft Edge
`EDGE_STORE.md` 참고. https://partner.microsoft.com/dashboard/microsoftedge/ 에서
`naver-cafe-exporter-v0.1.0-edge.zip` 업로드.

### Naver Whale
`WHALE_STORE.md` 참고. https://store.whale.naver.com/ 개발자 등록 후
`naver-cafe-exporter-v0.1.0-whale.zip` 업로드.

### Firefox (AMO)
`FIREFOX_STORE.md` 참고. https://addons.mozilla.org/developers/ 에서
`naver-cafe-exporter-firefox-v0.1.0.zip` 업로드(소스 없이 배포 가능한 번들이지만,
난독화 최소화를 위해 `SOURCE_BUILD` 안내를 함께 둔다).

## 주의 (심사 반려 예방)
- 설명에 지원 사이트/브랜드를 5개 넘게 나열하지 않습니다(키워드 스팸 규칙).
- 회원 디렉터리는 "접근 권한이 확인된 경우에만" 제공된다고 명시합니다(완전한 회원 DB로 광고 금지).
- 마스킹·불완전 식별자 고지를 유지합니다.
- 실제 구현되지 않은 기능(자동 게시·메시징·연락처 보강)을 설명에 넣지 않습니다.

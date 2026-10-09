# Firefox (AMO) 제출 — 네이버 카페 엑셀 내보내기

업로드 파일: `naver-cafe-exporter-firefox-v0.1.0.zip`
(빌드: `npm run package:firefox` → `dist-firefox` + zip, manifest가 ZIP 루트)

Firefox 빌드는 `manifest.firefox.json`을 사용한다:
- `background.scripts` (MV3 이벤트 페이지) — Chrome의 서비스 워커 대신.
- `browser_specific_settings.gecko` (id `naver-cafe-exporter@onnurimun.com`, min 115).
- `externally_connectable` 미포함(Firefox 미지원).
- 코드는 `src/lib/webext.ts`로 Firefox의 promise 기반 `browser.*`를 `chrome`으로 별칭해
  동일 애플리케이션 코드를 공유한다.

## 절차
1. https://addons.mozilla.org/developers/ 로그인(Firefox 계정).
2. **Submit a New Add-on** → `naver-cafe-exporter-firefox-v0.1.0.zip` 업로드.
3. 등록정보: `STORE_LISTING.md`의 이름/요약/설명 재사용.
   - 카테고리: Productivity, 언어: 한국어
   - Homepage: `https://naver-cafe-exporter.onnurimun.com/`
   - Privacy policy: `https://naver-cafe-exporter.onnurimun.com/privacy`
   - Data collection: 인증 정보(로그인 세션)·웹사이트 콘텐츠(사용자가 여는 카페) — 수집은 로컬.
4. 배포 방식: **On this site**(AMO 호스팅) 또는 **On your own**. 검수 후 게시.

## 소스 검토(AMO가 요청 시)
`SOURCE_BUILD.md`의 절차로 `npm run build:all` 산출물과 소스를 함께 제출한다.
빌드는 결정적이며 원격 코드가 없다.

## 참고
- Firefox에서 계정 연결은 워크스페이스가 링크 상태를 폴링하는 방식이라
  `externally_connectable` 없이 동작한다.
- Naver 페이지의 MAIN-world 훅은 Firefox `scripting.executeScript({world:'MAIN'})`
  지원에 따라 달라질 수 있다. 미지원 시에도 게시글/댓글 수집은 직접 API 호출로
  동작하도록 되어 있다(훅은 보조). 실기기 확인 후 필요하면 조정한다.

# 소스 빌드 안내 (AMO 소스 검토용)

Firefox/AMO가 소스 검토를 요청하면 아래로 재현 가능한 빌드를 만든다.

## 요구 사항
- Node v22+
- 저장소 루트 기준 `extension/` 디렉터리

## 빌드

```bash
cd extension
npm ci                 # package-lock.json 고정 설치 (없으면 npm install)
npm run typecheck
npm test
npm run build:all      # chrome -> dist/ , firefox -> dist-firefox/
npm run package:all    # zip 산출물 생성
```

- 빌드 도구: esbuild(`scripts/build.mjs`). 각 엔트리는 자체 완결 IIFE로 번들된다.
- 난독화/축소는 esbuild `minify` 옵션만 사용하며 함수·변수 은닉 목적이 아니다.
  검토용으로 축소 없이 빌드하려면 `scripts/build.mjs`의 `minify: true`를 `false`로 바꾼다.
- 원격 코드 로드는 없다. 모든 실행 코드는 패키지에 포함된다.
- 런타임 의존성: `fflate`(ZIP 생성). 웹앱은 별도(`web/`).

## 산출물
- `dist/` (Chrome/Edge/Whale), `dist-firefox/` (Firefox)
- zip: `naver-cafe-exporter-v<version>.zip`, `naver-cafe-exporter-firefox-v<version>.zip`

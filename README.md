# naver-cafe-exporter

Export Naver Cafe data (posts, comments, member/author IDs) to Excel (`.xlsx`).

Status: **scaffold** — docs only, no implementation yet.

## Why

Scanned Kmong (2026-10-09): "네이버 카페 DB 추출" (회원·게시글·댓글·아이디 → Excel) is one of
the few crawler targets with **multiple independent sellers** in the 크롤링·스크래핑
category, i.e. an observable, repeated buying need rather than a one-off.

Observed Kmong gigs (cumulative reviews, 2026-10-09):

- `170392` 카페 아이디 수집 추출 추적기 — 138 reviews (코딩스타AI)
- `589200` 카페 글작성자 댓글작성자 DB 크롤링 솔루션 — 51 (MJsoft)
- `517074` N사 카페 회원 DB 수집 프로그램 타겟 마케팅 — 5 (ProgramBay, ₩550k)
- `600292` N사 카페 게시글 추출 / DB추출 프로그램 — 4 (파이썬코딩)
- `675779` N사 카페 DB 수집 솔루션 — 6 (와이제이코드)

## Scope

**In scope (planned):** given a cafe and authorization, extract posts, comments, and
author identifiers, and write them to a structured Excel workbook.

**Out of scope:** bypassing login/captcha, harvesting private/deleted content,
evading rate limits, bulk PII resale.

## Legal / ToS — read before using

- Naver Cafe ToS and robots.txt restrict automated collection. **Do not scrape without
  the operator's authorization.**
- Collecting member personal data (회원 DB) implicates **개인정보보호법** (PIPA) and
  정보통신망법. Publicly exposing or reselling such data is unlawful.
- Intended use: **authorized** export of a cafe you own/operate, or data you have a
  lawful basis to process. Keep the tool read-only against third-party cafes.

## Layout

```
README.md          this file
plan.md            milestones, architecture, open questions
docs/              design notes (added as work proceeds)
src/               implementation (not yet created)
```

## Non-goals for this repo

Building happens here; the **bet ledger** (gates, kill numbers, GO/KILL) lives in the
`llm-wiki` repo. This project does not own its own gate.

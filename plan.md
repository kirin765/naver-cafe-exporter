# Plan

Status: scaffold. Nothing implemented. This is a starting sketch, not a commitment.

## Open question that gates everything

**Who is the buyer, and what is the authorized access route?**

Kmong shows sellers *offering* this; it does not show that we can reach these buyers or
that they will pay us. Before building, answer:

- Is the intended customer a cafe **operator** exporting their own cafe (authorized,
  low-risk), or a **marketer** wanting member/author lead lists (high legal risk)?
- How does one person reach that buyer organically without a sales team?

## Candidate architecture

1. **Input** — cafe URL + scope (posts / comments / authors) + date or board range.
2. **Auth** — reuse an authenticated browser session (Playwright / CDP), never
   credential-entry automation.
3. **Fetch** — Naver Cafe internal JSON/GraphQL endpoints where possible; paginate.
4. **Normalize** — posts, comments, authors into flat records.
5. **Output** — `.xlsx` via openpyxl/pandas; one sheet per entity type.
6. **Guardrails** — rate-limit hygiene, read-only, no captcha bypass, explicit
   authorization check before a run.

## Milestones (unestimated)

- [ ] Confirm buyer + authorized access route.
- [ ] Map Naver Cafe endpoints for a cafe we are authorized to read.
- [ ] Prototype: posts → Excel for one cafe.
- [ ] Add comments and author columns.
- [ ] Write the Excel schema doc.

## Where judgment lives

Gates, kill numbers, and GO/KILL decisions are recorded in the `llm-wiki` ledger, not
here. This repo only builds.

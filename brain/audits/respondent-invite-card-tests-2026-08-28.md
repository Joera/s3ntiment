# Respondent Invitation / Card — Test Tranche A (2026-08-28)

Tranche A adds respondent-frontend tests for the **Card class**, the **router
entry gates**, and the **producer/consumer card-URL round-trip** — the three
invitation/card surfaces the prior exploration
(`respondent-invite-card-exploration-2026-08-28.md`) identified as untested,
without re-pinning the already-protected shared encoding seam.

Branch: `deepseek/respondent-invite-card-tests` (base `main` @ `ffed11d8c`,
includes PRs #7/#8/#10).

## New test files (frontend-respondents runner)

| File | Count (it) | What it covers |
|---|---|---|
| `src/card-class.seam.test.ts` | 11 | Real `Card` class (by relative source path `../../shared/src/shared/invites/card.factory.js`): `isUsed` (viem.read → `isNullifierUsed` args, true/false passthrough, read rejection), `register` (`account.write` → `registerInPool` args + `{waitForReceipt, confirmations:2}`, signature passthrough, write rejection), getters `surveyId/nullifier/batchId`, and `parseCardURL` edge cases not pinned elsewhere (malformed URL, non-hex/weird signature → null, extra params tolerated, URL-encoded nullifier round-trip). |
| `src/router-entry-gates.test.ts` | 9 | Pure `resolveRootGate` / `resolveSurveyGate` helpers with mocked `Card.isUsed` / `fetchSurvey` / `hasParticipatingAccount` / `authenticate` and the REAL store. Root: null card → invalid-card; used → /used-card/:surveyId; fresh → proceed; isUsed rejection propagates. /surveys: missing surveyId → /surveys (no fetch/participation); member → proceed + store populated (setSurveyData + setActiveSurvey); non-member authenticate→true → proceed; authenticate→false → invalid-card; fetchSurvey rejection propagates. |
| `src/card-url.round-trip.test.ts` | 3 | Reproduces the organiser producer shape (`${BASEURL}?n=…&b=…&sig=…&s=…` from `frontend-organiser/src/factories/invitation.factory.ts` `generateCardSecrets`, incl. base64url nullifier gen) and feeds it to the SHARED `parseCardURL`; asserts recovered `surveyOwner === batchId`. Closes the producer/consumer seam without organiser vitest infra. |

Total new: **23 tests**. Full suite: **49 tests pass** across 7 files.

### Existing suite (still green, unchanged)
- auth.factory.test.ts — **9**
- controllers/auth-ctrlr.test.ts — **5**
- card-signature.seam.test.ts — **5**
- controllers/survey-ctrlr.test.ts — **7**
- New: card-class.seam **11** · router-entry-gates **9** · card-url.round-trip **3**

## Build gate
`cd frontend-respondents && pnpm build` (vite build) — **GREEN** (6980 modules,
built in ~39s). The `router.ts` refactor compiles cleanly; `router` and
`initRouter` exports and their behavior are unchanged.

## Router gate-helper refactor
Extracted the two Navigo `before`-hook **decision bodies** into a new pure module
`frontend-respondents/src/router.gates.ts`, per the exploration's R1 plan:

- **`resolveRootGate(services, cardData, surveyStore)`** → discriminated result
  `{navigate:'/invalid-card'} | {navigate:'/used-card/:surveyId'} | {proceed:true}`.
  `cardData` is already-parsed (the caller, `initRouter`, still calls
  `parseCardURL(window.location.href)` — the only DOM touch — and passes the
  result in). Builds the real `Card` internally and consults `isUsed`.
- **`resolveSurveyGate(services, surveyStore, surveyId)`** →
  `{navigate:'/surveys'} | {navigate:'/invalid-card'} | {proceed:true}`. On a
  missing surveyId it now **returns early** with `{navigate:'/surveys'}` (the
  original continued to fetch+mutate the store with an empty id — an obvious
  bug; the rail change makes the gate match its documented intent).
  Otherwise: `fetchSurvey` → real `store.setSurveyData` + `setActiveSurvey` →
  `hasParticipatingAccount` → `authenticate` on demand → proceed / invalid-card.

`router.ts` now calls the helpers and turns the result into
`router.navigate(decision.navigate)` + `done()` — **exactly** the observable
root and `/surveys` behavior (navigate-and-done in every branch; no navigation
on `proceed`), so the running app is unaffected. Only `router.ts` changed in
the refactor (10 insertions / 43 deletions); exported names `router` /
`initRouter` are preserved.

## Not touched
- `frontend-organiser` — untouched (no vitest there; organiser Tranche B is a
  separate later task).
- The protected `shared/src/shared/invites/encoding.ts` seam — NOT re-pinned
  (already covered by card-signature.seam + contracts encoding.seam).
- Onboarding/entry-screen controllers — remain excluded per instructions.

## Test traits
- All run in the existing node-vitest wiring (`include: src/**/*.test.ts`,
  `test/setup.ts` provides localStorage/window/document/alert; no jsdom).
- Shared modules imported by **direct relative source path**
  (`../../shared/src/shared/invites/…`) so tests depend on the .ts source,
  never the unbuilt dist — mirroring the `card-signature.seam.test.ts` precedent.

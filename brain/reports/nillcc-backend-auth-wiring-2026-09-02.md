# nillcc-backend — auth wiring + update-path fix + route tests (impl report)

**Branch:** `deepseek/nillcc-auth-wiring`
**Base:** `nillcc/backend-validation` (PR #39 head `84ba1ccc5`)
**PR:** #40 (this report)
**Date:** 2026-09-02

## Context / base decision

Task assumed PR #39 ("boundary validation + createApp factory") might already be on
`main`. It is **not** — `main` is at `bc1c57499` (PR #37) and #39 is still open on
`nillcc/backend-validation`. The code this task operates on (createApp factory, the
dead `verifySignature`, validation.ts) only exists on that branch, so this worktree was
branched off `origin/nillcc/backend-validation` and this PR targets that branch to keep a
clean delta on top of #39. When #39 merges, this PR can be retargeted to `main`.

## What changed

### 1. AUTH WIRING (task 1)

Investigated every frontend caller of the mutating routes. The clients' existing signing
scheme is: sign a **fixed string** with the wallet (viem `signMessage`) and ship
`signature` + the signer address in the JSON body. Two routes already verified this
inline (`/score` -> `s3ntiment:score:{id}`, `/lit/usage-key` -> `'Request capability to
decrypt'`); the remaining mutating routes had **zero** server-side verification.

The dead `verifySignature` was incompatible with every client:
- it read `req.body.signer`, but clients send `userAddress`;
- it verified `req.body.message || 's3ntiment:'+req.path`, but clients sign fixed
  strings and send no `message`.

It was rewritten as a small **factory** `verifySignature({messages, addressField,
authObject})` that reuses the exact score/lit-usage-key pattern (viem `verifyMessage`
over the plain signed string) and is wired per-route to match what each client actually
signs. Wired routes (all 401 on missing/invalid, pass-through on valid):

| Route | Required auth | Client-side material (unchanged unless noted) |
|---|---|---|
| `POST /api/pools` | sig over `'Request owner invocation'` + `userAddress` | organiser `new.ctrlr`: `{signature, userAddress, poolId, safeAddress}` — already sent |
| `POST /api/surveys` | sig over `'Request owner invocation'` + `userAddress` | organiser `new.ctrlr`: `{signature, userAddress, surveyConfig, poolConfig}` — already sent |
| `PUT /api/surveys/:id` | sig over `'Request owner invocation'` + `userAddress` | **frontend change**: organiser `survey.ctrlr` now sends `{signature, userAddress, survey, poolConfig}` (previously sent no signature and a different shape) |
| `POST /api/surveys/:id/results` | sig over `'Request owner invocation'` inside `body.auth` | organiser `survey.ctrlr` `refreshResponses`: `{auth:{signature,userAddress}, …}` — already sent |
| `POST /api/surveys/:surveyId/delegation` | sig over `'s3ntiment:submit'` **or** `'s3ntiment:migrate'` + `userAddress` | respondents `survey.ctrlr` (`s3ntiment:submit`) + `account-ctrlr` (`s3ntiment:migrate`): `{signature, userAddress, …}` — already sent |
| `POST /api/builder/register` | sig over `'Request owner invocation'` + `userAddress` | organiser `new.ctrlr`: `{signature, userAddress, poolId, pkpId, pkpDid, safeAddress}` — already sent |
| `POST /api/surveys/:id/score` | (unchanged) inline `s3ntiment:score:{id}` + `isPoolMember` | respondents `completed-ctrlr` |
| `POST /api/lit/usage-key` | (unchanged) inline `'Request capability to decrypt'` | shared `fetchLitApiKey` |

`GET /api/surveys/:id` is read-only and stays unauthenticated.

**Frontend change (only one):** the organiser `survey-save` PUT body now sends
`{signature, userAddress, survey, poolConfig}` instead of
`{surveyId, surveyConfig, safeAddress, poolId}`. This both satisfies the new auth and
matches the backend update controller/validation shape (which read `survey` +
`poolConfig`). `signature = safe.signMessage('Request owner invocation')`,
`userAddress = safe.getSignerAddress()`, `poolConfig = this.pool.config`.

### 2. UPDATE-PATH GAP (task 2) — decision: **GUARD**

Chose to **guard the re-encrypt path** rather than require `poolConfig.pkpId` on update.
Rationale: PR #38 explicitly established that update is not the pool-identity
enforcement point and imported pools may lack `pkpId`; requiring `pkpId` on update would
make imported surveys permanently unupdatable and contradict the objects-only update
contract. `survey.ctrlr.update()` now only PKP re-encrypts (the two `lit.encrypt` calls
that dereferenced `poolConfig.pkpId`) when `poolConfig?.pkpId` is present; otherwise the
audience blobs are left unset and the rest of the updated config still uploads. This
stops the unconditional dereference from 500-ing with a cryptic `UPDATE_FAILED`.

Added a **real-controller** test (not the mocked service) constructing a real
`SurveyController` with fakes and calling `update({survey, poolConfig:{safe}})` with a
partial poolConfig — asserts it completes (returns CID), never calls `lit.encrypt`, and
uploads a config with unset audience blobs. The existing happy-path test still asserts
`lit.encrypt` is called twice when `pkpId` is present.

Also reconciled `validateSurveyUpdate` to the canonical body
`{signature, userAddress, survey, poolConfig}` (SURVEY_ID_MISMATCH now checks
`survey.id` instead of the legacy `surveyConfig.id`).

### 3. TRIVIAL CLEANUPS (task 3)

- (b) Dropped the unused `groups` destructure from the `/results` route.
- (c) `verifySignature` is no longer dead — it is now wired to six routes and referenced
  six times, so the intentional-unused workaround (`void verifySignature;`) is no longer
  needed; the type-level state is now "used", not "intentionally unused".

## Tests added

- **app.test.ts** — new `AUTH` suite: for each wired route, missing signature/address ->
  401 `MISSING_SIGNATURE` (no side effect), invalid signature -> 401 `INVALID_SIGNATURE`
  (no side effect), and valid pass-throughs (incl. delegation multi-message and
  results `body.auth`). Adjusted the surveys missing-field boundary test (signature is
  now auth-covered -> 401) and the update/results valid bodies to the canonical shape.
- **survey.ctrlr.test.ts** — real-controller partial-poolConfig update guard test.

## Gates (exact vitest summary lines)

```
nillcc-backend  test:  Test Files  5 passed (5)   Tests  77 passed (77)
nillcc-backend  build: tsc — clean
shared          test:  Test Files 11 passed (11)  Tests 103 passed (103)   (unchanged 103/11)
shared          build: tsc — clean
frontend-organiser test: Test Files  6 passed (6)  Tests  32 passed (32)  (only touched frontend)
frontend-organiser build: vite build — clean
frontend-respondents test: Test Files 13 passed (13) Tests 127 passed (127)  (untouched, sanity)
```

No new deps. Only the 6 intended files changed.

## Follow-ups / notes (out of scope)

- `results` route body still expects `survey` (queryIds array) while the organiser sends
  `queryIds`; the results response is currently unused (commented out) in the client, so
  this pre-existing #39 mismatch was left untouched. If the results flow is revived it
  should be reconciled (`survey` vs `queryIds`).
- `shared/src/shared/nillion/nilldb.user.service.ts#getUserDelegationToken` sends
  `{didString, surveyId, signature, poolConfig}` (no `userAddress`/`userDid`) and would
  fail both `validateDelegation` and the new auth; it has **no live callers** (dead
  code), so it was left alone.
- Imported pools (no stored `pool.config`) cannot satisfy the update route's required
  `poolConfig` object — they 400 at the boundary. This is intentional: there is no PKP
  to re-encrypt to for imported pools (already the case before this PR).

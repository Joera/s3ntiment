# Review — PR #8 (deepseek/nillcc-backend-tests, commit 28257fcfb)

Independent review against the tranche-1 acceptance contract for `@s3ntiment/nillcc-backend`.
Reviewed test assertions against the real source modules under test (main checkout, `main` @ `bd9da7a48`). Review-only — no edits made to the worktree or main checkout.

---

## Test-count claim: CONFIRMED (28)

Counting `it(...)` blocks in the diff yields exactly the claimed split:
- `src/survey.ctrlr.test.ts` — 8 (create 1, update 1, get 2, score 3, getUserDelegation 1)
- `src/pool.ctrlr.test.ts` — 5 (create 3, update 1, registerBuilder 1)
- `src/services/nildb.builder.service.test.ts` — 7
- `src/services/nildb.pkp.service.test.ts` — 8

Total 28 across 4 files. Claim is accurate.

---

## Per-contract findings

### Item 1 — Vitest wiring — PASS
- `vitest ^4.1.11` in devDeps; `"test": "vitest run"` — present, resolved to `4.1.11` in lockfile. ✓
- `vitest.config.ts`: `environment: 'node'` (no jsdom), `include: ['src/**/*.test.ts']`, `setupFiles: ['./test/setup.ts']`, default reporters. ✓
- No production source or `main.ts` touched. Diff touches only `package.json`, `tsconfig.json` (exclude), `pnpm-lock.yaml`, and new test/config/setup files. ✓
- `tsconfig.json` appends `src/**/*.test.ts` to `exclude`, so `tsc` build omits tests. ✓

### Item 2 — SurveyController tests — PARTIAL (one sub-item gap)
Constructor-injected `(nildb, lit, litPoolKeys, ipfs, viem)`, all `any` — matches source exactly. Coverage:
- `create` happy path: I cross-checked every assertion against `survey.ctrlr.create` — stripScoring, isScored, createSurveyCollectionSchema, createSurveyAggregationQuery, `litPoolKeys.get(pool)`, `queryIds` mutation, exact 2 `lit.encrypt`, 1 `encryptToBuilder`, `nilDid`/`encryptedScoring`/`isScored` in uploaded payload, CID returned. All match real code. ✓
- `update` happy path (re-encrypt + upload with surveyId/poolId/queryIds/isScored) — matches source. ✓
- `get` happy path + **get→null when no cid** (404 driver) — matches source (`if (!cid) return null`); also asserts `fetchFromPinata` NOT called on null path. ✓
- `score`: existing-response→42, no-response→**false**, unscored→**null** (and `decryptFromBuilder` not called on unscored). All three match source branches. ✓
- `getUserDelegation`: `fetchSurveyAndParseCid` delegation + PKP-client write-delegation with the 8 args — matches source. ✓

**Gap:** the contract requires `update SURVEY_ID_MISMATCH` error semantics. It is **not covered** — and it cannot be, because `SurveyController.update()` has **no id-mismatch guard in the source**; that check (`req.params.id !== body.surveyConfig?.id` → 400) lives only in `main.ts`, which item 7 explicitly excludes. The implementer documented this exactly. So item 2's "update SURVEY_ID_MISMATCH" sub-requirement is unmet at the controller level (it's a route-layer concern), and the gap is real, not an invented claim. The remaining required error semantics (get→null, score unscored→null / no-response→false) are covered.

### Item 3 — PoolController — PASS
- `create` happy path: PKP + 6 action CIDs, 6 `registerAction`, group with pkp address + 6 hashed cids, usage key persisted via `litPoolKeys.set`, `executeAction`→`publicKeyToDidKey`, `{pkpId, pkpDid, groupId}` — all verified against `pool.ctrlr.create`. ✓
- Failure paths: `"missing poolId"` and `"missing safeAddress"` strings are the real controller-level returns (the route-level `500 CREATE_FAILED` wrapper is HTTP-layer, excluded). ✓
- `update`: asserts it renders `undefined` and performs no work — verified `PoolController.update()` is genuinely empty. Honest "current-behavior" assertion, not invented. ✓
- `registerBuilder`: usage-key lookup + `registerAsBuilder` with the exact 6 args + `{ok:true}` — matches source. ✓

### Item 4 — NilDBBuilderService — PASS
- Real ecies `encryptToBuilder`/`decryptFromBuilder` round-trip against a locally-derived signer key/DID (no network) — genuine, non-vacuous crypto test. ✓
- `exists` (found → id list / not-found → false), `getResponseById`, `createSurveyCollection`, `getCollectionInfo` (incl. error→null) all drive an injected fake `builderClient` and assert exact `findData`/`createCollection` call shapes matching source. ✓
- Env guaranteed in setup (`VITE_NIL_BUILDER_PRIVATE_KEY`, `VITE_NILDB_NODES`) so real construction doesn't throw. ✓

### Item 5 — NillionPkpClient — PASS
Fakes `this.lit.executeAction`, mocks global `fetch`, and asserts exact URL/method/headers/body per hardcoded node URL. I verified each against `nildb.pkp.service.ts`:
- `registerAsBuilder`: POST `/v1/builders/register` ×3 (per-node), `Content-Type`, `Bearer inv-1`, body `{did,name}` with default name `'S3ntiment PKP'`, status map keyed by node DID; plus invocation-failure→`undefined` (and fetch not called) matching source's `invocation == undefined → return`. ✓
- `createCollection` / `createQuery`: POST URL + body + response-text parse, per-node results. ✓
- `runQuery`: POST `/v1/queries/run`, body `{_id: 'query-1', variables:{}}`, `executeAction` ×3, run IDs keyed by DID. ✓
- `readQueryResults`: GET `/v1/queries/run/:runId`, **completed-only** filtering (test 1: 3 complete→`combined:3`; test 2: all pending→`combined:0`) — this actually validates the `status === 'complete'` gating in real source, not just the mock. ✓
- `getUserWriteDelegation`: `compactAction(userDelegationAction)` code, `executeAction(poolId, code, params, usageKey)` param/usage-key assertions. ✓

### Item 6 — Shared imports offline + contracts JSON — PASS (with drift caveat)
All 4 files `vi.mock('@s3ntiment/shared', ...)`; each factory provides every runtime symbol its target module imports (I checked all are present — e.g. pool mock has all 8 used symbols, so module graphs resolve without `shared/dist`). `s3ntiment-contracts/deployments/base/S3ntimentSurveyStore.json` is imported **for real** via `with {type:'json'}` (not mocked) in both `survey.ctrlr` and `pool.ctrlr`, and the survey `get` test asserts against the real `address`/`abi` — satisfies "imported for real." ✓

### Item 7 — Excludes HTTP/main.ts — PASS
No test imports `main.ts`, no `export app`/`createApp` refactor, no live-server/supertest routes. Controller/service method surface only. This is why the `update→400 SURVEY_ID_MISMATCH` and `score→403` mappings aren't tested — covered only at the controller-semantic level (as item 2's gap notes).

### Item 8 — Zero-network, no creds — PASS
Shared barrel is mocked (no Lit/Viem/IPFS instantiation), global `fetch` is stubbed in PKP tests, builder round-trip uses local key derivation + eciesjs only, `test/setup.ts` supplies benign env. No `.env`/creds required.

---

## Tests that don't assert what they claim / vacuous assertions

- **`expect(NillionPkpClient).toBeDefined()`** (survey getUserDelegation test) is trivially true — the symbol is imported and mocked, so it passes regardless. It's a harmless sanity line, not a false confidence, and the meaningful assertions (client captured, `getUserWriteDelegation` called with 8 exact args) follow it. Minor.
- No test passes purely because a mock is reflexive: the mock return-shapes are consistent with real source (e.g. `runQuery` body `{_id, variables:{}}`, `readQueryResults` complete-only, `registerAsBuilder` name default, `pool.create` result `{pkpId,pkpDid,groupId}`, `score` branches). If a controller/service method misbehaved, the call-arg assertions would fail.

## Shared-mock strategy — can it hide real integration drift?

**Yes.** This is the inherent, expected limitation of the (contract-permitted) `vi.mock('@s3ntiment/shared')` strategy:
- The mocks stub out **all the real shared helper logic**: `stripScoring`, `createSurveyAggregationQuery`, `calculateScore`, `combineShares`, `fetchSurveyAndParseCid`, `tallyResults`, the action builders, `publicKeyToDidKey`. None of that real code is exercised. If shared changes a function signature or return shape (e.g. `createSurveyAggregationQuery` stops returning `_id`, or `stripScoring` changes its field names), these tests detect nothing — they only assert the controller's call pattern against a hand-picked mock shape.
- The in-package `NillionPkpClient` is also mocked inside the controller tests, so the controller↔client wiring is validated only at the "which method/args" level, not client behavior.
- Because `shared/dist` is unbuilt and everything resolves through mocks, nothing actually verifies the backend's real imports against the shared package build (the exploration doc's alternative — importing shared source by relative path as the frontend does — would have caught such drift, at the cost of real shared logic in these tests).

This is contract-compliant (option b) and the tests are well-scoped for what they are. But treat these as **controller/service wiring tests, not integration tests** — real shared-package correctness and backend↔shared compatibility are **unverified** by this tranche and would need a separate pass (shared-source-import tests or a built-`shared/dist` run).

## Contract violations / summary

- **Item 2, `update SURVEY_ID_MISMATCH`: NOT covered** — a partial-fail on that single sub-requirement. It is an honest, documented deferral (the guard lives in the excluded HTTP layer and does not exist in the controller), so it's a scope tension between items 2 and 7 rather than a fabricated claim. Everything else in item 2 is covered.
- No other contract violations found. Items 1, 3, 4, 5, 6, 7, 8 all pass. The 28-test count is accurate.

**Net:** The PR satisfies its acceptance contract with strong, source-verified, non-vacuous tests (the ecies round-trip, the complete-only `readQueryResults` filtering, and the exact nil-node REST assertions are the highlights). The only real shortfalls are (a) the item-2 `update SURVEY_ID_MISMATCH` gap (blocked on the excluded HTTP layer, already flagged as follow-up), and (b) the inherent integration-drift blind spot of the whole-barrel shared mock, which should be tracked as a known coverage ceiling rather than treated as full coverage of `@s3ntiment/shared`.

---

## OVERALL VERDICT: APPROVE_WITH_NITS

The PR meets the tranche-1 acceptance contract with accurate test counts and source-verified, non-vacuous assertions, and nothing blocks merge.

Blocking issues:
- none

Non-blocking nits / follow-ups:
- Item 2's `update SURVEY_ID_MISMATCH` error semantic is not covered — deferred to the excluded HTTP layer (needs the `main.ts` `createApp`/`createRouter` refactor before it can be tested).
- The whole-barrel `@s3ntiment/shared` mock leaves real shared-helper logic and backend↔shared compatibility unverified (track as a known coverage ceiling; consider a shared-source-import or built-`dist` pass later).
- Minor: `expect(NillionPkpClient).toBeDefined()` in the survey `getUserDelegation` test is trivially true (harmless).

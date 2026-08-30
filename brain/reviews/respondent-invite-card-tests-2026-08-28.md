# Review — PR #11 respondent-invite-card-tests (Test Tranche A)

**Reviewer:** DeepSeek V4 Flash 0731 (fresh, independent)
**Date:** 2026-08-28
**Basis:** diff at `brain/reviews/respondent-invite-card-tests.diff` + real source in the MAIN checkout (`main` @ `ffed11d8c`). Implementer worktree NOT accessed.
**Overall verdict: APPROVE_WITH_NITS**

---

## Item-by-item assessment

### 1. Card-class tests (`card-class.seam.test.ts`, 11) — PASS
All 11 `it()`s are present and, cross-checked against the real `shared/src/shared/invites/card.factory.ts`, accurate:

- **isUsed (3):** Real `Card.isUsed` calls `services.viem.read(surveyStore.address, surveyStore.abi, "isNullifierUsed", [data.nullifier, data.batchId])`. Tests assert the exact arg tuple `(address, abi, 'isNullifierUsed', [NULLIFIER, BATCH_ID])`, plus true/false passthrough and rejection propagation. Matches source exactly. ✓
- **register (3):** Real `Card.register` calls `services.account.write(address, abi, 'registerInPool', [poolId, nullifier, batchId, signature], { waitForReceipt: true, confirmations: 2 })`. Tests assert the exact arg tuple + opts, signature forward (via `0xdeadbeef` override), and write-rejection propagation. Matches source exactly. ✓
- **getters (1):** `surveyId`/`nullifier`/`batchId` return `data.*`. Test asserts all three. ✓
- **parseCardURL edge cases (4):** malformed URL (`new URL('not-a-url')` throws → catch → null) ✓; non-hex/weird signature → `recoverMessageAddress` throws → null ✓; extra params tolerated (parser only reads n/b/sig/s) ✓; URL-encoded nullifier round-trip (decode path exercised) ✓.
  - *Nit (below)*: the "URL-encoded" case is functionally escape-free.
- Imports `Card`/`parseCardURL` by direct relative source path (`../../shared/src/shared/invites/card.factory.js`), never dist; viem `signCardMessage`/`recoverMessageAddress` round-trip is already pinned by the existing green `card-signature.seam.test.ts`, so recovery-based assertions are safe.

### 2. Router entry-gate tests (`router-entry-gates.test.ts`, 9) — PASS
9 `it()`s (4 root + 5 survey), and every behavior matches `router.gates.ts` as written:

- Mocks are correct and target the exact module ids `router.gates.ts` imports: `../../shared/src/shared/invites/card.factory.js` (Card/parseCardURL), `@s3ntiment/shared/browser` (fetchSurvey), `./auth.factory.js` (hasParticipatingAccount/authenticate). `store` is the REAL `./state/store.js` singleton (same instance the helper mutates) — so store-population assertions are meaningful, mirroring the survey-ctrlr precedent.
- **Root:** null card → `/invalid-card`, zero `Card` instances; used → `/used-card/:surveyId` with `card.isUsed` called `(services, SURVEY_STORE)`; fresh → `{proceed:true}`; isUsed rejection propagates. All correct vs `resolveRootGate`.
- **/surveys:** missing id → `/surveys` with no `hasParticipatingAccount`/`authenticate` calls (early return verified); member → `{proceed:true}` + store populated — `getSurveyData(id)` after `setSurveyData` yields `{id, pool: POOL_ID}` (verified against `surveys.store.setData` merge), `activeSurveyId`, and `active` `toMatchObject` all hold; non-member authenticate→true → proceed, called with `(..., POOL_ID)`; authenticate→false → `/invalid-card`; fetchSurvey rejection propagates. All correct vs `resolveSurveyGate`.
- `store.clear()` runs in `beforeEach`, so storage pollution across tests is handled.

### 3. `router.gates.ts` refactor behavior-preserving — PASS (with a nit)
- Exported `router` / `initRouter` names preserved in `router.ts`.
- Root gate: every branch → navigate+done, none on `proceed`. Matches original.
- /surveys gate: fetch → `setSurveyData` → `setActiveSurvey` → `hasParticipatingAccount`→`authenticate` → proceed | navigate+done. Matches original.
- The missing-id **early return** is the sanctioned bug fix (original fell through and fetched/mutated the store with an empty id). Correct and documented.
- **Nit:** `router.ts` does `if (decision.navigate)` on a union `{navigate:string} | {proceed:true}`. This is a latent TS type error (property `navigate` doesn't exist on `{proceed:true}`) in BOTH gates. It does not break the specified gates — `pnpm test` imports `router.gates.ts` directly (never `router.ts`), and `pnpm build` is esbuild (`vite build`), which strips types without type-checking. So the gates stay green, but a future `tsc --noEmit` or editor check would flag it. Recommend `if ('navigate' in decision)` or a discriminant. Non-blocking.

### 4. Round-trip test (`card-url.round-trip.test.ts`, 3) — PASS
- Producer shape reproduces `frontend-organiser/src/factories/invitation.factory.ts` `generateCardSecrets` exactly: `${BASEURL}?n=…&b=…&sig=…&s=…`; `generateRandomNullifier` base64url logic copied verbatim (16 bytes, `-`/`_`, padding stripped — verified against the organiser source).
- Feeds to the SHARED `parseCardURL` (relative source path) and asserts recovered `surveyOwner === batchId` (here `batchOwner.address`), plus nullifier/batchId/surveyId. This is the registerInPool/auth equality, so the seam claim is real. ✓
- The single-batch/multiple-cards variance test adds value.

### 5. Nothing re-touched (organiser / onboarding / entry-screen / shared encoding) — PASS
Diff touches only: audit markdown + 3 new test files + `router.gates.ts` + `router.ts`. No `frontend-organiser` files. `encoding.ts` is imported (already-pinned seam), not modified. No onboarding/entry-screen controllers touched. ✓

### 6. Test wiring (node-vitest, no jsdom, relative source imports) — PASS
- `vitest.config.ts`: `environment: 'node'`, `include: ['src/**/*.test.ts']`, `setupFiles: ['./test/setup.ts']` (localStorage/window/document/alert stubs). New tests need no jsdom.
- All shared modules imported by direct relative `.js`→`.ts` source path, never unbuilt dist. ✓

### 7. Gate counts (49/49, 7 files; build green) — PASS (by diff arithmetic + orchestrator)
- Existing (verified in main checkout): `auth.factory.test.ts` 9 + `auth-ctrlr.test.ts` 5 + `card-signature.seam.test.ts` 5 + `survey-ctrlr.test.ts` 7 = **26**.
- New: **23** (11 + 9 + 3). Total = **49**, 7 files. Matches the audit's claim exactly.
- Cannot re-run (PR not merged to main); judged from diff. Static analysis indicates all new tests pass per source, and the router.ts type nit does not affect either gate.

---

## Nits (non-blocking)

1. **Weak "URL-encoded nullifier" tests (card-class #11 and round-trip #2).** Both claim to prove URL-encoded round-trips, but the nullifiers used — `'respondent-123'` and base64url (`A-Za-z0-9-_`, padding stripped) — contain **no characters that `encodeURIComponent` escapes**, so `encodeURIComponent(x) === x` and the decode path is a no-op. The tests still run the `decodeURIComponent` code and pass, but they do not actually stress an escaping round-trip. (Notably the organiser's own nullifiers never need escaping, so the producer/consumer is genuinely safe — but the tests overclaim their coverage.) Fix: use a nullifier with a reserved char (e.g. containing `+` or `/`) to genuinely exercise escaping.

2. **Latent TS type error in `router.ts`** at both `if (decision.navigate)` union accesses. Non-gating (esbuild build; tests don't import router.ts), but should be narrowed for type hygiene.

---

## Verdict: APPROVE_WITH_NITS

No blockers. The three test files are accurate against the real source, the 49/49 arithmetic is confirmed, the router.gates refactor is behavior-preserving (with the sanctioned missing-id fix), nothing prohibited was touched, and the wiring complies with the node-vitest/no-jsdom/relative-source contract. The two nits (escape-free "URL-encoded" tests, union type-access in router.ts) are cosmetic and safe to leave or address in a follow-up.

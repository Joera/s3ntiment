# Review — PR #10: respondent SurveyController vitest suite + R1 fix

- Reviewer: independent (DeepSeek V4 Flash 0731)
- Branch: `deepseek/respondent-survey-ctrlr-tests` (commit `9a24b19ab`)
- Diff: `brain/reviews/respondent-survey-ctrlr-tests.diff` (git diff main...HEAD)
- Base: `main` @ `28fdf8c4b`
- Cross-checked against the real source in the current main checkout only
  (survey.ctrlr.ts, router.ts, shared types/survey.factory/scoring.factory,
  frontend-respondents store/observable/services, backend survey.ctrlr.ts).
- Date: 2026-08-28

## Overall verdict: APPROVE_WITH_NITS

The R1 fix matches the acceptance contract precisely (correct and minimal, right
data source, no excluded-route impact) and the 7-case suite is non-vacuous and
asserts the real behavior of the controller. Gates verified by the orchestrator
(26/26 across 4 files; `survey-ctrlr` = 7; vite build green) are consistent with
the diff. The two non-blocking nits (below) do not block merge.

---

## Per-contract-item findings

### 1. R1 fix — correct and minimal: PASS

- **Root cause confirmed.** In `survey.ctrlr.ts` (main) `this.pool` is declared
  (`pool?: Pool`) but never assigned by the constructor, and the router stores
  only `{ id, pool: poolId }` — `poolId` is a string, not a `Pool`. So
  `render()` dereferencing `this.pool!.config` always threw
  `TypeError: Cannot read properties of undefined (reading 'config')` and landed
  in `renderWarning`. The success path was unreachable. The diff's diagnosis is
  accurate.

- **(a) Consistent with real shapes — PASS.**
  - `PoolConfig` in `shared/src/shared/survey/types.ts` carries
    `{ safe?, chainId?, litNetwork?, pkpId?, pkpDid?, groupId? }` — exactly what
    `setSurveyListener()` now reads and what is plumbed.
  - `fetchAndDecryptSurveyWithRespondent` returns `{ id, createdAt, ...d, ...config }`
    where `d` is the decrypted payload; the `config` field (a `PoolConfig`) genuinely
    lives on the decrypted survey — the same field the backend reads at
    `nillcc-backend/src/survey.ctrlr.ts:27` (`const { pkpId, pkpDid } = surveyConfig.config;`).
    So `this.poolConfig = (survey as any).config` after the decrypt await is the
    correct source. The `as any` cast is acceptable given `EncryptedConfig` in the
    shared types doesn't declare `config`, but the runtime shape carries it.
  - All referenced symbols are real exports of `@s3ntiment/shared`:
    `fetchAndDecryptSurveyWithRespondent` (survey.factory), `isScored`
    (results/scoring.factory, `(groups: QuestionGroup[]) => boolean`),
    `createUserDataObject` (response.factory), `PoolConfig` (types).

- **(b) No excluded-route/entry/card-seam impact — PASS.** The diff touches only
  `frontend-respondents/src/controllers/survey.ctrlr.ts`, adds the test file, and
  adds one audit doc under `brain/audits/`. `router.ts`, `auth.factory.ts`, the
  invalid-card/completed/about/used-card controllers, and the card-encoding seam
  are all untouched. No scope creep.

- **(c) Correct data source — PASS.** The implementation plums `poolConfig` out of
  the decrypted `config` rather than the naive
  `this.pool = surveyFromStore.pool` (which would be a string poolId and give no
  `.config.pkpId/pkpDid`), and does not fabricate a full `Pool`
  (`name`/`safeAddress`/`batches` are absent from the decrypted survey). Correct.

**Non-blocking observation on the R1 fix (noted, not blocking):** the
"success path becomes reachable" framing only literally holds once
`this.poolConfig` is already populated. In the actual router wiring, a
`SurveyController` is constructed fresh on `/surveys/:surveyId`, so at first
`render()` `this.poolConfig` is `undefined`, and it is passed as-is into
`fetchAndDecryptSurveyWithRespondent`, which dereferences `poolConfig.pkpId`
inside `services.lit.decrypt(...)`. On a first render this still throws (now
inside the shared fn rather than at the controller's argument evaluation) and
still lands in `renderWarning`. This is not a regression (pre-fix it threw too,
even earlier) and it is exactly the fix the contract specified — but the
contract's chicken-and-egg (need `poolConfig.pkpId` to decrypt, while the config
is only known after decrypt) is a pre-existing design concern outside this
diff's scope, and the success path is demonstrated in the suite by manually
priming `poolConfig`. Worth a follow-up to source `poolConfig` (or a prior
fetch) before the decrypt call, but not a blocker for this PR.

### 2. Test suite — intended cases present and non-vacuous: PASS

All 7 cases (`survey-ctrlr` = 7, matching the orchestrated 26-file total) are
present and assert real behavior, cross-checked line-by-line against the
controller:

1. **`render()` store-not-primed** → `alert("survey and pool not found")`, no
   shared fetch, no listener. Matches the real `else` branch.
2. **`render()` success path** → asserts fetch called with
   `(services, surveyStore, surveyId, poolConfig, undefined)`, `isScored(groups)`,
   `store.setSurveyData` + `store.persistSurveys`, `renderTemplate` producing
   mega-`<survey-questions survey-id="survey-abc">` in the shared fake element
   (non-vacuous: `reactive(...).bind(store.surveys$)` calls `render()` eagerly,
   so innerHTML is set), `setSurveyListener` registering `'survey-complete'`, and
   the R1 fixture pluming `poolConfig` out of the decrypted `config` — the key
   regression assertion.
3. **`render()` rejection** → `renderWarning` shows `Decryption failed: <msg>`,
   `console.error` called, no listener. Matches the real `catch`.
4. **`setSurveyListener()` happy submit** → asserts strict
   invocation-order (`createNillDBSeed` → `nillDB.init` → `crypto.randomUUID` →
   `signMessage('s3ntiment:submit')` → `fetch(POST .../delegation)` →
   `storeOwned`), the POST body shape (`userDid`, `signature`, `userAddress`,
   `poolId`, `pkpId`, `pkpDid`), `storeOwned(docId, survey, poolConfig, answers,
   surveyId, delegation)`, and `router.navigate('complete/{surveyId}/{docId}')`
   on `ok`. All match the controller body.
5. **`setSurveyListener()` non-ok** → `storeOwned` `{ok:false}` → no navigate.
   Matches `if (result.ok) router.navigate(...)`.
6. **`destroy()`** → destroys each reactive view and clears `reactiveViews`.
   Matches real `destroy()`.
7. **`process()`** → documented no-op, resolves `undefined`. Matches
   `async process() {}`.

Assertions are specific (exact args, invocation ordering, request body JSON),
so they are non-vacuous and would fail on real regressions.

### 3. Mocks appropriate, no silent masking: PASS

- `@s3ntiment/shared` stubs `fetchAndDecryptSurveyWithRespondent` (configurable
  via a hoisted `h.decryptImpl.current`), `isScored`, and the dead
  `createUserDataObject` import.
- `@s3ntiment/shared/components` and `../components/survey-questions.js` are
  stubbed to `{}` — correctly, since `survey-questions.ts` calls
  `customElements.define` at top level, which would throw in node.
- `../router.js` is faked with `router.navigate`. This resolution is consistent:
  the controller imports `{ router } from '../router.js'`, which vite resolves to
  `router.ts`, and the identical mock pattern is already used by the existing
  `auth-ctrlr.test.ts`, so the interception binds correctly.
- Browser stubs are in-file (beyond `test/setup.ts`): `document.addEventListener`
  capture plus a shared fake element (so `innerHTML` mutations from
  `renderLoading`/`renderTemplate`/the reactive view persist and are observable),
  `crypto.randomUUID` and `fetch` via `vi.stubGlobal` (correct for modern Node's
  getter/read-only globals), faked `alert`, `window.location`. No jsdom, matching
  the project's `vitest.config.ts` node-env policy.
- The shared fake element returning the same object for both `#app` and
  `#survey-content` is a reasonable stand-in given the controller writes/reads
  both selectors and the tests assert the rendered final innerHTML.

### 4. No out-of-scope changes: PASS

Confirmed — the diff changes only `survey.ctrlr.ts` (+20/−6), adds
`survey-ctrlr.test.ts`, and adds an audit doc. Nothing else.

---

## Non-blocking nits

1. **Production reachability (noted above, most substantive).** On a fresh
   controller the success path is demonstrated only because the test primes
   `(ctrl as any).poolConfig` before `render()`. With the current router wiring
   the first render still passes `undefined` as the pool config into the shared
   decrypt fn, which dereferences `poolConfig.pkpId` and would still throw.
   Recommend a follow-up that sources `poolConfig` before the first decrypt
   (or makes the shared fn tolerate a missing pkpId on the first call). Not a
   blocker for this PR since the fix is faithful to the contract and not a
   regression.
2. **Slight artificiality in the success test.** The comment
   ("config known before decrypt, e.g. from a prior fetch") describes a scenario
   the current router doesn't produce for a fresh controller. The manual
   pre-priming is acceptable — it exercises both the forward-before-decrypt and
   re-plumb-after-decrypt roles — but the two roles are conflated in one render,
   so the "pre-known config is forwarded" half is somewhat synthetic.
3. **Dead import.** `createUserDataObject` is imported by `survey.ctrlr.ts` but
   unused (pre-existing); the mock has to provide it so resolution succeeds.
   Cosmetic; could be dropped in a future cleanup.

---

## Conclusion

APPROVE_WITH_NITS. The R1 fix is correct and minimal and matches the contract's
specified approach and data source; the 7-case suite is non-vacuous and asserts
real controller behavior with appropriate mocks and no jsdom; and there is no
scope creep and no regression. The nits above are non-blocking and worth a
follow-up, particularly the note about sourcing pool config before the first
decrypt in the production wiring.

# All-packages coverage-gap inventory — 2026-08-28

**Scope:** read-only investigation across the whole monorepo, inventorying every
genuinely-remaining test-coverage opportunity and ranking by
(value-to-acquire) / (cost+risk). Nothing written or changed; this is a findings
report to pick the next high-value tranche.

**Grounding:** `git pull` on `main` → already up to date at
`b5e622671` (Merge PR #14). Every claim below was verified against current source,
not assumed. Already-covered items are listed in the prompt context and NOT
re-listed as gaps here.

---

## 0. Repository layout (confirmed)

Workspace packages (`pnpm-workspace.yaml`):
`shared`, `frontend-organiser`, `contracts`, `frontend-respondents`,
`protocol`, `nillcc-backend`, `website`, plus root `scripts/` (shell only).

Test infra present today:
| Package | Test runner | Config | Existing suites |
|---|---|---|---|
| contracts | hardhat (node test runner) | `package.json` `test: hardhat test` | `S3ntimentSurveyStore.test.ts` (30), `encoding.seam.test.ts` (5) |
| frontend-respondents | vitest | `vitest.config.ts` | auth.factory(9), auth-ctrlr(5), card-signature.seam(5), survey-ctrlr(7+R1), card-class.seam(11), router-entry-gates(9), card-url.round-trip(3), state stores(29), used-card-ctrlr(5), survey-questions(23) |
| frontend-organiser | vitest | `vitest.config.ts` | invitation.factory(14), survey.factory(3), hex(4), regex(7) |
| nillcc-backend | vitest | `vitest.config.ts` | SurveyController(8), PoolController(5), NilDBBuilderService(7), NillionPkpClient(8) |
| shared | **none** | none | 0 test files, no vitest dep, no `test` script |
| protocol, website, scripts | none | none | none |

**CI gap (cross-cutting, verified):** there is **no CI workflow anywhere** — no
`.github/workflows`, no CircleCI/GitLab/Azure/Jenkins/Taskfile/Makefile. No process
runs `hardhat test`, `check:abi`, or any of the three vitest suites on a merge.
All coverage is locally-executed at commit time. This is a coverage-adjacent
(orchestration) gap, detailed in Bucket 3.

---

## BUCKET 1 — HIGH value, low–medium cost (recommended next tranches)

### 1.1 « shared » — add a dedicated unit suite for the pure survey/results logic  ⭐ top pick

**What does NOT exist today (verified):** `shared/` has zero test infra, zero
`.test.ts` files, no `test` script, no vitest dependency. The only thing
exercised at all is `invites/encoding.ts`, and only indirectly via
`contracts/test/encoding.seam.test.ts` + the respondent seam tests. **All of the
rest of `shared/`'s pure logic has no direct test coverage, and — critically —
the backend controller tests mock the entire `@s3ntiment/shared` barrel away**
(confirmed in `survey.ctrlr.test.ts` `vi.mock('@s3ntiment/shared', ...)`), so the
real algorithms are not exercised by any consumer test either. They run only on
real deployments.

Genuinely-uncovered pure modules (leaf-level, import only viem/crypto/ecies —
cheap to test):
- `results/scoring.factory.ts` — `isScored`, `stripScoring` (scoring extraction
  vs. strip), `calculateScore` (pct rounding, `max==0` guard).
- `results/tabulate.ts` — `tallyResults` (text/radio/scale/checkbox/scored-single
  branches, scoringMap lookup).
- `survey/tally.ts` — `combineShares` (skips non-arrays, skips `_id`).
- `survey/response.factory.ts` — `prepareAnswers` (radio-index/scale-parse/
  checkbox-index/text fallback), `createUserDataObject` (checkbox/radio
  one-hot `%allot` encoding, `ensureAllot`).
- `survey/collection.factory.ts` — `createSurveyCollectionSchema` per question
  type (used by backend `create`).
- `survey/queries.ts` — `createSurveyAggregationQuery` (scale/radio/checkbox
  stages). Note: imports `randomUUID` from node crypto — fine in a node-env test.
- `nillion/did.ts` — `publicKeyToDidKey` (compressed-ECDSA prefix logic, base58).
- `helpers/retries.ts` `withRetry` + `helpers/timeout.ts` — signal/abort/retry
  semantics.

**Value:** these are the actual scoring / tabulation / response-shaping /
schema-generation algorithms the entire product's results pipeline depends on,
currently untested at their source of truth. Highest product-risk-per-LOC.
**Cost/risk:** LOW — all are pure functions; the seam tests already proved the
shared leaf modules import cleanly in both hardhat and vitest. Requires only:
add `vitest` (dev dep) + a `test` script to `shared/package.json` and
`vitest.config.ts` + the `*.test.ts` files. **No source refactor needed.**
Risk: the shared barrel exports node-native/peer deps (Lit/Nillion/d3); tests
must import the leaf modules directly (as the seam tests already do), **not** the
unbuilt barrel. This is the same import discipline already established.

*Tranche size estimate:* ~40–55 assertion-budget tests, one PR, no production
code touched.

### 1.2 « nillcc-backend » — NilDBBuilderService branch coverage (small seam)

**What is uncovered (verified):** the builder suite currently covers
encryptToBuilder/decryptFromBuilder, exists, getResponseById, createSurveyCollection
happy, getCollectionInfo-error. **Uncovered branches in real logic:**
- `submitResponseForUser(surveyId, userData)` — the *idempotent replace* flow:
  `exists()` → delete existing docs → `createStandardData`. Real conditional
  logic, zero coverage.
- `delegateCollectionToPkp()` / `getOwnerReadDelegation()` — delegation
  issuance (sign/caps/expiry); not covered.
- `findSurveyResults()` — calls `tallyResults` (the shared algorithm from 1.1);
  currently **blocked for testing by a hardcoded `await new Promise(r =>
  setTimeout(r, 5000))`**.
- `getBuilderProfile()`, `initBuilder()` — thin wrappers; low value.

**Value:** medium-high (submit/replace flow is a true correctness branch; tagging
it reinforces 1.1). **Cost:** medium — tests need a fake `builderClient` injected
(the class takes no ctor arg; it constructs `builderClient` in `initBuilder`), so
a pseudo-seam harness decision is needed. The `findSurveyResults` 5s delay should
be parameterized/throttle-injected (small source change) or left out of this
tranche.

### 1.3 « contracts » — residual branch tests (very small)

**Verified:** this is the most thoroughly-covered package. The 30 tests in
`S3ntimentSurveyStore.test.ts` touch **every external function** on the store
(createSurvey bootstrap/vs-existing/non-safe/dup/empty-args/batch-ignored;
updateSurvey ×3; all read getters incl. not-found; registerBatch ×6 incl. all
error branches; registerInPool ×10 incl. sig-wrong-length, v-out-of-range,
wrong-signer, EOA-caller, AlreadyPoolMember, nullifier-reuse, per-pool scoping).
The deploy path is exercised as the fixture (`loadAndExecuteDeploymentsFromFiles`
runs the real deploy script in every test). **There is NO NonUpgradeableProxy or
any deployment/upgrade path** — `rocketh/config.ts` imports `@rocketh/proxy`
(`deployViaProxy`) but the deploy script `001_deploy_survey_store.ts` uses plain
`env.deploy`; the store is non-upgradeable. So there is *nothing to test* there —
correctly so, not a gap.

Residual, genuinely-missing micro-branches (all LOW value / near-zero cost):
- `InvalidBatchId` during **createSurvey bootstrap** (zero-address batch in the
  initial `batchIds` array goes through `_registerBatch`; only exercised via
  `registerBatch`, not the bootstrap path).
- Multi-pool `getSafePools` / `getPoolBatches` ordering invariants (currently
  only single-entry asserted).
- `_recoverSigner` v-adjustment edge (`v=26 → 27` valid).

**Recommendation:** bundle into the shared tranche as a cheap add-on, or skip.
Not a standalone tranche.

---

## BUCKET 2 — MEDIUM value / needs a refactor or harness decision first

### 2.1 « nillcc-backend » HTTP layer (main.ts) — needs `createApp`/`createRouter` refactor

**Verified:** `main.ts` is **not importable in isolation**. It (a) `import './env.js'`
runs dotenv, (b) constructs real ViemService/LitService/IPFSMethods and calls
top-level `await initStorage()`, `await nildb.initBuilder()`, `new LitPoolKeys()`,
and (c) calls `app.listen(...)` + `startServer()` on import, with `app` never
exported. Any test import would try to build real network/service objects and bind
a port.

**Untested HTTP behavior living inline in main.ts:**
- the **`update` → `SURVEY_ID_MISMATCH` guard** (`req.params.id !==
  req.body.surveyConfig?.id` → 400) — the one item already logged as untested.
- `verifySignature` middleware (401 MISSING_SIGNATURE / INVALID_SIGNATURE,
  default-message construction).
- `/surveys/:surveyId/delegation` POST body passthrough (no try/catch; naive).
- `/lit/usage-key`, `/surveys/:id/score` (403 UNAUTHORIZED), `/results`
  (RESULTS_FAILED → 500 mapping), 404 fallback.

**Path:** extract a `createApp(deps)` / `createRouter(controllers)` returning the
express app without side effects, keeping the env/startup wiring in a thin
`main.ts` entry. This is the *only* route to cover the guard — confirmed, matches
the logged item. This is a real source refactor; medium cost, medium-high value
(HTTP contract semantics are user-visible). Signatures use `viem.verifyMessage`
(mockable) so no network needed after the refactor.

### 2.2 « frontend-organiser » orchestration controllers — need a harness decision

**Verified:** `new.ctrlr.ts.ts` (216 LOC) and `survey.ctrlr.ts` embed the real
multi-step orchestrations: `fetch()` to `${BACKENDURL}/api/pools`,
`/api/builder/register`, `/api/surveys`, `/api/surveys/:id/results`, plus
`services.safe.write(...createSurvey)` / `updateSurvey` / on-chain writes, plus
`store.*` mutations and `router.navigate`. `pool.ctrlr.ts` (249) and
`batch.ctrlr.ts` (263) are mostly DOM-rendering + store/UI tab logic.

Testing these requires a **jsdom/happy-dom harness + comprehensive mock** of
`services` (safe/viem/ipfs/waap/oprf), `fetch`, `router`, and `store`. That is a
harness decision, not a drop-in suite. There is no equivalent of the respondents'
`survey-ctrlr.test.ts` precedent (which tests a controller with a mocked-services
object) yet on the organiser side — but the pattern is proven.

**Medium-value sub-items worth pulling out first (behavior-preserving extractions):**
- `pool.factory.ts` `getPoolInfo` (35 LOC) — a thin `services.viem.read` wrapper
  (getPool + getPoolBatches + safe `getOwners`). Testable with a mocked
  `services` **today, no refactor**. **Also a likely latent bug**: `_batches.map(
  (b:any) => b.id)` on the `getPoolBatches` result — but the on-chain getter
  returns raw `address[]` (strings), so `b.id` is `undefined` unless the ABI wraps
  them. Worth a unit test that pins the correct contract shape (and would catch
  the bug).
- `auth.factory.ts` `authenticate` (6 LOC) — thin wrapper over
  `services.waap.signMessage` / `services.oprf` / `services.safe`. Testable with a
  mock; low value but near-zero cost on its own.
- `router.ts` `initRouter` — route-registration table; testable by mocking Navigo
  and the controller classes. Medium value (locks the route contract), medium
  cost (Navigo mock).

**Not a gap:** `utils/random.ts` / `utils/hex.ts` / `utils/regex.ts` — hex(4)+
regex(7) covered; `random.ts` (`randomBytes`/`bytesToHex`) is **dead code**
(imported nowhere; `invitation.factory` inlines its own crypto) — don't test it.

### 2.3 « contracts » — no additional value here; see 1.3

(Placed here only to note: the "some deploy/upgrade path worth testing" probe
resolves to **no path exists** — nothing to do, intentionally.)

---

## BUCKET 3 — Deliberately deferred / not worth it (incl. already-logged)

### Already logged / explicitly deferred (confirmed, do not re-add as gaps)
- **Cross-frontend bridge test** pending a test chain — deferred.
- **nillcc-backend HTTP-layer refactor** — matches 2.1 above (the only real
  path); deferred until a decision is made.
- **R1 first-render poolConfig fix** — deferred.
- **Respondents onboarding/entry screens** (invalid-card / completed / about /
  logout) — deliberately excluded by design; excluding is correct.

### Not worth it (newly confirmed, dead/dormant/no-value)
- **`frontend-respondents/src/utils.factory.ts` `decimalToHex`** — confirmed
  **dead code**: defined, imported nowhere in the repo. Do not test; delete or
  leave.
- **`frontend-respondents/src/components/security-questions.ts`**
  `SecurityQuestionsForm` — confirmed **dormant**: registers a custom element
  (`security-questions-form`) but is imported by no other module. Not wired into
  the app. No value until it's actually used. Deferred.
- **`frontend-respondents/src/services.ts` bootstrap** (`ServiceContainer`) —
  heavy `import.meta.env` + network/service construction at initialize(); not
  testable without an env/harness, and the individual services are the shared
  barrel. Deferred (also, the barrel mock ceiling applies here like the backend).
- **`frontend-respondents/src/onpageload.ts` `removeSplash`** — trivial DOM
  util; not worth a suite.
- **`frontend-respondents/src/ux.factory.ts`** — static `ERROR_MESSAGES` map;
  trivial. Could be a 1-2 test add-on if ever bundled, but no standalone value.
- **`protocol/`** — operational one-off scripts (`get-sponsored`, `fund-myself`,
  `delegate-user`) driving live Lit network; not realistically unit-testable and
  low value. Skip.
- **`website/`** — static marketing HTML + `build-css.ts`; its `package.json`
  even declares `"test": "echo \"Error: no test specified\""`. No logic.
- **`scripts/`** — shell dev launchers. No value.
- **organiser `utils/random.ts`** — dead code (see 2.2).

### Infrastructure (coverage-adjacent) — flag, not a code tranche
- **No CI workflow exists.** Nothing runs `hardhat test` + `check:abi` + the
  three `vitest run` suites on push/merge. All gates are local-only. Adding a
  root-level CI workflow (`pnpm install --frozen-lockfile` → filter-build shared →
  contracts `test` + `check:abi` → organsiser/respondents/backend `test`) would
  convert every past and future tranche's coverage into an enforced gate and is
  arguably the highest-leverage single action for coverage *durability*. Cost is
  low (no refactor); it is not a "test" but directly protects the value of every
  tranche above.

---

## Recommended next tranches (ranked)

1. **« shared » dedicated pure-logic unit suite** (scoring / tabulate /
   combineShares / response / collection-schema / aggregation-query /
   publicKeyToDidKey / withRetry). Highest
   value-per-effort: the algorithms are untested at source, hidden behind a
   barrel mock in the backend, and the tranche is pure (near-zero cost, no
   refactor, established leaf-import discipline). *Deliverable: vitest dep + test
   script in shared + ~40–55 tests.*
2. **« nillcc-backend » NilDBBuilderService branches** — `submitResponseForUser`
   (idempotent replace), `delegateCollectionToPkp`/`getOwnerReadDelegation`;
   requires a faked `builderClient` injection seam and, optionally,
   parameterizing the 5s delay in `findSurveyResults`. Medium cost, medium-high
   value; do *after* 1 so `tallyResults` assertions are real.
3. **Contracts micro-branches** (bootstrap `<InvalidBatchId>`, multi-pool
   ordering, `v=26`) — fold into 1 as a cheap add-on or skip; the package is
   otherwise essentially complete.
4. **HTTP-layer refactor + tests** (`createApp`/`createRouter` to expose the
   `SURVEY_ID_MISMATCH` guard, `verifySignature`, delegation/score/results
   routes) — a deliberate, decision-worthy refactor; value deferred until 1–3
   land.
5. **Organiser orchestration-controller harness** (`new.ctrlr` + `pool`/
   `survey`/`batch.ctrlr`, plus the cheap `pool.factory.getPoolInfo` /
   `auth.factory.authenticate` / `router.ts` extractions) — biggest effort,
   needs a harness decision; the `getPoolInfo` `.map(b=>b.id)` shape is worth a
   unit test on its own to pin (or catch) the contract shape.
6. **CI workflow** — infrastructure gate; pairs naturally with any tranche above
   and should ideally land alongside 1 so the new suite is enforced.

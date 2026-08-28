# nillcc-backend — First Tranche of Tests

Date: 2026-08-28
Branch: `deepseek/nillcc-backend-tests` (from `main` @ `bd9da7a48`)
Worktree: `/home/joera/code/worktrees/s3ntiment-nillcc-backend-tests`
Package: `@s3ntiment/nillcc-backend` (`nillcc-backend`, double-L)

Grounding doc: `brain/audits/nilcc-backend-exploration-2026-08-28.md`.

---

## What was added

### 1. Vitest wiring (mirrors `frontend-respondents`)
- `nillcc-backend/package.json`: added `vitest ^4.1.11` to `devDependencies` and a
  `"test": "vitest run"` script.
- `nillcc-backend/vitest.config.ts`: `environment: 'node'` (no jsdom),
  `include: ['src/**/*.test.ts']`, `setupFiles: ['./test/setup.ts']`.
- `nillcc-backend/test/setup.ts`: guarantees benign env at module-load time so the
  NilDB builder service can be constructed without a real `.env`/creds:
  `VITE_NIL_BUILDER_PRIVATE_KEY` (deterministic dev key) and `VITE_NILDB_NODES`.
- `nillcc-backend/tsconfig.json`: appended `src/**/*.test.ts` to `exclude` so the
  `tsc` build emits no test files to `dist` (mirrors the frontend, which never emits
  tests via its Vite build). No production source or `main.ts` was modified.

### 2. Test files (all under `src/**`, matching the vitest include glob)

| File | Target | Suite size |
|---|---|---|
| `src/survey.ctrlr.test.ts` | `SurveyController` | 8 tests |
| `src/pool.ctrlr.test.ts` | `PoolController` | 5 tests |
| `src/services/nildb.builder.service.test.ts` | `NilDBBuilderService` | 7 tests |
| `src/services/nildb.pkp.service.test.ts` | `NillionPkpClient` | 8 tests |

**Total: 4 files, 28 tests.**

### Coverage per contract item

- **SurveyController** (`survey.ctrlr.test.ts`): `create` happy path (stripScoring /
  isScored / schema + aggregation-query delegation, queryIds recorded, dual lit.encrypt,
  builder-side encryptToBuilder, IPFS upload, CID returned); `update` happy path
  (re-encrypt + upload with surveyId/poolId/queryIds/isScored); `get` happy path (on-chain
  read → IPFS fetch → `encryptedScoring` stripped) **and the 404 driver** (returns `null`
  when no cid is stored); `score` happy path (calculateScore over decrypted scoring +
  existing response), no-response → `false`, unscored survey → `null`; `getUserDelegation`
  (fetchSurveyAndParseCid + PKP client write-delegation delegation).
- **PoolController** (`pool.ctrlr.test.ts`): `create` happy path (PKP + action CIDs +
  group + usage key + publicKeyToDidKey, `{ pkpId, pkpDid, groupId }` returned) and the
  two controller-level failure returns (`missing poolId`, `missing safeAddress`);
  `update` — **confirmed it is currently a no-op**: asserts it resolves `undefined` and
  performs no work (no invented behavior); `registerBuilder` happy path (usage key lookup +
  `NillionPkpClient.registerAsBuilder` with the 6 expected args, `{ ok: true }`).
- **NilDBBuilderService** (`nildb.builder.service.test.ts`): real `encryptToBuilder`/
  `decryptFromBuilder` ecies **round-trip** against a locally-derived signer key+did (no
  network); construction succeeds with the setup env; `exists` / `getResponseById` /
  `createSurveyCollection` / `getCollectionInfo` (incl. error → `null`) against an injected
  fake `builderClient` (the SecretVaultBuilderClient collaborator).
- **NillionPkpClient** (`nildb.pkp.service.test.ts`): fakes `this.lit.executeAction`,
  mocks global `fetch`, and asserts the exact hardcoded nil-node REST URL + method +
  headers + body and response handling: `registerAsBuilder` (3 nodes, bearer token, body
  `{did,name}`, status map; plus invocation-failure → `undefined`), `createCollection`,
  `createQuery`, `runQuery` (body `{_id, variables:{}}`, runIds per node did),
  `readQueryResults` (GET `/v1/queries/run/:runId`, completed-only → `combineShares`),
  `getUserWriteDelegation` (executeAction params + delegation returned). Zero network.

## Shared / seam usage
- Both controllers and `NillionPkpClient` import the **unbuilt, gitignored**
  `@s3ntiment/shared` barrel. Per the contract's option (b) and the
  `frontend-respondents/src/controllers/auth-ctrlr.test.ts` precedent, each test file
  `vi.mock('@s3ntiment/shared', ...)` with the specific helpers it exercises
  (`stripScoring`, `isScored`, `createSurveyCollectionSchema`, `createSurveyAggregationQuery`,
  `fetchSurveyAndParseCid`, `calculateScore`, `combineShares`, `compactAction`,
  `ownerInvocationAction`, `userDelegationAction`, `publicKeyToDidKey`, `tallyResults`).
  This keeps tests deterministic and offline regardless of whether `shared/dist` exists.
- In-package `NillionPkpClient` is also `vi.mock`'d inside the controller tests so the
  controller surface can be tested without driving the real client.
- `s3ntiment-contracts/deployments/base/S3ntimentSurveyStore.json` is imported for real
  (committed, local file) via the bare specifier + `with { type: 'json' }`.
- DI seams: both controllers and the PKP client use constructor-injected `any` deps, so all
  collaborators are hand-rolled fakes.

## Zero-network guarantee
- `@s3ntiment/shared` is mocked (no real Lit/Viem/IPFS). NilDB builder helpers are tested
  via local key derivation + eciesjs only. Global `fetch` is stubbed in the PKP client
  tests; no Lit / NilDB / IPFS / Base RPC calls are made. `test/setup.ts` supplies env so
  no `.env`/creds are required.

## Gates (run locally in the worktree)

### Test
```
pnpm --filter @s3ntiment/nillcc-backend test
Test Files  4 passed (4)
     Tests  28 passed (28)
```

### Build (tsc, production dist — tests excluded, still green)
```
pnpm --filter @s3ntiment/nillcc-backend build
$ tsc   # exit 0
```
`dist` contains no `*.test.*` files (verified: 0).

## Note: `main.ts` HTTP-layer refactor (follow-up needed)
Per contract item 7, this tranche deliberately excludes the Express HTTP / `main.ts` layer:
no live-server route tests, no `export app`, no importing `main.ts` (it triggers top-level
network side effects + `app.listen`). Consequently the **route-table status mappings that
live in `main.ts`** — `update → 400 SURVEY_ID_MISMATCH` (guard `req.params.id !==
body.surveyConfig?.id`), `score → 403 UNAUTHORIZED` (inline `isPoolMember` check), and the
wrapper `500 CREATE_FAILED / SCORE_FAILED / ...` mappings — are **not** covered at the HTTP
level in this tranche. The controller-level semantics that feed them *are* covered
(e.g. `get` → `null` drives 404; `score` unscored → `null`). Before HTTP-layer tests
(`supertest`-style), `main.ts` needs a refactor to an exported `createApp(deps)` /
`createRouter(deps)` factory with dependencies injected, so route handlers can be mounted
without a port and without top-level side effects.

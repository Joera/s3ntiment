# nilcc-backend — Exploration Findings (for test authoring)

Date: 2026-08-28
Scope: read-only exploration. No code/tests written.
Repo: `/home/joera/code/s3ntiment` (monorepo, pnpm workspace, git `main`).

> ⚠️ **Naming note:** the package directory is **`nillcc-backend`** (double‑L), not `nilcc-backend`. Exact path: `/home/joera/code/s3ntiment/nillcc-backend`. Package name: `@s3ntiment/nillcc-backend`.

---

## 1. Location & tech stack

| Attribute | Value |
|---|---|
| Exact path | `/home/joera/code/s3ntiment/nillcc-backend` |
| Package name | `@s3ntiment/nillcc-backend`, version `1.0.0` |
| Framework | **Express 4** (`express ^4.18.2`) — yes there is a framework |
| Language | **TypeScript**, `"strict": true` |
| Module system | **ESM** (`"type": "module"`), `module: NodeNext`, `moduleResolution: NodeNext` — source files import with explicit `.js` extensions (e.g. `./survey.ctrlr.js`) |
| Package manager | **pnpm** (monorepo workspace member; listed in `pnpm-workspace.yaml`) |
| Build | `tsc` → `dist/` (`rootDir: ./src`, `outDir: ./dist`) |
| Dev run | `tsx watch src/main.ts` |

### package.json (full)
See `/home/joera/code/s3ntiment/nillcc-backend/package.json`.

- **scripts:** `dev` = `tsx watch src/main.ts`; `build` = `tsc`; `start` = `node dist/main.js`. **No `test` script.**
- **dependencies:**
  - Nillion: `@nillion/blindfold ^0.1.0`, `@nillion/client-web ^0.6.0`, `@nillion/nilai-ts ^0.3.0`, `@nillion/nuc ^2.0.0`, `@nillion/secretvaults ^3.0.0`
  - Lit: `@lit-protocol/auth-helpers ^8.2.1`, `@lit-protocol/lit-client ^8.3.1`, `@lit-protocol/networks ^8.4.1`
  - Crypto: `@noble/curves ^2.0.1`, `@noble/hashes ^2.0.1`, `eciesjs ^0.4.18`, `multiformats ^13.4.2`
  - Web3: `viem ^2.41.2`
  - Web server: `express ^4.18.2`, `cors ^2.8.5`, `dotenv ^16.6.1`, `fs 0.0.1-security`
  - Bundling: `vite ^7.1.9`, `vite-plugin-node-polyfills ^0.24.0`
  - Local workspace: `@s3ntiment/shared` = `file:../shared`; `s3ntiment-contracts` = `file:../contracts`
- **devDependencies:** `@types/cors ^2.8.17`, `@types/express ^4.17.21`, `@types/node ^24.10.14`, `esbuild ^0.27.3`, `tsx ^4.7.0`, `typescript ^5.3.3`
- **pnpm.overrides:** `libsodium-wrappers-sumo` and `libsodium-wrappers` pinned to `0.7.13`.

### tsconfig.json
`../../nillcc-backend/tsconfig.json` — ES2022 lib/target, NodeNext module & resolution, `strict`, `esModuleInterop`, `resolveJsonModule`, `skipLibCheck`, `outDir ./dist`, `rootDir ./src`, `include: ["src/**/*"]`. Note `resolveJsonModule` is on, but the code actually imports contract JSON via the **import-attributes** syntax (`with { type: 'json' }`), which is what matters.

---

## 2. What it does — source map

```
nillcc-backend/
├── package.json, tsconfig.json, .dockerignore
├── Dockerfile, docker-compose.yaml, deploy.sh, deploy2.sh, ideploy.sh   (deployment; not code)
└── src/
    ├── main.ts                        # Express app + routes + server startup (the entry point)
    ├── env.ts                         # dotenv loading (loads ../../.env then process cwd)
    ├── survey.ctrlr.ts                # SurveyController (create/update/get/score/getUserDelegation)
    ├── pool.ctrlr.ts                  # PoolController (create/update/registerBuilder)
    ├── contract.factory.ts            # viem read client → S3ntimentSurveyStore.getSurvey (base)
    ├── key.management.ts              # commented-out cron key-rotation stub (dead)
    └── services/
        ├── nildb.builder.service.ts   # NilDBBuilderService (builder client + ecies encrypt/decrypt)
        ├── nildb.pkp.service.ts       # NillionPkpClient (PKP invocation → NilDB REST)
        └── nillai.service.ts          # fully commented out (dead)
```

### Entry point — `src/main.ts`
Runs on import (top-level side effects, see §5). Order of operations:
1. `import './env.js'` (must be first).
2. Creates `const app = express()`, applies `cors()`, `express.json({limit:'10mb'})`, `express.urlencoded(...)`.
3. Reads env into module constants.
4. Constructs services: `new ViemService(base, ALCHEMY_KEY)`, `new NilDBBuilderService()`, `new LitService({...})`, `await initStorage()`, `new LitPoolKeys()`, `new IPFSMethods(KUBO_ENDPOINT, PINATA_JWT, PINATA_GATEWAY)`, `new PoolController(...)`, `new SurveyController(...)`, `await nildb.initBuilder()`.
5. Defines `verifySignature` middleware (see note below).
6. Builds router, mounts at `/api`, adds 404 fallback, **`app.listen(PORT)`** where `PORT = process.env.PORT || 8080`.

### HTTP routes (all under `/api` prefix)
| Method+path | Handler → controller method | Notes |
|---|---|---|
| `POST /api/pools` | `pool.create` | 201 or 500 `CREATE_FAILED` |
| `POST /api/surveys` | `survey.create` | body `{surveyConfig, safeAddress, idempotencyKey?}` → `{cid}` |
| `GET /api/surveys/:id` | `survey.get` | 404 `NOT_FOUND` if absent; returns config w/ `encryptedScoring` stripped |
| `PUT /api/surveys/:id` | `survey.update` | 400 `SURVEY_ID_MISMATCH` on id mismatch |
| `POST /api/surveys/:id/score` | `survey.score` | inline signature + `viem.read isPoolMember` check → 403 `UNAUTHORIZED` |
| `POST /api/surveys/:id/results` | inline → `NillionPkpClient.runQuery/readQueryResults` | owner-only; uses `litPoolKeys.get`, builds `new NillionPkpClient` inline |
| `POST /api/surveys/:surveyId/delegation` | `survey.getUserDelegation` | no try/catch on body usage |
| `POST /api/builder/register` | `pool.registerBuilder` | no try/catch |
| `POST /api/lit/usage-key` | inline | `viem.publicClient.verifyMessage` → 401 `INVALID_SIGNATURE`; returns pooled usage key |
| *(commented out)* `POST /api/surveys/:id/submit` | — | disabled block |
| 404 fallback | — | `app.use((req,res)=>res.status(404).json({error:'NOT_FOUND'}))` |

> **Middleware note:** `verifySignature` (defined at `main.ts` ~line 40) is **never mounted** — no `app.use`/`router.use` attaches it, so it's dead code. Every route that needs auth does its own **inline** signature verification. There is no shared auth middleware.

### Controllers (exported classes — the primary DI seams)
- **`SurveyController`** (`src/survey.ctrlr.ts`): `constructor(nildb, lit, litPoolKeys, ipfs, viem)` (all typed `any`). Methods: `create(body)`, `update(body)`, `get(surveyId)`, `score(surveyId, signerAddress)`, `getUserDelegation(signature, userAddress, poolId, poolConfig, surveyId, userDid)`.
- **`PoolController`** (`src/pool.ctrlr.ts`): `constructor(lit, litPoolKeys, nillDB)` (all `any`). Methods: `create(body)`, `update(body)` (empty), `registerBuilder(body)`.

### Services (exported classes)
- **`NilDBBuilderService`** (`src/services/nildb.builder.service.ts`): wraps `@nillion/secretvaults` `SecretVaultBuilderClient`. Methods: `initBuilder()`, `getBuilderProfile()`, `getCollectionInfo`, `createSurveyCollection`, `submitResponseForUser`, `testDelegationFormat`, `delegateCollectionToPkp`, `getOwnerReadDelegation`, `findSurveyResults`, `exists`, `getResponseById`, **`encryptToBuilder(data)`** and **`decryptFromBuilder(base64)`** (pure-ish ecies helpers), `getNodeInfo`. Reads env `VITE_NIL_BUILDER_PRIVATE_KEY`, `VITE_NILDB_NODES` at module load.
- **`NillionPkpClient`** (`src/services/nildb.pkp.service.ts`): `constructor(lit, poolId, safeAddress, contract)`. Hardcoded `private nodes = [3 staging nil URLs+dids]`. Methods all hit Lit `executeAction` then **`fetch()` to nil node REST**: `registerAsBuilder`, `createCollection`, `createQuery`, `getUserWriteDelegation`, `runQuery`, `readQueryResults`.
- **`contract.factory.ts`**: module-level `createPublicClient({chain: base, transport: http(process.env.BASE_RPC_URL)})` then exported `getSurvey(owner, surveyId)`. Uses only env `BASE_RPC_URL`.

### External integrations (network-touching)
- **Lit Protocol** — via `@s3ntiment/shared` `LitService` (createPkp, getActionCid, registerAction, createGroup, createUsageKey, executeAction, encrypt).
- **Nillion NilDB** — via `NilDBBuilderService` (builder client) and `NillionPkpClient` (raw REST to staging nodes).
- **IPFS / Pinata / Kubo** — via `IPFSMethods` (`uploadToPinata`, `fetchFromPinata`).
- **Base chain** — via `ViemService` / viem public client + `S3ntimentSurveyStore` ABI (deployment JSON).
- **Local disk** — `@s3ntiment/shared/node` `initStorage`/`LitPoolKeys` persist pool-usage keys to `.data/pool-keys/*.json` (gitignored).

---

## 3. Existing test setup

- **No test runner is wired into nillcc-backend.** No `test` script, no `vitest`/`jest`/`node:test` config, no `*.test.*` / `*.spec.*` files anywhere under `nillcc-backend`. `tsconfig.json` has no none-of-property for tests.
- Tests would need to be **added from scratch**. Precedent within the monorepo (follow this pattern):
  - `frontend-respondents` uses **vitest** (`vitest@4.1.11` in lockfile) with `test: "vitest run"`, a `vitest.config.ts` (`environment: 'node'`, `include: ['src/**/*.test.ts']`, `setupFiles: ['./test/setup.ts']`, plus `resolve.alias` to neutralize `react`/`react-dom`).
  - Existing test files for reference: `frontend-respondents/src/auth.factory.test.ts`, `frontend-respondents/src/card-signature.seam.test.ts`, `frontend-respondents/src/controllers/auth-ctrlr.test.ts`.
  - The `auth-ctrlr.test.ts` uses `vi.mock('@s3ntiment/shared', () => ({...}))` and `vi.mock('@s3ntiment/shared/components', ...)` to stub the shared package — a directly reusable pattern for nillcc tests (which import bare `@s3ntiment/shared`).
  - `card-signature.seam.test.ts` imports shared **source .ts by relative path** (`../../shared/src/shared/invites/encoding.js`) to avoid the unbuilt dist.
- To run: build or alias shared first (see §5), then e.g. `pnpm --filter @s3ntiment/nillcc-backend test` after adding vitest + a test script. `vitest@4.1.11` and `vite@7.3.1` are already present in the pnpm workspace lockfile.

---

## 4. Framework / runtime seams for testing

- **Express app is NOT exported and is created at module top-level.** `main.ts` constructs the app, and calling `startServer()` at the bottom invokes `app.listen(PORT)` on import. There is **no server/app factory** and **no way to invoke the route handlers without binding a port** in the current shape. Two refactors would unlock handler-level tests:
  1. Extract the router/handlers into an exported factory (e.g. `createApp(deps)` returning the Express app), or
  2. `export { app }` from `main.ts` and guard `startServer()` so import does not listen (or drive via `app.listen(0)` / a proper test server like `supertest`).
- **Additionally, importing `main.ts` currently triggers real network side effects** (LitService constructor, `initStorage`, `nildb.initBuilder()`, service construction with env reads). Test authoring must either (a) mock `@s3ntiment/shared` and stub env, or (b) refactor main into a factory with injected deps.
- **Strong existing DI seams (no refactor needed):** both controllers and services are plain exported ES classes with **constructor-injection** of collaborators typed `any`. You can construct `new SurveyController(fakeNildb, fakeLit, fakeLitPoolKeys, fakeIpfs, fakeViem)` / `new PoolController(fakeLit, fakeLitPoolKeys, fakeNildb)` with hand-rolled fakes and call methods directly. This is the cleanest place to start tests — **the controller/service public methods are the primary test surface**.
- **Request/response parsing** is done by Express middleware (`express.json`, `express.urlencoded`); route bodies are plain JS objects. Responses are `res.status(...).json(...)`. Handler logic is inside `async (req,res)=>` closures — to test HTTP-level behavior (status codes, error mapping) you still need the app object or supertest-style integration.

---

## 5. `@s3ntiment/shared` reachability (important)

- nillcc-backend imports shared **only via the bare specifiers** `@s3ntiment/shared` and `@s3ntiment/shared/node`.
- `shared/package.json` maps these to **build outputs**: `.` → `./dist/shared/index.js` and `./node` → `./dist/node/index.js`.
- **`shared/dist` does NOT exist** (it's in `.gitignore` as `**/dist` and is not built). Therefore **bare `@s3ntiment/shared` imports will not resolve** until `pnpm --filter @s3ntiment/shared build` (`tsc`) is run.
- **Precedent for tests:** other test work imports shared **source .ts by relative path**, e.g. `../../shared/src/shared/invites/encoding.js` (from `frontend-respondents/src/`), using the NodeNext `.js`-extension-on-`.ts` convention. The equivalent relative entry for nillcc would be:
  - main barrel: `/home/joera/code/s3ntiment/shared/src/shared/index.ts` (exports evm/lit/ipfs/nillion/survey/invites/results/helpers),
  - node subpath barrel: `/home/joera/code/s3ntiment/shared/src/node/index.ts` (re-exports `../shared/index.js`, `lit.key-storage.js`, `lit.pool-keys.js`).

  So a test can import `../../../shared/src/shared/survey/…` or `../../../shared/src/node/lit.pool-keys.ts` directly to avoid building dist. Alternatively, `vi.mock('@s3ntiment/shared', ...)` stubs the whole package (the `auth-ctrlr.test.ts` precedent).
- `@s3ntiment/shared/node` provides: `initStorage()`, and class `LitPoolKeys` (in-memory `Map` + JSON persistence to `.data/pool-keys`). `LitService`, `ViemService`, `IPFSMethods` come from the main barrel.
- `s3ntiment-contracts` JSON import: `import surveyStore from 's3ntiment-contracts/deployments/base/S3ntimentSurveyStore.json' with { type: 'json' }` — the file **exists** at `/home/joera/code/s3ntiment/contracts/deployments/base/S3ntimentSurveyStore.json`, reachable via `file:../contracts`.

### Shared symbols nillcc-backend depends on (for mocking/aliasing)
From `@s3ntiment/shared`: `ViemService`, `LitService`, `IPFSMethods`, `compactAction`, `encryptAction`, `getDecryptForOwnerAction`, `getDecryptForRespondentAction`, `getPkpPublicKeyAction`, `ownerInvocationAction`, `userDelegationAction`, `publicKeyToDidKey`, `createSurveyAggregationQuery`, `createSurveyCollectionSchema`, `fetchSurveyAndParseCid`, `isScored`, `stripScoring`, `calculateScore`, `tallyResults`, `combineShares`, `withRetry`, and types `EncryptedConfig`, `PoolConfig`, `QuestionGroup`, `Survey`. From `@s3ntiment/shared/node`: `initStorage`, `LitPoolKeys`.

---

## 6. Environment / config and testability

### Env vars used
| Var | Used by | Notes |
|---|---|---|
| `VITE_NIL_BUILDER_PRIVATE_KEY` | `NilDBBuilderService` (module-load) | signing key; empty → `Signer.fromPrivateKey("")` may throw at construct time |
| `VITE_NILDB_NODES` | `NilDBBuilderService` (module-load) | comma-split; empty → `[""]` |
| `VITE_PINATA_JWT`, `VITE_PINATA_GATEWAY` | `main.ts` → `IPFSMethods` | |
| `VITE_KUBO_ENDPOINT` | `main.ts` → `IPFSMethods` | |
| `VITE_ALCHEMY_KEY` | `main.ts` → `ViemService` | |
| `VITE_LIT_NETWORK` | `main.ts` → `LitService` | `'prod'` vs dev |
| `VITE_LIT_API_ACCOUNT_KEY` / `VITE_LIT_API_DEV_ACCOUNT_KEY` | `main.ts` | |
| `PORT` | `main.ts` | default `8080` |
| `BASE_RPC_URL` | `contract.factory.ts` | viem transport |
| `NILLION_API_KEY` | `nillai.service.ts` (commented out) | dead |

`.env` is loaded by `src/env.ts` from `../../.env` (repo root) then cwd. **No `.env` currently exists at repo root** — nothing is committed (`.gitignore` ignores `**/.env`). Running the real server therefore requires providing these via a local `.env` / process env, plus live Lit, NilDB, Pinata, and Base network access.

### Pure / easily-testable vs network-touching
**Pure-ish / unit-testable with fakes:**
- `NilDBBuilderService.encryptToBuilder / decryptFromBuilder` (ecies round-trip; needs a valid builder key/DID initialized).
- `IPFSMethods.isCID` (regex — fully pure, no network).
- Shared helpers used by controllers (`calculateScore`, `stripScoring`, `isScored`, `tallyResults`, `compactAction`, action builders) — pure, import by relative path.
- Controller/service **method logic against injected fakes** (no real network needed if you stub the collaborators).
- `NillionPkpClient` methods can be tested by substituting a fake `this.lit` and mocking global `fetch` (they call `fetch(`${node.url}/v1/...`)`).

**Network / integration-bound (mock or skip):**
- `initStorage` / `LitPoolKeys.set` (disk writes), `LitService` (real Lit API), `SecretVaultBuilderClient`/`initBuilder` (real NilDB), all `fetch` calls in `NillionPkpClient`, `ViemService.read` / public client (real Base RPC), `IPFSMethods` upload/fetch (Pinata/Kubo).

### Cleanest test seams (ranked)
1. **Controller classes** (`SurveyController`, `PoolController`) via constructor injection — default to fakes for deps.
2. **Service classes** (`NilDBBuilderService`, `NillionPkpClient`) — inject fake `lit`, mock `fetch`.
3. **Shared pure helpers** by relative source import.
4. **Express route/HTTP layer** — only after refactoring `main.ts` to export an app/factory (or testing with a real listen on a random port + HTTP client), because handlers are inline closures and the app isn't exported.

---

## 7. Git state

- **Branch:** `main`, up to date with `origin/main`. HEAD = `bd9da7a48` = **"Merge pull request #7 from Joera/deepseek/ht-respondent-auth-tests"** — confirms PR #7 was merged and pulled, as expected.
- **Worktree:** `nillcc-backend` lives in the **main worktree** `/home/joera/code/s3ntiment` (it is *not* in a separate worktree; the other branches/worktrees under `/home/joera/code/worktrees/*` also each contain a copy, but the canonical tracked location is the main tree).
- Working tree is otherwise clean except: a tracked modification to `brain/specs/RFC-deferred-identity-persistence.md`, and untracked `brain/audits/*` exploration docs (this report is an audit doc) plus `.s3n-orchestrator/` and `brain/reviews/`.
- `nillcc-backend` tracked files (all source listed in §2) are committed; `dist/`, `node_modules`, `.env`, and `.data/pool-keys/*.json` are gitignored.

---

## Summary for test authoring

- Test **unit-level** against `SurveyController` / `PoolController` / `NilDBBuilderService` / `NillionPkpClient` via constructor-injected fakes (all deps are `any`, so no typing friction).
- Import shared **by relative source path** (`../../../shared/src/shared/...`, `.js`-extension convention) or `vi.mock('@s3ntiment/shared', ...)`; shared `dist` is unbuilt/gitignored.
- Add **vitest** (lockfile already has `vitest@4.1.11`); mirror `frontend-respondents/vitest.config.ts` (`environment: 'node'`, `include: ['src/**/*.test.ts']`).
- The **Express/HTTP layer is currently untestable in isolation** without a `main.ts` refactor (app not exported, listens on import, top-level network side effects) — flag this as the primary seam to address before HTTP-level tests.

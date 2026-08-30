# HT Respondent Frontend — Auth-Surface Exploration (for test authoring)

**Date:** 2026-08-28
**scope:** read-only exploration (no code/test written)
**Branch/commit:** repo `main` @ `f422e8ca4` (HEAD; includes merged `272a122a3` shared-encoding work)
**Related audits:** `brain/audits/shared-encoding-2026-08-28.md`, `brain/audits/seam-coverage-exploration-2026-08-28.md`

---

## 1. Locate the ht respondent frontend + tech stack

- **Exact path:** `/home/joera/code/s3ntiment/frontend-respondents` (pnpm workspace member `frontend-respondents`, v1.0.0)
- **Framework:** **vanilla TypeScript, no React/Vue.** Uses native `HTMLElement` custom elements (`src/components/security-questions.ts`, `src/components/survey-questions.ts`, plus shared components from `@s3ntiment/shared/components`), a home-grown `reactive()` DOM helper (`src/utils/reactive.ts`), and shared token/style injectors from `@s3ntiment/shared/assets`. `vite.config.js` even aliases `react`/`react-dom` to `src/empty-module.ts` to neutralize any transitive React deps.
- **Routing:** **Navigo** (`navigo@^8.11.1`), configured in `src/router.ts`.
- **State:** custom observable stores under `src/state/` (no Redux/Zustand): `store.ts`, `ui.store.ts`, `user.store.ts`, `surveys.store.ts`, `pool.store.ts`, `observable.ts`, `storage.ts` (localStorage), `store.types.ts`.
- **Build tool:** **Vite 7.3.1** (`vite.config.js`, `"type": "module"`). Dev server port 9999. Plugins: `wasm`, `topLevelAwait`, `viteStaticCopy` (mishtiwasm wasm), `nodePolyfills`. Resolve alias for `libsodium-wrappers-sumo`.
- **TypeScript:** yes — `tsconfig.json` (`strict`, `module: ESNext`, `moduleResolution: bundler`, `target ES2020`, DOM+ES2020 lib). **No `typecheck`/`tsc` script**; `vite build` is the only gate.
- **Package manager:** **pnpm** (repo-level `pnpm-workspace.yaml`, root `overrides` pin `viem 2.46.2`, `@lit-protocol/networks 8.4.1`, libsodium, nillion).
- **Test runner / framework: NONE configured.** `package.json` `"test"` is a stub (`echo "Error: no test specified" && exit 1`). No vitest/jest/playwright dependency or config exists. (`pnpm-lock.yaml` + `.vite/deps` exist in this dir; `node_modules` is currently **not installed** in this checkout.)

**Scripts (`frontend-respondents/package.json`):** `test` (stub), `dev` (vite), `build` (vite build), `preview`.

---

## 2. The auth controller / module

### Primary auth module — `src/auth.factory.ts`
Exports the two functions the whole auth surface is built on:

- **`authenticate(services: IServices, poolId: string): Promise<boolean>`** — the core "login" flow, in order:
  1. `await services.waap.login(base)` — opens the Human/WaaP (Silk) wallet (email/phone) and creates a wallet client on Base.
  2. `await services.waap.signMessage(\`Sign in with your unlinkable account for respondent pool ${poolId}\`)` — EIP-191 `personal_sign` style message (see §5).
  3. `await services.oprf.getSecp256k1(input)` — OPRF (mishtiwasm + Human Network signer) derives a deterministic secp256k1 key from the signed string.
  4. `await services.account.updateSignerWithKey(key)` — sets that key as the smart-account signer (Pimlico ERC-4337 v0.7).
  5. returns `hasParticipatingAccount(services, poolId)`.
- **`hasParticipatingAccount(services: IServices, poolId: string): Promise<boolean>`** — reads the on-chain oracle:
  - `if (services.account.getSignerAddress() === '0x') return false;`
  - `return services.viem.read(S3ntimentSurveyStore.address, abi, 'isPoolMember', [poolId, getSignerAddress()])` using the deployment JSON `s3ntiment-contracts/deployments/base/S3ntimentSurveyStore.json`.

### Controller — `src/controllers/auth-ctrlr.ts`
`AuthController` (bound to root route `/`). Flow: `parseCardURL(window.location.href)` → if card present, `fetchSurvey(...)` (from shared), `store.setSurveyData(...)`, `authenticate(services, poolId)`; if not yet a participant, `card.register(services, surveyStore, poolId)` (contract `registerInPool`, waits for receipt) then `router.navigate('/surveys/:surveyId')`; if already a participant, navigates straight to the survey. (Registration/alert logic is gated / partly commented.)

### Auth wiring in the router — `src/router.ts`
- Root `'/'` **before-hook**: validates the card URL (`parseCardURL`), checks `card.isUsed(...)`; navigates to `/invalid-card` or `/used-card/:id` as needed before the AuthController runs.
- `'/surveys/:surveyId'` **before-hook**: `hasParticipatingAccount` → if not, `authenticate(...)` → `done()` if participant else `/invalid-card`.

### Other auth-touching code
- `src/components/logout.ctrlr.ts` — `LogoutController.process()`: `await services.waap.logout(); router.navigate('/')`. (Imported in router but only referenced in the **commented-out** block — not currently on any active route.)
- `src/controllers/used-card-ctrlr.ts` — "Sign back in" button listener calls `authenticate(this.services, surveyId)` and navigates to the survey on success.

### Dependencies on @s3ntiment/shared / shared encoding / SSX
- Imports `@s3ntiment/shared` (services + types) and `@s3ntiment/shared/browser` (WaapService, OPRFService): see `src/services.ts`. `IServices` = `{ viem, waap, account, ipfs, lit, nillDB, oprf }`.
- Imports `CardData`, `Card`, `parseCardURL`, `fetchSurvey`, `Pool`, `Survey` from `@s3ntiment/shared`.
- **IMPORTANT — direct source import precedent:** `src/auth.factory.ts` imports `fetchSurvey` from `"../../shared/src/shared"` (i.e. a **relative path straight into the shared package's source** `shared/src/shared/index.ts`), bypassing the `@s3ntiment/shared` npm/package exports. This proves the frontend (and thus a frontend test env) can reach shared TS **source** directly by relative path.
- **Shared card-encoding seam (cardMessageHash / signCardMessage / ethSignedMessageHash):** the respondent auth flow does **NOT** call `signCardMessage` directly — that function is used by the **organiser's** `frontend-organiser/src/factories/invitation.factory.ts` (`import { signCardMessage } from '@s3ntiment/shared'`). The respondent side touches the encoding seam **indirectly**: `shared/src/shared/invites/card.factory.ts` `parseCardURL()` computes `cardMessageHash(nullifier, batchId)` and `recoverMessageAddress(...)`; `Card.register`/`Card.isUsed` call the chain. So the card-signature→on-chain-recovery path is reachable from the respondent frontend via `Card`/`parseCardURL`.
- **No SSX, no session abstraction.** There is no SSX usage. Identity/session is delegated to the WaaP/Silk wallet + OPRF-derived key; respondent identity persistence is only localStorage via `src/state/user.store.ts` + `src/state/storage.ts` (keys `nullifier`, `batchId`, `address`). `brain/specs/SPEC-shared.md` L140 notes `createAuthManager()/authSig/session signatures/Capacity Credit NFT` are **superseded** (i.e. intentionally not present).

---

## 3. What "onboarding" consists of (to EXCLUDE)

There is **no dedicated onboarding module or route** in this frontend. "onboarding" appears only as the CSS class `.onboarding-message` (defined in `shared/src/assets/styles/global-styles.ts`, L74) used inside the **entry / gatekeeper / invitation** screens. For test-scope purposes, "onboarding" = these non-auth entry screens:

| Route | File | Class | Purpose |
|---|---|---|---|
| `/invalid-card` | `src/controllers/invalid-card-ctrlr.ts` | `InvalidCardController` | "You need a valid invitation" gate screen |
| `/used-card/:surveyId` | `src/controllers/used-card-ctrlr.ts` | `UsedCardController` | "This invite has already been used" + "Sign back in" button |
| `/complete/:surveyId/:docId` | `src/controllers/completed-ctrlr.ts` | `CompletedController` | "Thank you for your feedback / close this window" screen |
| (no active route) | `src/controllers/about.ctrlr.ts` | `AboutController` | Welcome/landing page (only referenced in router's commented block) |
| — | `src/controllers/auth-ctrlr.ts` | (commented block) | a `Welcome` `.onboarding-message` block, commented out |

**Caveat to flag before delegating tests:** `used-card-ctrlr.ts` and `router.ts` are "onboarding"-adjacent but *contain* real auth calls (`authenticate`, `hasParticipatingAccount`). If you exclude the whole file you also drop auth coverage reached from `/used-card`. Recommend excluding the *screens/components* but keeping `src/auth.factory.ts` (the pure auth logic) fully in scope — that's the clean separation of concerns.

Also note `src/components/security-questions.ts` and `src/components/survey-questions.ts` and `src/controllers/survey.ctrlr.ts` are the **survey-answering** surface (not onboarding, not auth) — outside the immediate auth-test scope.

---

## 4. Existing test setup

- **Test runner:** NONE in `frontend-respondents`. `package.json` `"test"` is a stub; no vitest/jest/playwright devDependency; no `vitest.config` / jest config / playwright config.
- **Existing `*.test.*` / `*.spec.*`:** none anywhere under `frontend-respondents/` or `shared/`. The **only** tests in the repo today live in `contracts/test/` and run under **Hardhat + `node:test` + `earl`**:
  - `contracts/test/S3ntimentSurveyStore.test.ts`
  - `contracts/test/encoding.seam.test.ts` — imports `cardMessageHash, ethSignedMessageHash, signCardMessage` from `@s3ntiment/shared/invites/encoding` and pins them against the on-chain `registerInPool` oracle. This is the reference for how the encoding seam is already tested (contract side).
- **No tests exist for any frontend auth code.**
- **Is `@s3ntiment/shared`'s encoding seam reachable/importable from the frontend's test environment?**
  - The module `shared/src/shared/invites/encoding.ts` **is present on `main`** (merged via `272a122a3`; HEAD `f422e8ca4`). It is deliberately **leaf-level and viem-only** (no Lit/Nillion/d3), so it imports cleanly in a non-browser/Node test env. It exports `cardMessageHash`, `ethSignedMessageHash`, `signCardMessage`.
  - It is re-exported through `shared/src/shared/invites/index.ts` → root shared index → `@s3ntiment/shared`, and via a dedicated subpath export `@s3ntiment/shared/invites/encoding` (which points at `dist/shared/invites/encoding.js`).
  - **Caveat:** `shared/dist/` is **NOT built** in this checkout and `node_modules` is not installed, so the `@s3ntiment/shared/invites/encoding` **subpath (→ `dist/...`) is not currently resolvable** until `pnpm build:shared` runs (root script `build:shared` = `pnpm --filter @s3ntiment/shared build`, i.e. `tsc`).
  - **Reliable seam path for a frontend test env:** follow the precedent already used by `src/auth.factory.ts` and import the shared **source** directly by relative path, e.g. `../../shared/src/shared/invites/encoding.js` (resolves to the `.ts` source per moduleResolution bundler / Vite). This bypasses the unbuilt `dist` entirely and is how the frontend already reaches shared internals.

---

## 5. Seam-relevant details for writing the auth tests

- **How the respondent auth module signs:**
  - `WaapService.signMessage(text)` (`shared/src/browser/evm/waap.service.ts`) → `window.waap.request({ method: "personal_sign", params: [toHex(message), address] })` — i.e. **EIP-191 personal_sign**.
  - The signer key derivation: `OPRFService.getSecp256k1(inputData)` (`shared/src/browser/oprf/oprf.service.ts`) = `keccak256(toBytes(input))`, take first 24 bytes, `msg_to_point` (mishtiwasm), `request_from_signer(point, "OPRFSecp256k1", signerUrl)`.
  - `PermissionlessSimpleService.updateSignerWithKey(key)` (`shared/src/shared/evm/permissionless.simple.service.ts`) → `privateKeyToAccount(key)` + smart account (Pimlico `entrypoint 0.7`). `getSignerAddress()` returns `"0x"` when no signer set. (Source comments note its `signMessage` uses EIP-191.)
  - Card/on-chain signature seam lives in shared `card.factory.ts` via `cardMessageHash` + `recoverMessageAddress`; `Card.register` → contract `registerInPool`, `Card.isUsed` → `isNullifierUsed`.
- **Best mock / DI seam:** the `IServices` interface (`src/services.ts`) is the perfect seam. `authenticate` / `hasParticipatingAccount` and all controllers take `services: IServices`. `ServiceContainer` is a **singleton** implementing it (obtained via `getServices()`); a test should **not** use the singleton but rather construct a lightweight fake implementing `IServices` — `{ viem, waap, account, ipfs, lit, nillDB, oprf }` — and pass it in. To unit-test `authenticate`, mock at minimum: `waap.login`, `waap.signMessage`, `oprf.getSecp256k1`, `account.updateSignerWithKey`, `account.getSignerAddress`, `viem.read` (for `hasParticipatingAccount`). This gives zero-network, zero-browser (no `window.waap`) tests.
- **Contract-deployment JSON dependency:** `auth.factory.ts`, `auth-ctrlr.ts` and `used-card-ctrlr.ts` import `s3ntiment-contracts/deployments/base/S3ntimentSurveyStore.json` (with `{ type: 'json' }`). Any test importing these modules must be able to resolve that JSON path (it is committed; reachable via `s3ntiment-contracts` workspace pkg).
- **Exact import paths:**
  - `frontend-respondents/src/services.ts` — `IServices` / `ServiceContainer` / `getServices`; imports from `@s3ntiment/shared` and `@s3ntiment/shared/browser`.
  - `frontend-respondents/src/auth.factory.ts` — `authenticate`, `hasParticipatingAccount`; imports `./services` (IServices), `s3ntiment-contracts/deployments/base/S3ntimentSurveyStore.json`, `fetchSurvey` from `"../../shared/src/shared"`.
  - `frontend-respondents/src/controllers/auth-ctrlr.ts` — `AuthController`; imports `../auth.factory.js`, `@s3ntiment/shared` (`CardData, Card, parseCardURL, fetchSurvey`), `@s3ntiment/shared/components`, deployment JSON.
  - Shared encoding seam: `shared/src/shared/invites/encoding.ts` — `cardMessageHash`, `ethSignedMessageHash`, `signCardMessage` (viem-only).
  - Shared card: `shared/src/shared/invites/card.factory.ts` — `Card`, `parseCardURL` (uses `cardMessageHash`); `shared/src/shared/invites/index.ts` re-exports both.
  - Shared browser auth services: `shared/src/browser/evm/waap.service.ts`, `shared/src/browser/oprf/oprf.service.ts`.
  - Shared account service: `shared/src/shared/evm/permissionless.simple.service.ts` (`PermissionlessSimpleService`).

---

## 6. Git state of the frontend dir

- Repo root: `/home/joera/code/s3ntiment`; checked-out branch **`main`**, HEAD `f422e8ca4` (last commit = merge of PR #6 `deepseek/shared-encoding`; `272a122a3` is in history, so the encoding seam is already on main).
- `frontend-respondents` lives in the **main worktree** — there is **no separate worktree** for it. (`git worktree list` shows only `abi-snapshot`, `contract-tests`, `owned-merge`, `shared-encoding` worktrees under `/home/joera/code/worktrees/`.)
- Working tree for `frontend-respondents/` is **clean** (`git status --short -- frontend-respondents` → empty). Repo-wide untracked items are unrelated: `.s3n-orchestrator/`, `brain/audits/*.md`, `brain/reviews/`.
- `pnpm build:shared`/test scaffolding has **not** been run in this checkout: `shared/dist` absent, `node_modules` not installed.

---

## Summary / recommended test approach (for delegation)

1. **In-scope (auth):** `src/auth.factory.ts` (pure logic, unit-testable via a fake `IServices`), `src/services.ts` (`IServices` type), and the `AuthController` + router/used-card auth wiring if integration coverage is wanted.
2. **Exclude (onboarding/entry screens):** `invalid-card-ctrlr.ts`, `completed-ctrlr.ts`, `about.ctrlr.ts`, and the `.onboarding-message` markup in `auth-ctrlr.ts`/`used-card-ctrlr.ts` — but keep the `authenticate` calls those screens make in scope.
3. **No test runner yet** — first step is to wire vitest (or jest) into `frontend-respondents/package.json` (currently a stub), then import shared source by direct relative path (`../../shared/src/shared/invites/encoding.js`) to avoid the unbuilt `dist`, mirroring `auth.factory.ts`'s existing pattern.
4. **Mock seam:** fake `IServices`; no browser globals (`window.waap`), no network, no `ServiceContainer` singleton.

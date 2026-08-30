# Task 1 Explore — Deferred identity persistence, RESPONDENT frontend (human-wallet → random bootstrap leaf)

**Date:** 2026-08-29
**Repo:** `/home/joera/code/s3ntiment` (pnpm monorepo)
**Scope:** read-only investigation of `frontend-respondents` + `@s3ntiment/shared` for
RFC-deferred-identity-persistence (RFC at `brain/specs/RFC-deferred-identity-persistence.md`,
handoff at `brain/handoffs/identity-architecture-2026-08-28.md`).
**Task 1 goal:** (a) extract the "human wallet" auth into its own factory file callable LATER (not at
entry), and (b) at entry, bootstrap a RANDOM stealth key (signer/address) with NO anchor-stealth
pairing and NO OPRF, persisted to local storage. Post-survey `persist` route is NOT this task.

---

## TL;DR

- Identity today is established at the **survey entry gate** via `resolveSurveyGate()` in
  `frontend-respondents/src/router.gates.ts`, which calls `hasParticipatingAccount()` then
  `authenticate()` (`src/auth.factory.ts`). `authenticate()` is the entire "human wallet" flow
  (WaaP login → signMessage → OPRF `getSecp256k1` → `updateSignerWithKey`).
- `authenticate()` is also called from **two controllers**: `controllers/auth-ctrlr.ts` (root `/`
  handler) and `controllers/used-card-ctrlr.ts` (used-card "Sign in" button).
- The signer lives in `PermissionlessSimpleService` (`shared/src/shared/evm/permissionless.simple.service.ts`),
  which has **no persistence** — the key is held in memory only, set via `updateSignerWithKey(key)`
  which does `privateKeyToAccount(key)` + `connectToAccount()`. **Its signer can be swapped for any
  random key directly.**
- **bootstrap-E generation is 100% greenfield.** No `generatePrivateKey` / `Wallet.createRandom` /
  CSPRNG util exists anywhere in source (only a test helper). No stealth/leaf/derive/mnemonic code
  exists. RFC §11's `shared/browser/evm` "bootstrap-E generation + device-local persistence" is NOT
  built.
- **Recommended bootstrap call for this stack:** `generatePrivateKey()` from `viem/accounts`
  (viem is pinned 2.46.2 by root override; it uses noble-secp256k1 `randomPrivateKey` →
  webcrypto `crypto.getRandomValues`, i.e. a real CSPRNG). Persist the raw `0x…` hex private key to
  localStorage so the bootstrap leaf survives tab close (RFC §7.1).
- The survey **submit** path is `SurveyController.setSurveyListener()` (`controllers/survey.ctrlr.ts`)
  listening for the `survey-complete` CustomEvent dispatched by `<survey-questions>`; it signs
  `s3ntiment:submit`, fetches a nilDB delegation, calls `storeOwned`, then `router.navigate('complete/…')`.
  The future persist route hooks in between submit and the `complete` navigation (architecture mapped below).
- **Gates:** `pnpm --filter frontend-respondents test` (vitest, 10 files / 107 passing). **No lint and
  no clean `tsc` gate** are configured for this package — see §6.

---

## 1. Everything that currently establishes respondent identity

### 1.1 The gate (entry choke-point) — `frontend-respondents/src/router.gates.ts`

`resolveSurveyGate(services, surveyStore, surveyId)` (lines ~48–75):
```
const [, poolId] = await fetchSurvey(...)
store.setSurveyData(...); store.setActiveSurvey(...)
let isParticipant = await hasParticipatingAccount(services, poolId);   // line ~77
if (!isParticipant) isParticipant = await authenticate(services, poolId); // line ~79
if (isParticipant) return { proceed: true };
return { navigate: '/invalid-card' };
```
This is the **only place identity MUST be established before the survey** and the main thing Task 1
must neuter. `hasParticipatingAccount()` returns false whenever `getSignerAddress() === '0x'`
(no signer) and otherwise does an on-chain `isPoolMember` read.

`resolveRootGate` (lines ~23–44) does **not** authenticate — it only checks card parseability and
`isNullifierUsed`. Identity is not set at the root gate.

**Callers of `resolveSurveyGate`:** `router.ts` `before` hook on `/surveys/:surveyId`.

### 1.2 `authenticate()` / `hasParticipatingAccount()` — `frontend-respondents/src/auth.factory.ts`

`authenticate(services, poolId)` (lines 9–20) is the entire "human wallet" flow:
```
await services.waap.login(base);                                   // WaaP email/phone login
const input = await services.waap.signMessage(`Sign in with your unlinkable account for respondent pool ${poolId}`);
const key = await services.oprf.getSecp256k1(input);              // OPRF blind-sign → derived key
await services.account.updateSignerWithKey(key);                  // swap the smart-account signer
return await hasParticipatingAccount(services, poolId)
```
`hasParticipatingAccount(services, poolId)` (lines 23–31): `0x` short-circuit then
`viem.read(surveyStore.address, surveyStore.abi, 'isPoolMember', [poolId, getSignerAddress()])`.

**THIS whole file is the "human wallet" factory.** Task 1(a) = split it out (new file, e.g.
`humanWallet.factory.ts` / `auth.factory.ts` → deferred), callable later, and stop calling it at entry.

### 1.3 All runtime callers of `authenticate()` / `hasParticipatingAccount()`

| Call site | File:approx line | Trigger | Notes |
|---|---|---|---|
| `resolveSurveyGate` gate | `src/router.gates.ts:77,79` | `/surveys/:surveyId` `before` | **the entry blocker to remove** |
| `AuthController.render()` | `src/controllers/auth-ctrlr.ts:63` | root `/` route handler | calls `authenticate` then `card.register(...)`/`isParticipant` routing |
| `UsedCardController.attachListeners()` | `src/controllers/used-card-ctrlr.ts:59` | used-card "Sign in" button | calls `authenticate(this.services, this.surveyId)` |

`LogoutController` (`src/components/logout.ctrlr.ts`) does NOT call authenticate; it only calls
`services.waap.logout()` and navigates `/`. It is not part of identity establishment, but it is the
only current user of `waap.logout()` — relevant if the human-wallet factory takes the WaaP surface
with it.

**UI flow reaching the survey (routes, `src/router.ts`):**
1. Route `/` → `new AuthController` (`router.ts` `before` hook runs `resolveRootGate` first) →
   `AuthController.render()` (`auth-ctrlr.ts`): parse card → `fetchSurvey` → **`authenticate`** →
   if participant navigate `/surveys/:id`, else `card.register(...)` (on-chain `registerInPool`) →
   navigate `/surveys/:id`.
2. Route `/surveys/:surveyId` → `before` hook `resolveSurveyGate` → **`authenticate`/`hasParticipatingAccount`** → `new SurveyController`.
3. Route `/used-card/:surveyId` → `UsedCardController`, whose "Sign in" → **`authenticate`**.
4. `survey-complete` (submitted) → `SurveyController.setSurveyListener` → navigate `/complete/:surveyId/:docId` → `CompletedController`.

### 1.4 Calls that must change so identity becomes a random local-storage key

To make entry establish a **random bootstrap key** (no WaaP, no OPRF at entry):
- **`router.gates.ts:77–81`** — replace `hasParticipatingAccount`/`authenticate` with a bootstrap-leaf
  load-or-create (random key) and consider whether the `isPoolMember` check stays. In the deferred
  model the bootstrap `E` is a member **after registration**; at entry `E` is pre-registration, so the
  gate becomes "ensure `E` exists + persisted", not "is a member". (Gate semantics are for the
  implementer to resolve against the RFC — see Concerns.)
- **`auth-ctrlr.ts:63`** — stop calling `authenticate`; use the bootstrap key for
  `card.register(...)` (which drives `registerInPool` via `account.write`).
- **`used-card-ctrlr.ts:59`** — `authenticate` at the button must be removed/replaced (or the button
  repurposed to the persist flow later).
- **`auth.factory.ts`** — the file itself is extracted (Task 1a) and retained for the LATER persist
  route; no longer called at entry.

---

## 2. How the signer key lives today (PersistenceSimpleService)

File: `shared/src/shared/evm/permissionless.simple.service.ts`.

- **No private-key persistence.** The class holds `private signer: any` in memory only.
- **Creation/persistence path in production:** the key is DERIVED at runtime by `authenticate()` via
  OPRF → `updateSignerWithKey(key)` (line 46):
  ```
  async updateSignerWithKey(key: `0x${string}`): Promise<`0x${string}`> {
      this.signer = privateKeyToAccount(key);   // viem/accounts
      await this.connectToAccount();
      return this.signer.address;
  }
  ```
  There is **no localStorage write anywhere for the signer**. See storage key inventory below.
- **Constructor** (`lines 16–42`): builds `publicClient` (Alchemy via `getRPCUrl`), `pimlicoClient`
  (bundler + paymaster). Signer starts `undefined` → `getSignerAddress()` returns `"0x"` until a key
  is set.
- Node/uses: `updateSignerWithWaap(walletClient)` also exists (sets signer to a viem `WalletClient`).
  `getSignerAddress()` / `getSigner()` / `signMessage`/`signTypedData` / `write` / `writeRaw` /
  `transfer` / `createNillDBSeed()` all operate off `this.signer`.
- **`createNillDBSeed()`** (`lines 122–125`): `keccak256(toBytes(signer.signMessage('Connect to blind
  computer for private responses'))).slice(2)` — this seed later becomes the nilDB `Signer.fromPrivateKey(seed)`
  (see §5). It is derived from the ACCOUNT signer via EIP-191 signature, so a random account signer
  automatically yields a random nilDB owner — good, but note the SMC `isPoolMember` membership is
  registered against `getSignerAddress()` (the smart-account constructor, NOT the raw EOA), see Concern C2.

**Storage keys currently in use (`frontend-respondents/src/state/storage.ts`):** `'surveys'`,
`'pools'`, `'nullifier'`, `'batchId'`, `'address'`; `main.ts` also purges `lit-*` /
`litCapabilityDelegation`. **`UserState` (store.types.ts) = `{ nullifier, batchId, address }`** — there is
NO field for a private key / bootstrap E. So Task 1 needs to ADD a new storage key for the random
bootstrap private key (e.g. a dedicated key), ideally alongside the existing `storage.ts` helpers.
The existing `address` key stores the *smart-account* address (set during onboarding), not a private key.

---

## 3. Reusable pieces already in the repo for (b) — bootstrap random key

### 3.1 Random-key generation — **GREENFIELD (nothing reusable in source)**

Searched the whole repo (`frontend-respondents`, `shared`, `nillcc-backend`, `protocol`):
```
generatePrivateKey | createRandom | getRandomValues | randomBytes | CSPRNG | mnemonic | BIP39
```
- `generatePrivateKey` / `Wallet.createRandom` / mnemonic: **zero** production usages.
- `crypto.getRandomValues`: only in a **test** helper
  (`frontend-respondents/src/card-url.round-trip.test.ts:36–39`).
- Stealth / leaf / derive / bootstrap-E / KDF: **zero** production code. RFC §11's "bootstrap-E
  generation + device-local persistence" and "deterministic leaf derivation" in `shared/browser/evm`
  are **all greenfield**. `shared/src/browser/evm/` contains only `waap.service.ts`.
- `privateKeyToAccount` (viem/accounts) IS used in `permissionless.simple.service.ts:47` and
  `permissionless.safe.service.ts:62` — that's the consumption side, and it proves a raw hex private
  key can be fed in. The nonce/account side is irrelevant here.

### 3.2 Existing local-storage helpers (reusable structurally)

`frontend-respondents/src/state/storage.ts` provides a clean pattern:
`loadPoolsFromStorage/savePoolsToStorage`, `loadUserFromStorage/saveUserToStorage/clearUserFromStorage`,
`loadSurveysFromStorage/...`, each wrapped in `try/catch` + `JSON.parse`. There is **no generic
`localStorage` KV util in `shared/`** — but the RFC puts bootstrap-E persistence in `shared/browser/evm`.
Either add a tiny util there (greenfield) or mirror the `storage.ts` pattern in frontend-respondents.
No persistence exists in `shared/src/browser/evm` today.

### 3.3 The actual CSPRNG call for THIS stack

`viem/accounts` `generatePrivateKey()` — viem is pinned **2.46.2** (root `pnpm.overrides`).
Source at `node_modules/.pnpm/viem@2.46.2_.../node_modules/viem/accounts/generatePrivateKey.ts`:
```
import { secp256k1 } from '@noble/curves/secp256k1'
export function generatePrivateKey(): Hex {
  return toHex(secp256k1.utils.randomPrivateKey())
}
```
noble `randomPrivateKey()` → `@noble/curves/abstract/utils.js` `randomBytes` → `@noble/hashes` utils
`randomBytes` → **webcrypto `crypto.getRandomValues`** (browser) / node `crypto.randomBytes` (node).
This is a genuine CSPRNG and is the natural choice for this stack (ethers is NOT a dependency here,
but ethers `Wallet.createRandom` also just wraps the same noble CSPRNG; viem is the repo's EVM lib).

**Recommendation:** `import { generatePrivateKey } from 'viem/accounts'` → returns `0x…` hex
(64 hex chars, 32 bytes), feed straight to `account.updateSignerWithKey(privKey)`.

### 3.4 OPRFService and WaapService definitions

- **OPRFService** — `shared/src/browser/oprf/oprf.service.ts`. Constructor(`signerUrl`), `init()`
  (loads mishtiwasm), `getSecp256k1(input)` (keccak → `msg_to_point` → `request_from_signer(point,
  "OPRFSecp256k1", this.signerUrl)` → 64-hex key), `getBabyJubJub(input)`.
  **OPRF is ONLY needed for anchor-stealth pairing / deriving a key from the human-wallet message.**
  With a random bootstrap key there is no blinding input, so **OPRF is not called at all** in the
  random path. Confirmed: the only production caller of `getSecp256k1` is `auth.factory.ts authenticate()`.
  `services.ts:69` constructs `new OPRFService(import.meta.env.VITE_HUMAN_NETWORK_SIGNER_URL)`;
  `services.ts:70` and `:66` call `oprf.init()` and `waap.createWallet(base)` eagerly inside
  `initialize()` — **both should be deferred/removed from the eager startup** for the random path
  (OPRF init loads a wasm; waap createWallet pops the SDK).
- **WaapService** — `shared/src/browser/evm/waap.service.ts`. `@human.tech/waap-sdk`; `createWallet`,
  `login(chain)` (calls `window.waap.login()` → email/phone), `signMessage`, `write`, `logout`,
  `createNillDBSeed`. Backend signer for OPRF is `VITE_HUMAN_NETWORK_SIGNER_URL` (declared
  `src/vite-env.d.ts:21`; consumed only at `services.ts:69`).
- **Signer URL:** `VITE_HUMAN_NETWORK_SIGNER_URL` is the Human Network OPRF signer endpoint. Not needed
  for the random bootstrap path.

---

## 4. Best-practice recommendation for the bootstrap stealth key

Given **no anchor pairing** (so no OPRF/PRF), the bootstrap key is just a fresh, unlinkable stealth
address from a CSPRNG private key:

1. **Generate:** `generatePrivateKey()` from `viem/accounts` (see §3.3) — recommended over ethers
   `Wallet.createRandom` because viem is already the repo's EVM lib (no new dep) and both share the
   same CSPRNG. Raw webcrypto `crypto.getRandomValues(new Uint8Array(32))` is acceptable too, but
   `generatePrivateKey` already normalizes to a valid scalar.
2. **Persist immediately (RFC §7.1):** write the raw `0x…` private key to localStorage **at
   generation**, not merely held in memory, so the leaf survives tab close (the whole point of §7.1 —
   otherwise closing the tab orphans the membership although the nullifier already burned at
   registration). Add a new storage key (e.g. `'bootstrapE'` / `'stealthLeaf'`) — the existing
   `UserState` has no private-key field (see §2).
3. **Feed to the account:** `account.updateSignerWithKey(privKey)` accepts any valid 32-byte hex key
   — it just runs `privateKeyToAccount` + `connectToAccount` (`permissionless.simple.service.ts:46–52`).
   **Confirmable: yes, a random generated key can be swapped in.**
4. **Confirmations/concerns:**
   - **The random E should be the SMC signer / nilDB owner going forward.** Per RFC the random E *is*
     the bootstrap leaf: it owns nilDB records (`owner = did:key` from the leaf via
     `createNillDBSeed` → `Signer.fromPrivateKey`) and, once registered, `isPoolMember` reads resolve
     against it. So `updateSignerWithKey(E)` makes E both the smart-account owner *and* the nilDB
     owner. Correct per RFC §5.2.
   - **C1 — must persist the private key** (RFC §7.1): otherwise a tab close loses E and the burned
     nullifier is wasted. The raw E private key IS the bootstrap credential.
   - **C2 — EOA vs SMC address:** `account.getSignerAddress()` returns the *smart-account* address
     (from `toSimpleSmartAccount(...).address` in `connectToAccount`), NOT the raw EOA (`this.signer.address`).
     `hasParticipatingAccount`/`isPoolMember` and the nilDB `userDidString` both derive from the
     smart-account/derived chain. Ensure the bootstrap key is fed via `updateSignerWithKey` (which
     correctly rebuilds the SMC) and that registration (`card.register` → `registerInPool`) uses the
     SMC address, otherwise the membership won't match what `isPoolMember` checks.
   - **C3 — OPRF/waap removal from eager init:** `services.ts:66,70` currently do
     `waap.createWallet` + `oprf.init()` inside `initialize()`; these should be deferred out of the
     random path (they're the entry-funnel cost Task 1 removes).

---

## 5. Survey SUBMIT path (where the future persist route hooks in)

File: `frontend-respondents/src/controllers/survey.ctrlr.ts`.

**Trigger:** `<survey-questions>` (web component) dispatches `new CustomEvent('survey-complete', {…})`
(`components/survey-questions.ts:519–528`) on completion.

**Handler:** `SurveyController.setSurveyListener()` (`survey.ctrlr.ts`, async listener on
`survey-complete`):
```
const seed = await this.services.account.createNillDBSeed();        // from account signer
await this.services.nillDB.init(seed);                              // Signer.fromPrivateKey(seed) → userDidString
const docId = crypto.randomUUID();
const signature = await this.services.account.signMessage(`s3ntiment:submit`);
const args = { userDid, signature, userAddress: getSignerAddress(), poolId, pkpId, pkpDid };
const { delegation } = await fetch(`${BACKENDURL}/api/surveys/${this.surveyId}/delegation`, POST)
const result = await this.services.nillDB.storeOwned(docIUd, survey, poolConfig, answers, surveyId, delegation);
if (result.ok) router.navigate(`complete/${this.surveyId}/${docIUd}`)     // <— HOLD POINT
```

**Backend route (mapped, not built):** `nillcc-backend/src/main.ts:226` `POST /surveys/:surveyId/delegation`
→ `SurveyController.getUserDelegation(...)` (`survey.ctrlr.ts:166`); `POST /surveys/:id/score`
(`main.ts:170`) → `survey.score(...)`; org-side `POST /surveys/:id/submit` is **commented out**
(`main.ts:127`).

**Where the future persist route hooks in:** between `storeOwned(...)===ok` and
`router.navigate('complete/…')` in `setSurveyListener` — i.e. after successful submission, before the
"complete" screen. The completed screen is `CompletedController` (`controllers/completed-ctrlr.ts`,
renders score/"Thank you"). The route structure (`router.ts`, Navigo) makes adding a post-submit
`persist` route straightforward: another `.on('/persist/…', …)` (or `complete/…`) handler, keeping
`store` (survey data / user state) available via `state/store.ts` singleton. `CompletedController`
already signs `s3ntiment:score:${surveyId}` using `account.getSignerAddress()` — any persist offer
screen would do the same against the account signer. Note the future persist calls the EXTRACTED
human-wallet `authenticate`-style factory (Task 1a) to establish an anchor → re-derive.

**Route/store structure for adding post-submit route later:** `router.ts` (InitRouter, Navigo
`.on(...)` with optional `before` hook) + `state/store.ts` singleton (surveys, user) + per-screen
controllers under `controllers/`. The new route needs access to: `services.account` (to swap the
signer from E→S via `updateSignerWithKey`), `services.waap` + `services.oprf` (the extracted factory),
and `store.activeSurvey`/pool. All live in the same singleton graph.

---

## 6. Test / lint / typecheck gates for frontend-respondents

- **Tests:** vitest. Config `vitest.config.ts` (`environment: 'node'`, `include: ['src/**/*.test.ts']`,
  `setupFiles: ['./test/setup.ts']` — the setup installs minimal Node stubs for `localStorage/window/
  document/alert`; no jsdom). Command:
  ```
  pnpm --filter frontend-respondents test        # from repo root
  # or: cd frontend-respondents && pnpm test     # = vitest run
  ```
  **Baseline verified green: 10 files / 107 tests passing.**
  Relevant existing test files:
  - `src/auth.factory.test.ts` — mocks `auth.factory.js`; pins `authenticate` (full login flow,
    error propagation) and `hasParticipatingAccount` (`0x` short-circuit, `isPoolMember` read args).
    **Will need rewriting when `authenticate` moves to the extracted factory.**
  - `src/router-entry-gates.test.ts` — mocks `./auth.factory.js` (`authenticate`/`hasParticipatingAccount`),
    `Card`, `fetchSurvey`; pins `resolveRootGate`/`resolveSurveyGate`. **Will need updating since the
    gate no longer calls `hasParticipatingAccount`/`authenticate`.**
  - `src/controllers/auth-ctrlr.test.ts` — mocks `../auth.factory.js` `authenticate`; pins
    `AuthController` entry. Will change as `auth-ctrlr.ts` changes.
  - Others: `card-class.seam.test.ts`, `card-signature.seam.test.ts`, `card-url.round-trip.test.ts`,
    `components/survey-questions.test.ts`, `controllers/survey-ctrlr.test.ts`,
    `controllers/used-card-ctrlr.test.ts`, `state/stores.test.ts`.
- **Typecheck:** **no dedicated script.** `frontend-respondents/tsconfig.json` has `rootDir: ./src`
  but no `include/exclude`, so a bare `tsc --noEmit` from the package picks up `test/setup.ts` and
  `vitest.config.ts` outside `rootDir` → `TS6059` noise (verified). The de-facto type gate is:
  - `pnpm --filter @s3ntiment/shared build` (tsc, `shared/tsconfig.json` includes `src/shared` + `src/node`,
    **excludes `src/browser`** — browser is consumed as TS by vite/esbuild, type-stripped, not tsc-checked),
  - `pnpm --filter frontend-respondents build` (vite + esbuild).
  So there is **no clean per-file `tsc` gate for `src/`**; rely on `vitest run` + `vite build` + the
  shared `tsc` build. (If the implementer wants a local type check, `npx tsc --noEmit` surfaces
  TS6059 noise but still type-errors on real type bugs; a clean check needs an `include/exclude` fix,
  which is out of Task 1 scope.)
- **Lint:** **none configured** — no `eslint`/`prettier` config anywhere in the repo and no `lint`
  script in any package.json. Nothing to run.

**Gates to drive green for Task 1 (implementer):**
1. `pnpm --filter @s3ntiment/shared build`
2. `pnpm --filter frontend-respondents test`  (rewrite the affected test files to match)
3. `pnpm --filter frontend-respondents build`
4. (no lint)

---

## Appendix — key files & line refs

- Gate: `frontend-respondents/src/router.gates.ts:77,79` (`hasParticipatingAccount`, `authenticate`)
- Human-wallet factory: `frontend-respondents/src/auth.factory.ts` (whole file)
- Entry controllers: `controllers/auth-ctrlr.ts:63`, `controllers/used-card-ctrlr.ts:59`,
  `components/logout.ctrlr.ts` (waap.logout only)
- Routes: `frontend-respondents/src/router.ts` (`/`, `/surveys/:id`, `/used-card/:id`, `/complete/:id/:doc`)
- Services boot: `frontend-respondents/src/services.ts:66` (`waap.createWallet`), `:69` (OPRF ctor),
  `:70` (`oprf.init`); `src/main.ts` (clearLitStorage + `services.initialize()` before `initRouter`)
- Signer: `shared/src/shared/evm/permissionless.simple.service.ts:46` (`updateSignerWithKey`),
  `:122` (`createNillDBSeed`); safe twin `permissionless.safe.service.ts:62`
- Random-key CSPRNG: `viem/accounts` `generatePrivateKey` (viem 2.46.2) → noble-secp256k1
  `randomPrivateKey` → noble `randomBytes` → webcrypto `crypto.getRandomValues`
- OPRF: `shared/src/browser/oprf/oprf.service.ts` (`getSecp256k1` line ~31)
- WaaP: `shared/src/browser/evm/waap.service.ts`
- Local-storage pattern: `frontend-respondents/src/state/storage.ts`; `UserState` at
  `state/store.types.ts`
- Submit: `controllers/survey.ctrlr.ts` `setSurveyListener` (createNillDBSeed → nillDB.init →
  signMessage `s3ntiment:submit` → POST `/delegation` → `storeOwned` → navigate `complete/…`)
- Submit backend route: `nillcc-backend/src/main.ts:226` (`/surveys/:surveyId/delegation`),
  `:170` (`/score`), `:127` (submit commented out)
- nilDB owner: `shared/src/shared/nillion/nilldb.user.service.ts:29` (`init(seed)` →
  `Signer.fromPrivateKey(seed)` → `userDidString`), `:59` (`storeOwned`, owner = `userDidString`)
- Config: `frontend-respondents/vitest.config.ts`, `test/setup.ts`, `tsconfig.json`

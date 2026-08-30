# Respondent Invitation / Card — Exploration (2026-08-28)

Goal: map EVERYTHING related to the invitation / card across the s3ntiment
frontends so the next tranche of tests can be written. Read-only exploration.
No source or test changes were made.

## Base state

- Repo: `/home/joera/code/s3ntiment`
- HEAD on `main`: **`ffed11d8ca37a221bf88500e18990da889807912`**
- `git pull` = "Already up to date".
- PR **#10 was merged** (`ffed11d8c` "Merge pull request #10 … respondent-survey-ctrlr-tests",
  plus `9a24b19ab` "feat(frontend-respondents): add SurveyController vitest suite + fix R1 pool-config plumbing").
- Prior context: PR #7 (ht-respondent-auth-tests), PR #8 (nillcc-backend), #5/#6 (abi-snapshot / shared-encoding).
- So the respondent vitest suite is fully landed: auth.factory (9), auth-ctrlr (5),
  card-signature.seam (5), survey-ctrlr (7). Onboarding controllers + router ENTRY
  gates remain excluded (as instructed).

---

## 1) Inventory of every invitation/card-related module

### A. Shared — `shared/src/shared/invites/`

| File | Role | Deps | Offline-testable? |
|---|---|---|---|
| `encoding.ts` | **protected seam**: `cardMessageHash`, `ethSignedMessageHash`, `signCardMessage`. Single source of truth for card digest + EIP-191 signing. | imports only `viem` (+`viem/accounts` LocalAccount type). Leaf-level by design. | **Pure** (crypto only). Pinned by 2 suites. |
| `card.factory.ts` | `parseCardURL(href)` + `class Card` (`isUsed`, `register`, getters `surveyId/nullifier/batchId`). | `viem` (`recoverMessageAddress`), `cardMessageHash` from `./encoding.js`, `CardData` type. | `parseCardURL` pure (reads only its `href` string; no `window`). `Card` is network-bound via services (mockable). |
| `types.ts` | `CardData` interface (nullifier, batchId?, signature, surveyOwner?, surveyId?, url?, svgString?, isUsed?, ipfsCid?). | none | — |
| `index.ts` | re-exports `./types.js`, `./encoding.js`, `./card.factory.js`. | — | — |

### B. Respondent frontend — `frontend-respondents/src/`

| File | Role | Deps | Offline-testable? |
|---|---|---|---|
| `router.ts` | Navigo router. **Exports** `router` + `initRouter(services)`. Defines the ENTRY gates: root `/` (parseCardURL → Card.isUsed → navigate used-card/invalid-card) and `/surveys/:surveyId` (fetchSurvey → hasParticipatingAccount → authenticate). Also onboarding routes (`/invalid-card`, `/used-card/:surveyId`, `/complete/...`). **Calls `router.resolve()` at module scope.** | Navigo, `@s3ntiment/shared` (Card, parseCardURL, CardData), `s3ntiment-contracts` JSON, `viem/chains` (base), local controllers, `auth.factory`, `onpageload`, `store`, `survey.factory` (`fetchSurvey`) | **Hard** in current shape (see §5). |
| `auth.factory.ts` | `authenticate`, `hasParticipatingAccount` (isPoolMember read). | `viem/chains`, `s3ntiment-contracts` JSON, `../../shared/src/shared` (fetchSurvey, unused by fns under test), `services.ts` | **Pure** with mocked services. **Already tested** (`auth.factory.test.ts`, 9 tests). |
| `controllers/auth-ctrlr.ts` | `AuthController.render()` — root flow: parseCardURL → new Card → fetchSurvey → authenticate → `card.register` → navigate. | `@s3ntiment/shared` (Card, parseCardURL, CardData, fetchSurvey), `services`, `store`, `s3ntiment-contracts` JSON, `router`, `auth.factory`, `onpageload`, `utils/reactive`, `@s3ntiment/shared/components` | Yes (mocked). **Already tested** (`auth-ctrlr.test.ts`, 5 tests) — covers Card.register arguments. |
| `card-signature.seam.test.ts` | Shared encoding seam pinned from respondents (by **relative source path** `../../shared/src/shared/invites/*.js`). | vitest, viem, shared source | **Already tested** (5 tests). |
| `onpageload.ts` | `removeSplash()` — DOM splash/header/footer manip. | document | Browser; only used inside routing, not itself in-scope. |
| `services.ts` | `IServices` interface + `ServiceContainer`. | heavy shared/browser deps | Test fixture only (not under test). |

Onboarding controllers (excluded, per instruction): `controllers/about.ctrlr.ts`,
`invalid-card-ctrlr.ts`, `used-card-ctrlr.ts`, `completed-ctrlr.ts`. Also
`controllers/survey.ctrlr.ts` (already tested via survey-ctrlr 7).

### C. Organiser frontend — `frontend-organiser/src/`

| File | Role | Deps | Offline-testable? |
|---|---|---|---|
| `factories/invitation.factory.ts` | **Invitation GENERATION surface**: `createBatchWallet` (crypto random seed → safe signMessage → keccak256 → privateKeyToAccount), `generateCardSecrets(batchAccount, batch)` (per-card random nullifier + `signCardMessage` → builds **card URL** `${BASEURL}?n=…&b=…&sig=…&s=…` + SVG QR), `createZipFile` (JSZip + file-saver), `createCsvFile` (Blob + file-saver), `uploadToPinata` (services.ipfs). | `qrcode`, `jszip`, `file-saver`, `viem` (+accounts), `@s3ntiment/shared` (`Batch`, `CardData`, **`signCardMessage`**), `../services/services`, `import.meta.env` | Partly. **Uses the shared seam `signCardMessage`** (not its own encodePacked/keccak). `createBatchWallet` uses crypto.getRandomValues/randomUUID (browser). `generateCardSecrets` calls QRCode + import.meta.env.BASEURL — mockable but needs browser stubs. `uploadToPinata` mockable via services. `createCsvFile/createZipFile` need `saveAs` + Blob stubs. |
| `factories/survey.factory.ts` | `createBatch` (createBatchWallet → generateCardSecrets → uploadToPinata → registerBatch on-chain), `registerBatch`. | `viem`, `@s3ntiment/shared`, invitation.factory, s3ntiment-contracts JSON, permissionless | Mostly network-bound; invitation logic delegated to invitation.factory. |
| `controllers/batch.ctrlr.ts` | Batch/QR/URL/IPFS UI; `discardUsedCards()` calls **`card.isUsed(services, surveyStore)`**; `new Card(c)`. | `@s3ntiment/shared` (Card, CardData), s3ntiment-contracts JSON, invitation.factory (`createCsvFile`, `createZipFile`), store/router/reactive | Browser + network; isUsed path testable only via Card.isUsed mock. |
| `components/survey-forms/pool-form-batches.ts` | UI listing batches / "create invitations". | organiser UI stack | Onboarding/markup → exclude. |
| `components/survey-forms/question-card.ts` | survey-form question markup (name collision with card, unrelated). | — | Exclude. |

**`import.meta.env` caveat** — `invitation.factory.ts` reads
`import.meta.env.VITE_PROD / VITE_FRONTEND_PROD / VITE_FRONTEND_DEV` at module
scope (BASEURL). Testing it from node/vitest requires `import.meta.env` defined
(run under Vite/vitest it is; BASEURL resolution needs env vars or a mock).

---

## 2) Respondent-frontend card flow — concretely

### Card parse / validation
- **`parseCardURL(href)`** (`shared/.../invites/card.factory.ts`): `new URL(href).searchParams`
  → reads `n` (nullifier), `b` (batchId), `sig` (signature), `s` (surveyId).
  If any missing → `console.error` + returns `null`. URL-decodes each, computes
  `messageHash = cardMessageHash(decodedNullifier, decodedBatchId)`, then
  `recoverMessageAddress({ message: { raw: messageHash }, signature })` → `surveyOwner`.
  Returns `CardData { nullifier, batchId, signature, surveyOwner, surveyId }`.
  Throws (caught → null) on malformed URL/params.
  - **Signature recovery is the whole point**: in the real flow the signer must equal
    the on-chain `batchId` (registerInPool requires `ecrecover(ethSignedHash) == batchId`);
    parseCardURL independently recovers the survey owner from the same bytes.
  - It reads **only its `href` argument** — no `window`. In `router.ts`/`auth-ctrlr.ts`
    it is fed `window.location.href`. `CardData.surveyOwner` is effectively `batchId`
    for valid cards (this is exactly what the seam test asserts).

### `Card.isUsed`
```ts
async isUsed(services, surveyStore) {
  return services.viem.read(surveyStore.address, surveyStore.abi, 'isNullifierUsed',
                            [this.data.nullifier, this.data.batchId]);
}
```
Reads on-chain `isNullifierUsed(nullifier, batchId)` via `services.viem.read`.
Used in `router.ts` root gate and `batch.ctrlr.ts discardUsedCards()`. **Pure envelope
around a viem read → trivially mockable** (the whole "is this card used" decision lives
in test-land by returning true/false from a mocked `services.viem.read`).

### `Card.register`
```ts
async register(services, surveyStore, poolId) {
  return services.account.write(surveyStore.address, surveyStore.abi, 'registerInPool',
                                [poolId, this.data.nullifier, this.data.batchId, this.data.signature],
                                { waitForReceipt: true, confirmations: 2 });
}
```
Writes `registerInPool(poolId, nullifier, batchId, signature)` (the exact 4-arg shape
the on-chain oracle and shared encoding expect). **Already covered** by
`auth-ctrlr.test.ts` (asserts `card.register` called with `(services, surveyStore, poolId)`
and the navigate/alerts on receipt status). Note: `poolId` comes from `fetchSurvey` in
the auth flow, and the signature arg comes straight off the parsed card.

### Router entry gates (NOT currently tested)
`router.ts` defines the two gates:
1. **Root `/` `before` hook**: `parseCardURL(window.location.href)` → if null
   `router.navigate('/invalid-card')`; else `new Card(cardData)` → `card.isUsed(services, surveyStore)`
   → if used `router.navigate('/used-card/' + card.surveyId)`; else `done()` (renders AuthController).
2. **`/surveys/:surveyId` `before` hook**: resolve surveyId (or navigate `/surveys` if missing) →
   `fetchSurvey` → `store.setSurveyData` + `setActiveSurvey` → `hasParticipatingAccount` →
   if not, `authenticate` → if participant `done()` else `navigate('/invalid-card')`.

### Coverage ledger (respondent side)
- **Already tested**: `card-signature.seam.test.ts` pins digest/sign/recover + `parseCardURL`
  happy+missing-params. `auth-ctrlr.test.ts` pins the Card.register invocation in the root
  controller. `auth.factory.test.ts` pins `authenticate`/`hasParticipatingAccount`
  (the `/surveys` gate's helpers). `survey-ctrlr.test.ts` (7) pins the survey controller.
- **NOT yet tested**: `Card.isUsed` (the raw `services.viem.read`→`isNullifierUsed` envelope),
  `Card.register` in isolation (only exercised through the auth-ctrlr mock), the getters,
  `parseCardURL` malformed-URL / URL-decode edge cases beyond missing params, and the **whole
  router entry-gate decision logic** (`/` → used-card/invalid-card/survey; `/surveys` →
  survey/invalid-card/missing-surveyId).

---

## 3) Invitation GENERATION

- **Exists in `frontend-organiser/src/factories/invitation.factory.ts`** (NOT in `shared/`).
  Also consumed by `factories/survey.factory.ts` (`createBatch`) and
  `controllers/batch.ctrlr.ts` (`createCsvFile`/`createZipFile`).
- **It DOES NOT duplicate the seam.** It imports `{ Batch, CardData, signCardMessage }`
  from `@s3ntiment/shared` and builds signatures via `signCardMessage`. The old
  hand-rolled `encodeNullifierBatchCombo` duplicated hash logic is gone (the encoding.ts
  header documents this unification). So **no current drift risk** — the generation
  surface funnels through the same protected seam.
- **`createBatchWallet`** is the only local crypto: `crypto.randomUUID()` seed →
  `services.safe.signMessage('batch:...')` → `keccak256(toBytes(sig))` → `privateKeyToAccount`.
  This is organiser-specific (batch key derivation) and not part of the shared seam; it's
  not currently pinned anywhere.
- **Card-URL building** (round-trip opportunity): `generateCardSecrets` constructs
  `${BASEURL}?n=${nullifier}&b=${batch.id}&sig=${signature}&s=${batch.survey}`, which is
  exactly the URL shape `parseCardURL` consumes. **This is a genuine round-trip seam**:
  sign with `signCardMessage` → build URL → `parseCardURL` → recover `surveyOwner == batchId`
  (the auth/token flow). Currently only the *respondent* half of the round trip is pinned
  (card-signature.seam). The URL-*producer* (nullifier base64url + query assembly) is
  **not covered** — a test in the organiser (or a shared round-trip test) would pin it.
- **`BASEURL` build**: `import.meta.env.VITE_PROD==="true" ? VITE_FRONTEND_PROD : VITE_FRONTEND_DEV`.

---

## 4) Onboarding boundary & recommendation

Per prior instruction, onboarding/entry-screen markup stays excluded. Classification:

**(a) Genuinely in-scope invitation/card logic — worth testing:**
1. `shared/.../invites/card.factory.ts` → `Card.isUsed`, `Card.register`, `Card` getters,
   `parseCardURL` edge cases (malformed URL, url-encoded non-hex signature, etc.). **Pure/mockable.**
2. `frontend-respondents/src/router.ts` → the two **entry gates** (root + `/surveys`).
   Highest-value uncovered logic. **Needs refactor to be testable** (see §5/§6).
3. `frontend-organiser/src/factories/invitation.factory.ts` → `createBatchWallet`,
   `generateCardSecrets` (nullifier generation + URL assembly), `createCsvFile`.
   Generation surface; fills the round-trip gap.

**(b) Onboarding / entry-screen markup — keep excluded:**
- `controllers/{about,invalid-card,completed,used-card}-ctrlr.ts`,
  `components/logout.ctrlr.ts`, `onpageload.ts` (splash), `batch.ctrlr.ts` UI markup,
  `pool-form-batches.ts`, `question-card.ts`. Their logic deps (Card.isUsed etc.) are
  covered via (a)/(c).

**(c) Already pinned:**
- `shared/.../encoding.ts` (respondent card-signature.seam + contracts encoding.seam +
  contracts pnpm build gate).
- `auth.factory.ts` (authenticate / hasParticipatingAccount).
- `controllers/auth-ctrlr.ts` (root flow incl. Card.register invocation).
- `controllers/survey.ctrlr.ts`.

**Recommended test-file set for an "invitation/card" tranche:**
- `frontend-respondents/src/card-class.seam.test.ts` — Card.isUsed / Card.register /
  getters + parseCardURL edge cases (respondents vitest, node env, works now).
- `frontend-respondents/src/router-entry-gates.test.ts` — the two router `before` hooks
  (after a tiny refactor or via an extracted gate-decider helper; see §6).
- `frontend-organiser/src/factories/invitation.factory.test.ts` — createBatchWallet /
  generateCardSecrets URL round-trip / createCsvFile (**requires wiring vitest into
  frontend-organiser**, which has none — `npm test` currently errors).
- `frontend-respondents/src/card-url.round-trip.test.ts` (optional) — organiser URL-builder
  shape reproduced against shared parseCardURL; could live in shared if shared got a vitest
  runner (shared currently has **no** vitest wiring either — `npm run build` only).

Primary home = **frontend-respondents** (already wired). Organiser needs test infra first.

---

## 5) Test-setup facts for delegation

### frontend-respondents (vitest wired — node env, `include: ['src/**/*.test.ts']`, `test/setup.ts`)
Setup stub provides: `localStorage`, `window = { location: { href: '' } }`, `document`,
`alert`. No jsdom.

Per-module mocks/stubs:

- **`Card` class test** (`shared/.../card.factory.js` via relative source path —
  mirror `card-signature.seam.test.ts`'s `../../shared/src/shared/invites/*.js` import):
  - Import the real class (pure TS, only imports viem + encoding).
  - `Card.isUsed`: pass fake `{ viem: { read: vi.fn() } }` as services + fake `surveyStore`
    `{ address, abi }`; assert `read(address, abi, 'isNullifierUsed', [nullifier, batchId])`.
  - `Card.register`: fake `{ account: { write: vi.fn() } }`; assert
    `write(address, abi, 'registerInPool', [poolId, nullifier, batchId, signature],
    { waitForReceipt: true, confirmations: 2 })`.
  - No DOM needed. Import from source = no viem/encodePacked heavy-deps risk (viem is fine in node).
- **`router.ts` entry gates**: module-level side effects are the blocker:
  - `new Navigo('/')` (Navigo is a real dep — constructing it in node is fine, no DOM until resolve).
  - `surveyStore` JSON import: `with { type: 'json' }` — must be stubbed via
    `vi.mock('s3ntiment-contracts/.../S3ntimentSurveyStore.json', ...)`.
  - **`router.resolve()` at import time** — would fire routing immediately; must be neutralized.
    Best path: **refactor** the gate bodies into a pure exported helper (e.g.
    `resolveRootGate(services, cardData, surveyStore)` and
    `resolveSurveyGate(services, surveyStore, surveyId)`) returning a destination/action,
    then test the pure helper with mocked `parseCardURL`/`Card`/`fetchSurvey`/`hasParticipatingAccount`/
    `authenticate`. Alternatively mock `navigo` entirely and spy on the `before` callbacks;
    that keeps current file but is fragile to the module-scope `resolve()`. **Recommend the helper refactor.**
  - If testing raw gate: mock `@s3ntiment/shared` (Card with isUsed spy, parseCardURL),
    `./auth.factory.js` (hasParticipatingAccount, authenticate), `./state/store.js` (real or mock),
    `./onpageload.js`, `navigo` (spy callbacks), and the contracts JSON.
- **`auth.factory`** / **`auth-ctrlr`** — already done; reuse their mock patterns.

### frontend-organiser (NOT wired)
- No vitest installed (`test` script = "echo no test specified && exit 1"; no vitest in
  devDeps; no vite test config). **Blocker: must add vitest** (dep + `vitest.config.ts`
  + optionally `test/setup.ts`) to run any organiser test.
- `invitation.factory.ts` imports at module scope: `qrcode`, `jszip`, `file-saver`,
  `import.meta.env` (BASEURL). For node/vitest need stubs: `crypto.getRandomValues` +
  `crypto.randomUUID` (node ≥18 globals exist), `btoa` (node ≥16 global), `QRCode.toString`
  (mock), `saveAs` (mock `file-saver`), `Blob` (node global). `import.meta.env` resolves
  under vitest as `{}` unless `define`/env vars provided — set `VITE_FRONTEND_DEV` in config
  or assert BASEURL logic via a parametrized check.
- `createCsvFile` is the most unit-friendly (pure string assembly + saveAs) — great first test.

### shared (NOT wired)
- No vitest; `npm run build` only. `parseCardURL`/`Card` CAN be tested from
  frontend-respondents' runner via the relative-source-path precedent (no need to wire shared).

### Browser/crypto stub summary per module
- `Card` (isUsed/register): none (pure envelope). 
- `router` gates: navigo mock/spy, contracts JSON mock, shared mock, auth.factory mock, store mock.
- `parseCardURL` (tested via shared/respondents): node `URL` global works; no browser needed.
  `window.location.href` is only used by the *callers* (router/auth-ctrlr), not parseCardURL itself.
- `invitation.factory`: crypto (node), btoa (node), qrcode + file-saver + import.meta.env (stub/mock).

---

## 6) Scope recommendation + risks

### Concrete test-file plan

**Tranche A — frontend-respondents (works today, no infra change):**
1. `card-class.seam.test.ts`
   - `Card.isUsed` → `viem.read(…'isNullifierUsed'…, [nullifier,batchId])` (true/false passthrough, prop of read rejection).
   - `Card.register` → `account.write(…'registerInPool', [poolId,nullifier,batchId,signature], opts)`; passthrough of tx + rejection.
   - Getters `surveyId/nullifier/batchId`.
   - `parseCardURL`: already pinned for happy/missing; add **malformed URL** (`not-a-url`), non-hex/weird signature, extra params, url-encoded nullifier round trip.
2. `router-entry-gates.test.ts` (after refactor — see risk R1)
   - Root gate: card null → invalid-card; card used → used-card/:surveyId; card fresh → survey (done).
   - `/surveys` gate: surveyId present/absent; isPoolMember true → done; false → authenticate→true → done; authenticate→false → invalid-card; fetchSurvey populates store.

**Tranche B — frontend-organiser (needs vitest infra first, risk R2):**
3. `factories/invitation.factory.test.ts`
   - `createBatchWallet`: deterministic-ish (batchId != signer-address etc.), returns batchAccount + address.
   - `generateCardSecrets`: N nullifiers, all unique; each signature recovers to batch.id via `recoverMessageAddress`; **URL shape matches parseCardURL params** (`n/b/sig/s`) → round-trip with shared `parseCardURL` recovers `surveyOwner == batch.id`. (This is the highest-value new coverage.)
   - `createCsvFile`: quoted CSV string + saveAs called with Blob + correct filename.

**Tranche C (optional) — round-trip seam in respondents or shared:**
4. `card-url.round-trip.test.ts` — reproduce organiser URL assembly, feed to shared `parseCardURL`, assert recovered owner == batchId. Captures the producer handshake without organiser infra.

### Risks / blockers
- **R1 (router testability) — HIGH.** `router.ts` does module-scope `router.resolve()` + real Navigo + JSON import. Recommend extracting the two gate decision bodies into pure exported helpers (`resolveRootGate`, `resolveSurveyGate`) so the decision logic is testable without a DOM/router harness. This is the one place that likely wants a *refactor before/with* the test.
- **R2 (organiser no vitest) — HIGH.** Must add `vitest` + config + `test/setup.ts` to `frontend-organiser` (package.json test script currently errors). Multiple browser-only deps (QRCode, file-saver, import.meta.env BASEURL) need stubbing; `generateCardSecrets` also shells to `services.safe/IPFS` indirectly (createBatchWallet needs a `services.safe.signMessage` mock).
- **R3 (shared no vitest).** Not a blocker (respondents' relative-source-path precedent imports shared .ts directly); only blocks a *standalone* shared-located test. Prefer respondents location.
- **R4 (pure-onchain only).** No fully untestable pure-onchain bits on the invitation/card path: encoding is already pinned, and `isUsed`/`register`/`isPoolMember` are thin viem envelopes that mock cleanly. The only "unmockable browser" pieces are the entry-screen controllers we're deliberately excluding.
- **R5 (import.meta.env).** `invitation.factory.ts` reads `import.meta.env` at module scope — tests must set `VITE_FRONTEND_DEV`/`VITE_PROD` (or the shared `empty-module.ts`-style alias) so BASEURL resolves deterministically.

### Net recommendation
Highest ROI, lowest risk = **Tranche A (respondents)** now: `card-class.seam.test.ts`
(immediately) + `router-entry-gates.test.ts` (pair with the small gate-helper refactor).
Then **Tranche B (organiser)** for the generation/round-trip, gated on wiring vitest into
`frontend-organiser`. Round-trip test (Tranche C) can be landed inside Tranche A's
respondents runner to close the producer/consumer seam risk without waiting on organiser infra.

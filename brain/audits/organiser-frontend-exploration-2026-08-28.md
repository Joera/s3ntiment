# Organiser Frontend — Card-Generation Test-Surface Exploration (Tranche B)

**Date:** 2026-08-28
**Scope:** `frontend-organiser` package @ `main` (HEAD `f23d0dfd3`, which includes the
respondent invitation/card tests from PR #11 `3faa86ac1`).
**Mode:** read-only exploration; no test/source files created or modified.
**North star:** frontend integration of the shared card encoding seam
(`shared/src/shared/invites/encoding.ts` — `cardMessageHash` + `ethSignedMessageHash` +
`signCardMessage`, plus `parseCardURL`) so the ORGANISER (producer) side gets covered the
same way the respondent consumer side was in Tranche A.

> Note on reference files: the mission names `brain/audits/respondent-invite-card-2026-08-28.md`,
> which does not exist. The actual teed-up audit is
> `brain/audits/respondent-invite-card-exploration-2026-08-28.md` (read in full; §3, §4, §5, §6
> are the direct input to this report). Shared methodology:
> `brain/audits/respondent-coverage-gaps-2026-08-28.md`.

---

## 1) Stack + structure of `frontend-organiser`

### Framework
- Vanilla TypeScript + **Vite 7.3.1**; **no SPA framework** (no React/Vue). UI is web/custom
  elements + a **Navigo 8** hash/URL router. Node 18+ browser globals (`crypto.getRandomValues`,
  `randomUUID`, `btoa`, `Blob`) assumed throughout.
- Entry chain: `index.html` → `src/main.ts` (inject fonts/tokens/styles, then
  `getServices().initialize()` → `authenticate(services)` → `initRouter(services)` →
  `removeSplash()`).
- Vite config (`vite.config.js`): `nodePolyfills`, `wasm`, `topLevelAwait`,
  `viteStaticCopy` plugins; aliases `react`/`react-dom` → `src/empty-module.ts`; dev server
  port 7783. **No test config block.**

### `package.json` (name + exact test-script state)
- **name:** `"@s3ntiment/frontend-organiser"` (`"type": "module"`).
- **`test` script (broken):** `"test": "echo \"Error: no test specified\" && exit 1"`. Running
  `pnpm test` in this package prints the error and exits 1 — no runner wired.
- Other scripts: `dev` (vite), `build`
  (`NODE_OPTIONS='--max-old-space-size=16384' vite build`), `preview`. **No `tsc` build step**;
  `build` is pure vite (so test files under `src/` aren't a tsc-build concern the way a
  standalone `tsc` compile would be).
- **devDependencies:** `@types/d3`, `@types/node`, `glob`, `sass-embedded`, `vite` +
  `vite-plugin-*`. **No `vitest`** (contrast `frontend-respondents` which has
  `"vitest": "^4.1.11"`). It also carries `@types/file-saver`, `@types/qrcode`.
- **dependencies (heavy):** `@holonym-foundation/mishtiwasm` (WASM), `@human.tech/waap-sdk`,
  `@lit-protocol/{auth,auth-helpers,constants,lit-client,networks}`, `@nillion/*`, `ethers`,
  `permissionless`, `qrcode`, `jszip`, `file-saver`, `navigo`, `viem`, `d3`, `slugify`, `uuid`,
  `s3ntiment-contracts` (workspace), `@s3ntiment/shared` (workspace).
- **Typo vs. respondent:** the tsconfig is `ts.config.json` (dot-separated), not `tsconfig.json`.

### `src/` layout
```
components/   (survey-forms/*, survey-results/*, pool-list, survey-list, draft-survey-editor,
               import-pool, import-survey, access-request, landing-*, registered-questions-*, …)
controllers/  batch.ctrlr.ts | landing.ctrlr.ts | new.ctrlr.ts.ts | overview.ctrlr.ts |
              pool.ctrlr.ts | survey.ctrlr.ts | account.ctrlr.ts | logout.ctrlr.ts
factories/    auth.factory.ts | invitation.factory.ts | pool.factory.ts | survey.factory.ts
services/     services.ts   (IServices + ServiceContainer singleton)
state/        store.ts + ui/drafts/surveys/pool/batch stores + observable + storage + types
utils/        hex.ts | random.ts | regex.ts | reactive.ts
main.ts  router.ts  onpageload.ts  constants.ts  empty-module.ts  vite-env.d.ts
```

---

## 2) The card-generation / invitation seam — exactly

### `src/factories/invitation.factory.ts` (the producer surface under focus)
Imports: `QRCode` (default), `keccak256, toBytes` (viem), `JSZip` (default), `saveAs`
(file-saver), `privateKeyToAccount` (viem/accounts), `{ Batch, CardData, signCardMessage }`
from `@s3ntiment/shared`, `IServices` from `../services/services`.

**Module-scope side effect (the testability crux):**
```ts
const BASEURL = import.meta.env.VITE_PROD == "true"
  ? import.meta.env.VITE_FRONTEND_PROD
  : import.meta.env.VITE_FRONTEND_DEV;
```
`import.meta.env` resolves to `{}` under plain vitest unless `define`/env vars are provided —
so `BASEURL` would be `undefined` at import unless the runner defines `VITE_FRONTEND_DEV`.

**`generateRandomNullifier()`** (module-private, not exported): 16 random bytes →
`btoa(String.fromCharCode(...bytes))` → base64url (strip `+ / =`). Pure crypto, browser globals
(`crypto.getRandomValues`, `btoa` both exist in node ≥16/18).

**`generateQRCodeSVG(url)`** (module-private): `QRCode.toString(url, { type:'svg', width:500,
margin:2, color:{dark:'#000000',light:'#FFFFFF'}, errorCorrectionLevel:'M' })`.

**`createBatchWallet(services)`** — organiser-specific batch key derivation, **not** part of the
shared seam:
```ts
const seed = crypto.randomUUID();
const batchSignature = await services.safe.signMessage(`batch:${seed}`);
const batchPrivKey = keccak256(toBytes(batchSignature));
const batchAccount = privateKeyToAccount(batchPrivKey);
return { batchId: batchAccount.address, batchAccount };
```
`batchAccount` held in memory only; `batch.id` becomes the on-chain `registerBatch`/pool identity.

**`generateCardSecrets(batchAccount, batch): Promise<CardData[]>`** — builds the card URL:
```ts
const nullifier = generateRandomNullifier();
const signature = await signCardMessage(batchAccount, nullifier, batch.id);
const url = `${BASEURL}?n=${nullifier}&b=${batch.id}&sig=${signature}&s=${batch.survey}`;
return { nullifier, signature, url, svgString: await generateQRCodeSVG(url) };
```
`batch.amount` cards, `Promise.all`. **Key facts for the round-trip test:**
- It funnels the signature through the shared **`signCardMessage`** (no local hand-rolled
  digest — the old `encodeNullifierBatchCombo` duplication is gone, per encoding.ts header).
- URL param names `n`/`b`/`sig`/`s` are **exactly** what `parseCardURL` consumes from
  `shared/.../invites/card.factory.ts`, and the nullifier is base64url (URL-safe, so
  `decodeURIComponent` in `parseCardURL` passes it through unchanged) — this is a genuine
  producer→consumer seam.

**`createZipFile(cards, surveyId)`:** `zip.file(\`qr-${String(i+1).padStart(3,'0')}.svg\`, card.svgString)`
for i=0..n, `zip.generateAsync({type:'blob'})`, `saveAs(zipBlob, \`s3ntiment-qr-codes-${surveyId}.zip\`)`.

**`createCsvFile(values, filename)`:** `csv = values.map(v => \`"${v}"\`).join('\n')`,
`new Blob([csv], {type:'text/csv'})`, `saveAs(blob, \`${filename}.csv\`)`. — **the most
unit-friendly surface** (pure string assembly + Blob + saveAs).

**`uploadToPinata(services, cards)`:** per card `services.ipfs.uploadToPinata(card.svgString!,
\`${card.batchId}-${i}\`)` → sets `card.ipfsCid`.

### Producers / persistence of cards & surveys
- **`src/factories/survey.factory.ts`:**
  - `createBatch(services, batch, poolId, surveyId)`:
    `createBatchWallet` → `batch.id = getAddress(batchId)` → `batch.survey = surveyId`,
    `batch.pool = poolId` → `batch.cards = await generateCardSecrets(batchAccount, batch)` →
    `batch.cards = await uploadToPinata(services, batch.cards)` → returns `batch`.
  - `registerBatch(services, batch)`: `services.account.write(surveyStore.address, surveyStore.abi,
    "registerBatch", [batch.pool, batch.id], { waitForReceipt: true })`.
  - Imports `s3ntiment-contracts/deployments/base/S3ntimentSurveyStore.json` via
    `assert { type: 'json' }` and `permissionless/accounts` (a `deploySafe` helper is commented out).
- **`src/controllers/new.ctrlr.ts.ts`** (`NewSurveyController.handleSurveySubmit`) — the full
  survey/pool/invite creation orchestration: `services.safe.connectToFreshSafe/connectToExistingSafe`,
  `services.safe.getSignerAddress`, `signMessage("Request owner invocation")`, then backend
  `fetch(POST ${BACKENDURL}/api/pools)` → per-batch `createBatch` → on-chain
  `safe.write(surveyStore, 'createSurvey', [surveyId, poolId, "0", batchIds])` →
  `fetch(POST /api/builder/register)` → `fetch(POST /api/surveys, {signature,userAddress,surveyConfig})`
  → `safe.write(..., 'updateSurvey', [surveyId, cid])` → `store.addBatch/addSurvey` →
  `router.navigate(...)`. `BACKENDURL` also from `import.meta.env` at module scope.
- **`src/controllers/batch.ctrlr.ts`** (`BatchController`): renders QR/IPFS/URL tabs;
  `discardUsedCards()` loops `batch.cards`, sets `c.batchId = this.batchId`,
  `new Card(c).isUsed(this.services, surveyStore)` → marks `c.isUsed`; `setListeners()` wires
  Download → `createZipFile` / `createCsvFile` (IPFS gateway & URLs built from
  `import.meta.env.VITE_PINATA_GATEWAY`).

---

## 3) User-facing REQUEST/CREATION logic — value & cleanliness

### Cleanly-testable (constructor-injected deps / pure / framework-agnostic) — HIGH value
| Surface | Function(s) | Why testable | Notes |
|---|---|---|---|
| **`factories/invitation.factory.ts`** | `createBatchWallet` | DI: only needs a `services.safe.signMessage` mock | isolated crypto; underscore-testable |
| | `generateCardSecrets` | `batchAccount` + `batch` passed in; signature via shared `signCardMessage` | needs QRCode mock + `import.meta.env` define |
| | `createCsvFile` | pure string + Blob + saveAs | easiest unit target |
| | `createZipFile` | JSZip.generateAsync async + saveAs | mock file-saver |
| `utils/hex.ts` | `ensureHex` | pure (throw on empty / invalid) | trivial |
| `utils/regex.ts` | `isCid`, `isDid`, `isDidKey` | pure regex | trivial |
| `utils/random.ts` | `randomBytes`, `bytesToHex` | thin crypto wrappers | trivial |
| `state/*` | `store.ts`, `ui/drafts/surveys/pool/batch.store.ts`, `observable.ts`, `storage.ts` | pure logic, no DOM | mirrors respondent state gap — but see note on `storage.ts` (localStorage at construction → needs the `setup.ts` localStorage stub) |

### Entangled with heavy dependency stack — LOW testability w/o mocking (waap/OPRF, Lit, Nillion, browser globals, backend)
| Surface | Function(s) | Entanglement |
|---|---|---|
| `services/services.ts` | `ServiceContainer.initialize()` | constructs `ViemService`, `WaapService`, `PermissionlessSafeService`, `PermissionlessSimpleService`, `LitService`, `IPFSMethods`, `OPRFService`; calls `waap.login(base)` + `oprf.init()`; reads `import.meta.env` everywhere. Singleton + double-init guard untested. |
| `factories/auth.factory.ts` | `authenticate` | `waap.signMessage` → `oprf.getSecp256k1` → `safe.updateSignerWithKey`. OPRF/waap-heavy. |
| `factories/survey.factory.ts` | `createBatch`, `registerBatch` | network/IPFS/pinata + `s3ntiment-contracts` JSON + permissionless import at module scope. |
| `factories/pool.factory.ts` | `getPoolInfo` | `viem.read` ×3 (getPool, getPoolBatches, safe getOwners) + contracts JSON + hand-inlined ABI. |
| `controllers/new.ctrlr.ts.ts` | `handleSurveySubmit` | waap/OPRF (via authenticate)/safe/lit + backend fetches + `import.meta.env.BACKENDURL` + contracts JSON. |
| `controllers/batch.ctrlr.ts` (non-DOM part) | `discardUsedCards` | the loop logic is testable-ish via `Card.isUsed` mock + fake store; but the class mixes DOM template + `document` + `store` + `reactive`. |
| `router.ts` | `initRouter` | module-scope `new Navigo('/')` + **`router.resolve()` at call time** + imports every controller. |

Note the respondent `Card` class (shared `card.factory.ts`) is **already** covered on the
consumer side by `card-class.seam.test.ts` / `card-signature.seam.test.ts` / `card-url.round-trip.test.ts`
(11 + 5 + 3 tests); the organiser consumers of `Card` (`batch.ctrlr.discardUsedCards`) only need
the mock path, not new `Card` coverage.

---

## 4) Existing test setup — confirm none; the respondent precedent to mirror

- **`frontend-organiser`: NONE confirmed.** Zero `*.test.ts`/`*.spec.ts` under `src/`, no
  `vitest.config.ts`, no `test/`, no `vitest` in devDeps, and `test` script exits 1. Adding the
  tranche requires infra first.
- **`frontend-respondents` precedent (mirror this):**
  - `package.json`: `"test": "vitest run"`, `"vitest": "^4.1.11"` in devDeps.
  - `vitest.config.ts`: `environment: 'node'` (no jsdom), `include: ['src/**/*.test.ts']`,
    `setupFiles: ['./test/setup.ts']`, `reporters: ['default']`, plus
    `resolve.alias` mapping `react`/`react-dom` → `src/empty-module.ts`.
  - `test/setup.ts`: installs global stubs **at import time** — in-memory `localStorage`,
    `window = { location: { href: '' } }`, `document = { querySelector: () => null }`, `alert`.
  - tsconfig: `rootDir: './src'`; the build is pure vite, so `.test.ts` under `src/` are picked
    up by vitest's include glob and are not compiled as app modules.
  - Shared source is imported by **direct relative source path**
    (`../../shared/src/shared/invites/encoding.js` etc.), bypassing the unbuilt `@s3ntiment/shared`
    dist — this is the seam-test precedent that lets organiser tests exercise real shared bytes.

---

## 5) How to test `invitation.factory.ts` specifically

- **Imports:** `qrcode`, `jszip`, `file-saver`, `viem`, `viem/accounts`,
  `@s3ntiment/shared` (`Batch`, `CardData`, `signCardMessage`), `../services/services` (type-only
  `IServices`), and `import.meta.env` at module scope.
- **Pure/DI-testable?** Largely yes, with three stubs:
  1. `import.meta.env` — must be defined (`VITE_FRONTEND_DEV`) or `BASEURL` is `undefined`.
     In vitest, set via `test.env`/`define` or just assert the URL *shape* with a defined
     `VITE_FRONTEND_DEV`.
  2. `qrcode` (default export) — `vi.mock('qrcode')` returning `{ toString: vi.fn().mockResolvedValue('<svg/>') }`.
  3. `file-saver` — `vi.mock('file-saver', () => ({ saveAs: vi.fn() }))`.
  `createBatchWallet` only needs a `services.safe.signMessage` mock; `generateCardSecrets` needs
  a `batchAccount` (from `privateKeyToAccount` of a fixed key — the exact pattern
  `card-signature.seam.test.ts` uses) + a real `batch`.
- **Shared import path:** two options.
  - Relative source path (`../../shared/src/shared/invites/encoding.js`) — **the respondent
    precedent, recommended**. Keeps the test on real shared `.ts` source and kills any dist staleness.
  - `@s3ntiment/shared` — works for a running vite build but resolves to `dist/...` via the
    package `exports` map (`.`, `./dev`, `./invites/encoding` all point at dist except `./dev`),
    which may be unbuilt in a fresh checkout. Prefer the relative source path, matching the
    respondents.
- **Producer→consumer round-trip as an organiser-side seam test WITHOUT a node:** yes.
  - Proof of concept already exists and passes **in the respondents runner**
    (`card-url.round-trip.test.ts`, 3 tests): reproduce the producer URL assembly `${BASEURL}?n=…&b=…&sig=…&s=…`,
    feed it to shared `parseCardURL`, assert `surveyOwner === batchId`. It needs no node and no
    DOM — `new URL()` and `recoverMessageAddress` are pure/offline.
  - On the organiser side the same test becomes: call the *real* `generateCardSecrets` (mock only
    QRCode + define `VITE_FRONTEND_DEV`), then call shared `parseCardURL` on each returned `card.url`
    and assert recovered `surveyOwner === batch.id` (and `surveyId`/`nullifier` round-trip). No node,
    no validator, no network. This is the single highest-value new coverage: it pins the producer
    half of the handshake against the exact consumer + on-chain-validated bytes.
- **URL shape to freeze** (quote for tests):
  ```
  ${BASEURL}?n=${base64urlNullifier}&b=${batchId(0x address)}&sig=${0x signature}&s=${batch.survey}
  ```
  with nullifier = `btoa(16 bytes).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'')`,
  and `sig` recoverable to `batch.id`. `parseCardURL` URL-decodes `n/b/sig/s`, computes
  `cardMessageHash(decodedNullifier, decodedBatchId)`, recovers `surveyOwner`.

---

## 6) Scoped first tranche + risks

### Recommended Tranche B (highest value / lowest risk), mirroring respondent methodology
Wire vitest into `frontend-organiser` exactly like `frontend-respondents`:
- **Infra (prereq):** add `vitest ^4.x` to devDeps; add `vitest.config.ts`
  (`environment:'node'`, `include:['src/**/*.test.ts']`, `setupFiles:['./test/setup.ts']`,
  alias `react`/`react-dom` → `empty-module.ts`, plus a `define` or `env` for
  `VITE_FRONTEND_DEV`); add `test/setup.ts` (copy respondent stub: `localStorage`, `window`,
  `document`, `alert`; optionally `crypto.getRandomValues` — already a node global). Change
  `test` script to `vitest run`. Correct `ts.config.json` → `tsconfig.json` if desired (not
  strictly required by vite).

**Test files + rough counts:**
1. **`src/factories/invitation.factory.test.ts`** (~12–15 `it`):
   - `createBatchWallet`: with `services.safe.signMessage` mocked to a fixed value → deterministic
     `batchId`; `batchId !== {} `and is a 0x address; each keccak derived from the mocked signature;
     `batchAccount` private key never returned/persisted (shape check).
   - `generateCardSecrets`: `batch.amount` cards; all nullifiers unique + base64url-shaped
     (`/^[A-Za-z0-9_-]{22}$/` for 16 bytes → 22 chars after padding-strip); every `card.url`
     matches `${BASEURL}?n=…&b=…&sig=…&s=…`; **round-trip each `url` through shared `parseCardURL`
     → `surveyOwner === batch.id`, `nullifier`, `surveyId`, `batchId` all recovered**; every
     `card.svgString` present (QRCode toString called with url).
   - `createCsvFile`: quoted + newline-joined CSV string, `Blob` of `text/csv`, `saveAs` called
     with `\`${filename}.csv\``.
   - `createZipFile`: `saveAs` called with `s3ntiment-qr-codes-${surveyId}.zip` and a blob
     (JSZip real; no DOM needed).
2. **`src/utils/hex.test.ts`** (~4): `ensureHex` valid/with-0x/lowercases/throws-empty/throws-invalid.
3. **`src/utils/regex.test.ts`** (~3): `isCid` v0+v1 accept, reject; `isDid`/`isDidKey` accept/reject.
4. (Optional, higher effort) **`src/factories/survey.factory.test.ts`** — `createBatch` with
   `createBatchWallet`/`generateCardSecrets`/`uploadToPinata` mocked: asserts `batch.id = getAddress(...)`,
   `batch.survey = surveyId`, `batch.pool = poolId`, cards uploaded with `\`${batchId}-${i}\`` names.
   `registerBatch` with `services.account.write` mock → `('registerBatch', [batch.pool, batch.id], {waitForReceipt:true})`.

**Env needs:** `VITE_FRONTEND_DEV` (URL shape) — others (`VITE_PROD`, `VITE_ALCHEMY_KEY`, …)
must **not** be needed for these files; do not import `services.ts`/`auth.factory.ts`/`survey.factory.ts`
at module scope in the unit tests (only type-import `IServices`), else `import.meta.env.VITE_*`
and the heavy constructors leak in.

### Anything needing a production refactor to be testable — and is it behavior-preserving?
- **`BASEURL` module-scope read (`import.meta.env`)** is the only real snag for
  `invitation.factory`. A behavior-preserving refactor (export a `buildBaseURL(env={})` or accept
  `baseUrl` param defaulting to the env read) would make it pure and DRY; **not required** if tests
  simply `define` `VITE_FRONTEND_DEV` in `vitest.config.ts`. Given the north-star is a seam test,
  the define-route is lowest-footprint and fully behavior-preserving.
- **`createBatchWallet`'s `services.safe.signMessage`** is already DI → no refactor.
- **`qr→svg` / `file-saver`** are both mocked → no refactor.
- **`new.ctrlr.ts.ts` / `services.ts` / `router.ts`** are intentionally out of the first tranche —
  they'd need extraction (e.g. pure gate/step helpers) to be testable; that is a *separate* refactor,
  deferrable and not needed for the seam goal. Any such extraction should be behavior-preserving
  (move bodies to exported pure functions; leave controller wiring intact) — same recommendation
  the respondent audit made for `router.ts` gates.

### Risks
- **R1 (infra, HIGH but mechanical):** organiser has no vitest; adding dep + config + `setup.ts`
  + swapping the `test` script is required before any organiser test runs. Mirror respondents to
  avoid jsdom.
- **R2 (`import.meta.env` BASEURL):** module-scope read → define `VITE_FRONTEND_DEV` in config, or
  it comes out `undefined`.
- **R3 (dependency graph):** do not let a test transitively import `services.ts`/`auth.factory.ts`
  (waap/OPRF/Lit) or the `s3ntiment-contracts` JSON with `assert { type:'json' }` unless mocked —
  keep to `invitation.factory` + `utils` only for the first tranche.
- **R4 (browser globals):** `crypto.getRandomValues`/`randomUUID`/`btoa`/`Blob`/`URL` all exist in
  Node ≥18 — no jsdom needed for `invitation.factory`/`utils`. `storage.ts` needs the `localStorage`
  stub only if the state tranche is included.
- **R5 (shared import):** use the relative-source-path precedent, not `@s3ntiment/shared` (which
  resolves to possibly-unbuilt `dist`), so tests always exercise real shared source.

### Net recommendation
Mirror `frontend-respondents`' vitest wiring verbatim into `frontend-organiser`; land
**`factories/invitation.factory.test.ts`** with the producer→consumer
`generateCardSecrets`→`parseCardURL` round-trip at its centre (the highest-value, lowest-risk new
coverage — pins the producer half of the handshake to the same on-chain-validated bytes the
respondents already pin), plus the trivial `utils` tests. No production refactor is required for
this tranche; the only optional, behavior-preserving tweak is exporting `buildBaseURL` if the
`define`-route becomes fragile.

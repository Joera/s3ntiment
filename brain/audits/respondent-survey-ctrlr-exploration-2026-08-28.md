# ht respondent frontend — surveyController exploration (read-only)

Date: 2026-08-28
Repo: `/home/joera/code/s3ntiment` on `main` @ `28fdf8c4b` (Pull request #8 merged; includes PR #7 `bd9da7a48`).
Scope: exploration only — no source or test code written. Goal: map `frontend-respondents`' survey controller so its vitest suite can be written next, following the authController pattern already proven in PR #7.
Companion audits (same effort): `brain/audits/ht-respondent-auth-exploration-2026-08-28.md`, `brain/audits/seam-coverage-exploration-2026-08-28.md`, `brain/audits/shared-encoding-2026-08-28.md`.

---

## 1. Exact path + content summary

- File: `frontend-respondents/src/controllers/survey.ctrlr.ts`
- Class: `SurveyController` (default-ish; named export `SurveyController`).
- Constructor: `(services: IServices, surveyId: string)` — stores both, never sets `this.pool`.
- Public fields: `reactiveViews: any[]`, `documentId: any`, `services`, `surveyId`, `survey?: Survey`, `pool?: Pool`.
- Members:

| Member | Kind | Notes |
|---|---|---|
| `renderLoading()` | private | `document.querySelector('#app')`, sets innerHTML to `<loading-spinner …>` under `#survey-content`. Returns early if `#app` is null. |
| `renderWarning(msg)` | private | `document.querySelector('#app')`, sets `Decryption failed: …` under `#survey-content`. Early-return if null. |
| `renderTemplate()` | private | `document.querySelector('#app')` → clears to a `#survey-content` div, creates a `reactive('#survey-content', …)` view that renders `<survey-questions survey-id=…>`, `view.bind(store.surveys$)`, pushes to `reactiveViews`. |
| `process()` | public | **Empty no-op** (`async process() {}`). Nothing to test. |
| `render()` | public async | Main flow (see §2). |
| `destroy()` | public | destroys + clears `reactiveViews`. |
| `setSurveyListener()` | public async | registers the `survey-complete` handler (see §2). |

Module-level side effects (matter for import-time testing, see §6):
- Top-level `const BACKENDURL = import.meta.env.VITE_PROD == "true" ? VITE_BACKEND_PROD : VITE_BACKEND_DEV` (reads `import.meta.env` at import).
- `import '@s3ntiment/shared/components'` (side-effect custom-element registration).
- `import '../components/survey-questions.js'` (side-effect, calls `customElements.define("survey-questions", …)` at top level — needs `customElements` or a mock).
- `import surveyStore from 's3ntiment-contracts/deployments/base/S3ntimentSurveyStore.json' with { type: 'json' }`.
- `import { store } from '../state'` (real store; instantiation reads `localStorage` at import — already stubbed by `test/setup.ts`).
- `createUserDataObject` imported from `@s3ntiment/shared` (line 10) but **never used** — dead import.

---

## 2. Flow: routes, parsing, services, navigation

The controller is instantiated by `src/router.ts` at route `/surveys/:surveyId`:

```ts
.on('/surveys/:surveyId', (match) => {
  currentController = new SurveyController(services, surveyId);
  currentController.render();
}, { before(done, match) { /* entry gate — see §3 */ } })
```

### `render()` (async)
1. `surveyFromStore = store.getSurveyData(surveyId)`.
2. If `surveyFromStore && surveyFromStore.pool`:
   - `renderLoading()`.
   - `survey = await fetchAndDecryptSurveyWithRespondent(this.services, surveyStore, this.surveyId, this.pool!.config, BACKENDURL)` — shared fn; real impl (in `shared/src/shared/survey/survey.factory.ts`) does: `services.viem.read(getSurvey)` → `services.ipfs.fetchFromPinata(cid)` → `services.account.signMessage("Request capability to decrypt")` → `withRetry(() => fetchLitApiKey(backendUrl, signer, sig, poolId))` (network) → `services.lit.decrypt(...)`. **This controller calls it with `this.pool!.config`, and `this.pool` is never assigned — see §6/risk R1.**
   - On success: `this.survey = survey; survey.isScored = isScored(survey.groups); store.setSurveyData(...); store.persistSurveys(); renderTemplate(); setSurveyListener();`.
   - `catch (e)`: `console.error(...)` + `renderWarning(e.message)`.
3. Else → `alert("survey and pool not found")`.

### `setSurveyListener()` (async)
- `document.addEventListener("survey-complete", async ev => …)`.
- Handler body:
  1. `seed = await services.account.createNillDBSeed()`
  2. `await services.nillDB.init(seed)`
  3. `docId = crypto.randomUUID()` (**browser global, not stubbed in setup**)
  4. `signature = await services.account.signMessage("s3ntiment:submit")`
  5. Build `args = { userDid: nillDB.userDidString, signature, userAddress: account.getSignerAddress(), poolId: this.survey?.pool, pkpId: this.pool?.config.pkpId, pkpDid: this.pool?.config.pkpDid }`
  6. `fetch(`${BACKENDURL}/api/surveys/${surveyId}/delegation`, {method:"POST", body: JSON.stringify(args)})` → `.then(r=>r.json())` → `delegation`
  7. `result = await services.nillDB.storeOwned(docId, this.survey!, this.pool?.config!, ev.detail.answers, this.surveyId, delegation)`
  8. `if (result.ok) router.navigate(`complete/${surveyId}/${docId}`)` — note the navigate target is relative (`complete/…`, no leading slash) and `router` here is the real `src/router.js` singleton (must be mocked in tests).

Services consumed: `account` (`createNillDBSeed`, `signMessage`, `getSignerAddress`), `nillDB` (`init`, `userDidString`, `storeOwned`). `fetchAndDecryptSurveyWithRespondent` indirectly consumes `viem`, `ipfs`, `lit`, `account` — but because it's imported from the mocked `@s3ntiment/shared`, a unit test can stub it wholesale.

---

## 3. Onboarding / entry that must be EXCLUDED (per auth-tranche precedent)

The PR #7 precedent deliberately **excluded the onboarding controllers** (`invalid-card`, `completed`, `about`) from tests, and tested only `auth.factory.ts` + `controllers/auth-ctrlr.ts` (+ the card-signature seam). For the survey tranche:

- The real **entry gate** lives in `src/router.ts`, not in `survey.ctrlr.ts`:
  - root `/` `before` handler: `parseCardURL(window.location.href)` → `new Card(cardData)`, `card.isUsed(services, surveyStore)` → routes to `/used-card/:surveyId` or `/invalid-card`. This is the **card-encoding + on-card verification seam**.
  - `/surveys/:surveyId` `before` handler: `fetchSurvey(services, surveyStore, surveyId)` → `store.setSurveyData` + `setActiveSurvey` → `hasParticipatingAccount(services, poolId)` / `authenticate(services, poolId)` → `done()` or `/invalid-card`.
- The user's stated priority is the **tested card-encoding seam** (`shared/src/shared/invites/encoding.ts`); that is already pinned by `frontend-respondents/src/card-signature.seam.test.ts` and `contracts/test/encoding.seam.test.ts`, and exercised on entry by `auth-ctrlr` tests + `Card.register`.
- **Excluded from the survey suite**: entry/participant-verification (router `before` handlers, `authenticate`, `hasParticipatingAccount`, `Card`/`parseCardURL`/`Card.isUsed`), and the `invalid-card`, `completed`, `about`, `used-card` controllers (still untested by consensus/precedent).

So for the survey controller, the in-scope subject is **post-participant survey loading + submission**, not the gate.

---

## 4. Dependencies on `@s3ntiment/shared`; reachability of the card-encoding seam

Direct `@s3ntiment/shared` imports in `survey.ctrlr.ts`: `fetchAndDecryptSurveyWithRespondent`, `isScored`, `Pool`, `Survey` (type-only), `createUserDataObject` (dead). Plus the side-effect `@s3ntiment/shared/components`.

**Encoding-seam reachability: NOT directly reachable from this controller.**
- `grep` of `survey.ctrlr.ts` for `cardMessageHash|signCardMessage|parseCardURL|encoding|Card` → **none**.
- The card-encoding seam (`encoding.ts`: `cardMessageHash`, `ethSignedMessageHash`, `signCardMessage`; `card.factory.ts`: `parseCardURL`, `Card`) is imported into *entry* code (`router.ts` root guard, `auth-ctrlr.ts`, `auth.factory.ts`) and is transitively re-exported by the `@s3ntiment/shared` package root (`shared/src/shared/invites/index.ts` → `encoding.js`, `card.factory.js`). Importing `survey.ctrlr.ts` therefore makes the module reachable in the import graph only via the (to-be-mocked) shared package.
- The survey controller's only signature-producing call is `services.account.signMessage("s3ntiment:submit")` for the submission-delegation POST — this is **not** the card-encoding seam (which signs the card digest to prove batch ownership → `registerInPool`).
- Conclusion: the survey test suite should **mock `@s3ntiment/shared`** (fetchAndDecryptSurveyWithRespondent, isScored) following the `auth-ctrlr.test.ts` precedent, and does **not** need to re-verify the encoding seam (already pinned by `card-signature.seam.test.ts`).

---

## 5. Existing test setup / patterns the new test must follow

Config & scripts (all from PR #7, on main):
- `frontend-respondents/package.json`: `"test": "vitest run"`; vitest `^4.1.11` in devDeps.
- `frontend-respondents/vitest.config.ts`:
  - `test.environment: 'node'` (**no jsdom** — browser surface is stubbed via mocks).
  - `include: ['src/**/*.test.ts']` → **new test file must live under `frontend-respondents/src/…`** (e.g. `src/controllers/survey-ctrlr.test.ts`).
  - `setupFiles: ['./test/setup.ts']`.
  - `resolve.alias`: `react`/`react-dom` → `src/empty-module.ts` (neutralize transitive React).
- `frontend-respondents/test/setup.ts` installs minimal node stubs: `localStorage` (Map-backed), `window = {location:{href:''}}`, `document = { querySelector: () => null }`, `alert` (no-op). **It does NOT stub**: `document.addEventListener`, `crypto.randomUUID`, or global `fetch`.

Established test patterns (the two files to mirror):
- `src/controllers/auth-ctrlr.test.ts`:
  - `const h = vi.hoisted(() => ({…}))` for configurable mock impl + instance capture.
  - `vi.mock('@s3ntiment/shared', () => ({...}))` to stub the whole package (heavy deps: Lit/Nillion/waap/etc.).
  - `vi.mock('@s3ntiment/shared/components', () => ({}))`.
  - `vi.mock('../router.js', () => ({ router: { navigate: vi.fn() } }))`, `vi.mock('../auth.factory.js', …)`, `vi.mock('../onpageload.js', …)`.
  - Per-test `installBrowserGlobals()` overriding `window.location.href`, `document.querySelector` (returns `{innerHTML:'',style:{}}`), `alert`, `localStorage`.
  - Imports the **real** `store` (`../state/store.js`) for assertions; mocks shared fns to return fixtures.
- `src/auth.factory.test.ts`: creates a fake `IServices` with `vi.fn()` members (`viem.read`, `waap.*`, `account.*`, `oprf.*`) and reads the committed `s3ntiment-contracts` deployment JSON via the workspace exports map.
- `src/card-signature.seam.test.ts`: imports shared encoding via **direct relative source path** (`../../shared/src/shared/invites/encoding.js`) to depend on the `.ts` source, never the built `dist`.

---

## 6. Gaps / risks for testability (browser-global, network, chain reads, IServices)

**R1 — `this.pool` is never assigned (structural bug, biggest risk).**
`render()` and `setSurveyListener()` dereference `this.pool!.config` / `this.pool?.config.pkpId|pkpDid` (lines 79, 124–125, 136). Nothing assigns `this.pool` (constructor sets only `services`+`surveyId`; no setter, no `getPool` call). Therefore, even with the store primed, `render()` will throw `TypeError: Cannot read properties of undefined (reading 'config')` inside the try → always hit `renderWarning`. **The happy path (survey loaded → `renderTemplate` → `setSurveyListener`) is currently unreachable as written.**
- Implication for tests: to exercise the success path, a test must set the public `ctrl.pool = { config: { pkpId, pkpDid, … } }` directly, OR the suite documents current behavior (always-warning). This should be flagged to the user — a 1-line assignment or an actual `getPool` read would unblock the real flow and make the success-path test legitimate.

**R2 — store must be primed.** The `render()` guard `surveyFromStore && surveyFromStore.pool` means tests must call `store.setSurveyData(SURVEY_ID, { id: SURVEY_ID, pool: POOL_ID })` (merges into the real SurveysStore) before `render()`; otherwise it hits the `alert("survey and pool not found")` branch. (In the real flow the router `before` handler primes this.)

**R3 — browser globals at import time** (all must be mocked, mirroring auth tests):
- `@s3ntiment/shared/components` → `vi.mock(..., () => ({}))`.
- `../components/survey-questions.js` → must be mocked (top-level `customElements.define` throws in node; not covered by the setup stub). The auth test never imported it, so this is new for the survey suite.
- `@s3ntiment/shared` → mock with `fetchAndDecryptSurveyWithRespondent` + `isScored`.
- `s3ntiment-contracts …SurveyStore.json` — real import is fine in node (auth precedent).
- `import.meta.env.VITE_*` → undefined in the node test env, so `BACKENDURL` is `undefined` — harmless because `backendUrl` is only forwarded to the (mocked) shared fn and the (stubbed) `fetch` URL. No `import.meta.env` override needed.

**R4 — browser globals at runtime** (must be added beyond `test/setup.ts`):
- `document.addEventListener` — NOT in setup; `setSurveyListener()` calls it. Tests must override `document` to a stub recording the `survey-complete` callback (then invoke and `await` it).
- `crypto.randomUUID` — NOT in setup; used in the submission handler. Stub `globalThis.crypto = { randomUUID: () => 'doc-…' }`.
- global `fetch` — NOT in setup; the delegation POST uses it. Stub `globalThis.fetch = vi.fn(() => Promise.resolve({ json: () => Promise.resolve({...}) }))`.
- `router.navigate` — mock `../router.js`.
- `document.querySelector` returning a fake element (`{innerHTML:'', style:{}}`) so `renderTemplate`/`reactive(...).bind(store.surveys$)` run (real `reactive` works on a plain-node stub, as in the auth controller test).

**R5 — IServices surface needed by this controller** (fake object per `auth.factory.test.ts` style): `account` = `{ createNillDBSeed, signMessage, getSignerAddress }`; `nillDB` = `{ init, userDidString, storeOwned }`. `viem`/`ipfs`/`lit`/`waap`/`oprf` are only reached inside `fetchAndDecryptSurveyWithRespondent`, so with the shared module mocked they need **no** real implementation. `console.error` is called on the catch path (harmless; can `vi.spyOn(console,'error')` if asserting).

**R6 — Importable without a browser?** Yes, with the mocks above. The controller is a plain class; `reactive` on a null element already early-returns (default setup), and the JSON import + `import.meta.env` read don't crash in node. The only hard blockers are `customElements`/`document.addEventListener`/`crypto.randomUUID`/`fetch`, all mockable. This matches the established "no-jsdom, stub the browser surface" strategy.

**R7 — network / chain reads.** No live on-chain read, no real network in the controller itself: `fetchAndDecryptSurveyWithRespondent` (chain+IPFS+Lit+network) and the delegation `fetch` are both stub/mock boundaries. Nothing needs a real chain or backend.

---

## 7. Scope recommendation (what to unit-test vs onboard/out-of-scope)

**In scope — `SurveyController` unit tests** (new file `frontend-respondents/src/controllers/survey-ctrlr.test.ts`, node env, mocks per §5/§6):

1. `render()` — **store-not-primed branch**: no `{pool}` in store → `alert("survey and pool not found")`; no shared fetch.
2. `render()` — **success path** (requires priming store + setting `ctrl.pool` per R1/R2): `fetchAndDecryptSurveyWithRespondent` called with `(services, surveyStore, surveyId, pool.config, backendUrl)`; then `isScored`, `store.setSurveyData`, `store.persistSurveys`, `renderTemplate` (`document.querySelector` element stub + `reactive.bind(store.surveys$)`), and `setSurveyListener` registers the `survey-complete` listener.
3. `render()` — **rejection branch**: mocked `fetchAndDecryptSurveyWithRespondent` rejects → `renderWarning` with the message, no `setSurveyListener`. (This branch is also the one hit by R1 as-written.)
4. `setSurveyListener()` — capture the `survey-complete` callback via stubbed `document.addEventListener`; invoke it and assert the submission order: `createNillDBSeed` → `nillDB.init` → `crypto.randomUUID` → `account.signMessage("s3ntiment:submit")` → `fetch(POST …/api/surveys/{surveyId}/delegation, {method:'POST', body: JSON.stringify(args)})` → `nillDB.storeOwned(docId, survey, pool.config, answers, surveyId, delegation)` → on `result.ok` `router.navigate("complete/{surveyId}/{docId}")`; and a **not-navigate** case when `result.ok` is false.
5. `destroy()` — clears `reactiveViews` (and destroys each view).
6. `process()` — document as an intentional no-op (touches nothing) — cheap, low value, optional.

**Explicitly out of scope / onboarding (per §3 and PR #7 precedent):**
- Router `before` entry gates (root `/` and `/surveys/:surveyId`): `parseCardURL`, `Card`/`isUsed`, `fetchSurvey`, `hasParticipatingAccount`, `authenticate`, `Card.register`.
- The shared card-encoding seam itself — already pinned by `card-signature.seam.test.ts` + `contracts/test/encoding.seam.test.ts`; not invoked by the survey controller.
- Controllers `invalid-card`, `completed`, `about`, `used-card` (still intentionally untested).

**Recommended work-order for the suite:**
1. Add missing runtime stubs (`document.addEventListener` capture, `crypto.randomUUID`, global `fetch`) — either extend `test/setup.ts` or in-file `installBrowserGlobals()` (prefer in-file, matching `auth-ctrlr.test.ts`).
2. Mock `@s3ntiment/shared`, `@s3ntiment/shared/components`, `../components/survey-questions.js`, `../router.js`.
3. Build the fake `IServices` (account/nillDB only).
4. Decide the R1 strategy (set `ctrl.pool` directly to unlock the success path, and flag the underlying bug to the user).

---

## Appendix — key file references

- `frontend-respondents/src/controllers/survey.ctrlr.ts` — the controller under study.
- `frontend-respondents/src/router.ts` — route wiring + entry gates (excluded).
- `frontend-respondents/src/controllers/auth-ctrlr.ts`, `auth.factory.ts` — in-scope auth analog.
- `frontend-respondents/src/auth.factory.test.ts`, `src/controllers/auth-ctrlr.test.ts`, `src/card-signature.seam.test.ts` — patterns to mirror.
- `frontend-respondents/vitest.config.ts`, `test/setup.ts`, `package.json` — harness.
- `frontend-respondents/src/services.ts` — `IServices` + `ServiceContainer` (type surface only).
- `frontend-respondents/src/state/store.ts`, `state/surveys.store.ts` — `store.*` API used by assertions.
- `shared/src/shared/survey/survey.factory.ts` — real `fetchAndDecryptSurveyWithRespondent` / `fetchSurvey` (stub boundary).
- `shared/src/shared/invites/encoding.ts`, `card.factory.ts` — the (already-pinned) card-encoding seam.
- `shared/src/shared/survey/response.factory.ts` — `createUserDataObject` (dead import here; used by `nilldb.user.service.ts`).

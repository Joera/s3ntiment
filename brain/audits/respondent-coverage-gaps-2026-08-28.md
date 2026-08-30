# Respondent Frontend — Test-Coverage Gap Inventory

**Date:** 2026-08-28
**Scope:** `frontend-respondents` package @ `main` (merged PRs #7 auth tests, #10 survey-ctrlr tests, #11 invitation/card tests — verified via `git log`: `bd9da7a48`, `ffed11d8c`, `3faa86ac1`).
**Mode:** read-only exploration; no test/source files created or modified.
**Include glob (from `vitest.config.ts`):** `src/**/*.test.ts` — Node environment (no jsdom), setup `test/setup.ts` (stubs `localStorage`/`window`/`document`/`alert`).

> Note: dependencies are not installed in this checkout, so `vitest run` cannot execute here (`vitest` unresolved). All counts and coverage below are grounded by reading every test file and source file in full. `it()` counts are from direct inspection (verified against each file's `describe`/`it` blocks).

---

## 1. Current test coverage — every test file

**Total: 7 test files, 49 `it()` tests.**

| # | Test file | Tests | One-line description | Module(s) covered |
|---|-----------|-------|----------------------|-------------------|
| 1 | `src/auth.factory.test.ts` | 9 | `authenticate` full login/OPRF/signer flow + `hasParticipatingAccount` pool-membership oracle, using the committed `S3ntimentSurveyStore` deployment JSON; rejection propagation at every step. | `src/auth.factory.ts` (direct) |
| 2 | `src/card-class.seam.test.ts` | 11 | Shared `Card` class `isUsed`/`register`/getters + `parseCardURL` edge cases (malformed URL, bad sig, extra params, URL-encoded nullifier), via relative source path. | `shared/…/invites/card.factory.ts`, `encoding.ts`, `types.ts` (seam — not `frontend/src`) |
| 3 | `src/card-signature.seam.test.ts` | 5 | Shared card-encoding seam: `cardMessageHash` digest scheme, EIP-191 envelope, sign→recover round-trip to batchId, `parseCardURL` smoke + missing-params. | `shared/…/invites/encoding.ts`, `card.factory.ts`, `types.ts` (seam) |
| 4 | `src/card-url.round-trip.test.ts` | 3 | Organiser producer shape → shared `parseCardURL` round-trip (surveyOwner === batchId); multi-card-batch + escaped-nullifier. | `shared/…/invites/encoding.ts`, `card.factory.ts` (seam) |
| 5 | `src/controllers/auth-ctrlr.test.ts` | 5 | `AuthController.render()` full parse→fetch→store→authenticate→register→navigate flow; already-participant skip; reverted/rejected receipt → alert; no card → no-op. | `src/controllers/auth-ctrlr.ts` (direct), `src/state/store.ts` (real) |
| 6 | `src/controllers/survey-ctrlr.test.ts` | 7 | `SurveyController.render()` (un-primed alert; success path incl. R1 pool-config plumbing; decrypt-fail warning), submission pipeline ordering, `storeOwned` ok:false, `destroy()`/`process()`. | `src/controllers/survey.ctrlr.ts` (direct), `store.ts` + `utils/reactive.ts` (real/indirect) |
| 7 | `src/router-entry-gates.test.ts` | 9 | `resolveRootGate` (unparseable→/invalid-card, used→/used-card, fresh→proceed, reject) + `resolveSurveyGate` (no surveyId, pool member, auth success/fail, fetch reject). | `src/router.gates.ts` (direct), `store.ts` (real) |

The three "seam" test files (2, 3, 4) live under `frontend-respondents/src/` but exercise the **shared** package's card-encoding source, mirroring the producer/consumer handshake — they do not cover any `frontend-respondents/src` module themselves.

---

## 2. Covered source modules (`frontend-respondents/src`)

### Directly & dedicatedly covered (a test imports the module and asserts its behaviour)
| Module | Via | Notes |
|--------|-----|-------|
| `src/auth.factory.ts` | auth.factory.test.ts | 9 tests: login path, oracle reads, all rejection branches. |
| `src/controllers/auth-ctrlr.ts` | auth-ctrlr.test.ts | 5 tests: full entry auth flow + failure modes. |
| `src/controllers/survey.ctrlr.ts` | survey-ctrlr.test.ts | 7 tests: render success/fail, submission order, destroy/process. |
| `src/router.gates.ts` | router-entry-gates.test.ts | 9 tests: both gates, all decision branches. |

### Covered only indirectly (imported `real`, exercised as side-effects — no dedicated test)
| Module | Extent exercised |
|--------|------------------|
| `src/state/store.ts` | Full facade exercised: `setSurveyData`, `getSurveyData`, `setActiveSurvey`, `activeSurveyId`, `activeSurvey`, `persistSurveys`, `setUI`, `clear`. |
| `src/state/surveys.store.ts` | `setData`, `setActive`, `getData`, `persist`, `clear` (via store in ctrlr/gate tests). |
| `src/state/ui.store.ts` | `set`/`reset` via `store.setUI`/`store.clear`. |
| `src/state/user.store.ts` | Constructed; `clear()` (→ `clearUserFromStorage`) on `store.clear()`. `persist()` never called. |
| `src/state/pool.store.ts` | Constructed (reads `loadPoolsFromStorage`); `get()` ever invoked. `add/remove/set` never run. |
| `src/state/observable.ts` | `get/set/update/subscribe` via every store operation. `notify` exercised. |
| `src/state/storage.ts` | Partial: `load/save/clearSurveysFromStorage`, `loadPoolsFromStorage`, `clearUserFromStorage`. `slugify` and `saveUserToStorage` unused. |
| `src/utils/reactive.ts` | `reactive()` factory + `bind`/`render`/`destroy` exercised through `SurveyController` (querySelector stubbed to a fake element). |
| `src/services.ts` | **Type-only** (`import type { IServices }`); the `ServiceContainer` class is never constructed in tests. |

---

## 3. UNCOVERED source modules (no test touches them)

Every `frontend-respondents/src/**/*.ts` not covered above, with what it is / why it matters / testability.

| Module | What it is | Why it matters | Rough testability |
|--------|-----------|----------------|-------------------|
| **`src/components/survey-questions.ts`** (537 lines) | The core survey form custom element (`survey-questions`): flatten groups, step navigation, required validation, scoring, `isSubmitting` guard, dispatches `survey-complete`. **Mocked** (`vi.mock`) in survey-ctrlr.test, never real. | **Highest user-facing surface in the app.** All survey rendering/answering logic is untested. This is the biggest genuine gap. | **Moderate-high.** It's a shadow-DOM custom element using `adoptedStyleSheets`; current node env has no DOM. Needs a custom-element + shadow-root harness (happy-dom/jsdom) or a hand-rolled `HTMLElement` shim — the config currently deliberately avoids jsdom. |
| `src/components/security-questions.ts` (302 lines) | `security-questions-form` custom element — onboarding security-question sign-up form. **Not referenced/imported anywhere in `src`** (dormant/legacy). | Low urgency: it is unwired onboarding-legacy, not reachable via any route in current code. (See §4 — treat as out-of-scope onboarding unless the flow returns.) | Low-moderate (same DOM/custom-element caveat as above). |
| `src/controllers/used-card-ctrlr.ts` (74 lines) | Used-card entry screen controller: "Sign in" button → `authenticate()` → `router.navigate('/surveys/:id')` **or** `alert("You did not register…")`. | **Real branching user-facing logic and NOT in the explicit exclusion list** (it is an entry-screen, see §4). Only 74 lines, easy to cover. | **Easy.** Mock `authenticate`, `router`, `reactive`, `document.getElementById`; assert navigate vs alert branch. |
| `src/services.ts` | `ServiceContainer` singleton + `getServices()`; `initialize()` constructs viem/waap/account/lit/ipfs/nillDB/oprf + `createWallet`/`oprf.init()`. | DI wiring / bootstrap contract. Not user-facing logic, but `initialize()`/`isInitialized()`/double-init guard are untested. | Low-moderate (needs heavy mocking of shared service constructors + `import.meta.env`). |
| `src/router.ts` | `initRouter`: registers all 5 routes, hooks the gated `before` handlers, calls `parseCardURL`, `currentController` lifecycle. **Mocked** in ctrlr tests. | Pure wiring. The gate decision logic it wires is already tested separately, so lower value. | Low (Navigo r3 + `window.location`; DOM-ish harness needed). |
| `src/main.ts` | Entry bootstrap: font/token/global-style injection, `clearLitStorage`, `getServices().initialize()`, readiness gate, `DOMContentLoaded` wiring. | Pure wiring/bootstrap. | Low (global + DOM + import.meta.env). |
| `src/onpageload.ts` | `removeSplash()` — splash/header/footer visibility. **Mocked** in auth-ctrlr.test. | Trivial DOM side-effect, low value. | Low. |
| `src/ux.factory.ts` | `ERROR_MESSAGES` map (invalid/used/network/unknown UX copy + severity). | User-facing copy, pure constant. Cheap to pin but low risk. | Trivial (pure constant snapshot). |
| `src/utils.factory.ts` | `decimalToHex` — **no callers anywhere in `src` (dead code).** | Zero production paths → likely remove. | Trivial (pure function) but arguably not worth testing dead code. |
| `src/state/*` (dedicated unit tests) | `pool.store.ts`, `user.store.ts`, `surveys.store.ts`, `ui.store.ts`, `observable.ts`, `storage.ts` — only indirect side-effect coverage described in §2. Behavior like `PoolStore.add/remove/set`, `UserStore.set/persist`, `storage.slugify`, `SurveysStore.clear(surveyId)` is never asserted. | State is the correctness backbone under the controllers; several branches (esp. `slugify`, pooled writes) are unverified. | **Easy** — pure logic, fits the node env already used. |
| `src/state/store.types.ts`, `src/empty-module.ts`, `src/vite-env.d.ts` | Types / React alias stubs / ambient types. | No runtime behaviour; not testable by nature. | N/A (types-only / aliases). |

*Excluded from "uncovered" as explicitly out of scope:* `invalid-card-ctrlr.ts`, `completed-ctrlr.ts`, `about.ctrlr.ts` (see §4).

---

## 4. Deliberately excluded / out of scope

The user's no-onboarding constraint excludes the **entry-screen controllers** and their markup. Listed so these are separable from genuine gaps:

| Item | Status | Note |
|------|--------|------|
| `src/controllers/invalid-card-ctrlr.ts` | Excluded | Entry screen; `renderTemplate` + `.onboarding-message` only. |
| `src/controllers/completed-ctrlr.ts` | Excluded | Entry/exit screen. **Has real logic** (isScored branch, `POST /score`, score render) — excluded but worth remembering if scope ever relaxes. |
| `src/controllers/about.ctrlr.ts` | Excluded | Static SVG/landing markup; no logic. |
| `.onboarding-message` markup | Excluded | Inline HTML string duplicated across invalid/completed/used-card/about controller templates (no separate file). |
| `src/components/security-questions.ts` | **Not in the user's explicit list** — I flag it as out-of-scope *by judgment*: it is an onboarding sign-up form and is currently **not wired into any route/import** (dormant). Confirm with user if it should return to scope. |
| `src/controllers/used-card-ctrlr.ts` | **Borderline / NOT excluded.** It is an entry-screen, but the user's list names only three controllers + markup. It contains a genuine, tiny branching behaviour (auth → navigate vs alert). I treat it as a **genuine remaining gap** (low effort), but call it out so it can be moved to the excluded set if you intended all entry screens out. |

---

## 5. Known deferred / flagged to-do

- **CONFIRMED — R1 first-render `poolConfig` chicken-and-egg (SPEC Gaps, 2026-08-28, PR #10).** `SurveyController.render()` needs `poolConfig.pkpId` to call `fetchAndDecryptSurveyWithRespondent`, but the config only exists *after* decrypt (lives on the decrypted `EncryptedConfig.config`). PR #10 fixed `this.pool` never-assigned, but a **fresh controller's first `render()`** still forwards `undefined` poolConfig → deref throw → lands in `renderWarning`. **Resolution TBD**, not blocking.
  - Corollary gap flagged in the same note: **`PoolStore` is never populated** — no `setPool`/`add` callers anywhere in `frontend-respondents`, so `store.getPool(...)` always returns `undefined`, and the controller never reads it. `pool.store.ts` `add/set/get` are therefore also dead in practice (ties into §3 state gap).
- SPEC Gaps also flags: possible duplication of `lit-actions/decrypt-signature.js` vs `shared/lit/actions/decrypt-for-respondent.ts`; OPRF internals + card-scan UI remain ⚠ UNVERIFIED (GAP-8, SPEC-00).
- No other explicit to-do markers in the SPEC; the only code-level TBD is the poolConfig reconciliation above.

---

## 6. Recommendation — ranked next tranches (honouring no-onboarding)

Ranked by user-facing value first, then effort. No excluded/onboarding modules included.

1. **`survey-questions.ts` custom element (HIGH value).** The entire survey rendering/answering/validation/submission surface is currently `vi.mock`ed. Effort: **moderate–high** — the main cost is a custom-element + Shadow DOM harness (happy-dom/jsdom, or a minimal `HTMLElement` shim), because the current config deliberately runs Node-only. If harness work is undesirable, at minimum extract + unit-test the pure helpers (`flattenQuestions`, required-validation, scoring) in node and leave the DOM shell.

2. **`SurveyController` cold-start regression test for the R1 pool-config chicken-and-egg (MED-HIGH value, MED effort).** Add a case asserting true first-`render()` behaviour *without* pre-seeding `poolConfig` (the current survey-ctrlr.test manually seeds it, so it does not guard the bug). This directly pins the known deferred defect and its resolution.

3. **`used-card-ctrlr.ts` (MED value, LOW effort).** ~5 tests covering the navigate-vs-alert branch. Easy with existing mock pattern (`authenticate`, `router`, `document.getElementById`). Flag if it should instead be moved to the excluded entry-screen set.

4. **State unit-test tranche (MED value, LOW effort).** Dedicated tests for `pool.store` (`add/remove/get/set`), `user.store` (`set/persist`), `surveys.store` (`update`, `clear(surveyId)`), `observable` (unsubscribe), `storage` (`slugify`, round-trips). Pure node, fits the existing runner. Also covers the `PoolStore`-never-populated gap at the unit level; reinforcing the SPEC note that `getPool` needs a populate path in production.

5. **`services.ts` `ServiceContainer` (MED-LOW value, MED effort).** Pin `initialize()` ordering + double-init guard + `isInitialized()`. Heavier mocking; worthwhile as bootstrap insurance but lower priority than the above.

6. **Trivial constants / wiring (LOW).** `ux.factory.ts` `ERROR_MESSAGES` snapshot; `utils.factory.ts` `decimalToHex` — likely **dead code → delete** rather than test; `router.ts`/`main.ts`/`onpageload.ts` are pure wiring with the decision logic already covered — skip unless wiring insurance is wanted.

**Top-line:** after PRs #7/#10/#11 the *entry/decision* logic (auth flow, survey controller pipeline, router gates) is well covered (49 tests), but the **survey-questions web component — the single largest user-facing surface — remains entirely untested**, and the **state stores have only indirect coverage**. Those two, plus a cold-start regression for the confirmed poolConfig gap, are the highest-value next moves within the no-onboarding constraint.

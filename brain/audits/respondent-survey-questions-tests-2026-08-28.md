# Respondent Survey-Questions Component — Test Tranche

**Date:** 2026-08-28
**Scope:** real-component test coverage for `frontend-respondents/src/components/survey-questions.ts` (the `survey-questions` custom element) — the largest user-facing surface in the app, previously `vi.mock`ed in `survey-ctrlr.test.ts` and never exercised for real.
**Branch / commit (worktree):** `deepseek/respondent-survey-questions-tests` off `main` `f23d0dfd3` (see PR body for the PR + exact sha).
**In-repo report ref:** this file complements the exploration report `brain/audits/respondent-coverage-gaps-2026-08-28.md` (its #1 HIGH-value gap).

---

## 1. Environment decision — real component in happy-dom (not pure-function fallback)

The component is a Shadow-DOM custom element that calls `customElements.define('survey-questions', …)` at module top-level and sets `this.shadowRoot.adoptedStyleSheets = [typograhyStyles, buttonStyles]` in its constructor (the shared assets themselves do `new CSSStyleSheet()` at import time). The package's existing vitest config deliberately runs **node-only** and its `test/setup.ts` stubs `document`/`window`.

I chose the **full real-component harness** over pure-function extraction:

- Added **`happy-dom`** (`^20.11.12`) as a `frontend-respondents` devDependency and activated it **per-file** with a `// @vitest-environment happy-dom` docblock comment on the new test file. The existing node-env config/project is untouched, so the 49 prior tests keep running in the same node environment.
- Verified happy-dom genuinely supports `CSSStyleSheet` + `adoptedStyleSheets` + `ShadowRoot` + `customElements` + `:checked`/`querySelector` — it does, so the **real component** runs unmodified.
- Made `test/setup.ts` install its node stubs **conditionally** (`if (!globalThis.X)`). In node the globals are absent so the stubs are installed exactly as before (node suite behaviour unchanged, 49 stay green); in happy-dom the real globals are already present so they are left intact. This is the only non-test production-adjacent file touched.

**Feasibility of the fallback was not required** — the report asked for a short justification only if I fell back to pure functions; I did not, so none is due beyond this note.

## 2. What the tranche covers (real logic, no whole-module mock)

`frontend-respondents/src/components/survey-questions.test.ts` — **23 `it()` tests**, all driving the actual mounted element via `document.createElement('survey-questions')` + `appendChild` (triggers `connectedCallback`, which reads the store, flattens groups, renders into the shadow DOM, and attaches listeners). The store is primed with `store.setSurveyData(...)`, exactly as the production `SurveyController` does before mounting. No `vi.mock` of the module; the shared-asset imports and the real store load for real.

Coverage mapped to the required scope:

| Required area | Tests | What is asserted |
|---|---|---|
| **Group flattening** | 3 | `flattenQuestions` output order across 2 groups; per-question `groupTitle`/`groupIndex` annotation; empty-`groups` → loading screen + `totalSteps === 0`. |
| **Step navigation** | 4 | First-question render + `Question X of N` progress; Next advances + re-renders; Back decrements + is `disabled` on step 0; Back at the lower bound is a no-op; last-step button reads "Submit". |
| **Required-field validation** | 4 | Unanswered required question blocks advance + shows `This question is required` + records nothing; answered required passes + clears the error; non-required fields accept empty answers; required checkbox with zero selections rejects (reaches `isAnswerValid([])`), non-required checkbox with zero selections **passes** (validation is required-only — pinned as real behaviour). |
| **Scoring-relevant answer collection** | 4 | `scored-single`/radio answer collected as string with typed `SurveyAnswer`; scale collected as a **number** + `scaleRange` enrichment; text trimmed; checkbox collected as a **string array**. |
| **Answer-state mutation** | 2 | Upsert on revisit (existing answer replaced, no dupes); saved answers re-render `checked` on return. |
| **Submit guard + `survey-complete` event** | 4 | Composed + bubbling `CustomEvent` with `{answers, timestamp, documentId}`; `currentStep` advanced past end + completion screen; **`isSubmitting` lock** — a second `handleNext()` after complete is a no-op (no second event, no throw); `getAnswers()` returns the collected list; aborting mid-way emits nothing. |
| **Registration** | 1 | `customElements.get('survey-questions') === SurveyQuestions`. |

## 3. Gate results

- **Full `frontend-respondents` vitest suite:** `8` test files, **`72` tests passed** (was `7` files / `49` tests; **+1 file, +23 tests**).
  - Per-file: `auth.factory` 9, `card-class.seam` 11, `card-signature.seam` 5, `card-url.round-trip` 3, `auth-ctrlr` 5, `survey-ctrlr` 7, `router-entry-gates` 9, **`survey-questions` 23 (new)**
- **`vite build` (frontend-respondents):** ✓ green.
- Non-vacuous, real-behaviour assertions; no whole-module mock; no trivial mocks.
- **No network / live-chain / extra browser globals** beyond the happy-dom env added for this file.
- All **49 existing tests stay green** alongside the new 23.

## 4. Notes for the reviewer / human

- **Prod code untouched.** `survey-questions.ts` is not modified. The only non-test change is `test/setup.ts` (conditional stubs — behaviour-preserving for node) plus the `happy-dom` devDependency and lockfile.
- **One observed behaviour worth flagging (NOT fixed — out of scope):** required-validation is gated on `currentQuestion.required` *only*; a **non-required** checkbox with zero selections advances (its empty array is never rejected because the `isAnswerValid` call is inside the `required && …` branch). For a non-required multi-select this is arguably fine; flagged as observed-but-unchanged. The required-checkbox rejection path is covered.
- **Lockfile churn:** adding `happy-dom` forces a `pnpm` re-resolution of the workspace lockfile. This drifts the peer-hash *label* for a handful of unrelated `@lit-protocol/…` snapshots from `typescript@5.8.3` → `typescript@5.9.3` (same package versions, same installed artifacts — a stale-peer-normalization, not a dependency change). I chose to keep this than risk hand-corrupting a 9.0-format lockfile. Flagged explicitly; revert/regenerate if undesired.
- No known defect in `survey-questions.ts` was found beyond the behavioural note above; nothing was "fixed silently".

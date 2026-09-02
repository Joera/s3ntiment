# Organiser FE — gate output validators on `res.ok` (fix the misleading zod error on backend 4xx/5xx)

Date: 2026-09-02
Base: `main` @ `436d3f676` (includes PRs #41/#42/#43 — canonical zod module in
`shared/src/shared/nillcc`, hand-rolled `nillcc-validation` retired)
Goal: fix the audit finding — the 4 wired output validators in the organiser FE
run **unconditionally**, so a real backend 4xx/5xx throws a misleading zod
`'X output validation failed'` error over the error body instead of surfacing
the real backend error. Add regression tests, drive gates green, open a PR
(no merge).

## The 4 sites + how each was fixed

| # | Site | Bug (audit evidence) | Fix |
|---|---|---|---|
| 1 | `frontend-organiser/src/controllers/new.ctrlr.ts.ts` — pool create (L99-105) | `if (!ok) store.setUI({...})` then **falls through** to `validatePoolCreateOutput` on the error body | On `!ok`: `store.setUI({ newStep: 'error' })` **+ `return`**. Output validator now only runs when `res.ok === true`. |
| 2 | `new.ctrlr.ts.ts` — builder register (L139-142) | logs-only, validates output **unconditionally** | On `!ok`: `console.log("builder registration failed")` **+ `return`**. `validateRegisterBuilderOutput` only on `ok`. |
| 3 | `new.ctrlr.ts.ts` — survey create (L203-208) | same fall-through as #1 | On `!ok`: `store.setUI({ newStep: 'error' })` **+ `return`**. `validateSurveyCreateOutput` only on `ok`. |
| 4 | `frontend-organiser/src/controllers/survey.ctrlr.ts` — survey update (L359-367) | **NO `res.ok` check at all** — `JSON.parse(await res.text())` then `validateSurveyUpdateOutput` runs on whatever came back | Added the missing `res.ok` guard: on `!ok`, log the real backend error (`console.error('survey update failed (backend):', await res.text())`) **+ `return`** before any parse/validate. `validateSurveyUpdateOutput` only on `ok`. |

Semantics on the success path are unchanged at all 4 sites — output validation
is kept for `res.ok === true` (that is its purpose); it is only gated on `res.ok`.
The error-handling UX per site is the pre-existing intended path (error UI /
log-and-stop); no new UX was added, just the short-circuit that was missing.

## Regression tests

- `new.ctrlr.test.ts` — extended `installBrowserGlobals` with a `failing: string[]`
  param so any endpoint returns `ok: false` with a deliberately non-schema-shaped
  error body (`{ error: '...' }` — the shape that would make an output validator
  throw if it wrongly ran). New `describe('... output validation gated on res.ok')`:
  1. **pool create**: non-ok `/api/pools` → `store.ui.newStep === 'error'`, resolves
     (no misleading zod error), and **nothing after pool create runs** (no
     `/api/builder/register`, no `/api/surveys`, no `router.navigate`).
  2. **builder register**: non-ok `/api/builder/register` → logs
     `"builder registration failed"`, resolves, no `/api/surveys`, no navigate.
  3. **survey create**: non-ok `/api/surveys` → `store.ui.newStep === 'error'`,
     resolves, no navigate.
- `survey.ctrlr.test.ts` (**new file**): follows the `new.ctrlr.test.ts` pattern
  (real zod `@s3ntiment/shared/nillcc` validators kept, heavy/browser modules
  mocked, real store seeded with the existing survey + pool, `document` shim
  captures the `survey-save` listener):
  - **regression**: non-ok `PUT /api/surveys/:id` → surfaces the backend error via
    `console.error`, resolves **without** throwing a misleading `Survey update
    output validation failed` zod error, no `safe.write` tx, no survey-config
    commit.
  - **happy path**: ok response is still output-validated and committed (tx written,
    survey config stored) — proves success-path semantics preserved.
- **Test has teeth (verified)**: temporarily reverted the pool-create `return` to
  simulate the old behavior → the new pool-create regression test **fails** with the
  exact misleading `Error: Pool create output validation failed: pkpId: Required /
  pkpDid: Required / groupId: Required` zod error. Restored the fix; suite green again.

No existing test asserted the old misleading-throw behavior, so none needed updating.

## Gate results (exact counts)

| Gate | Result |
|---|---|
| `pnpm --filter @s3ntiment/shared build` | ✅ exit 0 (`tsc`) — needed first (FE tests import `@s3ntiment/shared/nillcc` → resolves to `dist`) |
| `pnpm --filter @s3ntiment/frontend-organiser test` | ✅ **8 files / 53 tests passed** (was 7 files / 48; +3 regression in `new.ctrlr.test.ts`, +2 in new `survey.ctrlr.test.ts`) |
| `pnpm --filter @s3ntiment/frontend-organiser build` | ✅ exit 0 (`vite build`) |
| `pnpm install --frozen-lockfile` | ✅ exit 0 |
| `pnpm --filter @s3ntiment/nillcc-backend test` (sanity — backend untouched) | ✅ **6 files / 69 tests passed** |

## Branch / PR

- Branch: `deepseek/fix-output-validation-resok`
- PR: https://github.com/Joera/s3ntiment/pull/44 (OPEN, not merged)
- Commit: `22b3b8ee8fbdf88829ab1a30700f23f0c500d326`
- Base: `main`

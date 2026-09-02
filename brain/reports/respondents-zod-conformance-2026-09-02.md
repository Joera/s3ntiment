# Respondents FE — consolidate onto canonical zod nillcc schemas & retire hand-rolled `nillcc-validation`

Date: 2026-09-02
Base: `main` @ `6e8db6264` (PRs #41 + #42 merged)
Goal: migrate the last `nillcc-validation` importers onto the canonical zod module
(`shared/src/shared/nillcc/inputs.ts`, exported via `@s3ntiment/shared` barrel and
`@s3ntiment/shared/nillcc`), delete the hand-rolled module, drive all gates green, open a PR.

## What was migrated

| Importer | Old call | New call | Behavior intent |
|---|---|---|---|
| `frontend-respondents/src/controllers/account-ctrlr.ts` (L24, 348) | `validateDelegation(args)` → null/failure, log + `return ''` | `validateDelegationInput(args)` in try/catch → log + `return ''` | log-and-continue preserved |
| `frontend-respondents/src/controllers/survey.ctrlr.ts` (L7, 150) | `validateDelegation(args)` → log + `return` | `validateDelegationInput(args)` in try/catch → log + `return` | log-and-abort preserved |
| `frontend-respondents/src/controllers/completed-ctrlr.ts` (L3, 87) | `validateScore(scoreBody)` → log + `store.setUI({})` + `return` | `validateScoreInput(scoreBody)` in try/catch → log + `store.setUI({})` + `return` | log-and-abort preserved |
| `shared/src/shared/lit/keys.ts` (L1, 13) | `throwOnFailure(validateUsageKey({...}))` | `validateUsageKeyInput({...})` (throws) | hard-fail preserved |
| `shared/src/shared/lit/keys.test.ts` (L3) | `rejects.toBeInstanceOf(NillccValidationError)` | `rejects.toThrow(/userAddr/)`, drop `NillccValidationError` import | assertion updated to zod plain-Error message |

### Respondents test seams (extra, discovered during migration)
The respondents controller tests mock `@s3ntiment/shared` and stubbed the old
hand-rolled fns. They were updated to the zod symbols so the mocked module still
exposes what each controller calls at runtime:
- `account-ctrlr.test.ts` — mock `validateDelegation: vi.fn(() => null)` → `validateDelegationInput: vi.fn((input) => input)` (payload in these tests is valid → pass).
- `completed-ctrlr.test.ts` — mock `validateScore: vi.fn(() => null)` → `validateScoreInput: vi.fn((input) => input)`.
- `survey-ctrlr.test.ts` — mock `validateDelegation: vi.fn(() => null)` → `validateDelegationInput: vi.fn((input) => input)`; the fail-fast test now uses `vi.mocked(validateDelegationInput).mockImplementationOnce(() => { throw new Error('Delegation input validation failed:\npoolConfig: poolConfig is required') })` (was `mockReturnValueOnce({...})`).

## Per-call-site semantic notes (deltas)

- **account-ctrlr.ts (`fetchDelegationForS`)**: old = `validateDelegation` returns a
  `ValidationFailure|null`; on failure logged `{error, message}` and returned `''`
  (empty delegation, continues migration). New = `validateDelegationInput` throws an
  `Error`; caught, logged, returns `''`. **Behavior intent identical** (log + continue
  with empty delegation). Delta: the log now prints the zod `Error` (field-named
  `path: message` lines) instead of the `{error,message}` object; the SCREAMING_SNAKE
  `error` code is no longer logged (display-only). Tag renamed `[nillcc-validation]` → `[nillcc]`
  since the hand-rolled module no longer exists.
- **survey.ctrlr.ts (`setSurveyListener` submit)**: old = log + `return` (abort the
  submission). New = catch + log + `return`. **Identical** (log-and-abort). Same log-text
  delta as above.
- **completed-ctrlr.ts (`render` score path)**: old = log + `store.setUI({})` + `return`
  (abort score display). New = catch + log + `store.setUI({})` + `return`. **Identical**.
- **lit/keys.ts**: old `throwOnFailure(validateUsageKey(...))` threw `NillccValidationError`
  (subclass of `Error`). New `validateUsageKeyInput(...)` throws a plain `Error`.
  **Hard-fail preserved**; only the thrown error type changed (plain `Error` vs subclass),
  and the message is now `Usage key input validation failed:\nuserAddr: ...`. Test updated
  to assert `/userAddr/`.
- **lit/keys.test.ts**: dropped `NillccValidationError` import; assertion now `toThrow(/userAddr/)`.

## Retired module

- Deleted `shared/src/shared/nillcc-validation.ts` and `shared/src/shared/nillcc-validation.test.ts`
  (357 + 369 lines).
- Removed `export * from './nillcc-validation.js'` from `shared/src/shared/index.ts` (L10).
  Kept `export * from './nillcc/index.js'`.
- Repo-wide `git grep` confirms **no code imports `nillcc-validation`** anywhere outside
  `brain/reports/*.md` (historical records of PR #41, not imports).

## Gate results (exact counts)

| Gate | Result |
|---|---|
| `pnpm --filter @s3ntiment/shared build` | ✅ exit 0 (`tsc`) |
| `pnpm --filter @s3ntiment/shared test` | ✅ **14 files / 185 tests passed** (incl. `lit/keys.test.ts` 2) |
| `pnpm --filter frontend-respondents test` | ✅ **13 files / 128 tests passed** |
| `pnpm --filter frontend-respondents build` | ✅ exit 0 (`vite build`) |
| `pnpm --filter @s3ntiment/frontend-organiser test` | ✅ **7 files / 48 tests passed** (sanity, imports zod module) |
| `pnpm --filter @s3ntiment/frontend-organiser build` | ✅ exit 0 |
| `pnpm --filter @s3ntiment/nillcc-backend test` | ✅ **6 files / 69 tests passed**; conformance pin `src/conformance.test.ts` **8 passed** |
| `pnpm --filter @s3ntiment/nillcc-backend build` | ✅ exit 0 (`tsc`) |
| `pnpm install --frozen-lockfile` | ✅ exit 0 |

## Drift found

- **Package-name drift in the task brief**: the brief listed the respondents gate as
  `--filter @s3ntiment/frontend-respondents`, but `frontend-respondents/package.json`
  names the package **`frontend-respondents`** (unscoped). Ran the gate with
  `--filter frontend-respondents`. (Organiser is `@s3ntiment/frontend-organiser`, backend
  `@s3ntiment/nillcc-backend` — those matched.)
- **Extra seams not in the brief**: the three respondents controller **tests** mocked the
  hand-rolled validators; they were not listed as importers but would have broken the FE
  test gate. Updated as part of this work (see above).
- No semantic drift between the zod schemas and the retired hand-rolled validators for the
  migrated routes (delegation, score, usage-key): the conformance pin already guaranteed
  zod↔backend equivalence, and the migrated call sites produce the same pass/fail outcomes.

## Branch / PR

- Branch: `deepseek/respondents-zod-conformance`
- PR: see PR URL in the PR description.

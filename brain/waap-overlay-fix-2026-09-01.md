# Fix — WaaP full-viewport overlay swallows clicks on `#next-btn` (organiser)

**Date:** 2026-09-01
**Branch:** `deepseek/waap-overlay-fix` (worktree `~/code/worktrees/s3ntiment-waap-overlay-fix`, off `origin/main`)
**Audit:** `brain/audits/waap-iframe-overlay-2026-09-01.md`

## Root cause
`@human.tech/waap-sdk@2.3.0` (not app code) injects a fixed 100%×100% overlay
(`#waap-wallet-iframe-container`, z-index 9999999999, `pointer-events:auto`) into
`document.body` during `WaapService.login()`. Nothing in the repo hides/detaches it after
auth, so it keeps swallowing every pointer event — the survey builder's `#next-btn` never
receives clicks, with no validation error.

## Fix (per audit §4)
- `shared/src/browser/evm/waap.service.ts` — new `WaapService.hideModal()`: targets
  `#waap-wallet-iframe-container` and sets `display:none`, `pointerEvents:none`,
  `visibility:hidden`, `zIndex:-1`; defensive no-op if the element is absent.
- `frontend-organiser/src/factories/auth.factory.ts` — `authenticate()` now calls
  `services.waap.hideModal?.()` at the end (after `safe.updateSignerWithKey`), i.e. after the
  login step that legitimately needs the iframe and before the router shows `/surveys`.

## Regression tests (honest seams — no jsdom/happy-dom, no component repro)
- `shared/src/browser/evm/waap.service.test.ts` — fakes `document.getElementById` and asserts
  `hideModal()` sets all four styles on the found container, and is a no-op when absent.
- `frontend-organiser/src/factories/auth.factory.test.ts` — asserts `authenticate()` calls
  `waap.hideModal()` exactly once, after `updateSignerWithKey`, and stays defensive when
  `hideModal` is absent.

## Gates
- `pnpm --filter @s3ntiment/shared test` → 10 files / **88 passed**
- `pnpm --filter frontend-organiser test` → 5 files / **30 passed**
- `pnpm --filter @s3ntiment/shared build` → **pass** (`tsc`)
- `pnpm --filter frontend-organiser build` → **pass** (`vite build`; only pre-existing chunk-size warnings)

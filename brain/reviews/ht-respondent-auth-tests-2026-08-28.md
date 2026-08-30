# Review — PR #7 ht-respondent AUTH tests (tranche 1)

**Date:** 2026-08-28
**Reviewer:** fresh independent builder session (only diff + contract); not the implementer.
**Branch/PR:** `deepseek/ht-respondent-auth-tests` → https://github.com/Joera/s3ntiment/pull/7
**Scope:** ht-respondent frontend AUTH tests, onboarding excluded, starting with authController.

## Verdict: APPROVE (no blockers)

Diff cross-checked against real source: `src/auth.factory.ts`, `src/controllers/auth-ctrlr.ts`,
`src/state/store.ts`, `src/utils/reactive.ts`, `shared/.../invites/encoding.ts`,
`shared/.../invites/card.factory.ts`, and the `contracts` deployment export map.

## Contract compliance
- Runner: vitest ^4.1.11 devDep, `"test": "vitest run"`, `environment:'node'` (no jsdom),
  `test/setup.ts` stubs localStorage/window/document/alert.
- auth.factory unit tests: hand-built fake IServices (no ServiceContainer, no window.waap, no network);
  mocks all six required methods; happy path, `'0x'` signer → false, `isPoolMember` read via
  `viem.read([poolId, signerAddress])`, and non-vacuous rejection propagation (short-circuit asserted).
- auth-ctrlr controller tests: all five required cases (full flow, already-participant shortcut,
  receipt-not-success → alert/no-nav, register rejects → alert/no-nav, no-card → nothing); router + Card
  mocked; deployment JSON resolved via workspace exports `./deployments/*`.
- Frontend seam: shared card-encoding imported by direct relative source path (not unbuilt dist);
  pins encodePacked hash, EIP-191 wrap, and sign→recover owner round-trip via real parseCardURL.
- Onboarding excluded: no tests for invalid-card/completed/about controllers or `.onboarding-message` markup.

## Orchestrator-verified gates (at HEAD 744abe864)
- `pnpm --filter frontend-respondents test` → 19/19 (auth.factory 9, auth-ctrlr 5, card-signature.seam 5)
- `pnpm --filter frontend-respondents build` (vite) → green (38.91s)

## Notes
- Reviewer's non-blocking observations are relayed in the orchestrator summary. None block merge.

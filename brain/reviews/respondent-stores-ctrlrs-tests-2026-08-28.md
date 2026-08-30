# Review — PR #12: frontend-respondents stores + used-card-ctrlr + cold-start regression

**Verdict:** ✅ APPROVE (no blockers)
**Reviewer:** fresh independent builder session (diff + contract only, not the implementer's worktree)
**Branch/commit:** deepseek/respondent-stores-ctrlrs-tests @ 6a38eda9c
**Test count (orchestrator-verified):** 84/84 vitest across 9 files; `frontend-respondents` build green (42.38s)

## Scope delivered (test-only, no production source touched)
- `src/state/stores.test.ts` (29) — Observable subscribe/notify/unsubscribe; `storage.slugify` (6 exact cases); PoolStore add/remove/set/get (dedupe-by-id, storage persistence, unknown-id no-op); UserStore set/persist/clear (empty-update no-op); SurveysStore.clear(surveyId) per-id vs full.
- `src/controllers/used-card-ctrlr.test.ts` (5) — "Sign in": authenticate true → navigate; false → alert("You did not register…") + no nav; reject → propagates (honest — ctrlr has no try/catch); template wiring; destroy().
- `src/controllers/survey-ctrlr.test.ts` (+1) — R1 cold-start regression: fresh controller with un-seeded poolConfig lands in renderWarning, no navigate/renderTemplate. Not fixed (deferred to live-env per SPEC Gaps).

## Per-item (all PASS, grounded in real source)
1. State stores — PASS (every branch traced to real implementation, non-vacuous)
2. used-card-ctrlr — PASS (honest rejection-propagation match)
3. Cold-start regression — PASS (pins the known deferred gap without fixing)

## Nits (non-blocking)
- None material. Reviewer: test-count math consistent, constraints honored.

**Status:** ready to merge (orchestrator does not merge).

# Review — PR #18 `deepseek/contracts-micro-tests`

**Reviewer:** independent fresh builder session · **Verdict: APPROVED** (no blockers)
**Review method:** neutral diff only (`brain/reviews/contracts-micro-tests.diff`, test file +240 / report +109; test-only). Verified against real source at `contracts/src/S3ntimentSurveyStore/S3ntimentSurveyStore.sol` and `MockSMC.sol`. Reviewer never read the implementer's worktree.

## Contract items
1. **Test-only (no production/lockfile change) — PASS.** Bundle = test file + audit report only; `contracts/src/**` untouched; no `pnpm-lock.yaml`.
2. **InvalidBatchId via createSurvey bootstrap — PASS (source-verified).** `_registerBatch` (L372) reverts `InvalidBatchId()` on `batchId == address(0)`; `createSurvey` runs `_createPool` then the batch loop then `_recordSurvey`, so the whole tx rolls back. Test asserts zero-only and mixed arrays revert, **and** `poolExists`/`surveyExists` both `false` after revert (rollback semantics confirmed).
3. **Multi-pool `getSafePools`/`getPoolBatches` ordering — PASS (source-verified).** `_createPool` (L365) pushes in creation order → `['p-a-1','p-a-2']`; `_registerBatch` (L380) push order `[b1,b2,b3]`/`[b4]` with per-safe isolation. `.toLowerCase()` mapping appropriate.
4. **`_recoverSigner` low-v edge — PASS (source-verified).** Confirmed the audit's premise was refuted: `v=26 → 53` fails `require(v==27||v==28)`, so `v=26` reverts; real low-v edges (`v=0→27`, `v=1→28`) correctly covered, `v=26` reality pinned.

## Orchestrator gate re-verification (at `1d72401ae`)
- hardhat test **41/41** (was 36), `check:abi` **green**
- test-only; lockfile clean (local reinstall artifact repaired & restored)

**Status: ready to merge (human merges). Note that `revoke-member-2026-08-29.md` / a separate review or spec may track an unrelated new item — not part of this PR.**

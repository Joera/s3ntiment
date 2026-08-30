# Review — PR #20 revoke-batch (audit #4/#8)

Date: 2026-08-29
Branch: `deepseek/revoke-batch` vs `origin/main` @ `a197684bc`
Code commit: `d19f9cd0d` (docs commit `9f0ba864c`)
PR: https://github.com/Joera/s3ntiment/pull/20

## Verdict

**PASS — no blocking issues.** Independent reviewer (fresh `builder` session, report-only,
judged the diff at `/tmp/revokebatch.diff` + the acceptance contract; cross-checked contract
hunks against the working-tree source, no edits made).

## Checklist (all PASS)

1. **Batch struct gains `revoked` + `maxCards` end-appended only** — `createdAt`, `cardCount`
   unchanged and first; `bool revoked; uint256 maxCards;` appended at the end. `getBatch`
   signature unchanged (no ABI field exposure).
2. **`revokeBatch(poolId, batchId)` additive + Safe-gated exclusively via `_requirePoolSafe`** —
   body is exactly `_requirePoolSafe(poolId); …set revoked`; no inline safe re-check; choke-point
   is the sole authority path.
3. **`revokeBatch` reverts `BatchNotFound` for never-registered; double-revoke idempotent** — second
   call re-sets the flag, never reverts.
4. **`setBatchMaxCards` Safe-gated via `_requirePoolSafe`; 0 clears cap** — no inline auth.
5. **`registerInPool` gates before nullifier burn / membership write (verified literally)** — order:
   `PoolNotFound` → `BatchNotFound` → `if (batch.revoked) revert BatchRevoked();` → `if
   (batch.maxCards != 0 && batch.cardCount >= batch.maxCards) revert BatchMaxCardsReached();` →
   *then* signature recovery / `usedNullifiers[…]=true` / `cardCount++` / membership. A revoked or
   over-cap batch reverts before any nullifier burn or membership write.
6. **`_registerBatch` initializes `revoked:false, maxCards:0`** — PASS.
7. **#8 updateSurvey empty-CID guard** — mirrors `createSurvey`'s `require(bytes(...).length > 0,
   "IPFS CID cannot be empty")`; zero ABI change; a Safe can no longer blank a survey's metadata.

## Scope / constraints

- Only `contracts/src/S3ntimentSurveyStore/S3ntimentSurveyStore.sol` +
  `contracts/test/S3ntimentSurveyStore.test.ts` (plus REPORT.md) changed; no shared/frontend
  migration files. Exactly #4 + #8; no deferred items introduced (no events, no chain-binding
  changes, no Safe rotation, no pagination, no claim signatures, no nullifier/encoding changes).
- No breaking ABI change to any existing external function.

## Gate (independently reconciled by orchestrator)

`cd contracts && pnpm test` (= hardhat test) at committed HEAD `9f0ba864c`:
**60 passing (60 nodejs)** — matches the implementer's reported count (no miscount). New
`revokeBatch`/`setBatchMaxCards` blocks run green, incl. cross-pool scoping + nullifier-not-burned
assertions.

## Handoff

**PR #20 ready for human merge.** Reviewed 2026-08-29; orchestrator does not merge.

---

## Addendum — #9 folded in (same day)

The human approved adding audit finding **#9** (`createSurvey` batchIds footgun) to the same PR, so the
scope of PR #20 is now **#4 + #8 + #9**. Implementer continued the same worktree/branch (commits
`056b8f2c0` feat + `677067cb6` docs). Since the reviewed scope changed, a **fresh** independent reviewer
(`v4flash-review-revoke-batch-9`, builder, report-only, full updated diff at `/tmp/revokebatch9.diff` +
contract) re-reviewed the whole PR.

**#9 (new):** `createSurvey`'s existing-pool `else` branch (after `_requirePoolSafe`, before
`_recordSurvey`) now reverts `InvalidBatchIds()` when `batchIds.length > 0`. Previously the array was
silently dropped on an existing pool (survey added, batches never registered, cards later failing
`BatchNotFound` at redemption) — now an explicit caller-mistake revert. New-pool bootstrap branch
**untouched** (array still honored + registered). Doc comments updated to state batchIds is honored only
at bootstrap.

**Verdict (fresh review): PASS — no blocking issues.** All #4 items 1–6, #8 item 7, and the #9 guard
verified against live source; `registerInPool` gating literally confirmed before any nullifier
burn/membership write; no test skips/onlys; no deferred items; no breaking ABI change.

**Gate (orchestrator independently reconciled):** `cd contracts && pnpm test` at committed HEAD
`677067cb6` = **61 passing (61 nodejs)** — matches implementer's reported count (no miscount). The old
`ignores batchIds` test was replaced with the `InvalidBatchIds` revert test + a new empty-array-still-
succeeds test (net +1). PR #20 title updated to reflect #4/#8/#9. Still OPEN, do not merge (human's call).


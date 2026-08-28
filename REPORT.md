# D3 — Centralize Safe authority check into a single `_requirePoolSafe` choke-point

Implements **D3** from `brain/specs/s3ntiment-survey-store-method-surface-2026-08-28.md`:
a pure, signature-preserving refactor that centralizes the duplicated Safe checks into one
shared authority choke-point. No ABI/selector change; no deferred methods added.

## Branch
`deepseek/method-surface`

## PR
https://github.com/Joera/s3ntiment/pull/9

## Commit
`508a409c` — fix(S3ntimentSurveyStore): use internal _requirePoolSafe auth function (D3)

## What changed

**`contracts/src/S3ntimentSurveyStore/S3ntimentSurveyStore.sol`**

The D3 authority choke-point is implemented as a single **internal function** rather than a
Solidity `modifier`, because the repo's Solidity resolves modifier reference-type parameters
to `calldata`: a `string memory`-declared modifier cannot be invoked with a `memory` string,
and the args cannot be made `calldata` without breaking the zero-ABI-change constraint
(`updateSurvey` derives its `poolId` internally; the internal helpers take `memory` strings).

```solidity
function _requirePoolSafe(string memory poolId) internal view {
    if (pools[poolId].safe == address(0)) revert PoolNotFound();
    if (pools[poolId].safe != msg.sender) revert NotPoolSafe();
}
```

- `_requirePoolSafe` is the single choke-point for every Safe-gated write: it enforces
  `PoolNotFound()`-then-`NotPoolSafe()` ordering.
- Applied through all three Safe-gated write functions with **zero external ABI/selector
  change** (no external function signature line changed):
  - `createSurvey` — bootstrap branch preserved exactly (new pool ⇒ `msg.sender` becomes the
    Safe, batches registered, survey recorded); the *existing-pool* path calls
    `_requirePoolSafe(poolId)` before recording the survey.
  - `updateSurvey` — checks `SurveyNotFound()` first, then calls
    `_requirePoolSafe(survey.poolId)` (poolId derived from the stored survey, so its existence
    is already guaranteed), then writes the CID.
  - `registerBatch` — calls `_requirePoolSafe(poolId)` at the top before registering the batch.
- Removed the previous modifier-wrapped internal wrappers (`_createSurveyOnExistingPool`,
  `_updateSurveyBySafe`) — gated paths now call the shared auth function directly.
- **Not added** (explicitly deferred): `revokeMember`, `registerInPoolSigned`, `nonce` storage,
  and any rotation/key-management method. `registerInPool` keeps its own card-based auth path.

## Test gate

Observed on the **committed HEAD** after a full clean rebuild (`rm -rf artifacts cache
generated`), run from the `contracts` workspace of the worktree:

```
cd contracts && pnpm exec hardhat test
```

Result: **36 passing, 0 failing** (nodejs test runner).

- `createSurvey` on an existing pool, non-safe caller ⇒ `NotPoolSafe` (test present + green)
- `updateSurvey` by non-safe ⇒ `NotPoolSafe` (test present + green)
- `registerBatch` by non-safe ⇒ `NotPoolSafe` (test present + green)
- `PoolNotFound` ordering verified where applicable (e.g. `registerBatch` for an unknown pool,
  `getPool` for an unknown pool).

The full existing suite remains green (pool/survey lifecycle, getters, batch management, and
the full `registerInPool` matrix).

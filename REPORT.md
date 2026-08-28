# D3 — Centralize Safe authority check into `onlySafe` modifier

Implements **D3** from `brain/specs/s3ntiment-survey-store-method-surface-2026-08-28.md`:
a pure, signature-preserving refactor that centralizes the duplicated Safe checks into one
shared authority modifier. No ABI/selector change; no deferred methods added.

## Branch
`deepseek/method-surface`

## Commit
`344c3b897` — refactor(S3ntimentSurveyStore): center Safe authority check in onlySafe modifier (D3)

## What changed

**`contracts/src/S3ntimentSurveyStore/S3ntimentSurveyStore.sol`**
- Added a single `onlySafe(string memory poolId)` modifier that reverts `PoolNotFound()` when
  `pools[poolId].safe == address(0)` and `NotPoolSafe()` when `pools[poolId].safe != msg.sender`,
  then `_;`. It is the single choke-point for every Safe-gated write.
- Applied/threaded the modifier through all three Safe-gated write functions, with **zero**
  external ABI/selector change (verified: no diff on external function signature lines):
  - `createSurvey` — bootstrap branch preserved exactly (new pool ⇒ `msg.sender` becomes the
    Safe, registered batches, survey recorded); the *existing-pool* path is routed through the
    shared modifier via internal `_createSurveyOnExistingPool` (so the existence check cannot
    fire on a brand-new pool).
  - `updateSurvey` — routes through the modifier via internal `_updateSurveyBySafe`, deriving
    `poolId` from the stored survey (existence guaranteed ⇒ `SurveyNotFound` still precedes auth).
  - `registerBatch` — modifier applied directly to the external function.
- Updated the contract's doc comments to state the authority model: the per-pool authority is
  `pools[poolId].safe`, and `onlySafe(poolId)` is the single choke-point.
- **Not added** (explicitly deferred): `revokeMember`, `registerInPoolSigned`, `nonce` storage,
  and any rotation/key-management method. `registerInPool` keeps its own card-based auth path.

## Test gate

Command (run from the `contracts` workspace of the worktree):

```
pnpm exec hardhat test
```

Result: **36 passing, 0 failing** (nodejs test runner).

- `createSurvey` on an existing pool, non-safe caller ⇒ `NotPoolSafe` (test present + green)
- `updateSurvey` by non-safe ⇒ `NotPoolSafe` (test present + green)
- `registerBatch` by non-safe ⇒ `NotPoolSafe` (test present + green)

The full existing suite remains green (pool/survey lifecycle, getters, batch management, and
the full `registerInPool` matrix).

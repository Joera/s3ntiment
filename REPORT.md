# S3ntimentSurveyStore — Audit #4 (batch revocation) + #8 (updateSurvey CID guard)

Branch: `deepseek/revoke-batch` (worktree `~/code/worktrees/s3ntiment-revoke-batch`, based on `origin/main` @ `a197684bc`).
PR: https://github.com/Joera/s3ntiment/pull/20

## What changed

### `contracts/src/S3ntimentSurveyStore/S3ntimentSurveyStore.sol`
Scope is exactly the two external-audit findings (#4, #8); nothing else was touched.

**#4 — Batch revocation + optional per-batch card cap**
- `struct Batch` gains two storage-layout-compatible fields **appended at the end**: `bool revoked` and `uint256 maxCards` (0 = unlimited). Existing fields (`createdAt`, `cardCount`) were not reordered.
- New errors: `BatchRevoked()`, `BatchMaxCardsReached()`.
- New `revokeBatch(string memory poolId, address batchId) external` — Safe-gated **exclusively** through the existing `_requirePoolSafe(poolId)` choke-point (the single authority path; no new authority check/modifier added). Reverts `BatchNotFound()` for a never-registered batch; double-revoke is an **idempotent no-op**, consistent with the existing `revokeMember` precedent.
- New `setBatchMaxCards(string memory poolId, address batchId, uint256 maxCards) external` — Safe-gated through `_requirePoolSafe`, 0 clears the cap. Included because it did not complicate the ABI path (registerInPool's batchIds-array ABI is unchanged).
- `registerInPool` — immediately after the existing `BatchNotFound` check (and **before any nullifier/signature work**):
  - `if (batch.revoked) revert BatchRevoked();`
  - `if (batch.maxCards != 0 && batch.cardCount >= batch.maxCards) revert BatchMaxCardsReached();`
  - so a revoked or over-cap batch can never burn a nullifier or write membership.
- `_registerBatch` initializes the two new fields (`revoked: false`, `maxCards: 0`).

**#8 — updateSurvey empty-CID guard**
- `updateSurvey` now requires a non-empty `newIpfsCid`, reusing `createSurvey`'s existing guard `require(bytes(newIpfsCid).length > 0, "IPFS CID cannot be empty")`. Zero ABI change; a Safe can no longer blank a survey's metadata via a successful tx.

**ABI / invariants**
- No breaking change to any existing external function signature; the two new functions (`revokeBatch`, `setBatchMaxCards`) are additive only. `getBatch` signature unchanged.
- All new authority routed through the existing `_requirePoolSafe` choke-point.
- No deferred items introduced (no events, no chain-binding changes, no Safe rotation, no pagination, no claim signatures).
- Contract header/design-doc comment updated only where the change affects it (the choke-point Safe-gated write list).

### `contracts/test/S3ntimentSurveyStore.test.ts`
Mirrors the existing test style. Added:
- `updateSurvey`: empty CID reverts (`IPFS CID cannot be empty`) and leaves the original CID untouched.
- `revokeBatch` (Safe-gated governance): non-Safe → `NotPoolSafe`; unknown pool → `PoolNotFound`; never-registered batch → `BatchNotFound`; successful revoke then subsequent `registerInPool` reverts `BatchRevoked` **and does not burn the nullifier** (assert `isNullifierUsed` is still `false`); cross-pool scoping intact (same batch address revoked in pool A does not affect pool B); double-revoke idempotent no-op.
- `setBatchMaxCards` (per-batch cap): registering cards up to the cap succeeds, one past the cap reverts `BatchMaxCardsReached` (and does not burn the nullifier); non-Safe → `NotPoolSafe`; never-registered batch → `BatchNotFound`.

## Gate

Exact command (from `contracts/`):
```
pnpm test
```
(= `hardhat test`; the repo's contracts test command.)

Result: **60 passing (60 nodejs)** — the runner's own collected count. Green from the committed worktree state.

Committed HEAD (code change commit): `d19f9cd0d93e07d04ca549fa61ea615379254d0d`
Branch tip (after this report commit): see `git log -1`.

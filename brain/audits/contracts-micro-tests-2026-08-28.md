# Contracts Package — Micro-Branch Tests (Bucket 1.3)

**Date:** 2026-08-28
**Branch/PR:** `deepseek/contracts-micro-tests`
**Scope:** TEST-ONLY additions to `contracts/test/S3ntimentSurveyStore.test.ts`. **No production source changes** (`contracts/src/**` untouched) — verified via `git diff --stat` (only the test file changed).
**Related audit:** `brain/audits/all-packages-coverage-gaps-2026-08-28.md` §1.3 (held in the `s3ntiment` main checkout at `brain/audits/all-packages-coverage-gaps-2026-08-28.md`).

This closes the three "genuinely-missing micro-branches" identified for the contracts package:
1. `InvalidBatchId` via the **createSurvey bootstrap** path.
2. **Multi-pool ordering invariants** for `getSafePools` / `getPoolBatches`.
3. The **`_recoverSigner` v-adjustment** edge.

---

## 1. What was added

All new cases were added to the existing Hardhat `node:test` suite, matching the
existing fixture pattern (`networkHelpers.loadFixture(deployAll)`, where
`loadAndExecuteDeploymentsFromFiles` runs the **real** deploy script). The fixture
setup, `createBatchWallet`, `signCardMessage` (from `@s3ntiment/shared/invites/encoding`),
and `viem.deployContract('MockSMC', [...])` conventions are unchanged.

| # | Test | Location (describe block) | Branch covered |
|---|---|---|---|
| 1 | `reverts during createSurvey bootstrap for a zero-address batch (InvalidBatchId)` | `pool + survey lifecycle (createSurvey)` | `createSurvey` → bootstrap loop → `_registerBatch` → `if (batchId == address(0)) revert InvalidBatchId()` |
| 2 | `orders getSafePools per safe in creation order and isolates pools by safe` | `multi-pool ordering invariants (getSafePools / getPoolBatches)` | `safePools[safe].push(poolId)` aggregation order + per-safe isolation |
| 3 | `aggregates getPoolBatches in push order across bootstrap and registerBatch` | `multi-pool ordering invariants (getSafePools / getPoolBatches)` | `poolBatchIds[poolId].push(batchId)` order across bootstrap + later `registerBatch`, per-pool isolation |
| 4 | `accepts signatures whose raw v is 0 or 1 (adjusted to 27/28) and recovers the batch wallet` | `registration (registerInPool)` | `_recoverSigner`: `if (v < 27) v += 27` low-v success path |
| 5 | `reverts when the raw v byte is 26 (adjusted to 53, not 27 — so recovery is refused)` | `registration (registerInPool)` | `_recoverSigner`: post-adjustment `require(v == 27 || v == 28)` failure |

Suite delta: **36 → 41** passing tests (36 baseline + 5 new).

---

## 2. Per-branch notes

### 2.1 `InvalidBatchId` via createSurvey bootstrap
`createSurvey` bootstraps a new pool by looping the initial `batchIds` through
`_registerBatch`. A zero-address entry therefore triggers the same
`InvalidBatchId()` branch that was previously only reachable via `registerBatch`.
The test asserts both a zero-only array and a mixed array (valid batch first,
then a zero address). It additionally asserts that the whole transaction rolled
back — `poolExists(poolId)` and `surveyExists(surveyId)` are both `false` even
though `_createPool` runs before the batch loop (the pool is never persisted).

### 2.2 Multi-pool ordering invariants
Two tests. The first interleaves pool creation across two safes and asserts
`getSafePools(safe)` returns each safe's pools in **creation order** and that the
lists are **isolated per safe**. The second registers batches both during a
two-pool bootstrap and via a later `registerBatch`, asserting
`getPoolBatches(poolId)` returns them in **push order** (`bootstrap…` then
`registerBatch…`) and that the pools' batch lists are isolated from each other.

### 2.3 `_recoverSigner` v-adjustment edge — **premise refuted, real edge covered**
The audit (§1.3) described this as "`v=26 → 27` valid". **Verified against the
source, that premise is incorrect:**

```solidity
if (v < 27) v += 27;
require(v == 27 || v == 28, "Invalid signature recovery value");
```

- For `v = 26`: `26 < 27` is true → `v = 26 + 27 = 53` → `require(53 == 27 || 53 == 28)`
  fails → **reverts**. `v=26` does **not** recover a signer in this code.
- The genuine, previously-untested micro-branch is the **low-v adjustment**
  `v=0 → 27` and `v=1 → 28`, which recover the **same** signer as the canonical
  `27/28` path.

Per the acceptance contract ("verify the real behaviour first … if a micro-branch
turns out to be un-reachable without a source change, note it in the report and
skip it — don't expand scope"), I made **no source change**. Instead I covered the
**real reachable** edge and pinned the `v=26` reality:

- **Test 4 (real edge):** signs two cards (`card-lowv-0` → natural `v=27`,
  `card-lowv-1` → natural `v=28`), rewrites each trailing `v` byte to its raw low
  value (`0` and `1` — `v-27`), and asserts both complete a real `registerInPool`
  as pool members (recovering the batch wallet), with `getBatch` cardCount `2`.
  This deterministically exercises **both** low-v values (`0→27` and `1→28`).
- **Test 5 (pinned reality):** rewrites a real signature's `v` byte to `0x1a` (26)
  and asserts `registerInPool` **reverts** with
  `Invalid signature recovery value` — documenting that `v=26` is rejected, not
  adjusted to a valid signer. The canonical `v=27`/`v=28` success path remains
  covered by the pre-existing happy-path `registerInPool` tests (unchanged).

---

## 3. Green gates (verified by the author)

```
$ cd contracts && pnpm hardhat test
…
41 passing (41 nodejs)

$ cd contracts && pnpm run check:abi
[abi-snapshot] ✓ S3ntimentSurveyStore: deployment ABI (base) matches compile artifact + typed ABI (27 entries)
[abi-snapshot] ✓ all checked contracts match (deployments/base vs. compiled ABI).
```

- **`pnpm hardhat test`**: 41/41 passing (was 36).
- **`pnpm run check:abi`**: green (`EXIT 0`).
- **No source changes:** `git diff --stat` shows only
  `contracts/test/S3ntimentSurveyStore.test.ts` (+240 lines). `pnpm-lock.yaml`
  churn from the local install was reverted; no lockfile changes are part of this PR.

---

## 4. Notes
- All new tests match the existing `node:test` + `earl` + Hardhat fixture conventions.
- The PR is test-only and deliberately does **not** merge itself.

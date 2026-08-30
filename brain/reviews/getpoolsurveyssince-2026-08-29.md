# PR #22 Review — `feat(contracts): add getPoolSurveysSince view function`

- Reviewer: independent (fresh session, neutral bundle)
- Reviewed artifact: `brain/reviews/getpoolsurveyssince-2026-08-29.diff` (3 files)
- Branch: `deepseek/getpoolsurveyssince`
- Gate status at PR head `1856b2d1` (orchestrator-verified, context only): `pnpm test` → 67 passing exit 0 (60 S3ntimentSurveyStore incl. 6 new cases); `pnpm check:abi` → green (34 entries)

## VERDICT: APPROVED

No blocking issues. Three scope questions ruled on below (all non-blocking; A is a noted deviation that is judged acceptable, with rationale tied to the acceptance contract).

---

## Acceptance item-by-item

### 1. Function + struct as specced, following file conventions — PASS
- `struct SurveyRef { string id; string ipfsCid; uint256 createdAt; }` — matches spec verbatim.
- `function getPoolSurveysSince(string memory poolId, uint256 since) external view returns (SurveyRef[] memory)` — signature matches spec. NatSpec documents "created after `since` (exclusive)", "pool insertion order", "Unknown pool -> empty array (no revert)", "Read-only".
- Semantics vs spec: iterates `poolSurveys[poolId]`, reads `surveys[id]`, keeps `createdAt > since` (strictly greater), preserves `poolSurveys[poolId]` order, no sort, no limit/pagination arg, unknown pool → empty array (no revert). All confirmed against the Solidity body.
- Non-goals respected: no `updatedAt`, no change to `updateSurvey`, no events, no backend surface, no existing method/selector touched in source. Additive, ABI-compatible.

### 2. Tests (method-surface spec §8) — PASS (6 new cases)
Coverage matrix in `contracts/test/S3ntimentSurveyStore.test.ts`, all within the new `getPoolSurveysSince (view)` describe block:
- Unknown pool → empty array, no revert ✓
- before / at / after `since` filtered with STRICTLY-greater boundary (since = s2.createdAt → only s3; since = s1.createdAt → s2,s3; since = s3.createdAt → empty) ✓
- Multiple pools isolated (interleaved timestamps across pool-a / pool-b; pool A never sees b1) ✓
- SurveyRef fields populated (id / ipfsCid / createdAt), cross-checked against `getSurvey` as source of truth ✓
- All-in-range → full list in insertion order (explicitly NOT sorted) ✓
- None-in-range → empty (since == newest createdAt, and far-future since) ✓
- Timestamp control via harness: `createSurveyAt` uses `networkHelpers.time.setNextBlockTimestamp` and asserts recorded `createdAt` equals the requested timestamp — satisfies "createdAt = block.timestamp at create" control. Count matches gate (6 new cases).

### 3. Checked-in ABI record reflects the new method — PASS (see scope Q A)
`contracts/deployments/base/S3ntimentSurveyStore.json` `abi` array adds `getPoolSurveysSince` (plus `revokeBatch`, `setBatchMaxCards`, and 3 error entries). Base had 28 abi entries; after sync = 34, matching the gate's "34 entries" and the compiled-artifact count. Arithmetic confirmed: 28 + 3 fns + 3 errors = 34.

### 4. Green gates — PASS
Per orchestrator gate status at PR head: contracts suite 67/67 exit 0; `pnpm check:abi` green at 34 entries.

---

## Scope questions (rulings)

### A. Deployment-JSON `abi`-only sync (revokeBatch / setBatchMaxCards / getPoolSurveysSince, 34 entries) — ACCEPTABLE, non-blocking

Context confirmed independently: `contracts/scripts/check-abi-snapshot.ts` compares the committed `deployments/base/S3ntimentSurveyStore.json` `abi` array against (1) the hardhat compile artifact and (2) the generated typed ABI. The base deployment JSON (pre-PR) did NOT contain `revokeBatch`/`setBatchMaxCards` or their errors — i.e., it was stale since the merged revoke-batch PR (#20) and `check:abi` was red at baseline. The PR's sync brings the shipped record to match the compiled source.

Ruling: NOT a blocking scope violation, for these reasons, each tied to the acceptance contract:
1. **Scope of the non-goal.** The non-goal "NO changes to existing methods or selectors" governs the Solidity interface (source). The `abi` field of the deployment JSON is a generated metadata record frontends import — it is documentation of the interface, not the interface itself. The diff changes ONLY the `abi` array: no `address`, `bytecode`, `deployedBytecode`, source, or selector is touched. Nothing in the compiled contract's method/selector surface changes.
2. **Acceptance item 3 requires it.** "Regenerate any checked-in generated ABI wrapper that MUST reflect the new method" — the deployment JSON `abi` is precisely the checked-in ABI record frontends consume, and it MUST contain `getPoolSurveysSince` for item 3 to hold. The parenthetical ("no deploy-ABI snapshot change is *strictly required for the source to build*") is about the source building, not about the shipped ABI record or the check:abi gate.
3. **Gate #4 requires it.** `pnpm check:abi` compares deployment JSON `abi` to the compiled artifact; it cannot go green without this sync. Leaving the record stale would keep the gate red and contradict the verified gate status.
4. **Additive reconciliation, not new scope.** The bundled `revokeBatch`/`setBatchMaxCards` entries are the compiled artifact's current truth (merged in PR #20); the sync merely catches the deploy-export up to source, it does not add or alter any method. The ABI remains a strict superset; selector hashes for all pre-existing methods are unchanged.

Notes (non-blocking):
- The sync bundles diff lines attributable to PR #20's feature. Acceptable here because it is a metadata reconciliation of a pre-existing red gate, and reverting it would leave item 3 + gate #4 unsatisfiable in this PR. A cleaner alternative (ship the sync in a separate PR and keep this one strictly additive) would have been nice-to-have but is not required; the acceptance contract does not demand it, and check:abi would still be red in the meantime.
- The deployed on-chain contract at that address does not actually expose `getPoolSurveysSince` until a fresh deploy. This is inherent to a source-only, view-only PR (no deploy step) and explicitly contemplated by the acceptance contract ("no deploy-ABI snapshot change is strictly required"); the `deployedBytecode` field is untouched, so the record correctly distinguishes shipped-ABI (source) from on-chain state.

### B. `string memory` vs `calldata` — CONSISTENT
Every existing external view/function in the file uses `string memory`: `getSurvey`, `surveyExists`, `getPoolSurveys`, `getPool`, `poolExists`, `isPoolSafe`, `getSafePools`, and the Safe-gated writes. `getPoolSurveysSince(string memory poolId, ...)` matches the file's dominant convention exactly (handoff explicitly permits "pick what the file uses"). No issue.

### C. Two-pass (count-then-fill) + strictly-greater filter — CORRECT
- Pass 1 counts matches under the exact filter `surveys[ids[i]].createdAt > since` (strictly greater).
- Pass 2 allocates `new SurveyRef[](count)` — exact size, no wasted slots, no trailing uninitialized entries — and fills in the same order with the same predicate, so `j` provably lands at `count` (no out-of-bounds, no underfill).
- Order preserved: both passes iterate `poolSurveys[poolId]` index order; no sort.
- Unknown pool / no matches: `ids` is an empty dynamic array (default mapping value), both loops no-op, returns empty array — no revert, matching `getPoolSurveys`.
- Defensive edge: a survey id present in `poolSurveys` but absent from `surveys` (invariant violation) would read `createdAt == 0`, which fails `> since` for any valid `uint256 since` and is skipped silently — no revert, spec-conformant.
- Read-only, external view, no storage writes.

---

## Severity summary
- **Blocking:** none.
- **Non-blocking:** (A) deployment-JSON `abi` sync judged acceptable with rationale above; (B) `string memory` consistent; (C) implementation correct.

## Final: APPROVED — merge at human discretion.

# Handoff — `getPoolSurveysSince` (on-chain survey poll, OPTION 1: created-only)

**Date:** 2026-08-29
**Status:** HANDOFF — scoped and ready to implement in a SEPARATE session. This session is
the web-components (Lit) exploration; the contract work here is deliberately NOT picked up
here. Hand this doc to the next implementation session verbatim.
**Scope:** OPTION 1 only — a read-only view function on `S3ntimentSurveyStore` answering
"which surveys in this pool were created since a cursor?" No schema change, no storage, no
`updatedAt`, no events, no backend endpoint.

## Grounding (read these first)
- `brain/audits/survey-poll-api-exploration-2026-08-29.md` — the full exploration: no
  listing endpoint exists; the respondent app reads the chain directly; `getPoolSurveys`
  is orphaned (not wired to any route/frontend); no `updatedAt`; no events.
- `brain/specs/s3ntiment-survey-store-method-surface-2026-08-28.md` — method-surface design;
  §8 test rule REQUIRES a matching test for any change to `S3ntimentSurveyStore.sol`.
- Source: `contracts/src/S3ntimentSurveyStore/S3ntimentSurveyStore.sol`.
- `brain/docs-conventions.md` — reporter/deliverable, worktree, and independent-review
  conventions.

## Why on-chain (decided — do not re-litigate)
- The respondent frontend already reads the chain directly via viem
  (`shared/src/shared/survey/survey.factory.ts` `fetchSurvey` → `getSurvey`). A view function
  slots into that existing path; no new HTTP surface, API key, or backend dependency.
- View calls are free (no gas; executed by the RPC node) and authoritative (the source of
  truth itself — no off-chain indexer to drift), which fits the GrapheneOS/privacy posture.
- One `eth_call` replaces the N+1 (`getPoolSurveys` + per-id `getSurvey`).

## The contract change (the entire deliverable)
In `contracts/src/S3ntimentSurveyStore/S3ntimentSurveyStore.sol`, add:

```solidity
struct SurveyRef {
    string id;
    string ipfsCid;
    uint256 createdAt;
}

/// Returns the pool's surveys created after `since` (exclusive), in pool
/// insertion order. Unknown pool -> empty array (no revert). Read-only.
function getPoolSurveysSince(string calldata poolId, uint256 since)
    external view returns (SurveyRef[] memory)
```

Semantics:
- Iterate the existing `poolSurveys[poolId]` (the array `getPoolSurveys` already returns,
  sol:235); for each id read `surveys[id]`; keep entries with `createdAt > since`.
- Return `SurveyRef { id, ipfsCid, createdAt }` — the consumer needs the id (to fetch and
  decrypt from IPFS) and `createdAt` (to advance its cursor) in one call; `ipfsCid` saves a
  second lookup.
- Unknown pool / no matches → empty array; do NOT revert (match `getPoolSurveys` behavior).
- Preserve `poolSurveys[poolId]` insertion order; do NOT sort on-chain (view loops are free
  to call, but sorting is wasted work the client can do if it wants).
- `>` (strictly-greater) cursor semantics: the consumer stores `since = max(seen createdAt)`.
  KNOWN tiny edge: multiple surveys created in the same block share `block.timestamp`, so a
  strict `>` cursor over `createdAt` alone can miss same-timestamp siblings. Acceptable for a
  4-hour poll; the client should ALSO dedupe by id against its local cache (`SurveysStore`)
  so "new" = "id not already stored", making the timestamp cursor a pure optimization.
- Do NOT add a `limit`/pagination arg now (YAGNI; per-pool survey counts are small).
- Match the file's existing parameter/naming conventions (note: current `getPoolSurveys`
  uses `string memory` — calldata is fine for a view; pick what the file uses).

## Explicit non-goals (option 2 stays OUT of this handoff)
- NO `updatedAt` field, NO change to `updateSurvey`. Created-only.
- NO events.
- NO new backend endpoint / route / cursor HTTP surface.
- NO changes to existing methods or selectors (additive view fn only; ABI-compatible).

## Acceptance contract for the implementing session
1. Function + struct as specced, following the existing file's conventions.
2. Tests in `contracts/test/S3ntimentSurveyStore.test.ts` (REQUIRED by method-surface §8):
   - unknown pool → empty array;
   - surveys created before / at / after `since` filtered correctly (strictly `>`);
   - multiple pools isolated (only the requested pool's surveys returned);
   - `SurveyRef` fields populated correctly (id / ipfsCid / createdAt);
   - all-in-range and none-in-range cases.
   - Control timestamps via the test harness (distinct creates / vm.warp) — `createdAt` is
     `block.timestamp` at create.
3. Regenerate any checked-in generated ABI wrapper that must reflect the new method
   (e.g. `contracts/generated/abis/S3ntimentSurveyStore.ts` — confirm the repo's generation
   step; the fn is view-only so no deploy-ABI snapshot change is strictly required for the
   source to build).
4. Green gates: the contracts test suite passes (same command, file set, and commit as
   reported — collected cases, not function counts).
5. Open its own PR. Independent review in a FRESH session given ONLY the diff + this
   contract. The human merges.

## Routing / conventions
- Implementing session: `builder` sub-agent in its OWN worktree
  (`~/code/worktrees/s3ntiment-getpoolsurveyssince`), own PR, independent review in a fresh
  session (solaris preferred), human merges. See `brain/docs-conventions.md`.
- Report file alongside the PR (conventions: full report to a file, 1–3 line inline reply).
- Deployment note (context): the view fn exists in source; it only becomes callable on a
  deployed contract after a redeploy/migration — that decision is out of this handoff's scope.

## Consumer note (context only — belongs to the mobile/web-components session, NOT here)
The mobile poll consumes this fn per pool on a ~4h background tick plus an instant check on
app open; on new ids it schedules LOCAL notifications (no push needed — works on GrapheneOS).
Full client-side design stays in the web-components session.

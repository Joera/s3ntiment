# ABI Snapshot Seam Test — Implementation Report

**Date:** 2026-08-28
**Status:** implemented, gated green, PR opened (human merge pending)
**Branch:** `deepseek/abi-snapshot` (off `main` @ `b10cb7d26`)
**Commit:** `3871c21e4` — `feat(contracts): add ABI snapshot seam check (deployments/base vs compiled ABI)`
**Worktree:** `/home/joera/code/worktrees/s3ntiment-abi-snapshot`
**PR:** https://github.com/Joera/s3ntiment/pull/5

---

## 0. What this is

This is seam-coverage **Pattern 2 (nice-to-have)** from
`brain/audits/seam-coverage-exploration-2026-08-28.md` §2 (ABI/artifacts): a
check that **FAILS LOUDLY** (non-zero exit) if the ABI that the **frontends
import** diverges from the ABI that the **contract tests compile/use**. None
existed before; the two pipelines (rocketh `deploy-export` vs. hardhat
`compile`) were unverified against each other.

**Context from the grounding doc:** the frontends import the deployed ABI as a
raw JSON file:

```ts
import surveyStore from 's3ntiment-contracts/deployments/base/S3ntimentSurveyStore.json'  // { 'address', 'abi': [...] }
```

while the contract tests compile from the **typed ABI**:

```ts
import {Abi_S3ntimentSurveyStore} from '../../generated/abis/S3ntimentSurveyStore.js';  // hardhat compile / generateTypedArtifacts
```

Those two artifacts come from two different pipelines and were never
cross-checked. This work adds that check.

---

## 1. Placement choice (proportionate option)

**Chosen: a repo-level check script** — `contracts/scripts/check-abi-snapshot.ts`,
exposed as **`pnpm check:abi`** in `contracts/package.json`.

Rationale (vs. adding a `node:test` test to the existing green harness):

1. This is a **seam / build-pipeline integrity check**, not a behavioral unit
   test — it belongs next to the build tooling, not in the behavioral suite.
2. It **self-bootstraps the build** (runs `pnpm compile` when build artifacts
   are absent). Kicking off a compile from inside the unit-test runner is
   unusual and would couple test semantics to build state.
3. It leaves the existing green `hardhat test` suite completely untouched.

This matches the task's "choose the proportionate option" — a standalone,
self-contained, loudly-failing integrity check.

---

## 2. What the check does

For each committed deployment under `deployments/base/*.json` (currently just
`S3ntimentSurveyStore`), it compares the `abi` array from:

| Source | Pipeline | Notes |
|---|---|---|
| `deployments/base/S3ntimentSurveyStore.json` `.abi` | rocketh deploy-export | **what the frontends import** (committed, ships in the workspace package) |
| `artifacts/src/S3ntimentSurveyStore/S3ntimentSurveyStore.sol/S3ntimentSurveyStore.json` `.abi` | hardhat compile | canonical compiled artifact |
| `generated/abis/S3ntimentSurveyStore.ts` (runtime `export const Abi_…`) | `generateTypedArtifacts` | **what the tests import** in `test/utils/index.ts` |

If the deployment ABI != either compiled ABI, it prints the **first structural
divergence** (path-level diff) and **exits 1**. If all match, it prints a ✓
summary and exits 0.

The generated typed ABI file was found to export **both** a `type` and a
runtime `export const Abi_S3ntimentSurveyStore = [...]` array — the runtime
const is parsed (bracket-balanced JSON extraction) as the test-side ABI.

---

## 3. Fresh-checkout behaviour & documented dependency

`artifacts/` and `generated/` are **build artifacts and are gitignored** (see
`contracts/.gitignore`: `generated`, `artifacts`, `cache`). On a fresh checkout
they do not exist. The script therefore:

- reads the committed `deployments/base/*.json` first (always present),
- resolves the expected artifact/generated paths from the deployment's
  `sourceName` + `contractName`,
- if missing, runs **`pnpm compile`** (hardhat compile) to reproduce them,
  then compares.

This dependency (hardhat compile → `artifacts/` + `generated/`) is documented
in the script header. Note `pnpm install` already triggers `prepare` →
`pnpm compile`, so in practice the artifacts exist; the explicit compile makes
the check self-sufficient however it is invoked.

---

## 4. Gate results (run in this worktree / branch, real)

### 4.1 New ABI snapshot check — GREEN
```
$ pnpm check:abi
[...]
$ tsx scripts/check-abi-snapshot.ts
[abi-snapshot] ✓ S3ntimentSurveyStore: deployment ABI (base) matches compile artifact + typed ABI (27 entries)
[abi-snapshot] ✓ all checked contracts match (deployments/base vs. compiled ABI).
exit 0
```

### 4.2 Loud-failure behaviour (negative test)
Corrupted the deployment ABI (`abi[0].name` → `HACKED_DIVERGENCE`), re-ran:
```
[abi-snapshot] ✗ frontend-imported ABI (deployments/base/S3ntimentSurveyStore.json) DIVERGES from hardhat compile artifact (.../S3ntimentSurveyStore.json).
  first divergence: $[0].name: expected "HACKED_DIVERGENCE", got "AlreadyPoolMember"
...
exit 1
```
Restored the original file afterward (verified `abi[0].name == AlreadyPoolMember`).

### 4.3 Fresh-checkout (self-compile) behaviour
Removed `artifacts/` + `generated/`, re-ran the script:
```
[abi-snapshot] build artifacts missing — running `pnpm compile` (hardhat compile) …
$ hardhat compile
Compiled 2 Solidity files with solc 0.8.28 (evm target: cancun)
[abi-snapshot] ✓ S3ntimentSurveyStore: deployment ABI (base) matches compile artifact + typed ABI (27 entries)
exit 0
```
Restored both directories afterward.

### 4.4 Existing contracts test suite — still GREEN
```
$ npx hardhat test
Running node:test tests
30 passing (30 nodejs)
exit 0
```
(30 tests collected + passed; all `S3ntimentSurveyStore` suites — pool/survey
lifecycle, updateSurvey, getters, registerBatch, registerInPool.)

### 4.5 Formatting
```
$ npx prettier --check scripts/check-abi-snapshot.ts package.json
All matched files use Prettier code style!
```

---

## 5. Diff / deliverables

Two files changed on `deepseek/abi-snapshot`:
- **added** `contracts/scripts/check-abi-snapshot.ts`
- **modified** `contracts/package.json` (added `"check:abi": "tsx scripts/check-abi-snapshot.ts"`)

No production contract, frontend, or test code changed.

---

## 6. How to run

```bash
cd contracts
pnpm check:abi          # or: npx tsx scripts/check-abi-snapshot.ts
```

---

## 7. Open items / future

- If a divergence is ever reported, the resolution is to regenerate the
  deployment export from the compiled source (`pnpm hardhat --network base
  deploy` + `pnpm rocketh-export -e base`) so the shipped ABI matches the
  tested ABI — this is spelled out in the script's failure message.
- The check currently covers `deployments/base` (the shipped `base` deployment
  that both frontends pin). It generalises to any committed deployment dir if
  one is later added/needed.
- Companion seam coverage (Pattern 1 shared encoding package, Pattern 3 local-node
  E2E) remains open per the exploration report and was out of scope here.

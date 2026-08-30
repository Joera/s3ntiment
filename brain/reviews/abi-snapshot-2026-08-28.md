# Independent Review — PR #5: ABI snapshot seam check

- **Reviewed commit:** `3871c21e4` — `feat(contracts): add ABI snapshot seam check (deployments/base vs compiled ABI)`
- **Reviewed branch:** `deepseek/abi-snapshot` (diff vs `main`: 2 files, +224/−0)
- **Contract:** seams-coverage Pattern 2 (nice-to-have); requires a FAIL-LOUD check that the ABI the frontends import (`contracts/deployments/base/S3ntimentSurveyStore.json`, shipped via the `s3ntiment-contracts/deployments/*` package export) matches the ABI the contract tests compile/use (hardhat compile artifact + `generated/abis/S3ntimentSurveyStore.ts`)
- **Verdict:** ✅ **APPROVED** (no blocking issues; non-blocking robustness notes below)

## Scope of change (additive-only, req. 4)
Diff adds exactly two things:
1. `contracts/package.json`: one new script line `"check:abi": "tsx scripts/check-abi-snapshot.ts"`.
2. New standalone `contracts/scripts/check-abi-snapshot.ts` (223 lines).

No production contract, frontend, or existing test file is touched. The existing contracts suite (30 tests) is unaffected by construction. **Additive-only requirement met.**

## Requirement-by-requirement assessment

### 1. Placement proportionate ✅
A repo-level script + npm-script entry is explicitly acceptable per the contract ("repo-level script is acceptable"). It iterates every `deployments/base/*.json`, so it scales to future contracts without changes.

### 2. Fresh-checkout self-bootstrap ✅ (verified)
On a fresh checkout `artifacts/` and `generated/` are absent (gitignored). The script:
- checks for the hardhat compile artifact; if missing runs `pnpm compile`;
- checks for `generated/abis/<Contract>.ts`; if missing runs `pnpm compile` again.

I confirmed the plugin wiring in `hardhat.config.ts` (`HardhatDeploy` plugin, `generateTypedArtifacts.destinations` with `mode: 'typescript'`) and in the plugin source (`hardhat-deploy/dist/hook-handlers/solidity.js` calls `generateTypes` inside the compile pipeline). Therefore `pnpm compile` regenerates **both** `artifacts/**` and `generated/abis/*.ts`. In practice the single compile produces both, so only one compile fires. The dependency is clearly documented in the script header. **Self-bootstrap + documentation met.**

### 3. Gate ✅ (statically verified; CI run recommended)
- New check: I verified the two key path assumptions and the parser logic against the actual artifacts:
  - Deployment `sourceName` is `src/S3ntimentSurveyStore/S3ntimentSurveyStore.sol` → artifact lookup `artifacts/src/S3ntimentSurveyStore/S3ntimentSurveyStore.sol/S3ntimentSurveyStore.json` is the correct hardhat layout.
  - Generated ABI path `generated/abis/S3ntimentSurveyStore.ts` matches exactly what the tests import (`test/utils/index.ts` imports `Abi_S3ntimentSurveyStore` from `../../generated/abis/S3ntimentSurveyStore.js`).
  - I reproduced the exact hardhat-deploy inline `typescript` output format (`export type Abi_X = [...]`; then `export const Abi_X: Abi_X = [...]` as the final statement) and ran the script's `indexOf('[', marker)` → `lastIndexOf(']')` extraction: it yields exactly the const ABI array and JSON-parses identically to the source. So the check should pass green.
  - Comparison is made against **both** the hardhat artifact and the generated typed ABI — this covers exactly the two "compile/use" sources named in the contract, so the seam is fully cross-checked.
- Existing tests: unchanged, so they remain green. (I could not execute the full hardhat build in this review sandbox — no `node_modules` — so a CI run of `pnpm check:abi` and `npx hardhat test` is recommended to lock the gate green. Nothing in the static review indicates a failure.)

### 4. Fail-loud semantics ✅
All failure paths exit non-zero via `fail()`; success prints a trailing checkmark and exits 0. `deployments/base` empty → fail. Missing/invalid `abi` or `sourceName` → fail. Compiled artifact or generated file missing after self-compile → fail. Divergence → fail with the first divergent path.

## Correctness / robustness findings

### Robustness of `extractGeneratedAbi` (`indexOf('[', start)` … `lastIndexOf(']')`) — NON-BLOCKING
The extraction is correct for the *current* generator output (inline `export const Abi_<Name> = [...]` as the final statement in the file — verified empirically). It is **fragile** to generator-format drift:
- If the generated file later gains **trailing exports** (e.g. another contract's array, a `default` export) or any trailing `]` in a comment/string, `lastIndexOf(']')` will over-capture the tail.
- I confirmed that such a case does **not** silently mis-compare — `JSON.parse` throws and the script **fails loudly** (exit non-zero). So it preserves the fail-loud guarantee; the downside is only a potential *false-positive* (check goes red when ABIs actually match), never a silent pass.
Because a spurious red is a misbehaviour to avoid in a gate, consider anchoring the slice on the closing `;`/`as const`/the const statement instead of a global `lastIndexOf(']')`, or simply diffing the `generated/artifacts` JSON directly. Recommended, **not required** to ship.

### Dotfile / stray-JSON handling — NON-BLOCKING (sound)
`deployments/base/.chain` is a dotfile and is correctly excluded by `readdirSync(...).filter(f => f.endsWith('.json'))`. The only `.json` currently present is the real deployment. If a non-deployment `.json` data file were ever dropped into `deployments/base`, the script would treat it as a deploy artifact and fail loudly (it requires an `abi` array + a `.sol` `sourceName`) — an acceptable guard, worth knowing.

### Double `pnpm compile` — NON-BLOCKING
The artifact and generated-file branches each invoke `runCompile()` if their target is missing. Because a single `pnpm compile` produces both, this fires at most once in practice. Slightly redundant structure only; no behavioural problem.

### Stale-artifact scope — NON-BLOCKING (by design)
The check compares the shipped deployment ABI against currently-compiled outputs; it does not detect "deployment is stale because the contract source changed but wasn't recompiled/re-exported." That is the seam this check is meant to catch (frontend-shipped vs tests-compiled), and re-export is the documented remediation. Out of scope and acceptable.

## Blocking issues
None.

## Non-blocking summary
1. `lastIndexOf(']')` extraction is correct today but brittle to generator-format changes; any drift surfaces as a loud false-failure, never a silent pass. Optional hardening: anchor the ABI slice on the statement terminator, or diff `generated/artifacts` instead.
2. CI should actually run `pnpm check:abi` (and confirm the 30-test `npx hardhat test` remains green) to lock the gate green end-to-end; static review indicates it will pass.
3. Stray non-deployment JSON in `deployments/base` would be treated as a contract (loud failure — acceptable guard).

## Verdict
**APPROVED.** Correctly and robustly satisfies the acceptance contract: additive-only, self-bootstrapping on fresh checkout, fail-loud on divergence, and it cross-checks the frontend-imported deployment ABI against **both** the hardhat compile artifact and the generated typed ABI. Only non-blocking robustness suggestions remain.

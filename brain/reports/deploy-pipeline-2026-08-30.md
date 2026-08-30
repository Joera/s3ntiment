# Contract Deploy / Verify / ABI–Address Pipeline — Findings

**Date:** 2026-08-30
**Scope:** READ-ONLY investigation of the `s3ntiment` pnpm monorepo at `/home/joera/code/s3ntiment`.
**Glossary note:** the Solidity package is `s3ntiment-contracts` (NOT `@s3ntiment/contracts`). It is the single source of truth for the deployed contract `S3ntimentSurveyStore`.

---

## 1. DEPLOY SETUP (`contracts/`)

### 1.1 `hardhat.config.ts`
Package name in `contracts/package.json` is **`s3ntiment-contracts`** (`v0.0.3`). Deps already include `hardhat-deploy ^2.0.0` and `@rocketh/*` (rocketh is the deploy/verify runtime; hardhat-deploy is wired through its helper import).

Key config (full file read):
```ts
import HardhatDeploy from 'hardhat-deploy';
import { addForkConfiguration, addNetworksFromEnv, addNetworksFromKnownList } from 'hardhat-deploy/helpers';

plugins: [HardhatNodeTestRunner, HardhatViem, HardhatNetworkHelpers, HardhatKeystore, HardhatDeploy]
solidity: {
  profiles: {
    default:    { version: '0.8.28' },
    production: { version: '0.8.28', settings: { optimizer: { enabled: true, runs: 999999 } } },
  },
}
networks: addForkConfiguration(
  addNetworksFromKnownList(
    addNetworksFromEnv({
      default: { type: 'edr-simulated', chainType: 'l1', accounts: { mnemonic: process.env.MNEMONIC || undefined } },
    }),
  ),
),
paths: { sources: ['src'] },
generateTypedArtifacts: { destinations: [ { folder: './generated', mode: 'typescript' } ] },
```

**Networks — read from env by `hardhat-deploy/helpers`:**
- `addNetworksFromEnv` / `addNetworksFromKnownList` scan for `ETH_NODE_URI_<network>` (RPC URL) and `MNEMONIC_<network>` (or bare `MNEMONIC` fallback) for each known chain. The value `SECRET` redirects to a `SECRET_ETH_NODE_URI_<network>` configVariable.
- Concretely for this repo: **`base`** needs `ETH_NODE_URI_base` + `MNEMONIC_base`; **`sepolia`** needs `ETH_NODE_URI_sepolia` + `MNEMONIC_sepolia`.
- `default` is an **`edr-simulated`** network (local, no RPC) with `process.env.MNEMONIC` for accounts.
- `addForkConfiguration` adds a `fork` network from `HARDHAT_FORK` (used by `fork:deploy`/`fork:execute`).

**`generateTypedArtifacts`** → emits TypeScript typed artifacts + typed ABIs into **`./generated`** (`generated/artifacts/*.ts`, `generated/abis/*.ts`). These are **build artifacts, gitignored**.

### 1.2 Deploy script — `deploy/001_deploy_survey_store.ts`
```ts
import { deployScript, artifacts } from '../rocketh/deploy.js';
export default deployScript(async (env) => {
  const { deployer, admin } = env.namedAccounts;
  const deployment = await env.deploy('S3ntimentSurveyStore', {
    account: deployer, artifact: artifacts.S3ntimentSurveyStore, args: [],
  });
  const contract = env.viem.getContract(deployment);
  const message = await contract.read.surveyExists(['0']);
  console.log(...);
}, { tags: ['SurveyStore', 'SurveyStore_deploy'] });
```
- Uses hardhat-deploy's `deploy()` via the rocketh shim. No proxies / no upgradeable beacon — **plain, non-upgradeable constructor-less deploy** (`args: []`).
- `namedAccounts` come from `rocketh/config.ts`: `deployer: {default: 0}`, `admin: {default: 1}` (index into the mnemonic-derived accounts).
- Tags `SurveyStore` / `SurveyStore_deploy` allow `--tags` selective deploy. `dependencies` would be specified in the second arg but none is used here.
- `rocketh/deploy.ts` re-exports `artifacts` from `../generated/artifacts/index.js`, and `rocketh/environment.ts` provides `loadEnvironmentFromHardhat` + `loadAndExecuteDeploymentsFromFiles` (test/script seam).

### 1.3 Solidity sources (`contracts/src/`, recursive)
- `src/S3ntimentSurveyStore/S3ntimentSurveyStore.sol` — the only real contract. Header docs: pools, surveys, batch/nullifier cards, `registerInPool` (SMC gas abstraction), `isPoolMember`, `createSurvey` (implicit pool bootstrap), `revokeMember` + `_requirePoolSafe` choke-point (latest source), view fns incl. `getPoolSurveysSince`.
- `src/testing/MockSMC.sol` — test helper (implements `ISMC.owner()`).
- **No proxies, no `UpgradableBeacon`, no `*Implementation` / `*Proxy`** anywhere. The pipeline is single-contract, immutable.
- One non-deployed template contract note: SPEC references an old `GreetingsRegistry` template, but it is **not present** in the current `src/`.

### 1.4 State of `deployments/`
```
deployments/
  base/
    .chain                                   {"chainId":"8453", ...}
    S3ntimentSurveyStore.json   (80 KB, committed)
  sepolia/
    .chain                                   {"chainId":"11155111", ...}   (NO deployment JSON)
```
- **`deployments/base/S3ntimentSurveyStore.json` is committed** (git-tracked), and only `base` has a real deployment file. **`deployments/sepolia` has only `.chain` — no deployed artifact** (not deployed on Sepolia).
- Base JSON fields (extracted): 
  - `contractName: "S3ntimentSurveyStore"`, `sourceName: "src/S3ntimentSurveyStore/S3ntimentSurveyStore.sol"`
  - `address: "0x11a14527eeccfab475901116cf34221c1eb12354"`
  - `transaction: { "hash": "0x94d1f8f0c476ffe8f2e7ac6dca3b5e9c67e920062cfb8949d7edbc2cc36211ca", "nonce": "0x23", "origin": "0xb6ca51ca72c689b720235aca37e579f821fa05ee" }`
  - `receipt: { "blockHash": "0x0000...0000", "blockNumber": "0x296f121" (=43446561), "transactionIndex": "0x51" }`
  - full `abi`, `bytecode`, `deployedBytecode`, `metadata`, `devdoc`, `userdoc`, `storageLayout`.
- **Caveat (truthful assessment):** the JSON has a real-looking address + tx hash + receipt, but `receipt.blockHash` is **all zeros** — atypical for a genuine hardhat-deploy mainnet receipt. On-chain existence at that address should be confirmed against BaseScan before treating it as production-ready. The transaction claims block `43,446,561` on Base (chainId 8453).

### 1.5 `generated/` directory
- Contains (gitignored, not tracked — `git check-ignore` returns it; `git ls-files generated` = 0):
  - `generated/artifacts/{S3ntimentSurveyStore,MockSMC}.ts` + `index.ts` (huge typed artifacts with bytecode + `metadata`)
  - `generated/abis/{S3ntimentSurveyStore,IS3ntimentSurveyStore,ISMC,MockSMC}.ts` + `index.ts` (typed ABI consts/types)
- `contracts/.gitignore` ignores `generated`, `cache`, `artifacts`, `dist/` and `deployments/{localhost,hardhat*,lan,default}` — i.e. **`deployments/base` + `deployments/sepolia` are NOT ignored and are the committed artifacts**.
- `generated/` and `artifacts/` are produced by `hardhat compile` (`pnpm compile`; also triggered by `prepare` on install). **Neither generated artifacts nor generated ABIs contain the deployed address — ABI only.** The address lives solely in `deployments/base/S3ntimentSurveyStore.json`.

**Deploy scripts (package.json):**
- `:deploy+export`: `cross-var pnpm hardhat --network $MODE deploy --skip-prompts && cross-var rocketh-export -e $MODE`
- `deploy`: `pnpm compile --build-profile production && ldenv hardhat --network @@MODE deploy @@`
- `deploy:dev`: `ldenv -d localhost pnpm :deploy+export @@` (default mode = localhost, EDR/local node)
- `deploy:watch`, `local_node`, `fork:deploy` (uses `HARDHAT_FORK`), `docgen`, `execute` (uses `HARDHAT_NETWORK`).
- `MODE` is resolved from env / `.env` via `ldenv` (`@@MODE`).

---

## 2. HOW ABIs + ADDRESSES FLOW ACROSS THE MONOREPO

**Universal pattern:** consumers import the **committed deployment JSON** and use both `surveyStore.address` and `surveyStore.abi` from it. No consumer hardcodes the address in source; no env-var-driven address; no separate constants file. The workspace export `"./deployments/*": "./deployments/*"` in `contracts/package.json` makes this reachable.

The JSON is imported with a JSON attribute:
```ts
import surveyStore from 's3ntiment-contracts/deployments/base/S3ntimentSurveyStore.json' with { type: 'json' }
```
(older files use `assert { type: 'json' }`).

| Consumer | Package dep on contracts | Import | Uses |
|---|---|---|---|
| `frontend-organiser` | `"s3ntiment-contracts": "workspace:../contracts"` | `deployments/base/S3ntimentSurveyStore.json` in `factories/{survey,pool}.factory.ts`, `controllers/{survey,pool,batch,new.ctrlr}.ts`, `factories/invitation.factory.ts` | reads/writes via `surveyStore.address` + `surveyStore.abi` (`createSurvey`, `registerBatch`, `isPoolMember`, …) |
| `frontend-respondents` | `"s3ntiment-contracts": "workspace:../contracts"` | same JSON in `router.ts`, `humanWallet.factory.ts`, `controllers/{auth,survey,used-card}-ctrlr.ts`, `router.gates.ts` | `fetchSurvey`, `card.isUsed`, `card.register` (`registerInPool`), `isPoolMember` |
| `nillcc-backend` | `"s3ntiment-contracts": "file:../contracts"` (note `file:`, not `workspace:`) | same JSON in `main.ts`, `contract.factory.ts`, `pool.ctrlr.ts`, `survey.ctrlr.ts` | `surveyStore.address` + `surveyStore.abi` (`getSurvey`, `isPoolMember`, score auth); also feeds `contract = surveyStore.address` into generated Lit Action code strings |
| `shared` (`@s3ntiment/shared`) | **no** dependency on contracts | **none** — relies on dependency injection | `card.factory.ts` takes `surveyStore` as an injected param (`isUsed`/`register`); `lit/accs.ts` ACC builders take `contract` (address) as a param and the embedded `functionAbi` fragments (e.g. `isPoolMember`) are inlined as strings |
| `protocol` | none | none | Lit-only ops scripts; unrelated hardcoded addresses (`0x609E288979c68d1486B600f82ea8E278B3e88148` userAddr default, a hardcoded PK) |
| `website` | none | none | no contract references at all (static site) |
| `scripts/` (root) | — | only `dev-with-logs.sh` (dev orchestration) | none |

**Generated Lit Action code strings** (`shared/src/shared/lit/actions/{owner-invocation,user-delegation,decrypt-for-owner,decrypt-for-respondent,decrypt}-*.ts`): the store address is interpolated via `${contract}` into generated Solidity-ish action source. `nillcc-backend/pool.ctrlr.ts` supplies it: `const contract = surveyStore.address;` then `getDecryptForOwnerAction(poolId, contract, safeAddress)` etc. (after `compactAction`). So the address still originates from the deployment JSON.

**Address literal check:** `0x11a14527eeccfab475901116cf34221c1eb12354` appears **only** inside `deployments/base/S3ntimentSurveyStore.json` and in the prior `getpoolsurveyssince` report — it is **not hardcoded** in any consumer source.

**Key designed invariants:**
- The address + ABI are read from ONE committed file: `contracts/deployments/base/S3ntimentSurveyStore.json`.
- `shared` deliberately does **not** import the contract package (kept decoupled; callers inject the deployment record). This is clean but means there is no shared re-export of per-network addresses.

---

## 3. VERIFICATION

### Tooling
`rocketh-verify` ships from `@rocketh/verifier ^0.19.3` (devDep). `contracts/package.json`:
```json
"verify": "ldenv rocketh-verify -e @@MODE @@",
"export": "ldenv rocketh-export -e @@MODE @@",
```
`@@MODE` = the environment/network (e.g. `base`, `sepolia`); the trailing `@@` = remaining CLI args = the **subcommand**.

`rocketh-verify` reads deployments from the `deployments/` folder and the `.chain` for the network (chainId). Subcommands (from `node_modules/@rocketh/verifier/dist/cli.js`):
- `etherscan` — submits to a block explorer; reads `process.env['ETHERSCAN_API_KEY']`; default endpoint **`https://api.etherscan.io/v2/api`** with `chainid=${env.chainId}` passed per request → the Etherscan **V2 multichain** API covers Base (8453) **and** Sepolia (11155111) automatically. Source license is auto-extracted from the SPDX header (`MIT` in the .sol), with `--license` / `--force-license` override; `--endpoint` overrides the URL (e.g. `https://api.basescan.org/api` if you only hold a BaseScan-specific key).
- `sourcify` / `blockscout` — alternative verifiers (no API key needed; `--endpoint` for blockscout).

### Exactly what a user must supply to verify on Etherscan/BaseScan/Sepolia
1. `MODE` set appropriately for `.env` / `ldenv` (or pass as arg).
2. A deployment file must exist for that network: **`base` yes** (`S3ntimentSurveyStore.json`); **`sepolia` no** (must deploy first).
3. `ETHERSCAN_API_KEY` in env / `.env` (loaded by `ldenv`).
4. Run, e.g.: `pnpm verify base etherscan` (dev-mode equivalent: `pnpm verify sepolia etherscan` after a Sepolia deploy). Add `--endpoint https://api.basescan.org/api` if using a BaseScan-only key rather than an Etherscan V2 key.

**Blockers specific to verification here:** no `ETHERSCAN_API_KEY` (or `BASESCAN_API_KEY`) is present anywhere in the repo or env files (no `.env` exists; both are gitignored). Only a frontend `VITE_ETHERSCAN_API_KEY` type declaration exists (`frontend-organiser/src/vite-env.d.ts`, `frontend-respondents/src/vite-env.d.ts`) — unrelated to deployment verification. `rocketh-verify` reads **`ETHERSCAN_API_KEY`** specifically; there is **no** code path for `BASESCAN_API_KEY` (which is fine — the V2 API key covers Base). Also note: the committed base deployment ABI record is hand-edited and diverges from a clean compile (see §5) — verification matches the submitted source to the **actually deployed bytecode**, so verifying the current source against the deployed contract at `0x11a14527…` may fail unless it is a genuine deploy of that exact bytecode.

---

## 4. CONSTANT STORAGE — RECOMMENDED MECHANISM

### What the codebase does today (ground truth)
- **Source of truth = `contracts/deployments/<network>/<name>.json`** (hardhat-deploy format: `address` + `transaction` + `receipt` + `abi` + `metadata`). This is the only place the address lives.
- `generateTypedArtifacts` outputs (`generated/artifacts/*`, `generated/abis/*`) contain the **ABI only — no address**.
- Consumers read both ABI and address from that one JSON via `s3ntiment-contracts/deployments/base/S3ntimentSurveyStore.json`.
- `shared` has **no** contract-address constants and **no** re-export; the address flows in as a parameter.
- There is **no env-var pattern** for the contract address today (env vars are used only for RPC/mnemonic/API keys). Chain ids are not stored as constants either — the backend hardcodes `base` from `viem/chains`.

### Recommendation (matches hardhat-deploy + this repo's structure)
1. **Keep `deployments/<network>/S3ntimentSurveyStore.json` as the single source of truth.** It is already committed and already the import that every consumer uses. Do not hardcode `0x…` strings; the repo is already correct in importing the JSON.
2. Add a **thin per-network constant/re-export layer in `shared`** so non-contract packages (and future consumers) get a typed address + chainId without importing JSON directly — but note the repo consciously keeps `shared` decoupled from `s3ntiment-contracts`. If you want that decoupling preserved, instead add a tiny helper in each consumer (or in `shared`) shaped like:
   ```ts
   import surveyStore from 's3ntiment-contracts/deployments/base/S3ntimentSurveyStore.json' with { type: 'json' };
   export const S3NTIMENT_STORE = {
     address: surveyStore.address as `0x${string}`,
     abi: surveyStore.abi,
     chainId: 8453, // Base
   };
   ```
   This is the minimal change that turns "read JSON everywhere" into "one named constant per network" while still deriving the address from the deployment record (no duplication, no drift).
3. **Never persist the address in a generated/typed-artifact** (they are gitignored and ABI-only); keep it in the committed deployment JSON or a small committed constants module sourced from it.
4. Per-network selection: the repo targets **Base mainnet** today (all consumer imports hardcode `deployments/base/…`). If multi-network support is wanted, drive the network from an env var (e.g. `VITE_CONTRACT_NETWORK=base|sepolia`) and map it to the corresponding `deployments/<network>/` import — a natural extension of the existing import path.
5. Chain-id constants: define `chainId: 8453` (Base) / `11155111` (Sepolia) alongside the address in the same constants helper, and prefer `viem/chains` (`base`) elsewhere as the backend already does.

**In short (the key answer):** today the address is correctly NOT hardcoded — it is read from `contracts/deployments/base/S3ntimentSurveyStore.json`, which is a hardhat-deploy deployment artifact and the committed source of truth. The recommended hardening is to route it through a single small `shared` (or per-app) constants helper derived from that JSON, exported per network, with chain-id beside it.

---

## 5. GAPS / BLOCKERS BEFORE A REAL DEPLOY + VERIFY

### Env / secrets (all currently absent — no `.env` file exists anywhere; root `.gitignore` has `**/.env`)
- `ETH_NODE_URI_base` — Base RPC (required for `hardhat --network base deploy`).
- `MNEMONIC_base` — deployer mnemonic on Base (falls back to `MNEMONIC`).
- (For Sepolia) `ETH_NODE_URI_sepolia` + `MNEMONIC_sepolia`.
- `ETHERSCAN_API_KEY` — required by `rocketh-verify` (= Etherscan V2 key; covers Base + Sepolia via `chainid=`).
- Backend runtime: `nillcc-backend` needs `BASE_RPC_URL` (used in `contract.factory.ts`: `http(process.env.BASE_RPC_URL)`) plus its own `.env` (Pimlico key, Pinata, etc. — out of scope here).

### Wiring / state
- **Sepolia is not deployed** (only `base` has a deployment JSON). A real Sepolia deploy must run first: `pnpm deploy sepolia` → emits `deployments/sepolia/S3ntimentSurveyStore.json`, then `pnpm verify sepolia etherscan`.
- **Base deployment JSON is stale/hand-edited.** Per `brain/reports/getpoolsurveyssince-2026-08-29.md`, the `abi` array in `deployments/base/S3ntimentSurveyStore.json` was **manually spliced** to add `getPoolSurveysSince`, `revokeBatch`, `setBatchMaxCards` (34 entries) WITHOUT a real redeploy — the deployed contract at `0x11a14527…` predates those functions. The current source additionally adds `revokeMember`/`_requirePoolSafe`. Net effect: the committed ABI **does not describe the bytecode actually on-chain**, and a fresh `hardhat compile` produces a different ABI (28 functions in a stale `artifacts/` build vs. source with both old and new members). This breaks both frontend-correctness and clean verification. **Fix:** do a genuine redeploy (or a deliberate migration) and re-export via `:deploy+export` so `deployments/base/*.json` matches real deployed bytecode; run `pnpm check:abi` (`scripts/check-abi-snapshot.ts`) to confirm the deployment ABI == compiled artifact == typed ABI.
- `pnpm check:abi` is the guardrail (compares deployment JSON ABI vs `artifacts/…/[name].json` vs `generated/abis/[name].ts`); it is currently **red** given the divergence above, so it must go green before considering the pipeline sound.
- `receipt.blockHash` is `0x0000…0000` in the committed base JSON — confirm the on-chain deployment independently (BaseScan) before relying on it for verification.

### No other blockers
- hardhat-deploy is registered and the deploy script is present; `generateTypedArtifacts` works (gitignored outputs exist now).
- The `verify` script + `rocketh-verify` binary are wired; nothing else needs code changes once the env vars exist and the deployment record is genuine.

---

## Appendix — key paths
- `contracts/hardhat.config.ts` — networks, default edr-simulated, `generateTypedArtifacts`
- `contracts/deploy/001_deploy_survey_store.ts` — the deploy script
- `contracts/rocketh/{config,deploy,environment}.ts` — namedAccounts, deploy shim, env loader
- `contracts/src/S3ntimentSurveyStore/S3ntimentSurveyStore.sol` — the contract
- `contracts/deployments/base/S3ntimentSurveyStore.json` — committed ABI+address source of truth
- `contracts/deployments/{base,sepolia}/.chain` — chainId records
- `contracts/generated/{artifacts,abis}/*` — gitignored typed artifacts/ABIs (no address)
- `contracts/scripts/check-abi-snapshot.ts` — deployment-vs-compiled ABI guardrail
- `shared/src/shared/{invites/card.factory.ts, lit/accs.ts, lit/actions/*}` — injected surveyStore / ACC / Lit action strings
- Consumers: `frontend-organiser/src/{factories,controllers}`, `frontend-respondents/src/{router,humanWallet.factory,controllers}`, `nillcc-backend/src/{contract.factory,main,pool.ctrlr,survey.ctrlr}.ts`

# SEAM Coverage Exploration — Solidity contract tests ↔ frontend/shared code

**Date:** 2026-08-28
**Mode:** read-only exploration (nothing edited)
**Repo:** `/home/joera/code/s3ntiment` · branch `main` (`b10cb7d26`, tracks `origin/main`)
**PR #4 worktree:** `/home/joera/code/worktrees/s3ntiment-contract-tests` · branch `contract-tests` (already merged into `main`; the test file is byte-identical on both trees — verified with `diff`, result `IDENTICAL`)

**Goal:** map the SEAM between the contract tests and the frontend/shared code so seam coverage can be added (shared encoding package, E2E against a local Hardhat node, and/or an ABI snapshot test).

---

## 0. Executive summary

There are **four independent implementations** of the "card message hash" `keccak256(abi.encodePacked(nullifier, "|", batchId))` in this repo, none importing another:

| # | Location | Form | EIP-191 handled by |
|---|----------|------|--------------------|
| 1 | `contracts/src/S3ntimentSurveyStore/S3ntimentSurveyStore.sol` (`registerInPool`, ~L290) | Solidity `keccak256(abi.encodePacked(...))` | manual `keccak256("\x19Ethereum Signed Message:\n32" + hash)` on-chain |
| 2 | `contracts/test/S3ntimentSurveyStore.test.ts` (`cardMessageHash`/`signCard`, L24–44) | viem `encodePacked` + `keccak256` | manual prefix + `batch.sign({hash: ethSignedHash})` |
| 3 | `frontend-organiser/src/factories/invitation.factory.ts` (`generateCardSecrets`, ~L83) | viem `encodePacked` + `keccak256` | viem `signMessage({message:{raw}})` (auto-applies EIP-191) |
| 4 | `shared/src/shared/invites/card.factory.ts` (`encodeNullifierBatchCombo`, L6–18, inside `parseCardURL`) | **manual byte concat** (no `encodePacked`) + `keccak256` | viem `recoverMessageAddress({message:{raw}})` (auto-applies EIP-191) |

The function names `cardMessageHash` / `signCard` exist **only** in the contract test file today (confirmed by repo-wide grep). `encodeNullifierBatchCombo` is a private function scoped to `card.factory.ts` and not exported.

The seam **can drift**. #3 and #4 are two *different* frontend implementations of the same hash (one uses `encodePacked`, the other hand-rolls bytes), and neither is imported by the test's inline helper. This is exactly the drift the requested seam coverage is meant to prevent.

---

## 1. What the frontend does when creating / joining a survey

### Message signed for `registerInPool` / card sending

**Card creation (organiser side)** — `frontend-organiser/src/factories/invitation.factory.ts`:
- `generateRandomNullifier()` — 16 random bytes → base64url string.
- `createBatchWallet(services)` — derives a batch EOA under the safe: `batchSignature = safe.signMessage("batch:"+seed)`; `batchPrivKey = keccak256(toBytes(batchSignature))`; `batchAccount = privateKeyToAccount(batchPrivKey)`. `batchId = batchAccount.address`.
- `generateCardSecrets(batchAccount, batch)` — per card:

```ts
const packed = encodePacked(
    ['string', 'string', 'address'],
    [nullifier, '|', batch.id as `0x${string}`]
);
const messageHash = keccak256(packed);
const signature = await batchAccount.signMessage({ message: { raw: messageHash } });

const url = `${BASEURL}?n=${nullifier}&b=${batch.id}&sig=${signature}&s=${batch.survey}`;
```

The QR URL carries `n` (nullifier), `b` (batchId), `sig` (EIP-191 signature of the raw message-hash), `s` (surveyId).

This is driven by `frontend-organiser/src/factories/survey.factory.ts` (`createBatch` → `createBatchWallet` + `generateCardSecrets` → `uploadToPinata` → `registerBatch` via `surveyStore.abi "registerBatch"`).

**Card redemption (respondent side)** — `frontend-respondents/src/controllers/auth-ctrlr.ts` (`render`, L53+):
1. `parseCardURL(window.location.href)` → recovers the message hash and the owner inside `shared/src/shared/invites/card.factory.ts` (see #4); also used in `frontend-respondents/src/router.ts` L42.
2. `fetchSurvey(...)` to get poolId.
3. `authenticate()` (`frontend-respondents/src/auth.factory.ts`) — waap login + `signMessage` + `oprf.getSecp256k1` → 4337 simple-account signer; then `isPoolMember` read.
4. `new Card(cardData).register(services, surveyStore, poolId)` → `services.account.write(surveyStore.address, surveyStore.abi, 'registerInPool', [poolId, nullifier, batchId, signature], ...)`.

`Card.register` is in `shared/src/shared/invites/card.factory.ts` (L60–70); `Card.isUsed` reads `isNullifierUsed`.

### The one place that resembles a shared "card message hash" function

`shared/src/shared/invites/card.factory.ts`, `parseCardURL`:

```ts
const encodeNullifierBatchCombo = (decodedNullifier: string, decodedBatchId: string) => {
    const encoder = new TextEncoder();
    const nullifierBytes = encoder.encode(decodedNullifier);
    const pipeBytes = encoder.encode("|");
    const addressBytes = decodedBatchId.slice(2);

    const hexStr = Array.from(nullifierBytes)
    .concat(Array.from(pipeBytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('') + addressBytes;

    const packedMessage = ('0x' + hexStr) as `0x${string}`;
    return keccak256(packedMessage);
}
// ...
const messageHash = encodeNullifierBatchCombo(decodedNullifier, decodedBatchId);
const surveyOwner = await recoverMessageAddress({ message: { raw: messageHash }, signature: decodedSignature });
```

Note **this is hand-rolled, not `encodePacked`**. It concatenates `UTF-8(nullifier) ++ "|" ++ bytes(batchId minus 0x)` then keccak256. Because nullifier is base64url ASCII and batchId is a 20-byte address, the produced bytes equal the `encodePacked(['string','string','address'], …)` form used by #2 and #3 — but only by coincidence of the current encoding choices, and there is no test pinning that equivalence.

### Does `cardMessageHash` / `signCard` exist anywhere outside the test?

**Confirmed: NO.** Repo-wide grep shows these identifiers (as function definitions / usages) **only** in `contracts/test/S3ntimentSurveyStore.test.ts` (defs at L24 and L35; usages at L528, 585, 633, 721, 752, 795, 805, 835). No other `.ts`/`.sol` file defines them. The `messageHash` name leaks into `S3ntimentSurveyStore.sol` (L290, L319) and the two frontend files, but only as a variable, not as an importable function.

---

## 2. ABI / artifacts: where they live and how the frontends consume them

**Frontends import the deployed ABI as a raw JSON file** from the workspace package `s3ntiment-contracts` (`workspace:../contracts` in both `frontend-organiser/package.json` and `frontend-respondents/package.json`).

Import statements (identical across all frontend files):

```ts
// frontend-organiser: controllers/{new,pool,batch,survey}.ctrlr.ts, factories/{survey,pool}.factory.ts
import surveyStore from 's3ntiment-contracts/deployments/base/S3ntimentSurveyStore.json' assert { type: 'json' }
// frontend-respondents: {auth.factory,router}.ts, controllers/{auth,survey,used-card}.ctrlr.ts
import surveyStore from 's3ntiment-contracts/deployments/base/S3ntimentSurveyStore.json' with { type: 'json' }
```

`contracts/package.json` exposes this via `exports`:

```json
"./deployments/*": "./deployments/*"
```

and the physical artifact is `contracts/deployments/base/S3ntimentSurveyStore.json` (contains `"address"` and a full `"abi"` array — the shipped `base` deployment; there is also a `contracts/deployments/base/.chain` and `contracts/deployments/sepolia/.chain`).

These deployment JSONs are produced by the hardhat-deploy / rocketh pipeline (`./deploy`, `./export`, `rocketh-export -e $MODE`), not by a separate publishing step. `contracts/package.json` also exposes `./artifacts/*` → `./dist/generated/artifacts/*` and `./abis/*` → `./dist/generated/abis/*`, but those are **not** what the frontends import today.

**Do the artifacts match what hardhat compiles / tests?** The test harness does **not** read the deployment JSON. `contracts/test/utils/index.ts` imports the typed ABI from the generate step:

```ts
import {Abi_S3ntimentSurveyStore} from '../../generated/abis/S3ntimentSurveyStore.js';
import {loadAndExecuteDeploymentsFromFiles} from '../../rocketh/environment.js';
```

`generated/abis/S3ntimentSurveyStore.js` is produced by the `rocketh` generate/compile step (via `hardhat compile` + `generateTypedArtifacts` / rocketh export). **That `contracts/generated/` directory does not exist in the current working tree** (no `compile`/export has been run since checkout), i.e. the typed ABI is a build artifact, not committed.

**Conclusion for the ABI-snapshot seam:** the frontends read `deployments/base/*.json` while the tests compile from `contracts/generated/abis/*.js` — two pipelines (rocketh deploy-export vs. hardhat compile) that can diverge, and neither is currently cross-checked. An ABI snapshot test comparing the `abi` field the frontends import (`deployments/base/S3ntimentSurveyStore.json`) against the compiled type would be a legitimate new seam test and is not present today.

---

## 3. The shared package `@s3ntiment/shared`

**What it is:** `shared/` is a pnpm workspace package (`@s3ntiment/shared`, `version 0.0.1`), built with plain `tsc`, `type: module`, `NodeNext`. Root script `build:shared` → `pnpm --filter @s3ntiment/shared build` → `tsc`.

**Exports (from `shared/package.json`):**
- `.` → `./dist/shared/index.js` (the combined `src/shared/index.ts`)
- `./dev` → `./src/index.js` (source, no build)
- `./browser` → `./src/browser/index.ts` (Vite-consumed, source TS — used by both frontends for `WaapService`/`OPRFService`)
- `./node` → `./dist/node/index.js`
- `./assets`, `./components` → `./src/...` source

**What `src/shared/index.ts` re-exports:**
```ts
export * from './evm/index.js';   // chains, viem, permissionless.safe/simple, tx.types, contract-address
export * from './lit/index.js';
export * from './ipfs/index.js';
export * from './nillion/index.js';
export * from './survey/index.js';
export * from './invites/index.js'; // types.js + card.factory.js  ← card signing/parsing lives here
export * from './results/index.js';
export * from './helpers/index.js';
```

The seam-relevant module is **`shared/src/shared/invites/`** (`card.factory.ts` + `types.ts`; `Card`, `parseCardURL`, `CardData`), which is already the home of the respondent-side message-verification logic.

**Is it the natural home for a shared encoding module? Yes.** It is already consumed by both frontends (`@s3ntiment/shared`, plus `@s3ntiment/shared/browser`), it is the only package that both frontends share, and `card.factory.ts` already holds a private `encodeNullifierBatchCombo`. Promoting that (plus a `cardMessageHash`/`signCard`-style helper that produces the digest + EIP-191 signature) to an exported, tested module would let both the frontend factories and the contract tests import the *same* bytes. Trade-off: the module must stay dependency-free / pure over `viem` bytes so the hardhat node-test-runner (which has no `tsc` build of shared available unless `build:shared` is run first) can consume it — keep it leaf-level and ESM.

---

## 4. Encoding logic duplicated inline in the contract test

`contracts/test/S3ntimentSurveyStore.test.ts` (L24–44), the exact inline block:

```ts
// Card / SMC helpers.
//
// registerInPool validates a card before joining:
//   messageHash = keccak256(abi.encodePacked(nullifier, "|", batchId))
//   ethSignedHash = keccak256("\x19Ethereum Signed Message:\n32" + messageHash)
//   signer = ecrecover(ethSignedHash, signature)  — must equal batchId
// The caller must be an SMC whose owner() is the respondent's pool-wallet EOA.
//
// We use a locally-owned batch wallet (privateKeyToAccount) and sign the exact
// 32-byte ethSignedHash digest so the recovered signer is deterministic.
// ---------------------------------------------------------------------------

function cardMessageHash(nullifier: string, batchId: string): `0x${string}` {
	return keccak256(
		encodePacked(['string', 'string', 'address'], [nullifier, '|', batchId]),
	);
}

function createBatchWallet(byte = 'aa') {
	// Fixed 32-byte private key → deterministic batch-wallet address.
	return privateKeyToAccount('0x' + byte.repeat(32));
}

async function signCard(
	batch: ReturnType<typeof createBatchWallet>,
	nullifier: string,
	batchAddress: string,
) {
	const messageHash = cardMessageHash(nullifier, batchAddress);
	const ethSignedHash = keccak256(
		concat([
			stringToBytes('\x19Ethereum Signed Message:\n32'),
			toBytes(messageHash),
		]),
	);
	return batch.sign({hash: ethSignedHash});
}
```

The contract it must satisfy — `contracts/src/S3ntimentSurveyStore/S3ntimentSurveyStore.sol`, `registerInPool` (L280+):

```solidity
bytes32 messageHash = keccak256(abi.encodePacked(nullifier, "|", batchId));
bytes32 ethSignedHash = keccak256(
    abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash)
);
address signer = _recoverSigner(ethSignedHash, signature);
if (signer != batchId) revert InvalidSignature();
```

**Does this exact logic exist in shared/frontend code that could be imported instead?** Not as a coherent, importable unit:
- The `messageHash = keccak256(encodePacked(nullifier, "|", batchId))` part is re-implemented in **two** frontend places (`invitation.factory.ts` via `encodePacked`, `card.factory.ts` via hand-rolled bytes) — both conceptually identical but neither shares code with the test.
- The **EIP-191 layering** is genuinely divergent: the test applies the `"\x19Ethereum Signed Message:\n32"` prefix **manually** then calls `sign({hash})` / `recoverSigner`; the frontends instead rely on viem `signMessage`/`recoverMessageAddress` to apply EIP-191. There is **no shared function anywhere** that produces the eth-signed digest or wraps raw signing — that logic exists only inline in the test.

So the entire card-digest + EIP-191 signing path is a perfect candidate for pattern (1): a `cardMessageHash(nullifier, batchId)` + `signCardMessage(...)` in `@s3ntiment/shared` that the test, the organiser `invitation.factory`, and the respondent `card.factory` all import.

---

## 5. Existing test harness glue + local Hardhat node

**Contracts (tests live here):**
- `contracts/package.json`: `"test": "hardhat test"`, `"test:watch": ...`, using `@nomicfoundation/hardhat-node-test-runner`, `@nomicfoundation/hardhat-viem`, `@nomicfoundation/hardhat-network-helpers`, `hardhat-deploy`, `earl` (assertions), `node:test` (`describe`/`it` imported from `node:test` in the test file). `contracts/hardhat.config.ts` wires these plugins. Tests use an in-process EDR-simulated network (`default: { type: 'edr-simulated', ... }`), so `hardhat test` needs no external node.

**Local Hardhat node is runnable from this repo:** `contracts/package.json` provides `"local_node": "ldenv -d localhost hardhat node"` (plus `deploy:dev`, `fork:*`). So an E2E seam test (pattern 2) could boot `hardhat node`, deploy via `hardhat-deploy`, and drive real `registerInPool` transactions — though note both frontends pin `base` for the RPC/chain (`ViemService(base, ...)` in both `services.ts`), so a local-node E2E would need a chain override / `localhost` RPC wiring.

**Frontends: no test harness exists.**
- `frontend-organiser/package.json` `test` → `echo "Error: no test specified" && exit 1`
- `frontend-respondents/package.json` `test` → same stub.
- **No `vitest`, no `jest`, no `@testing-library`, no `vitest.config.*`/`jest.config.*` anywhere** in the monorepo (verified by grep across `package.json`/`*.config.*`).

**Wallet connector glue (for E2E pattern 2):** both frontends use **viem + permissionless (ERC-4337)** for account/transaction plumbing and `@human.tech/waap-sdk` (`WaapService`) for wallet login/`createWallet`/`signMessage`; there is **no wagmi / \@reown\appkit / WalletConnect** in the source (the `@reown/appkit` build-allow entry in `pnpm-workspace.yaml` is a transitive dep, not used in code). Tests that want a "wallet connector" would realistically wrap the existing `PermissionlessSimpleService`/`PermissionlessSafeService`/`ViemService` from `@s3ntiment/shared` rather than an injected browser wallet.

---

## Recommended seam-coverage candidates (mapped to the report's open questions)

1. **Shared encoding package (highest leverage, addresses Q1/Q4).** Promote a pure module in `@s3ntiment/shared` (e.g. `shared/src/shared/invites/encoding.ts`) exporting `cardMessageHash(nullifier, batchId)` and an EIP-191 signing/`recover` helper. Import it from the contract test (`cardMessageHash`/`signCard`), from `frontend-organiser/.../invitation.factory.ts` (`generateCardSecrets`), and from `shared/.../card.factory.ts` (`encodeNullifierBatchCombo` → replace). This removes the duplication and the two divergent frontend implementations. Constraint: keep it `viem`-only and leaf-level (no Lit/Nillion/d3 deps) so both the hardhat node-test-runner and the Vite frontends can consume it.

2. **ABI snapshot test (addresses Q2).** Add a contract-side or repo-level check that the `abi` in `contracts/deployments/base/S3ntimentSurveyStore.json` (what the frontends import) matches the compiled artifact (e.g. `generated/abis/S3ntimentSurveyStore.js` / the artifact `hardhat compile` emits). Fails loudly if a frontend-consumed ABI and the tested ABI diverge. None exists today; the two pipelines (rocketh deploy-export vs. hardhat compile) are currently unverified against each other.

3. **E2E against local Hardhat node (addresses Q2/Q5).** Feasible via the existing `local_node` script + `hardhat-deploy`. The main friction is the frontends' hard-coded `base` chain and the waap/oprf + Lit + Nillion dependency stack, so a pragmatic seam E2E likely drives `Card.register`/`registerInPool` (and `registerBatch`/`createSurvey`) through the shared `PermissionlessSimpleService`/`ViemService` against a local RPC, reusing the shared card-encoding module, rather than driving the full browser UI.

**Files most relevant to the seam:** `contracts/test/S3ntimentSurveyStore.test.ts`, `contracts/src/S3ntimentSurveyStore/S3ntimentSurveyStore.sol`, `contracts/deployments/base/S3ntimentSurveyStore.json`, `shared/src/shared/invites/card.factory.ts`, `shared/src/shared/invites/types.ts`, `frontend-organiser/src/factories/invitation.factory.ts`, `frontend-organiser/src/factories/survey.factory.ts`, `frontend-respondents/src/controllers/auth-ctrlr.ts`, `frontend-respondents/src/auth.factory.ts`, `frontend-respondents/src/services.ts`.

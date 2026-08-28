# Findings: hardcoded pool constants on `2tokens` vs `main`'s scrambling commit

Read-only investigation of the s3ntiment monorepo (`~/code/s3ntiment`).
Branches: `2tokens` tip `4ab3ee677` (tracks `origin/2tokens`), `main` tip `01d95773b` (scrambling commit `4cf68f413`), `owned` tip `57d47fb9e`. Merge base of 2tokens/main = `a2d229b42`.

## (a) Hardcoded literals found on 2tokens (tip `4ab3ee677`)

**Pool-specific — all gated on the "MTE pool" `5f6b3f9b-5676-4927-b11a-0b1f02344cdf`:**

| Literal | file:line | What it is | Which pool |
|---|---|---|---|
| `5f6b3f9b-5676-4927-b11a-0b1f02344cdf` | `nillcc-backend/src/survey.ctrlr.ts:37` | poolId gate for the reuse-hack branch | MTE pool |
| `0x7598155069ba02e7dd87afc0c2b5e587b34b2379` | `nillcc-backend/src/survey.ctrlr.ts:38` | pkpId (hardcoded) | MTE pool |
| `22` | `nillcc-backend/src/survey.ctrlr.ts:39` | groupId (hardcoded) | MTE pool |
| `5f6b3f9b-5676-4927-b11a-0b1f02344cdf` | `frontend-organiser/src/controllers/survey.ctrlr.ts:322` | `const isMtePool = existing.pool === '5f6b3f9b-...'` | MTE pool |
| `0x7598155069ba02e7dd87afc0c2b5e587b34b2379` | `frontend-organiser/src/controllers/survey.ctrlr.ts:324` | pkpId fallback `?? (isMtePool ? '0x7598...' : undefined)` | MTE pool |
| `22` | `frontend-organiser/src/controllers/survey.ctrlr.ts:326` | groupId fallback `?? (isMtePool ? 22 : undefined)` | MTE pool |

The backend branch is explicitly labelled a specific-case hack:
- `nillcc-backend/src/survey.ctrlr.ts:31` — `// HACK: reuse existing Lit setup for MTE pool (5f6b3f9b-...)`
- `nillcc-backend/src/survey.ctrlr.ts:32` — `// TODO: proper existing-pool handling lives in the newer version`
- `nillcc-backend/src/survey.ctrlr.ts:42` — `throw new Error('No stored usage key for MTE pool — need to recover or re-seed');`

**Non-pool literals (general infra / dev scaffolding, not pool-specific):**
- `43a92ac7-7f7b-4b95-837a-6c1bd7da31af` — `shared/src/shared/nillion/nilldb.user.service.ts:154` — a hardcoded Nillion *collection* ID (not a pool)
- `5588b2f2645b47bf9d9df736ab328181` — `shared/src/shared/evm/chains.factory.ts:7` — Infura API key (sepolia RPC)
- `NFOkRqUo2swIC9g5tRJ7c` — `shared/src/shared/lit/actions/decrypt-for-owner.ts:3`, `decrypt-for-respondent.ts:15`, `decrypt.ts:4` — Alchemy API key inside Lit action code
- `0x609E288979c68d1486B600f82ea8E278B3e88148` — `protocol/scripts/delegate-user.ts:15`, `get-sponsored.ts:19`; `0x4101e21d...` — `protocol/scripts/fund-myself.ts:13` — dev-script addresses
- `683432d9-95b2-450a-9a5e-79913a7cb6ba.nillionusercontent.com` — `project.json:63` — demo deployment host

**Not found on 2tokens at all:** no hardcoded usage key (base64) in source, no DID strings, no Lit action CIDs. Usage keys are always fetched at runtime via `this.litPoolKeys.get(poolId)` (`nillcc-backend/src/survey.ctrlr.ts:40,130`).

## (b) `.data/pool-keys/*.json` analysis

- 31 files at `origin/2tokens`; the 2tokens diff (`a2d229b42..origin/2tokens`) adds exactly **6**: `40c9e539-…`, `4e83ca87-…`, `4fff81f7-…`, `53faa868-…`, `5b694aa1-…`, `aa56c582-…` (createdAt ≈ 1776704141373–1776710987768, i.e. the Apr-20-2026 dev session). The other 25 pre-existed at the merge base.
- Every file has the same shape — `{ "poolId": …, "pkpPublicKey": "<base64>", "createdAt": … }` — i.e. **PKP public keys**, not usage keys, not `0x…` pkpIds.
- **No file is `5f6b3f9b-…`**, and the hardcoded pkpId `0x7598155069…` appears in **none** of them.
- Consequence: the MTE pool's usage key is *not* committed anywhere on 2tokens — the code would have to fetch it at runtime and throws if missing (line 41-42). The 6 new files are just runtime artifacts of pools exercised during development, each with its own distinct PKP.

## (c) Verdict: built against one specific pool — yes

2tokens was developed/tested against a **single specific pool**, the "MTE pool" `5f6b3f9b-5676-4927-b11a-0b1f02344cdf`. The hardcoded pkpId `0x7598155069…` and groupId `22` are **conditional** on `poolId === '5f6b3f9b-…'` in both backend (`survey.ctrlr.ts:37-44`) and frontend (`survey.ctrlr.ts:322-326`); every other pool takes the general `else` path that creates a fresh PKP/group/usage-key. The code itself calls it a "HACK" for the MTE pool with a TODO pointing at "the newer version". The hardcode is a **specific-case shortcut, not general scaffolding** — it was introduced in `d2dfbfe11 patch` (Apr 20, 2026), and the frontend half in `a32d17286 aligning versions`. The "batch things" commits touch `batch.ctrlr.ts`/`survey.ctrlr.ts` but reference no pool UUID.

## (d) Exact overlap with main's scrambling hardcodes

Main (`01d95773b`) hardcodes the **same pkpId and poolId literals**, but promotes them to global/unconditional, and adds one usage key that **never existed on 2tokens**:

| Literal | On 2tokens | In main | Match? |
|---|---|---|---|
| pkpId `0x7598155069ba02e7dd87afc0c2b5e587b34b2379` | conditional, MTE branch only (`survey.ctrlr.ts:38`, frontend `:324`) | **unconditional** `const pkpId = "0x7598…"` in create (`nillcc-backend/src/survey.ctrlr.ts:29`) | **identical literal — main copied it and made it global** |
| poolId `5f6b3f9b-5676-4927-b11a-0b1f02344cdf` | MTE gate (`survey.ctrlr.ts:37`, frontend `:322`) | `main.ts:254` (still conditional usage-key fallback) + **unconditional** `const poolId = "5f6b3f9b-…"` frontend `survey.ctrlr.ts:189` (added in `45848834e import survey fix`) | **identical literal — same pool** |
| usage key `MCKlyMki/vKi2YvpWRoEmdROU+YFSR/aVNQJj9iVbEE=` | **absent** (not in source, not in any pool-keys file) | `main.ts:255` (conditional on MTE pool) + `survey.ctrlr.ts:35` (unconditional fallback in create) | **new on main** — first introduced in `45848834e`/`4cf68f413` |
| groupId `22` | hardcoded in MTE branch | not hardcoded (group concept dropped) | 2tokens-only |

So: main's scrambling copied **2 of 3** literals from 2tokens (pkpId `0x7598…`, poolId `5f6b3f9b-…`) and made them unconditional. The usage key `MCKlyMki/…` is **not** from 2tokens — it's the value 2tokens would have loaded at runtime from the never-committed `5f6b3f9b` pool-keys file; main hardcoded it as a fallback because that key was never stored in the repo.

## (e) Note on `owned` (`origin/owned`, tip `57d47fb9e`)

`owned` contains **none** of these hardcoded constants — no `0x7598155069…`, no `MCKlyMki…`, no `5f6b3f9b-…`, and no hardcoded pool UUIDs in source. It is the "proper existing-pool handling" design: `create` reads `pkpId`/`pkpDid` from `surveyConfig.config` and drives everything through a per-pool `NillionPkpClient` (`nillcc-backend/src/survey.ctrlr.ts:26-40`), fetching usage keys via `litPoolKeys.get(poolId)` (`main.ts:209,263`). It commits **150** pool-keys files (vs 31 on 2tokens), same `{poolId, pkpPublicKey, createdAt}` shape, no usage keys, and also no `5f6b3f9b` file. In short, `owned` is the clean, non-hardcoded version that 2tokens' TODO comment points to.

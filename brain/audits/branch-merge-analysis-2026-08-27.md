# s3ntiment monorepo — branch merge analysis & recommended strategy

**Date:** 2026-08-27 · **Mode:** read-only exploration (nothing edited, merged, or committed)
**Repo:** `~/code/s3ntiment` · `main` @ `01d95773b` ("brain implant", 2026-08-27), tracking `origin/main`

> Note: the working tree was *not* actually clean at exploration time — `brain/specs/SPEC-00-system-contract.md` is locally modified and `brain/audits/` is untracked. Both were left untouched.

---

## (a) Per-branch summary

| Branch | Tip | Unique commits (main..branch) | Merge-base w/ main | What it does | Files touched (key) |
|---|---|---|---|---|---|
| `owned` | `57d47fb9e` "work on website" (2026-05-05) | 12 | `93bdd732e` (on main) | **Owned-collections (DR-N2) + full website redesign.** A per-pool PKP becomes the Nillion builder/collection owner; users write their own records via PKP-issued delegations. | backend: `nillcc-backend/src/services/nildb.pkp.service.ts` (new), `nildb.builder.service.ts`, `pool.ctrlr.ts`, `survey.ctrlr.ts`, `main.ts`; shared: `nillion/{did.ts, delegations.ts(stub), nilldb.user.service.ts}`, `lit/actions/{owner-invocation.ts, user-delegation.ts, get-public-key.ts}` (new), `lit/lit.service.ts`, `waap.service.ts`, `survey/{queries.ts, tally.ts, collection.factory.ts, response.factory.ts, survey.factory.ts, types.ts}`; `frontend-respondents/*` (survey.ctrlr.ts, `pool.store.ts` new, storage/store); `frontend-organiser/*` (new.ctrlr.ts.ts, survey.ctrlr.ts, draft-survey-editor.ts); `website/*` (massive). **Deletes root `package.json`, `pnpm-workspace.yaml`, `project.json`, `README.md`, `dev.sh`, `FUNDING.json`.** |
| `2tokens` | `4ab3ee677` "aligning versions" (2026-04-21) | 19 | `a2d229b42` (on main) | **Batch survey/pool creation** ("batch things" ×11, "aligning versions" ×6). Batch invitation cards (QR/IPFS/URL), CSV/zip export, copy-link component, backend `/surveys` returns `pkpId/groupId`. Built on the **old SDK (secretvaults ^2.0.0, nilauth-client)**. | `frontend-organiser/src/controllers/{batch.ctrlr.ts(+166,new), survey.ctrlr.ts, new.ctrlr.ts.ts, pool.ctrlr.ts}`, `components/survey-forms/pool-form-batches.ts`, `factories/{invitation.factory.ts(new), survey.factory.ts}`, `state/{types.ts, ui.store.ts}`; `nillcc-backend/src/{main.ts, survey.ctrlr.ts, services/nildb.builder.service.ts}`, `docker-compose.yaml`, `.data/pool-keys/*.json` ×6; `shared/src/components/copy-link.ts` (new), `shared/{invites/types.ts, lit/lit.service.ts, nillion/nilldb.user.service.ts, survey/{survey.factory.ts, types.ts}}` |
| `quiz` | `ba32ce729` | **0** | — | — | Already fully contained in main (ancestor). Nothing to merge. |
| `chipotle` | `8cfd4e3c6` | **0** | — | — | Already fully contained in main (ancestor). Nothing to merge. |

Confirmed: `git rev-list --left-right --count main...origin/quiz` = `20 0` and `main...origin/chipotle` = `19 0`; both tips are ancestors of `main`.

### `owned` — commit-by-commit
`f393e62d4` stuck at pkp:key generation → `a398c0991` / `fe16132a8` tried delegation path → `64290f708` / `8482060f7` sourvereign collection creation → `40510b37e` writing works → `de1d762bf` / `57d47fb9e` work on website → `c94546d9a` hardened actions → `f0798583d` additive secret sharing → `9042516d3` movin config from survey to pool → `d0c70c8a6` **internal merge of `93bdd732e`** (a main-side commit) → `57d47fb9e` tip.

It is a coherent, largely-wired architecture (see §c) but ships debug remnants and a broken repo root (root `package.json`/`pnpm-workspace.yaml`/`project.json`/`README.md`/`dev.sh`/`FUNDING.json` are deleted in the tip commit).

### `2tokens` — commit-by-commit
`d2dfbfe11` patch → `7135a003b` + 11× "batch things" (`bc78bb78c` … `232b7bfd4`) → `0f786120b` ready → 6× "aligning versions" (`a32d17286` … `4ab3ee677`).

Self-contained batch feature; coherent but on the old SDK and old shared types.

---

## (b) Overlap / conflict analysis — owned vs 2tokens

**Bases:** owned↔2tokens merge-base = `a2d229b42` (2tokens' own base). owned's history **contains** `a2d229b42` and is based on the newer `93bdd732e`, which descends from `a2d229b42` and includes `06b71cbc3` "separating new pool from new survey" and `361e5db78` "upgraded to secretvaults 3.0". So **owned is based on a strictly newer base than 2tokens** and already carries the secretvaults 3.0 upgrade that 2tokens lacks.

**Overlapping files** (both branches change vs shared base, 19 files excluding `.data/pool-keys`):
- `frontend-organiser/src/controllers/{batch.ctrlr.ts, new.ctrlr.ts.ts, pool.ctrlr.ts, survey.ctrlr.ts}`, `components/survey-forms/pool-form-batches.ts`, `factories/{invitation.factory.ts, survey.factory.ts}`, `state/{types.ts, ui.store.ts}`
- `nillcc-backend/src/{main.ts, services/nildb.builder.service.ts, survey.ctrlr.ts}`
- `shared/src/components/{copy-link.ts, index.ts}`, `shared/src/shared/invites/types.ts`, `lit/lit.service.ts`, `nillion/nilldb.user.service.ts`, `survey/{survey.factory.ts, types.ts}`

**Do they collide?** Yes, semantically. Both rewrite `shared/src/shared/survey/types.ts` in incompatible directions: owned renames `Config` → `PoolConfig` (+`pkpDid`), moves `pkpId`/`groupId` out of `EncryptedConfig` into `Pool.config`, and adds `queryIds`/`createdAt`; 2tokens keeps `Config` and adds `pkpDid` + `delegation`. Both touch `survey.factory.ts` with different signatures (`fetchAndDecryptSurveyWithOwner(…, poolConfig, …)` vs `(…, pkpId?)`). Both touch `nilldb.user.service.ts`, `lit.service.ts`, and backend `survey.ctrlr.ts`/`main.ts`/`nildb.builder.service.ts`.

**Does merging one first help the other?** No — neither contains the other's changes, and both diverge from main on the same core files. Merging `owned` first (the newer architecture) makes `2tokens` *harder* to merge cleanly, because 2tokens' code targets the old `Config`/`config.config.pkpId` shape that owned removes; it becomes a port, not a merge. Merging `2tokens` first does not help owned at all.

---

## (c) Relationship to main's recent work (collisions)

Main-only vs owned (9 commits): `01d95773b` brain implant (docs only), `4cf68f413` **scrambling** (hardcoded `pkpId = 0x7598155069ba02e7dd87afc0c2b5e587b34b2379` + usage-key fallback `MCKlyMki/…` in the backend create path and in `survey.factory.ts`), `aff032107` internal deploy, `8eb57cda5` merge (huge — ~10M insertions, fonts/website + shared files), `3bfb4498b` / `c68b31e33` fonts folder + copy groups, `45848834e` import survey fix, `da36079ce` copy groups, `a417d5e29` patch. Main-only vs 2tokens additionally includes `93bdd732e`/`84b261e7c` pi agent adoptations, `361e5db78` secretvaults 3.0, `06b71cbc3` separating new pool from new survey.

**Files both sides changed (branch vs main):**
- `nillcc-backend/src/survey.ctrlr.ts` — main's scrambling hardcode vs owned's PKP `createCollection` vs 2tokens' MTE-pool HACK (2tokens introduced the very `0x7598155069…` pkpId that main later hardcoded globally).
- `nillcc-backend/src/main.ts` — PORT 8080 (main/2tokens) vs 8081 (owned); owned adds `/builder/register`, `/surveys/:id/delegation`, `/results`; main adds the scrambling usage-key fallback.
- `nillcc-backend/src/services/nildb.builder.service.ts` — main has SDK-3.0 `getInvocations`/`Builder.invocation()`; owned regressed to non-invocation calls; 2tokens is old nilauth style.
- `shared/src/shared/survey/types.ts`, `survey.factory.ts` — triple divergence (see §b).
- `shared/src/shared/nillion/nilldb.user.service.ts` — owned `storeOwned` grants the data ACL to `poolConfig.pkpDid`; main grants to `builderDid`.
- `shared/src/shared/lit/lit.service.ts` — owned rewrites `call()` with `withRetry`; 2tokens only comments logs.
- `frontend-organiser/src/controllers/{survey.ctrlr.ts, new.ctrlr.ts.ts}` — main's copy-groups/import-fix/patch vs owned's pool-config refactor vs 2tokens' batch flow.
- `shared/package.json` — secretvaults ^3.0.0 (main/owned) vs ^2.0.0 (2tokens).
- `website/*` — main's copy-groups + fonts styling vs owned's full redesign (opposite directions on `index.html`, `scss/*`, `assets/styles/*`, fonts).

---

## (d) Does merging `owned` resolve GAP-10?

**Yes — it delivers the DR-N2 owned-collections posture, and it is wired into the live paths.** Specifically:

- **Collection creation (owner = PKP, not builder):** `owned:nillcc-backend/src/survey.ctrlr.ts` `create()` calls `createSurveyCollectionSchema(safeConfig, "owned")` then `NillionPkpClient.createCollection(...)` → PKP-signed NUC invocation to `/nil/db/collections/create` (`nildb.pkp.service.ts`). This replaces main's `createSurveyCollection(id, schema, builderDid)` where `owner: this.builderDid!.didString` (the central-builder posture GAP-10 flags). It also creates an aggregation query (`createSurveyAggregationQuery`) per survey.
- **Pool setup:** `pool.ctrlr.ts` mints a PKP per pool, registers the `owner-invocation`/`user-delegation`/`get-public-key` Lit actions, creates group + usage key, returns `pkpId`/`pkpDid`; `registerBuilder()` registers the PKP as a Nillion builder (`/nil/db/builders/register`).
- **Data writes (user-owned, grantee = PKP):** `owned:shared/src/shared/nillion/nilldb.user.service.ts` `storeOwned()` → `user.createData({ owner: userDidString, acl: { grantee: poolConfig.pkpDid, read: true, write: false, execute: true } }, { auth: { delegation } })`. This is the **live respondent path**: `frontend-respondents/src/controllers/survey.ctrlr.ts` `setSurveyListener` signs `s3ntiment:submit`, fetches `/api/surveys/:id/delegation`, then calls `storeOwned(...)`.
- **Authorization inside Lit actions:** `owner-invocation.ts` verifies `isPoolSafe` + Safe `isOwner` before the PKP signs; `user-delegation.ts` verifies `isPoolMember` before issuing the write delegation.
- **Results:** `/surveys/:id/results` runs the PKP-owned aggregation query (`runQuery`/`readQueryResults` + `combineShares`).

**But it is partial / rough (not production-clean):**
- `shared/src/shared/nillion/delegations.ts` is **100% commented out** (stub).
- `config.nilDid` still points to the **central builder** (`this.nildb.builderDid.didString`) — mixed posture.
- `score()` still reads via the central builder (`nildb.exists`/`getResponseById`), not the PKP.
- `/surveys/:id/submit` route is commented out in `main.ts` (respondents write directly via the SDK).
- `nildb.builder.service.ts` on owned **regressed** to non-invocation SDK calls (main's version is more advanced); uses internal `Codec._unsafeDecodeBase64Url` in a debug method.
- Debug remnants: `testDelegationFormat`, `testDirectWrite` (raw POST to `/v1/data/owned`), commented blocks.
- The Lit actions hardcode an **Alchemy RPC URL + API key** in the deployed action source (secret exposure).
- **Root monorepo files deleted** (`package.json`, `pnpm-workspace.yaml`, `project.json`, `README.md`, `dev.sh`, `FUNDING.json`) — the repo root is broken on this branch.
- SDK: uses `@nillion/secretvaults ^3.0.0` (matches main — no SDK drift).

**Net:** owned is the real GAP-10 work — it actually delivers the owned-collections posture and wires it into create/submit/results — but it is a work-in-progress with a stubbed delegation helper, mixed builder/PKP references, debug code, and a broken repo root. It resolves GAP-10 only after cleanup.

---

## (e) Recommended merge plan

**Order: merge `owned` first, then port `2tokens`. Skip `quiz`/`chipotle` (already contained).**

1. **Merge `owned` into `main` first** — it is the GAP-10-relevant work and is on the same SDK (secretvaults 3.0) as main. Use `git merge --no-ff origin/owned` (a merge commit, **not a rebase** — owned has its own merge history `d0c70c8a6`; rebasing would rewrite and re-resolve it).
   - **Pre-step (mandatory):** restore the root files owned deleted — take main's `package.json`, `pnpm-workspace.yaml`, `project.json`, `README.md`, `dev.sh`, `FUNDING.json`. Otherwise the merge deletes the monorepo root and breaks the build.
   - **Expected conflicts (owned vs main):**
     - `nillcc-backend/src/survey.ctrlr.ts` (owned PKP create vs main's scrambling hardcode → resolve to owned, drop hardcoded `pkpId`/usage-key)
     - `nillcc-backend/src/services/nildb.builder.service.ts` (owned regressed vs main's invocation-based → port main's `getInvocations` style into owned's PKP flow)
     - `nillcc-backend/src/main.ts` (PORT 8081 vs 8080; owned's new routes vs main's scrambling fallback)
     - `shared/src/shared/survey/types.ts`, `survey.factory.ts` (owned's `PoolConfig`/`queryIds` refactor vs main's `Config` + scrambling fallback)
     - `shared/src/shared/nillion/nilldb.user.service.ts` (pkpDid grantee vs builderDid)
     - `shared/src/shared/lit/lit.service.ts` (withRetry rewrite)
     - `frontend-organiser/src/controllers/survey.ctrlr.ts`, `new.ctrlr.ts.ts` (owned pool-config flow vs main copy-groups/import-fix/patch; also reconcile `assert` vs `with` JSON imports — owned is inconsistent across its own files)
     - `shared/package.json`
     - `website/*` (heavy: `index.html`, `scss/*`, `assets/styles/*`, fonts — main and owned went opposite directions)
   - After the merge, retire main's scrambling hardcode (owned's per-pool `pkpId`/`pkpDid` makes it dead).

2. **Then port `2tokens` (batch feature).** A clean merge is **not** possible: 2tokens is on secretvaults ^2.0.0 + nilauth-client and the old `Config`-shaped types. Recommended: cherry-pick the batch-specific surface onto the merged main and adapt to owned's types (`PoolConfig`, `queryIds`, `pkpDid`): `frontend-organiser/src/controllers/batch.ctrlr.ts`, `factories/invitation.factory.ts`, `factories/survey.factory.ts`, `components/survey-forms/pool-form-batches.ts`, `state/ui.store.ts`, `shared/src/components/copy-link.ts`, `shared/src/shared/invites/types.ts`, `nillcc-backend/docker-compose.yaml`. **Skip** 2tokens' `nillcc-backend/src/{survey.ctrlr.ts, main.ts, services/nildb.builder.service.ts}` (superseded by owned's PKP flow and main's scrambling) and its `nilldb.user.service.ts`/`shared/package.json` (SDK 2.0). If full-merged anyway, expect conflicts on: `frontend-organiser/src/controllers/{survey.ctrlr.ts, new.ctrlr.ts.ts}`, `state/types.ts`, `ui.store.ts`, `nillcc-backend/src/{survey.ctrlr.ts, main.ts}`, `shared/src/shared/survey/{types.ts, survey.factory.ts}`, `lit/lit.service.ts`, `nillion/nilldb.user.service.ts`, `shared/package.json`.

3. **`quiz`/`chipotle`:** nothing to do — both are ancestors of main (0 unique commits). Optionally delete the local tracking branches.

---

## (f) Risks

- **Age / drift:** owned tip 2026-05-05, 2tokens tip 2026-04-21 vs main 2026-08-27 — 3–4 months. 2tokens predates main's secretvaults 3.0 upgrade, "separating new pool from new survey", and the pi-agent adoptations.
- **SDK incompatibility:** 2tokens pins `@nillion/secretvaults ^2.0.0` + `nilauth-client`; main/owned are on ^3.0.0. 2tokens' backend builder service cannot merge as-is.
- **owned's broken repo root** (deleted `package.json`/`pnpm-workspace.yaml`/`project.json`) — must be restored or the monorepo won't build.
- **Secret exposure:** owned's Lit actions hardcode an Alchemy RPC + API key; main's scrambling hardcodes a PKP id + usage key; both branches commit `.data/pool-keys/*.json` (runtime keys) to git.
- **Debug remnants** in owned (`testDelegationFormat`, `testDirectWrite`, commented-out `submit` route, `delegations.ts` stub, internal `Codec._unsafeDecodeBase64Url`).
- **Scrambling vs owned conflict of intent:** main's stopgap hardcode and owned's per-pool PKP flow are mutually exclusive; the merge must pick one (owned) and delete the other.
- **Big-history merge `8eb57cda5` on main** (~10M insertions, fonts/website) collides with owned's website redesign on the same `website/*` paths.
- **Hygiene (non-blocking):** `.pnpm-store` (70,852 files) is committed on both main and owned (identical content — no conflict) and is not gitignored; 2tokens lacks it (no conflict either way).

---

**Bottom line:** merge `owned` first (it is the GAP-10/DR-N2 deliverable, on the right SDK, but needs root-file restoration + cleanup), then port `2tokens`' batch feature by cherry-pick rather than merge. `quiz` and `chipotle` are already contained and require no action.

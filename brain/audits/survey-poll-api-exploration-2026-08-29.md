# Survey "what changed since X?" API — Exploration Findings (for mobile poll feature sizing)

**Date:** 2026-08-29
**Scope:** read-only exploration. No code/tests written. No PR opened. No state-modifying gates run.
**Repo:** `/home/joera/code/s3ntiment` (monorepo, pnpm workspace, git `main`).
**Grounding:** `nillcc-backend/src/*`, `contracts/src/S3ntimentSurveyStore/S3ntimentSurveyStore.sol`, `shared/src/shared/survey/*`, `frontend-respondents/src/*`, plus `brain/specs/SPEC-nillcc-backend.md`, `brain/specs/SPEC-contracts.md`, `brain/specs/SPEC-frontend-respondents.md`, `brain/specs/s3ntiment-survey-store-method-surface-2026-08-28.md`.

## Executive summary

There is **no list-surveys endpoint** and **no cursor/timestamp/`updated_since`/pagination** capability anywhere in the backend, contract, or frontends. A "given a cursor/timestamp, tell me what surveys are new/updated" endpoint **does not exist and would have to be added**. The only building block available today is a per-survey `createdAt` timestamp (block.timestamp, set once at create) plus an on-chain `getPoolSurveys(poolId)` that returns a raw, unordered `string[]` of survey IDs — and that function is **not wired to any HTTP route or any frontend**. The respondent app today can only open a *specific* survey whose id it already knows from a card/URL; it has no notion of "available surveys".

---

## 1. Where the backend API / contract / routes live

**Backend package:** `@s3ntiment/nillcc-backend` (`nillcc-backend/`), an Express API mounted under `/api`.
- Routes: `nillcc-backend/src/main.ts`
- Survey controller: `nillcc-backend/src/survey.ctrlr.ts`
- Pool controller: `nillcc-backend/src/pool.ctrlr.ts`
- Services: `nillcc-backend/src/services/nildb.pkp.service.ts`, `nildb.builder.service.ts`, `nillai.service.ts`
- Read-only chain client wrapping `getSurvey`: `nillcc-backend/src/contract.factory.ts`

**There is no OpenAPI / OpenRPC / contract / schema file for the HTTP API.** The de-facto contracts are:
- **On-chain Solidity** (the durable schema of truth): `contracts/src/S3ntimentSurveyStore/S3ntimentSurveyStore.sol`
- **Deployed ABI** imported directly: `contracts/deployments/base/S3ntimentSurveyStore.json` (imported in `main.ts`, `survey.ctrlr.ts`, `pool.ctrlr.ts`, `contract.factory.ts`)
- **TS data-model types:** `shared/src/shared/survey/types.ts` (`Survey`, `Pool`, `PoolConfig`, `EncryptedConfig`, `Batch`, `QuestionGroup`)
- **Specs:** `brain/specs/SPEC-nillcc-backend.md`, `brain/specs/SPEC-contracts.md`, `brain/specs/s3ntiment-survey-store-method-surface-2026-08-28.md`

**Exact Express route surface** (`nillcc-backend/src/main.ts`):
- `POST /pools` — l.70 (create pool / mint per-pool PKP)
- `POST /surveys` — l.82 (create survey)
- `GET /surveys/:id` — l.94 (get survey by id)
- `PUT /surveys/:id` — l.110 (update survey config / re-encrypt)
- `POST /surveys/:id/submit` — **commented out** — l.127 (dead standard-collection path)
- `POST /surveys/:id/score` — l.170
- `POST /surveys/:id/results` — l.204
- `POST /surveys/:surveyId/delegation` — l.226
- `POST /builder/register` — l.238
- `POST /lit/usage-key` — l.247

The `verifySignature` middleware (l.49) exists but is **not attached to any route** — each route does its own inline `verifyMessage` call.

## 2. Is there a method/endpoint to LIST surveys available to a respondent?

**No HTTP listing endpoint exists.** The only read route is `GET /surveys/:id` (by id), `nillcc-backend/src/main.ts:94` → `SurveyController.get` (`survey.ctrlr.ts:101`), which reads the on-chain `getSurvey(surveyId)`, fetches the IPFS config, strips `encryptedScoring`, and returns the respondent-safe payload. There is **no** `GET /surveys`, no `GET /pools/:id/surveys`, nothing membership-scoped, no "available to respondent X" concept.

The only primitive resembling a list is **on-chain, not HTTP** —
`contracts/src/S3ntimentSurveyStore/S3ntimentSurveyStore.sol:235`:
```solidity
function getPoolSurveys(string memory poolId) external view returns (string[] memory) {
    return poolSurveys[poolId];
}
```
This returns a raw array of survey IDs for a pool. Critically, **`getPoolSurveys` is not consumed anywhere** in the backend or either frontend (grep across the main tree matches only `contracts/test/S3ntimentSurveyStore.test.ts` and the generated ABI `contracts/generated/abis/S3ntimentSurveyStore.ts`). So even this primitive is orphaned — not exposed via any route.

There is also no "surveys visible/available to respondent X" surface — availability would have to be derived (e.g. from `isPoolMember`), and none of it is surfaced anywhere today.

## 3. Cursor / timestamp / updated_since / pagination support?

**None.** Explicitly:
- `GET /surveys/:id` takes an id path param, no query params, no filtering, no pagination.
- On-chain `getPoolSurveys(poolId)` takes only `poolId`, returns the full array with **no pagination, no ordering, no filter arg, no timestamp**.
- `getSurvey` returns a `createdAt` but there is no way to range/filter over it.
- No `cursor`, `page`, `offset`, `since`, `updated_since`, `created_after` anywhere in the request surface.

So a cheap "what changed since X?" poll endpoint **does not exist and must be added**.

What could be ADDED cheaply from existing raw materials (all currently unused by any route):
- A new route that wraps `getPoolSurveys` + per-id `getSurvey` (to read each `createdAt`), then filters `createdAt > T`. This is cheap (chain `view` reads only, no IPFS fetch needed to answer "what's new").

## 4. How the respondent frontend fetches surveys today

The respondent app does **not** fetch a list — it fetches one survey by id that it already knows from the scanned card / URL.

- Entry: `frontend-respondents/src/router.ts` routes `/surveys/:surveyId` (l.66–88) → `SurveyController`.
- `frontend-respondents/src/controllers/survey.ctrlr.ts`: `render()` (l.80+) calls
  `fetchAndDecryptSurveyWithRespondent(services, surveyStore, this.surveyId, this.poolConfig, BACKENDURL)` (l.85).
- That helper lives in `shared/src/shared/survey/survey.factory.ts:67`. **It does not call the backend `GET /surveys/:id`.** Instead it:
  1. Reads the chain directly via viem: `services.viem.read(..., 'getSurvey', [surveyId])` → `(ipfsCid, poolId, createdAt)` (`fetchSurvey`, survey.factory.ts:15);
  2. Fetches the `EncryptedConfig` JSON from IPFS by CID (`fetchSurveyAndParseCid`, survey.factory.ts:25);
  3. Fetches a Lit usage key from the backend (`fetchLitApiKey` → `POST /api/lit/usage-key`) and decrypts `encryptedForRespondent` (**Lit decrypt), returning `{ id, createdAt, ...decryptedConfig, ...config }` (survey.factory.ts:101–104).
- The local cache is `frontend-respondents/src/state/surveys.store.ts` (`SurveysStore`, keyed by surveyId, persisted to localStorage). It is a pure local cache — **no network list sync**. The root/survey entry gates resolve the pool from the chain via `fetchSurvey` (`router.gates.ts:47–87`).
- The only backend API calls the respondent app makes: `POST /api/surveys/:id/delegation` (`survey.ctrlr.ts:142`) and `POST /api/surveys/:id/score` (`completed-ctrlr.ts:70`), plus `POST /api/lit/usage-key` via shared `fetchLitApiKey`.

**Shape expected:** `Survey` — `shared/src/shared/survey/types.ts:87`:
```ts
export interface Survey {
    id?: string; pool?: string; title?: string; createdAt?: number;
    introduction?: string; groups?: QuestionGroup[]; batches?: Batch[];
    queryIds?: string[]; results?: SurveyResultsTally; isScored?: boolean;
}
```
plus the `EncryptedConfig` payload (`types.ts:75`: `surveyId`, `poolId`, `nilDid`, `encryptedForOwner`, `encryptedForRespondent`, `encryptedScoring`, `queryIds?`, `isScored`, `createdAt?`).

⚠ The spec (`brain/specs/SPEC-frontend-respondents.md`, GAP/PR #10 notes) flags a known chicken-and-egg: `render()` gates on `store.getSurveyData(...)` having a `pool` set, and the pool config only becomes known after decrypt — the first render can land in `renderWarning`. Also the `PoolStore` has no population callers, so `getPool()` returns `undefined` in practice.

## 5. Survey "new since cursor" signal (updated_at / published_at / created_at)

**The only timestamp on a survey is `createdAt`** (block.timestamp at creation). There is **no `updated_at`, `published_at`, `opened`, or `available` field** anywhere.

- On-chain model — `contracts/src/S3ntimentSurveyStore/S3ntimentSurveyStore.sol:67–71`:
```solidity
struct Survey {
    string ipfsCid;
    string poolId;
    uint256 createdAt;
}
```
`createdAt` is set to `block.timestamp` in `_recordSurvey` (sol:196–199).
- `getSurvey` returns `(ipfsCid, poolId, createdAt)` — sol:221–229.
- `updateSurvey` (sol:207–218) **only rewrites `ipfsCid`; it does NOT touch `createdAt`** ⇒ an edited/updated survey is not distinguishable from an unchanged one via this field. There is no edit timestamp at all.
- Pool also has `createdAt` (`Pool { safe, createdAt }`, sol:58–61), plus `getPool` (sol:243–251) and `getPoolBatches` (returns batch `createdAt`, `cardCount`) — sol:285–292.
- The IPFS `EncryptedConfig` and the TS `Survey`/`Batch` types carry an optional `createdAt` (`types.ts:84,91,106`) — populated from the chain `createdAt` at fetch time, not a separate source of truth.
- **No events are emitted by the contract** (stated in the contract header; method-surface spec §2: "arrays for listing. **No events emitted.**"). So there is no event log to tail for "new survey" — listing must read state (`getPoolSurveys`) and filter by a timestamp you add.

## 6. Existing notification / polling / sync code

**Essentially none for survey availability.** What I found:
- The only polling loop in the repo is `extractDeployedAddress` in `shared/src/shared/evm/contract-address.factory.ts:51` (`pollInterval = 3000`) — a **deployment wait** helper (waits for a contract to appear in internal txns), unrelated to surveys.
- `nillcc-backend/src/key.management.ts` — a **commented-out cron sketch** for usage-key rotation; no active code.
- `frontend-respondents/src/state/observable.ts`, `frontend-organiser/src/state/observable.ts` — client-side reactive `Observable` (subscribe/notify). In-memory/localStorage reactivity, **not** network polling or server sync.
- No service worker, no push notifications, no WebSocket, no background poll, no "new survey" sync anywhere in `frontend-respondents` or `frontend-organiser`.

---

## What EXISTS vs what would need to be ADDED (to size the feature)

**Exists today:**
- On-chain immutable survey record with `createdAt` timestamp (per-survey), readable via `getSurvey`.
- On-chain `getPoolSurveys(poolId) → string[]` list primitive (but orphaned — not exposed by any route, not consumed by any frontend).
- `GET /surveys/:id` HTTP (per-id, no filter).
- Respondent app that can decrypt one known survey by id.

**Must be ADDED for the polling design:**
1. A backend listing endpoint (new route, e.g. `GET /surveys?since=<ts>&poolId=...` or `GET /pools/:id/surveys`) that reads `getPoolSurveys(poolId)`, then per-id `getSurvey` to fetch each `createdAt`, filters `createdAt > since`, and returns the deltas. All cheap chain reads, no IPFS fetch needed for the "what's new" answer — good for a cheap poll.
   - Because the current contract has **no `updated_at`**, "new *and updated*" can only detect creations, not edits, unless a timestamp is added to the contract (`updateSurvey` currently only rewrites `ipfsCid`) or tracked off-chain (e.g. an indexer/DB recording its own `updatedAt` on `PUT /surveys/:id`).
2. A respondent notion of "which pools/surveys am I in" — currently the app only knows a pool via a specific parsed card/URL; there is no enumeration of a respondent's pools on the client (the `PoolStore` is populated nowhere per SPEC).
3. Cursor/pagination semantics on the new route (none exist today).
4. Client-side polling / schedule in the mobile/Tauri app (instant check + ~4h background poll) — no such loop exists in any frontend today; every fetch is one-shot on navigation.

**Key caveat to record for sizing:** because the contract emits no events and stores only `createdAt` (immutable), the "new since cursor" signal can be satisfied for *newly created* surveys using the existing `createdAt` field, but *updates* to an existing survey are currently invisible to any timestamp-based poll without a schema/contract change (add `updatedAt` on update) or an off-chain indexer that tracks mutation time.

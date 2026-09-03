# Create-a-Survey Flowchart (handleSurveySubmit)

> End-to-end sequence for creating a survey from the organiser frontend
> (`frontend-organiser/src/controllers/new.ctrlr.ts.ts` → `handleSurveySubmit`),
> with what each **nillcc-backend** call does spliced in. Focus is deliberately
> kept to the **Safe**, the **PKP / keys**, and the **on-chain transactions**.
> Validation, UI-step toggles and payload-shaping noise are omitted for
> readability — they are not the interesting part of this flow.

## Actors & keys

| Actor | Role | Key material |
|---|---|---|
| **Safe** (on-chain wallet) | The pool's owner wallet. Signs the authorization message and writes the on-chain txs. | EOA signer; `safeAddress`; `signature` = signed `"Request owner invocation"` |
| **PKP** (Lit Programmable Key Pair) | The pool's cryptographic identity, minted on Lit for a new pool. | `pkpId` (Lit address), `pkpDid` (`did:key` derived from the PKP public key) |
| **Lit group** | Binds the PKP together with the permitted Lit Action CIDs. | `groupId` |
| **usage_api_key** | Lit usage key scoped to the group; required to execute actions. Held server-side in the `litPoolKeys` map keyed by poolId. | — |
| **Invocation** | A per-nildb-node JWT minted by executing the owner-invocation action; used as bearer auth against that node. | — |
| **cid** | IPFS (Pinata) hash of the encrypted survey config; the on-chain pointer to the survey. | — |
| **queryIds** | Nillion aggregation-query ids returned by survey-create. | — |

## On-chain transactions (S3NTIMENT_STORE contract)

1. **`createSurvey(surveyId, poolId, "0", batchIds)`** — new pools only. Registers the pool and its batches on-chain before the builder registration.
2. **`updateSurvey(surveyId, cid)`** — all surveys. Persists the IPFS `cid` of the encrypted config; this is what `getSurvey` derefs later, so without it the survey is not readable.

## Flowchart

```
handleSurveySubmit (frontend)
event.detail.survey ───────────────► survey
        │
        ▼
surveyId = UUID ;  poolId = survey.pool ?? UUID ;  isNewPool = !survey.pool
        │
        ▼
┌────────────────────────── SAFE (owner wallet) ──────────────────────────┐
│  isNewPool?                                                            │
│    YES → Safe.connectToFreshSafe(poolId)        [ MINTS a fresh Safe ] │
│    NO  → Safe.connectToExistingSafe(store.pool.safeAddress)  [ reuse ]  │
│  signer    = Safe.getSignerAddress()                                   │
│  signature = Safe.signMessage("Request owner invocation")              │
└─────────────────────────────────────────────────────────────────────────┘
        │
        ▼
        ┌── isNewPool? ──┐
        │                │
       YES               NO ────────────────────────────────┐
        │                │                                  │
        ▼                │                                  │
 [NEW-POOL SETUP]        │                                  │
 POST /api/pools ────────┘                                  │
        │                                                   │
        ▼                                                   │
┌─ nillcc: PoolController.create ───────────────────────┐   │
│  • mint PKP                     → pkpId               │   │
│  • register Lit Actions (encrypt, decrypt-owner/      │   │
│    member, get-public-key, owner-invocation,          │   │
│    user-delegation)                                   │   │
│  • create Lit group (PKP + permitted action CIDs)     │   │
│                        → groupId                      │   │
│  • create usage_api_key, scoped to the group,         │   │
│    held in litPoolKeys[poolId]                        │   │
│  • execute get-public-key → publicKey → pkpDid        │   │
│  returns { pkpId, pkpDid, groupId }                   │   │
└───────────────────────────────────────────────────────┘   │
        │                                                   │
        ▼                                                   │
 create batches (one per survey.batch: createBatch)         │
        │                                                   │
        ▼                                                   │
 ★ ON-CHAIN: Safe.write createSurvey(surveyId, poolId,      │
            "0", batchIds)                        ★ TX #1   │
        │                                                   │
        ▼                                                   │
 POST /api/builder/register                                 │
        │                                                   │
        ▼                                                   │
┌─ nillcc: PoolController.registerBuilder ─────────────┐    │
│  for EACH nildb node (n1/n2/n3):                     │   │
│    • execute owner-invocation action                 │   │
│      → invocation (per-node JWT)                     │   │
│    • POST /v1/builders/register (pkpDid, name)       │   │
│      → PKP registered as a builder on the node       │   │
└──────────────────────────────────────────────────────┘   │
        │                                                   │
        ▼                                                   │
 store.addPool(poolId, safeAddress, batches, config)        │
        │                                                   │
        └────────────── both branches converge ────────────┘
                            │
                            ▼
             [SHARED SURVEY-CREATE]
             (runs for new AND existing pools)
                            │
                            ▼
                  POST /api/surveys
                            │
                            ▼
┌─ nillcc: SurveyController.create ─────────────────────────────┐
│  • requires poolConfig { pkpId, pkpDid, safe }                │
│  • usage_api_key = litPoolKeys[poolId]                        │
│  • createCollection: per-node invocation → POST /v1/collections│
│      → Nillion SecretVaults collection for encrypted responses│
│  • createQuery: per-node invocation → POST /v1/queries        │
│      → aggregation query → queryIds                           │
│  • Lit.encrypt config (usage key + pkpId):                    │
│      encryptedForOwner (with scoring) +                       │
│      encryptedForRespondent (stripped)                        │
│  • nildb.encryptToBuilder → encryptedScoring                  │
│  • build EncryptedConfig (survey, queryIds, nilDid=builder    │
│      DID, encryptedForOwner/Respondent, encryptedScoring)     │
│  • ipfs.uploadToPinata(config) → cid                          │
└───────────────────────────────────────────────────────────────┘
                            │
                            ▼
              cid = response ;  ipfs.isCID(cid) ?
                            │ yes
                            ▼
      ★ ON-CHAIN: Safe.write updateSurvey(surveyId, cid)   ★ TX #2
                            │
                            ▼
                   tx status == "success" ?
                 ┌────────────┴─────────────┐
               yes                          no
                 │                          │
                 ▼                          ▼
   add batches + survey to store    alert('create survey tx failed ' + txHash)
   navigate /batch/<pool>/<batchId> UI step → error
```

## Notes

- The **Safe** is the on-chain author of both txs and the signer of the
  `"Request owner invocation"` message that authorizes every backend call.
- For an **existing pool** no PKP/group/usage-key minting happens, and no
  `createSurvey` tx is fired — the flow goes straight from the Safe connect to
  the shared survey-create path (then `updateSurvey`).
- `updateSurvey` is the transaction that actually binds a survey to its
  encrypted config on-chain; `createSurvey` alone is not sufficient to make a
  survey readable.

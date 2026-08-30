# Nillion SecretVaults Ownership / Key-Rotation Research — RFC-001 Q1

**Date:** 2026-08-28
**Author:** research (DeepSeek V4 Flash 0731) for the s3ntiment project
**Status of RFC-001:** Draft — this report resolves **Q1 (blocking gate)**.
**Scope:** Does `@nillion/secretvaults` expose ownership-transfer / key-rotation for OWNED
collections, what DID methods Nillion SecretVaults uses and whether they support rotation, the
practical reassignment paths under the current owned-architecture, and a concrete recommendation.

**Conventions used in this report**
- **[VERIFIED]** — directly read from source code (repo, SDK, nilDB server) or official docs.
- **[INFERRED]** — a reasoned conclusion from verified facts, not directly stated in a doc.
- **[STALE/UNVERIFIED]** — a source that is outdated or that I could not confirm.

---

## 0. Headline verdict (Q1)

> **[VERIFIED]** `@nillion/secretvaults` (v3.0.0 — the version on the live owned path, and also on
> the GitHub `main` branch) exposes **no ownership-transfer or key-rotation API for owned
> collections**. The `_owner` of an owned document is set **only at creation** and is immutable.
> There is no `rotate`, `reassign`, `transfer`, or `changeOwner` method — on the SDK, on the HTTP
> API, or on the nilDB server itself. **Reassigning ownership is effectively delete + recreate.**
>
> Critically, this **does not block RFC-001**: the RFC needs to *move records from owner `E` to a
> new owner `D`*, not to mutate a single owner's key in place. Reassignment to a **new** owner DID
> is fully achievable via delete-under-`E` + recreate-under-`D`, which is exactly the pattern the
> repo's own `updateOwned` already performs. did:key immutability is not an obstacle here — see §4.

---

## 1. Q1 — Does the SDK expose ownership transfer for OWNED collections?

### 1.1 Enumerated SDK surface (user client — owned collections)

The user-data surface of `@nillion/secretvaults` is small and ownership-centric. [VERIFIED from
`dist/lib.d.ts` / `dist/lib.js` v3.0.0, and from the GitHub `NillionNetwork/secretvaults-ts`
`main` branch `src/user.ts` + `src/nildb/user-client.ts`]:

| Method (SecretVaultUserClient) | HTTP endpoint | Purpose | Mutates owner? |
|---|---|---|---|
| `createData(body, {auth})` | `POST /v1/data/owned` | Create owned doc(s); body carries `owner`, `collection`, `data`, `acl` | Sets owner **at create** only |
| `readData(params)` | `GET /v1/users/data/:collection/:document` | Read a user's doc | no |
| `listDataReferences()` | `GET /v1/users/data` | List user's owned docs | no |
| `deleteData(params)` | `DELETE /v1/users/data/:collection/:document` | Delete a user-owned doc (owner-scoped) | no (deletes) |
| `grantAccess(body)` | `POST /v1/users/data/acl/grant` | Grant a grantee read/write/execute on a **doc** | no (ACL only) |
| `revokeAccess(body)` | `POST /v1/users/data/acl/revoke` | Revoke a grantee's access on a **doc** | no (ACL only) |
| `readProfile()` | `GET /v1/users/me` | Profile | no |

The **builder** client (used for collections/queries/standard data) similarly exposes
`createCollection` / `readCollection` / `createCollectionIndex` / `dropCollectionIndex` /
`deleteCollection` / `createStandardData` / `findData` / `updateData` / `deleteData` /
`flushData` / `tailData` / query methods. **No collection-owner transfer** exists either; per the
docs, "Collections are immutable once created" and the only destructive collection op is
`deleteCollection`. [VERIFIED]

### 1.2 What the request bodies prove

- `CreateOwnedDataRequest` (zod): `{ owner: string, collection: uuid, data: array, acl: {grantee,
  read, write, execute} }`. `owner` is a plain string; there is **no** alternative owner field and
  no update path that changes it. [VERIFIED]
- `UpdateUserDataRequest` (the `users` update endpoint, `POST /v1/users/data`): `{ document,
  collection, update }` — updates **record fields only**. [VERIFIED]
- `GrantAccessToDataRequest` / `RevokeAccessToDataRequest`: `{ collection, document, acl|grantee }`
  — these modify a document's **ACL** (which grantee may read/write/execute), **not** `_owner`.
  [VERIFIED]

### 1.3 The nilDB *server* confirms it (not just the SDK wrapper)

The nilDB server source is public (`NillionNetwork/nildb`, `packages/api/src`). Its registered
routes are exactly: [VERIFIED from `data.router.ts` and `users.router.ts`]

- Data: `POST /v1/data/find`, `POST /v1/data/update`, `POST /v1/data/delete`, `DELETE
  /v1/data/:id/drop` (flush), `GET /v1/data/:id/recent`, `POST /v1/data/owned`, `POST
  /v1/data/standard`.
- Users: `GET /v1/users/me`, `GET /v1/users/data`, `POST /v1/users/data` (update fields),
  `GET/DELETE /v1/users/data/:collection/:document`, `POST /v1/users/data/acl/grant`, `POST
  /v1/users/data/acl/revoke`.

**There is no owner-transfer / rotate endpoint anywhere in the nilDB server.** Ownership is
assignable only at `POST /v1/data/owned` (create) and is otherwise immutable for the document's
life. [VERIFIED]

### 1.4 Ownership is enforced at the server, owner-scoped

Both `updateData` and `deleteData` in `users.controllers.ts` run through
`loadSubjectAndVerifyAsUser` + `requireNucNamespace(<user-namespace>)` and call
`DataService.updateRecordsAsOwner(...)` / `DataService.deleteDataAsOwner(...)` — i.e. the invoking
NUC `subject` must be the document **owner**. There is no "owner takeover" endpoint. [VERIFIED]

> **Q1 answer, precisely:** No native transfer/rotation. Ownership transfer = **delete under the
> old owner's key + recreate under the new owner's key**. That is precisely a client-side,
> multi-step, non-atomic operation (both keys live during the transition), matching the RFC's §6.2
> "harder, delete+recreate" hypothesis.

---

## 2. The DID-method question

### 2.1 What Nillion SecretVaults actually uses

- The nilDB **DID format is `did:key`** for builders, users, and nodes. Official key-concepts doc:
  "A unique cryptographic identifier for builders, users, and nodes. Format: `did:key:[...]`.
  Derived from public keys for verifiable authentication." [VERIFIED]
- The `@nillion/nuc` Signer/Did layer supports exactly three methods: **`did:key`** (default),
  **`did:ethr`** (from an EIP-1193 wallet / EIP-712 provider), and **`did:nil`** (legacy,
  `@deprecated ... Use DidKey instead`). NUC token `iss/aud/sub` accept only these three. There is
  **no** `did:jwk`, `did:pkp`, or `did:pkh` support inside NUC/nilDB token validation. [VERIFIED
  from `@nillion/nuc@2.0.1` `dist/lib.d.mts` and `dist/lib.mjs`]
- `Signer.fromPrivateKey(seed)` / `generate()` default to `did:key` — a bare private key always
  yields a `did:key`. `did:ethr` is only reachable via `Signer.fromEip1193Provider` (browser
  wallet) or `Signer.fromWeb3` (EIP-712 signer) — i.e. an on-chain wallet, **not** derivable from a
  WaaP-derived seed. [VERIFIED]

Consequence for s3ntiment: the per-pool **PKP owner DID** and each **respondent record owner DID**
are both `did:key` derived from private keys — the PKP via `publicKeyToDidKey(pkpPublicKey)`
(`shared/nillion/did.ts` + `pool.ctrlr.ts:70`), and each record via `Signer.fromPrivateKey` →
`getDid()`. [VERIFIED from repo]

### 2.2 Does a `did:key` owner support rotation? — no, by construction

`did:key` is a **self-verifying** DID method: the DID document is deterministically derived from
the public key, and the identifier *is* the key. The W3C-CCG did:key spec and the IETF
`draft-multiformats-didkey` define **no update/deactivate/rotate operation**; there is no
registrar or controller document to rewrite. Rotating the key produces a **different identifier**
(a new did:key). [VERIFIED at the spec level: did:key defines no update operation; the document is
a pure function of the key.]

- At the **conceptual layer** a did:key cannot "rotate in place" — you cannot keep the same DID
  string and swap the underlying key.
- At the **Nillion layer** this is compounded by §1: nilDB stores `_owner` as an immutable did:key
  string and has no `changeOwner`. So even if the *key* under a did:key were somehow replaced,
  the owner string would change and become a different owner anyway. **did:key immutability does
  not block reassignment; it only rules out in-place key swap for the same identifier.** [INFERRED,
  strongly supported by §1 + §2.1]

### 2.3 DID-method rotation comparison

| Method | Self-verifying / immutable? | Controller able to rotate? | Supported by NUC/nilDB? |
|---|---|---|---|
| `did:key` (s3ntiment's live owner/record DID) | Yes — identifier IS the key; **no rotation in place**; new key = new DID | No controller document | **Yes** (default; secp256k1) |
| `did:ethr` / `did:ethr:<addr>` | No — DID doc derived from an on-chain registry | Yes — registry owner/update keys can change the doc's keys (rotate/deactivate) | Yes (via EIP-1193 wallet signage only) |
| `did:jwk` | Yes — identifier = JWK thumbprint; no rotation in place | No | **No** (not in NUC) |
| `did:pkp` (Lit's PKP method) | No — identifier = PKP tokenId; authority managed via PKPPermissions contract | Partial — see §3.2 | **No** (not in NUC; s3ntiment synthesizes `did:key` instead) |
| `did:pkh` | No — resolves to an account on an underlying chain | Yes, via underlying chain's key rotation | **No** (not in NUC) |

[VERIFIED on support-column from NUC source; the *method-nature* column is standard DID-spec
knowledge. `did:jwk`/`did:pkh`/`did:pkp` rotation semantics are [INFERRED] from the respective
method specs, but their absence from NUC is [VERIFIED].]

---

## 3. Practical rotation paths under the owned architecture

### 3.1 Path A — Nillion-native reassignment: **does not exist** [VERIFIED, §1]

Closing out the RFC's hope of a native transfer: there is none on SDK, HTTP, or server. Delete +
recreate is the only Nillion-native mechanism.

### 3.2 Path B — PKP-based (does Lit allow reassigning a PKP's controller / rotating its key?)

- **What a PKP is here:** the per-pool PKP is the **collection builder/owner**. Its DID is
  synthesized as `did:key` from its secp256k1 public key (obtained via a Lit Action calling
  `Lit.Actions.getPrivateKey({pkpId})` and returning `wallet.publicKey`). So the "owner" that
  nilDB sees is a fixed did:key string for the PKP's lifetime. [VERIFIED from
  `shared/lit/actions/get-public-key.ts`, `shared/nillion/did.ts`, `pool.ctrlr.ts`]
- **Cannot rotate the PKP's underlying key:** a PKP's signing key is minted once (its `tokenId` is
  a function of the public key); there is no operation that mutates the key without changing the
  tokenId — which would be a *different* PKP and thus a *different* did:key owner. So PKP key
  rotation cannot help the nilDB owner layer. [INFERRED from PKP mechanics; consistent with Lit's
  design]
- **Can reassign *authority/controller*:** Lit's `PKPPermissions` contract governs *who/what may
  use* a PKP — `addPermittedAddress` / `removePermittedAddress`, `addPermittedAuthMethod` /
  `removePermittedAuthMethod`, and permitted Lit Actions with scopes. This **transfers operational
  control over the PKP**, not the key, and — decisively — it does **not** change the did:key owner
  string that nilDB recorded. [VERIFIED from the Lit `pkp-permissions` doc / PKPPermissions
  surface]
- **Conclusion for Path B:** PKP authority reassignment is real at the Lit layer but **irrelevant
  to nilDB record ownership**. Reassigning the PKP-controller does not move `_owner`. Not the
  mechanism RFC-001 needs. [VERIFIED for the nilDB-side irrelevance; the Lit layer itself is real]

### 3.3 Path C — ledger-side authority / delegation-driven reassignment: **already the live pattern**

The repo already reassigns in the sense that matters — *a different key owns the next copy of the
record*. The live write path is:

1. PKP (builder) issues a **write delegation** to the respondent DID: `getUserWriteDelegation(...,
   userDid, ...)` → `Builder.delegation().command('/nil/db/<collection>/data/create').audience(userDid)
   .signAndSerialize(pkpSigner)`. [VERIFIED from `nildb.pkp.service.ts`]
2. Respondent writes with `user.createData({ owner: userDidString, acl: {grantee: pkpDid, read,
   write: false, execute: true}, collection, data }, { auth: { delegation } })`. The SDK
   "invocation-from-delegation" is signed by the respondent's own signer, subject = respondent DID.
   [VERIFIED from `nilldb.user.service.ts` / SDK `getInvocationFor`]
3. `updateOwned` already does **`user.deleteData(documentId)` then `createData(...)`** in the same
   service. [VERIFIED from `nilldb.user.service.ts`]

**This is the delete+recreate reassignment primitive, already implemented and in the codebase.**
The only new wiring for RFC-001 persist is:

- issue the write delegation to **`D`** instead of / in addition to `E`
  (`getUserWriteDelegation(..., userDid=D, ...)`),
- `deleteData` E's owned docs (needs E's key — owner-scoped),
- `createData` as owner **`D`** with the same `acl` (grantee=PKP read/execute) so the PKP
  aggregation query still runs,
- then `rotateMember(poolId, D, sigFromE)` on-chain, then discard E — matching RFC §4.2 ordering.

No Nillion permission or new capability is required; it only needs both keys live at persist time,
which is exactly RFC §7's assumption. [VERIFIED on the mechanism; the RFC-specific sequence is
[INFERRED] from that mechanism]

### 3.4 What the collection owner (PKP) itself cannot do

- The PKP is a *builder*, not the record owner. Deleting a respondent's owned doc is owner-scoped
  (`deleteDataAsOwner`); the builder's filter-based `deleteData` is for the builder's own standard
  or as collection owner — it is not the record-owner reassignment path and there is no server
  route authorizing it for owned docs. The builder-level `flushData`/`drop` clears a whole
  collection — destructive, not a transfer, and not usable for a per-respondent persist. [INFERRED
  from the route/controller set in §1.3]

---

## 4. Concrete recommendation

**Verdict: delete + recreate, implemented client-side as an extension of the existing
`updateOwned` pattern. Do NOT pursue a native transfer (none exists), do NOT pursue PKP key
rotation (impossible + irrelevant), do NOT pursue the §10 fallback on Q1 grounds.**

Reasoning, with evidence:

1. **Q1 is resolved: "no native transfer, delete+recreate only."** (§1) The RFC's §6.2 "harder"
   hypothesis is confirmed — but it is the *only* path, and it is already proven in the repo via
   `updateOwned`.
2. **did:key immutability does not block** reassignment to a *new* owner DID. (§2, §3.3) RFC-001
   never rotates a single owner's key in place; it replaces owner `E` with owner `D`. That is
   delete+recreate, which nilDB supports. The earlier framing fear — "can a did:key owner ever
   rotate?" — is answered: it cannot rotate *in place*, but it does not need to.
3. **Both endpoints are did:key** (`E` and the WaaP-derived `D` come from
   `Signer.fromPrivateKey`), so no new DID method or Nillion-side change is required. [VERIFIED]
4. **Keep the ACL stable across reassignment** (grantee=PKP read/execute) so the PKP-owned
   aggregation query keeps working on the moved records. [INFERRED from the current ACL shape]
5. **Ordering is already decided by the RFC** (§4.2): nilDB reassign → chain `rotateMember` → never
   discard `E` until rotation confirms. This is resumable and matches the existing all-multi-step
   owned path. Nothing in this report changes §4.2.
6. **Dependencies to record for the RFC's change list:**
   - `getUserWriteDelegation` currently issues to the *current* respondent DID at answer time
     (§3.3). For persist it must issue a delegation to **`D`** (and the backend must authorize that
     with `sigFromE` over a challenge naming `D`, per RFC §11).
   - Reassignment is non-atomic on nilDB (delete then create) — the RFC's §4.2 ordering already
     makes this safe (no chain write until nilDB succeeds).
   - The existing GAP-10 note: user delegations are membership-checked in the `user-delegation`
     action; ensure the persist-time delegation for `D` is issued while `E` is still a member
     (i.e. before `rotateMember`), otherwise the membership check fails. [INFERRED — flag to the
     implementation; RFC §8.3 interaction]
7. **Recommendation on the §10 fallback:** Not needed on Q1 grounds. Q1 resolves to
   "delete+recreate, feasible." The §10 split (rotate chain key, wrap nilDB seed) remains a valid
   *fallback if* the multi-step nilDB reassign proves operationally fragile in practice, but Q1
   does not force it. The RFC should proceed on the delete+recreate path and keep §10 as a
   contingency, not the primary design.

---

## 5. Sources

**Original starting point**
- Nillion docs, "Key Concepts" (owned collections): https://docs.nillion.com/blind-computer/build/storage/key-concepts
  (source markdown: `NillionNetwork/nillion-docs`, `docs/blind-computer/build/storage/key-concepts.md`)
  — "DID ... `did:key:[...]`"; "Collections are immutable once created"; ACL "grant and revoke
  permissions at any time" (ACL, not owner). [VERIFIED]
- Nillion docs, SecretVaults SDK page: https://docs.nillion.com/blind-computer/build/storage/secretvaults
  (thin; links to GitHub + TypeDoc). [VERIFIED, thin]

**SDK / server source**
- `@nillion/secretvaults@3.0.0` (live path) — `dist/lib.d.ts` / `dist/lib.js`. [VERIFIED]
- `NillionNetwork/secretvaults-ts` `main` — `src/user.ts`, `src/nildb/user-client.ts`,
  `src/common/paths.ts`. [VERIFIED]
- `@nillion/nuc@2.0.1` — `dist/lib.d.mts`, `dist/lib.mjs` (Signer/Did methods, NUC token schema).
  [VERIFIED]
- `NillionNetwork/nildb` `main` — `packages/api/src/{data,users}/*.router.ts`, `users.controllers.ts`.
  [VERIFIED]

**s3ntiment repo (owned-collections merge)**
- `nillcc-backend/src/services/nildb.builder.service.ts` (builder/collection ownership),
  `nildb.pkp.service.ts` (NillionPkpClient: registerAsBuilder, createCollection, createQuery,
  getUserWriteDelegation, runQuery/readQueryResults), `pool.ctrlr.ts` (PKP did:key derivation).
- `shared/src/shared/nillion/nilldb.user.service.ts` (storeOwned / updateOwned / createData:
  delete+recreate), `shared/nillion/did.ts` (publicKeyToDidKey), `shared/lit/actions/get-public-key.ts`.
- `brain/specs/RFC-deferred-identity-persistence.md` (the RFC this answers).

**Lit**
- Lit `docs-v2` PKP Permissions Manager (`pkp-permissions.mdx`): `addPermittedAddress`,
  `addPermittedAuthMethod`, `removePermittedAuthMethod`, scopes — controller/authority management,
  not key rotation. [VERIFIED]
- PKP "no key rotation / tokenId bound to public key" claim: [INFERRED from PKP mechanics;
  the new developer.litprotocol.com docs did not surface a dedicated rotation page (only 36 URLs in
  its sitemap at research time) — `see STALE/UNVERIFIED note below`]
- `did:pkp` / `did:pkh` / `did:jwk` rotation semantics: [INFERRED from method specs; their absence
  from NUC is VERIFIED and is the point that matters here]

### Notes on doc freshness / unverifiable items
- The **live docs site** (`docs.nillion.com`) is client-side rendered; I read the underlying
  markdown from the `NillionNetwork/nillion-docs` repo. The key-concepts page is current and
  consistent with the SDK. [VERIFIED]
- The docs page marks Collection Explorer as not fully supporting owned collections — a tool
  limitation only, not an SDK one. [VERIFIED, tangential]
- The **new Lit docs** do not currently publish a dedicated "PKP key rotation" page; I could not
  verify a first-party statement on rotation either way. My conclusions about PKP rotation rest on
  (a) the well-established fact that a PKP `tokenId` is a function of its public key, and (b) the
  PKPPermissions surface being about *permissions/controllers*, not the key. Treat the exact
  rotation semantics as [INFERRED]; they do not affect the nilDB-side conclusion, which is
  [VERIFIED].
- The `did:nil` method is deprecated in `@nillion/nuc` (removal planned for 0.3.0) — irrelevant to
  s3ntiment, which uses did:key. [VERIFIED, noted for completeness]

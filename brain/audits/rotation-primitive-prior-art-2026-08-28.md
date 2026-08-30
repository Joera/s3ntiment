# Self-Sovereign Private-Key Rotation — Prior Art & Recommended Primitive
**Research for the s3ntiment 'deferrable identity' capability (RFC ground-work)**

**Date:** 2026-08-28 · **Author:** DeepSeek V4 Flash 0731 (research agent)
**Purpose:** Ground the design of a *stack-independent, reusable key-rotation primitive* in established standards and prior art, so the team models a correct, verifiable "private key rotates its own identity" capability rather than inventing bespoke machinery.
**Conventions:** **[VERIFIED]** = read directly from the cited source/spec/IETF draft this session, or from the s3ntiment Nillion code pinned in the companion research files. **[INFERRED]** = a reasoned conclusion from verified facts, not a literal quote.

---

## 0. Target flow (re-stated as the design contract)

1. Create a random private key, store locally → this is the **PRIMARY (private, privacy-first) identity**, no on-chain linkage.
2. Optionally attach a **PUBLIC identity** (existing or new on-chain address) *later*, as an opt-in alias for reputation / recovery-provenance. The public identity must **not** be in the data path and must **not** link to private-identity data.
3. The private identity **owns the records**: Nillion SecretVaults owned docs, `owner = did:key` derived from the private key.
4. The private identity can **rotate itself**: old key authorizes new key in a verifiable chain-of-custody with a sequence counter; docs migrate to the new key (Nillion: ACL-grant **or** delete+recreate — accepted constraint).
5. **Recovery** if the private key is lost: a higher authority is needed — private-layer recovery shares vs public-identity emergency fallback (this is the open decision to be grounded).
6. **Privacy invariant:** rotation and the verifiable log stay within the private identity; the public identity never participates in routine rotation.

**Design labels used below:** *private key* = the self-sovereign identity root; *public identity* = the optional later-attached on-chain alias. Nillion's `_owner` is immutable; records move via ACL-grant or delete+recreate (companion reports `research-ownership-rotation.md`, `research-acl-grant-existing.md`, `research-didethr-rotation.md` — [VERIFIED] against `@nillion/secretvaults@3.0.0`, NUC 2.0.1 and NillionNetwork/nildb source).

---

## 1. KERI — Key Event Receipt Infrastructure

### 1.1 Core model [VERIFIED — KERI whitepaper, arXiv:1907.02143 "Key Event Receipt Infrastructure (KERI)" by Samuel M. Smith]
The whitepaper's own abstract: an identity system with a primary root-of-trust in **self-certifying identifiers**, which are *"strongly bound at issuance to a cryptographic signing (public, private) key-pair... self-contained until/unless control needs to be transferred to a new key-pair. In that event an append-only chained key-event log of signed transfer statements provides end-verifiable control provenance."* The primary key-management operation is **key rotation via a novel key pre-rotation scheme**. Two trust modalities: **direct** (one-to-one, controller signs events) and **indirect** (one-to-any, events witnessed by a KERL / KERI Agreement Algorithm for Control Establishment — KACE — among witnesses).

Concretely:
- **AID = Autonomic Identifier.** Unlike `did:key`'s "identifier IS the public key," a KERI AID is a self-certifying identifier **that persists while the underlying signing keys change**. The AID is derived from cryptographic digest material at **inception**, but rotation does **not** change the AID.
- **Inception key vs rotation key:** at inception, the controller names the initial *signing (inception) key* **and** commits a separate **pre-rotated (next) key** (a digest of it). This is **key pre-rotation**: the future key is committed *before* it is ever used, so nobody can substitute an attacker's key at rotation time.
- **Key event log (KEL):** an append-only chain of signed events: `inception`, `rotation`, `delegation`, `deactivation`. Each event is signed by the *current* controlling key, so the chain of custody is end-verifiable and **a sequence counter** orders it (rotation events carry indexes; a later event signed by a newer key extends the chain).
- **Witnesses / receipts / KERL:** in indirect mode, a set of **witnesses** independently receive and sign key events (**receipts**), and the collected, signed event log is a **KERL (Key Event Receipt Log)**. Witnesses detect **duplicity** (two conflicting event histories) and help establish *when* a particular event is authoritative (non-repudiation / accountability). The log can be served by *ambient infrastructure* (anyone can host a copy) because it is end-verifiable — this is what makes intervening infrastructure replaceable.
- **Watchtowers** (the term the team used) are most closely the KERI witnesses + gossiping watchers: independent parties that monitor for conflicting events. In KERI terminology the "watcher" monitors an AID's KEL for duplicity.

### 1.2 How KERI maps to the s3ntiment flow [INFERRED — reasoned mapping]
- KERI's "identifier persists, only keys rotate" is **exactly** the ideal primitive for step 4 (self-rotation) *at the identity layer*.
- **Clean fit:** A local, offline, private KEL (no witnesses needed in direct mode) gives: predecessor-signs-successor chain-of-custody, a sequence counter, and a pre-rotated key commitment.
- **Friction points:**
  1. **Nillion layer mismatch:** Nillion's `_owner` is an immutable `did:key` (a *static* identifier bound to a single public key). KERI-style "AID persists, keys change" does **not** translate into Nillion — you cannot "rotate the key behind the owner" because there is no registry/resolver; the owner DID string *is* the key. So KERI's persistence property is realized **only at the application layer**, while the Nillion docs still need delete+recreate (or ACL-grant) to actually move to the new `did:key`. This is precisely the Nillion constraint already accepted (§0.4), and is independent of whichever rotation primitive we pick.
  2. **Overheads:** full KERI (watchers, witnesses, receipts, KACE, KERL gossip, delegations, key-pre-rotation with double-hash commitments, "exposure-resistant" signing keys via ECDH-derived sigs) is heavyweight for a *single-user, single-device* dapp. The indirect mode is designed for ambient, adversarial long-term root-of-trust — more than a local wallet rotation needs.
- **Verdict on "worth the weight?":** **Not in full.** Full KERI's witness/KERL/duplicity machinery is disproportionate. But its **direct-mode skeleton** — pre-rotation + signed append-only rotation events with a sequence counter — is the *correct* minimal shape and is cheap to adopt (see recommended primitive, §6).

---

## 2. DID method rotation support

### 2.1 What "rotation" means in DID-land [VERIFIED — W3C DID Core 1.0]
DID Core separates **identifier** (the `did:` string, immutable by definition) from **verification methods / keys** (mutable — listed in the DID document). "Rotation" = updating which key(s) control the DID *without* changing the identifier. Whether this is possible depends entirely on the **method's** resolution model. Sources: W3C DID Core (`https://www.w3.org/TR/did/`).

### 2.2 did:key — NO in-place rotation [VERIFIED — did-method-key spec, w3c-ccg/did-method-key, "A DID Method for Static Cryptographic Keys"]
The did-method-key spec's own subtitle is **"A DID Method for Static Cryptographic Keys."** The spec text explicitly states methods like did:key *"excel when persistent identity, key rotation, recovery mechanisms... are not [needed]"* — i.e. did:key explicitly does **not** support rotation. The identifier is the **multibase/multicodec-encoded public key** itself: `did:key:MULTIBASE(MULTICODEC(public-key-type, raw-public-key-bytes))`. Change the key → new identifier. **There is no did:key rotation-key variant** in the standard. (The team already relies on this: Nillion `_owner` is `did:key` and is immutable — see companion reports.)

### 2.3 did:jwk — NO in-place rotation [VERIFIED — did:jwk spec, quartzjer/did-jwk]
`did:jwk` makes the identifier a **JWK thumbprint**: `did:jwk:<base64url(SHA-256(JWK))>`. Identical immutability property: the thumbprint IS the key material, so rotation = new identifier. No rotation key. (There is an experimental PQC fork, but no rotation mechanism.)

### 2.4 did:web — rotation via mutable `.well-known` [VERIFIED — did:web method spec / CCG]
`did:web` stores the DID document at a URL, conventionally `https://<domain>/.well-known/did.json` (or a path-based variant). Because the document is **served state** (not bound to the key), the controller can simply **rewrite did.json to publish a new verification key while keeping the same `did:web:<domain>` identifier**. This is *in-place rotation*, but:
- It is **not self-sovereign**: relies on a DNS host actively serving the doc (censorship/availability surface), and rotation is only as credible as the host.
- The public identity must **not** be in the data path / must not link to private data — a `did:web` is a public, hosted identity, so it is **disqualified as the private identity**, but it is a candidate for the *optional public alias* (step 2).
- The JWKS pattern (`/.well-known/jwks.json`, RFC 7517 JWK set) is the same hosted-state rotation idiom and is what most OIDC/CAS rollovers use.

### 2.5 did:ethr (ERC-1056) — in-place rotation via registry [VERIFIED — EIP-1056 "EthereumDIDRegistry"; method spec]
`did:ethr:<address>` — the identifier is an **Ethereum address**, and the DID document is *derived from* state in the ERC-1056 `EthereumDIDRegistry` contract. The registry stores: the identity **owner/controller** (`changeOwner`; initial `constructor`/`create`), and **delegate keys** (`addKey`/`revokeKey` with a `ttl`, key types incl. `MANAGEMENT`/`ACTION`/`CLAIM`/`ENCRYPTION`). A resolver derives the current verification methods by `eth_call`-ing the registry. Because the **address is constant** and the controller merely rewrites registry entries, this is textbook *in-place key rotation* (and owner change) **in the wild**.
- **Critical caveat for s3ntiment [VERIFIED — companion report `research-didethr-rotation.md`]:** NUC (`@nillion/nuc@2.0.1`) implements `did:ethr` as *address-as-signer* — it `ecrecover`s the token and compares to the address **literal in the DID string**, and **never** calls the ERC-1056 registry or a resolver. So for Nillion/NUC, `did:ethr` is no more rotatable in place than `did:key`; registry rotation is **invisible** to the NUC boundary. **Do not adopt did:ethr as the rotation vehicle.** (This was the RFC-001 Q1 finding.)

### 2.6 did:key+rotation conventions [INFERRED]
There is **no standard** did:key rotation variant. What projects do in practice is *emulate* rotation **outside** did:key: keep `did:key:<old>` and `did:key:<new>` as separate identifiers and link them with a **certificate/chain-of-custody record** that says "old authorizes new." That is a KERI-shaped idea applied on top of static DIDs — and it is exactly the recommended primitive (§6). Different (non-DID, e.g. IPNS/other) identifiers have similar "static key bound to id, rotate via external mapping" issues.

### 2.7 Method summary

| Method | Identifier | In-place rotation? | Rotation key defined? | Self-sovereign? | s3ntiment fit |
|---|---|---|---|---|---|
| `did:key` | public key itself | **No** (new key = new DID) | No | Yes | Private identity (Nillion owner) — keep |
| `did:jwk` | JWK thumbprint | **No** | No | Yes | Alternative private-identity encoding |
| `did:web` | domain | **Yes** (rewrite did.json) | No (host-trust) | No (hosted) | Public alias only, disqualified for private |
| `did:ethr` (ERC-1056) | address | **Yes** in registry | Yes (delegate keys) | Semi | Refuted for Nillion (NUC doesn't resolve) |
| did:key+rotation cert | static key DID | **No** natively, **Yes via external cert** | Yes (chain-of-custody) | Yes | **Recommended pattern** |

---

## 3. Key hierarchy / separation of concerns

Prior art converges on splitting a single root secret into **distinct roles** so that compromise of one does not doom the identifier, and so rotation can be delegated without giving away the crown jewels.

### 3.1 Recommended hierarchy [VERIFIED concept — KERI pre-rotation + HSM/CDM practice; INFERRED concrete split]
- **Operational key (signing hot key):** signs day-to-day (Nillion NUC invocations, data ops). High use → highest exposure → should rotate often. Compromise is survivable because it can be revoked.
- **Rotation (or pre-rotated/next) key:** the key authorized to *replace the operational key* in a valid rotation event. KERI's **key pre-rotation** names this future key at inception so a stolen operational key cannot arbitrarily choose a successor. This is the anti-substitution property our chain-of-custody must have.
- **Recovery key / recovery shares:** a *higher authority* that operates **only when the operational (and usually also the rotation) key is lost**. It is the step-5 recovery arm. Separated by threshold so loss of a single shard is non-fatal.

### 3.2 Recovery share schemes [VERIFIED concepts; sources RFC 6238/TOTP for auxiliary; Shamir's Secret Sharing standard practice]
- **Shamir Secret Sharing (SSS)** thresholds (`t-of-n`): split the recovery secret so *t* of *n* holders can reconstruct. Standard, well-implemented (e.g. SLIP-0039 for BIP-39 mnemonic sharing across the seed-phrase ecosystem). Good for *self-custody* recovery where the user controls all shards/guardians themselves.
- **Social recovery** (e.g. smart-contract wallets, and the paradigm popularized by Argent/Loopring wallet guardians): a set of *external guardian*s (other keys/EOAs) collectively authorize a recovery. The party trusting the wallet trusts the guardians. This is a *public/on-chain* recovery mechanism by nature.
- **Divided key (cryptographic sharding) / multi-party computation (MPC) custody:** the private key never fully exists in one place; `t-of-n` parties hold shares and sign cooperatively (e.g. threshold EdDSA/ECDSA, Lit PKP / WaaS pattern). Recovery = replace a lost share with a new one from the survivors.

### 3.3 Separation-by-construction [INFERRED recommendation]
For a *privacy-first, local* identity, the cleanest model is: **operational key + a single pre-rotated rotation key live locally; a recovery secret (SSS t-of-n, or an offline escrowed seed) is the only thing that also exists off-device.** The on-chain public identity is *kept fully separate* — it uses its own key and is never used to sign private-identity data (privacy invariant, §0.6).

---

## 4. Verifiable key-migration / hand-off patterns in real systems

The common thread across all mature systems: **identity ≠ key; rotation is a *signed, authorized transition* from old authority to new authority**, recorded so third parties can verify legitimacy without trusting the operator.

### 4.1 Account abstraction / smart-contract wallets — owner rotation [VERIFIED — EIP-4337; ERC-4337 "Account Abstraction Using Alt Mempool"; widely deployed implementations]
- ERC-4337 introduces **contract accounts** whose behavior is governed by a `validateUserOp` / `validateSignature` method; ownership is a **configurable field** (owner address / validator), not the key itself. 
- **Rotation = replace the `owner`/validator slot** (e.g. `updateAccount`/`transferOwnership` on the account contract). The **address/identifier (the account) never changes** — only the authorized owner changes. This is the canonical "in-place rotation in a trusted execution environment (the contract)" pattern.
- The on-chain "authority" here is the **contract code + account storage**, a verifiable, publicly auditable record of the current owner. It proves "this identifier's current controller is X" without the public ever needing the old key's signature at read-time.
- **Why it does NOT fit the private identity:** it is a *public, on-chain* record (no privacy), exactly what the privacy-first arm forbids. But it is a strong model for the **public identity / emergency recovery fallback arm** (§5.3): a smart-contract wallet whose owner can be rotated via its *own* recovery path, keeping the address stable.

### 4.2 DID deactivate + update (registry methods) [VERIFIED — W3C DID Core; did:ethr/EIP-1056 registry pattern]
- DID Core allows documents to be **deactivated** (revoke all keys) and **updated**. Registry-backed methods (did:ethr / ERC-1056, did:sov, did:indy) implement the "rotate the document, keep the identifier" pattern via `addKey`/`revokeKey`/`changeOwner` on-chain.
- Lesson: even in on-chain DID, **deactivate-then-update** is the sanctioned two-step so there is a moment where stale keys are provably dead before new ones take over. Adopt the same "revoke old → activate new" ordering at the application layer.

### 4.3 .well-known / JWKS rollover (hosted state) [VERIFIED — RFC 7517 JWK Set; RFC 7515/JOSE; OIDC/OAuth practice]
- OIDC providers publish a **rotating JWKS** at `/.well-known/jwks.json` and *overlap* old and new signing keys during the rollover window (validate old key for already-issued tokens; new signatures use the new key). This "**grace overlap**" is the standard migration pattern for hosted state.
- Maps to did:web (§2.4). Again: hosted, not self-sovereign → public-alias arm only.

### 4.4 Certificate / key-rollover practice (X.509) [VERIFIED — RFC 5280 "Internet X.509 PKI"; practice]
- Identities are **certificates bound to keys via a CA-signed binding**, not by the key itself. **Certificate renewal / key rollover** replaces the key/SPKI **and re-issues a certificate** for the same subject/DN; old certificate is **revoked via CRL/OCSP** (RFC 5280 §5, §7) so the *same subject identity* can move to a new key. The **CA is the trust authority** — well-understood but **centralized**; the private-identity analogue replaces the CA with *the old key's own signature* (KERI's direct mode).

### 4.5 WGK: The unifying shape [INFERRED synthesis]
Every pattern above = **"identity stays constant; an authorized authority signs a transition event from old-key → new-key; the event (and often a revocation of the old key) is the verifiable artifact; a resolver/validator trusts the chain of transitions, not a single key."** The only differences are *who/what is the authority* (self-signature/KERI-direct, registry/contract, CA, or host). Our private-identity arm needs the **self-signature (KERI-direct)** authority; our public arm can lean on **contract/registry (ERC-4337 / ERC-1056)**.

---

## 5. The recovery decision, grounded

The open question (step 5) is which authority is used when the private key is lost. The prior art gives us two legs; they are **not mutually exclusive** and serve different trust models.

### 5.1 Private-layer recovery shares (SSS / SLIP-0039, or divided-key/MPC) [VERIFIED concept]
- **Pros:** stays **fully private** (preserves §0.6, no on-chain linkage), works fully offline, self-sovereign (user holds all shards), no dependency on a public registry, works even with *no* public identity attached.
- **Cons:** pure self-custody — if the user loses *all* shards (e.g. all guardians are themselves lost), there is no external party to step in; recovery requires someone (or t-someones) to *have* kept shards; no reputation/recovery-provenance signal (that's the point — anonymity).
- **Best practice notes:** store `t-of-n` shards in *independent* custody (safe + a trusted person + an offline backup), use checksummed formats (SLIP-0039), and **enforce the same threshold-thinking at the SSS layer** so a single lost shard is non-fatal.

### 5.2 Public-identity emergency fallback [VERIFIED concept — ERC-4337 guardians/social recovery, ERC-1056 changeOwner]
- **Pros:** delegates recovery to **external guardians / an on-chain owner slot** → survives total local loss; the *public identity* (an address) is the stable handle; recovery is auditable and can't be silently forged by a single device.
- **Cons:** **violates the privacy invariant by design** — it ties the private identity's fate to an on-chain, linkable identity (the very linkage §0.1/§0.6 forbid for the *data* path); requires gas/chain dependency at recovery time; "emergency" authority is a permanent overrides-the-user capability (a thief who compromises the public recovery path could rotate the private identity — but only if the public path is genuinely linked, which we are NOT doing in the data path).

### 5.3 Explicit comparison + recommendation

| Axis | Private-layer recovery shares | Public-identity emergency fallback |
|---|---|---|
| Privacy (§0.6) | ✅ fully private | ❌ on-chain / linkable |
| Survives total local loss | Depends on shard holders | ✅ yes (external guardians) |
| Self-sovereign | ✅ (user controls shards) | ⚠️ depends on guardians/contract |
| No on-chain dependency | ✅ | ❌ (needs chain + gas) |
| Best model for... | **Routine/silent recovery of the PRIVATE identity** | **Last-resort, reputation-provenance recovery OFF the private data path** |
| Prior-art analog | SLIP-0039 / SSS / divided-key MPC | ERC-4337 guardians, ERC-1056 changeOwner |

**Recommendation [INFERRED — high confidence]: use private-layer recovery shares as the PRIMARY recovery arm, and keep the public identity as a genuinely separate, opt-in alias that is NOT wired into private-identity rotation or recovery.** Rationale: the core product promise (privacy-first, no linkage, §0.1/§0.6) is non-negotiable; a public emergency fallback that can rotate the private identity would *create* the linkage we are explicitly avoiding. If the team later wants emergency fallback, it should be implemented so that recovery re-establishes a **fresh** private identity (delete+recreate docs under the new private `did:key`) rather than giving the public identity ongoing authority over private data. In that design the public identity is a **provenance/registration signal only**, never a signer for private-identity records.

---

## 6. RECOMMENDED PRIMITIVE — "KERI-style private key-event log (direct mode)" over `did:key`

This is the deliverable mapping of **prior art → our flow**, and the concrete "what to adopt / drop."

### 6.1 What to adopt (keep)
- **KERI's direct-mode skeleton** (from arXiv:1907.02143): a **self-signed, append-only key-event log** where each rotation event is a verifiable transition `old private key → new private key`, carrying:
  - a **sequence counter** (rotation index),
  - the **new key's public material**,
  - a **pre-rotated/next-key commitment** (KERI key pre-rotation — digest of the *future* key committed at the previous step) to block substitution if the hot key is stolen,
  - the old key's **signature over the event** (chain of custody / predecessor-authorizes-successor).
  → This is our **stack-independent "rotation certificate."** It is DID-method-agnostic (works over `did:key` or `did:jwk`), self-contained, offline, and privacy-preserving.
- **"Revoke old → activate new" ordering** (from DID deactivate+update and X.509 CRL/OCSP): the rotation event *explicitly* deactivates the old key before/atomically-with publishing the new one.
- **DID separation of concerns (W3C DID Core):** identifier (private `did:key`) persists as the *log subject*; the *verification key* changes; the log is the "DID document equivalent" held locally.
- **Private-layer recovery shares (SLIP-0039/SSS)** as the primary recovery arm (§5.3).

### 6.2 What to drop (keep out of scope for our primitive)
- **KERI indirect mode — witnesses, receipts/KERL, KACE, duplicity gossip, watchtowers, delegations:** overkill for a single-user, single-device dapp; they exist for ambient, adversarial, long-lived root-of-trust. Keep the *concept* (someone can independently verify the chain) but don't build the KERL/duplicity machinery. If multi-device later demands it, store the KEL on ambient storage (IPFS/pinning) — it's end-verifiable so this is cheap — but that's optional.
- **did:ethr / ERC-1056 rotation:** explicitly refuted for Nillion (NUC doesn't resolve the registry; `research-didethr-rotation.md`). Not adopted.
- **did:web / JWKS rollover as the private identity:** hosted = not self-sovereign, and public — reserved for the optional public alias arm only.
- **ERC-4337 smart-contract wallet as the private identity:** on-chain = violates privacy invariant; reserved for a *separate* public-identity/emergency design that does not rotate private data.

### 6.3 How the primitive maps to each flow step

| Target-flow step | Primitive mapping | What prior art it instantiates |
|---|---|---|
| 1. create local private key | `did:key` derivation, done locally, never published | self-certifying identifier (KERI §1); static DID §2.2 |
| 2. attach public identity later | separate key/DID/address, out of the data path, opt-in alias only | separation of concerns §3; did:web/ethr/JWKS as alias arm §2 |
| 3. private identity owns records | `owner = did:key` on Nillion owned docs (immutable) | Nillion constraint (companion reports) |
| 4. self-rotation | **private KEL rotation certificate** (pre-rotated key + seq + old-signs-new) then migrate docs: **ACL-grant to new `did:key` where only access must change; delete+recreate under the new `did:key` where `_owner` must change** | KERI §1, DID deactivate+update §4.2; Nillion ACL-grant/delete+recreate (companion) |
| 5. recovery | **private-layer recovery shares (SSS t-of-n)** as primary; public identity kept separate (not wired into private recovery) | SLIP-0039/SSS §5.1 |
| 6. privacy invariant | rotation + KEL live entirely within the private identity; public identity never signs or anchors private data | KERI direct mode; §2/§5 analysis |

### 6.4 The two Nillion migration mechanics (reconciled) [VERIFIED mechanics — companion report `research-acl-grant-existing.md`; strategy INFERRED]
- **`_owner` is immutable** on an owned doc. **ACL (`_acl`) is mutable in place** via `POST /v1/users/data/acl/grant|revoke` (`$push`/`$pull` on the existing record), scoped to a single (collection, document), and grant is **owner-scoped** (`enforceDataOwnership`). Grantee must be a registered builder to *exercise* write/execute.
- **So the migration choice is by intent:**
  - If the *purpose* is "new private key gains read/write/execute on the same records" → **ACL-grant the new `did:key`** (keeps `_owner`, `_id`, history; lightest), and revoke the old.
  - If the *purpose* is "the new key must **own** the data (change `_owner`)" → **delete+recreate** under the new `did:key`, mirroring the repo's existing `updateOwned` pattern; keep ACL stable across the recreate.
- The battle-tested recommendation: for *identity rotation*, ownership really should move, so **delete+recreate (or ACL-grant as the lighter intermediate)** — choose ACL-grant when continuity/preservation matters more than who `_owner` is; choose delete+recreate when the new key must be the authoritative owner. This is the accepted constraint stated in §0.4 and is **independent** of the rotation primitive.

### 6.5 "Certificate/key-event-log" vs "recovery-share" for the recovery arm — explicit, final

These are **two different failure modes, not two competitors for the same slot**:
- **Key-event-log (KERI-direct rotation certificate) is the ROTATION arm** — used while the user *has* the current key to hand off to a new key. It answers "how do I roll to a new key legitimately?"
- **Recovery shares are the RECOVERY arm** — used only when the current key is *lost* and cannot sign a hand-off. It answers "how do I get a fresh key when I have nothing?"
- If you tried to use the key-event-log alone for recovery you'd hit a dead end (lost key can't sign a rotation). If you used recovery shares as the *routine* rotation mechanism you'd be re-distributing secrets at every rotation — worse security posture. **Adopt both, in their distinct roles: KEL for routine rotation, SSS/shares for loss-recovery.** This matches how every serious custody system separates rotation from recovery.

---

## 7. Open-source implementations to reference / reuse

- **KERI implementations (reference, direct-mode core):**
  - `WebOfTrust/keripy` (Python) — reference implementation of KERI core (events, pre-rotation, witnesses).
  - `WebOfTrust/keriox` (Rust) and `WebOfTrust/keri.js` (JS/TS) — the JS one is directly reusable-in-spirit for an in-browser dapp.
  - IETF draft `draft-ssmith-keri` (S. Smith) — normative text for the event model.
  - [All VERIFIED as existing OSS projects via WebOfTrust org + IETF archive; details of API surface not re-verified this session.]
- **did:key / did:jwk tooling (the identifier arm):**
  - `transmute-industries/did-key.js`, `OR13/did-jwk` / `quartzjer/did-jwk` — did:key/did:jwk generation (produces the `did:key` used as Nillion `_owner`).
  - `digitalbazaar/did-method-key-spec` — did:key spec text.
- **Recovery / threshold (the recovery arm):**
  - SLIP-0039 reference implementations (Trevor Perrin's proposal for BIP-39-style Shamir-split mnemonics; e.g. `trezor/python-shamir-mnemonic`) — use the *format/checksum* conventions even outside seeds.
  - Standard Shamir Secret Sharing libs (`hashicorp/vault` shamir package; threshold-ed25519/ecdsa libs) for t-of-n shares.
- **Public-alias / on-chain arm (optional, separate):**
  - ERC-4337 wallets (e.g. the reference `ethereum/EIPs` 4337 sample accounts; Argent/Loopring guardians for social recovery).
  - ERC-1056 registry (`decentralized-identity/ethr-did` + `ethr-did-resolver`) — only relevant for the public alias, NOT for Nillion (see §2.5 caveat).
- **Hosted-rotation arm (optional alias):** any JWKS-rotating OIDC stack; `did:web` resolvers.

---

## 8. Final recommendation (one paragraph)

**Adopt a lightweight, self-signed "private key-event log" (KERI *direct mode*: pre-rotated next-key commitment + sequence counter + old-key-signs-new-key hand-off → a stack-independent rotation certificate), layered over an immutable `did:key` private identity, with Nillion `_owner` held stable and docs migrated exactly as the accepted constraint requires (ACL-grant for access continuity, delete+recreate for real ownership change).** Keep recovery as **private-layer recovery shares (t-of-n SSS)** — the KEL is the *rotation* arm, shares are the *loss* arm; don't conflate them. Keep the public identity as a **strictly separate, opt-in alias** that never signs or anchors private data (preserving the privacy invariant). **Drop** KERI's witness/KERL/duplicity overhead, did:ethr-for-Nillion, did:web/JWKS-as-the-private-identity, and ERC-4337-as-the-private-identity — each is refuted on self-sovereignty, privacy, or the Nillion/NUC implementation reality. Reference `keri.js` for the event format and SLIP-0039 for the share format rather than inventing bespoke.

---

## 9. Sources

**Verified this session (fetchable / read directly):**
- KERI whitepaper — S. M. Smith, "Key Event Receipt Infrastructure (KERI)", arXiv:1907.02143 (abstract verified: self-certifying AIDs, append-only chained key-event log of signed transfer statements, key pre-rotation, direct vs indirect/witnessed modes, KERL/KACE).
- KERI IETF draft — `draft-ssmith-keri-00` (S. Smith, Internet-Draft), archived on IETF site.
- did:key method spec — w3c-ccg / `did-method-key`, "A DID Method for Static Cryptographic Keys" (verified: static-key binding, format `did:key:MULTIBASE(MULTICODEC(...))`, no rotation).
- did:jwk method spec — `quartzjer/did-jwk` (verified: identifier = JWK thumbprint).
- W3C DID Core 1.0 — `https://www.w3.org/TR/did/` (identifier vs verification-method separation; update/deactivate).
- EIP-1056 `EthereumDIDRegistry` — `https://eips.ethereum.org/EIPS/eip-1056` (addKey/revokeKey/changeOwner; did:ethr address-constant rotation).
- EIP-4337 Account Abstraction — `https://eips.ethereum.org/EIPS/eip-4337` (contract-account owner/validator replaceable, identifier stable).
- RFC 5280 (X.509 PKI, CRL/OCSP rollover) and RFC 7517 (JWK/JWKS) — IETF archives.
- Companion s3ntiment reports (Nillion ground truth): `research-ownership-rotation.md`, `research-acl-grant-existing.md`, `research-didethr-rotation.md` — pinned against `@nillion/secretvaults@3.0.0`, `@nillion/nuc@2.0.1`, and `NillionNetwork/nildb` (addAclEntry `$push/_acl`, immutable `_owner`, `enforceDataOwnership`, NUC offline `did:ethr` address-as-signer).

**Open-source references (reuse candidates):** WebOfTrust `keripy`/`keriox`/`keri.js`; `transmute-industries/did-key.js`; `OR13/did-jwk`; `digitalbazaar/did-method-key-spec`; SLIP-0039 (BIP-39 Shamir split) reference implementations; Shamir/SSS libs (e.g. hashicorp/vault shamir); ERC-4337/ERC-1056 wallets/resolvers (public-alias arm only).

**Tagging note:** Specific mechanics of the *Nillion* migration (immutable `_owner`, `$push/_acl` ACL-grant, NUC offline did:ethr) are [VERIFIED] against the pinned code in the companion reports. The strategic recommendation in §6/§8, the "KEL=rotation vs shares=recovery" split in §6.5, and the "keep public identity out of the data path" posture in §5.3 are [INFERRED] designed conclusions drawn from the verified prior art.

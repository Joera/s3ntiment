# ERC-1056 / EIP-1056 `EthereumDIDRegistry` — Authority-Pattern Research for `S3ntimentSurveyStore`

**Scope & method.** This is a *borrow-the-authority-idiom, not adopt-the-standard* study. We do **not** adopt `did:ethr`; we mine the reference implementation's Solidity for the "who may act on behalf of an identity" idiom to inform our own `S3ntimentSurveyStore` guards.

**Sources read (actual Solidity / spec text):**
- [VERIFIED] `uport-project/ethr-did-registry` → `contracts/EthereumDIDRegistry.sol`, Solidity `^0.8.6`. This is the **canonical, deployed** reference implementation (spec-declared deployment `0xdca7ef03e98e0dc2b855be647c39abe984fcf21b`). Full source quoted below and used as the authority for every code claim. (Cloned full repo, `git log` confirms the delegate-based design back to the initial commit.)
- [VERIFIED] `ethereum/ercs` → `ERCS/erc-1056.md` (the merged, stagnated spec). Its "Implementation" section points to the repo above. The merged spec contains only interface signatures — **no** inline `keys`/`keyType` Solidity.
- [VERIFIED] Historical initial commit of the registry (`61044bd`, Solidity `^0.4.4`) for the `changeOwner` lineage.

---

## Critical framing correction (read first)

Several terms in the brief — `keys` mapping `identity -> key -> {purposes, keyType, revoked}`, key types **1/2/3/4 = MANAGEMENT/ACTION/CLAIM/ENCRYPTION**, `recoverAddr` / `ecverify` helpers, and a `_addDelegatedKey` flow — **do NOT appear anywhere in the canonical reference implementation or the merged ERC-1056 spec.** I searched the full git history of `ethr-did-registry`, the `ethr-did` JS repo, the merged `erc-1056.md`, and public code search; the only `EthereumDIDRegistry` that surfaces is the **delegate-based** one quoted below. [INFERRED] Those items belong to an *early EIP-1056 draft / uPort `keys`-lineage* that was superseded by the delegate model before the standard was merged. The reference implementation is the source of truth.

**Consequence for the team:** design the borrow against the **`owners` + `delegates` + `onlyOwner(identity,actor)` + `ecrecover` "signed-hash meta-authorization"** scheme that actually shipped. Do not port `keys`/`keyType` vocabulary that is not grounded in the real contract.

---

## 1. The `owner` storage + authorization pattern — THE pattern to extract [VERIFIED]

```solidity
mapping(address => address) public owners;                                   // identity -> current owner
mapping(address => mapping(bytes32 => mapping(address => uint))) public delegates; // identity -> delegateType -> delegate -> validTo (unix ts)
mapping(address => uint) public changed;                                     // identity -> last-change block
mapping(address => uint) public nonce;                                       // owner -> per-owner signature nonce

modifier onlyOwner(address identity, address actor) {
  require (actor == identityOwner(identity), "bad_actor");
  _;
}

function identityOwner(address identity) public view returns(address) {
   address owner = owners[identity];
   if (owner != address(0x00)) {
     return owner;
   }
   return identity;
}
```

**How the idiom works.**
- Every privileged internal-mutator takes an explicit `(address identity, address actor)` pair and is gated by `onlyOwner(identity, actor)`.
- `identityOwner` is the **self-sovereign default**: no entry in `owners` ⇒ the identity owns itself (`return identity`). This is what makes "any Ethereum address is already an identity" true and gas-free on creation.
- The **actor** (the `msg.sender` OR an ECDSA-recovered signer — see §4) is compared against `identityOwner(identity)`. That single comparison is the entire authorization gate.

This is the cleanest thing to lift: a per-identity "principal/authority" mapping with a *default-to-self* fallback, plus a modifier that checks "is the **actor** the authority for this identity", where `actor` can be supplied by either the transaction sender or a recovered signature.

---

## 2. `changeOwner` — how ownership actually moves (multi-method: self-call OR signed-hash) [VERIFIED]

The real contract has **two** public paths into one internal mutator, plus an internal `(identity, actor, ...)` variant shared by both. This is the "multi-method ownership" of the brief — but realized as **`msg.sender`-path + ECDSA-hash-path**, not via a `keys` mapping.

```solidity
function changeOwner(address identity, address actor, address newOwner) internal onlyOwner(identity, actor) {
  owners[identity] = newOwner;
  emit DIDOwnerChanged(identity, newOwner, changed[identity]);
  changed[identity] = block.number;
}

// Path A — self-call: actor = msg.sender
function changeOwner(address identity, address newOwner) public {
  changeOwner(identity, msg.sender, newOwner);
}

// Path B — signed meta-tx: actor = ecrecover(sig) over a hashed message
function changeOwnerSigned(address identity, uint8 sigV, bytes32 sigR, bytes32 sigS, address newOwner) public {
  bytes32 hash = keccak256(abi.encodePacked(bytes1(0x19), bytes1(0), this, nonce[identityOwner(identity)], identity, "changeOwner", newOwner));
  changeOwner(identity, checkSignature(identity, sigV, sigR, sigS, hash), newOwner);
}
```

**What authorizes the transfer:** the old owner — either because they are the actual `msg.sender`, or because they produce a valid ECDSA signature over a binding hash. Ownership moves by simply writing `owners[identity] = newOwner`. `changed[identity] = block.number` links the change (see §5, the resolver/history surface — we DROP it).

**The hash-authorization scheme (the deploy-agnostic gem) [VERIFIED]:**
```solidity
function checkSignature(address identity, uint8 sigV, bytes32 sigR, bytes32 sigS, bytes32 hash) internal returns(address) {
  address signer = ecrecover(hash, sigV, sigR, sigS);
  require(signer == identityOwner(identity), "bad_signature");
  nonce[signer]++;
  return signer;
}
```
Notes (all drawn directly from the code):
- Uses Solidity's built-in `ecrecover`; there is **no** bespoke `recoverAddr`/`ecverify` helper in this contract (contrary to the draft-only `ecverify` vocabulary). `ecrecover` zero-pads + compares against the expected owner — that *is* the "recover-and-compare" helper.
- The signed digest is namespaced by: `bytes1(0x19)` ‖ `bytes1(0x00)` (EIP-191) ‖ `this` (the registry address — replay-proof across deployments) ‖ `nonce[identityOwner(identity)]` (anti-replay, and keyed to the **owner's** nonce, not the identity's) ‖ `identity` ‖ the operation name ("changeOwner") ‖ the args.
- `nonce[signer]++` is the replay guard.
- Same pattern body-for-body is reused for `addDelegateSigned`, `revokeDelegateSigned`, `setAttributeSigned`, `revokeAttributeSigned` — one digest scheme, one `checkSignature`, N operations.

---

## 3. Keys vs. the actual `addDelegate`/`revokeDelegate` + expiry/revoke ordering [VERIFIED]

The brief asks for `keys` mapping + `keyType` 1–4 + `revoke-before-activate`. The **actual** shipped contract models authorities as **delegates keyed by a `bytes32 delegateType`, stored as an expiry timestamp**, with the "revoke = timestamp now" idiom. This is a one-line-each, storage-light design and is what you should copy.

```solidity
function addDelegate(address identity, address actor, bytes32 delegateType, address delegate, uint validity) internal onlyOwner(identity, actor) {
  delegates[identity][keccak256(abi.encode(delegateType))][delegate] = block.timestamp + validity;
  emit DIDDelegateChanged(identity, delegateType, delegate, block.timestamp + validity, changed[identity]);
  changed[identity] = block.number;
}
function addDelegate(address identity, bytes32 delegateType, address delegate, uint validity) public {
  addDelegate(identity, msg.sender, delegateType, delegate, validity);
}
function addDelegateSigned(address identity, uint8 sigV, bytes32 sigR, bytes32 sigS, bytes32 delegateType, address delegate, uint validity) public {
  bytes32 hash = keccak256(abi.encodePacked(bytes1(0x19), bytes1(0), this, nonce[identityOwner(identity)], identity, "addDelegate", delegateType, delegate, validity));
  addDelegate(identity, checkSignature(identity, sigV, sigR, sigS, hash), delegateType, delegate, validity);
}

function revokeDelegate(address identity, address actor, bytes32 delegateType, address delegate) internal onlyOwner(identity, actor) {
  delegates[identity][keccak256(abi.encode(delegateType))][delegate] = block.timestamp; // set validTo = now => no longer >= now+1
  emit DIDDelegateChanged(identity, delegateType, delegate, block.timestamp, changed[identity]);
  changed[identity] = block.number;
}
function revokeDelegate(address identity, bytes32 delegateType, address delegate) public {
  revokeDelegate(identity, msg.sender, delegateType, delegate);
}
function revokeDelegateSigned(address identity, uint8 sigV, bytes32 sigR, bytes32 sigS, bytes32 delegateType, address delegate) public {
  bytes32 hash = keccak256(abi.encodePacked(bytes1(0x19), bytes1(0), this, nonce[identityOwner(identity)], identity, "revokeDelegate", delegateType, delegate));
  revokeDelegate(identity, checkSignature(identity, sigV, sigR, sigS, hash), delegateType, delegate);
}

function validDelegate(address identity, bytes32 delegateType, address delegate) public view returns(bool) {
  uint validity = delegates[identity][keccak256(abi.encode(delegateType))][delegate];
  return (validity > block.timestamp);
}
```

**Expiry / revoke ordering idioms (real code, real semantics):**
- **Add** stores `validTo = now + validity` (TTL seconds).
- **Active** iff `validTo > block.timestamp`.
- **Revoke** overwrites `validTo = block.timestamp`, i.e. sets it to "now", so the `validity > block.timestamp` check flips to false *immediately* on the same block. There is no separate revoked-bit / struct-flag; **"revoked" and "expired" are the same state** — the timestamp being `<= now`. This naturally forces the "revoke-before-activate" ordering: an identity can hold at most one live delegate per `(delegateType, delegate)` and re-adding just extends `validTo`; to actively withdraw an authority you must call revoke (which timestamps it) rather than just adding a new one.
- `delegateType` is a `bytes32` purpose tag (the spec's doc examples: `did-jwt`, `raiden`). In the deployed model there is **no numeric keyType 1..4 and no purposes bitmask** — that richer `Key{uint256[] purposes; uint256 keyType; bytes32[] revoked;}` struct is the draft-lineage, not the shipped contract. [VERIFIED for absence in canonical source]

---

## 4. The "multi-method ownership / delegated change" authorization — actual form [VERIFIED]

The brief's `_addDelegatedKey`-with-`digest=keccak256(identity,newKey,...)` is realized in the shipped code as the `*Signed` family + `checkSignature`. The essential, transferable mechanism is:

> **An off-chain principal authorizes a registry mutation by ECDSA-signing a digest that binds `{this, nonce, identity, operation, args}`. The contract `ecrecover`s the signer, requires it to equal `identityOwner(identity)`, and treats the recovered address as the `actor` for the `onlyOwner(identity, actor)` gate.** This lets the true owner act without being `msg.sender` — the exact property we need for paymaster-relayed (DR-C6) registration in our contract.

Digest construction verbatim (from `addDelegateSigned`):
```solidity
keccak256(abi.encodePacked(
  bytes1(0x19), bytes1(0),        // EIP-191 prefix
  this,                            // registry address => replay-proof across deployments/forks
  nonce[identityOwner(identity)],  // anti-replay, owner-scoped
  identity,                        // which identity is being changed
  "addDelegate",                   // operation tag => prevents cross-operation signature reuse
  delegateType, delegate, validity // operation args
))
```
The same shape for every op; only the `"operation"` string and args differ. **No separate `recoverAddr` / `ecverify` — `ecrecover` inline.** (The `ecverify`/`recoverAddr` helper names are [INFERRED] draft-only; do not look for them in the real contract.)

---

## 5. BORROW vs. DROP for `S3ntimentSurveyStore`

### BORROW — authority handling
| Pattern | Real source line/function | Why it transfers |
|---|---|---|
| `authority/principal` mapping with **default-to-self** fallback | `owners` + `identityOwner()` | Our authority is a per-context principal; default-to-self gives gas-free/unregistered reads a sane default |
| Gate mutators by "is the **actor** the authority for this identity" | `modifier onlyOwner(identity, actor)` | The single reusable guard shape |
| **Actor = `msg.sender` OR ECDSA-recovered signer** — one guard, two auth paths | `changeOwner(identity,msg.sender,…)` vs `changeOwnerSigned` → `checkSignature` | Lets a paymaster relay our registration while the true principal's signature is what authorizes it (matches DR-C6) |
| `ecrecover`-to-determine-actor + compare, not any bespoke crypto | `checkSignature` | Minimal, auditable, dependency-free |
| Replay-proof signed digest: `0x19‖0x00‖this‖nonce‖identity‖op‖args` | all `*Signed` functions | Our signed registration payloads should bind `this`, a nonce, the context/leaf, and an op tag |
| Per-actor nonce increments on signature use | `nonce[signer]++` | Anti-replay for paymaster-relayed calls |
| Explicit authorization for every privileged call via the shared internal `(…, actor)` mutator | internal `changeOwner(…, actor)` / `addDelegate(…, actor)` | Single choke-point so no privileged path can bypass auth |
| **Timestamp-as-state**: active iff `validTo > now`; revoke = set `validTo = now` | `delegates` + `validDelegate` + `revokeDelegate` | Our leaf/nullifier liveness could use `validTo`-style semantics; **revoke-before-activate** ordering is exactly our nullifier-burn discipline |

### DROP
- **On-chain rotation ceremony** (`changeOwner`/`addKey`/`revokeDelegate` as a rotation method). We deliberately have none — rotation = off-chain re-derivation → re-register a fresh leaf. Do not port rotation semantics.
- **The DID-resolver surface** (`identityOwner()` used to build a DID document; `changed[identity]` block-linkage for event-walking history; `delegateType` did-jwt tags). Keyed to public DID documents; we DROP.
- **The `keys`/`keyType 1–4`/`purposes`/`Key{}` draft struct** — not in the real contract, and we don't need a typed-key model. [INFERRED]
- **`setAttribute`/`revokeAttribute`** — arbitrary public data blob on-chain; not our model.
- Public `owners`/`delegates` getters exposing identity graphs — keep our internal principal map hidden unless a read path requires it.

---

## 6. Concrete recommendation for `S3ntimentSurveyStore`

Adopt the **authority/idempotency spine**, not the registry surface:

1. **One guard, two auth paths.** Define `modifier onlyPrincipal(address context, address actor) { require(actor == principal[context], "bad_actor"); _; }` mirroring `onlyOwner(identity, actor)`. `principal[context]` defaults to self where a default is meaningful, mirroring `identityOwner()`.
2. **Prove actor via `ecrecover`.** A privileged store call (`registerLeaf`, paymaster-relayed) carries `(sigV, sigR, sigS, digest)`; recover → compare to the registered leaf's principal → set as `actor`. Copy `checkSignature` verbatim-shaped: `require(ecrecover(digest,…) == expected, "bad_signature"); nonce[recovered]++;`. **This is the DR-C6 paymaster pattern:** `msg.sender` is the paymaster/relayer, but the *true principal* is the recovered signer.
3. **Replay-proof digest.** Bind `keccak256(abi.encodePacked(bytes1(0x19), bytes1(0), address(this), nonce[principal], contextHash, "register", leaf, …))` — reuse the ERC-1056 namespacing exactly.
4. **Liveness as timestamp or nullifier.** If a leaf can be "rotated away" without on-chain rotation, model authoritative-liveness either as `validTo > block.timestamp` (add/revoke-by-`validTo=now`) or keep the **nullifier-burn** as the single permanent invalidation (revoke-before-activate ≡ a leaf is only ever live until its nullifier is spent). Given rotation = re-register, prefer **nullifier-burn as the only invalidation** and skip TTL entirely unless a time-bound membership is required.
5. **Minimal method surface** (rotation is off-chain, so this is all we need):
   - internal `_register(context, leaf, principal, actor)` gated by the actor check — registration is authorized by ECDSA, paid by paymaster.
   - internal `_spendNullifier(context, nullifier)` gated the same way (or by leaf possession).
   - `view isValidMember / isPoolMember` — pure reads, no auth (mirrors `validDelegate`).
   - No `changePrincipal`, no `revokeLeaf`-calls-it-rotation: changing authority is *re-derive + re-register a new leaf*, exactly the anchored-identity model. The only "authority-ish" write is `_register`, and even that is leaf/principal-binding, not key-rotation.

**Bottom line:** steal ERC-1056's **`identityOwner`-style default-to-self authority mapping + `onlyOwner(identity,actor)`-style gate + `ecrecover`-over-namespaced-digest actor resolution + nonce replay guard**, and drop everything that smells like on-chain key rotation or a resolvable public DID document. Our rotation stays entirely off-chain; the registry's *authorization idiom* is all we import.

---

### Appendix — verbatim notable snippets (canonical `EthereumDIDRegistry.sol`, Solidity ^0.8.6)

```solidity
modifier onlyOwner(address identity, address actor) {
  require (actor == identityOwner(identity), "bad_actor");
  _;
}

function identityOwner(address identity) public view returns(address) {
   address owner = owners[identity];
   if (owner != address(0x00)) {
     return owner;
   }
   return identity;
}

function checkSignature(address identity, uint8 sigV, bytes32 sigR, bytes32 sigS, bytes32 hash) internal returns(address) {
  address signer = ecrecover(hash, sigV, sigR, sigS);
  require(signer == identityOwner(identity), "bad_signature");
  nonce[signer]++;
  return signer;
}

function validDelegate(address identity, bytes32 delegateType, address delegate) public view returns(bool) {
  uint validity = delegates[identity][keccak256(abi.encode(delegateType))][delegate];
  return (validity > block.timestamp);
}

function changeOwner(address identity, address actor, address newOwner) internal onlyOwner(identity, actor) {
  owners[identity] = newOwner;
  emit DIDOwnerChanged(identity, newOwner, changed[identity]);
  changed[identity] = block.number;
}
function changeOwner(address identity, address newOwner) public {
  changeOwner(identity, msg.sender, newOwner);
}
function changeOwnerSigned(address identity, uint8 sigV, bytes32 sigR, bytes32 sigS, address newOwner) public {
  bytes32 hash = keccak256(abi.encodePacked(bytes1(0x19), bytes1(0), this, nonce[identityOwner(identity)], identity, "changeOwner", newOwner));
  changeOwner(identity, checkSignature(identity, sigV, sigR, sigS, hash), newOwner);
}

function addDelegate(address identity, address actor, bytes32 delegateType, address delegate, uint validity) internal onlyOwner(identity, actor) {
  delegates[identity][keccak256(abi.encode(delegateType))][delegate] = block.timestamp + validity;
  emit DIDDelegateChanged(identity, delegateType, delegate, block.timestamp + validity, changed[identity]);
  changed[identity] = block.number;
}
function revokeDelegate(address identity, address actor, bytes32 delegateType, address delegate) internal onlyOwner(identity, actor) {
  delegates[identity][keccak256(abi.encode(delegateType))][delegate] = block.timestamp;
  emit DIDDelegateChanged(identity, delegateType, delegate, block.timestamp, changed[identity]);
  changed[identity] = block.number;
}
```

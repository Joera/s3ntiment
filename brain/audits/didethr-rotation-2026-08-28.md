# did:ethr as an in-place key-rotation vehicle for s3ntiment Nillion SecretVaults (RFC-001 Q1)

**Date:** 2026-08-28
**Author:** DeepSeek V4 Flash 0731 (research for the s3ntiment project)
**Question:** Can s3ntiment's Nillion SecretVaults ownership-key-rotation problem be solved by
using a `did:ethr` owner (instead of the current `did:key`) that supports in-place key rotation?
The user's hypothesis: NUC's `did:ethr` method is registry-based (ERC-1056), so its identifier
(an address) stays constant while the controller rotates keys, enabling real in-place rotation
that `did:key` cannot.

**Headline verdict:** **The hypothesis is REFUTED as implemented.** NUC's `did:ethr` is *not*
registry-based ERC-1056 resolution — it is "address-as-signer" sugar that validates each NUC token
by `ecrecover`-ing the signer and comparing it to the static address **inside the DID string
itself**. NUC never contacts the ERC-1056 registry, never re-resolves a DID document, and — just
like `did:key` — pins the credential to the identifier. Rotating keys in an ERC-1056 registry has
**zero effect** on what NUC/nilDB accepts. **Do not adopt did:ethr for RFC-001.** (See §7.)

**Conventions:** **[VERIFIED]** = read directly from source / official spec. **[INFERRED]** = a
reasoned conclusion from verified facts.

---

## 1. did:ethr mechanics (ERC-1056) — the standard is registry-based, the NUC implementation is not

### 1.1 The standard method [VERIFIED — did-method spec level]
The `did:ethr` method (decentralized-identity `ethr-did-resolver`, "did-method-spec.md") defines
the identifier as an **Ethereum address**:

```
did:ethr:<address>
```

The DID document is **derived from state in the ERC-1056 EthereumDIDRegistry contract** at that
address: the identity **owner** (controller), plus **delegate keys** (`ADDDELEGATE`/`CHANGEDELEGATE`
with a `ttl`) and `CHANGEOWNER`. Crucially, the **identifier (address) never changes** — the
controller rewrites the registry (add/revoke delegate keys, change owner) to rotate the document's
verification keys **in place**. A resolver resolves the document by an `eth_call` to the ERC-1056
contract on some configured chain (ethr-did-resolver defaults to Ethereum mainnet; many networks
are supported).

So the *conceptual premise* — "identifier stays constant, controller rotates keys in a registry" —
is TRUE for the standard `did:ethr` method. This is the part of the hypothesis that is valid.

### 1.2 What NUC actually implements [VERIFIED — `@nillion/nuc@2.0.1` source]
NUC's `did:ethr` is a **trivial wrapper around an Ethereum address**. From `dist/lib.mjs`:

```js
//#region src/core/did/ethr.ts
function parse$2(didString) {
  const parts = didString.split(":");
  if (parts.length !== 3 || parts[0] !== "did" || parts[1] !== "ethr") throw new Error("Invalid did:ethr format");
  return { method: "ethr", address: getAddress(parts[2]), didString, toJSON: () => didString };
}
```

And the **entire** signature-validation for did:ethr (native path):

```js
async function validateSignature$2(did, message, signature) {
  return getAddress(await recoverAddress({
    hash: hashMessage({ raw: message }),
    signature: `0x${bytesToHex(signature)}`
  })) === did.address;
}
```

And the EIP-712 (wallet) path:

```js
async function validateEip712Signature(nuc) {
  const { payload, signature } = nuc;
  if (payload.iss.method !== "ethr") throw new Error(EIP712_INVALID_ISSUER);
  ...
  if ((await recoverAddress({
    hash: hashTypedData({ domain, types: ..., primaryType, message: valueToHash }),
    signature: `0x${bytesToHex(signature)}`
  })).toLowerCase() !== payload.iss.address.toLowerCase()) throw new Error(EIP712_INVALID_SIGNATURE);
}
```

There is **no** reference to a resolver, registry contract, RPC, `eth_call`, delegate key, TTL,
or DID-document anywhere in the NUC bundle. I grepped the entire `lib.mjs` for
`resolver|registry|contract|rpc|jsonrpc|eth_call|http|resolveDid|delegate|addKey|revokeKey|changeOwner`
— the only matches are unrelated (the word "delegate"/"registry" in unrelated contexts; no chain
interaction). **NUC performs no on-chain resolution whatsoever.**

**Consequence [VERIFIED]:** for NUC, `did:ethr:<addr>` means "the EOA whose address is `<addr>`
and whose **own private key** signs NUC tokens." Validation = `ecrecover` the token and check the
result equals the literal address in the DID string. There is no registry, no rotation key, no
third-party-authorization.

> **Why the user's hypothesis breaks:** ERC-1056's in-place rotation works *because the resolver
> reads the registry*. NUC **does not read the registry**. Therefore NUC's `did:ethr` is no more
> rotatable-in-place than `did:key` — both pin the credential to the identifier. `did:key` pins a
> **public key**; NUC's `did:ethr` pins an **address** (which is a function of a public key). In
> both cases changing the key forces a new identifier.

---

## 2. THE CRUX — does nilDB/NUC re-resolve did:ethr to current keys, or cache?

### 2.1 Answer (a): **No re-resolution, and no cache — validation is against the address literal in the token.**
[VERIFIED from NUC source; nilDB-server behavior [INFERRED] below]

The dispatch path is purely offline (from `dist/lib.mjs`):

```js
async function validateNucSignature(nuc) {
  switch (JSON.parse(base64UrlDecode(nuc.rawHeader)).typ) {
    case "nuc+eip712": await validateEip712Signature(nuc); break;
    default:          await validateNativeSignature(nuc); break;
  }
}
...
async function validateDidSignature(did, message, signature) {
  switch (did.method) {
    case "key":  return validateSignature$1(did, message, signature); // secp256k1.verify vs embedded key
    case "ethr": return await validateSignature$2(did, message, signature); // recoverAddress === did.address
    case "nil":  return validateSignature(did, message, signature);
  }
}
```

- The did:ethr DID object carries only `{didString, method, address}` — there is **no** place to
  store a resolved/cached public key (contrast `did:key`, which carries `publicKeyBytes`). The
  `DidEthr` type in `dist/lib.d.mts` confirms: `{ didString, method:"ethr", address, toJSON }`.
- Each invocation's signature is validated fresh by `recoverAddress` against that static address.
  It is neither "re-resolved to the registry" nor "cached from registration" — it simply recovers
  whoever signed **right now** and requires them to be the address.

**nilDB-server note [INFERRED, very high confidence]:** the nilDB server is Nillion's closed
source, but there is no mechanism by which it could do anything else: (1) it receives raw NUC
tokens from the SDK; (2) the SDK (`@nillion/secretvaults@3.0.0`) contains **no** resolver/RPC
code (grep for `resolver|registry|contract|rpc|eth_call` → zero hits) and simply submits the
owner as a DID **string** (`did: signer.getDid()`); (3) NUC is the only validation library in the
ecosystem and it is offline. The server therefore validates NUC tokens exactly as NUC does —
offline, against the address literal.

### 2.2 Answer (b): **Rotating keys in the ERC-1056 registry does NOT change what nilDB accepts.**
[VERIFIED for NUC; INFERRED for nilDB server]

Because NUC never queries the registry, a controller rewriting ERC-1056 (`addDelegate`,
`changeOwner`, etc.) changes **nothing** NUC/nilDB sees. NUC will only ever accept a signature made
by the private key of `did:ethr:<addr>`'s address itself. Registry-added delegate keys are never
consulted. **Registry rotation is invisible to the NUC/nilDB security boundary.**

To make *real* ERC-1056 in-place rotation work, the server would have to:
1. parse the `did:ethr`, then
2. `eth_call` the ERC-1056 contract (some chain) **per request** to resolve the current
   verification keys, then
3. check the token signature against those resolved keys.

**None of that code exists in NUC or the SDK.** And NUC does not even expose chain/RPC config for
resolution — it imports only `mainnet` from `viem/chains` and hard-defaults `chainId` to `1`
(`fromWeb3` options `chainId ?? 1`; `fromEip1193Provider` uses `options?.chain ?? mainnet`). So
even the *signing* side is Ethereum-mainnet-centric.

### 2.3 Chain / RPC dependency assessment
- NUC did:ethr **requires no live chain RPC** — because it does no resolution. This removes the
  "heavy dependency" concern but only because the feature is a no-op with respect to rotation.
- If one tried to bolt on the real ethr-did-resolver, the repo's **Alchemy base-mainnet key (Lit
  actions) is not usable**: NUC supports only `mainnet` by default (chainId 1), not base-mainnet,
  and base-mainnet would need a base-mainnet ERC-1056 deploy + live RPC per request. This is a
  network mismatch + new runtime dependency speculative, not present today. [VERIFIED on what NUC
  supports; the "would need" is [INFERRED]]

---

## 3. Viability of the PKP / respondent as a did:ethr owner

### 3.1 Construction constraints [VERIFIED — `dist/lib.d.mts` / `lib.mjs`]
`@nillion/nuc@2.0.1` `Signer`:

```
function generate(didMethod?: "key" | "nil"): Signer;
function fromPrivateKey(privateKey, didMethod?: "key" | "nil"): Signer;   // ONLY key|nil
function fromWeb3(signer: Eip712Signer, options?: { chainId?: number }): Signer;   // did:ethr (EIP-712)
function fromEip1193Provider(provider: EIP1193Provider, options?: {...}): Promise<Signer>; // did:ethr
```

- `fromPrivateKey` / `generate` accept **only `"key" | "nil"`**. There is **no** `"ethr"` value —
  so a bare private key (the WaaP-derived respondent seed, or the PKP's secp256k1 key) **cannot**
  produce a did:ethr signer.
- did:ethr is reachable **only** via a wallet-style signer that implements
  `getAddress()` + `signTypedData()` (EIP-712) — `Signer.fromWeb3` / `signer.fromEip1193Provider`.
  The resulting `getDid()` is `fromAddress(await signer.getAddress())`, i.e. the **wallet address**
  becomes the identifier.

### 3.2 Could the PKP's address be a did:ethr identifier? [INFERRED — technically possible but useless]
- The PKP is a secp256k1 keypair; Lit derives an Ethereum **address** per PKP. A
  PKP-adapted EIP-712 signer (`getAddress()` → PKP address; `signTypedData()` → PKP EIP-712 sign)
  would, in principle, let NUC's `validateEip712Signature` recover to that address and pass.
- **But this buys nothing for rotation:** the PKP is a plain keypair with no ERC-1056 registry
  behind it. Its address is a function of its fixed public key (PKP `tokenId` is bound at mint).
  There are no registry delegate keys to rotate. Wrapping it in `did:ethr` is pure label; NUC still
  requires the address's own key to sign, forever. Same pinning as `did:key`, plus an EIP-712-only
  signer constraint and an Ethereum-address identifier that doesn't match the repo's owner model.
- The respondent record owner is even less viable: it's `Signer.fromPrivateKey(seed)` →
  `did:key`. To make it did:ethr you'd need a wallet signer per respondent (WaaP seeds aren't
  wallets) — a non-starter.

### 3.3 s3ntiment's actual live owners [VERIFIED from repo]
- per-pool PKP owner: `publicKeyToDidKey(pkpPublicKey)` (`shared/nillion/did.ts`,
  `pool.ctrlr.ts:70`) → `did:key`.
- respondent records: `Signer.fromPrivateKey(seed).getDid()` (`nilldb.user.service.ts:30-32`) →
  `did:key`.
Both are `did:key`; they are submitted to `/v1/builders/register` / owned-doc create as did:key
strings, and the SDK stores `owner` as that string.

---

## 4. Trade-off comparison for RFC-001

| Path | In-place rotation? | NUC/nilDB support? | s3ntiment fit | Verdict |
|---|---|---|---|---|
| **`did:key` (current)** | No (new key = new DID) | Yes, default | Live, owner/record DIDs | Keep |
| **`did:ethr` with ERC-1056 registry rotation** | Yes *in the wild* | **No** — NUC does not resolve registry; rotation invisible | Would require bolt-on resolver + mainnet RPC + server changes | **Refuted for NUC** |
| **delete + recreate** (SDK `updateOwned` pattern) | Reassigns to a *new* owner DID | Yes, already proven in repo | Exact mechanism RFC-001 needs | **Recommended** |
| **ACL grant/revoke** | Doesn't move `_owner` (grantee access only) | Yes | Complementary, keep ACL stable across recreate | Supplementary |

**Recommendation [VERIFIED/INFERRED]:**
- **Do NOT adopt did:ethr.** NUC's did:ethr is address-as-signer, not ERC-1056 resolution, so it
  offers **no** rotation that `did:key` lacks. Adopting it would force wallet/EIP-712-only signers,
  introduce Ethereum-address identifiers and mainnet-only chain couplings, with a **zero** payoff
  for the actual RFC-001 need (reassign record ownership from `E` to `D`).
- **Stay on did:key + delete+recreate**, extended from the existing `updateOwned`: issue the write
  delegation to `D`, `deleteData` under `E`, `createData` as owner `D` with the same ACL
  (grantee=PKP read/execute), keep nilDB-first ordering per RFC §4.2, and hold `E` until chain
  `rotateMember` confirms. This needs no new DID method, no chain RPC, no server change.
- **did:ethr does not fix anything the RFC needs**; it only adds an Ethereum-address indirection on
  top of the same key-pinning.

---

## 5. DIRECT ANSWERS TO THE THREE SUB-QUESTIONS

**(a) Does nilDB re-resolve did:ethr each invocation, or cache?**
Neither. NUC validates every did:ethr token by `recoverAddress`-ing the signature and comparing it
to the **address literal embedded in the DID string / token payload**. There is no registry
resolution (per-invocation or otherwise) and no resolved-key cache; the `DidEthr` object holds only
`{didString, address}`. [VERIFIED NUC; server [INFERRED] to use the same offline NUC validation]

**(b) Is rotating keys in the ERC-1056 registry enough to change what nilDB accepts?**
**No.** NUC never reads the registry, so added/revoked delegate keys and `changeOwner` are never
consulted. nilDB will only ever accept a signature produced by the address's own private key.
Registry rotation is completely invisible to the NUC/nilDB security boundary. [VERIFIED NUC]

**(c) Is did:ethr a practical owner for the PKP / respondent in s3ntiment?**
**No.** did:ethr signers are constructible only from an EIP-1193/EIP-712 wallet (`fromWeb3` /
`fromEip1193Provider`); `fromPrivateKey`/`generate` only emit `did:key`/`did:nil`. A PKP could
technically be adapted to sign EIP-712 so its address passes NUC's check, but since there's no
registry behind a PKP, it yields no rotation and is pure overhead. WaaP-derived respondent seeds
cannot be did:ethr at all. [VERIFIED on constructor constraints; PKP-adaptation [INFERRED]]

---

## 6. Sources

- `@nillion/nuc@2.0.1` — `dist/lib.mjs`, `dist/lib.d.mts` (Signer.fromPrivateKey/generate/fromWeb3/
  fromEip1193Provider; `validateSignature$2` / `validateEip712Signature` / `validateNucSignature`;
  `DidEthr` type). [VERIFIED]
  Path (worktree): `.../node_modules/.pnpm/@nillion+nuc@2.0.1_.../node_modules/@nillion/nuc/dist/`
- `@nillion/secretvaults@3.0.0` — `dist/lib.js` (owner = `signer.getDid().didString`; SDK contains
  no resolver/RPC). [VERIFIED]
- s3ntiment repo — `shared/nillion/did.ts` (`publicKeyToDidKey`), `nillcc-backend/src/pool.ctrlr.ts:70`,
  `shared/nillion/nilldb.user.service.ts:30-32`, `nillcc-backend/src/services/nildb.pkp.service.ts`
  (registerAsBuilder / createCollection posting `did: <pkpDid>`). [VERIFIED]
- `ethr-did-resolver` did-method-spec (decentralized-identity/ethr-did-resolver
  `doc/did-method-spec.md`, referenced by NUC `lib.d.mts` line 22) and the ERC-1056
  EthereumDIDRegistry standard — for the *standard-level* (registry-based, address-constant,
  controller-rotates) properties. [VERIFIED at spec level]
- Prior RFC-001 research: `code/s3ntiment/brain/audits/ownership-rotation-research-2026-08-28.md`
  (delete+recreate path, no native transfer, did:key immutability). [VERIFIED]

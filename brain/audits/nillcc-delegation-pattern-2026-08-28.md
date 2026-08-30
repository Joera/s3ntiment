# nillcc Backend — nilDB Delegation Pattern & the Anchored-Identity Model

Repo: `~/code/s3ntiment` @ HEAD `bd9da7a48` (main). Scope: `nillcc-backend` + `@s3ntiment/shared`.
Marking: **[VERIFIED]** = read from code at HEAD; **[INFERRED]** = reconstruction/mapping.

---

## TL;DR — direct answers

1. **Where is the nilDB write delegation issued?**
   `NillionPkpClient.getUserWriteDelegation` (`nillcc-backend/src/services/nildb.pkp.service.ts:164`),
   reached via `POST /api/surveys/:surveyId/delegation` (`nillcc-backend/src/main.ts:226`) →
   `SurveyController.getUserDelegation` (`nillcc-backend/src/survey.ctrlr.ts:166`). It runs the
   **`user-delegation` Lit Action** (`shared/src/shared/lit/actions/user-delegation.ts`) which makes
   the **per-pool PKP** sign a single NUC delegation `{ iss: pkpDid, sub: pkpDid, aud: userDid,
   cmd: '/nil/db/data/create', pol: [], exp: now+3600 }`.

2. **Does it use the contract gate (isPoolMember)?**
   **YES, at HEAD — inside the Lit action, not the Express route.** The `user-delegation` action
   calls `poolContract.isPoolMember(poolId, userAddress)` on-chain **before** the PKP signs
   (`user-delegation.ts:44-50`). GAP-2's membership fix is **present at HEAD** (introduced in commit
   `c94546d9a "hardened actions"`; confirmed by `git log -S isPoolMember`). The Express route itself
   has **no** gate — the on-chain gate lives in the TEE action.

3. **Does it just follow a rotating stealth key?**
   **It follows the *current acting leaf* — yes, by construction.** Issuance is keyed to, and gated on,
   whatever leaf presents itself: the leaf's EVM address (`userAddress`) is what passes
   `isPoolMember`, and the leaf-derived Nillion DID (`userDid`) is the delegation's `aud`. Nothing
   pins the `aud`/recipient to a stable identity. **But** the write semantics bind docs to that
   specific leaf's DID (`owner: userDidString`), so a rotation that changes the leaf **does not** give
   the new leaf access to the *old* leaf's docs. The delegation only lets a member create **new**
   data in the collection — it never grants read/update of previously-owned docs.

---

## RQ1 — Where the delegation is actually issued

[VERIFIED] Route `main.ts:226-235`:

```ts
router.post('/surveys/:surveyId/delegation', async (req, res) => {
    const { userDid, signature, userAddress, poolId, poolConfig} = req.body;
    const { delegation } = await survey.getUserDelegation(signature, userAddress, poolId, poolConfig, surveyId, userDid)
    res.json({ delegation });
});
```

Note: the route passes `signature` and `userAddress` but performs **no signature/membership check at
the Express layer** — those are the action's job (RQ3).

[VERIFIED] `survey.ctrlr.ts:166-178` — forwards to the PKP client:

```ts
async getUserDelegation(signature, userAddress, poolId, poolConfig, surveyId, userDid) {
    const usageKey = await this.litPoolKeys.get(poolId);
    const survey = await fetchSurveyAndParseCid(..., surveyId);
    const nillPkp = new NillionPkpClient(this.lit, survey.poolId, poolConfig.safe!, contract)
    return await nillPkp.getUserWriteDelegation(signature, userAddress, surveyId, userDid, poolId, usageKey, poolConfig.pkpId!, poolConfig.pkpDid!);
}
```

[VERIFIED] `nildb.pkp.service.ts:164-186` — runs the action, returns the PKP-signed token:

```ts
async getUserWriteDelegation(signature, userAddress, surveyId, userDid, poolId, usageKey, pkpId, pkpDid) {
    const params = { signature, userAddress, pkpId, pkpDid, userDid, collectionId: surveyId };
    const code = compactAction(userDelegationAction(this.poolId, this.contract));
    const result = await this.lit.executeAction(poolId, code, params, usageKey);
    return { delegation: result.response.delegation };
}
```

[VERIFIED] **The signing happens in the Lit Action** `shared/.../lit/actions/user-delegation.ts`,
which builds and ES256K-signs the NUC token with the pool PKP's private key
(`Lit.Actions.getPrivateKey({ pkpId })`): `pol: []` and `exp: now+3600` (`:69-70`).

### ⚠ GAP-19 — the route is contract-mismatched at HEAD (live path throws)
[VERIFIED] The frontend sends **top-level** `pkpId`/`pkpDid` and **no** `poolConfig`
(`frontend-respondents/src/controllers/survey.ctrlr.ts:120-126`):

```ts
const args = { userDid, signature, userAddress, poolId, pkpId, pkpDid };
```

but `getUserDelegation` dereferences `poolConfig.safe!`, `poolConfig.pkpId!`, `poolConfig.pkpDid!`
(`survey.ctrlr.ts:177-178`). With `poolConfig === undefined` this throws `TypeError`, so at HEAD the
delegation endpoint is **structurally as designed** but **broken end-to-end in the actual frontend
call** (SPEC-nillcc-backend GAP-19 agrees). The membership gate and aud-binding are correct in code;
the wiring is not.

---

## RQ2 — What identity the delegation is bound TO and FROM

[VERIFIED] **FROM (iss / sub): the per-pool PKP DID** (`pkpDid`), a stable, pool-scoped identity —
the collection owner/nilDB builder. `user-delegation.ts:65-66`:

```ts
iss: pkpDid,
sub: pkpDid,
```

This is the same PKP that owns the pool's collection (`SurveyController.create` →
`NillionPkpClient.createCollection`, signed by the `owner-invocation` action; `pool.ctrlr.ts` mints
the PKP and derives `pkpDid` via `publicKeyToDidKey`). It does **not** rotate with any user.

[VERIFIED] **TO (aud): the caller's nilDB user DID** — derived from the caller's *stealth-leaf seed*.
Chain of derivation:
- `authenticate()` (`frontend-respondents/src/auth.factory.ts:6-12`): WaaP login → OPRF
  `getSecp256k1(input)` → `account.updateSignerWithKey(key)` — the **leaf private key**.
- `createNillDBSeed()` (`shared/.../permissionless.simple.service.ts:197-199`) = `keccak256(toBytes(signature)).slice(2)` where `signature = signMessage('Connect to blind computer for private responses')` signed by that same leaf. **The seed is deterministic from the leaf key.**
- `nillDB.init(seed)` (`shared/.../nilldb.user.service.ts:30-32`): `Signer.fromPrivateKey(seed)` →
  `userDidString = (await signer.getDid()).didString` — a `did:key`. This is `userDid`. [INFERRED]
  This is the "Stealth leaf" DID under the anchored model: context‑derived, unlinkable, per-leaf.
- Frontend sends `userDid: this.services.nillDB.userDidString` (`survey.ctrlr.ts:120`); the action
  puts it in `aud: userDid` (`user-delegation.ts:67`).

[VERIFIED] The **on-chain membership identity** is the leaf's EVM address
(`account.getSignerAddress()` = `privateKeyToAccount(key).address`), sent as `userAddress`
(`survey.ctrlr.ts:122`) and used by both `isPoolMember` in the action and the on-chain
`registerInPool` (`shared/.../card.factory.ts:76`, via `services.account.write`).

[VERIFIED] The **data owner** in nilDB is the same leaf DID:
`nilldb.user.service.ts:87-95` — `createData({ owner: this.userDidString, acl: { grantee: poolConfig.pkpDid, read:true, write:false, execute:true }, collection: survey.id, data:[...] }, { auth: { delegation } })`.
So docs are **owned by the leaf DID** and readable/executable by the pool PKP; the delegation (as
`aud`) authorizes the leaf to **create**.

---

## RQ3 — Contract gate before issuing; GAP-2 status at HEAD

[VERIFIED] **Yes — the contract gate (`isPoolMember`) is enforced inside the TEE action** at HEAD.
`user-delegation.ts:40-50`:

```ts
const poolContract = new ethers.Contract('${contract}',
    ['function isPoolMember(string poolId, address member) view returns (bool)'], provider);
const isMember = await poolContract.isPoolMember('${poolId}', userAddress);
if (!isMember) { return { error: 'Not a pool member' }; }
```

And `:29-34` verifies the submit signature recovers to `userAddress` first:

```ts
const signerAddress = ethers.utils.verifyMessage('s3ntiment:submit', signature);
const isValid = signerAddress.toLowerCase() === userAddress.toLowerCase();
if (!isValid) return { error: 'INVALID_SIGNATURE' };
```

**So the delegation issues to a member only**; a non-member gets `{ error: 'Not a pool member' }` and
no PKP signature. The Express route adds no gate of its own (defense-in-depth gap; a caller could
also not forge the leaf signature, and the membership is what the app trusts).

[VERIFIED] **GAP-2 status: RESOLVED in code at HEAD.** The legacy unscoped path
(`NilDBBuilderService.getUserWriteDelegation`, no policy) is commented out/dead (`SPEC-00` GAP-2,
`SPEC-nillcc-backend`; the old builder service methods are marked dead — GAP-18). The live path is
`NillionPkpClient.getUserWriteDelegation` → the membership-checked `user-delegation` action.
Introduced in commit `c94546d9a "hardened actions"` — the exact commit where `git log -S isPoolMember`
first touches the action file. **The register's claim that "the membership check is now inside the
user-delegation action after the owned-collections merge" is TRUE at HEAD.**

**Residual gap (not membership — scoping):** the delegation's `pol` is **empty** (`pol: []`,
`user-delegation.ts:69`). The write grant is a 1‑hour, collection-unrestricted `/nil/db/data/create`.
The collection is passed as `collectionId`/in `params` but is **not** bound into the token (`pol`),
so a member's captured delegation authorizes create in the collection scope whether or not
`pol` names it (empty = broadest). Not a membership hole, but wider than necessary; the action's own
comment (`.ts:18`) documents the restricted alternative `[['==', '.collection', id]]`.

---

## RQ4 — KEY: interaction with a rotating / re-derived stealth leaf

**Model reflected in the code: (a) — issuance follows whatever leaf presents itself.** It is *not*
pinned to a stable recipient identity:

- The recipient (`aud`) is recomputed per request from the leaf's seed in the browser
  (`survey.ctrlr.ts:110-126` → `userDidString` → `userDid`). Change the leaf → different seed →
  different `userDid` → different `aud`.
- The membership gate is the *current* leaf's EVM address (`isPoolMember(poolId, userAddress)`).
- The delegation is **short-lived** (`exp: now+3600`) and **re-requested every submission** — there
  is no persisted token pinned across sessions. [VERIFIED] `user-delegation.ts:70`; frontend fetches
  fresh each submit (`survey.ctrlr.ts:128`).

So at the *delegation-issuance* layer, there is **no stable anchor**: it keys purely to the acting
leaf. In that narrow sense the delegation "just follows a rotating stealth key."

**But the *ownership* layer does not rotate with it** — this is the real break:

- Docs are created with `owner: this.userDidString` = the **leaf DID**
  (`nilldb.user.service.ts:89`), and `createData` is authorized by a delegation whose `aud` is that
  same leaf DID.
- If a leaf rotates (re-derivation → new key → new seed → new `userDidString` and new EVM address),
  the **previous** docs remain `owner = old leaf DID`. The new leaf:
  1. is a **different nilDB DID** → not the owner, not in the old doc's `_acl` → cannot read/update
     its own prior answers (`getUserSurveyAnswers`/`readData` would fail or return nothing for it);
  2. is a **different on-chain address** → not yet a pool member → `isPoolMember` fails → it gets
     **no delegation at all** until it `registerInPool`s the new address.
  [INFERRED + VERIFIED mechanics]

**Consequence:** the delegation layer follows the leaf, but the data-owner DID does not. "Rotation"
in the current code is effectively **identity/credential submission under a new DID with no
continuity of owned docs** — there is no anchor linking leaves, and no handoff of prior docs to the
new leaf. The write delegation authorizes `/nil/db/data/create` only; it does **not** authorize the
read/update/grant paths that would let a rotated leaf take over its old docs (the `grantee`/`_acl`
mutation path exists in the SDK — see `acl-grant-existing-owned-docs-2026-08-28.md` — but is not
called anywhere in this flow).

---

## RQ5 — Right relationship under the anchored-identity model + recommendation

Anchored model (per the task framing): a durable, app‑independent **anchor** deterministically
derives per‑context **STEALTH leaves**; the **leaf** is what registers on‑chain and gates survey
access; **rotation = re‑derive a fresh leaf**; Nillion owned docs are owned by a `did:key` derived
from the leaf.

**Map current code onto it:** the leaf is genuinely the on-chain member *and* the seed source, and
`did:key` leaf-DID ownership already matches "docs owned by a did:key derived from the leaf." The
delegation is already keyed to / gated on the current leaf. So the *primitive* is right; what breaks
on rotation is **continuity of owned docs across leaves**.

### What to KEEP
1. **The `user-delegation` Lit Action / on-chain-gated PKP issuance.** PKP-as-`iss`, membership check
   inside the TEE, short expiry, per-request issuance. This is the correct security shape and
   satisfies GAP-2. Do not regress to an Express-layer gate or to a long-lived persisted token.
2. **Leaf-keyed `aud` + leaf-EVM `isPoolMember`.** Keep delegation bound to the *current* leaf — this
   is what makes the gate meaningful (a fresh leaf must register on-chain before it can write).
3. **Leaf-DID ownership of docs** (`owner: userDidString`, `grantee: pkpDid` ACL). Matches
   "docs owned by did:key derived from the leaf."
4. **Per-pool PKP as collection owner / nilDB builder** (the `owner-invocation` path in
   `createCollection`). Reuse this — it is the stable per-pool authority that does not rotate and
   that the leaf's docs are ACL'd to.

### What to CHANGE
1. **Scoping:** bind the collection into the delegation — replace `pol: []` with
   `pol: [['==', '.collection', <surveyId>]]` (the action's own documented option,
   `user-delegation.ts:18`). A member's leaked token then can't create into other collections.
2. **Rotation continuity of owned docs (the core fix).** Decide one of:
   - **(Preferred) Anchor the Nillion owner DID to the durable anchor, not the per-session leaf.**
     Under the anchored model, derive the nilDB `owner`/`aud` DID from the **anchor** (the stable
     identity that re-derives leaves), while the **on-chain member stays the current leaf** for gating.
     Then on rotation the new leaf still passes `isPoolMember` only after re-registering (keep that —
     it's the gate), but once in, its Nillion `owner` DID is the anchor, so it can read/update the
     anchor-owned docs. This is the "docs owned by did:key derived from the leaf" case where "leaf"
     is interpreted as the anchor-derived persistent DID, not the throwaway per-context signing key.
   - **(Alternative) Leaf-per-doc + handoff.** Keep leaf-as-owner but on rotation issue an ACL grant
     (SDK `grantAccess`, `/v1/users/data/acl/grant`, command `/nil/db/users/update`) from the old leaf
     to the new leaf, so the new leaf gains read/write over the old leaf's docs. Requires a delegation
     (or owner invocation) covering `/nil/db/users/update` — the current delegation only authorizes
     `/nil/db/data/create`, so it would need extension.
   - In both cases, **fix GAP-19** first: the delegation route is currently un-wired
     (`poolConfig` vs top-level `pkpId`/`pkpDid`, `survey.ctrlr.ts:177-178` vs
     `frontend-respondents survey.ctrlr.ts:120-126`), so the intended membership-gated issuance never
     actually executes in the live flow.

**Bottom line for the anchored model:** the delegation layer should **keep following the current
leaf** (`aud` = that leaf's DID, gated by that leaf's `isPoolMember`) — that's already what the code
does and it's correct. What must change is that **access to prior docs is keyed to the leaf-as-owner**;
add either anchor-derived owner DIDs or an ACL handoff so a rotated leaf can reach its own history.
Keep the per-pool PKP owner path intact as the stable issuer/collection owner throughout.

---

## File:line trace appendix

| Concern | Location | Quoted/noted |
|---|---|---|
| Delegation route | `nillcc-backend/src/main.ts:226-235` | no Express gate; passes signature/userAddress |
| Controller forwarding | `nillcc-backend/src/survey.ctrlr.ts:166-178` | derefs `poolConfig.safe/pkpId/pkpDid` |
| PKP client action run | `nillcc-backend/src/services/nildb.pkp.service.ts:164-186` | runs `user-delegation` action |
| Action: rule + PKP sign | `shared/.../lit/actions/user-delegation.ts:27-70` | verifyMessage → isPoolMember → ES256K sign |
| Membership gate | `.../user-delegation.ts:40-50` | `isPoolMember(poolId, userAddress)` |
| Delegation payload | `.../user-delegation.ts:65-70` | `iss/sub=pkpDid, aud=userDid, pol:[], exp:+3600` |
| Seed derivation | `shared/.../permissionless.simple.service.ts:197-199` | `keccak256(signature).slice(2)` |
| Leaf DID init | `shared/.../nilldb.user.service.ts:30-33` | `Signer.fromPrivateKey(seed)` → didString |
| Data owner | `shared/.../nilldb.user.service.ts:87-95` | `owner: userDidString; grantee: pkpDid` |
| Frontend request | `frontend-respondents/.../survey.ctrlr.ts:110-133` | computes seed, sends userDid/signature/userAddress/pkpId/pkpDid |
| Leaf auth | `frontend-respondents/src/auth.factory.ts:6-12` | WaaP → OPRF → updateSignerWithKey |
| On-chain member | `shared/.../card.factory.ts:76` | `registerInPool(poolId,nullifier,batchId,signature)` via leaf account |
| GAP-2 intro commit | `c94546d9a "hardened actions"` | first `isPoolMember` in `user-delegation.ts` |

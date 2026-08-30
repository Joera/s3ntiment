# RFC-001 Q1 (deep dive): Can read/write/execute be ADDED/CHANGED on an ALREADY-EXISTING owned SecretVaults document, without deleting & recreating it?

**Headline verdict: YES.** `grantAccess`/`revokeAccess` mutate the **already-persisted** record's embedded `_acl` array **in place** (MongoDB `$push`/`$pull`), scoped to that exact owned document. A brand-new grantee DID **D** can be given read/write/execute on an existing owned doc that stays the *same record* under *same owner* `_owner`. What stays immutable is `_owner` (set at create, never touched by grant/revoke); what is mutable is the per-record `_acl`.

This report traces the real code paths (SDK **and** nilDB server), not just method names.

---

## Sources read

- `@nillion/secretvaults@3.0.0` `dist/lib.js` + `dist/lib.d.ts` (installed in `s3ntiment-contract-tests` worktree)
- `NillionNetwork/nildb` `@HEAD 9a38c38f` (2026-03-16) `packages/api/src/{users,builders,data,common,middleware}/*.ts`
- `@nillion/nuc@2.0.1` (inferred import only)

---

## 1. SDK side — `grantAccess` / `revokeAccess`

### 1.1 Endpoints (document-scoped)
`dist/lib.js` (NilDbEndpoint map):
```js
772:  grant: "/v1/users/data/acl/grant",
773:  revoke: "/v1/users/data/acl/revoke"
```
`dist/lib.js` (NilDbUserClient request methods → HTTP **POST**):
```js
1847:  grantAccess(token, body) {
1848:    return this.request({ path: NilDbEndpoint.v1.users.data.acl.grant, method: "POST",
1850:                          token, responseSchema: GrantAccessToDataResponse });
1859:  revokeAccess(token, body) {
1860:    return this.request({ path: NilDbEndpoint.v1.users.data.acl.revoke, method: "POST", ... });
```

### 1.2 Request body schema — explicitly a SINGLE document + per-grantee permissions
`dist/lib.d.ts` (lines ~719-733):
```ts
GrantAccessToDataRequest: z.object({
  collection: z.UUID(),
  document:   z.UUID(),                       // ← document-scoped
  acl: z.object({ grantee: z.string(),        // ← the NEW DID D
                  read: z.boolean(),
                  write: z.boolean(),
                  execute: z.boolean() }),
})
```
RevokeAccessToDataRequest: `{ grantee, collection, document }` (see `users.repository.removeAclEntry`, section 3).

### 1.3 Who signs / which NUC command (authority carrier)
`SecretVaultUserClient.grantAccess` (`dist/lib.js:2066`):
```js
2066:  async grantAccess(body, options) {
2070:        command: NucCmd.nil.db.users.update,      // ← the invocation command
```
and `revokeAccess` (2089) also uses `NucCmd.nil.db.users.update`.

`getInvocationFor` (`dist/lib.js:2109-2141`) builds the bearer token:
```js
2128:  return Builder.invocation().command(command)
             .subject(await this.getDid())   // ← subject = the CALLER's own DID
             .audience(audience).expiresIn(defaultExpiresIn).signAndSerialize(signer);
```
So the SDK signs a `nil/db/users/update` invocation **with the caller's own key**, subject = caller DID. (There is an `auth.delegation` branch at line 2126, but see §4.2 — the current server user middleware rejects non-self-rooted chains.)

---

## 2. Server side — the grant/revoke handlers

`packages/api/src/users/users.controllers.ts`:
```ts
247: export function grantAccess(options) {
265:     requireNucNamespace(NucCmd.nil.db.users.update),   // ← command gate
260:     loadSubjectAndVerifyAsUser(bindings),              // ← subject must be a registered USER
269:     const command = UserDataMapper.toGrantDataAccessCommand(user, payload, ...);
272:     pipe(BuildersService.find(c.env, command.acl.grantee),   // grantee must be a known builder
273:          E.flatMap(() => UserService.grantAccess(c.env, command)), ...)
```
Same shape for `revokeAccess` (lines 285-313), with `BuildersService.find(..., command.grantee)`.

**The handler does NOT delete/recreate.** It calls `UserService.grantAccess` → `UserRepository.addAclEntry`.

---

## 3. THE CORE: grant mutates the existing owned record's `_acl` in place

`packages/api/src/users/users.services.ts`:
```ts
171: export function grantAccess(ctx, command) {
173:   const { owner, collection, document, acl } = command;
176:   if (!acl.read && !acl.write && !acl.execute) { return E.fail(new GrantAccessError(...)); }
199:   return pipe(find(ctx, owner),
200:        E.tap((user) => enforceDataOwnership(user, document, collection)), // ← OWNER check
201:        E.flatMap(() => UserRepository.updateUserLogs(ctx, owner, logs)),
202:        E.flatMap(() => UserRepository.addAclEntry(ctx, collection, document, owner, acl)));
```

`packages/api/src/users/users.repository.ts` — `addAclEntry` is a **Mongo updateOne** on the *existing stored row*:
```ts
196: export function addAclEntry(ctx, collection, document, owner, acl) {
200:   const filter = { _id: document,   _owner: owner };        // ← targets the EXISTING owned doc
210:   const update = { $push: { _acl: acl } };                  // ← appends grantee entry IN PLACE
211:   return checkCollectionExists(ctx, "data", collection.toString())
213:     .updateOne(filter, update);
}
```
and `removeAclEntry` (line 227) does `$pull: { _acl: { grantee } }` on `{ _id: document, _owner: owner }`.

**This is the decisive evidence**: `grantAccess` performs `updateOne({_id: <existing doc>, _owner: owner}, {$push:{_acl: {grantee,read,write,execute}}})` on the very document that is already persisted. The record is **not** deleted/recreated; its `_id` and `_owner` are unchanged, only `_acl` grows. ✅ **VERIFIED — ACL CAN be added to an already-existing owned document.**

Matching data model — `packages/api/src/data/data.types.ts`:
```ts
15: type OwnedDocumentBase = StandardDocumentBase & {
16:   _owner: string;   // immutable after create
17:   _acl: Acl[];      // mutable: pushed/pulled by grant/revoke
18: }
```
`Acl = { grantee: string; read: boolean; write: boolean; execute: boolean }`.

---

## 4. Authority — WHO can grant on an existing owned doc

### 4.1 Owner-scoping (enforced on the server)
`packages/api/src/common/acl.ts` — `enforceDataOwnership` is called inside `UserService.grantAccess` (line 200) **before** the `$push`:
```ts
14: export function enforceDataOwnership(user, document, collection) {
15:   return pipe(E.succeed(
22:     user.data.some((s) => s.document.toString() === document.toString()
23:                    && s.collection.toString() === collection.toString())));
     ... fail -> ResourceAccessDeniedError
```
So the caller must have **this exact (collection, document) in their own `user.data` ownership list** — i.e. **only the OWNER E can grant/revoke on E's own record.** A random DID cannot. ✅ **VERIFIED: grant is owner-scoped.**

### 4.2 Delegation — effectively NOT accepted on the user path
`loadSubjectAndVerifyAsUser` (`capability.middleware.ts:370`):
```ts
369: const subject = token.sub.didString;
370: await Validator.validate(envelope, { rootIssuers: [subject] });
```
The NUC envelope's proof chain must **root at the subject itself** (self-signed). A delegation chain issued by owner E to caller D would root at E, not D, and fail this check. So within the current server the ACL-grant authority is, in practice, **the owner's own key** — no third party / pure-delegation grant. ✅ **VERIFIED (mechanism), [INFERRED] practical consequence: an owner-delegation-driven grant is not usable on this middleware path.**

### 4.3 Grant target D must be a registered builder
Both handlers first `BuildersService.find(...grantee)` (controllers lines 272 and 311) and short-circuit if the grantee isn't a known builder. So you can only grant to a DID that is registered as a builder. ✅ **VERIFIED.**

---

## 5. Does the grantee D actually get read/write/execute on the OWNED record?

Yes — for owned collections, every data-plane access is filtered through `buildAccessControlledFilter`, which reads the **per-record `_acl`**:
`packages/api/src/common/acl.ts`:
```ts
62: export function buildAccessControlledFilter(ctx, builderId, collectionId, permission, originalFilter) {
69:   ... CollectionsService.find(...) =>
76:     if (collection.type === "standard") {  // standard: ONLY the collection owner
77:       if (collection.owner === builderId) return succeed(originalFilter);
79:       return fail(ResourceAccessDeniedError);
82:     // owned collection → ACL-augmented filter on the RECORD
92:     const aclFilter = { _acl: { $elemMatch: { grantee: builderId, [permission]: true } } };
94:     // combine with originalFilter via $and
```
Used by the data services with the mapped permission:
- Read: `findRecords` `buildAccessControlledFilter(ctx, requesterId, collection, "read", ...)` (data.services.ts:169)
- Write: `updateRecords` `... "write" ...` (119) and `deleteData` `"write"` (195)
- Execute: `runAggregation` `"execute"` (312), and `tailData`/`flushData` use `"read"`/`"write"`.

So once E grants D `{read:true, write:true, execute:true}` on the existing owned doc:
- D can `find`/`read` it (read) and run queries over it (execute);
- D can **update it `$set`-in-place** via `/v1/data/update` (`updateRecords`) and delete it via `/v1/data/delete`, because the enforced filter is the `_acl` `$elemMatch`, NOT `_owner`.
✅ **VERIFIED: a granted writer/executor on an owned doc acts on the owner's record without the owner recreating it, and without becoming `_owner`.** The grantee is an *effective writer via ACL*, never a co-owner.

### Caveat (practical): the exercising path requires BUILDER standing
The data-plane endpoints (`/v1/data/find|update|delete|flush|tail`, `/v1/queries/...`) are fronted by `loadSubjectAndVerifyAsBuilder` + `requireNucNamespace(nil.db.data.* / nil.db.queries.*)` (see `data.controllers.ts` lines 90/131/176/223/270, `queries.controllers.ts`). So to *exercise* a granted permission a DID must present a self-signed (or nilauth-rooted) `nil/db/data/*` invocation as a **registered builder**. The SDK's `SecretVaultUserClient` has `createData/readData/deleteData/grantAccess/revokeAccess` but **no user-side `updateData`** in 3.0.0, and its owned-doc update that *does* exist (`POST /v1/users/data`, controller `updateData` �� `DataService.updateRecordsAsOwner`, `users.controllers.ts:166`, namespace `users.update`) is the **owner** surface ("no ACL check needed", data.services.ts:131 comment) — not a grantee surface. **Bottom line: the grant *stores* the capability in the record's `_acl`; exercising write/execute on an owned doc happens through the builder/data endpoints**, i.e. the grantee D must be (or act through) a builder. This is a property of the access path, not of whether ACLs can be mutated on existing docs (they can). **[VERIFIED for behavior; the "must be a builder to exercise" is [VERIFIED] from the middleware/namespace gates].**

---

## 6. Collection-level vs document-level ACL

- **ACL is per-RECORD (document-level), stored inside the data document itself** as the `_acl: Acl[]` array (`OwnedDocumentBase`). It is not a separate ACL collection and not collection-scoped. `addAclEntry` targets one `_id`.
- The only **collection-level** ownership concept is `collection.owner`, and it is only consulted for `type === "standard"` collections (common/acl.ts:76 — standard collections are owner-only, no record ACL); owned collections always use the record `_acl` filter.
- `grantAccess`'s request carries both `collection` and `document` UUIDs purely to locate the single record; the mutation is on `_acl` of `{_id: document, _owner: owner}` in the `data.<collection>` collection. ✅ **VERIFIED: document-level, per-record ACL.**

---

## 7. Immutable vs mutable for an existing managed/owned doc

| Field | State | Evidence |
|---|---|---|
| `_owner` | **IMMUTABLE** after create | set at insert (`data.repository.ts:145 _owner: owner`); grant/revoke filters on `_owner` but never modify it (`users.repository.ts:205,236`); no ownership-transfer primitive anywhere in `users.services`. |
| `_id` (document UUID) | **IMMUTABLE** — same record persists | grant/revoke use `updateOne` on it. |
| `_acl` | **MUTABLE in place** | `$push` (add), `$pull` by `grantee` (remove) on the existing row. A grantee can be added, or an existing grantee's entry replaced/upgraded by a subsequent `$push` with changed booleans (Mongo will keep the newest matching `grantee` entry for `$elemMatch`), and downgraded by revoke-then-regrant. |
| doc `data` fields (the payload) | mutable by owner (`updateRecordsAsOwner`) and by ACL-granted writer (`updateRecords` with `_acl` filter). | |

---

## 8. Conclusion for RFC-001's Q1 decision

- **The premise of "only delete+recreate" was WRONG for permissions.** Speaking in terms the RFC can act on: the **identity/ownership** of the record is fixed at create (`_owner`, no transfer), but **the ACL is fully mutable in place** and this is a *first-class, server-supported* operation (`POST /v1/users/data/acl/grant` / `revoke` → `updateOne($push/_acl)` / `updateOne($pull/_acl)` on the existing record).
- **Mechanism to give a new DID D read/write/execute on an existing owned doc without recreating it:**
  1. Owner E signs a `nil/db/users/update` invocation (SDK `grantAccess`, `SecretVaultUserClient`).
  2. Server verifies E is the owner (`enforceDataOwnership`), then `$push`s `{grantee:D, read, write, execute}` onto the *same stored record*.
  3. Thereafter D passes the record-`_acl` `$elemMatch` filter on the builder/data + query endpoints and can read/update/delete/query that owned record.
- **Immutable remains:** `_owner` and document identity. D never becomes the owner; ownership-transfer still requires delete+recreate.
- **RFC recommendation implication:** For "give a collaborator access to an existing response/record," **use ACL-grant (keep the same record, no delete+recreate)** — it is lighter and preserves `_owner`, history and the same document UUID. Delete+recreate is only necessary if you actually need to *change the owner*, which the platform does not support natively.

### Evidence tags
- **[VERIFIED]** — anchored to quoted SDK lib.js/lib.d.ts lines and nildb API source lines above (endpoints, schemas, commands, `updateOne $push/$pull`, `enforceDataOwnership`, `buildAccessControlledFilter`).
- **[INFERRED]** — only the practical consequence in §4.2 (that owner-delegation-driven grants won't pass `rootIssuers:[subject]`) and the "grantee must exercise via builder path" caveat in §5, both derived from, not directly tested in, the middleware.

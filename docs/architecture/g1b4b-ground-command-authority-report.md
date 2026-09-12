# G1B.4B — Ground Command + Primary GM Authority Boundary

## 1. Executive summary

G1B.4B connects Ground to the existing `CommandRegistry`, `system.mtrol` socket transport, authenticated sender identity, canonical Primary GM selection, `AuthorityWriteContext`, G1B.4A durable Ground receipts, and the shared logger.

Only `ground.inspect` and `ground.reconcile` are registered. Inspect is GM-only and read-only. Reconcile is GM-only, idempotent, Scene-scoped, stale-plan protected, and locally fenced immediately before its Ground persistence write.

## 2. Baseline

Authorized baseline:

- total: 1535
- pass: 1534
- fail: 0
- manual skip: 1

## 3. Files changed

Productive files modified:

- `scripts/core/init.js`
- `scripts/core/sockets.js`
- `scripts/ground/ground-repository.js`
- `scripts/ground/ground-lifecycle-service.js`
- `scripts/ground/ground-reconciliation-service.js`

Productive file created:

- `scripts/runtime/ground-commands.js`

Tests added:

- `tests/ground-command-authority-g1b4b.test.mjs`

No Trade, SharedReservationLedger, TransactionCoordinator, AuthorityService, ReceiptStore, CommandRegistry, Canvas, inventory, or gameplay implementation changed in G1B.4B.

## 4. Tests-first evidence

The new test file was executed before production implementation. It failed with `ERR_MODULE_NOT_FOUND` for `scripts/runtime/ground-commands.js`, proving the command boundary did not exist.

The first post-implementation run found that reconciliation wrapped `AUTHORITY_CONTEXT_STALE` as `GROUND_REPAIR_WRITE_FAILED`. This was corrected so authority failures propagate unchanged and do not trigger blind recovery. A Ground regression then found an extra microtask caused by an absent optional callback; the primitive now preserves the exact old scheduling when no fencing callback is configured.

## 5. Command architecture

The implemented path is:

```text
caller
→ existing requestPrimaryGM/socket envelope
→ system.mtrol listener
→ AuthorityService.authenticateSocketRequest
→ existing CommandRegistry
→ runtime/ground-commands.js boundary
→ GroundReconciliationService
→ GroundPersistencePrimitive
```

There is no Ground registry, dispatcher architecture, manager, engine, controller, socket class, or coordinator.

## 6. Commands registered

Registered:

- `ground.inspect`
- `ground.reconcile`

Both use CommandRegistry scope `world`.

Not registered:

- create, activate, move, visibility, appearance, pickup-enabled, tombstone;
- Drop or Pickup;
- any Canvas or inventory command.

## 7. Caller identity

The Ground handlers use only `context.requestingUserId`. On the socket path this value is injected from Foundry's authenticated `senderUserId` after `AuthorityService.authenticateSocketRequest()`.

A mismatched top-level claimed identity fails with `SENDER_SPOOFED`. A nested `payload.requestingUserId` never replaces the authenticated context and cannot grant GM permissions.

## 8. GM-only policy

The command validator resolves the authenticated caller through `authorityService.resolveUser(context.requestingUserId)` and requires `user.isGM === true`.

Player rejection uses:

```text
GROUND_GM_REQUIRED
```

CommandRegistry separately requires Primary execution. No operation falls back to a Player or secondary GM.

## 9. DTO allow-list

`ground.inspect` accepts exactly:

```js
{ sceneId, groundId }
```

`ground.reconcile` accepts exactly:

```js
{ sceneId, groundId, repairPlan }
```

The repair plan must use the exact G1B.3 fields:

```js
{
  sceneId,
  groundId,
  pairStatus,
  authorityLifecycle,
  issues,
  publicRevision,
  authorityRevision,
  authorityFingerprint,
  projection
}
```

Target identity, revisions, issue list, fingerprint and public projection are validated before a receipt or domain mutation is admitted.

## 10. Privileged payload rejection

Unknown top-level fields fail closed with `GROUND_COMMAND_PAYLOAD_INVALID`, including attempts to submit `itemSnapshot`, `system`, `flags`, provenance, lifecycle, recovery evidence, pickup state, visibility, appearance, createdBy, authority identity, or generation.

The exact G1B.3 repair plan is still caller-supplied by a GM, but the domain recomputes current state, fingerprint and projection and enforces stale revisions before writing.

## 11. AuthorityWriteContext integration

`ground.reconcile` creates one context through `authorityService.createWriteContext()` after command and permission admission. It passes this closure to reconciliation:

```js
() => authorityService.validateWriteContext(writeContext)
```

AuthorityService itself was not modified.

## 12. Write fencing seam

`GroundPersistencePrimitive` accepts an optional `assertAuthority` callback and invokes it immediately before each underlying storage write.

The seam covers:

- both Authority and Public writes in `create`;
- public updates;
- authority updates;
- reconciliation replacement writes.

`GroundLifecycleService` accepts the optional callback as an injected constructor dependency and passes it to every repository mutation. Existing internal callers without a callback retain their prior behavior and scheduling.

Ground services do not import AuthorityService.

## 13. Authority handoff behavior

If authority changes before the next Ground write, validation throws `AUTHORITY_CONTEXT_STALE` and that write does not occur. Authority errors are not converted into generic write failures and do not start blind rollback/recovery.

If an earlier write already completed, the partial state remains persisted and G1B.3 can classify it. A controlled Authority → Public test leaves a repairable mismatch and performs no Public write after authority becomes stale.

A generation from A remains stale after A → B → A.

## 14. Remaining server fencing limitation

G1B.4B provides local authority fencing only. It does not close:

```text
validate context OK
→ write sent
→ authority changes
→ Foundry server accepts stale write
```

Foundry's public document API provides no atomic server-side epoch predicate for this write. The implementation does not claim distributed fencing, leases, or locks.

## 15. Receipt integration

`ground.reconcile` uses the existing `ReceiptStore` through `createGroundReceiptScope(sceneId)`. Physical persistence remains:

```text
Scene.flags.mtrol.groundCommandReceipts
```

Identity is the G1B.4A tuple:

```text
transactionId + ground.reconcile + SHA-256(canonical payload)
```

Same identity replays. Different payload or command conflicts with `RECEIPT_IDENTITY_CONFLICT`.

## 16. Lost ACK and retry behavior

The test completes a repair, discards the conceptual response, and repeats the same request. The durable completed receipt returns the original minimized result and `repairGround()` is invoked only once.

Socket timeout behavior was not changed.

## 17. Inspect read-only behavior

`ground.inspect` is registered with `idempotent: false`, so CommandRegistry executes its read path without creating a receipt.

It does not mutate Public, Authority, or Ground receipt flags. Its DTO contains only:

- sceneId;
- groundId;
- pairStatus;
- authorityLifecycle;
- classification;
- issues;
- recoverability;
- proposedAction.

The G1B.3 repair plan is deliberately omitted because its current `authorityFingerprint` is a canonical serialization that can include private AuthorityRecord data.

## 18. Reconcile behavior

The boundary validates the exact G1B.3 plan and delegates policy unchanged. G1B.3 still determines repairability, checks current revisions/fingerprint, constructs the projection from current Authority, persists it, rereads it, and verifies `MATCHED`.

The returned DTO contains operation identity, outcome, and the final minimized diagnosis. It does not return `state`, AuthorityRecord, item snapshot, provenance, effects, flags, or Item system data.

## 19. Error normalization

Existing `reasonCode` values are preserved. `GroundPersistenceError.code` becomes the command reason code when it reaches the boundary. Schema/type failures receive stable Ground command codes. Relevant additions are:

- `GROUND_GM_REQUIRED`
- `GROUND_COMMAND_PAYLOAD_INVALID`
- `GROUND_SCENE_NOT_FOUND`
- `GROUND_REPAIR_PLAN_TARGET_MISMATCH`
- `GROUND_COMMAND_FAILED`

`AUTHORITY_CONTEXT_STALE`, G1B.3 repair codes, and `RECEIPT_IDENTITY_CONFLICT` pass through unchanged.

## 20. Socket reuse

The only socket changes are imports and one routing branch in the existing listener. Actions are:

- `mtrolGroundInspect`
- `mtrolGroundReconcile`

There is no new namespace, listener, response protocol, pending-request map, or socket authentication mechanism.

## 21. Registration

`registerGroundCommands()` is called from the existing `initMtrol()` registration sequence. Repeated registration uses `registry.has()` and does not replace installed handlers.

The socket listener continues to register once from the existing ready lifecycle.

## 22. Public API exposure

No repository, lifecycle service, reconciliation service, command dispatcher, or Ground facade was added to `game.mtrol`.

The local dispatch helper remains a module-level internal export and still passes through CommandRegistry, authenticated context rules and receipts. There is no public direct service bypass.

## 23. Logging

The shared logger records:

- GM permission rejection;
- socket authority rejection through the existing socket layer;
- reconciliation command failures and their reason codes.

Logs include command, transaction, target IDs and caller ID. They do not include payloads, repair plans, snapshots, flags, system data, effects, or fingerprints.

## 24. Level 1 limitation

Ground remains the approved Level 1 UI Privacy MVP. Scene flags, including command receipts and existing Authority records, remain player-distributable. G1B.4B does not claim secrecy.

## 25. Level 2 migration boundary

The command boundary depends on Ground repository/service contracts rather than direct Scene flag access. A future Level 2 Authority storage adapter can replace the authority persistence side without changing command names, sender authentication, permission policy, lifecycle schemas, or reconciliation policy.

The receipt scope is separately Scene-scoped and contains only minimized receipt identity/results.

## 26. Directed tests

G1B.4B directed result:

- total: 18
- pass: 18
- fail: 0
- skips: 0

Coverage includes registration, CommandRegistry reuse, Player rejection, real socket sender spoofing, nested spoofing, allow-lists, GM inspect/reconcile, read-only behavior, private DTO exclusion, durable receipt replay, lost ACK, identity conflict, stale repair plan, stale authority, authority loss between writes, A → B → A, no Primary, routing, and architecture guardrails.

## 27. Ground regression

All Ground tests:

- total: 71
- pass: 71
- fail: 0
- skips: 0

G1B.1, G1B.2, G1B.3 and G1B.4A behavior remains green.

## 28. Shared runtime regression

Directed ReceiptStore, CommandRegistry, AuthorityService, socket, Combat, movement, TransactionCoordinator, Trade identity and capacity tests:

- total: 181
- pass: 181
- fail: 0

## 29. Full suite

`npm test`:

- total: 1553
- pass: 1552
- fail: 0
- skipped: 1 manual confidentiality spike
- new skips: 0

The increase from the G1B.4A baseline is exactly 18 tests.

All Trade files were also run as a directed group:

- total: 313
- pass: 313
- fail: 0

## 30. Manual Foundry checklist/result

Manual World testing was not performed. The local Foundry process was absent, so it was started against `C:/FoundryVTT/Data`. The server responded on port 30000 but redirected to `/license`, where Foundry required EULA acknowledgement and a usable license before a World could be opened.

No EULA was accepted on the user's behalf. No World, Ground, Item, Actor, Scene flag, or production document was created, edited, reconciled, or deleted during this attempt.

Automated coverage exercises the real socket listener with authenticated `senderUserId`, both spoof cases, command routing, Primary admission, receipt replay and Ground persistence.

## 31. Known gaps

- No real Foundry World run was possible until the local installation is licensed/acknowledged.
- No public operational facade or UI invokes these commands yet.
- `ground.inspect` does not expose the private G1B.3 repair plan; a later trusted GM workflow must acquire/pass it without leaking Authority data.
- No startup scan or automatic recovery exists.
- No server-side fencing exists.
- Drop, Pickup, Canvas, inventory effects and gameplay remain unimplemented.

## 32. G2 readiness

G1B now has schemas, Level 1 persistence, failure-safe lifecycle mutations, deterministic reconciliation, hardened receipts, authenticated GM-only commands, durable retry, and local Primary fencing. G2 can consume these boundaries without exposing Ground internals or creating another transport/authority architecture.

G1B.4B GROUND COMMAND + AUTHORITY BOUNDARY COMPLETE — G1B COMPLETE — G2 READY FOR REVIEW.

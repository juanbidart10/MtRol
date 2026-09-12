# G1B.4A — Receipt Identity Hardening + Ground Durable Receipt Scope

## 1. Executive summary

G1B.4A hardens the canonical `ReceiptStore` identity from a `transactionId`-only lookup to the accredited tuple `transactionId + command + canonical payload fingerprint` for commands dispatched through `CommandRegistry`. Identical retries replay the persisted result. Reusing a transaction ID for a different command or payload now fails with `RECEIPT_IDENTITY_CONFLICT`.

Ground receives a durable Scene-scoped receipt adapter backed by `flags.mtrol.groundCommandReceipts`. It reuses `ReceiptStore` and `createReceiptScope`; it does not introduce another receipt engine, Ground command, socket action, or gameplay behavior.

## 2. Original demonstrated weakness

`ReceiptStore` indexed receipts by `transactionId` and persisted `command`, but replay did not compare that command and no payload fingerprint existed. A completed receipt could therefore silently replay for the same transaction ID with a different command or payload.

Concurrent delivery had the same weakness because the in-flight map returned the existing Promise solely by scope and transaction ID.

## 3. Baseline

The supplied baseline was:

- total: 1526
- pass: 1525
- fail: 0
- manual skip: 1

## 4. Files changed

Productive files changed:

- `scripts/runtime/receipt-store.js`
- `scripts/runtime/command-registry.js`

Productive files created:

- `scripts/ground/ground-receipt-scope.js`

Tests created:

- `tests/receipt-identity-ground-scope-g1b4a.test.mjs`

No AuthorityService, TransactionCoordinator, Trade, SharedReservationLedger, existing Ground schema/lifecycle/reconciliation, socket, Canvas, inventory, or gameplay file changed for G1B.4A.

## 5. Tests-first failure

The new directed suite was executed before production implementation. It failed with `ERR_MODULE_NOT_FOUND` for `scripts/ground/ground-receipt-scope.js`, proving the durable Ground scope and new receipt identity API were absent. After implementation, all nine new tests pass.

## 6. Receipt identity before

Before G1B.4A, persistent lookup and in-flight deduplication used:

```text
scope + transactionId
```

The receipt stored `command`, but did not enforce it. Payload identity was not stored.

## 7. Receipt identity after

For idempotent commands dispatched through `CommandRegistry`, identity is:

```text
scope + transactionId + command + sha256(canonical payload)
```

Semantics:

- same transaction ID, command and fingerprint: replay/share is allowed;
- same transaction ID and different command: conflict;
- same transaction ID and command but different fingerprint: conflict;
- conflict reason code: `RECEIPT_IDENTITY_CONFLICT`.

The check applies both to persisted receipts and concurrent in-flight work.

## 8. Fingerprint implementation

`createReceiptFingerprint(payload)` is exported by `scripts/runtime/receipt-store.js`. It computes SHA-256 through the platform Web Crypto API and persists only:

```text
sha256:<64 lowercase hexadecimal characters>
```

`CommandRegistry` calculates it once from `envelope.payload ?? {}` before calling `ReceiptStore.execute()`. Handler signatures and command registration remain unchanged.

## 9. Canonicalization

`canonicalizeReceiptPayload(payload)` recursively:

- sorts object keys;
- preserves array order;
- preserves JSON scalar values;
- applies JSON-compatible treatment to undefined/function/symbol and non-finite numbers;
- rejects BigInt and circular references.

Object insertion order therefore does not change the fingerprint, while a semantic payload change does.

## 10. CommandRegistry integration

Only idempotent commands reach fingerprint calculation. Non-idempotent commands retain their existing direct execution path. The registry continues to provide `transactionId`, `command`, `pendingActionId`, target resolution, context, validation, and the unchanged handler signature.

No command must implement its own generic fingerprint. Domain fingerprints remain valid when they encode stronger domain semantics.

## 11. Legacy receipt policy

No legacy receipt is deleted or rewritten and no migration runs.

For a receipt without fingerprint:

- when its historical command is present and differs, replay is rejected;
- when the historical command matches, legacy replay remains compatible because the original payload cannot be reconstructed;
- that replay emits `RECEIPT_LEGACY_IDENTITY` through the existing logger when available;
- when historical command identity is also absent, existing compatibility is retained because no missing evidence is invented.

No retroactive fingerprint is fabricated.

## 12. Trade compatibility

Trade's `operationId` and domain-level canonical fingerprint remain unchanged. Command receipt identity and Trade domain identity coexist. Trade's stable reservation identity and `SharedReservationLedger` were not modified.

Directed Trade tests, including duplicate retry, payload collision, lost ACK, capacity mutation, reload, and transfer execution, pass.

## 13. Combat compatibility

TransactionCoordinator and Combat receipt lifecycle were not changed. Direct coordinator receipts that do not supply a fingerprint preserve their existing behavior. Compact receipts preserve a fingerprint when one exists so command identity is not weakened by compaction.

Directed Combat, movement, transaction, socket-command, CommandRegistry, ReceiptStore, and receipt-compaction tests pass.

## 14. Ground receipt scope design

`GroundSceneReceiptRepository` is a persistence adapter implementing the existing `read`/`mutate` contract expected by `ReceiptStore`. `createGroundReceiptScope(sceneId)` returns the canonical `createReceiptScope(...)` wrapper.

The scope is Scene-specific because future `ground.reconcile` is a Scene mutation. `ground.inspect` remains read-only and does not require a mutating receipt.

## 15. Physical persistence

Each Scene stores one independent envelope at:

```text
Scene.flags.mtrol.groundCommandReceipts
```

Envelope:

```js
{
  schemaVersion: 1,
  revision: Number,
  sceneId: String,
  receipts: Object
}
```

Receipt keys continue using the canonical `rk1_<hex transactionId>` codec.

This remains Level 1 and player-distributable, matching the accepted Ground storage level.

## 16. Reload durability

The reload test creates a receipt through one repository/store instance, constructs fresh instances over the same Scene flag, and verifies that an identical retry returns the persisted result without executing the effect again.

RAM queues and the in-flight map are only concurrency aids. They are not the authority for completed receipts.

## 17. Data minimization

The Ground receipt flag stores identity, lifecycle metadata, and the supplied command result. The fingerprint contains no recoverable payload body. The adapter does not persist Ground AuthorityRecord, item snapshots, provenance, Item `system`, flags, or effects.

Future Ground handlers remain responsible for returning a minimal public receipt DTO. G1B.4A does not expose a Ground command capable of persisting a result.

## 18. Error and reason codes

The generic `ReceiptIdentityConflictError` exposes:

- `reasonCode = "RECEIPT_IDENTITY_CONFLICT"`;
- `transactionId`;
- historical and received command identity;
- conflict dimension: `command` or `fingerprint`.

Logging records command, transaction ID, and reason code without logging the payload or fingerprint input.

## 19. Guarantees provided

- Identical command retries replay exactly once.
- Different commands cannot silently share a transaction ID.
- Different payloads cannot silently share a transaction ID for new fingerprinted command receipts.
- Canonical object key order is deterministic.
- Concurrent identical calls share one execution.
- Concurrent identity conflicts are rejected.
- Fingerprint identity survives receipt compaction and durable reload.
- Legacy receipts remain available without destructive migration.
- Ground has a durable Scene receipt scope using the canonical ReceiptStore.

## 20. Guarantees not provided

- A legacy receipt without fingerprint cannot prove its historical payload.
- SHA-256 identity does not validate domain authorization or business semantics.
- The Ground Scene adapter does not provide server-side compare-and-set or distributed fencing.
- Receipt identity does not close the `validation OK → write sent → authority lost → server accepts` window.
- The adapter does not minimize an arbitrary future handler result automatically; the future command boundary must return an allowlisted DTO.
- G1B.4A does not add Ground authority fencing, commands, sockets, Drop, Pickup, Canvas, or recovery invocation.

## 21. Directed tests

Results:

- New G1B.4A suite: 9 pass, 0 fail.
- ReceiptStore/CommandRegistry/Combat/Transaction directed set: 109 pass, 0 fail.
- Combined Ground and Trade directed set: 367 pass, 0 fail.
- Existing Ground G1B.1/G1B.2/G1B.3 tests within that run: 45 pass, 0 fail.

The new suite covers deterministic fingerprinting, semantic payload differences, completed replay, command collision, payload collision, concurrent retry, failed/processing compatibility, legacy policy, Ground physical persistence, reload, and data minimization.

## 22. Full suite

`npm test` completed successfully:

- total: 1535
- pass: 1534
- fail: 0
- skipped: 1 manual confidentiality spike
- new skips: 0

The increase from baseline is exactly nine tests.

## 23. G1B.4B readiness

The canonical receipt identity and durable Ground Scene scope are available for a future Ground command boundary. G1B.4B has not started. It must still integrate AuthorityWriteContext and revalidate before each Ground external write without claiming server-side fencing.

G1B.4A RECEIPT IDENTITY HARDENING COMPLETE — G1B.4B READY FOR REVIEW.

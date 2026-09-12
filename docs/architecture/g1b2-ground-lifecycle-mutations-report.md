# G1B.2 — Ground lifecycle mutations + failure-safe coordination

## 1. Executive summary

G1B.2 adds a narrow Ground domain facade over the G1B.1 repository. It provides semantic operations for PENDING creation, activation, coordinated public-state mutation, explicit recovery marking, and logical tombstone. AuthorityRecord remains the source of truth. Public state is always derived from it and successful coordinated mutations finish as `MATCHED`.

The implementation preserves evidence rather than attempting destructive compensation when the second Scene flag write fails. It does not claim cross-flag atomicity, server CAS, distributed transactions, or automatic recovery.

## 2. Baseline

The approved baseline was 1494 tests: 1493 passing, 0 failing, and 1 pre-existing manual skip.

## 3. Scope

Implemented domain-level lifecycle and projection persistence only. No Canvas, PIXI, drag/drop, pickup, Actor inventory mutation, Ground commands, sockets, public protocol, automatic reconciliation, G1B.3 handler, Trade change, ledger change, or Level 2 storage was introduced.

## 4. Files changed

Productive file modified:

- `scripts/ground/ground-schema.js`

Productive file created:

- `scripts/ground/ground-lifecycle-service.js`

Test file created:

- `tests/ground-lifecycle-g1b2.test.mjs`

Documentation created:

- `docs/architecture/g1b2-ground-lifecycle-mutations-report.md`

`scripts/ground/ground-repository.js` required no change.

## 5. Infrastructure reuse audit

`GroundLifecycleService` reuses `GroundPersistencePrimitive`, its per-Scene queue and revision checks, G1B.1 validators, `createGroundId`, and Universal Item Transfer validation through AuthorityRecord construction.

`TransactionCoordinator` was not reused because its persistent scope resolution requires Actor or Combat receipts and its recovery serialization is defined for existing action/resource domains. Using it for Scene Ground would require expanding transversal APIs and receipt storage, outside G1B.2.

`RecoveryCoordinator` was not integrated because this phase records evidence but explicitly does not register or execute recovery handlers. `ReceiptStore` and Command Registry remain unchanged because there is no Ground command boundary yet.

`AuthorityService` and `AuthorityWriteContext` were audited but not integrated. Without the G1B.4 command/socket admission boundary there is no authenticated caller boundary to attach them to. The service accepts internal inputs and does not present them as Player-trusted commands.

No parallel transaction, recovery, authority, receipt, command, or socket infrastructure was created.

## 6. Domain service decision

A single `GroundLifecycleService` expresses Ground semantics and delegates persistence. Its public operations are:

- `createPendingGround(input)`
- `activateGround(sceneId, groundId, { transactionId })`
- `updateGroundPublicState(sceneId, groundId, patch, { transactionId })`
- `markRecoveryRequired(sceneId, groundId, evidence)`
- `tombstoneGround(sceneId, groundId, { transactionId })`

`GroundLifecycleMutationError` carries `reasonCode`, `sceneId`, `groundId`, `transactionId`, `lastCheckpoint`, and the last readable pair state. It can also retain the original cause and a recovery-write error message.

## 7. Authority as source of truth

Position, visibility, pickup state, and appearance are first written to AuthorityRecord. PublicProjection is derived only from that validated AuthorityRecord. The facade never reads a public value to resolve an authoritative divergence and refuses normal semantic mutation unless the starting pair is `MATCHED`.

The low-level repository method `updatePublic` remains available for persistence and future recovery work. It is not the canonical domain mutation path.

## 8. Public projection derivation

`projectGroundPublicState(authorityRecord)` was added to `ground-schema.js`. It validates and clones AuthorityRecord, selects exactly `schemaVersion`, `groundId`, `sceneId`, `position`, `visibility`, `pickupEnabled`, and `appearance`, and validates the resulting PublicProjection.

Lifecycle, quantity, Item snapshot, provenance, and recovery evidence are never projected.

## 9. Create PENDING

`createPendingGround` validates an exact input allowlist, requires `provenance.operationId` as transaction correlation, generates `groundId` once when the caller did not supply it, constructs a PENDING AuthorityRecord, derives its public projection, and delegates the Authority-first create to `GroundPersistencePrimitive.create`.

Authority recovery evidence starts with the transaction ID and durable checkpoint `authority-record-persisted`. The final result is reread and must be PENDING and `MATCHED`.

A repeated `groundId` is rejected by the existing `GroundDuplicateError`; no identity is overwritten or silently regenerated. End-to-end operation retry idempotency remains deferred to the command/receipt boundary.

## 10. Activate

`activateGround` requires a `MATCHED` PENDING pair. It writes Authority lifecycle `ACTIVE`, records checkpoint `authority-activated`, rereads persistence, and returns only after lifecycle is durably ACTIVE and the pair remains `MATCHED`. PublicProjection retains no lifecycle field and is not rewritten for activation.

## 11. Public state mutation

`updateGroundPublicState` accepts only `position`, `visibility`, `pickupEnabled`, and `appearance`, rejects an empty patch, and requires an ACTIVE `MATCHED` Ground. It rejects identity, Scene, snapshot, quantity, provenance, lifecycle, and every other field.

The operation writes the Authority patch and correlation checkpoint `authority-public-state-persisted`, derives a new PublicProjection, writes Public, and verifies the durable pair. Input and output copy safety is inherited and tested.

## 12. Write ordering

All coordinated two-side mutations use:

```text
Authority write
→ derive PublicProjection from persisted AuthorityRecord
→ Public write
→ durable read verification
```

Authority failure prevents Public from advancing. Authority success followed by Public failure preserves the new authoritative fact and produces a detectable partial state.

## 13. Failure between writes

A Public write failure is never returned as success and Authority is never blindly reverted. The service attempts to move Authority lifecycle to `RECOVERY_REQUIRED`, retaining the original transaction checkpoint and appending `public-write-failed` with reason `GROUND_PUBLIC_WRITE_FAILED`.

The resulting pair remains `MISMATCHED` or, during partial creation, `AUTHORITY_ONLY`. Reinstantiation reads the same durable partial state.

Post-write verification failure uses `GROUND_POST_WRITE_VERIFICATION_FAILED` and checkpoint `post-write-verification-failed` through the same conservative path.

## 14. Recovery evidence

G1B.2 reuses the existing exact shape:

```text
transactionId
checkpoints[]
reasonCode
```

Checkpoints are accumulated without duplicates. They describe persisted authority state or an observed write/verification failure. Earlier creation and activation evidence is preserved across later mutations.

The introduced coordination reason codes are:

- `GROUND_PUBLIC_WRITE_FAILED`
- `GROUND_POST_WRITE_VERIFICATION_FAILED`
- `GROUND_RECOVERY_WRITE_FAILED`

Operation-state validation errors use narrow Ground-specific reason strings but do not create a second recovery evidence format.

## 15. RECOVERY_REQUIRED

`markRecoveryRequired` requires a transaction ID, non-empty reason code, and an AuthorityRecord. It preserves snapshot, quantity, provenance, identity, and Scene through the immutable repository boundary, merges checkpoints, performs the validated lifecycle transition, and verifies durable `RECOVERY_REQUIRED`.

It deliberately does not repair PublicProjection. A prior public divergence remains visible to G1B.3.

## 16. Failure while recording recovery

If the Authority mutation succeeded, Public failed, and the RECOVERY_REQUIRED write also fails, the first Authority mutation remains durable with its transaction ID and last successful checkpoint. The service throws `GroundLifecycleMutationError` with reason `GROUND_RECOVERY_WRITE_FAILED`, identifiers, last checkpoint, last readable pair state, original cause, and recovery error message.

No state is deleted or rolled back. `read()` and `getGroundForScene()` can still expose the partial pair after reinstantiation.

## 17. Tombstone decision

Tombstone is logical and retains both records. Authority becomes `TOMBSTONED`, `INVISIBLE`, and `pickupEnabled: false`; the derived public projection is also `INVISIBLE` with pickup disabled. A successful result remains `MATCHED`, while a future renderer can safely avoid presenting it as normal active Ground without adding public lifecycle.

No physical Authority or Public record is deleted. If Public write fails after the terminal Authority tombstone, the durable AuthorityRecord retains `authority-tombstoned` and the transaction ID, and the service throws with a `MISMATCHED` pair. It does not attempt the invalid terminal transition from TOMBSTONED to RECOVERY_REQUIRED.

## 18. Reload persistence

Tests recreate repository and service objects over the same Scene flag backing after successful create, activation, public mutation, tombstone, and partial failures. A complete PENDING → ACTIVE → public mutation → RECOVERY_REQUIRED → TOMBSTONED flow reloads to an object deeply equal to the state returned before reinstantiation.

## 19. Concurrency guarantees

The unchanged repository serializes writes per Scene inside one repository instance. Tests show two facade mutations through that same instance finish with a durable `MATCHED` pair. A separate stale-revision test shows that once one write is observable, a competing write carrying the previous revision is rejected with `GroundRevisionConflictError`.

These are local/cooperative guarantees. There is no service-wide distributed lock, server-side CAS, or fencing between independent Primary GM clients.

## 20. Guarantees not provided

- No atomic transaction across the Authority and Public flags.
- No server-side or distributed CAS.
- No AuthorityWriteContext revalidation.
- No end-to-end receipt idempotency for semantic operations.
- No automatic retry, reconciliation, or compensation.
- No protection against multiple independent repository instances reading the same revision before either remote write becomes visible.
- No automatic conversion of existing malformed or mismatched data.
- No gameplay or presentation behavior.

## 21. Level 1 limitation

Both physical stores remain Scene flags distributed to Players. G1B.2 preserves the distinction between authoritative and public responsibilities but does not provide client confidentiality or Level 2 storage.

## 22. Level 2 migration boundary

The domain service depends on `GroundPersistencePrimitive`, not Scene or flags. The pure projection also depends only on the AuthorityRecord schema. A future Level 2 Authority adapter can replace `authorityStorage` without changing Ground identity, lifecycle operations, PublicProjection, or projection derivation.

## 23. G1B.1 compatibility

G1B.1 schemas were not materially changed. One pure derivation export was added. Repository persistence, exact-field policies, lifecycle validation, Universal Item Transfer, copy safety, duplicate behavior, orphan classification, and corruption handling remain intact. All 13 G1B.1 tests pass unchanged.

## 24. Tests-first evidence

The G1B.2 test file was created before the productive service. Its first isolated run failed with exit code 1 and `ERR_MODULE_NOT_FOUND` for `scripts/ground/ground-lifecycle-service.js`: 0 passing tests and 1 failing wrapper.

After initial implementation, 9 tests passed and 1 failed because the test expected only the newest checkpoint while the implementation correctly retained creation and activation evidence. The expectation was corrected to require cumulative evidence; no productive guarantee was weakened.

## 25. Directed tests

Final G1B.2 isolated result:

```text
tests    13
pass     13
fail     0
skipped  0
```

Final related run covering G1B.1, G1B.2, Universal Item Transfer, runtime foundation, receipts/recovery, and authority handoff:

```text
tests    67
pass     67
fail     0
skipped  0
```

## 26. Full suite

Final `npm test` result:

```text
tests    1507
pass     1506
fail     0
skipped  1
```

The one skip is pre-existing and manual. G1B.2 adds no skips.

## 27. Known gaps

Authority admission and generation fencing remain for G1B.4. Durable command receipts and professional operation retry semantics remain absent until that command boundary exists. Partial pair inspection exists, but G1B.3 must define reconciliation policy and perform recovery. Independent-client races remain bounded only by Foundry's observable writes and cannot be described as server fencing.

## 28. G1B.3 readiness

The lifecycle facade produces durable, correlated evidence for successful and partial mutations without deleting Authority facts. G1B.3 can build reconciliation over `MATCHED`, `MISMATCHED`, `PUBLIC_ONLY`, and `AUTHORITY_ONLY`. G1B.3 has not been started.

**TransactionCoordinator reused:** NO  
**AuthorityService integrated:** NO  
**Tombstone strategy:** retained AuthorityRecord plus retained inert `INVISIBLE`/pickup-disabled PublicProjection  
**Partial-write strategy:** preserve Authority, attempt RECOVERY_REQUIRED, throw structured error, never blind rollback  
**Level 2 boundary preserved:** YES  
**G1B.3 started:** NO


# G1B.1 — Ground schemas + persistence primitive

## 1. Executive summary

G1B.1 introduces the minimum productive persistence boundary for Ground Items: an opaque World-scoped `groundId`, two strict versioned schemas, separate public and authority records, and an injectable repository that persists both sides per Scene. It does not register runtime behavior or implement Ground gameplay.

The MVP remains Level 1 UI privacy. Foundry distributes both Scene flags to Players, so the authority record is logically separated but is not server-confidential. The domain-facing storage contract can later replace the authority adapter without changing `groundId`, either schema, or repository callers.

## 2. Baseline

The approved pre-G1B.1 baseline was 1481 tests: 1480 passing, 0 failing, and 1 manual skip. G0, G1A, G1A.1, and the human Level 1 decision were complete before this work began.

## 3. Scope

Implemented only identity, schemas, structural validation, lifecycle transition validation, per-Scene persistence, reload reconstruction, copy safety, duplicate rejection, corruption detection, and public/authority pair classification.

No Canvas, PIXI, drag/drop, pickup, inventory mutation, Ground transaction, command, socket, recovery workflow, Trade change, SharedReservationLedger change, or Level 2 adapter was introduced.

## 4. Files changed

Productive files created:

- `scripts/ground/ground-schema.js`
- `scripts/ground/ground-repository.js`

Test file created:

- `tests/ground-persistence-g1b1.test.mjs`

Documentation created:

- `docs/architecture/g1b1-ground-schemas-persistence-report.md`

## 5. Tests-first evidence

The isolated G1B.1 suite was added before either productive module existed. Its first run failed with exit code 1 and `ERR_MODULE_NOT_FOUND` for `scripts/ground/ground-schema.js`: 1 wrapper failed, 0 tests passed. This demonstrates that the new protection did not pass against the prior implementation.

After the first implementation, 11 tests passed and 1 failed because a duplicate fixture accidentally supplied mismatched public and authority positions. The fixture was corrected without weakening product behavior. A later structural-order test deliberately failed against `JSON.stringify` comparison (12 pass, 1 fail) and drove the order-independent structural comparison now used by pair detection.

## 6. groundId decision

`createGroundId` produces `ground:<worldId>:<opaque-id>`. The opaque part uses Foundry's `foundry.utils.randomID(24)` when available, with a platform UUID fallback. Validation constrains both the World namespace and opaque component.

The ID contains no Item name, image, Actor identity, position, or quantity and remains suitable for receipts and future recovery. Production authority integration is intentionally deferred to G1B.4; the factory's contract is that the authority caller generates the ID. The injectable generator exists only for deterministic tests.

## 7. schemaVersion

`GROUND_SCHEMA_VERSION` centralizes the initial value `1`. Both records and both persistence envelopes require the exact supported version. Unsupported versions fail without rewriting stored data. A migration framework was not added.

## 8. GroundPublicProjection schema

The exact allowlisted schema is:

```text
schemaVersion
groundId
sceneId
position { x, y }
visibility
pickupEnabled
appearance { mode, img }
```

Unknown fields are rejected. The projection contains no Item snapshot, `system`, flags, effects, descriptions, formulas, source UUIDs, provenance, recovery evidence, quantity, or authoritative lifecycle.

## 9. GroundAuthorityRecord schema

The exact allowlisted schema is:

```text
schemaVersion
groundId
sceneId
lifecycle
position { x, y }
visibility
pickupEnabled
appearance { mode, img }
quantity
itemSnapshot
provenance {
  sourceActorUuid, sourceItemUuid, createdBy, createdAt, operationId
}
recoveryEvidence { transactionId, checkpoints, reasonCode }
```

The authority side holds the immutable transfer snapshot and quantity plus the evidence required for later transaction correlation. The duplicated presentation fields let the repository detect public drift; they do not make the public side authoritative for private state.

## 10. Visibility

The only schema values are `INVISIBLE`, `HIDDEN`, and `REVEALED`. Labels and localization remain presentation concerns.

## 11. Appearance

Appearance is restricted to `{ mode, img }`, with modes `REAL` and `GENERIC`. A hidden generic projection can carry a generic image without reading the real Item snapshot. Reveal behavior remains outside this phase.

## 12. pickupEnabled

`pickupEnabled` is a required boolean independent from visibility. `HIDDEN` with pickup enabled is valid.

## 13. Position

Position contains only finite numeric `x` and `y`. Rotation, width, height, and elevation are rejected as unknown fields in G1B.1.

## 14. Lifecycle

Lifecycle is authority-only. Public document presence represents the currently authorized projection; it does not expose transaction or recovery state. This prevents `PENDING` from being mistaken for active public Ground and minimizes distributed data.

The authority states are `PENDING`, `ACTIVE`, `PICKUP_PENDING`, `RECOVERY_REQUIRED`, and `TOMBSTONED`. Valid transitions are explicit. `TOMBSTONED` is terminal. Recovery may return to a state supported by retained evidence, but no recovery workflow is implemented here.

## 15. Universal Item Transfer integration

Authority validation reuses `scripts/items/item-transfer-data.js` and calls `reconstructItemTransferData` to validate that the Universal Item Transfer Snapshot remains reconstructible. No Ground-specific serializer was added. Roundtrip tests preserve nested system data, flags, embedded effects, and formulas.

## 16. Snapshot immutability

Inputs are deep-cloned before validation and persistence. Reads also return deep clones. `updateAuthority` rejects changes to `itemSnapshot`, so later source Item changes or caller mutation cannot alter the persisted creation snapshot through shared references.

## 17. Quantity

Authority quantity is explicit, integer, and at least 1. It cannot exceed a snapshot quantity when `system.cantidad` exists. Items without that property require quantity 1. Quantity is immutable in this primitive and is absent from the public projection.

## 18. Provenance

The authority record retains the minimum planned audit and correlation fields: source Actor UUID, source Item UUID, creator, creation timestamp, and operation ID. They are strict, immutable, and absent from public projection.

## 19. Persistence mechanism

The Level 1 adapter stores versioned per-Scene envelopes in two separate `mtrol` Scene flags:

- `groundPublicProjections`
- `groundAuthorityRecords`

Each envelope contains `schemaVersion`, local monotonic `revision`, `sceneId`, and a `groundId`-keyed record map. The repository writes authority first and public second. If the second write fails, the authority evidence remains and the result is an explicitly detectable `AUTHORITY_ONLY` orphan rather than a blind rollback.

## 20. Level 1 limitation

Both Scene flags are Player-distributable under public Foundry behavior. The class is named `GroundSceneFlagStorage`, exposes `playerDistributable = true`, and its source comment states that it is an authority persistence boundary, never a confidentiality boundary. This implementation provides Level 1 UI privacy only.

## 21. Level 2 migration boundary

`GroundPersistencePrimitive` receives separate `publicStorage` and `authorityStorage` objects with only `read(sceneId)` and `write(sceneId, envelope, { expectedRevision })`. Domain code does not read Scene flags. A contract test runs the complete create/read path against injected in-memory adapters, demonstrating that a future Level 2 authority adapter can replace the physical authority store without changing the Ground model.

## 22. Repository/primitive decision

Ground persistence is a distinct responsibility and was not placed in `TradeRuntimeRepository` or generalized into a cross-domain repository framework. Two cohesive Ground modules are sufficient for this phase.

## 23. Scene scoping

Both envelopes and every contained record must match the requested Scene. `getGroundForScene(sceneId)` reads only that Scene's storage. `sceneId` and `groundId` are immutable through update operations.

## 24. Reload roundtrip

The suite creates a pair, discards the repository instance, constructs a new repository over the same persisted Scene backing, and reads the same canonical records. Reload behavior therefore does not depend on repository RAM.

## 25. Copy safety

Tests mutate create inputs after persistence and mutate read outputs after retrieval. Subsequent reads remain unchanged on both public and authority sides, including nested snapshot flags. Pair equality is structural and independent of object key insertion order.

## 26. Duplicate behavior

Creation fails with `GroundDuplicateError` when either side already contains the requested `groundId`. It does not overwrite, regenerate an ID, or convert duplication into implicit idempotency.

## 27. Corruption behavior

Persistence envelopes and records use exact-field validation. Malformed objects, unknown fields, unsupported schema versions, invalid record keys, and Scene mismatches throw. Validation never normalizes or writes corrupt stored bytes.

## 28. Orphan detection

Pair inspection reports `ABSENT`, `PUBLIC_ONLY`, `AUTHORITY_ONLY`, `MATCHED`, or `MISMATCHED`. Mismatch reasons cover identity, Scene, position, visibility, pickup state, and appearance. No automatic repair is attempted.

## 29. Fail-closed behavior

Invalid schema or corrupt persistence aborts reads and writes. A mismatched or orphaned pair remains classified and available for future inspection; no gameplay consumer exists that could treat it as active. Authority snapshot, quantity, lifecycle, and recovery evidence never fall back to public data.

## 30. Production blast radius

The productive blast radius is two new files under `scripts/ground`. No existing initialization, Canvas, Item, Actor, Trade, ledger, authority, coordinator, dispatcher, command, socket, template, or style file changed for G1B.1.

## 31. Directed tests

The isolated suite completed with 13 tests passed, 0 failed, and 0 skipped.

The related regression run covered Ground persistence, Universal Item Transfer, runtime foundation, authority handoff, all G0 shared-reservation/capacity suites, and all Trade suites. Result: 429 passed, 0 failed, 0 skipped.

## 32. Full suite

`npm test` completed successfully:

```text
tests    1494
pass     1493
fail     0
skipped  1
```

The single skip is the pre-existing manual test. G1B.1 added no skips.

## 33. Known limitations

- Level 1 authority data is distributed to Players and is not confidential at the transport or client-data layer.
- Foundry Scene flags do not expose a server-side atomic compare-and-swap primitive here. Envelope revision checks and the per-Scene queue prevent conflicts within one repository instance but are cooperative client-side controls, not distributed fencing.
- Creating the two physical flags is not one atomic transaction. Authority-first ordering preserves evidence and can leave an `AUTHORITY_ONLY` orphan for later reconciliation.
- Updating corresponding authority and public presentation fields is not an atomic cross-store operation. Pair detection exposes drift; G1B.1 does not reconcile it.
- Ground authority dispatch, authorization checks, durable transactions, recovery execution, gameplay, and presentation remain future phases.

## 34. G1B.2 readiness

G1B.1 meets its completion criteria and preserves the Level 1 and Level 2 boundaries. G1B.2 is ready for architectural review and has not been started.

**Level 1 limitation preserved:** YES  
**Level 2 migration boundary preserved:** YES  
**G1B.2 started:** NO


# G1B.3 — Ground reconciliation + recovery

## 1. Executive summary

G1B.3 adds explicit, deterministic inspection and repair for durable Ground pairs. AuthorityRecord is the only reconstruction source. Repair rewrites only PublicProjection, rereads durable state, and succeeds only when the pair becomes `MATCHED` without changing Authority lifecycle or evidence. Ambiguous, missing-authority, unsafe PENDING, structurally inconsistent, and corrupt states remain blocked and untouched.

## 2. Baseline

Approved baseline: 1507 tests, 1506 passing, 0 failing, and 1 pre-existing manual skip.

## 3. Scope

Implemented read-only inspection, recovery classification, explicit authority-to-public repair, stale-plan protection, idempotent retry, post-write verification, reload validation, and Scene inspection. No startup recovery, gameplay, Canvas, inventory mutation, Trade, ledger, socket, command, GM UI, or Level 2 work was added.

## 4. Files changed

- Modified product: `scripts/ground/ground-repository.js`.
- New product: `scripts/ground/ground-reconciliation-service.js`.
- New tests: `tests/ground-reconciliation-g1b3.test.mjs`.
- New report: `docs/architecture/g1b3-ground-reconciliation-recovery-report.md`.

G1B.1 schemas and the G1B.2 lifecycle service were not modified.

## 5. Tests-first evidence

The G1B.3 test file was created before production. Its initial run failed with exit code 1 and `ERR_MODULE_NOT_FOUND` for `scripts/ground/ground-reconciliation-service.js`: 0 passing tests and 1 failing wrapper. After implementation, 16 tests passed and 2 fixture tests failed because their forced failure targeted the setup write instead of the repair write. Correcting the injection point fixed the fixtures without weakening production behavior.

## 6. RecoveryCoordinator reuse audit

RecoveryCoordinator was not reused. Its repository, receipt, transaction, and presentation contracts are built around Combat/Actor state and opposition/action commands. Ground integration would require a broad transversal refactor and artificial coupling. The existing coordinator remains unchanged.

## 7. Architecture decision

One `GroundReconciliationService` owns inspection and explicit repair. `GroundPersistencePrimitive` received only the missing storage primitives: `readWithRevisions` and revision-guarded `replacePublicProjection`. Recovery policy remains outside the repository.

## 8. Authority source-of-truth invariant

Every repair rereads AuthorityRecord and calls the canonical `projectGroundPublicState`. Repair-plan projection data is never trusted as write content. PublicProjection is never used to construct or modify AuthorityRecord.

## 9. Inspection contract

`inspectGroundRecovery(sceneId, groundId)` performs no writes and returns Scene/ID, pair status, authority lifecycle, issues, classification, recoverability, proposed action, and an optional revision-bound repair plan. `inspectSceneGround(sceneId)` lists inspections without mutation.

## 10. Recovery classification

Classifications are `ABSENT`, `HEALTHY`, `CONSISTENT_PENDING`, `CONSISTENT_TOMBSTONED`, `RECOVERY_REQUIRED`, `MANUAL_REVIEW_REQUIRED`, `REPAIRABLE_FROM_AUTHORITY`, `BLOCKED_MISSING_AUTHORITY`, `BLOCKED_UNSAFE_LIFECYCLE`, `BLOCKED_IDENTITY_MISMATCH`, and `CORRUPT`. They are orthogonal to existing pair statuses.

## 11. ABSENT policy

`ABSENT` is a non-mutating diagnostic with no repair plan. It creates no Ground, record, or ID.

## 12. MATCHED policy

ACTIVE is healthy; PENDING is consistent but not active; PICKUP_PENDING requires manual review; RECOVERY_REQUIRED remains recovery-required; TOMBSTONED is consistent only when its authority invariant is safe. No repair is proposed.

## 13. AUTHORITY_ONLY policy

ACTIVE is repairable by rebuilding Public. TOMBSTONED is repairable only when Authority is already `INVISIBLE` with pickup disabled. RECOVERY_REQUIRED and PICKUP_PENDING can rebuild Public without resolving lifecycle. PENDING is blocked because its current projection contract does not guarantee invisibility and non-interaction.

## 14. PUBLIC_ONLY policy

PUBLIC_ONLY is `BLOCKED_MISSING_AUTHORITY`. Public is preserved. No AuthorityRecord, snapshot, quantity, provenance, lifecycle, or recovery evidence is fabricated.

## 15. MISMATCHED policy

Valid presentation divergence is repaired strictly Authority → `projectGroundPublicState()` → Public. Position, visibility, pickup state, and appearance are covered. Identity and Scene inconsistencies remain blocked/corrupt; IDs are never renamed and Ground is never moved between Scenes.

## 16. PENDING policy

PENDING is never activated. MATCHED PENDING remains consistent non-active. AUTHORITY_ONLY or presentation-divergent PENDING is conservatively blocked.

## 17. ACTIVE policy

MATCHED ACTIVE is healthy. AUTHORITY_ONLY or ordinary MISMATCHED ACTIVE is repairable from Authority without changing lifecycle.

## 18. PICKUP_PENDING policy

Projection reconstruction is allowed while lifecycle remains PICKUP_PENDING. G1B.3 makes no inference about pickup success or rollback and classifies the final MATCHED state for manual review.

## 19. RECOVERY_REQUIRED policy

Projection reconstruction is allowed while lifecycle remains RECOVERY_REQUIRED. A final `MATCHED + RECOVERY_REQUIRED` is deliberately not healthy and still requires transaction-level resolution or review.

## 20. TOMBSTONED policy

TOMBSTONED Authority must be `INVISIBLE` and `pickupEnabled: false`. Missing or stale Public is rebuilt to those values. Unsafe authoritative tombstones are blocked. Repair never makes a tombstone visible, interactable, ACTIVE, or physically deleted.

## 21. Recovery evidence

Repair does not modify AuthorityRecord. Existing `transactionId`, checkpoints, and reason code remain equivalent through repair and retry. No second evidence format or speculative checkpoint was introduced.

## 22. Repair plan

A plan records Scene, Ground ID, pair status, lifecycle, issues, public revision, authority revision, a deterministic full-Authority fingerprint, and proposed projection. Before writing, repair rereads all durable state and derives a fresh projection from current Authority.

## 23. Stale-plan protection

Repair requires identical revisions, pair status, lifecycle, and Authority fingerprint. `replacePublicProjection` rechecks both revisions inside the local Scene queue and verifies the canonical projection against current Authority. Any difference produces a stale-plan failure without a write. These are cooperative/local checks, not server-side distributed CAS.

## 24. Idempotency

Retrying a successful plan returns `NO_OP` only when the pair remains MATCHED and Authority fingerprint is unchanged. It performs no write, revision increment, evidence duplication, or lifecycle change.

## 25. Repair failure

A failed Public write throws `GroundReconciliationError` with `GROUND_REPAIR_WRITE_FAILED`, identifiers, current inspection, and cause. It reports no success, performs no blind rollback, and leaves durable state detectable.

## 26. Post-write verification

After `setFlag` resolves, repair rereads both records and revisions. Success requires `MATCHED` and the same Authority fingerprint. An acknowledged write that did not persist produces `GROUND_REPAIR_VERIFICATION_FAILED`.

## 27. Corruption

Malformed envelopes/records, unsupported schema versions, and structural groundId/sceneId inconsistencies are `CORRUPT`. Inspection performs no normalization, downgrade, deletion, or rewrite. Repair refuses corrupt input.

## 28. Reload

Successful AUTHORITY_ONLY repair survives a new repository instance over the same Scene flags and is identical to the returned canonical state. Partial and failed states also remain detectable.

## 29. Scene inspection

`inspectSceneGround(sceneId)` is read-only and returns per-Ground inspections. There is no `repairAll`, World sweep, timer, or background loop.

## 30. Automatic startup recovery

Automatic startup recovery: NO. No Foundry hook or ready handler was registered. Inspection and repair require explicit invocation.

## 31. Concurrency guarantees

The implementation uses local repository queues, envelope revisions, an Authority fingerprint, reread before repair, conditional replacement, and post-write reread. A stale plan cannot overwrite later state through this boundary.

## 32. Guarantees not provided

- No distributed lock, server CAS, or atomic cross-client transaction.
- No guarantee for independent clients whose remote writes are not mutually observable.
- No AuthorityWriteContext fencing; that belongs to G1B.4.
- No lifecycle outcome resolution for PENDING, PICKUP_PENDING, or RECOVERY_REQUIRED.
- No scheduled recovery, retry loop, repair-all, or destructive cleanup.
- No confidentiality beyond approved Level 1 UI privacy.

## 33. Level 1 limitation

Authority and Public remain in Player-distributable Scene flags. Reconciliation protects logical authority direction and evidence but does not make AuthorityRecord secret.

## 34. Level 2 migration boundary

Reconciliation depends only on GroundPersistencePrimitive and Ground schemas, never Scene flags directly. A future Level 2 authority adapter can preserve the service, plans, identity, projection rules, and public storage contract.

## 35. Directed tests

G1B.3 isolated: 19 passed, 0 failed, 0 skipped. All Ground tests: 45 passed, 0 failed, 0 skipped. The related Ground, Item Transfer, persistence/runtime, receipt/recovery, and authority-handoff run completed 86/86.

## 36. Full suite

Final `npm test`: 1526 total, 1525 passed, 0 failed, 1 skipped. The skip is pre-existing and manual; G1B.3 adds none.

## 37. Known gaps

G1B.4 must add authenticated command admission, Primary GM enforcement, AuthorityWriteContext revalidation, and command-level receipts/idempotency. G1B.3 leaves ambiguous lifecycle outcomes for explicit policy and does not close Foundry's distributed write window.

## 38. G1B.4 readiness

Inspection and repair are explicit, deterministic, fail-closed, evidence-preserving, reload-safe, and ready for the existing authority/command boundary. G1B.4 has not started.

**RecoveryCoordinator reused:** NO — it is coupled to Combat/Actor receipts and action recovery.  
**AUTHORITY_ONLY ACTIVE auto-repairable:** YES.  
**PUBLIC_ONLY auto-repairable:** NO.  
**MISMATCHED Authority → Public repair:** YES for valid presentation divergence.  
**PENDING auto-activation:** NO.  
**PICKUP_PENDING automatic resolution:** NO.  
**RECOVERY_REQUIRED automatic lifecycle resolution:** NO; Public may be reconstructed while lifecycle remains RECOVERY_REQUIRED.  
**TOMBSTONED invariant preserved:** YES.  
**Automatic startup recovery:** NO.  
**Level 2 migration boundary preserved:** YES.  
**G1B.4 started:** NO.

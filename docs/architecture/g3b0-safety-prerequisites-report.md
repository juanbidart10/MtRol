# G3B.0 — Safety Prerequisites Report

## Scope

G3B.0 implements only the approved safety prerequisites. It does not reserve capacity for Ground, debit or delete a source Item, add stack quantity to the payload, enable pickup, support competence, support unlinked synthetic Actors, or perform transactional unequip. Productive destructive Ground Drop remains disabled.

## Implemented guarantees

### Single Ground receipt owner

`ground.drop` remains on the existing socket and `CommandRegistry`, but its registration is non-idempotent at the outer registry layer. The existing `TransactionCoordinator` is now the sole execution owner of the existing Scene Ground receipt scope. No receipt store or coordinator was added.

`TransactionCoordinator` accepts a canonical fingerprint, persists it when beginning the receipt, and asks the existing `ReceiptStore.assertIdentity()` to reject a same-transaction changed payload. Same transaction and same payload replays the completed result; changed position still produces `RECEIPT_IDENTITY_CONFLICT`.

The coordinator also revalidates the supplied AuthorityWriteContext before receipt progress and completion writes and supplies the same authority assertion to reconciliation.

### PENDING visibility boundary

`ground.drop` now prepares one durable Ground ID, creates the Ground as PENDING + INVISIBLE + pickup disabled, checkpoints it, transitions authority lifecycle to ACTIVE, and only then publishes REVEALED while pickup remains disabled. Players cannot render the staged PENDING projection; the existing GM administrative INVISIBLE representation remains available.

This is still the non-destructive G3A canary: source quantity and source document remain unchanged.

### Approved MVP policy guards

The Primary command rejects:

- an Item whose normalized `system.equipado` is true;
- an Item referenced by an actual Actor equipment slot;
- an Actor with `isToken === true`, which is the Foundry synthetic/unlinked Actor boundary.

World Actors and linked-token resolution to their persistent World Actor remain supported. Object types remain `objeto` and legacy `item`; competence remains excluded.

### Ground recovery discovery

The existing `RecoveryCoordinator` now enumerates nonterminal `ground.drop` receipts across Scenes only while the local runtime is Primary. It delegates each transaction to the same `TransactionCoordinator` and Ground lifecycle reconciliation. The discovery runs on ready and after active-user authority changes.

For the current non-destructive flow, a MATCHED PENDING INVISIBLE Ground can recover forward to ACTIVE and then REVEALED. An ACTIVE INVISIBLE Ground can finish publication. Unknown, orphaned, or ambiguous evidence remains recovery-required. No `GroundRecoveryCoordinator` or scheduler was added.

### Lost ACK transport retry

The socket timeout now returns the stable `SOCKET_TIMEOUT` reason code and can suppress its generic warning for callers that own an ambiguity-safe retry policy. Ground uses that option and retries once with the same `transactionId`. The retry therefore joins the in-flight `TransactionCoordinator` execution or reads its durable Scene receipt; it cannot create a second Ground. Ground only reports an error after the retry also fails, instead of declaring failure while the Primary may still be completing the first request.

### Trade canonical capacity lifecycle

`SharedReservationLedger.mutateReservationSet()` gained an atomic `TRANSITION` operation using the existing mutation ID, fingerprint, expected revision, authority checks, and one persisted draft mutation. Transition-only batches do not revalidate capacity against a post-debit real quantity because COMMITTING and RECOVERY_REQUIRED deliberately retain an in-flight claim after the physical source may have changed.

Trade now performs narrow lifecycle transitions:

- execution begins: RESERVED → COMMITTING;
- ambiguous execution: RESERVED/COMMITTING → RECOVERY_REQUIRED;
- verified completion: COMMITTING/RECOVERY_REQUIRED → COMMITTED;
- proven rollback: COMMITTING/RECOVERY_REQUIRED → ROLLED_BACK.

Reservations RELEASED by older offer revisions are ignored when execution transitions the current set. Pre-effect cancellation keeps the existing RELEASED path. RECOVERY_REQUIRED continues consuming capacity. These changes use the existing shared ledger and Trade runtime setting.

On hydration, an active EXECUTING session converges legacy RESERVED records to COMMITTING, and a RECOVERY_REQUIRED session converges them to RECOVERY_REQUIRED. A capacity-consuming Trade reservation whose owning active session is absent cannot be proven committed or rolled back; it is conservatively changed to RECOVERY_REQUIRED with `ORPHANED_TRADE_RESERVATION` evidence and continues blocking capacity.

## Remaining platform boundary

The changes provide local authority fencing and durable state. Foundry still has no public atomic boundary that rejects a write sent by a GM whose authority becomes stale before server acceptance. Any such send/accept window must be re-read and treated as ambiguous. G3B.1 must retain the Ground and blocking reservation after a source debit may have been sent.

## Files

Productive files changed for G3B.0:

- `scripts/runtime/ground-commands.js`
- `scripts/runtime/transaction-coordinator.js`
- `scripts/runtime/recovery-coordinator.js`
- `scripts/runtime/shared-reservation-ledger.js`
- `scripts/trade/trade-session-service.js`
- `scripts/core/ready.js`
- `scripts/core/socket-requests.js`
- `scripts/ground/ground-drop-adapter.js`

Tests added or updated:

- `tests/ground-drop-canary-g3a.test.mjs`
- `tests/ground-command-authority-g1b4b.test.mjs`
- `tests/ground-recovery-discovery-g3b0.test.mjs`
- `tests/trade-offer-capacity-adoption-2b-r3.test.mjs`
- `tests/phase6-profiling-stress.test.mjs`

## Tests-first evidence

Before productive changes, the focused run reported 33 pass and 6 fail. The failures demonstrated the outer receipt owner, missing post-ACTIVE publication boundary, and absent Trade COMMITTING/COMMITTED/RECOVERY_REQUIRED/ROLLED_BACK transitions. The new recovery-discovery suite separately failed 2/2 before the coordinator method existed. A released-offer-history test also failed before the execution filter was corrected.

After implementation, the focused suites pass. Final `npm test`: **1594 pass, 0 fail, 1 skip, 1595 total**.

## Persistence and migration

No schema version changed and no one-shot migration is required. Existing Ground Scene receipts and Trade reservation records retain their current shapes. New receipts may include their payload fingerprint and prepared Ground identifiers. Hydration performs the conservative lifecycle reconciliation described above; it never guesses an orphan RESERVED record into COMMITTED or ROLLED_BACK.

## Status

G3B.0 safety prerequisites are implemented. G3B.1 destructive source deletion and Ground shared reservation are not implemented or enabled.

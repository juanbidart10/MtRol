# G3B — Transactional Ground Drop Audit

## 1. Executive summary

G3A has a sound command and persistence path for a non-destructive canary, but it is not yet a transfer. `ground.drop` creates and activates a Ground of quantity 1 while leaving the source Item unchanged. A safe destructive slice can be built with the existing `AuthorityService`, `SharedReservationLedger`, `TransactionCoordinator`, Ground lifecycle/repository, Universal Item Transfer, socket dispatcher, and Scene receipt scope. No second coordinator, ledger, dispatcher, or Primary selector is justified.

The minimum safe ordering is: persist transaction intent, reserve shared capacity, create an **INVISIBLE** PENDING Ground, verify it, transition the reservation to COMMITTING, debit with an expected source state, verify the source, checkpoint that evidence, activate and reveal the Ground, verify it, commit the reservation, and complete the receipt. Any ambiguity after debit may have been sent must retain the Ground and reservation and enter recovery. Automatic release or tombstoning is safe only while durable evidence proves that debit never began.

Four implementation prerequisites exist. First, `ground.drop` cannot simultaneously be wrapped by `CommandRegistry`'s idempotent receipt execution and use `TransactionCoordinator` with the same Scene scope and transaction ID; the coordinator must become the single owner of that existing receipt. Second, G3A currently publishes PENDING with `REVEALED`, and the public projection has no lifecycle, so Players can see it before transfer commit. Third, no reusable source-debit primitive currently provides the required expected-state and reconciliation contract. Fourth, `RecoveryCoordinator` does not discover Scene Ground receipts. These are resolvable within existing infrastructure; they are not evidence of an unimplementable architecture.

Foundry's public API does not provide atomic compare-and-swap across Scene flags, world settings, and Actor embedded Item writes, nor server-side fencing of a stale GM. The design therefore provides local authority fencing plus durable operation evidence, not distributed/server fencing. The remaining send/accept race must always be classified conservatively.

## 2. Current G3A path

The path verified against the current files is:

1. **transactionId origin.** `createGroundDropCanvasHandler()` in `scripts/ground/ground-drop-adapter.js` creates it client-side with `foundry.utils.randomID()` and sends it in the socket envelope.
2. **Exact client payload.** `{ sourceActorUuid, sourceItemUuid, sceneId, position: { x, y } }`. Quantity is not present.
3. **Adapter validation.** It accepts only `type: "Item"`, a nonempty UUID, an embedded Actor Item, an MtRol Actor (`personaje`/`character`), and an MtRol object (`objeto`/legacy `item`). It rejects world Items, Compendium Items, mismatched parent collection entries, and forged MtRol internal drag metadata. It claims synchronously by returning `false` and vetoes the same candidate at the Item Piles hook.
4. **Primary validation.** The existing socket route authenticates the actual sender, rejects spoofing, targets the current Primary GM, and dispatches through the existing `CommandRegistry`. The command validates an existing Scene, exact finite `{x,y}`, exact field sets, requesting user, and `requestingUser.viewedScene === sceneId`.
5. **Actor resolution.** `dropGround()` resolves `sourceActorUuid` with `fromUuid()` on the Primary and requires an Actor plus requesting-user ownership.
6. **Item resolution.** It resolves `sourceItemUuid` independently, then requires the exact Item to be contained by that Actor and to have the same UUID.
7. **Snapshot.** `createItemTransferSnapshot()` runs from the authoritative Item after type and effective-quantity validation.
8. **PENDING birth.** `GroundLifecycleService.createPendingGround()` generates/accepts the Ground ID, writes Authority first and Public second, and verifies a MATCHED PENDING pair.
9. **Activation.** `activateGround()` changes authority lifecycle PENDING to ACTIVE and verifies the durable pair. Lifecycle is not a public field.
10. **Receipt storage.** `ground.drop` is registered idempotent and targets `createGroundReceiptScope(sceneId)`. Receipts live in Scene flag `flags.mtrol.groundCommandReceipts`.
11. **Existing AWC points.** One context is created at command start. The handler validates before PENDING creation, after it, and around activation. Repository mutations validate before Authority and Public writes. These checks are local fencing.
12. **Retry.** Same transaction ID and same payload fingerprint replays the completed CommandRegistry receipt. A receipt still processing produces the receipt-store in-progress behavior; a failed receipt is not blindly re-executed.
13. **Changed payload.** Same transaction ID with changed payload, including position, conflicts as `RECEIPT_IDENTITY_CONFLICT`.
14. **Authority change.** A detected generation/identity change prevents subsequent locally guarded writes. It cannot retract a Foundry write already sent. Partial Ground persistence can remain for reconciliation; the present canary has no source debit.

The current G3A result is deliberately `SOURCE=1, GROUND=1`.

## 3. Quantity semantics

`system.cantidad` is the only inventory stack field used by current object logic. `MTROL_OBJECT_TYPES` is `objeto` and legacy `item`; `competencia` is a separate type. `analyzeItemQuantity()` prefers persisted `item._source.system.cantidad` and reports whether existence is present, absent, or indeterminate because a DataModel may materialize a default.

For objects, a finite numeric value or numeric string at least zero is accepted by analysis. Absence means effective quantity 1. Zero is a valid projection value but is not transferable/reservable: the Ground schema and ledger require a positive safe integer. Negative, null, empty, nonnumeric, and nonfinite values are invalid. A successful full debit must delete the embedded Item rather than persist quantity zero; a partial debit writes `N-Q`.

`competencia` has no established stack contract in inventory code. Universal transfer can snapshot it, but Ground G3A rejects it through `isMtrolObject()`, and Ground requires quantity 1 when the snapshot lacks `cantidad`. Supporting competence is therefore a product-policy expansion, not part of the first destructive slice.

## 4. Source mutation primitives

There is no canonical reusable decrement primitive with idempotency, durable checkpoints, expected/current quantity, and recovery classification.

- Trade calls `Actor.updateEmbeddedDocuments("Item", [{_id, "system.cantidad": remaining}])` or `Actor.deleteEmbeddedDocuments("Item", [id])`. It compares the current quantity to the prepared source and remaining quantities, but this is application-level checking rather than server CAS.
- Consumables decrement with direct Item/embedded updates or delete one unit through consumable/equipment paths. They include domain side effects and are not a general Ground primitive.
- Sheet deletion unequips and deletes, but is interactive, non-transactional, and not receipt-idempotent.
- Foundry embedded create/update/delete calls emit normal hooks. Trade uses options such as `mtrolTradeExecutionId` and `mtrolTradeRollback` to identify its own effects and bypass its reservation guards.

A Ground-local helper inside the command module is sufficient for the first slice; a new `QuantityService` is not justified. Its contract must accept prepared item identity, expected `N`, requested `Q`, transaction ID, and `assertAuthority`; classify current state as `N` (not applied), `N-Q`/missing for full drop (applied), or ambiguous; and verify after mutation. It must not alter equipment. For MVP, equipped Items are rejected before reservation.

No public Foundry operation atomically checks `N` and applies the embedded update. The check-to-write window remains and must be covered by reservation, local serialization, hooks, evidence, and recovery rather than described as CAS.

## 5. Universal Item Transfer

`createItemTransferSnapshot()` deep-clones the full Item document into schema version 1 with `sourceUuid`. It accepts `objeto`, legacy `item`, and `competencia`, validates `system`, and isolates later input/output mutation.

`reconstructItemTransferData()` clones again and strips top-level `_id`, `id`, `uuid`, `parent`, `actor`, `ownership`, `folder`, `sort`, and `_stats`. Flags are retained. Effects and their IDs are retained, effect `_stats` is removed, and an effect whose `origin` equals the source UUID is remapped only when a destination Item UUID is supplied. Other opaque origins remain. If present, `system.equipado` and `system.equipadaCombate` become false; `system.slot` is not cleared by this utility.

An explicit partial quantity must be a positive safe integer, the snapshot's `system.cantidad` must be a positive safe integer, and `Q` cannot exceed it. Only the reconstructed clone receives `system.cantidad=Q`; the original snapshot remains unchanged. Ground already stores the immutable source snapshot and a separate canonical Ground `quantity`, so this is the correct place to express Q. A Ground stored snapshot should not be rewritten merely to represent a partial transfer.

Items with no `cantidad` may only be quantity 1 under the current Ground schema. The first slice should retain that rule.

## 6. SharedReservationLedger

The real public API is: `setAuthorityService`, `hydrate`, `hydrateFromPersistence`, `list`, `get`, `getResourceQuarantine`, `listResourceQuarantines`, `quarantineResource`, `reservedQuantity`, `reserve`, `mutateReservationSet`, `reacquireReservation`, `replaceReservation`, `replaceReservationsBatch`, `transition`, `release`, `commit`, `rollback`, and `recoveryRequired`.

A reservation contains `operationId`, `domain`, `actorUuid`, `itemUuid`, positive integer `quantity`, `state`, `fingerprint`, `authorityGeneration`, `revision`, `evidence`, and timestamps. Capacity identity is exact Actor UUID plus Item UUID. `RESERVED`, `COMMITTING`, and `RECOVERY_REQUIRED` consume capacity; `COMMITTED`, `ROLLED_BACK`, and `RELEASED` do not. Legal transitions are RESERVED to COMMITTING/RELEASED/RECOVERY_REQUIRED; COMMITTING to COMMITTED/ROLLED_BACK/RECOVERY_REQUIRED; and RECOVERY_REQUIRED to COMMITTED/ROLLED_BACK. Terminal records cannot be reused except through the explicit reacquire contract.

Same operation ID and fingerprint is idempotent; a changed fingerprint conflicts. `mutateReservationSet()` adds durable `mutationId`/fingerprint replay and atomically mutates a draft set for CREATE, REPLACE, REACQUIRE, and RELEASE without an observable release-first state. Existing-record changes require `expectedRevision`. Capacity is checked against the sum of all active reservations, regardless of domain.

Persistence is the world setting `mtrol.tradeRuntime`, through `TradeRuntimeRepository`, despite the ledger's cross-domain role. Local queues and application revisions serialize one runtime instance and detect some stale state, but the Foundry server does not enforce an atomic expected revision. AWC checks occur around ledger logic; the final settings write still has the known send/accept race.

Trade currently uses stable IDs `trade:<sessionId>:<participantKey>:<itemUuid>` and one set mutation per offer revision/cancel. It hydrates legacy reservations and quarantines equivocal resources. A material lifecycle gap remains: the inspected Trade execution does not call ledger `transition`, `commit`, `rollback`, or `recoveryRequired`. Canonical offer reservations therefore remain RESERVED after execution unless another path explicitly changes them. This is conservative for safety but can leak capacity and must be fixed or explicitly reconciled before cross-domain production use. Ground must not copy this omission.

Ground should use one stable ID such as `ground-drop:<transactionId>` with domain `ground`, exact source UUIDs, Q, payload fingerprint, Ground ID, and debit evidence. The transaction ID must never be regenerated on retry.

## 7. Trade contention

The ledger already expresses the correct capacity rule:

`available(S) = realQuantity(S) - sum(active reservations for S across every domain)`.

For real quantity 5 and Trade RESERVED 4, a Ground reservation of 3 must fail and leave Trade unchanged. Ground needs only to hydrate the same singleton ledger and reserve domain `ground` against the same Actor/Item resource key. Ground source mutations must pass a Ground-specific mutation marker through the existing inventory guard boundary so its own reservation does not block its authorized debit; unrelated Trade/Ground reservations remain enforced.

Because current Trade commit does not close its canonical reservations, contention is safe but may become permanently unavailable. Resolving that lifecycle leak belongs in a narrow shared-capacity prerequisite, not a Trade refactor.

## 8. Drop contention

For two different transactions over a one-unit Item, the shared ledger can select one winner within a single Primary runtime: the first RESERVED record consumes all capacity and the second fails. Same transaction ID plus same fingerprint replays; same ID plus changed Q/position conflicts. Different IDs remain different owners.

Local ledger/repository queues serialize calls in one JavaScript runtime. Socket routing admits only the current Primary. Lost ACK is safe only when the client retries the original transaction ID. A new drag creates a new ID and is protected by the surviving active reservation/source state, not by receipt identity.

Exactly one winner cannot be claimed as a distributed guarantee during overlapping old/new Primary writes. A stale GM may pass local AWC validation, send a setting or Actor write, lose authority, and still have the server accept it. Durable ambiguity must remain RESERVED/COMMITTING or become RECOVERY_REQUIRED and block capacity until the new Primary reconciles it.

## 9. Equipped audit

MtRol represents equipment through both Item fields (`system.equipado`, declared `system.slot`, and some combat-equipment fields) and Actor equipment-slot references under `system.equipamiento`. Equipment transitions update Actor slot references and Item flags, with attempted rollback. Combat calculations, bonuses, dual-weapon/armor state, hooks, sheet state, and caches can therefore remain inconsistent if an equipped Item is deleted directly.

| Policy | Complexity and invariant | Recovery risk |
|---|---|---|
| A — reject equipped | Validate both normalized Item flags and actual Actor slot references before reservation and again before debit. Drop touches only quantity/document existence. | Lowest. A state change to equipped after reservation makes debit refuse and recover/release only with no-debit proof. |
| B — transactional unequip | Adds Actor slot writes, Item flag writes, recalculation/hooks, checkpoints, and compensation before the inventory transfer. | High. Partial unequip plus authority loss requires multi-document reconciliation and may affect combat. |

MVP recommendation: **Policy A**, including actual slot-reference checks rather than trusting only `system.equipado`. Policy B should be a later separately tested transaction expansion.

## 10. Synthetic Actor audit

A World Actor Item and an Item on a linked Token resolve to the persistent base World Actor. An unlinked Token's Actor is synthetic: Foundry constructs it from the Token's `ActorDelta`. Embedded Item updates/deletes are translated through the Token/ActorDelta backend, including deltas and tombstones. The synthetic Actor object itself is ephemeral; durable identity depends on Scene and Token, reload reconstructs it, and deleting/moving the Token can remove the recovery boundary.

MtRol already treats synthetic Actors as non-write-eligible in item-data repair. Trade can identify token participants, but the inspected transfer receipt and source identity do not establish a complete token/ActorDelta recovery contract. `fromUuid()` resolving a synthetic Item is therefore insufficient evidence of durable recoverability.

| Policy | Cost and risk |
|---|---|
| A — World/linked only | Validate that the effective source is a persistent World Actor (a linked token resolves to it). Existing Actor/Item UUID and embedded CRUD contracts apply. Smallest test matrix. |
| B — support unlinked now | Persist Scene UUID, Token UUID, ActorDelta identity, base Actor/item relation, and token existence; reconcile inherited-item delta updates/tombstones across reload and token deletion. Considerably larger failure surface. |

MVP recommendation: **Policy A**. Synthetic support needs its own audited identity and recovery slice.

## 11. Candidate transaction ordering

Recommended ordering:

1. Validate authenticated request, ownership, policy, N, Q, Scene, and position.
2. Let `TransactionCoordinator` begin/prepare the existing Scene receipt and persist fingerprint, source identity, N, Q, and one generated Ground ID.
3. AWC validate; reserve `ground-drop:<tx>` as RESERVED in the shared ledger.
4. Checkpoint reservation evidence.
5. AWC validate; create Ground PENDING with `INVISIBLE`, pickup false, snapshot, Q, operation ID, and the prepared Ground ID.
6. Verify MATCHED/PENDING/INVISIBLE and checkpoint.
7. AWC validate; transition reservation RESERVED to COMMITTING with pre-debit evidence.
8. AWC validate immediately before source update/delete; apply only from exact expected N.
9. Re-resolve and verify exact `N-Q` or absence when `Q=N`; checkpoint debit evidence.
10. AWC validate; activate authority state, then publish the intended visibility while keeping pickup false; verify MATCHED/ACTIVE and checkpoint.
11. AWC validate; commit the reservation.
12. AWC validate; persist applied result and complete the receipt; only then return success/ACK.

PENDING-first avoids silent loss if Ground creation fails. Making it INVISIBLE avoids a visible duplicate while source still exists. Debit-first would risk loss between source mutation and Ground creation. ACTIVE-first would expose a committed-looking duplicate. Releasing before debit creates an oversubscription window. Committing reservation before verified Ground publication removes the capacity block too early.

The CommandRegistry/TransactionCoordinator receipt collision must be resolved by making `TransactionCoordinator` the sole execution owner for `ground.drop` in the existing Ground Scene scope. The command boundary may remain registered and validated, but its outer `idempotent` wrapper cannot pre-create the same receipt. Fingerprint conflict checking must be retained in the coordinator-owned prepared data. This reuses the existing receipt store rather than adding one.

## 12. Failure matrix

`R` means RESERVED, `C` COMMITTING, `RR` RECOVERY_REQUIRED, and `TC` transaction receipt. “Source N-Q” includes source absence for Q=N.

| Point | Source | Ground | Reservation | TC | Safe action and invariant |
|---|---:|---|---|---|---|
| F0 before reservation | N | none | none | prepared or no-effects | Retry same tx; no effects. |
| F1 after reservation | N | none | R | checkpointed R | With proof debit never began, retry PENDING creation or release and fail. Available source is N-Q. |
| F2 during PENDING creation | N | none/AUTHORITY_ONLY/MATCHED | R | applying | Inspect Ground. Complete Public if unequivocal; otherwise retain R/RR. Release only after proving no Ground ambiguity and no debit. |
| F3 after PENDING persisted | N | MATCHED PENDING INVISIBLE | R | PENDING checkpoint | Retry forward. Tombstone plus release is allowed only before COMMITTING/debit. |
| F4 during source debit | N, N-Q, missing, or other | PENDING INVISIBLE | C | pre-debit checkpoint | Ambiguous. Set/retain RR, inspect exact source; never repeat or compensate blindly. |
| F5 after debit persisted | N-Q/missing | PENDING INVISIBLE | C | debit checkpoint may be absent | Source inspection can prove applied when exact. Activate forward; do not release/tombstone. |
| F6 during source verification | N-Q/missing or other | PENDING INVISIBLE | C | applying | Exact expected result permits checkpoint/forward recovery; any other state requires RR/human review. |
| F7 during Ground activation/reveal | N-Q/missing | PENDING/ACTIVE, public invisible/revealed, or mismatch | C | debit checkpoint | Reconcile Ground pair. Prefer finishing activation/reveal; keep capacity blocked. |
| F8 after Ground ACTIVE | N-Q/missing | ACTIVE, intended public state | C | activation checkpoint may be absent | Verify both sides, then commit reservation and receipt. No source compensation. |
| F9 during reservation commit | N-Q/missing | ACTIVE | C/COMMITTED | activation checkpoint | Idempotently inspect/commit same reservation. Ground and source already conserve N. |
| F10 after reservation commit | N-Q/missing | ACTIVE | COMMITTED | applying/applied | Complete receipt from durable evidence. Do not debit again. |
| F11 during receipt persistence | N-Q/missing | ACTIVE | COMMITTED | applying/applied/completed or write uncertain | Re-read receipt and domain state; reconstruct success only if all evidence matches. |
| F12 lost ACK after success | N-Q/missing | ACTIVE | COMMITTED | completed | Same tx/same payload replays identical result. Changed payload conflicts. |
| F13 Primary changes | depends on boundary | depends | depends | depends | New local writes stop when AWC detects loss. Any write already sent is ambiguous; new Primary reconciles durable evidence. |
| F14 client disconnect | unchanged by itself | depends | depends | depends | Primary operation may finish. Client reconnect retries same tx or reads result; never cancel based only on disconnect. |
| F15 process interruption | last durable state | last durable state | last durable state | last durable state | On Primary ready/handoff, discover Scene receipts and reconcile forward or RR. Local queues are gone after restart. |

At every row, automatic release is limited to durable proof that no irreversible or ambiguous source effect began. “Rollback succeeded” cannot be asserted from an attempted compensation alone.

## 13. Conservation model

Let `N` be prepared source quantity and `Q` the requested transfer. Define:

- `P`: physical quantity still represented by the source Item (`0` if deleted).
- `G`: quantity stored in the Ground authority record, whether PENDING or ACTIVE.
- `V`: committed/player-visible Ground quantity; `0` until ACTIVE and revealed, then `Q`.
- `L`: active reserved capacity for this source across all domains.
- `D`: durable in-flight transfer claim: `0` until debit is proven; `Q` after debit is proven and before Ground is committed/visible; otherwise `0`.

The stable endpoints are:

`before: P=N, G=0, V=0`

`success: P=N-Q, G=Q, V=Q`.

The availability rule before debit is `available=P-L`, so RESERVED Q prevents another operation from consuming those units. The committed entitlement invariant is:

`P + V + D = N`.

During PENDING-before-debit, physical storage contains `P+G=N+Q`; this is a deliberate durable staging copy and must not be hidden in the formula. It is not available because `V=0`, pickup is false, and L includes Q. After proven debit but before activation, `P+G=N`, while `D=Q` bridges the not-yet-visible entitlement. During ambiguous debit, no single quantity equation may be asserted until source is inspected; the active/RR reservation prevents further commitments.

## 14. PENDING semantics

The public projection contains visibility, appearance, position, and pickup state, but no lifecycle. G2 filters by Scene and visibility, not authority lifecycle. A Player does not render INVISIBLE; a GM renders it as an administrative translucent marker. `pickupEnabled=false` prevents a future pickup path but the current renderer is noninteractive regardless.

G3A creates PENDING with `REVEALED`, so it can render to Players while the source still exists. Transactional Drop must instead create PENDING as INVISIBLE and false pickup, then publish intended visibility only after verified debit and ACTIVE authority state. This is a small future lifecycle call-site change; adding public lifecycle is unnecessary for the minimum slice.

## 15. Quantity UX

MtRol uses both legacy `Dialog`/`Dialog.wait()` and Foundry v2 `DialogV2.confirm()`. There is no reusable inventory quantity picker with this contract.

Selection belongs in `ground-drop-adapter.js` before sending. For effective N greater than 1, show a quantity input constrained to positive integers with default 1 and maximum displayed N; for non-stack/single quantity, send 1 without a dialog. Cancellation sends no command. The future minimal payload is:

```js
{
  sourceActorUuid,
  sourceItemUuid,
  sceneId,
  position: { x, y },
  quantity
}
```

The client value is intent only. The Primary must re-resolve the Item, recompute real quantity and shared availability, validate Q, create the snapshot, and reserve. Client N is neither needed nor trusted.

## 16. Receipt and idempotency

The transaction fingerprint must cover the complete canonical payload, including quantity and position. Prepared evidence must durably include source Actor/Item UUIDs, prepared N, Q, Ground ID, Scene ID, position, snapshot identity/version, ledger operation ID, authority context, and policy classification.

- Same tx plus same payload returns the same completed result.
- Same tx plus changed quantity or position returns `RECEIPT_IDENTITY_CONFLICT` before any new effect.
- A retry after lost ACK inspects/replays the receipt and never applies debit twice.
- A retry from an incomplete receipt invokes deterministic reconciliation, not a fresh operation.

Success may be returned only after source verification, MATCHED ACTIVE Ground with intended public state, COMMITTED ledger record, and a durable completed Scene receipt. If the final receipt write is uncertain, return recovery/ACK-unknown behavior even if domain state appears successful; a later same-tx read can complete from evidence.

## 17. RecoveryCoordinator

The current `RecoveryCoordinator` scans combat and Actor receipt stores for damage/resource/orb and related transaction families. Ready hooks run combat/Actor recovery for the Primary; Trade runs its separate authoritative session recovery. Ground Scene receipts are not discovered, and the coordinator's conflict-key logic has no Ground source resource key.

`TransactionCoordinator` can reconcile an individual Ground transaction on same-tx retry using the Scene receipt scope, but that does not solve unattended reload/handoff discovery. The narrow extension is to teach the existing recovery startup path to enumerate Scenes with unresolved Ground receipts and invoke a Ground reconciliation callback under current Primary authority. It should use the same coordinator and Ground reconciliation service. It must not introduce `GroundRecoveryCoordinator` or a second scheduler.

Recovery jobs need the prepared source identity/N/Q/Ground ID, checkpoints, ledger record/evidence, current source state, and Ground reconciliation classification. Recovery reruns on Primary ready/handoff and explicit same-tx retry. It may complete forward when evidence is exact; otherwise it retains RR and reports human review.

## 18. Authority and AWC

Create one `AuthorityWriteContext` for the transaction and validate it immediately before: ledger reserve; every Ground Authority/Public write; transition to COMMITTING; source update/delete; every checkpoint declaring progress; activation/reveal; ledger commit/rollback/release; compensation; applied/completed receipt writes. `TransactionCoordinator` already validates at start, before checkpoints, and before final applied status, but the domain `apply` must call its supplied `assertAuthority` before each external effect.

The unavoidable public-API window is:

`AWC valid -> write sent -> authority lost -> Foundry accepts write`.

No persisted epoch makes the Foundry server atomically reject that stale writer. AWC is local fencing; receipts/ledger/Ground records are durable operation state; neither constitutes distributed/server fencing. A failure or handoff adjacent to a write is treated as ambiguous until re-read. The new authority must never infer “not applied” merely because the old authority threw or disconnected.

## 19. Required failure-injection tests

Tests must be written before productive mutation. Each must assert source plus committed Ground plus in-flight claim conservation, active-capacity exclusion, and exact durable evidence.

| Test | Precondition and injected fault | Expected durable/recovery result |
|---|---|---|
| Reservation failure | source N, no Ground; ledger persist/capacity failure | no Ground/debit; failed no-effects receipt or prepared retry; conservation N. |
| PENDING Authority write failure | R exists; first Scene authority flag fails | source N; no/missing Ground; R retained until no-effect proof, then safe release. |
| Public projection failure | Authority-only PENDING injected | source N; Ground reconciliation classification reflects orphan; no debit; repair or RR before continuing. |
| Source decrement failure | verified PENDING, C; update rejects | source re-read N permits no-effect classification; otherwise RR; Ground stays invisible. |
| Source delete failure | N=Q; delete rejects/accepts ambiguously | exact existing N may retry; missing proves applied; any other state RR. |
| Source verify failure | mutation returns but verification throws | C/RR and invisible Ground retained; recovery re-resolves source. |
| Activation Authority failure | debit checkpointed | source N-Q, PENDING, C/RR; recovery completes forward. |
| Activation Public failure | ACTIVE authority but public invisible/mismatched | source N-Q; keep C/RR; reconcile public then commit. |
| Reservation commit failure | verified ACTIVE | source N-Q, Ground Q, C/RR; retry same transition, no source write. |
| Receipt failure | all domain state committed; applied/complete write fails | later reconciliation reconstructs one success; no debit repeat. |
| Authority handoff | inject A->B at each external/checkpoint boundary and B->A | old generation stops locally; ambiguous sent write is inspected; old context never regains validity. |
| Lost ACK | drop fully completes then socket reply is lost | same tx returns identical Ground/result and source remains N-Q. |
| Same-tx retry | concurrent and post-reload duplicates | one reservation, Ground, and debit; changed Q/position conflicts. |
| Different-tx contention | N=1, TX-A/TX-B reserve concurrently | one active winner; loser no effects; include reload and handoff caveat tests. |
| Trade contention | Trade reserves 4 of 5, Ground asks 3; reverse order too | second request fails, first record unchanged, total active <=5. |
| Reload recovery | interrupt at every F1-F11 boundary | new Primary discovers Scene receipt and either completes exact forward state or retains RR. |
| Equipped race | item becomes equipped after validation/before debit | no debit; release only with proof; no dangling slot. |
| Source external mutation | source changes from N to value other than N-Q | no blind debit/compensation; resource RR/quarantined as appropriate. |

These tests require fakes that distinguish “write rejected” from “write applied then ACK/error lost.” Passing only the rejection case does not cover ambiguity.

## 20. Proposed phase split

1. **G3B.0 prerequisites:** tests-first receipt ownership change for `ground.drop`; PENDING invisible/reveal boundary; Ground receipt discovery in existing recovery startup; Ground reservation lifecycle; close or explicitly reconcile the current Trade canonical-reservation completion leak. No destructive runtime enablement yet.
2. **G3B.1:** transactional quantity 1 only, non-equipped, World/linked Actor, `objeto`/legacy `item`, shared contention, full-delete path, failure injection, reload/handoff, and lost ACK. Keep pickup false.
3. **G3B.2:** object stack/partial Q, quantity dialog, decrement path, same-source concurrent tests, and full/partial recovery matrix.
4. **G3B.3:** separately approved policy expansions: competence and/or transactional unequip. Synthetic/unlinked Actor support should be its own slice because it changes durable identity and ActorDelta recovery.

This split exercises the destructive full-delete boundary in G3B.1 while limiting quantity and equipment combinations.

## 21. Human decisions

The following require explicit approval before productive implementation:

1. **Equipped:** reject for MVP (recommended) or include transactional unequip.
2. **Synthetic/unlinked:** reject for MVP (recommended) or first design Token/ActorDelta identity and recovery.
3. **Partial stacks:** positive integer Q, absence treated as non-stack quantity 1, zero never persisted (recommended), plus exact dialog wording/default.
4. **PENDING visibility:** INVISIBLE to Players until verified debit and ACTIVE; GM administrative marker remains visible (recommended), or suppress even GM rendering through a broader public contract change.
5. **Post-debit activation ambiguity:** complete forward from exact evidence (recommended); never automatically recreate source/tombstone Ground without proof.
6. **Receipt ownership:** `TransactionCoordinator` as sole owner of the existing Ground receipt for destructive `ground.drop` (recommended).
7. **Trade capacity lifecycle:** approve the narrow fix/reconciliation required so completed Trade reservations do not remain active indefinitely.

## 22. P0 blockers

No unresolvable P0 architectural blocker was found. Productive destructive enablement is blocked until the following P0 safety requirements are implemented and tested:

- one receipt owner for the transactional command;
- PENDING hidden from Players;
- expected-state source mutation plus deterministic re-read;
- shared ledger participation and correct RESERVED/COMMITTING/RR/COMMITTED lifecycle;
- durable Scene receipt discovery after reload/handoff;
- conservative handling of the Foundry write/authority race;
- narrow resolution of Trade's canonical reservation lifecycle leak.

Foundry's lack of server-side atomic fencing/CAS is a residual platform limitation. It prevents a distributed exactly-one-writer claim, but the conservative design can remain safe by blocking ambiguous capacity and requiring recovery. Documentation and runtime messages must describe the implemented guarantee as local fencing plus durable recovery evidence.

## 23. Recommendation

Approve the proposed policies and implement G3B.0 plus G3B.1 tests-first. Reuse the existing command/socket boundary, Scene receipt repository, `TransactionCoordinator`, `AuthorityService`, Ground lifecycle/reconciliation, Universal Item Transfer, and `SharedReservationLedger`. Add only narrow command-domain helpers and recovery discovery needed by those contracts.

Do not enable destructive drag until the full F0-F15 matrix for quantity 1 passes, including write-applied/ACK-lost faults, A->B->A authority changes, Trade contention, reload discovery, and exact source/Ground/ledger receipt verification.

## 24. GO / NO-GO

**GO for human scope decisions and tests-first G3B.0 design work.**

**NO-GO for productive destructive Drop at the current HEAD.** G3A still duplicates by design, PENDING is player-visible, the source-debit/recovery contract does not exist, Ground receipts are not discovered automatically, and receipt ownership must be unified before `TransactionCoordinator` can govern the operation.

The architecture supports proceeding after the explicit decisions in section 21. It does not support claiming server-side fencing or cross-document atomic commit.

# G0 Implementation 2B-R3 — Trade Offer Capacity Adoption

## 1. Executive summary

`TradeSessionStore.setOffer` now submits every capacity-changing offer revision to the existing `SharedReservationLedger`. The ledger is the sole capacity authority for productive Trade offers; `session.reservations` and `reservationsByItem` remain compatibility projections. The historical Ground/Trade last-unit overcommit is a regression guarantee.

The execution lifecycle is unchanged. Ground Items is not implemented. This change provides cooperative Primary-GM/local-authority protection and durable shared-repository serialization; it does not provide distributed CAS, server-side transactions, or server-side stale-writer fencing.

## 2. Baseline accredited

Before production changes: REACQUIRE 10/10, quarantine 10/10, set mutation 14/14, shared ledger plus replacement 17/17, authority 14/14, Trade 299/299, full suite 1457 total / 1456 pass / 0 fail / 1 skipped.

## 3–5. Tests first, failures, and root cause

The new R3 file was created and executed before modifying productive Trade. Corrected test harness: 12 tests, 1 pass and 11 fail. The order-only NOOP passed because legacy Trade already canonicalized offer ordering. CREATE, Ground↔Trade exclusion, REPLACE preservation, REACQUIRE, quarantine, atomic mixed failure, reload, corrupt-projection resistance, and retry-after-reload failed because `setOffer` neither received nor called `SharedReservationLedger`.

## 6. Productive files

- `scripts/trade/trade-session-service.js`: previously validated capacity from `reservationsByItem` and projected offers. It now creates the state-aware current→desired diff, executes one canonical set mutation, reconciles deterministic legacy projections, and releases only pre-effect RESERVED capacity on cancellation/lifecycle cleanup. Negotiation, confirmation reset, session revisions, public projections, and transfer execution remain unchanged.
- `scripts/trade/trade-authority.js`: previously composed Trade with the repository and a local-plus-global availability boundary. It now injects the existing shared ledger and existing `AuthorityService`, returns canonical Item identity from authority-side resolution, and configures availability from the ledger alone. Socket dispatch, ownership checks, proximity, UI publication, and transfer orchestration remain unchanged.
- `scripts/runtime/shared-reservation-ledger.js`: adds only `setAuthorityService()` so the already-created shared singleton can receive the existing authority service without a circular import or a second selector. Reservation rules and persistence algorithms remain unchanged.

`TradeRuntimeRepository` required no R3 modification. Ledger and Trade already use the same world runtime and the same repository serialization queue.

## 7–8. setOffer before and after

Before, availability was `real - reservationsByItem`, so another domain was invisible. After domain validation and canonical Item resolution, `setOffer` reads durable ledger state and maps the full participant offer revision to one `mutateReservationSet`. A ledger denial or active resource quarantine rejects the Trade command before its offer/projection changes.

## 9–17. Composition, identity, diff, and lifecycle

Reservation identity is authority-derived Model B:

`trade:<sessionId>:<participantKey>:<itemUuid>`

The command operation ID scopes the mutation receipt, not the reservation identity. The diff is:

| Current | Desired | Operation |
|---|---|---|
| absent | present | CREATE |
| RESERVED, different quantity | present | REPLACE |
| RESERVED, same quantity | present | NOOP |
| RESERVED | absent | RELEASE |
| RELEASED | present | REACQUIRE |
| RELEASED | absent | NOOP |
| COMMITTING / COMMITTED / ROLLED_BACK / RECOVERY_REQUIRED | capacity change | reject |

ADD→REMOVE→RE-ADD keeps the same identity and history. Re-add accepts an explicit new quantity and uses REACQUIRE; it never CREATEs a second record or deletes RELEASED evidence.

## 18–23. CAS, mutation identity, atomicity, and ordering

REPLACE, RELEASE, and REACQUIRE use the revision observed from durable ledger state. CREATE is emitted only for a missing identity. One logical offer revision produces one set mutation, sorted by reservation identity. Its fingerprint contains session, participant, Actor, and sorted desired `{itemUuid, quantity}` membership. UI/public Item fields are excluded.

The existing set primitive evaluates joint final state independent of operation order and commits all operations or none. A semantic NOOP does not call the ledger and does not increment reservation or session revision.

## 24–26. Ground↔Trade, Trade↔Trade, concurrency

Ground-first makes Trade reject; Trade-first makes Ground reject. The controlled historical last-unit interleaving now has exactly one winner and total active commitment 1. Competing Trade sessions over the same Actor/Item also have exactly one winner through the common repository boundary. These are guarantees only for writers that use this shared ledger/repository path.

## 27–28. Reload and retry

Hydration loads ledger and Trade from the same runtime. A RELEASED identity is observed after reload and re-added with REACQUIRE. Exact command retry uses the existing Trade receipt; if only the ledger mutation receipt exists, its idempotent result lets Trade finish session/projection persistence without applying capacity again.

## 29–32. Legacy and quarantine

- Consistent projection and RESERVED ledger quantity: no duplicate, quarantine, or revision.
- Ledger absent: import occurs only when session, participant, Actor, Item, offer membership, and quantity agree deterministically. The import has a durable deterministic mutation ID.
- Contradictory quantity/state/domain/resource: preserve the ledger, preserve observed values as evidence, and create/ensure the existing Actor+Item quarantine. No quantity is chosen.
- Ledger present and projection missing: ledger remains authoritative; normal hydration derives compatibility projections from the session offer when deterministic.

Quarantine blocks Trade and other domains through the existing ledger fence and is never resolved automatically.

## 33–36. Compatibility projections and corruption

`session.reservations` supplies existing view/transfer consumers; `reservationsByItem` supplies legacy query consumers and test fixtures. Neither approves capacity. Tests corrupt both in RAM and show a new competing decision still consults durable ledger state and rejects overcommit.

## 37–39. Durability boundary and ACK failure

Ledger and session data share one repository and serialization queue, but the existing APIs perform two repository mutations. Combining them into one write would require moving ledger invariants into a new callback/transaction surface, so R3 keeps the smaller accredited composition.

The remaining window is:

1. ledger set mutation succeeds durably;
2. Trade session/projection persistence fails.

The conservative behavior is proven by fault injection: no compensating release occurs, durable capacity stays RESERVED, RAM/session projection returns to its prior state, and exact retry consumes the durable ledger mutation receipt then persists the Trade result without another capacity revision. Lost response/ACK after both writes is handled by the existing Trade operation receipt and likewise does not repeat capacity mutation.

## 40. Cancel pre-effect

Participant cancel, GM cancel, and lifecycle disconnect cleanup atomically RELEASE all ledger reservations still in RESERVED before making the session terminal. Exact retry is idempotent. EXECUTING and RECOVERY_REQUIRED are rejected from automatic release; COMMITTING, COMMITTED, and RECOVERY_REQUIRED records are never blindly released.

## 41–42. Permissions and authority

The existing authority-side handler still authenticates user, participant, Actor ownership, Item membership, and quantity. Stable reservation IDs, domain, state, and expected revisions are derived inside the GM store. The productive ledger receives the existing `AuthorityService`; its `AuthorityWriteContext` is revalidated by the ledger at the established cooperative boundaries.

## 43–46. Explicitly unchanged scope and remaining debt

`TradeTransferCoordinator`, transfer plans, source debit/delete, destination creation/credit, commit, rollback, post-effect recovery, Equipment, Consumables, Combat, turns, and opposition were not changed. Ground Items remains absent; `ground-test` appears only in tests. Historical execution bypass flags and the consumable TOCTOU remain separate P1 debt.

The Trade execution lifecycle has not yet adopted ledger transitions to COMMITTING/COMMITTED/ROLLED_BACK/RECOVERY_REQUIRED. R3 intentionally stops at offer capacity and safe pre-effect release.

## 47–48. Deviations and incidental changes

No stop condition was reached. No parallel coordinator, dispatcher, repository, authority selector, receipt store, recovery coordinator, or capacity manager was created. The only ledger API addition is dependency configuration for the existing singleton. The historical P0 test was retained and renamed from characterization to regression guarantee.

## 49–57. Verification results

- R3 plus historical P0: 25 total / 25 pass / 0 fail / 0 skip.
- REACQUIRE: 10/10.
- Resource quarantine: 10/10.
- Set mutation: 14/14.
- Shared ledger plus replacement: 17/17.
- Authority: 14/14.
- Existing Trade suite: 299/299.
- Full `npm test`: 1481 total / 1480 pass / 0 fail / 1 skipped.

The single skip remains the pending Confidentiality Spike Player operational test. G0 is therefore not globally complete.

## Residual races and guarantee boundary

Foundry's public setting API does not expose an atomic server-side compare-and-swap or a fence token that rejects a stale Primary GM writer. The cooperative window remains: local authority revalidation succeeds → write is sent → authority changes → Foundry accepts the old write. R3 does not claim to close that window. Its guarantees are local/cooperative authority fencing, durable operation evidence, quarantine, and shared repository serialization among conforming writers.

## Status

The offer-capacity P0 is resolved within the declared Primary-GM/shared-repository guarantee. Execution lifecycle migration, Ground Items, quarantine resolution, and the Confidentiality Spike Player remain outside this result.

G0 TRADE OFFER CAPACITY ADOPTED — EXECUTION LIFECYCLE UNCHANGED.

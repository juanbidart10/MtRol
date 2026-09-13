# G3B.0-D-R — Same-TX ACK Retry Runtime Report

## A. Environment

- Validation date: 2026-09-13.
- Foundry VTT: v14 build 365.
- World: `mt-rol-dev` / `Mt rol Dev`.
- System: `mtrol` 1.4.2.
- Independent clients: Chrome persistent profile for GM and Edge persistent profile for Player.
- Both clients were fully reloaded after login and reached `game.ready` with the current JavaScript.

## B. GM / Player identities

- Session A: `Gamemaster`, `isGM=true`, user ID `BXLdaRyx6ITAvrcG`.
- Session B: `Lerathiel`, `isGM=false`, user ID `yKaeyDkzSNWmWvN4`.
- `Gamemaster` was the only active GM and therefore the Primary.
- Both sessions used the same World, system and Scene.

## C. Source candidate

- Actor: `Lerathiel`, `Actor.0wibAZTMP4R6kBKZ`.
- Actor was a persistent World Actor, `isToken=false`, and Player was OWNER.
- Item: `Botas de Ashford`.
- Item UUID: `Actor.0wibAZTMP4R6kBKZ.Item.8vFJzndYnSxgg08N`.
- Type: `objeto`.
- Effective quantity: 1.
- Equipped: false.
- Actual equipment-slot references: none.

## D. Pre-drag hashes/counts

- Captured at: `2026-09-13T21:48:37.893Z`.
- Source Item SHA-256: `0c857d4f2972849682a07ffd84cae6db1ed2c398ab6d9ec67d4809bc4aa894f7`.
- Deterministic Actor inventory SHA-256: `abc754f852ad92e56667bf98a43f4bdaabb4260dc2a146223527d89fe0035258`.
- Actor Item document count: 17.
- Canonical total object quantity: 8.
- Existing Ground pairs: 3.
- Existing ACTIVE Grounds: 2.
- Existing `ground.drop` receipts: 3, all predating this validation.
- Item Piles Actors: 1.
- Item Piles Tokens: 2.

## E. Scene

- Scene: `Laberinto del Ajedrez Maldito`.
- Scene ID: `oThRghwcCBMZOClR`.
- Both clients observed this Scene before the drag.
- Persisted target position: `{x: 6240, y: 5700}`.

## F. Number of real drags

`REAL_DRAGS = 1`

The Player performed exactly one real DOM drag from the draggable `PersonajeSheet` inventory row to the Canvas. No manual retry or second drag occurred.

## G. Original transactionId/requestId

- Drag started: `2026-09-13T21:50:58.804Z`.
- Socket request sent: timestamp `1789336258890`.
- Action: `mtrolGroundDrop`.
- Request ID: `oLNU9IibXiVxM3Jq`.
- Transaction ID: `CVU27iIhMr5ey5ta`.
- Requesting user: `yKaeyDkzSNWmWvN4`.
- Target Primary GM: `BXLdaRyx6ITAvrcG`.

## H. Timeout occurrence

No `SOCKET_TIMEOUT` occurred. The operation followed CASE A and completed before the first 30-second timeout.

## I. Retry occurrence

No retry occurred. Passive WebSocket capture found exactly one outbound `mtrolGroundDrop` request.

## J. Retry transactionId

Not applicable for CASE A. The automatic same-transaction retry branch was not directly exercised in this runtime run.

## K. Ground ID/count

- New Ground ID: `ground:mt-rol-dev:EwfnA6v4eHPWeByRDvQK3H5z`.
- New Ground count before cleanup: exactly 1.
- The durable result, receipt and ACK all referenced this same Ground ID.
- No duplicate Ground appeared.

## L. Receipt state

- Logical receipt count for transaction `CVU27iIhMr5ey5ta`: exactly 1.
- Command: `ground.drop`.
- Fingerprint: `sha256:8702422a4b7d59399e6fe6cc51b365ed9b15a6ab7336b62d2b05b09fa62e4154`.
- Final status: `completed`.
- Durable Ground ID: `ground:mt-rol-dev:EwfnA6v4eHPWeByRDvQK3H5z`.
- Checkpoints: `ground-pending`, `ground-active`, `ground-published`.
- Receipt creation: `1789336258892`.
- Receipt completion: `1789336259041`.
- ACK received: `1789336259097`, 293 ms after drag start.
- ACK `ok=true` and replayable result used the original transaction ID and Ground ID.

## M. Ground inspect

Before cleanup, canonical `GroundReconciliationService.inspectGroundRecovery()` returned:

- pairStatus: `MATCHED`;
- authorityLifecycle: `ACTIVE`;
- classification: `HEALTHY`;
- recoverability: `NO_ACTION`;
- issues: none;
- visibility: `REVEALED`;
- pickupEnabled: false;
- appearance mode: `REAL`;
- persisted position: `{x: 6240, y: 5700}`.

## N. Source after

Before cleanup and again after cleanup:

- Source Item still existed.
- Source Item SHA-256 exactly matched the pre-drag value.
- Inventory SHA-256 exactly matched the pre-drag value.
- Actor Item document count remained 17.
- Canonical total object quantity remained 8.
- Effective source quantity remained 1.

Source immutability was preserved exactly.

## O. Item Piles exclusion

- Item Piles Actors remained 1.
- Item Piles Tokens remained 2.
- No Item Piles dialog, Actor, Token, debit or quantity mutation was produced by the drag.

## P. Player UX/toasts

- No Player notification was present after the operation.
- The false warning `El GM no respondió a tiempo. La acción no fue resuelta.` did not appear.
- The operation completed normally before timeout.

## Q. Console classification

Passive Player and GM console listeners were active before the drag. No Ground, socket, receipt, Primary, reconciliation, duplicate or timeout error was captured.

Observed unrelated warnings were classified as environment/module noise:

- browser/WebGL buffer performance warning;
- Foundry `renderChatMessage` deprecation warning;
- known MTROL 3D Canvas inactive safe mode;
- GM ready migration audit warning with zero actors/items migrated.

No product failure was observed.

## R. Reload

- Player was fully reloaded after the HEALTHY result.
- The same Ground reappeared once in `GroundCanvasLayer.spriteEntries`.
- It preserved Scene, position, visibility and pickup state.
- GM was then fully reloaded and also rendered exactly one copy of the same Ground.
- No additional drag occurred.

## S. Cleanup

Cleanup ran only after HEALTHY/COMPLETED was proven. The GM used the existing `GroundLifecycleService.tombstoneGround()` route with local Primary authority validation, limited to the Ground created by this test.

Verified final Ground state:

- pair status: `MATCHED`;
- authority lifecycle: `TOMBSTONED`;
- authority visibility: `INVISIBLE`;
- public visibility: `INVISIBLE`;
- pickupEnabled: false on both records;
- Player renderer removed the Ground;
- original `ground.drop` receipt remained unique and `completed`;
- source hashes, Item count and canonical quantity remained unchanged.

No pickup, manual Scene-flag edit or source mutation was performed.

## T. Regression

Final `npm test`:

- 1595 total;
- 1594 pass;
- 0 fail;
- 1 skip.

`git diff --check` and `git status --short` were executed after the runtime validation. No product code or tests were changed by this validation, and no commit was created.

## U. Verdict

PASS A. The real dual-account Player-to-Primary-GM path completed normally before timeout. One manual drag produced one transaction, one logical receipt and one Ground. The source remained exactly unchanged, Item Piles was excluded, reload was stable, and cleanup was verified. The timeout retry branch remains covered automatically but was not forced or directly exercised because this runtime operation acknowledged in 293 ms.

G3B.0-D-R RUNTIME VALIDATION PASS — DUAL-ACCOUNT PLAYER→GM FLOW VERIFIED — ONE REAL DRAG / ONE TRANSACTION / ONE RECEIPT / ONE GROUND — SOURCE IMMUTABILITY PRESERVED — G3B.1 UNBLOCKED.

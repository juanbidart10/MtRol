# G0 — Shared Inventory Reservation Ledger

## Diseño implementado

`SharedReservationLedger` es la única abstracción de reservas. Usa el `TradeRuntimeRepository` existente y ejecuta cada reserva o transición dentro de su cola de mutaciones persistentes. El runtime ahora contiene `reservations` como mapa canónico por `operationId`.

Cada registro conserva `operationId`, `domain`, `actorUuid`, `itemUuid`, `quantity`, `state`, `fingerprint`, `authorityGeneration`, `revision`, `evidence` y marcas temporales. Los estados son `RESERVED`, `COMMITTING`, `RECOVERY_REQUIRED`, `COMMITTED`, `ROLLED_BACK` y `RELEASED`.

La reserva comprueba disponibilidad y persiste el resultado en la misma mutación serializada. Retries con el mismo fingerprint son idempotentes; un fingerprint diferente se rechaza. `RECOVERY_REQUIRED` no expira ni se libera por timeout. Los contextos de autoridad se revalidan antes de reservar y antes de transiciones.

## Trade y límites

Se exporta el ledger compartido junto al repositorio existente y `TradeReservationBoundary` suma la reserva global del ledger a la proyección Trade existente. Las reservas derivadas de sesiones Trade siguen siendo una proyección compatible durante esta fase; la sustitución completa de sus escrituras por operaciones ledger requiere una migración posterior con equivalencia exhaustiva. No se creó otro repositorio, coordinador, selector de Primary GM ni dispatcher.

La concurrencia acreditada es la de mutaciones que pasan por el repositorio persistente compartido. Foundry público no ofrece una frontera atómica server-side para cerrar la ventana escritura enviada → cambio de autoridad → aceptación; por tanto esto no es fencing distribuido. La garantía implementada es local y durable: operaciones ambiguas conservan evidencia y requieren recuperación.

## Verificación y estado

Se agregaron `tests/shared-reservation-ledger-g0.test.mjs` para reserva simple/parcial, concurrencia, idempotencia, fingerprint conflict, reload, recovery y revalidación de autoridad. `npm test`: **1410 tests, 1409 pass, 0 fail, 1 skipped**.

Shared Reservations: **PARTIAL** (ledger canónico implementado; adopción completa de Trade pendiente). P0 handoff: **MITIGATED / SERVER FENCING UNAVAILABLE**. G0 permanece incompleto porque el Confidentiality Spike Player sigue pendiente. Ground Items permanece sin implementar.

## Canonicalización de Trade (auditoría)

El mapa actual demuestra la dependencia restante. `TradeSessionStore.#rebuildSessionReservations` escribe `session.reservations` y el índice RAM `reservationsByItem`; `getReservationsForActorItem`, `getReservedQuantity` y `getAvailability` leen ese índice. `trade-gm-view-model.js`, `trade-api.js`, `trade-authority.js` y `trade-transfer-service.js` consumen `session.reservations` para decisiones y presentación. `hydrateRuntime` vuelve a reconstruir el índice desde `session.reservations` derivado de las sesiones persistidas.

Por ello esas rutas son todavía AUTHORITATIVE (lecturas de disponibilidad, guards y transferencia), mientras que los view-models son UI/READ-ONLY. El ledger global sólo se suma en `TradeReservationBoundary`; no reemplaza la creación, liberación, commit ni reload de las reservas Trade. Eliminar `session.reservations` cambia la disponibilidad, por lo que la invariante final no está demostrada.

No se declara `TRADE ADOPTION COMPLETE`. La dependencia concreta que mantiene el estado en PARTIAL es `TradeSessionStore.#rebuildSessionReservations` junto con `getReservationsForActorItem/getReservedQuantity/getAvailability`: las ofertas Trade nunca crean registros `domain: "trade"` en `SharedReservationLedger`, y el lifecycle continúa liberando/reconstruyendo el índice local.

# G0 Implementation 1 — Atomic Reservation Replacement

## Executive summary

`SharedReservationLedger` ahora reemplaza una reserva estable sin ejecutar `release + reserve`. Implementa CAS lógico por `revision`, idempotencia durable por `mutationId + mutationFingerprint`, cálculo cross-domain y reemplazo batch all-or-nothing dentro de una única mutación del `TradeRuntimeRepository` existente.

Trade productivo no fue migrado. `TradeSessionStore`, `setOffer`, API, authority, transfer y `session.reservations` conservan su comportamiento. El test `CHARACTERIZATION / KNOWN GAP` continúa demostrando el P0 Ground-like ↔ Trade esperado en este checkpoint.

## Archivos productivos

- `scripts/runtime/shared-reservation-ledger.js`: `replaceReservation`, `replaceReservationsBatch`, receipts durables de mutación, segunda revalidación cooperativa de autoridad y enforcement de state machine.
- `scripts/trade/trade-runtime-repository.js`: agrega únicamente el campo infraestructural `reservationMutations` al mismo runtime persistente. No modifica lifecycle Trade.

## Tests

- Nuevo: `tests/shared-reservation-replacement-g0.test.mjs`.
- Ajustado: `tests/shared-reservation-ledger-g0.test.mjs`, para verificar que `RECOVERY_REQUIRED` no puede liberarse y conserva capacidad/evidencia.

## Contrato final

### `replaceReservation(input, context)`

`input`: `operationId`, `expectedRevision`, `quantity`, `mutationId`, `mutationFingerprint` y evidencia opcional. `context`: `realQuantity` y `authorityContext` opcional. Devuelve `{changed, idempotent, mutationId, reservations, reservation}`.

Sólo modifica reservas `RESERVED`. Conserva `operationId`, aumenta `revision` una vez y reemplaza `quantity` directamente. Un error no cambia la reserva ni su revisión.

### `replaceReservationsBatch(input, context)`

`input`: `mutationId`, `mutationFingerprint`, `entries[]`. Todas las identidades deben ser distintas. Valida todas las revisiones, estados y capacidades antes de construir el nuevo draft. Una entrada inválida rechaza el batch completo. El cálculo usa el estado final conjunto: una reducción puede financiar un aumento del mismo Actor+Item en el mismo batch.

## Semántica y orden

- `operationId`: identidad estable de la reserva; no cambia con quantity/revision.
- `revision`: versión CAS de la reserva; comienza en 0 y avanza una vez por replace o transición real.
- `mutationId`: identidad global de una intención concreta de replacement/batch.
- `mutationFingerprint`: identidad semántica de esa intención; mismo ID con fingerprint distinto es conflicto.

Orden implementado:

1. Normalizar entradas y localizar reservas.
2. Buscar `mutationId` durable.
3. Comparar fingerprint.
4. Si coincide, devolver resultado idempotente antes de evaluar stale revision.
5. Para mutación nueva, comprobar revision.
6. Comprobar estado.
7. Resolver y comprobar capacidad cross-domain sobre estado final.
8. Revalidar autoridad en la frontera cooperativa previa a persistencia.
9. Persistir reservas y receipt de mutación juntos.

## Evidencia

- Increase fallido: con real 5, propia 3 y otra 1, pedir 5 devuelve `RESERVATION_CAPACITY_CONFLICT`; ambas reservas y sus revisions quedan byte-for-byte equivalentes al estado anterior. Pedir 4 posteriormente funciona.
- Batch: capacity failure, stale revision, identidad duplicada, fingerprint conflict y fallo inyectado de repository dejan todas las entradas anteriores intactas.
- Reload: una instancia nueva hidrata quantity/revision y reconoce el retry singular o batch sin incrementar revisions.
- Cross-domain: estados activos de `ground-test` participan en el total independientemente del domain.
- Concurrencia soportada: `replace vs reserve` por última unidad produce un ganador; dos replacements desde la misma revision producen uno y el otro observa stale. El retry del ganador sigue siendo idempotente.
- Authority: contexto stale inicial y pérdida en la segunda frontera cooperativa dejan la reserva intacta.

## Persistencia y limitaciones

El repository construye y valida un draft completo y actualiza fallback/cache sólo después de que `write` resuelve; un rechazo normal de `game.settings.set` deja la última verdad local durable intacta. Si el servidor acepta el write pero el cliente pierde el ACK, la infraestructura pública no permite probar desde esa respuesta si persistió: el retry/reload debe leer `reservationMutations` y reconciliar conservadoramente.

Las pruebas acreditan serialización dentro del Primary GM y la instancia/repository compartidos. No acreditan CAS distribuido entre writers independientes ni cierran la ventana `validate → write enviado → authority cambia → servidor acepta`. No se afirma server-side fencing.

## Validación

- Replacement + SharedLedger: **17 pass, 0 fail**.
- Authority: **14 pass, 0 fail**.
- Trade: **299 pass, 0 fail**.
- Suite completa: **1423 total, 1422 pass, 0 fail, 1 skipped**.
- Characterization P0: continúa reproduciendo el gap, como requiere esta fase sin migración Trade.

No hubo cambios incidentales ni desviaciones funcionales respecto del diseño. La única extensión del schema es `reservationMutations`, necesaria para idempotencia después de reload. Ground Items, Confidentiality, Equipment, Consumables, Combat, Canvas e Item Piles no fueron modificados.

# G0 Implementation 2A — Atomic Reservation Set Mutation

## Executive summary

`SharedReservationLedger.mutateReservationSet` permite combinar CREATE, REPLACE y RELEASE sobre múltiples identidades en una única mutación durable y all-or-nothing. La capacidad se calcula sobre el estado final simulado, sin depender del orden de `operations[]`. Trade productivo permanece sin cambios y Ground Items no fue implementado.

## Primitive y firma

```js
ledger.mutateReservationSet({
  mutationId,
  mutationFingerprint,
  operations
}, {
  realQuantity,
  authorityContext
})
```

Cada operation tiene `type: "CREATE" | "REPLACE" | "RELEASE"` y `operationId`. CREATE agrega `domain`, `actorUuid`, `itemUuid`, `quantity`, fingerprint/evidence opcionales. REPLACE agrega `expectedRevision`, `quantity` y evidencia opcional. RELEASE agrega `expectedRevision` y evidencia opcional.

## Archivos

Productivo modificado:

- `scripts/runtime/shared-reservation-ledger.js`

Tests agregados:

- `tests/shared-reservation-set-mutation-g0.test.mjs`

No fue necesario modificar nuevamente el schema: la primitive reutiliza `reservationMutations` dentro del `TradeRuntimeRepository` existente.

## Semántica

CREATE exige una identidad inexistente, resource completo y quantity positiva. Crea `RESERVED`, revision 0. Una identidad terminal existente no revive.

REPLACE exige identidad existente, revision CAS exacta y estado `RESERVED`. Conserva identidad y reemplaza quantity sin estado intermedio, aumentando revision una vez.

RELEASE exige identidad existente, revision CAS exacta y estado `RESERVED`. Pasa a `RELEASED`, aumenta revision y deja de consumir capacidad. `COMMITTING`, `RECOVERY_REQUIRED` y terminales se rechazan.

La misma identidad sólo puede aparecer una vez por set. No existe last-write-wins.

## Algoritmo all-or-nothing

1. Resolver retry durable por `mutationId` y fingerprint.
2. Validar que el set no esté vacío y no contenga identidades duplicadas.
3. Revalidar `AuthorityWriteContext` cuando se proporciona.
4. Validar y simular todas las operaciones sobre un clon del estado actual.
5. Agrupar todos los resources Actor+Item afectados.
6. Resolver `realQuantity` dentro de la mutación serializada del repository.
7. Sumar todas las reservas activas del estado final, sin filtrar por domain.
8. Rechazar el set completo si cualquier resource excede capacidad.
9. Revalidar autoridad en la frontera cooperativa previa a persistencia.
10. Copiar todos los registros afectados al draft y persistirlos junto con el receipt de mutación en un único `repository.mutate`.

No se llama internamente a `reserve`, `replaceReservation` o `release`, por lo que no existen commits entry-by-entry.

## Capacidad final y orden

RELEASE B puede financiar REPLACE A dentro del mismo set. Con real 5, A=3 y B=2, `{RELEASE B, REPLACE A→4, CREATE C=1}` termina en A=4, B=`RELEASED`, C=1.

Reordenar esas operaciones produce el mismo estado y la misma decisión de capacidad. `mutationFingerprint` continúa siendo proporcionado por el caller: la fase Trade deberá construir una representación semántica canónica para que dos arrays equivalentes compartan fingerprint. El ledger no introduce conocimiento específico de Trade.

## CAS, idempotencia y reload

Cada REPLACE/RELEASE valida su revision. Una sola entrada stale rechaza CREATEs, replacements y releases del mismo set sin cambios.

`mutationId + mutationFingerprint` se persiste en `reservationMutations`. Un retry conocido se resuelve antes de CAS, incluso después de reload y aunque las revisions originales ahora sean stale. El mismo mutationId con otro fingerprint devuelve `RESERVATION_MUTATION_CONFLICT`.

## Evidencia

- CREATE, REPLACE y RELEASE individuales: acreditados.
- Las tres combinaciones de dos tipos: acreditadas.
- CREATE+REPLACE+RELEASE: acreditada en un único set.
- Capacity conflict, stale CAS, release ilegal, identidad duplicada y fingerprint conflict: ninguno modifica el estado previo.
- Multi-Actor/multi-Item: un resource inválido rechaza el conjunto completo.
- Cross-domain: `ground-test` participa en el cálculo; si Trade-like gana primero, Ground posterior es rechazado.
- Concurrencia local: set vs reserve, set vs replace y dos sets desde la misma revision producen un único resultado compatible y nunca exceden capacidad.
- Persistence failure: el runtime durable y el ledger local conservan el estado anterior completo.
- Authority stale en la segunda frontera cooperativa: no se aplica ninguna entrada.

## Garantías y límites

La atomicidad acreditada corresponde a una instancia autoritativa que comparte el singleton/repository y su cola. `realQuantity` puede ser async, pero se resuelve mientras la mutación del repository mantiene esa serialización local.

No existe CAS atómico distribuido en `game.settings`, ni fencing server-side entre clientes independientes. Tampoco se cierra la ventana `validate → write enviado → cambio de autoridad → servidor acepta`. Un rechazo posterior a una aceptación remota puede ser ambiguo y requiere reload/reconciliación conservadora mediante el receipt durable.

## Validación

- Tests nuevos set mutation: **14 pass, 0 fail**.
- SharedLedger + replacement: **17 pass, 0 fail**.
- Authority: **14 pass, 0 fail**.
- Trade: **299 pass, 0 fail**.
- Validación combinada de ledger/replacement/authority/characterization: **46 pass, 0 fail**.
- Suite completa: **1437 total, 1436 pass, 0 fail, 1 skipped**.

El test `CHARACTERIZATION / KNOWN GAP` continúa reproduciendo la doble reserva Trade ↔ Ground-like porque Trade productivo todavía no fue migrado, tal como exige esta fase.

No hubo cambios incidentales ni desviaciones del diseño aprobado. TradeSessionStore, setOffer, Trade API/authority/transfer, Equipment, Consumables, Combat, Canvas, Item Piles y demás dominios permanecen sin cambios en este checkpoint.

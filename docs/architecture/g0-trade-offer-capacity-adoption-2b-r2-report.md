# G0 Implementation 2B-R2 — Trade Offer Capacity Adoption

## Estado

**G0 TRADE OFFER CAPACITY ADOPTION BLOCKED**

No se modificó código productivo ni se agregaron tests de adopción. El bloqueo se detectó durante la auditoría obligatoria previa a tests-first.

## Stop condition

Aplica la condición 50.1: **`setOffer` no puede expresarse completamente con `mutateReservationSet`**.

## Causa raíz

La identidad aprobada es estable durante la sesión:

`trade:<sessionId>:<participantKey>:<itemUuid>`

Al quitar un Item de una oferta, la operación aprobada es RELEASE y el registro pasa a `RELEASED`, estado terminal. `mutateReservationSet` prohíbe CREATE sobre cualquier identidad existente y REPLACE sólo acepta `RESERVED`.

Si el mismo participante vuelve a agregar ese Item dentro de la misma sesión, la identidad derivada es exactamente la misma. Ninguna operación disponible puede adquirir capacidad otra vez:

- CREATE rechaza `RESERVATION_IDENTITY_CONFLICT`.
- REPLACE rechaza `RESERVATION_STATE_CONFLICT`.
- Usar otro operationId contradice MODEL B.
- Borrar el registro terminal elimina evidencia durable e idempotencia.
- Mantenerlo `RESERVED` al retirar el Item incumple RELEASE y retiene capacidad que la oferta ya no compromete.
- Ejecutar release/reserve secuencialmente está expresamente prohibido y tampoco resuelve la identidad terminal.

Trade admite revisiones a oferta vacía y posteriores modificaciones. Impedir re-add sería un cambio funcional ajeno a capacidad y activaría también la stop condition 50.12.

## Estado durable posible

El estado actual permanece intacto:

- Trade continúa usando `session.reservations/reservationsByItem` para capacidad.
- SharedReservationLedger, atomic replacement, set mutation y resource quarantine permanecen implementados.
- No existen reservas Trade canónicas creadas por `setOffer`.
- El P0 histórico Trade ↔ Ground-like sigue abierto y caracterizado.

## Primitive/diseño faltante

Hace falta aprobar una de estas semánticas:

1. **REACQUIRE explícito** dentro de `mutateReservationSet`: transición `RELEASED → RESERVED` sólo mediante una operation específica, con `expectedRevision`, validación completa de capacidad, nuevo mutationId/fingerprint y evidencia de que se trata de una nueva adquisición pre-efecto. No sería un CREATE silencioso ni borraría historia.
2. **Identidad de line lifecycle**: agregar una generación estable distinta de la revision de cantidad. Esto cambia el MODEL B aprobado y complica migración/idempotencia.
3. **Estado INACTIVE no terminal**: remover de oferta llevaría a un estado que no consume capacidad y permite reacquire posterior. Requiere revisar la state machine aprobada.

La opción 1 tiene el menor impacto: preserva operationId, CAS, historia terminal y atomicidad del set. Debe aprobarse expresamente porque amplía la state machine y contradice la regla vigente de que estados terminales no reviven.

Tests que deberá incluir esa revisión:

- RESERVED → RELEASED → REACQUIRE con la misma identidad.
- Reacquire sin capacidad conserva RELEASED.
- Reacquire dentro de CREATE+REPLACE+RELEASE all-or-nothing.
- Retry/reload idempotente.
- Reacquire en `COMMITTED`, `ROLLED_BACK` o `RECOVERY_REQUIRED` rechazado.
- Quarantine bloquea reacquire.
- Dos reacquires concurrentes desde la misma revision producen un ganador.

## Archivos y validación

Archivo agregado:

- `docs/architecture/g0-trade-offer-capacity-adoption-2b-r2-report.md`

Cambios productivos: ninguno.

Tests agregados/modificados: ninguno. No se construyó un harness que asumiera una transición todavía no aprobada.

Último baseline acreditado:

- Quarantine: 10/10.
- SharedLedger + replacement: 17/17.
- Set mutation: 14/14.
- Authority: 14/14.
- Trade: 299/299.
- Suite completa: 1447 total, 1446 pass, 0 fail, 1 skipped.

Resource quarantine sí resuelve el bloqueo legacy anterior; no se reimplementó ni se intentó resolver. Transfer execution, Ground Items y los demás dominios permanecen sin cambios.

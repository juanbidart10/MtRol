# G0 Implementation 2 — Trade Offer Capacity Adoption

## Estado

**G0 TRADE OFFER CAPACITY ADOPTION BLOCKED**

No se aplicaron cambios productivos en esta fase.

## Bloqueo exacto

La primitive aprobada `replaceReservationsBatch` sólo acepta identidades de reserva que ya existen y sólo reemplaza su cantidad mientras están en `RESERVED`. Su validación exige que cada `operationId` esté presente antes de resolver retry, revision, state y capacity.

Una revisión real de oferta Trade puede cambiar membresía:

- agregar Item: necesita crear una reserva nueva junto con replacements existentes;
- quitar Item: necesita llevar una reserva existente a `RELEASED` junto con replacements existentes;
- reemplazar una oferta multi-item: puede combinar create + replace + release en una única revisión lógica.

El batch actual no expresa esas operaciones. Ejecutar `reserve`, `replaceReservationsBatch` y `release` en llamadas separadas permitiría estados parciales observables y fallos intermedios. Eso violaría la atomicidad solicitada y podría dejar la sesión y la capacidad con membresías distintas.

La especificación contiene una stop condition explícita: si add/remove requiere semántica batch no aprobada, no se debe improvisar ni ampliar `SharedReservationLedger`. Esa condición se cumple.

## Ejemplos del gap

Oferta previa `{A: 2}` → nueva `{A: 2, B: 1}`:

- El batch no puede crear `trade:<session>:<participant>:<B>`.
- Reservar B por separado y después persistir la oferta puede dejar B retenido si falla la representación Trade.
- Persistir la oferta primero reintroduce una oferta sin capacidad acreditada.

Oferta previa `{A: 2, B: 1}` → nueva `{A: 2}`:

- El batch no puede transicionar B a `RELEASED` junto con el estado final de A.
- Liberar B primero abre una ventana incompatible con la oferta previa si falla la persistencia posterior.
- Liberarlo después es conservador para capacidad, pero no constituye el reemplazo lógico all-or-nothing exigido por esta fase.

## Primitive que requiere revisión

Antes de reanudar Implementation 2 debe aprobarse una extensión conceptual como:

```js
mutateReservationsBatch({
  mutationId,
  mutationFingerprint,
  entries: [
    { action: "create", reservation: {...} },
    { action: "replace", operationId, expectedRevision, quantity },
    { action: "release", operationId, expectedRevision, evidence }
  ]
}, context)
```

La extensión debe definir como mínimo:

1. Validación del estado final conjunto antes de escribir.
2. Idempotencia durable del batch completo.
3. CAS de todas las identidades existentes.
4. Conflicto si una identidad `create` ya existe con otro fingerprint.
5. `release` permitido únicamente desde `RESERVED` con evidencia pre-efecto.
6. Resultado all-or-nothing ante capacity, stale revision, estado ilegal o fallo normal de persistencia.
7. Semántica de retry si algunas identidades ya reflejan el resultado pero el ACK se perdió.
8. Revalidación de `AuthorityWriteContext` antes y en la frontera cooperativa previa a persistencia.

## Legacy conflict adicional

La adopción también debe resolver sesiones activas con `session.reservations` sin ledger. La importación determinista cuando no existe equivalente está diseñada conceptualmente, pero el conflicto `legacy quantity 3` frente a `ledger quantity 2` no tiene una transición de migración aprobada. Elegir uno violaría otra stop condition. Debe aprobarse que el conflicto retenga la capacidad conservadora y marque recovery/migration conflict antes de implementar hydration.

## Alcance preservado

No se modificaron:

- `TradeSessionStore` ni `setOffer`;
- `session.reservations` o `reservationsByItem`;
- Trade API, authority, transfer, commit, rollback o recovery;
- `SharedReservationLedger`;
- Ground Items u otros dominios.

El P0 caracterizado continúa abierto y el write path Trade continúa usando su autoridad previa. No se cambiaron tests ni expectativas porque no existe todavía un contrato aprobado capaz de cubrir la membresía completa de una revisión de oferta.

## Decisión requerida

Se requiere aprobar una primitive batch capaz de mezclar **create + replace + release** atómicamente y una política conservadora para conflictos legacy/ledger. Tras esa aprobación pueden escribirse primero los tests de membresía y continuar la adopción mínima sin migrar el execution lifecycle.

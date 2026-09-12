# G0 Design Check — Canonical Trade Capacity Reservation

## Decisión

Se recomienda **MODEL B**:

`operationId = trade:<sessionId>:<participantKey>:<itemUuid>`

La identidad de la reserva permanece estable durante toda la vida de esa línea de oferta. `revision` se persiste por separado. Cada command que intenta modificarla lleva además un `mutationId` y un `mutationFingerprint` propios.

MODEL A crea una reserva distinta en cada revisión. Un aumento o reducción exigiría reservar la revisión nueva y retirar la anterior, o enseñar al ledger a agrupar generaciones. Reservar primero cuenta dos veces la capacidad; liberar primero abre una ventana con reserva cero. También acumula identidades terminales que complican reload, cancelación y migración. MODEL B permite reemplazar cantidad y metadata en un único registro y una única mutación persistente.

### Comportamiento de identidad

| Caso | MODEL B recomendado |
|---|---|
| Retry | Mismo `mutationId` + fingerprint devuelve el resultado persistido |
| Increase/decrease | CAS sobre `revision`; misma reserva, cantidad reemplazada atómicamente |
| Stale revision | Rechazo explícito sin alterar reserva |
| Duplicate message | Idempotente por `mutationId`, incluso si la revisión ya avanzó |
| Release/cancel | Transición del registro estable a `RELEASED` |
| Reload/recovery | Un registro identifica inequívocamente la línea vigente |
| Legacy migration | Una reserva legacy por session/participant/item se proyecta directamente |

Si una oferta referencia un Item sin UUID estable, la migración debe resolver primero el UUID desde `actorUuid + itemId`. Si no puede probarlo, crea un conflicto `RECOVERY_REQUIRED`; no debe inventar una identidad.

## Atomic reservation replacement

Firma conceptual:

```js
replaceReservation({
  operationId,
  domain: "trade",
  actorUuid,
  itemUuid,
  expectedRevision,
  quantity,
  mutationId,
  mutationFingerprint,
  evidence,
  authorityContext
}, { resolveRealQuantity })
```

Toda la operación ocurre dentro de una sola `TradeRuntimeRepository.mutate`:

1. Revalidar `authorityContext`.
2. Buscar el receipt durable de `mutationId`. Si existe con el mismo fingerprint, devolver su resultado; si difiere, rechazar.
3. Leer la reserva estable y exigir `domain`, Actor e Item coincidentes.
4. Exigir `state === RESERVED` para cambios de cantidad.
5. Exigir `current.revision === expectedRevision`.
6. Leer cantidad real dentro de la sección crítica.
7. Calcular `reservedByOthers` excluyendo `operationId` y contando todos los domains activos.
8. Exigir `reservedByOthers + quantity <= realQuantity`.
9. Reemplazar cantidad, incrementar revision exactamente una vez, actualizar fingerprint/evidence y persistir el receipt de mutación en el mismo draft.

Resultado conceptual:

```js
{
  changed: true,
  idempotent: false,
  reservation,
  previousQuantity,
  availableAfter,
  mutationId
}
```

Un retry devuelve el resultado original con `idempotent: true`. El lookup idempotente precede al check de `expectedRevision`; de otro modo el retry de una mutación exitosa parecería stale.

El fingerprint de reserva describe la identidad estable (`domain`, session, participant, Actor, Item). El `mutationFingerprint` describe el command (`operationId`, expected revision, nueva cantidad y causa). No debe incluir timestamps. El mismo `mutationId` con otro fingerprint se rechaza.

Para una oferta con varias líneas, Trade necesita `replaceReservationsBatch` con las mismas reglas y una sola mutación de repositorio. Aplicar líneas secuencialmente puede dejar una revisión parcial. El batch calcula todas las capacidades sobre el estado final propuesto antes de escribir cualquier línea.

## State machine

| Estado | Consume capacidad | Cambia quantity | Cancelación automática | Transiciones legales | Terminal |
|---|---:|---:|---:|---|---:|
| `RESERVED` | Sí | Sí, mediante replace CAS | Sí, sólo con prueba de que no comenzaron efectos | `RESERVED`, `COMMITTING`, `RELEASED`, `RECOVERY_REQUIRED` | No |
| `COMMITTING` | Sí | No | No | `COMMITTED`, `ROLLED_BACK`, `RECOVERY_REQUIRED` | No |
| `RECOVERY_REQUIRED` | Sí | No | No | `COMMITTED` o `ROLLED_BACK` sólo tras reconciliación probada | No |
| `COMMITTED` | No | No | No | ninguna | Sí |
| `ROLLED_BACK` | No | No | No | ninguna | Sí |
| `RELEASED` | No | No | No | ninguna | Sí |

Eventos:

- Offer revision: replace atómico en `RESERVED`; luego actualizar sesión/proyección.
- Acceptance reset: no cambia la reserva.
- `beginExecution`: `RESERVED → COMMITTING` antes del primer efecto.
- Session cancel o Player disconnect antes de efectos: persistir sesión terminal y después `RESERVED → RELEASED`. Si el release falla, queda capacidad retenida de forma conservadora.
- Player disconnect durante `COMMITTING`: conservar capacidad y pasar a `RECOVERY_REQUIRED` si el resultado puede ser ambiguo.
- GM disconnect o Primary handoff: no liberar. El writer viejo falla revalidación local; la autoridad nueva inspecciona `COMMITTING/RECOVERY_REQUIRED`.
- ACK perdido: no liberar; retry por `mutationId/transactionId`.
- Commit verificado: `COMMITTING → COMMITTED`.
- Rollback verificado: `COMMITTING/RECOVERY_REQUIRED → ROLLED_BACK`.
- Excepción antes de cualquier efecto acreditado: puede volver a `ROLLED_BACK`; una excepción después de enviar un write requiere `RECOVERY_REQUIRED`.

## Minimal Trade touchpoints

### MUST CHANGE

| Punto | Cambio mínimo |
|---|---|
| `SharedReservationLedger` | Agregar replace/batch CAS e idempotencia durable por mutación |
| `TradeSessionStore.setOffer` | Reservar/reemplazar capacidad en ledger antes de actualizar la sesión |
| `getReservationsForSession/ActorItem`, `getReservedQuantity`, `getAvailability` | Leer exclusivamente del ledger; cualquier array local es proyección |
| `hydrateRuntime` / hydration inicial | Migrar legacy de forma idempotente y reconstruir proyección desde ledger |
| `#rebuildSessionReservations` | Convertirlo en proyección determinista del ledger, sin escribir autoridad |
| `beginExecution` | Transicionar reservas de la sesión a `COMMITTING` antes del commit |
| `markRecoveryRequired` | Transicionar las reservas activas a `RECOVERY_REQUIRED` |
| `completeSession` | Marcar `COMMITTED` sólo después de verificación |
| `failExecution` | `ROLLED_BACK` sólo con rollback probado; en otro caso recovery |
| cancel/invalidate/disconnect pre-efectos | Persistir estado terminal y luego `RELEASED` |
| `prepareTradeTransferPlan/reservationMatches` | Validar ledger `COMMITTING`, no `session.reservations` |
| `TradeReservationBoundary` | Consultar sólo ledger; retirar suma con índice Trade |
| recovery Trade existente | Reconciliar receipt/checkpoints contra estados ledger |

### MAY REMAIN

- `TradeSession`, offers, confirmations, public offers, audit history y movement locks.
- `session.reservations` como proyección read-only para view models.
- `TradeTransferCoordinator`, su plan, checkpoints y verificación, cambiando sólo la validación/transiciones de capacidad.
- Guards y hooks actuales, porque ya dependen de `TradeReservationBoundary`.
- Socket, dispatcher y repository actuales.

### MUST NOT CHANGE

- Semántica de negociación, aceptación, confirmación o cantidades ofrecidas.
- UI pública/GM salvo que necesite consumir la proyección reconstruida.
- Gameplay, equipment rules, consumables, turnos, oposición o iniciativa.
- TransactionCoordinator, AuthorityService, API pública o sockets adicionales.

## Migration and crash ordering

La migración recorre sesiones activas legacy dentro de una mutación de repository. Para cada línea crea la identidad MODEL B. Si ledger y legacy coinciden, no cambia nada. Si sólo existe legacy y la identidad es comprobable, importa `RESERVED`, `COMMITTING` o `RECOVERY_REQUIRED` según el estado de sesión y evidencia. Si los datos discrepan, conserva la mayor capacidad segura y marca `RECOVERY_REQUIRED` con evidencia de conflicto; nunca libera ni sobrescribe silenciosamente.

En revisiones se cambia primero el ledger y luego la sesión. Un crash intermedio puede dejar UI/session antigua, pero la autoridad de capacidad sigue segura y recovery reconstruye la proyección. En cancelación se persiste primero que la sesión ya no puede ejecutar y después se libera; un crash retiene capacidad, pero no permite efectos sin reserva.

## Test plan before production implementation

| Test | Hoy | Garantía posterior |
|---|---|---|
| Last unit Ground → Trade | Falla seguridad: ambos ganan | Trade rechazado; Ground permanece |
| Last unit Trade → Ground | Falla seguridad posible | Ground rechazado; Trade permanece |
| Increase 3→5 con capacidad | No existe primitive | éxito atómico, revision +1 |
| Increase 3→5 sin capacidad | No existe primitive | rechazo; queda 3 y misma revision |
| Decrease 3→2 | No existe primitive | queda 2 sin estado 0 observable |
| Duplicate retry | Ledger reserve cubre create, no replace | mismo resultado y una revision |
| Stale revision | No existe replace CAS | rechazo sin mutación |
| Cancel pre-efectos | Libera índice Trade | sesión terminal antes de ledger `RELEASED` |
| Disconnect pre-efectos | Cancela Trade | release probado y durable |
| Disconnect en `COMMITTING` | Trade conserva por EXECUTING | capacidad conservada/recovery |
| Reload | Dos autoridades se reconstruyen | decisiones idénticas sólo desde ledger |
| Handoff | Fencing local parcial | stale writer no transiciona; reserva permanece |
| Migration legacy | No implementada | import idempotente y conservador |
| Batch multi-item conflict | Puede mutar sólo Trade | ninguna línea cambia si una falla |
| Projection rebuild | Session es autoridad | borrar/reconstruir proyección no cambia decisiones |

Los dos tests cross-domain y el guardrail de proyección deben escribirse primero y fallar contra producción actual. Los tests de la nueva primitive pueden escribirse contra su contrato antes de implementarla. Los tests de defectos deben conservar etiqueta `CHARACTERIZATION / KNOWN GAP` hasta que se conviertan en tests de protección que exijan un único ganador.

## Blast radius and residual risks

Blast radius esperado: **medio**. Se toca la autoridad de capacidad y puntos lifecycle que la transicionan; no se reemplazan sesiones, negociación, transferencia, UI, socket o repositorio.

Riesgos principales de implementación: orden entre ledger y sesión, batch de ofertas con varias líneas, migración de UUIDs legacy, y clasificación correcta de rollback probado frente a resultado ambiguo.

Riesgos residuales: Foundry no ofrece CAS/fencing server-side acreditado. La cola y AuthorityWriteContext proporcionan exclusión y fencing locales en el Primary GM vigente; permanece la ventana revalidación OK → write enviado → autoridad perdida → servidor acepta. Ediciones externas pueden ocurrir entre hook y write. Esas situaciones deben conservar reservas y entrar en recovery, no presentarse como atomicidad distribuida.

## Go / No-Go

**GO**, condicionado a implementar primero los tests de protección y el replace/batch atómico. El diseño reduce el cambio a capacidad Trade y no exige migrar el resto del subsistema.

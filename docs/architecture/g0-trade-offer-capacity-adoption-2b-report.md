# G0 Implementation 2B — Trade Offer Capacity Adoption

## Estado

**G0 TRADE OFFER CAPACITY ADOPTION BLOCKED**

No se modificó código productivo ni se agregaron tests de adopción en esta fase. El bloqueo se detectó durante la revisión obligatoria previa a tests-first.

## Causa raíz

La política legacy aprobada exige que una contradicción durable no elija automáticamente ni el valor legacy ni el valor ledger y, al mismo tiempo, que toda capacidad posiblemente comprometida permanezca bloqueada.

El schema actual de `SharedReservationLedger` representa cada identidad mediante una sola `quantity`. Para el caso:

```text
realQuantity = 5
session.reservations = 3
ledger.quantity = 2
```

las opciones disponibles incumplen al menos una condición:

- Conservar ledger `quantity=2` y marcar `RECOVERY_REQUIRED` deja 3 unidades disponibles; no bloquea la tercera unidad evidenciada por legacy.
- Cambiar ledger a `quantity=3` selecciona implícitamente legacy/max, expresamente prohibido.
- Reducir a 2 selecciona ledger/min, también prohibido.
- Crear una segunda reserva por la diferencia convierte evidencia contradictoria en dos compromisos y agrega una segunda representación autoritativa.
- Reservar las 5 unidades inventa una cantidad de compromiso no acreditada.
- Consultar simultáneamente `session.reservations` y ledger devuelve autoridad al store legacy y contradice el objetivo de fuente única.

Por tanto, la condición de aceptación O/P no puede satisfacerse con el schema actual sin una decisión adicional sobre cómo representar capacidad incierta.

La stop condition 47.4 aplica literalmente: **“Legacy conflict no puede bloquearse sin inventar una segunda autoridad.”**

## Estado exacto

- `mutateReservationSet` sí puede representar CREATE + REPLACE + RELEASE del diff normal de `setOffer`.
- El write path productivo de Trade continúa usando `session.reservations/reservationsByItem`.
- El P0 Trade ↔ Ground-like continúa reproducible y explícitamente caracterizado.
- No comenzó la migración de `TradeSessionStore`.
- No se modificó transfer execution ni otro dominio.

## Primitive o decisión faltante

Hace falta aprobar una representación canónica de conflicto dentro del ledger. Opciones para revisión humana:

1. **Resource quarantine**: metadata canónica por Actor+Item que bloquea nuevas adquisiciones sin afirmar una quantity resuelta. La capacidad del resource queda indisponible hasta reconciliación.
2. **Quantity bounds**: almacenar `committedQuantity` y `possibleQuantity`/upper bound, usando el límite conservador para disponibilidad. Requiere definir cómo se obtiene el bound sin elegir silenciosamente una fuente.
3. **Fail-closed migration gate**: impedir todas las nuevas mutaciones de capacidad sobre resources con conflicto durable hasta resolución manual, mediante un estado canónico del mismo ledger.

La opción 1 o 3 tiene menor riesgo semántico: expresa “resource bloqueado por contradicción” sin declarar cuál quantity es correcta. Aun así, amplía el schema/state machine y requiere aprobación antes de implementación.

También debe definirse:

- identidad y revision CAS del bloqueo;
- cómo persiste evidencia de ambos valores;
- qué transitions permiten reconciliarlo;
- cómo participa en batch all-or-nothing;
- cómo se evita que un retry/handoff lo libere;
- cómo se migra idempotentemente después de reload.

## Archivos y tests

Archivo agregado en esta fase:

- `docs/architecture/g0-trade-offer-capacity-adoption-2b-report.md`

Cambios productivos: ninguno.

Tests nuevos/modificados: ninguno. No se ejecutó una suite nueva porque no hubo cambio productivo y la stop condition exige detener inmediatamente, antes de construir un harness que presuponga una política no aprobada.

El último baseline acreditado permanece:

- Set mutation: 14/14.
- SharedLedger + replacement: 17/17.
- Authority: 14/14.
- Trade: 299/299.
- Suite completa: 1437 total, 1436 pass, 0 fail, 1 skipped.

## Alcance preservado

TradeSessionStore, `setOffer`, `session.reservations`, `reservationsByItem`, Trade API/authority/transfer y execution lifecycle permanecen sin cambios. Ground Items no fue implementado. No se creó otro ledger, repository, coordinator, socket, authority service ni recovery service.

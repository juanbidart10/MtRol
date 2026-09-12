# G0 Implementation 2C — Canonical Resource Capacity Quarantine

## Executive summary

`SharedReservationLedger` ahora representa incertidumbre de capacidad mediante una cuarentena canónica por `actorUuid + itemUuid`. La cuarentena no posee `quantity`, no altera reservas existentes y actúa como fence para todas las APIs que podrían adquirir, modificar o retirar capacidad sin reconciliación.

Trade productivo permanece sin cambios. Ground Items no fue implementado.

## Modelo final

El mismo runtime persistente contiene:

- `reservations`: compromisos numéricos por operationId.
- `reservationMutations`: evidencia durable de idempotencia.
- `resourceCapacityQuarantines`: incertidumbre por identidad de resource.

La identidad se deriva de Actor UUID e Item UUID normalizados y codificados. Sólo existe un registro canónico activo por resource, independientemente de session o domain.

Una cuarentena contiene:

```js
{
  actorUuid,
  itemUuid,
  reason: "LEGACY_RESERVATION_CONFLICT",
  state: "ACTIVE",
  revision,
  authorityGeneration,
  evidence: [{ fingerprint, observedAt, data }],
  createdAt,
  updatedAt
}
```

No contiene `quantity`. `RECOVERY_REQUIRED` continúa siendo estado de una reserva; quarantine es un fence del resource y no sustituye ese estado.

## API y evidencia

`quarantineResource(input, {authorityContext})` crea o amplía la cuarentena dentro de la misma mutación del repository. Por ahora sólo acepta la razón mínima `LEGACY_RESERVATION_CONFLICT`.

La misma evidencia se reconoce por fingerprint canónico y no se duplica. Evidencia distinta se agrega al historial y nunca reemplaza observaciones anteriores. La detección repetida conserva una sola identidad y una sola observación equivalente.

No se implementó clear/resolve. La reconciliación requiere un contrato posterior explícito.

## Capacity fence

Mientras la cuarentena está `ACTIVE`:

- `reserve` rechaza todos los domains con `CAPACITY_QUARANTINED`.
- `replaceReservation` rechaza increase y decrease.
- `replaceReservationsBatch` rechaza el batch completo si una entrada toca el resource.
- `mutateReservationSet` rechaza CREATE, REPLACE y RELEASE sobre el resource y preserva all-or-nothing para los demás resources.
- `transition/release` no permite iniciar o retirar capacidad. Se permite únicamente conservar el mismo estado o marcar una reserva `RECOVERY_REQUIRED`.

Se eligió rechazar decrease/release durante cuarentena. Aunque numéricamente reduzcan capacidad, no prueban que resuelvan la contradicción. La cuarentena nunca se elimina automáticamente.

## Persistencia, reload y concurrencia

`resourceCapacityQuarantines` se normaliza en `TradeRuntimeRepository` y se hidrata junto con reservas y mutation receipts. Después de reload, cualquier nueva reserva continúa bloqueada.

Dentro de la instancia autoritativa/repository compartido, quarantine y reserve usan la misma cola. Si quarantine gana primero, reserve es rechazada. Si reserve ya ganó antes de detectar el conflicto, esa reserva se conserva; luego quarantine bloquea adquisiciones posteriores. No se elimina ni ajusta su quantity.

Un fallo normal de persistencia no deja una cuarentena sólo en RAM. Un `AuthorityWriteContext` stale o perdido en la segunda frontera cooperativa tampoco altera el estado durable.

## Caso original

Para legacy evidence 3, ledger reservation 2 y real quantity 5:

- la reserva ledger permanece exactamente en 2;
- no se crea otra reserva;
- no se cambia a 3 o 5;
- la evidencia `{legacyQuantity: 3, ledgerQuantity: 2, realQuantity: 5}` queda en la cuarentena sin convertirse en cantidad autoritativa;
- toda nueva adquisición sobre el resource queda denegada.

## Archivos

Productivos:

- `scripts/runtime/shared-reservation-ledger.js`
- `scripts/trade/trade-runtime-repository.js`, únicamente para persistir el campo infraestructural `resourceCapacityQuarantines`.

Tests:

- `tests/resource-capacity-quarantine-g0.test.mjs`

## Resultados

- Quarantine: **10 pass, 0 fail**.
- SharedLedger + replacement: **17 pass, 0 fail**.
- Set mutation: **14 pass, 0 fail**.
- Authority: **14 pass, 0 fail**.
- Trade: **299 pass, 0 fail**.
- Validación combinada de infraestructura/Authority/characterization antes del último caso: **55 pass, 0 fail**.
- Suite completa final: **1447 total, 1446 pass, 0 fail, 1 skipped**.

El test `CHARACTERIZATION / KNOWN GAP` sigue reproduciendo el P0 Trade ↔ Ground-like porque Trade aún no adoptó el ledger, como requiere 2C.

## Límites

La garantía es local al Primary GM y repository compartido. Foundry no proporciona CAS distribuido ni fencing server-side para `game.settings`. Persiste la ventana `validate → write enviado → autoridad cambia → servidor acepta`.

No hubo cambios incidentales. La única decisión conservadora concretada fue rechazar decrease/release mientras el resource esté quarantined, tal como permitía la especificación. Resolución manual/automática, UI de recovery y adopción Trade permanecen deliberadamente pendientes.

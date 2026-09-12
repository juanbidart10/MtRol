# G0 Implementation 2D — Atomic Reservation Reacquire

## Executive summary

`SharedReservationLedger` ahora soporta REACQUIRE explícito: una identidad estable en `RELEASED` puede adquirir nueva capacidad y volver a `RESERVED`. No se borran registros, no se usa CREATE como fallback y no se amplió REPLACE ni `transition()`.

Trade productivo permanece sin cambios. Ground Items no fue implementado.

## Tests-first baseline

La suite nueva produjo inicialmente 9 fallos por ausencia de `reacquireReservation`/tipo `REACQUIRE`; un caso negativo pasó incidentalmente porque el tipo desconocido ya era rechazado. Después de implementar la transición explícita, los 10 tests pasan.

## Contrato

API singular:

```js
reacquireReservation({
  operationId,
  expectedRevision,
  quantity,
  mutationId,
  mutationFingerprint,
  evidence
}, { realQuantity, authorityContext })
```

La API es un wrapper de una única `mutateReservationSet` con `type: "REACQUIRE"`; no crea otro motor de mutaciones.

REACQUIRE exige:

- identidad existente;
- estado exacto `RELEASED`;
- `expectedRevision` igual a la revision durable;
- nueva quantity positiva explícita;
- capacidad final suficiente;
- resource sin cuarentena;
- AuthorityWriteContext válido cuando se proporciona.

El resultado conserva `operationId`, cambia a `RESERVED`, usa la quantity nueva y aumenta revision una vez. Historial, timestamps previos, fingerprint original y evidence existente se conservan; evidence nueva se combina.

## State machine y seguridad terminal

La única transición añadida es la operación auditable `REACQUIRE: RELEASED → RESERVED`. `transition()` continúa sin permitir revival.

REACQUIRE rechaza `RESERVED`, `COMMITTING`, `RECOVERY_REQUIRED`, `COMMITTED` y `ROLLED_BACK`. CREATE continúa rechazando identidades terminales y REPLACE continúa aceptando únicamente `RESERVED`.

## Capacidad, batch y orden

REACQUIRE participa en la simulación del estado final de `mutateReservationSet`. Puede combinarse atómicamente con REPLACE y RELEASE. Si cualquier CAS, state, quarantine o capacity check falla, ninguna entrada cambia.

Una RELEASE del mismo set puede financiar REACQUIRE sobre el resource. El orden accidental de esas operations no cambia la decisión ni el estado final.

## Idempotencia y reload

La transición reutiliza `reservationMutations`. Un retry conocido se resuelve antes de CAS, aunque `expectedRevision` ya sea stale. El mismo mutationId con otro fingerprint se rechaza. Tras reload, state, quantity y revision permanecen y el retry devuelve el resultado durable sin una segunda adquisición.

## Quarantine, authority y persistencia

Una cuarentena activa devuelve `CAPACITY_QUARANTINED` y conserva intactas la reserva y la evidencia de cuarentena. No se resuelve automáticamente.

Se valida AuthorityWriteContext al iniciar y nuevamente antes de persistir, después de las resoluciones async de cantidad. Un fallo en cualquiera de esas fronteras deja `RELEASED` intacto.

Un fallo normal del repository no crea un `RESERVED` sólo en RAM ni modifica el estado durable. No se ejecuta compensación posterior.

## Concurrencia

Dentro del repository compartido:

- REACQUIRE contra una reserva `ground-test` por la última unidad produce un ganador.
- Dos REACQUIRE desde la misma revision producen un ganador y una mutación stale.
- La suma activa nunca supera realQuantity.

No se acredita CAS distribuido ni fencing server-side entre writers independientes.

## Archivos

Productivo:

- `scripts/runtime/shared-reservation-ledger.js`

Tests:

- `tests/shared-reservation-reacquire-g0.test.mjs`

No fue necesario modificar repository ni schema.

## Resultados

- REACQUIRE: **10 pass, 0 fail**.
- Quarantine: **10 pass, 0 fail**.
- Set mutation: **14 pass, 0 fail**.
- SharedLedger + replacement: **17 pass, 0 fail**.
- Authority: **14 pass, 0 fail**.
- Infraestructura + Authority combinadas: **65 pass, 0 fail**.
- Trade: **299 pass, 0 fail**.
- Suite completa: **1457 total, 1456 pass, 0 fail, 1 skipped**.

No hubo cambios incidentales ni desviaciones. TradeSessionStore, setOffer, Trade execution/recovery, Ground Items y otros dominios permanecen sin cambios. La ventana server-side posterior al último recheck continúa explícitamente fuera de la garantía.

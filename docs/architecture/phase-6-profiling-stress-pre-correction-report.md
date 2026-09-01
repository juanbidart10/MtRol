# MTROL — Fase 6 — Profiling + Stress — Reporte previo a correcciones

Fecha: 2026-08-31  
HEAD: `fbf0f7e92a227d669fae1d132c3b08636076ce00`

## 1. Baseline

- Suite inicial: 1054 tests, 1053 pass, 0 fail, 1 skip intencional.
- Una única llamada runtime real a `combat.nextTurn()`.
- Cero mutaciones de negocio desde `PersonajeSheet`.
- Cero `console.*` en módulos productivos.
- `system.json`: SHA-256 `E0995689EC030FA0797CACE5D9D0EDD9F686082DE282FF940C353C15D1802034`.
- `mtrol.zip`: SHA-256 `5A19DC704CE99F935E162DF5F20FCC7E685AA77B355C6AEFB22B8ABCE2DCE693`.

## 2. Harness

Se agregó un harness exclusivamente de tests con reloj monotónico de Node. Calcula duración total, promedio, P50, P95, P99, máximo, throughput, errores y resultados settled. Los escenarios validan relaciones estructurales, orden, cleanup, pérdida de operaciones y estado residual; no establecen SLA ni umbrales estrechos de tiempo.

## 3. Mapa de superficies de concurrencia

| Componente | Propietario / lifetime | Partición | Bounded / cleanup | Reject | Serialización |
|---|---|---|---|---|---|
| `TransactionCoordinator.inFlight` | foundation / duración de operación | scope + transactionId | acotado por operaciones activas; `finally` | se elimina | dedupe de misma transacción |
| `TransactionCoordinator.operationQueues` | foundation / duración de cola | Actor para resource/damage/orb; scope + serializationKey para otras | `finally` | rechazo previo se consume sólo para liberar cola | por recurso/Actor o clave declarada |
| `ReceiptStore.inFlight` | receipt store / operación | scope + transactionId | `finally` | se elimina | dedupe de misma transacción |
| `RuntimeRepository.mutationQueues` | Combat / operación | Combat id | `finally` | cola posterior no queda envenenada | por Combat |
| `ActorRuntimeRepository.mutationQueues` | Actor / operación | Actor uuid | `finally` | cola posterior no queda envenenada | por Actor |
| `ActorRuntimeRepository.cache` | sesión cliente | Actor uuid | sin eviction runtime; sólo reset de tests | no aplica | reconstruible, no crítico |
| Receipts no-combate | Actor flag | transactionId | 128 terminales / 30 días; recovery-required protegido | persistente | por Actor |
| Receipts de Combat | Combat flag | transactionId | sin pruning durante lifetime del Combat | persistente | repository por Combat |
| Socket pending requests | cliente / request | requestId | response o timeout | resuelve envelope | sin cola global |
| Actor resource / Dharma / Orbes | módulo / operación | Actor uuid | `finally`; resets de tests | rechazo previo libera la cola | por Actor |
| Movement reservations/in-flight | turno/operación | Token/movement/resolution | cleanup explícito y recovery | recovery-required cuando ambiguo | clave declarada de reserva |
| TradeSessionStore | runtime Trade / sesión mundial | cola única | Promise reemplazada; receipts de operación persistentes sin límite definido | rollback de snapshot; cola posterior continúa | global entre todas las sesiones |
| TradeRuntimeRepository | setting mundial | cola única | Promise reemplazada | rechazo previo libera cola | global, coherente con agregado único |
| Trade audit queue | servicio audit / instancia | cola única | Promise reemplazada | fallo rechaza caller y cola posterior continúa | global para journal único |
| RecoveryCoordinator | ejecución Primary GM | receipts persistentes | Sets locales por corrida | marca recovery-required | repository scopes |
| Logger `recentKeys` | logger / proceso | key estable | limpieza lazy a 60 s o ventana mayor; sin máximo de cardinalidad | no aplica | ninguna |
| Integration observability | proceso | kind:name | events máximo 500; counts sin límite de nombres | no aplica | ninguna |

## 4. Métricas representativas

Mediciones del harness Node local. No son SLA.

| Operación | Count | P50 ms | P95 ms | P99 ms | Total ms | Throughput/s | Observación |
|---|---:|---:|---:|---:|---:|---:|---|
| TransactionCoordinator, mismo Actor | 100 | 725.398 | 1396.017 | 1458.912 | 1462.704 | 68.367 | orden estricto; cola limpia |
| TransactionCoordinator, Actors distintos | 100 | 29.702 | 33.403 | 33.582 | 34.387 | 2908.059 | peak 100; sin serialización global |
| CommandRegistry burst 250 | 250 | 1.496 | 1.925 | 2.088 | 2.318 | 107842.291 | 187 rechazos esperados, todos settled |
| Receipt dedupe 250 | 250 | 3.572 | 3.722 | 3.753 | 4.030 | 62031.661 | un solo side effect; in-flight 0 |
| Receipts Combat bulk | 1000 | 2730.781 | 4161.907 | 4307.279 | 4357.245 | 229.503 | 1001 receipts residuales |
| Movimiento, misma reserva | 100 | 734.166 | 1403.376 | 1464.505 | 1481.173 | 67.514 | orden estricto |
| Movimiento, reservas distintas | 100 | 302.869 | 375.217 | 381.723 | 383.907 | 260.480 | peak 100; progreso concurrente |
| Receipts Actor bulk | 1000 | 3902.427 | 4765.878 | 4795.671 | 4808.229 | 207.977 | residual exactamente 128 |
| Socket request/response 250 | 250 | 1.071 | 1.733 | 1.773 | 1.880 | 132971.650 | unresolved 0 |
| Trade audit queue | 100 | 745.584 | 1448.877 | 1510.565 | 1528.591 | 65.420 | 1 fallo aislado; 99 éxitos |

## 5. Stress y recovery

- 100 operaciones concurrentes del mismo Actor conservaron orden y limpiaron `inFlight`/colas.
- 100 Actors distintos alcanzaron peak 100: no existe lock global accidental en TransactionCoordinator.
- 100 callers de la misma transaction ejecutaron un solo side effect.
- 50 callers de recovery ambiguo ejecutaron `apply` una vez; recovery posterior ejecutó `reconcile` una vez y no reaplicó.
- Un reject certificado `no-effects` no envenenó la operación siguiente.
- Actor A lento bloqueó sólo Actor A; Actor B completó antes de liberar A.
- Ráfagas socket 10/50/100/250 terminaron sin Promises pendientes; respuestas duplicadas/tardías fueron inocuas.
- Audit Trade continuó después de un fallo persistente sin envenenar la cola.

## 6. Retained state

| Estructura | Before | Peak | Residual | Evaluación |
|---|---:|---:|---:|---|
| Coordinator in-flight/queues | 0 | 100 | 0 | correcto |
| ReceiptStore in-flight | 0 | 1000 | 0 | correcto |
| Actor receipt terminales | 0 | 1000 procesados | 128 | coincide con diseño |
| Combat receipts | 0 | 1001 | 1001 | sin límite durante Combat |
| Actor repository cache | 0 | 1001 Actors | 1001 | sin eviction runtime |
| Logger dedupe keys | 0 | 1000 | 1001 tras 6 s; 1 tras 66 s + siguiente log | cleanup lazy, cardinalidad por minuto sin máximo |

## 7. Hallazgos previos a correcciones

### HIGH — Trade serializa sesiones independientes globalmente

- Archivo: `scripts/trade/trade-session-service.js`.
- Causa: una única `mutationQueue` para todo el agregado.
- Evidencia: una persistencia lenta de sesión A impidió que sesión B independiente entrara a persistencia.
- Impacto: head-of-line entre sesiones simultáneas.
- Contexto: el agregado mundial contiene sesiones, índices, reservas y operation receipts; la serialización puede ser intencional para atomicidad.
- Propuesta mínima: decidir si se conserva la cola global o se introduce partición compatible con el agregado/revisionado. Cambia locking y requiere autorización.

### HIGH — Receipts de Combat no tienen política de retención

- Archivos: `scripts/runtime/runtime-repository.js`, `scripts/runtime/receipt-store.js`.
- Evidencia: 1000 operaciones dejaron 1001 receipts persistentes.
- Impacto: crecimiento lógico en Combats muy prolongados.
- Propuesta mínima: definir explícitamente retención que preserve recovery e idempotencia. Cambia garantías persistentes y requiere autorización.

### MEDIUM — Cache reconstruible de Actor sin eviction runtime

- Archivo: `scripts/runtime/actor-runtime-repository.js`.
- Evidencia: 1000 Actors dejaron 1001 entradas; mutation queues volvieron a cero.
- Impacto: referencias retenidas durante sesiones con muchos Actors/synthetic Actors.
- Propuesta mínima: eviction por lifecycle documental o política acotada alineada con Actors accesibles. Cambia lifetime/límite y requiere autorización.

### MEDIUM — Dedupe logger retiene keys expiradas hasta 60 s

- Archivo: `scripts/utils/logger.js`.
- Evidencia: 1000 keys permanecieron tras superar la ventana funcional de 5 s; bajaron a 1 tras superar 60 s y emitir otro log.
- Impacto: cardinalidad proporcional a keys únicas por minuto; no retiene Documents completos.
- Propuesta mínima: alinear expiry interno con la ventana por key o definir un máximo. Cambia límite interno y requiere autorización.

### OBSERVATION — Colas globales justificadas por storage único

- TradeRuntimeRepository y TradeAuditService serializan globalmente un único setting/journal.
- Audit alcanzó 65 operaciones/s en carga sintética, preservó orden y no quedó envenenado.
- No se recomienda particionar sin cambiar el modelo de persistencia.

### OBSERVATION — Contención esperada

- Mismo Actor/reserva muestra head-of-line conforme al contrato.
- Actors/reservas distintas progresan concurrentemente.
- No se observaron deadlocks, starvation, pérdida, doble aplicación ni unhandled rejections.

## 8. Estado previo a decisión

No se aplicó ninguna corrección de producción. Los cuatro hallazgos con propuestas implican cambiar locking o políticas de retención/lifetime y quedan detenidos para decisión del usuario.

## 9. Tests y regresión

- Tests agregados: 11.
- Harness agregado: 1 helper de tests.
- Focalizado: 11 pass, 0 fail.
- Suite global: 1065 tests, 1064 pass, 0 fail, 1 skip intencional.


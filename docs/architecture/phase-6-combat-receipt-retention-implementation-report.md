# MTROL — Fase 6 — Implementación de retención de Combat receipts

## Alcance

Se implementó la política autorizada `FULL → COMPACT → DELETE ON deleteCombat` dentro del store canónico `Combat.flags.mtrol.runtime.receipts`.

No se creó otro store, archive, coordinator, timer, worker, GC ni lock. No se modificaron gameplay, iniciativa, movimiento, oposición, Trade ni APIs públicas.

## 1. Schema FULL

Todo receipt nuevo comienza con:

```text
receiptSchemaVersion: 1
kind: "full"
transactionId
command
pendingActionId
status
createdAt
updatedAt
result
error
```

Durante una transacción puede incorporar metadata canónica, `prepared`, `checkpoints`, `failureSafety`, `recoveryReason`, `completedAt` o `failedAt`.

Receipts preexistentes sin `receiptSchemaVersion: 1` y `kind: full` se consideran legacy y nunca se compactan automáticamente.

## 2. Schema COMPACT

```text
receiptSchemaVersion: 1
kind: "compact"
transactionId
command
pendingActionId
status terminal
createdAt
updatedAt
completedAt | failedAt
failureSafety/error, sólo para failed seguro
actorUuid/targetActorUuid/sourceActorUuid/tokenUuid/combatantId, si existían
resultAvailable
result
changed
reasonCode
```

La identidad nunca desaparece mientras exista el Combat.

## 3. Condición exacta FULL → COMPACT

La política central `canCompactReceipt()` exige simultáneamente:

1. receipt válido, versionado y `kind=full`;
2. `transactionId` y `command` presentes;
3. estado `completed`, o `failed` con `failureSafety=no-effects|rolled-back`;
4. ninguna operación relacionada in-flight;
5. command reconocido por la política;
6. si existe `pendingActionId`, la acción debe existir, estar `resolved|cancelled`, poseer `terminalHandledAt` y no conservar reacción `available`;
7. oposición sólo se compacta con pending action demostrablemente cerrada.

`processing`, `prepared`, `applying`, `applied`, `recovery-required`, failed ambiguo, legacy, corruptos, commands desconocidos y dependencias abiertas permanecen FULL.

## 4. Información eliminada

Después de terminalización segura se eliminan:

- `prepared`;
- `checkpoints`;
- payloads y snapshots transaccionales pesados;
- metadata de recovery ya cerrada;
- campos derivados que no participan en identidad/replay.

## 5. Información preservada

- identidad y versión;
- command y estado terminal;
- timestamps terminales;
- identidad mínima de Actor/Token/Combatant necesaria para conflictos existentes;
- `failureSafety` y error para fallos seguros;
- resultado exacto de daño, recursos y movimiento;
- `changed` y `reasonCode` cuando existen.

El resultado pesado de oposición no se conserva después del cierre completo de su pending action.

## 6. Semántica de retry

Para `damage.*`, `resource.*` y `movement.*`, COMPACT conserva el resultado exacto. Un retry devuelve el mismo resultado y no ejecuta nuevamente el handler ni `apply`.

Un `transactionId` desconocido sigue creando una operación nueva. Un ID compactado siempre se reconoce como identidad ya procesada.

## 7. `TRANSACTION_RESULT_EXPIRED`

Cuando COMPACT no conserva un resultado reproducible, el retry lanza un error estable:

```text
reasonCode: TRANSACTION_RESULT_EXPIRED
ok: false
changed: false
```

No se invoca el handler, no se genera otra identidad y no se reaplican efectos. La auditoría y el test a través de `CommandRegistry` confirman que los consumers propagan o detienen el flujo; ninguno activa un fallback automático.

## 8. Migración legacy

La migración es lazy y no destructiva:

- sólo receipts creados con el schema nuevo son elegibles;
- legacy, ambiguos, corruptos o desconocidos permanecen FULL;
- no existe barrido agresivo de mundos;
- FULL y COMPACT conviven en el mismo objeto `receipts`.

No fue necesario cambiar el schema raíz de `flags.mtrol.runtime`.

## 9. Locking y crash safety

La compaction usa `RuntimeRepository.mutate`, por lo que comparte la cola existente por Combat con creación, transición, completion y recovery.

`ReceiptStore` y `TransactionCoordinator` ejecutan cleanup oportunista después de liberar su in-flight. La elegibilidad vuelve a comprobar el estado dentro de la mutación serializada. Dos cleanups convergen idempotentemente.

La persistencia reemplaza el snapshot del runtime en una única actualización. Un fallo de compaction queda aislado y estructuradamente registrado; nunca revierte ni transforma en fallo una operación de gameplay ya completada.

## 10. Tests agregados

Se agregaron 16 tests que cubren:

- todos los estados protegidos;
- safe failed y failed ambiguo;
- pending action/reacción abiertas;
- legacy, corruptos y commands desconocidos;
- schema COMPACT y eliminación de campos pesados;
- replay exacto sin doble efecto;
- `TRANSACTION_RESULT_EXPIRED` directo y vía `CommandRegistry`;
- ID desconocido versus expirado;
- ejecución/retry/recovery/reconcile versus compaction;
- dos cleanups concurrentes;
- integración con `TransactionCoordinator`;
- Combat inactivo, escena, reload y deleteCombat;
- stress de 1000 identidades.

El guardrail de Maps/Sets clasifica `OPPOSITION_COMMANDS` como configuración declarativa legítima.

## 11. Stress before/peak/after

| Momento | Keys | FULL | COMPACT | Bytes estimados |
|---|---:|---:|---:|---:|
| Antes | 0 | 0 | 0 | 2 |
| Pico | 1000 | 1000 | 0 | 1.511.561 |
| Después | 1000 | 0 | 1000 | 387.561 |

- checkpoints residuales: 0;
- identidades preservadas: 1000;
- reducción: 1.124.000 bytes;
- reducción estimada: 74,36%.

El objetivo es reducción de retención pesada, no reducción de transaction IDs.

## 12. Resultados de regresión

- receipts + coordinator + recovery: 45/45;
- movimiento, oposición, sockets, combate, Trade y profiling: 122/122;
- guardrails/integración/error handling: 15/15;
- suite global: 1086 totales, 1085 aprobados, 0 fallos, 1 skip intencional;
- duración global final: 20,154 s.

## 13. Riesgos residuales

- **HIGH** — la cantidad de identidades sigue creciendo linealmente en Combats muy largos; es requisito de exactly-once.
- **MEDIUM** — resultados exactos de daño/recursos/movimiento siguen ocupando espacio, aunque se retiró evidencia pesada de recovery.
- **MEDIUM** — legacy permanece FULL indefinidamente hasta una futura migración expresamente autorizada.
- **LOW** — cleanup es oportunista; un receipt elegible puede quedar FULL hasta la siguiente operación del store.

## 14. Invariantes finales

- una sola llamada runtime real a `combat.nextTurn()`;
- cero mutaciones de negocio desde `PersonajeSheet`;
- cero `console.*` productivos;
- Trade intacto en este bloque;
- API pública y gameplay intactos;
- `system.json` SHA-256 `E0995689EC030FA0797CACE5D9D0EDD9F686082DE282FF940C353C15D1802034`;
- `mtrol.zip` SHA-256 `5A19DC704CE99F935E162DF5F20FCC7E685AA77B355C6AEFB22B8ABCE2DCE693`, 453396771 bytes, timestamp 2026-08-27 19:34:03;
- HEAD `fbf0f7e92a227d669fae1d132c3b08636076ce00`;
- sin commit ni push.

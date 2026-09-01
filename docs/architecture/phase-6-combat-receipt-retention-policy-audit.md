# MTROL — Fase 6 — Auditoría y diseño de retención de Combat receipts

## Estado y alcance

Este documento es exclusivamente de auditoría y diseño. No se implementó pruning, no se borraron receipts y no se modificó código productivo, gameplay, schemas, APIs públicas, iniciativa, movimiento, oposición ni Trade.

Baseline previo a la auditoría:

- 1070 tests totales;
- 1069 aprobados;
- 0 fallos;
- 1 skip intencional;
- HEAD `fbf0f7e92a227d669fae1d132c3b08636076ce00`.

## 1. Inventario real

### 1.1 Combat transaction receipts — objeto de esta política

| Campo | Valor real |
|---|---|
| Propietario de persistencia | `RuntimeRepository` |
| Propietario de lifecycle | `ReceiptStore`; `TransactionCoordinator` agrega fases transaccionales |
| Persistencia | `Combat.flags.mtrol.runtime.receipts` |
| Flag | `flags.mtrol.runtime` |
| Clave primaria | `(Combat, transactionId)`; `transactionId` no es global |
| Creación | `ReceiptStore.begin()` inmediatamente antes de ejecutar la operación autoritativa |
| Escritura | `ReceiptStore`; `TransactionCoordinator`; `RecoveryCoordinator` para recovery |
| Lectura | `CommandRegistry`, `TransactionCoordinator`, `RecoveryCoordinator`, movimiento, estados y recovery de pending actions |
| Retención actual | ilimitada mientras exista el Combat Document |
| Pruning actual | ninguno |

Schema base creado por `ReceiptStore.begin()`:

```text
transactionId
command
pendingActionId
status = processing
createdAt
updatedAt
result = null
error = null
```

`ReceiptStore` puede agregar `completedAt`, `failedAt`, `result` y `error`.

`TransactionCoordinator` extiende el mismo receipt, no crea otro store:

```text
metadata específica del command
prepared
checkpoints
failureSafety
recoveryReason
status = prepared | applying | applied | recovery-required
```

La metadata se aplana sobre el receipt durante `prepared`. Según el command puede incluir Actor, Token, Combatant, posición, round/turn, payload canónico parcial, origen del recurso o fingerprint de intención.

### 1.2 Dos familias dentro del mismo contenedor

1. **Command receipts simples**: `opposition.create`, `opposition.respond`, `opposition.declare-response`, `opposition.resolve`, `opposition.cancel` y `opposition.reaction-complete`. Usan la idempotencia de `CommandRegistry` + `ReceiptStore` y normalmente transicionan `processing → completed|failed`.
2. **Transaction receipts con checkpoints**: `damage.*`, `resource.*`, `movement.*` y otras operaciones ejecutadas por `TransactionCoordinator`. Durante un Combat, daño y recursos del Actor se guardan en el runtime del Combat; fuera de Combat usan el runtime del Actor.

No son schemas independientes: se discriminan por `command`, `status` y campos presentes.

### 1.3 Estructuras relacionadas que no son Combat receipts

- `pendingActions` y `runtime.recovery`: estado persistente relacionado; puede bloquear la elegibilidad de un receipt, pero no es un receipt.
- `ReceiptStore.inFlight`, `TransactionCoordinator.inFlight` y `operationQueues`: coordinación RAM-only de operaciones activas, liberada en `finally`; no es evidencia histórica.
- `Actor.flags.mtrol.transactionRuntime.receipts`: receipts no-Combat. Ya poseen política separada de 128 terminales y 30 días, protegiendo estados desconocidos/no terminales. Quedan fuera de este diseño.
- `completedTransactions` y `consumedTransactions`: caches reconstruibles RAM-only; la autoridad real está en receipts persistentes.
- Objetos llamados `receipt` en MP, Dharma, progresión y UI: resultados de dominio, no stores adicionales.
- Trade `operationReceipts`/`receipts`: excluidos expresamente del alcance.

Conclusión: existe un único contenedor canónico de Combat receipts, con dos perfiles de lifecycle.

## 2. Lifecycle real

### 2.1 Command receipt simple

```text
sin receipt
  → processing
  → completed
  └→ failed
```

`completed` conserva el resultado exacto. Un reenvío con el mismo `transactionId` devuelve ese resultado sin ejecutar el handler.

`failed` conserva el error y bloquea el retry automático. En esta familia no existe evidencia general que permita interpretar todo `failed` como `no-effects`.

### 2.2 TransactionCoordinator

```text
sin receipt
  → processing
  → prepared
  → applying
  → applied
  → completed

fallo probado sin efectos/compensado
  → failed + failureSafety=no-effects|rolled-back

fallo después de entrar en apply o con checkpoint ambiguo
  → recovery-required
```

Estados pedidos en el contrato pero no persistidos por el código actual:

- `CREATED` y `PENDING`: no existen como estados diferenciados; `processing` es el primer estado durable.
- `RECONCILING`: la reconciliación es una ejecución transitoria; el receipt conserva su estado anterior hasta `completed` o `recovery-required`.
- `RESOLVED` y `CANCELLED`: son estados de `pendingAction`, no estados del receipt. El command correspondiente termina como `completed`.

### 2.3 Reload y recovery

- `applied` con `result` se promueve a `completed` sin repetir efectos.
- `processing`, `prepared` y `applying` se transforman en `recovery-required` en el recovery general.
- `recovery-required` permanece protegido.
- estados legacy/desconocidos se reportan como evidencia ambigua y no se reescriben.
- un `opposition.create` interrumpido puede completarse si la pending action durable ya existe.
- una resolución ambigua puede convertir la pending action en `recovery-required`.

### 2.4 Resultado por escenario

| Escenario | Estado posible |
|---|---|
| Operación activa | processing, prepared, applying |
| Apply terminado; ACK final pendiente | applied |
| Éxito durable | completed |
| Rechazo probado sin efectos | failed + no-effects |
| Compensación confirmada | failed + rolled-back |
| Fallo simple de command | failed, sin garantía de seguridad |
| Efecto parcial o persistencia ambigua | recovery-required o fase intermedia |
| Recovery exitoso | completed |
| Cancelación de oposición | receipt completed + pendingAction cancelled |
| Reload | receipts persistidos y reanalizados |

## 3. Garantías protegidas

| Garantía | Evidencia necesaria |
|---|---|
| Idempotencia | `transactionId`, scope del Combat, `command`, identidad/fingerprint y estado terminal. Para replay compatible también requiere `result`. |
| Retry seguro | receipt completo para devolver el mismo resultado; un tombstone sólo podría rechazar el retry sin repetir efectos. |
| Recovery | `status`, `command`, `prepared`, `checkpoints`, `result`, `failureSafety`, `recoveryReason` y metadata de Actor/Token. |
| Reconciliation | estado preparado, checkpoints y snapshots/resultados canónicos. |
| Auditoría | no se encontró una dependencia de negocio histórica genérica; sí existen lectores operativos concretos. |
| Orden/bloqueo | command, estado y metadata de Actor. Transacciones no terminales bloquean operaciones incompatibles sobre el mismo recurso. |

Lectores operativos adicionales:

- movimiento busca receipts `movement.commit` completados para no hacer rollback sobre una posición ya confirmada;
- recovery de movimiento recorre fases activas/recovery;
- recovery de oposición usa receipt + `pendingActionId` + resultado;
- estados buscan `state.apply` en `recovery-required`;
- `TransactionCoordinator` usa receipts no terminales para bloquear mutaciones incompatibles.

Los timestamps no determinan hoy la retención de Combat, pero son indispensables para una futura elegibilidad. El payload original no se conserva uniformemente; sólo metadata canónica parcial.

## 4. Clasificación formal de elegibilidad

### Nunca prunable/compactable

- `processing`, `prepared`, `applying`, `applied`;
- `recovery-required`;
- `failed` sin `failureSafety=no-effects|rolled-back`;
- status desconocido, ausente o legacy;
- receipt corrupto o sin identidad verificable;
- receipt mencionado por recovery pendiente;
- receipt ligado a pending action activa, ambigua o `recovery-required`;
- receipt ligado a reacción de movimiento todavía `available`;
- receipt con operación in-flight/reconcile activa;
- receipt cuya dependencia externa no pueda reconstruirse o demostrarse cerrada.

### Potencialmente compactable

- `completed`;
- `failed + no-effects`;
- `failed + rolled-back`;

Además deben cumplirse todas estas condiciones:

1. timestamps válidos y ventana aprobada vencida;
2. ninguna referencia en `runtime.recovery`;
3. ninguna operación in-flight con el mismo scope/transactionId;
4. si posee `pendingActionId`, la pending action existe, está `resolved|cancelled`, no está en recovery, no tiene reacción disponible y completó su cierre terminal;
5. no existe una reconciliación pendiente de daño, recurso o movimiento;
6. el resultado completo ya no es requerido para el periodo de replay aprobado;
7. se conserva evidencia mínima que impida reaplicar el mismo `transactionId` mientras el Combat siga aceptando commands.

### Prunable por eliminación real

La eliminación total de identidad sólo es segura cuando el Combat Document se elimina y los commands dirigidos a su `combatId` dejan de ser aceptables. Antes de esa frontera, borrar totalmente un receipt terminal puede transformar un retry en una operación nueva.

## 5. Idempotency window

Hechos observados:

- timeout de socket: 30 segundos;
- no existe retry automático general;
- un ACK puede llegar después del timeout y ser ignorado aunque el efecto ya se haya aplicado;
- reload/reconnect pierde la Promise local, pero no el receipt persistente;
- varios commands de oposición generan IDs deterministas a partir de la pending action;
- otras APIs generan un ID nuevo por invocación, por lo que ningún receipt evita duplicados con un ID diferente.

Opciones:

| Ventana | Ventaja | Riesgo |
|---|---|---|
| Sesión de cliente | pequeña | insegura ante reload, reconnect, cambio de GM y ACK tardío |
| N rondas | ligada al Combat | una ronda no representa tiempo de red/recovery; no cubre commands sin round |
| Tiempo fijo | permite calcular crecimiento | el código sólo prueba un mínimo de 30 s, no un máximo legítimo; requiere contrato nuevo |
| Duración del Combat | no requiere número arbitrario; máxima compatibilidad | crecimiento lineal en combates largos |
| Hasta checkpoint seguro | cierra dependencias de dominio | no reemplaza la ventana de retry/idempotencia |

Conclusión: el código actual sólo demuestra con seguridad la duración del Combat como ventana de identidad. No existe evidencia para elegir un TTL numérico. Un número requiere una decisión explícita de producto.

## 6. Recovery window

Todo receipt activo, ambiguo o `recovery-required` se conserva indefinidamente hasta resolución explícita. El tiempo, round, cierre visual o desconexión no prueban seguridad.

Casos obligatoriamente protegidos:

- apply exitoso y persistencia/ACK final fallido: puede quedar `applied` o en fase intermedia;
- persistencia exitosa y ACK de socket perdido: `completed` debe conservar resultado durante la ventana de replay;
- checkpoints parciales: necesarios para reconcile;
- retry posterior a reload: debe consultar el receipt, nunca reaplicar por ausencia accidental;
- recovery/reconcile pendiente: no compactable.

Después de recovery exitoso a `completed`, puede comenzar la retención terminal, no antes.

## 7. Relación con Combat lifecycle

- `deleteCombat` limpia caches RAM de movimiento y dispara `mtrolCombatEnd`; no existe pruning explícito porque el propio Combat Document, incluido su flag runtime, es eliminado.
- no se encontró una frontera persistente separada de “Combat cerrado” que pruebe que no llegarán requests atrasados;
- remover un Combatant no cierra receipts del Combat;
- cambiar de Scene no cierra receipts;
- reload de mundo exige conservarlos;
- un Combat inactivo pero todavía existente sigue siendo evidencia recuperable y no equivale a `deleteCombat`.

Respuesta: un receipt terminal puede desaparecer con seguridad cuando el Combat Document es realmente eliminado. “Terminar” o desactivar sin eliminar no constituye hoy una prueba suficiente.

## 8. Políticas alternativas

### Política A — Retención completa hasta `deleteCombat`

- Idempotencia: máxima para el mismo `transactionId`.
- Recovery: máxima.
- Crecimiento: O(transacciones por Combat); 1000 operaciones observadas producen 1001 receipts.
- Complejidad: mínima.
- Migración: ninguna.
- Riesgo: HIGH por crecimiento en combates largos/mundos con Combats conservados.

### Política B — Eliminación temporal de terminales

- Idempotencia: limitada al TTL.
- Recovery: segura sólo si se excluyen todas las fases ambiguas.
- Crecimiento: aproximadamente tasa de transacciones × ventana.
- Complejidad: media.
- Migración: receipts sin timestamp deben conservarse.
- Riesgo: CRITICAL; un retry tardío con el mismo ID puede reaplicar daño, recursos o movimiento. No recomendada.

### Política C — Híbrida: receipt completo → tombstone → eliminación con Combat

- Activos, ambiguos y recovery: receipt completo indefinido.
- Terminales: receipt completo hasta cierre de dependencias + ventana de replay aprobada.
- Después: compactación determinista a tombstone mínimo que conserve identidad, command/fingerprint y estado terminal.
- Tombstone: retenido hasta `deleteCombat`; impide doble aplicación, pero ya no puede devolver el resultado completo.
- Crecimiento: cantidad lineal, tamaño por receipt mucho menor y acotable; no ofrece límite estricto de cantidad.
- Complejidad: media/alta.
- Migración: conservadora y versionada.
- Riesgo: HIGH hasta definir la respuesta observable para retry sobre tombstone.

### Política D — Checkpoints/epochs con verdadero límite de cantidad

- Requeriría IDs ordenables o un epoch persistente y una regla para rechazar IDs anteriores al checkpoint.
- Puede acotar cantidad, pero cambia generación/aceptación de transaction IDs y el contrato de retry.
- Complejidad y migración: altas.
- Riesgo: CRITICAL; no recomendada para la primera implementación.

### Recomendación

Política C. Es la única que reduce tamaño sin convertir la ausencia de receipt en permiso para repetir side effects. Debe implementarse sólo después de autorizar schema/versionado, ventana de replay y respuesta estable a un retry compactado.

## 9. Bounding

| Mecanismo | Evaluación |
|---|---|
| Máximo por Combat | inseguro si elimina IDs todavía reintentables |
| Máximo por Actor | no encaja con storage compartido y puede romper operaciones cross-Actor |
| Máximo global | inseguro y difícil de hacer atómico |
| TTL con borrado | inseguro sin contrato de expiración |
| Compactación a tombstone | recomendada; reduce bytes, preserva exactly-once |
| Snapshot/checkpoint | futuro; requiere IDs ordenables/epoch y decisión material |

No debe aplicarse un límite que borre evidencia todavía necesaria. En la primera versión se debe medir bytes y cantidad, no imponer un máximo destructivo.

## 10. Migración no destructiva

1. introducir lector compatible con runtime previo;
2. clasificar sin modificar receipts legacy;
3. preservar todo receipt sin status/timestamp/metadata suficiente;
4. preservar todo `recovery-required`, fase activa, failure ambiguo o dato corrupto;
5. compactar sólo terminales modernos cuya seguridad se demuestre;
6. escribir tombstones de forma idempotente;
7. no eliminar físicamente identidad durante la primera migración;
8. registrar conteos, no payloads completos;
9. permitir rerun sin cambios adicionales.

Un receipt legacy es `protected-unknown` hasta prueba contraria.

## 11. Versionado

El cambio estructural necesita versión persistente. La recomendación es reutilizar `flags.mtrol.runtime.schemaVersion` y migrar a una versión siguiente que reconozca receipts completos y tombstones. No agregar inicialmente un segundo `receiptPolicyVersion` si el `schemaVersion` ya describe toda la estructura.

Un campo separado sólo sería justificable si la política pudiera cambiar sin cambiar el schema. Evitar versiones por receipt salvo un discriminador mínimo como `kind=receipt|tombstone` dentro del runtime versionado.

Esto es una modificación de schema persistente y requiere autorización HIGH antes de implementarse.

## 12. Algoritmo propuesto, sin implementar

```text
assert Primary GM
runtimeRepository.mutate(combat, draft =>
  for each receipt ordered deterministically by transactionId:
    if receipt already is tombstone:
      keep unchanged
      continue

    if status/schema/timestamps are unknown:
      keep as protected-unknown
      continue

    if status is active, applied, recovery-required or ambiguous failed:
      keep full receipt
      continue

    if referenced by recovery, in-flight work or open pendingAction dependency:
      keep full receipt
      continue

    if replay retention window has not expired:
      keep full receipt
      continue

    replace atomically with deterministic tombstone:
      transactionId
      command
      scope/fingerprint required to detect conflict
      terminal status
      completedAt/failedAt
      result availability = expired
      policy/schema version
)
```

Selección y persistencia ocurren en una sola mutación del runtime. Un crash deja el snapshot anterior o el nuevo; una segunda ejecución produce el mismo tombstone. No se borran activos ni recovery. Si el Combat desaparece durante la escritura, se aborta sin side effects externos.

El pruning definitivo es la eliminación del Combat Document. No se propone un borrado individual de tombstones en la primera versión.

## 13. Concurrencia y locking

- reutilizar la cola por Combat de `RuntimeRepository.mutate`;
- ejecutar únicamente en Primary GM;
- no crear coordinator, timer, GC o lock paralelo;
- clasificar usando el draft más reciente dentro de la mutación;
- excluir IDs presentes en operaciones in-flight/reconcile;
- un retry concurrente debe observar receipt completo o tombstone, nunca ausencia;
- recovery concurrente usa la misma cola; si completa primero, el nuevo `completedAt` inicia la ventana; si corre después, el estado no terminal sigue protegido;
- cierre/delete concurrente puede hacer fallar la persistencia, pero no debe reintentarse sobre otro Combat.

Para exponer de forma limpia los in-flight existentes podría requerirse una consulta de sólo lectura en sus propietarios actuales. Si eso obliga a modificar el modelo de locking o `TransactionCoordinator`, es una decisión material y debe detener la implementación.

## 14. Plan de tests futuro

1. processing no se compacta;
2. prepared no se compacta;
3. applying no se compacta;
4. applied no se compacta;
5. recovery-required no se compacta;
6. failed ambiguo no se compacta;
7. failed no-effects/rolled-back dentro de ventana no se compacta;
8. terminal dentro de ventana no se compacta;
9. terminal vencido y sin dependencias se compacta;
10. pending action activa bloquea compactación;
11. reacción disponible bloquea compactación;
12. recovery reference bloquea compactación;
13. retry dentro de ventana devuelve resultado idéntico;
14. retry sobre tombstone nunca reaplica y devuelve el contrato autorizado;
15. Combat activo conserva tombstones;
16. Combat inactivo pero existente conserva tombstones;
17. deleteCombat elimina el scope completo naturalmente;
18. receipts legacy sin timestamp se preservan;
19. status desconocido/corrupto se preserva y registra;
20. pruning concurrente con nueva transacción;
21. pruning concurrente con retry;
22. pruning concurrente con recovery/reconcile;
23. pruning concurrente con deleteCombat;
24. crash/ACK perdido durante persistencia;
25. segunda ejecución es idempotente;
26. movement position receipt no pierde su protección prematuramente;
27. mismo Actor y multi-Actor conservan serialización existente;
28. stress de 1000 y 10000 receipts completos;
29. stress de 10000 tombstones y medición de bytes;
30. cero doble aplicación en daño, recurso, movimiento y oposición;
31. suite global e invariantes arquitectónicas.

## 15. Riesgos

- **CRITICAL** — borrar un terminal mientras su Combat acepta el mismo `transactionId` puede duplicar side effects.
- **CRITICAL** — tratar un tombstone como receipt ausente produciría el mismo problema.
- **HIGH** — no existe una ventana temporal máxima demostrable para retries legítimos.
- **HIGH** — tombstones requieren schema/lector y una respuesta observable definida.
- **HIGH** — Combats muy largos siguen acumulando una identidad por transacción aun con compactación.
- **HIGH** — `failed` simple no demuestra ausencia de efectos y debe permanecer protegido.
- **MEDIUM** — resultados grandes dominan tamaño; se necesita profiling de bytes, no sólo cantidad.
- **MEDIUM** — movimiento posee un lector cross-transaction de receipts completados y requiere una prueba específica.
- **MEDIUM** — Combats inactivos conservados en el mundo mantienen runtime y tombstones.
- **LOW** — caches RAM no son autoridad y no deben intervenir en retención histórica.

## 16. Decisiones que requieren autorización

### CRITICAL

1. **Retry sobre tombstone**: recomendar `TRANSACTION_RESULT_EXPIRED`, con `ok=false`, `changed=false` y prohibición absoluta de reejecutar. Alternativa: conservar el resultado completo hasta `deleteCombat`.
2. **Eliminación individual antes de `deleteCombat`**: recomendar prohibirla en la primera versión.
3. **True bounding por epochs/checkpoints**: posponer; cambiaría el contrato de transaction IDs.

### HIGH

4. **Ventana de resultado completo**: duración completa del Combat o un tiempo explícito aún no justificable por el código.
5. **Schema versionado con tombstones**: autorizar evolución de runtime y migración no destructiva.
6. **Combat inactivo**: decidir si sigue aceptando replay o se introduce un cierre persistente autoritativo. Hoy debe considerarse abierto.
7. **Momento de ejecución**: recomendar cleanup oportunista en un propietario existente, no timer; debe definirse el checkpoint exacto.

### MEDIUM

8. campos exactos del tombstone y fingerprint por familia de command;
9. presupuesto de bytes/alertas para 1000 y 10000 receipts;
10. si `failed + no-effects|rolled-back` usa la misma ventana que `completed`.

### LOW

11. métricas estructuradas y presentación del informe de retención al GM.

## 17. Recomendación de decisión

Autorizar como siguiente bloque únicamente un diseño cerrado de Política C con estas invariantes:

- nunca borrar identidad dentro de un Combat existente;
- full receipt para activos, recovery, ambiguos y durante replay;
- tombstone después de cierre de dependencias y ventana autorizada;
- retry sobre tombstone rechaza de forma estable y jamás reaplica;
- tombstones desaparecen sólo con `deleteCombat`;
- migración conservadora, versionada y no destructiva;
- locking reutiliza `RuntimeRepository` y autoridad Primary GM.

No comenzar implementación hasta cerrar las decisiones CRITICAL y HIGH anteriores.

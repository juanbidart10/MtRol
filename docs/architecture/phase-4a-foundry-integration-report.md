# MTROL — Informe Fase 4A: integración con Foundry

Fecha: 2026-08-29  
Rama: `refactor/combat-architecture`  
Alcance: Authority, hooks, sockets, lifecycle, façade pública y observabilidad.  
Exclusión expresa: Trade runtime (reservado para Fase 4B).

## A. Baseline

El baseline previo a Fase 4A estaba verde:

| Métrica | Antes | Después |
|---|---:|---:|
| Tests totales | 932 | 943 |
| Pass | 931 | 942 |
| Fail | 0 | 0 |
| Skip intencional | 1 | 1 |
| Registros estáticos `Hooks.on/once` | 60 | 52 |
| Referencias estáticas `game.mtrol` | 72 | 68 |
| Llamadas `game.socket.on/emit` | 8 | 8 |
| Llamadas runtime a `combat.nextTurn()` | 1 | 1 |
| Monkey patches | 1 | 1 |
| Call sites estáticos de `.update()` en áreas auditadas | 48 | 48 |

No se realizó migración de mundo ni se modificó `mtrol.zip`.

## B. Hooks before/after

Se consolidaron los eventos documentales solapados de Actor, Item y Token bajo un bridge único:

- `preUpdateActor`
- `updateActor`
- `preUpdateItem`
- `updateItem`
- `preUpdateToken`
- `updateToken`

Antes, cada concern registraba directamente su callback y el orden dependía del orden incidental de carga. Después, Foundry registra una vez cada bridge y MtRol registra subscribers con ID, prioridad y criticidad. La reducción neta estática fue de 60 a 52 registros, sin imponer una meta estética.

Trade conserva sus hooks propios, según la exclusión de Fase 4A. `scripts/integrations/item-piles.js` mantiene un `updateActor` aislado y queda clasificado para auditoría posterior porque no forma parte del bridge de inicialización actual.

## C. Sockets before/after

El namespace físico continúa siendo `system.mtrol`; no se crearon sockets por feature. El callback ahora recibe la identidad de transporte que Foundry entrega como segundo argumento y autentica esa identidad antes del dispatch.

### Command Registry canónico con adapters legacy

| Socket legacy | Command canónico | Estado |
|---|---|---|
| `mtrolCreatePendingAction` | `opposition.create` | COMPATIBILITY ADAPTER |
| `mtrolAttachDefenseRoll` | `opposition.respond` | COMPATIBILITY ADAPTER |
| `mtrolDeclareOppositionResponse` | `opposition.declare-response` | COMPATIBILITY ADAPTER |
| `mtrolResolvePendingAction` | `opposition.resolve` | COMPATIBILITY ADAPTER |
| `mtrolClearPendingAction` | `opposition.cancel` | COMPATIBILITY ADAPTER |
| `mtrolRequestPendingActionsForActor` | `opposition.list` | COMPATIBILITY ADAPTER |
| `mtrolCompleteReactionMovement` | `opposition.reaction-complete` | COMPATIBILITY ADAPTER |
| `mtrolAplicarDanio`, `mtrolAplicarDanioLocalizado` | `damage.apply` | COMPATIBILITY ADAPTER |
| `mtrolSpendMP` | `resource.mp-spend` | COMPATIBILITY ADAPTER |
| `mtrolRefundMP` | `resource.mp-refund` | COMPATIBILITY ADAPTER |
| `mtrolRestoreMeditationMP` | `resource.meditate` | COMPATIBILITY ADAPTER |
| `mtrolConsumeDharma` | `resource.dharma-spend` | COMPATIBILITY ADAPTER |
| `mtrolAdjustDestiny` | `resource.destiny-adjust` | COMPATIBILITY ADAPTER |
| `mtrolSelectCompetenceMode` | `resource.competence-mode-intent` | COMPATIBILITY ADAPTER |
| `mtrolUseConsumable` | `consumable.use` | COMPATIBILITY ADAPTER |
| `mtrolCommitTurnMovement`, `mtrolCommitGrantedMovement`, `mtrolCommitReactionMovement` | `movement.commit` | COMPATIBILITY ADAPTER |
| `mtrolCompleteGrantedMovement` | `movement.renounce` | COMPATIBILITY ADAPTER |
| `mtrolPrepareTurn` | `turn.prepare` | COMPATIBILITY ADAPTER |
| `mtrolSetPreparation` | `turn.preparation-set` | COMPATIBILITY ADAPTER |
| `mtrolReservePreparation` | `turn.preparation-reserve` | COMPATIBILITY ADAPTER |
| `mtrolCompletePreparation` | `turn.preparation-complete` | COMPATIBILITY ADAPTER |
| `mtrolCancelPreparationReservation` | `turn.preparation-cancel` | COMPATIBILITY ADAPTER |
| `mtrolEndTurn` | `turn.end` | COMPATIBILITY ADAPTER |
| `mtrolGrantTurnMovement` | `turn.movement-grant` | COMPATIBILITY ADAPTER |
| `mtrolCompleteAttributeMovement` | `turn.attribute-movement-complete` | COMPATIBILITY ADAPTER |
| `mtrolFinalizeTurnUse` | `turn.use-finalize` | COMPATIBILITY ADAPTER |
| `mtrolCompleteTurnAction` | `turn.action-complete` | COMPATIBILITY ADAPTER |

Las diez rutas directas de turnos fueron retiradas del `switch` de sockets: ya no existen dos handlers para el mismo evento.

### Integración legacy todavía directa

| Socket | Consumer/handler | Lógica o mutación | Estado |
|---|---|---|---|
| `mtrolSpendPendingAttribute` | progression service | avance persistente | LEGACY WITH DOMAIN LOGIC |
| `mtrolSpendPendingCompetence` | progression service | avance persistente | LEGACY WITH DOMAIN LOGIC |
| `mtrolCreateReadyDamageAction` | action engine | crea pending action | LEGACY WITH DOMAIN LOGIC |
| `mtrolExecuteResolvedDamage` | damage engine | resuelve daño pendiente | LEGACY WITH DOMAIN LOGIC |
| `mtrolApplyState` | state engine | aplica estado y chat | LEGACY WITH DOMAIN LOGIC |

Estas rutas pasan por autenticación genérica, pero aún no convergen en Command Registry. Migrarlas sin ampliar pruebas de contrato y policy de dominio se deja como trabajo posterior.

### Presentación y sincronización

`mtrolSocketResponse`, `mtrolPendingActionSync` y `mtrolPendingActionCleared` son transporte de respuesta/presentación, no commands. Los dos eventos de pending action sólo aceptan al Primary GM como emisor. Los eventos de sincronización de Trade permanecen sin migrar para Fase 4B.

### Trade excluido

`mtrolTradeCreateSession`, `mtrolTradeAcceptSession`, `mtrolTradeSetOffer`, `mtrolTradeConfirm`, `mtrolTradeCancel`, `mtrolTradeGMCancel` y sus eventos de sync conservaron su lógica runtime. El boundary genérico autentica requests antes del `switch`, pero no se alteró el dominio de Trade.

`mtrolEjecutarComercio`, emitido por el diálogo legacy, queda clasificado como DEAD / UNKNOWN respecto del handler central actual y debe resolverse en 4B.

## D. Authority architecture

Se agregó un único `AuthorityService` con responsabilidades limitadas:

- resolución determinista del Primary GM activo;
- reelección dinámica cuando cambia la presencia de usuarios;
- identificación del emisor real informado por Foundry;
- rechazo de `requestingUserId` falsificado;
- rechazo de requests dirigidos a otra autoridad;
- comprobación básica de ownership de Actor;
- metadata autoritativa para adapters.

No contiene reglas de MP, alcance, oposición, daño, cooldown ni movimiento.

## E. Command transport

El flujo principal queda:

`Foundry socket → socket adapter → AuthorityService → Command Registry → domain service → transaction/repository → Document`.

Los adapters normalizan el usuario a partir del sender autenticado. Oposición, daño, recursos, consumibles, movimiento y turnos convergen en los registries ya existentes. No se creó un registry paralelo.

## F. Dispatchers

`HookDispatcher` ofrece:

- subscriber ID estable;
- prevención de registro duplicado;
- prioridad explícita;
- modo síncrono para `preUpdate*`;
- modo async para `update*`;
- aislamiento de errores;
- telemetría por hook y subscriber.

El bridge documental también tiene guard de instalación idempotente.

## G. Hook ordering

Orden relevante consolidado:

| Evento | Prioridad | Subscriber | Tipo |
|---|---:|---|---|
| `preUpdateToken` | 10 | `carry-weight.guard` | CRITICAL |
| `preUpdateToken` | 20 | `turn.movement-guard` | CRITICAL |
| `updateToken` | 20 | `turn.movement-commit` | CRITICAL |
| `updateToken` | 300 | `3d.follow-token` | NON-CRITICAL |
| `preUpdateActor` | 10 | class resource guard | CRITICAL |
| `preUpdateActor` | 20 | orb authority guard | CRITICAL |
| `preUpdateActor` | 30 | special ability guard | CRITICAL |
| `preUpdateActor` | 40 | turn preparation guard | CRITICAL |
| `preUpdateActor` | 100 | death pre-capture | NON-CRITICAL |
| `updateActor` | 100 | death synchronization | NON-CRITICAL |
| `updateActor` | 150 | turn presentation | NON-CRITICAL |
| `updateActor` | 200 | special ability presentation | NON-CRITICAL |
| `preUpdateItem` | 10 | orb authority guard | CRITICAL |
| `updateItem` | 150 | turn presentation | NON-CRITICAL |

## H. Error isolation

Un subscriber crítico que rechaza devuelve `false` en `preUpdate*`; una excepción crítica aborta el dispatcher async. Un subscriber no crítico se registra como warning y la cadena continúa, incluso si devuelve `false`. Los fallos dejan contexto estructurado de hook, subscriber y criticidad.

## I. Document mutation policy

La policy formal queda: mutaciones mecánicas nuevas deben entrar por command, pasar por servicio de dominio y usar `TransactionCoordinator`/repositorio antes del Document. Los hooks documentales consolidados sólo detectan, validan, normalizan, presentan o delegan.

Los 48 call sites estáticos de `.update()` preexistentes no se aumentaron. No se hizo una extracción física masiva de `action-engine.js` ni `turn-system.js`.

## J. External mutation handling

Los guards diferencian identidad, ownership y contexto de movimiento. El movimiento transaccional etiqueta updates con `mtrolMovementOperation` y `mtrolMovementTransactionId`; los hooks pueden reconocer commit, rollback y reconciliation sin convertirlos en una intención nueva. Mutaciones externas válidas se observan sin fabricar receipts históricos.

## K. Lifecycle

`LifecycleCoordinator` deduplica fases completadas y comparte ejecuciones in-flight:

| Foundry | Fase MtRol | Responsabilidad |
|---|---|---|
| `init` | `INIT` | modelos, sheets, façade, definitions y command handlers |
| `setup` | `REGISTER` | adapters y hooks |
| `ready` | `READY` | socket transport y runtime dependiente del world |
| dentro de `READY`/cambio de usuario | `RECOVER` funcional | RecoveryCoordinator, pending actions y movement recovery |

Foundry dispara `init` antes de `setup`; por eso el orden físico es `INIT → REGISTER → READY`, manteniendo responsabilidades explícitas. Las reparaciones autoritativas quedan limitadas al Primary GM.

## L. `game.mtrol` façade

Clasificación:

- PUBLIC-STABLE: `roll`, `turns`, `states`, `specialAbilities`, daño autorizado y utilidades públicas de `actions`.
- PUBLIC-COMPATIBILITY: aliases y entrypoints históricos dentro de `actions`, `debug`, `fx` y `fxDebug`.
- INTERNAL-LEAK: operaciones autoritativas expuestas dentro de `actions`; se conservan por compatibilidad, pero los módulos de turnos y sockets ya no las usan como service locator.
- EXCLUDED: `trade`, sin cambios de contrato en 4A.
- NUEVA DIAGNÓSTICA ESTABLE: `integration.getPrimaryGMId/getMetrics/configureMetrics/resetMetrics`.

`game.mtrol.roll` se instala en `init` mediante `??=` y `ready` ya no lo redefine.

## M. Deprecated APIs

Los nombres `mtrol*` de socket se conservan como wrappers de compatibilidad. No se agregaron nuevos consumidores internos de APIs deprecated. La eliminación física corresponde a Fase 6.

## N. Monkey patches

Inventario: un patch de `Combat.prototype.rollInitiative` en `scripts/core/hooks.js`.

- Necesidad actual: preservar la tirada de iniciativa MtRol y su actualización en lote.
- Riesgo: reemplazo global del método de Foundry y posible conflicto con módulos.
- Alternativa: hook/API oficial o wrapper controlado, a verificar contra la versión exacta de Foundry.
- Decisión: no se cambió semántica ni se retiró. Un intento de encapsular la instalación fue bloqueado por política de seguridad al afectar un prototipo global; requiere autorización explícita separada. Eliminación final queda para Fase 6.

## O. Feedback loops encontrados

- Movimiento: el update de posición podía volver a interpretarse como intención y generar sync/rollback repetido. Se conserva metadata transaccional y commit idempotente de Fase 3.
- Hooks duplicados: múltiples callbacks documentales dependían del orden de registro. Se reemplazaron por bridge + subscribers deduplicados.
- Turn sockets: coexistían dispatch por Command Registry y handlers directos inaccesibles. Se eliminó la ruta duplicada.
- Façade: `roll` se instalaba en `init` y se sobrescribía en `ready`. Se eliminó la sobrescritura.
- Dependencia temporal: turnos y sockets dependían de `game.mtrol.actions`. Se reemplazó por imports/adapters explícitos.

## P. Performance instrumentation

`IntegrationObservability` cuenta siempre:

- invocaciones de hooks;
- mensajes de socket;
- commands;
- subscribers;
- updates documentales observados;
- fases lifecycle.

El detalle temporal está desactivado por defecto para evitar spam. Puede habilitarse con la façade diagnóstica y reutiliza `transactionId`, `combatId` y `userId` como correlación.

## Q. Performance before/after

- Hooks estáticos: 60 → 52.
- Referencias `game.mtrol`: 72 → 68.
- Socket registrations/emissions: 8 → 8; se redujo duplicación lógica, no el transporte físico.
- Rutas directas duplicadas de turno en socket handler: 10 → 0.
- `nextTurn()`: 1 → 1.
- Call sites `.update()`: 48 → 48; esta fase cambió routing, no reglas de persistencia.
- Rerenders: los concerns de presentación documentales quedan deduplicados por subscriber ID; la medición real se realizará durante smoke mediante observabilidad.

## R. Tests

Se agregaron 11 tests sobre:

- elección y relevo de Primary GM;
- spoof de identidad y ownership;
- orden, criticidad, aislamiento y deduplicación de subscribers;
- registro único del bridge Foundry;
- lifecycle idempotente e in-flight;
- instrumentación opt-in;
- estabilidad init/ready de la façade;
- autenticación del sender de socket;
- adapters legacy de turno/movimiento hacia Command Registry.

Resultado final: **943 total, 942 pass, 0 fail, 1 skip intencional**.

## S. Regresión

La suite confirma oposición/capabilities, daño exactly-once, recursos, consumibles, movimiento TURN/ATTRIBUTE/GRANTED/REACTION, follow-up y el único `nextTurn()`. `git diff --check` no reportó errores de whitespace; sólo avisos esperables de normalización LF/CRLF del worktree Windows.

## T. Smoke test

No ejecutado por Codex, por indicación del usuario. El smoke 1 GM + 2 jugadores sigue pendiente y es requisito para la aprobación formal de 4A. Debe cubrir movimiento, oposición, daño, recursos, consumible, F5/recovery, UI y ausencia de loops/handlers duplicados.

## U. P0/P1/P2/P3 restantes

- P0: ejecutar y aprobar smoke multicliente.
- P1: decidir y autorizar encapsulación segura del monkey patch de iniciativa.
- P1: migrar los cinco sockets legacy no-Trade con dominio directo.
- P2: resolver `mtrolEjecutarComercio` y adoptar la foundation común en Trade 4B.
- P2: auditar/retirar el adapter aislado de Item Piles si se confirma inactivo.
- P3: eliminación física de wrappers deprecated en Fase 6.

## V. Decisiones pendientes

No existe necesidad de migración de datos. Las decisiones pendientes son el mecanismo oficial para iniciativa y el orden de adopción de progression/ready-damage/states. No se asumió una reescritura funcional.

## W. Preparación para Trade 4B

Trade puede reutilizar AuthorityService, el Command Registry existente, TransactionCoordinator, logger, observabilidad, lifecycle y dispatchers. No se creó `TradeAuthorityV2`, otro registry ni otro logger. La adopción debe reemplazar los handlers directos conservando sus contracts de sync, locks, auditoría e historial.

## Estado de cierre

La implementación automatizada de Fase 4A está verde y la infraestructura principal quedó consolidada. La fase no debe marcarse como formalmente aprobada hasta completar el smoke multicliente y resolver o aceptar explícitamente el riesgo del monkey patch de iniciativa.

# MTROL — Refactor arquitectónico profesional

## Fase 0 — Baseline, inventario y contratos

Fecha de auditoría: 2026-08-27  
Sistema auditado: `C:\FoundryVTT\Data\systems\mtrol`  
Versión del manifiesto: `1.2.9`  
Foundry declarado: mínimo/verificado/máximo `14`

Este documento describe el runtime observado. No propone que los defectos actuales se conviertan en contratos permanentes. Durante esta fase no se modificó comportamiento, schema, movimiento, iniciativa, oposición, daño, recursos, clases, sockets ni APIs.

---

## A. Estado inicial

### Baseline ejecutado antes de la auditoría

| Métrica | Resultado |
|---|---:|
| Tests ejecutados | 875 |
| Aprobados | 874 |
| Fallidos | 0 |
| Omitidos intencionalmente | 1 |
| Duración observada | 4.94 s |

El resultado coincide exactamente con el baseline contractual. El hotfix de movimiento está presente y forma parte de la fuente válida.

### Superficie principal

| Pieza | Archivo | Tamaño aproximado | Función actual |
|---|---|---:|---|
| Entry point | `scripts/mtrol.js` | 56 líneas | Coordina `init`, `setup` y `ready` |
| Character Sheet | `scripts/sheets/actors/personaje-sheet.js` | 3108 líneas | Presentación, interacción y orquestación de múltiples dominios |
| Action Engine | `scripts/actions/action-engine.js` | 2232 líneas | Acciones, oposición, pending state, chat, reacción y parte de autoridad |
| Turn System | `scripts/combat/turn-system.js` | 1772 líneas | Turno, movimiento, preparación, guards, autoridad, sockets y Tracker |
| Damage Action Engine | `scripts/actions/action-damage-engine.js` | 708 líneas | Tirada y aplicación de daño, chat e integración con turnos |
| Socket dispatcher | `scripts/core/sockets.js` | 689 líneas | Listener único y dispatch de 38 acciones |
| Modelos | `models/*.js` | — | Schemas Actor/Competencia/Objeto y compatibilidad de carga |

Hay cuatro archivos placeholder vacíos: `combat/armor-engine.js`, `combat/combat-flow.js`, `combat/combat-helpers.js` y `combat/damage-engine.js`. No participan del runtime.

---

## B. Mapa del lifecycle

| Lifecycle | Archivo | Acción | API instalada | Hooks/socket registrados | Estado mutado | Dependencias y coupling |
|---|---|---|---|---|---|---|
| Evaluación ES module | `scripts/mtrol.js` y grafo importado | Carga módulos y singletons | Ninguna por sí sola | Ninguno salvo estado module-scope | Maps, Sets y constantes nacen vacíos | Los singletons sobreviven mientras vive la pestaña |
| `init` | `scripts/mtrol.js` → `3d/mtrol-3d-init.js` | Registra settings/keybindings 3D, APIs y hooks visuales | `game.mtrol3d` | `ready`, `canvasReady`, `3DCanvasSceneReady`, `controlToken`, `updateToken` | Timers 3D y preferencias | Debe ejecutarse después de que `game` y Foundry estén disponibles |
| `init` | `scripts/mtrol.js` → `core/init.js` | Registra DataModels, sheets, APIs y settings | `game.mtrol.{aplicarDanioAutorizado,aplicarDanioLocalizadoAutorizado,trade,turns,specialAbilities,fx,fxDebug,states,actions}` | `preCreateActor`, `preCreateItem`, hooks internos de varios instaladores | `CONFIG.Actor`, `CONFIG.Item`, registries de sheets, `game.mtrol` | El orden `states` antes de `death` es necesario; `actions` debe existir antes de uso por sockets/turnos |
| `setup` | `scripts/mtrol.js` → `core/hooks.js` | Instala hooks generales y override de iniciativa | Ninguna | Turn, trade, Sequencer, ambient FX, peso, special abilities | Sustituye `Combat.prototype.rollInitiative` | Coupling temporal: espera APIs instaladas en `init` |
| `ready` interno | Registrado por `initMtrol3D()` | Comprueba módulo 3D | Ninguna | `Hooks.once("ready")` | Sólo logging | Se registra durante `init`, antes del `ready` principal |
| `ready` | `scripts/mtrol.js` → `core/sockets.js` | Registra listener `system.mtrol` | Ninguna | Un listener socket global | `pendingSocketRequests` indirectamente | Los handlers de oposición acceden a `game.mtrol.actions` |
| `ready` | `scripts/mtrol.js` → `core/ready.js` | Instala tiradas, debug, autoridad trade y reconciliación de turno | `game.mtrol.roll`, amplía `game.mtrol.debug` | Ninguno directo | Sobrescribe `game.mtrol.aplicarDanioAutorizado`; crea epoch trade; puede escribir `turnState` | La sobrescritura de daño cambia semántica entre `init` y `ready` |
| `canvasInit` / `canvasTearDown` | Sequencer y ambient FX | Limpia FX activos | Ninguna | Cuatro handlers | Caches visuales/efectos | UI-only |
| `canvasReady` | 3D, Sequencer, ambient FX | Restaura cámara y efectos persistidos | Consume `game.mtrol3d`/`game.mtrol.fx` | Cinco handlers | Timers y efectos visuales | El orden entre handlers no está explicitado |
| `updateCombat` | Turn System | Detecta transición y crea nuevo `turnState` | Emite hooks semánticos | `mtrolTurnEnd/RoundEnd/RoundStart/TurnStart` | Combatant flags | Sólo Primary GM ejecuta transición autoritativa |
| `userConnected` | Trade | Reconciliación de autoridad | Ninguna | Un handler | Puede invalidar sesiones en RAM | Un nuevo Primary GM no reconstruye sesiones; las invalida |

### Temporal coupling confirmado

1. `core/sockets.js` usa `game.mtrol.actions.*`; sólo funciona porque `installMtrolActionsApi()` se ejecutó en `init`.
2. `turn-system.js` consulta oposición/reacción mediante `game.mtrol.actions`, creando un ciclo conceptual Turn ↔ Action.
3. `installMtrolDeathApi()` amplía `game.mtrol.states`; depende de que `installMtrolStatesApi()` haya creado antes el objeto.
4. `readyMtrol()` reemplaza una función instalada por `initMtrol()`, por lo que consumidores tempranos y tardíos pueden observar APIs distintas.
5. El override de iniciativa se instala en `setup` y supone que `rollMtrolInitiative()` y los DataModels ya están disponibles.

---

## C. APIs públicas

La superficie pública efectiva está compuesta por `game.mtrol`, el namespace separado `game.mtrol3d` y los exports ESM. No existe hoy un manifiesto formal de estabilidad, versión ni deprecación. Los exports ESM son consumidos internamente; los globals son accesibles a macros y módulos aunque varios sólo actúan como service locator.

## D. Matriz `game.mtrol`

| API | Creador / lifecycle | Consumidores observados | Sobrescritura | Clasificación | Riesgo |
|---|---|---|---|---|---|
| `game.mtrol.roll` | `core/ready.js` / `ready` | Consola/módulos externos; runtime usa imports directos | No | PUBLIC-STABLE-CANDIDATE | Instalada tarde |
| `game.mtrol.aplicarDanioAutorizado` | `core/init.js` / `init`, luego `core/ready.js` / `ready` | Socket legacy `mtrolAplicarDanio` | Sí, implementación y firma conceptual diferentes | UNSAFE / DUPLICATE | P1: semántica dependiente del lifecycle |
| `game.mtrol.aplicarDanioLocalizadoAutorizado` | `core/init.js` / `init` | Socket `mtrolAplicarDanioLocalizado` | No | INTERNAL/LEGACY BOUNDARY | Payload sin idempotency key |
| `game.mtrol.turns` | `turn-system.js` / `init` | Principalmente API externa; runtime usa imports | Objeto reemplazado sólo al instalar | PUBLIC-STABLE-CANDIDATE | Superficie amplia mezcla consulta y comandos |
| `game.mtrol.actions` | `action-engine.js` / `init` | `core/sockets.js`, `turn-system.js` | Objeto completo | INTERNAL SERVICE LOCATOR | Coupling temporal y pending state en RAM |
| `game.mtrol.specialAbilities` | `special-ability-service.js` / `init` | Externo; Sheet usa imports | No | PUBLIC-STABLE-CANDIDATE | Bajo |
| `game.mtrol.states` | `state-engine.js`, ampliado por `death-engine.js` / `init` | Acceso externo | Primero reemplazado, luego ampliado | PUBLIC-STABLE-CANDIDATE | Orden de instalación implícito |
| `game.mtrol.trade` | `trade-api.js` / `init` | Apps y runtime de comercio | Objeto completo | PUBLIC-STABLE-CANDIDATE | Mezcla comandos, caché, vistas y UI |
| `game.mtrol.fx` | `ambient-fx-manager.js` / `init` | Botones y consola | Objeto completo | PUBLIC-STABLE-CANDIDATE | Bajo, dominio visual |
| `game.mtrol.fxDebug` | `ambient-fx-manager.js` / `init` | Consola | No | INTERNAL/DEBUG | API debug separada de `debug` |
| `game.mtrol.debug` | `core/debug.js` / `ready`; preserva objeto | Consola | Extensión incremental | INTERNAL/DEBUG | No es logger; reúne diagnósticos heterogéneos |
| `game.mtrol3d` | cámara y visual 3D / `init` | 3D hooks y keybindings | `Object.assign` desde dos módulos | PUBLIC-STABLE-CANDIDATE | Namespace paralelo a `game.mtrol` |

### Superficie exacta por namespace

- `turns`: `getTurnContext`, `getCombatantTurnState`, `getGrantedMovement`, `getAvailableMovement`, `getEnemiesInAttackRange`, `getAttributeFollowUpTargetGuard`, `canAct`, `canMove`, `canAttack`, `canUseMovementRoll`, `canUseFullAction`, `getActionGuard`, `getItemCooldownStatus`, `getPreparation`, `getPrepareGuard`, `canPrepare`, `prepare`, `setPreparation`, `consumePreparation`, `completeResolvedTurnAction`, `grantMovementFromResolvedRoll`, `completeAttributeMovement`, `completeGrantedMovement`, `endTurn`.
- `actions`: create/create-ready helpers, attach defense, resolve, query, clear, reaction completion, serialization y sync; incluye variantes públicas `*Authoritative` que deberían reclasificarse como internas.
- `trade`: seis comandos, caché/listado, vistas privadas/GM, inspección, observación, auditoría y apertura de dos Apps.
- `states`: `applyState`, `applyDeadIfNeeded`, `syncDeathState`.
- `specialAbilities`: `resolveSlot`, `updateSlot`.
- `fx`: add/remove/stop/list/play/refresh/preview/open; `fxDebug`: list/stop/refresh.
- `debug`: inspección de resize, actor/items/colecciones/peso, auditoría mundial, planificación/verificación/export de reparación y scans legacy.
- `mtrol3d`: activación, presets/cámara/follow/focus y sub-API `visual`.

### Damage API observada

En `init`, `aplicarDanioAutorizado` apunta a `combat/damage-authorized.js`, que implementa daño simple/armadura. En `ready`, se reemplaza por un wrapper que extrae `payload.danio` y llama `aplicarDanioLocalizado()` de `damage-localized.js`. No hay alias para conservar la primera implementación. El socket legacy resuelve la propiedad en tiempo de ejecución, por lo que después de `ready` siempre consume la segunda semántica.

No se corrigió en Fase 0. Debe decidirse una API canónica antes de tocarla.

---

## E. Inventario de Hooks

Se encontraron 59 registros estáticos. Uno (`integrations/item-piles.js`) no es alcanzable desde el entrypoint actual.

| Hook | Registradores activos | Lee | Muta/cancela/dispara | Riesgo |
|---|---|---|---|---|
| `init`, `setup`, `ready` | `mtrol.js`; 3D añade otro `ready` | Foundry/game | Config, APIs, hooks, sockets | Orden implícito |
| `preCreateActor` | `core/init.js` | `actor.type` | `updateSource`; puede permitir | Patch temporal legacy |
| `preCreateItem` | `core/init.js` | `item.type` | `updateSource`; puede permitir | Patch temporal legacy |
| `preUpdateActor` | class resources, special abilities, turn/preparation, orb authority, death | Cambios y permisos | Cuatro guards pueden cancelar; death guarda snapshot RAM | Cinco políticas sobre el mismo Document |
| `updateActor` | special abilities, turn, death; Item Piles inactivo | Flags/HP | Rerender, Tracker, estado death/FX | Reentradas por `toggleStatusEffect`; guards locales |
| `preUpdateItem` | orb authority | Config de Orbe | Puede cancelar | Bajo |
| `updateItem` | Turn System, trade | Parent/offer | Tracker y reconciliación trade | Dos dominios reaccionan al mismo update |
| `deleteItem` | trade | Oferta | Invalida/reconcilia sesión | Estado trade RAM |
| `deleteActor`, `deleteToken` | trade | Participantes | Limpieza/invalida sesión | Estado trade RAM |
| `preUpdateToken` | Turn System, peso, trade | Posición, actor, permisos, allowances, carga, locks | Los tres pueden cancelar | P1: orden de guards no contractual |
| `updateToken` | Turn System, trade, 3D | Options y posición | Commit movimiento, posible rollback trade, cámara | P0: movimiento de Token y consumo de allowance no son una transacción única |
| `createCombat` | Turn System | Combat | Emite `mtrolCombatCreated` | Bajo |
| `preUpdateCombat` | Turn System | round/turn | Guarda previous en `options` local | Depende de options atravesando update |
| `updateCombat` | Turn System | previous + cambios | Escribe Combatant flags y emite eventos | Primary GM only |
| `deleteCombat` | Turn System | Combat | Limpia caches y emite `mtrolCombatEnd` | Correcto para caches locales |
| `updateCombatant` | Turn System | turn/granted flags | Limpia reservas y rerender | Fuente de reconciliación UI |
| `renderCombatTracker` | Turn System | Combat/Combatants/flags | Decora UI y comandos | UI contiene wiring de comandos |
| `renderChatMessage` | Action Engine, Damage Engine, premium renderer | Flags/HTML/pending Map | Añade listeners y transforma UI | Tres handlers; botones dependen de estado RAM |
| `preUpdateUser` | Sequencer | hotbar | Puede normalizar | Integración |
| `canvasInit`, `canvasTearDown` | Sequencer, ambient FX | Escena/FX | Detiene efectos | UI-only |
| `canvasReady` | 3D, Sequencer, ambient FX (3 handlers) | Escena/flags/settings | Timers/restauración/reproducción | Cinco handlers totales |
| `3DCanvasSceneReady`, `controlToken`, `updateToken` | 3D | Cámara/token | Ajusta cámara | UI-only |
| `endedSequencerEffect`, `sequencerEffectEnded`, `deleteSequencerEffect` | Sequencer | FX | Limpia flags | Tres aliases de integración |
| `getSceneControlButtons`, `renderSceneDirectory` | ambient FX | UI | Inserta controles | UI-only |
| `userConnected` | trade | Users | Reconciliación/invalida | Autoridad en RAM |
| `mtrolTradeSessionUpdated` | trade runtime y GM runtime | Caché pública | Rerender/close apps, reemite evento GM | Dos consumidores |
| `mtrolTradeGMSessionUpdated`, `mtrolTradeAuditCreated`, `mtrolTradeAuthorityReset` | trade UI/runtime | Sesiones/audit | Rerender/cierre | UI-only, salvo invalidación local |

No hay un registry central de hooks ni teardown general. Varios instaladores sí poseen booleanos idempotentes; `registerMtrolTurnHooks()` y `installSpecialAbilityAuthorityHooks()` no guardan por sí mismos contra una segunda instalación, aunque el lifecycle normal los llama una sola vez.

---

## F. Inventario de sockets

Namespace único: `system.mtrol`. Listener único: `registerMtrolSockets()` en `ready`.

### Envelope request/response común

`requestPrimaryGM()` genera `requestId`, selecciona el GM activo con ID lexicográficamente menor, mantiene una Promise en `pendingSocketRequests`, espera 30 s y no reintenta. La respuesta usa `mtrolSocketResponse`. El envelope transporta `action`, `requestId`, `requestingUserId`, `targetGMId` y `payload`.

| Evento(s) | Emisor | Autoridad/handler | Mutación | Idempotencia actual | Riesgo |
|---|---|---|---|---|---|
| `mtrolPrepareTurn` | Turn API | Primary GM / Turn | Actor + Combatant + avance | lock RAM + `turnAdvance` persistido | Medio |
| `mtrolSetPreparation` | Turn API | Primary GM / Turn | Actor flags | Ninguna receipt específica | Bajo, GM-only |
| `mtrolReservePreparation` | Roll/Turn | Primary GM / Turn | Actor reservation flag | `consumptionId`, last receipt persistido | Buena base recuperable |
| `mtrolCompletePreparation` | Roll/Turn | Primary GM / Turn | Actor flags | `consumptionId` persistido | Buena |
| `mtrolCancelPreparationReservation` | Roll/Turn | Primary GM / Turn | Actor flags | ID comparado | Buena |
| `mtrolEndTurn` | Tracker/API | Primary GM / Turn | Combat + receipt | `turnAdvance` | Buena dentro de una pestaña y flag |
| `mtrolGrantTurnMovement` | Sheet | Primary GM / Turn | Combatant turnState | Turn guard; sin command receipt propio | Medio |
| `mtrolCommitTurnMovement` | `updateToken` | Primary GM / Turn | Combatant turnState | Turn signature + local reservation | P0 atomicidad Token/flag |
| `mtrolCommitGrantedMovement` | `updateToken` | Primary GM / Turn | grantedMovement | Grant ID/signature | Medio |
| `mtrolCompleteGrantedMovement` | Tracker | Primary GM / Turn | grantedMovement + avance | Grant ID + turnAdvance | Buena |
| `mtrolCompleteAttributeMovement` | Tracker | Primary GM / Turn | turnState + avance/follow-up | Turn signature | Buena |
| `mtrolCommitReactionMovement` | `updateToken` | Primary GM / Turn→Action | pendingAction RAM | Pending ID + status RAM | P0 reload |
| `mtrolFinalizeTurnUse` | Sheet | Primary GM / Turn | cooldown/turn state/grant | Guards; no command receipt | Medio |
| `mtrolCompleteTurnAction` | Action/Damage/Sheet | Primary GM / Turn | turnResolution + avance | resolution IDs + turnAdvance | Persistencia parcial |
| `mtrolConsumeDharma` | Roll | Primary GM / Dharma | Actor Dharma | transaction receipt sólo RAM | P0 reload |
| `mtrolSpendMP`, `mtrolRefundMP`, `mtrolRestoreMeditationMP` | MP Engine | Primary GM / MP | Actor MP/stacks | resource receipts sólo RAM | P0 reload |
| `mtrolUseConsumable` | Consumable service | Primary GM | Actor resource + Item quantity/destruction | tres Maps RAM | P0 reload |
| `mtrolSpendPendingAttribute`, `mtrolSpendPendingCompetence` | Progression | Primary GM | Actor/Item | transactionId + snapshots; receipts indirectas RAM | P1 |
| `mtrolTradeCreateSession`, `mtrolTradeAcceptSession`, `mtrolTradeSetOffer`, `mtrolTradeConfirm`, `mtrolTradeCancel`, `mtrolTradeGMCancel` | Trade API | Primary GM / Trade | Store/locks/transfers/audit | operation receipts sólo RAM | P0 reload |
| `mtrolCreatePendingAction` | Action API | Primary GM / Action | pendingActions Map + Chat | Reutiliza ID sólo si Map sobrevive | P0 reload |
| `mtrolCreateReadyDamageAction` | Action API | Primary GM / Action | pendingActions Map + Chat | Igual | P0 reload |
| `mtrolAttachDefenseRoll` | Defender | Primary GM / Action | pendingAction, MP, resolución | Set RAM + estado RAM | P0 reload |
| `mtrolResolvePendingAction` | Action API | Primary GM / Action | pendingAction/effects/shield/damage | Set RAM | P0 reload |
| `mtrolCompleteReactionMovement` | Chat/Turn | Primary GM / Action | reactionMovement RAM + avance | Estado RAM | P0 reload |
| `mtrolExecuteResolvedDamage` | Chat | Primary GM / Damage | HP/armadura/MP/turno | Set RAM + resource receipt RAM | P0 reload |
| `mtrolClearPendingAction` | Action API | Primary GM / Action | pending Map + avance | Estado RAM | P0 reload |
| `mtrolRequestPendingActionsForActor` | Defender | Primary GM / Action | Sólo lectura | N/A | Devuelve vacío tras F5 GM |
| `mtrolAplicarDanio` | Sin emisor activo localizado | Primary GM / API sobrescrita | Daño | Sin requestId/receipt del comando | ACTIVE LEGACY / P0 si se reutiliza |
| `mtrolAplicarDanioLocalizado` | Damage Localized | Primary GM | HP/armadura/chat | Genera transactionId nuevo al recibir | P0: duplicado del socket duplica daño |
| `mtrolApplyState` | State Engine | Primary GM listener | Actor flags + ActiveEffect + Chat | Sin response/transactionId | P1 |
| `mtrolPendingActionSync`, `mtrolPendingActionCleared` | GM Action Engine | Clientes | Cache RAM cliente | `updatedAt` al sincronizar; sin ack | P1 |
| `mtrolTradeSessionSync`, `mtrolTradeGMSessionSync`, `mtrolTradeAuthorityReset` | Trade authority | Clientes/GM | Cache local | Revision/epoch | P1: autoridad canónica no persistida |
| `mtrolSocketResponse` | Primary GM | Solicitante | Resuelve Promise RAM | requestId | Se pierde con F5 del solicitante |
| `mtrolEjecutarComercio` | UI legacy aislada | Sin handler actual | Ninguna | Ninguna | POSSIBLY DEAD |

No hay retry automático ni deduplicación global del envelope. Cada feature implementa —o no— su propia idempotencia.

---

## G. Estado en memoria

| Estado | Archivo | Tipo | Persistido | F5 | Impacto/clasificación |
|---|---|---|---|---|---|
| `pendingActions` | Action Engine | Map canónico de oposición | No | Se pierde | **P0 CRITICAL STATE** |
| `resolvingActions`, `attachingDefenseActions` | Action Engine | Locks | No | Se pierden | LOCK TEMPORAL; seguro sólo si operación no quedó a mitad |
| cleanup timer pending | Action Engine | Timer 60 s | No | Se recrea vacío | CACHE/LOCK; el contenido ya se perdió |
| `executingResolvedDamageActions` | Damage Engine | Set lock | No | Se pierde | P0 combinado con daño no idempotente persistente |
| `pendingSocketRequests` | Socket Requests | Map Promises/timeouts | No | Se pierde | **P0 in-flight intent/result ambiguity** |
| movement reservations | Turn System | 2 Maps optimistas | No | Se pierden | CACHE/LOCK; P0 por commit separado del Token |
| movement warning receipts | Turn System | Map debounce | No | Se pierde | UI-ONLY |
| preparation locks | Turn System | Set | No | Se pierde | LOCK TEMPORAL; reserva real sí persiste |
| turn advance locks | Turn System | Set | No | Se pierde | LOCK TEMPORAL; receipt real persiste |
| actor resource `completedTransactions` | Actor Resource Service | Map receipts | No | Se pierde | **P0 exactly-once HP/MP** |
| actor resource queues | Actor Resource Service | Map Promise queues | No | Se pierde | LOCK TEMPORAL/P0 si update queda in-flight |
| Dharma receipts/queues | Dharma Spend | 2 Maps | No | Se pierden | **P0 exactly-once Dharma** |
| consumable in-progress/completed | Consumable Service | 3 Maps | No | Se pierden | **P0 exactly-once resource + Item** |
| Orb receipts/queues | Orb Management | 2 Maps | No | Se pierden | P1; snapshots reducen parte del riesgo |
| death transition snapshots | Death Engine | Map | No | Se pierde | LOCK/BRIDGE; puede perder transición/FX |
| death sync/FX keys | Death Engine | Sets/Map | No | Se pierden | CACHE/UI-ONLY |
| active Sequencer names | Sequencer | Set | Escena guarda metadata parcial | Se pierde/reconcilia | CACHE/UI |
| 3D timers | 3D Init | 2 timers | No | Se recrean | UI-ONLY |
| trade session store | Trade Session Service | Maps de sesiones, actor, reservas, receipts | No | Se pierde/invalida | **P0 CRITICAL STATE** |
| trade transfer receipts/in-flight | Trade Transfer | 2 Maps | No | Se pierden | **P0 exactly-once transferencia** |
| trade movement locks | Trade Proximity | 2 Maps | No | Se pierden | **P0 durante sesión activa** |
| trade audit timeline/snapshots | Trade Audit | 3 Maps + queue | Sólo terminal se persiste a Journal | Se pierde lo activo | P1 |
| trade client sessions/apps/monitors | Trade API/UI | Maps | No | Se resincroniza parcialmente | CACHE/UI |
| sheet Dharma/special locks | Personaje Sheet | Map/Set por instancia | No | Se pierde | UI/LOCK TEMPORAL |
| unresolved card family audit | Chat assets | Set | No | Se pierde | DEBUG CACHE |

Conclusión: el objetivo “sobrevivir F5 del Primary GM en cualquier punto” no es alcanzable con el estado actual. El principal bloqueo es que `pendingActions` y las receipts exactly-once no tienen representación persistente recuperable.

---

## H. Persistencia actual

### Combat y Combatant

No se encontraron flags MTROL de Combat. En Combatant se persisten:

- `turnState`: identidad de combate/ronda/turno, base/extra/spent, acción, source y follow-up.
- `grantedMovement`: concesión temporal a tercero.
- `turnResolution`: IDs pendientes que bloquean cierre de turno.
- `turnAdvance`: receipt `advancing|complete` con signature y completionId.

### Actor

- Schema: vitales HP/MP, atributos, identidad/classId, modificadores, recursos (nivel, EXP, Karma, Dharma, etc.), progresión, pending advancement, Orbes, alignment, inventario y equipamiento.
- Flags: `preparation`, `preparationReservation`, `preparationLastConsumption`, `states`, `mpStacks`, `specialAbilities`.
- Mutaciones autoritativas principales: resource service, class resource service, progression, MP, Dharma, consumables, Orbes, equipment y states.

### Item

- Competencia: clasificación de acción, oposición, efecto, daño, MP, cooldown, FX y compatibilidad legacy.
- Objeto: cantidad, consumible, equipamiento, defensa, daño, peso y campo legacy `roto`.
- Flag `cooldown` persiste Combat, ronda de uso y duración.
- Metadata de special ability puede existir en system y flags legacy.
- Durabilidad/defensa se escribe directamente en `system.defensa`.

### ActiveEffect

`state-engine.js` duplica estado lógico en `Actor.flags.mtrol.states` y un ActiveEffect con `flags.mtrol.state`. Muerte usa status effects nativos directamente y no necesariamente el mismo flag `states`. Existen dos mecanismos relacionados pero no equivalentes.

### Otros Documents

- Scene: `ambientFx`, `persistentFx`, legacy `persistentSequencerFx`, backup/config 3D.
- ChatMessage: roll cards; resolución guarda `pendingActionId`, `damageStatus` y `damageRolled`, pero no serializa el pendingAction completo.
- JournalEntry: historial terminal de comercio, hasta 500 registros; no recupera sesiones activas.

### Mutaciones directas de Foundry Documents

| Document | Módulos que escriben directamente | Observación |
|---|---|---|
| Actor | actor/class resources, progression, MP, Dharma/Karma, consumables, Orbes, equipment, item destruction, states y Sheet | No existe un repository único; varios servicios sí validan autoridad por separado |
| Item embebido | progression, damage authorized/localized, shield wear, equipment, trade transfer, Sheet | Defensa, nivel, cantidad, imagen y metadata siguen rutas distintas |
| Combatant | Turn System | Flags de turno, resolución, avance y granted movement |
| Combat | Turn System y monkey patch de iniciativa | `nextTurn`, turn/round e iniciativa |
| Token | Trade hooks | Rollback de posición; movimiento normal lo inicia Foundry antes del commit MTROL |
| ActiveEffect/status | State y Death engines | Dos mecanismos parcialmente superpuestos |
| ChatMessage | rolls, Action, Damage, UI cards | Estado de pending sólo parcial |
| Scene | 3D, Sequencer, ambient FX | Persistencia visual |
| JournalEntry | Trade Audit | Sólo auditoría terminal |

---

## I. Movement architecture

```text
Token drag
  → preUpdateToken
  → getAvailableMovement(actor, token)
  → autorización tipada TURN | GRANTED | REACTION | GM
  → Foundry actualiza posición del Token
  → updateToken
  → socket al Primary GM
  → validación canónica + consumo de flag/pendingAction
  → updateCombatant / sync pending
  → limpieza de reserva local
  → rerender Tracker
  → cierre terminal opcional
  → advanceCurrentTurnOnce()
```

Fuentes de verdad:

- TURN/ATTRIBUTE/autobuff: `Combatant.flags.mtrol.turnState`.
- GRANTED: `Combatant activo.flags.mtrol.grantedMovement`.
- REACTION: `pendingAction.reactionMovement` en RAM.
- GM: bypass explícito sólo cuando se solicita; no altera Tracker.

Consumidores confirmados de la semántica central: `canMove()`, `validateTurnMovement()` y Combat Tracker. El follow-up deriva de `class-registry.js` y la distancia reutiliza `measureSquareGridTokenDistance()` con adyacencia de un cuadro.

Riesgos arquitectónicos sin cambiar reglas:

1. Posición del Token y consumo de allowance son dos commits distintos.
2. Reaction movement desaparece con `pendingActions` al recargar GM.
3. Las reservas optimistas no pueden reconciliar por sí solas un Token ya actualizado si el socket falla.
4. Cambio de Primary GM no reconstruye operaciones de movimiento en vuelo.

---

## J. Turn architecture

`turn-system.js` es actualmente un God Object funcional. Clasificación:

| Dominio futuro | Responsabilidades actuales |
|---|---|
| Turn | Contexto, start/reconcile, transición, eventos semánticos, end |
| Movement | Fuentes, guards, coste, reservas, commits, follow-up, range |
| Action Guard | Active actor, oposición reactiva, cooldown, actionConsumed |
| Authority | Métodos `*Authoritative`, permisos y Primary GM |
| Persistence | Lectura/escritura Actor/Combatant/Item flags |
| Recovery | Sólo `reconcileActiveTurn`; no recovery de acción en curso |
| UI | Tracker, panel GM, botones y notificaciones |
| Socket Adapter | Construye requests y exporta `turnSocketOperations` |
| Utility | Tokens, escenas, ownership, signatures, normalización |

`advanceCurrentTurnOnce()` contiene la única llamada real a `combat.nextTurn()`. La búsqueda global encontró exactamente una referencia runtime; `turn-system.test.mjs` ya congela este contrato. El lock es RAM, pero la receipt `turnAdvance` es persistente.

Ventana de crash: se escribe `advancing`, luego se llama `nextTurn()`, luego se escribe `complete`. Un F5 entre los dos últimos pasos deja una receipt `advancing` en el Combatant anterior y no existe un recovery coordinator que determine con certeza si debe completar, compensar o ignorar.

---

## K. Action architecture

`action-engine.js` mezcla:

- metadata/canonicalización de acciones;
- autoridad y permisos;
- pending state y lifecycle;
- oposición y resolución;
- efectos/stun;
- desgaste de escudo;
- reacción/Esquiva;
- contraataque y daño automático;
- MP de respuesta;
- creación/actualización de ChatMessage;
- socket client adapters;
- API pública y cleanup timer.

El Sheet inicia el flujo, el Action Engine crea estado, el Turn System registra resolución pendiente y el Damage Engine puede cerrarla. Action importa Turn; Turn vuelve a Action mediante `game.mtrol.actions`; Action carga Damage dinámicamente y Damage importa Action y Turn. Es un ciclo conceptual fuerte aunque los imports dinámicos eviten un ciclo ESM inmediato.

---

## L. Opposition architecture

### Estado y transición exacta

```text
ATTACK
  PersonajeSheet._executeCompetenciaRoll
  → createPendingActionFromCompetencia
  → [socket mtrolCreatePendingAction]

CREATE
  createPendingActionAuthoritative
  → canonicalize actor/item/target/roll/damage
  → pendingActions.set(id, status=waiting-defense)
  → Chat "acción pendiente"
  → mtrolPendingActionSync

WAITING
  getPendingOppositionForActor / requestPendingActionsForActor
  → defensor selecciona competencia

RESPONSE
  attachDefenseRollAuthoritative
  → valida owner, item, guard, escudo, roll y MP
  → status=resolving
  → mtrolPendingActionSync

RESOLVING
  resolvePendingActionAuthoritative
  → resolveOpposedAction
  → efectos / escudo / contraataque / reactionMovement
  → status=resolved o cancelled
  → Chat de resolución + sync

RESOLVED
  → daño automatic/enabled, reaction movement o cierre directo
  → completeResolvedTurnAction(resolutionId)

CANCELLED
  → motivo + sync
  → completeResolvedTurnAction(resolutionId)
```

Actores autorizados:

- Create: owner del atacante o GM.
- Attach/resolve: owner del defensor o GM, validado por pendingAction.
- Damage: owner de atacante para request; Primary GM muta.
- Cancel: owner del atacante o GM.
- Reaction: owner del defensor o GM.

Persistencia/recuperación:

- El cuerpo completo sólo existe en `pendingActions` Map.
- Chat guarda como máximo el ID y resumen de damage status.
- Combatant `turnResolution.ids` sabe qué IDs bloquean el turno, pero no permite reconstruir actores, tiradas, estado, daño ni reacción.
- `ready` no intenta recuperar pending actions.
- Tras F5 del Primary GM, los clientes pueden conservar copias, pero no existe protocolo para promoverlas a estado canónico.

Esto es el riesgo P0 principal.

---

## M. Damage architecture

```text
PersonajeSheet
 ├─ daño inmediato ───────────────┐
 └─ oposición → pendingAction ─┐  │
                               │  │
Action Engine                  │  │
 ├─ ganador + automatic ───────┤  │
 ├─ ganador + enabled → Chat ──┤  │
 └─ contraataque automático ───┤  │
                               ▼  ▼
Action Damage Engine: executeConfiguredCompetenciaDamage
  → tirada, Dharma/Karma, pasivos de Orbe, coste MP de resolución
  → aplicarDanioLocalizado
       ├─ GM: applyDamageToTarget directo
       └─ player: preview + raw socket mtrolAplicarDanioLocalizado
            → aplicarDanioLocalizadoAutorizado
  → applyDamageToHpAuthoritative
  → Actor.update HP / Item.update defensa / destrucción
  → Chat/combat card
  → completeResolvedTurnAction
```

Rutas adicionales:

- `damage-authorized.aplicarDanioAutorizado`: daño simple legacy, instalado y luego ocultado por overwrite.
- `damage-authorized.aplicarDanioLocalizadoAutorizado`: handler del raw socket.
- `damage-localized.aplicarDanioLocalizado`: ruta directa/local + delegación.
- Chat button `mtrol-resolved-damage`: ejecuta daño pendiente manual.
- Habilidades especiales convergen en el flujo configurado desde Sheet/Action Damage.

Las rutas modernas convergen mayormente en `applyDamageToHpAuthoritative`, pero el transactionId se genera dentro de la recepción/aplicación. Un mensaje raw duplicado recibe IDs nuevos y no es exactly-once.

---

## N. Resource architecture

| Recurso | Source of Truth | Servicio/escritura | Transaction ID | Receipt persistida | Rollback |
|---|---|---|---|---|---|
| HP | `Actor.system.vitales.hp.value/max/temp` | Actor Resource + Damage | Sí | No, Map RAM | Consumable restaura valor; damage no |
| MP | `Actor.system.vitales.mp.*` | MP Engine + Actor Resource | Sí | No, Map RAM | Refund depende de receipt RAM |
| MP stacks | `Actor.flags.mtrol.mpStacks` | MP Engine | Mismo tx MP | No | Reset diario elimina flag |
| Karma | `Actor.system.recursos.karma` | roll effects / manual resource | Parcial | No | No transacción global |
| Dharma | `Actor.system.recursos.dharma` | Dharma Spend / manual resource | Sí | No, Map RAM | No automático |
| Consumibles | Item cantidad + HP/MP | Consumable + Actor Resource | Sí | Dos receipts RAM | Intenta compensar recurso/item |
| Progresión | Actor/Item schema | Progression services | Sí | Recursos usan Map RAM; snapshots | Rollback parcial en competencia |
| Orbes | `Actor.system.orbs` | Orb Management | Sí | Map RAM | Snapshots optimistas, sin journal |

La serialización por Actor con Promise queues evita carreras dentro de una pestaña, pero no sobrevive reload ni cambio de autoridad.

---

## O. UI/domain coupling

### Personaje Sheet

La Sheet importa directamente 30+ servicios. Además de presentación:

- valida reglas y permisos;
- selecciona targets;
- arma fórmulas y payloads;
- coordina MP, Dharma y Preparación;
- decide oposición vs daño inmediato;
- crea pending actions;
- ejecuta daño;
- finaliza turno;
- modifica Actor/Item directamente para imágenes, creación y edición;
- administra progresión, Orbes, inventario, equipo, consumibles y comercio.

Es el mayor punto de acoplamiento Presentation/Domain/Orchestration.

### Combat Tracker

Renderiza estado, pero también crea comandos para finalizar turno/movimiento, configurar Preparación y bloquear habilidades. Consume servicios correctos, aunque el wiring vive en el dominio Turn.

### Chat

Tres handlers renderizan tarjetas, daño y reacción. Los botones de daño/reacción requieren que el pendingAction correspondiente continúe en RAM; el ChatMessage no basta para recovery.

---

## P. Inventario legacy

| Elemento | Clasificación | Estado observado |
|---|---|---|
| Actor type `character` e Item type `item` | COMPATIBILITY REQUIRED | Registrados como aliases legacy |
| Defaults `preCreateActor/preCreateItem` | ACTIVE LEGACY | Patches temporales |
| Competencia migrateData para oposición/daño | COMPATIBILITY REQUIRED | Materializa defaults desde datos anteriores |
| Campos `costeMP`, `elemento`, `rareza`, `roto` | COMPATIBILITY REQUIRED | Conservados; varios ignorados por UI moderna |
| Fallback por nombre `Cadenas Infernales` | ACTIVE LEGACY | Regla explícita en Action Engine |
| `obtenerCosteBaseLegacy` y `mpStacks` antiguos | ACTIVE LEGACY | Lectura tolerante |
| Special abilities `legacyNames` | COMPATIBILITY REQUIRED | Busca Items por nombre si falta referencia |
| Peso `system.slots` | COMPATIBILITY REQUIRED | Fallback y auditor/migración separados |
| `persistentSequencerFx` | COMPATIBILITY REQUIRED | Migrado a `persistentFx` al usar integración |
| `damage-authorized.aplicarDanioAutorizado` + socket `mtrolAplicarDanio` | REPLACED BUT REFERENCED | API se sobrescribe en ready; handler permanece |
| `trade-engine.js`, `trade-dialog.js`, `mtrolEjecutarComercio` | POSSIBLY DEAD / TEST-ISOLATED | Flujo moderno no importa módulos; sender no tiene handler |
| Item Piles hook module | POSSIBLY DEAD | Exportado pero no registrado |
| Cuatro combat engines vacíos | POSSIBLY DEAD PLACEHOLDERS | Sin imports ni implementación |
| Assets/UI V1–V10 | COMPATIBILITY/ASSET HISTORY | No implica por sí solo runtime legacy |

No debe eliminarse ninguna pieza hasta verificar mundos reales y telemetría/auditoría de datos.

---

## Q. Monkey patches

| Prototype | Override | Lifecycle | Conserva original | Llama original | Riesgo/alternativa |
|---|---|---|---|---|---|
| `Combat.prototype.rollInitiative` | Implementación MTROL completa | `setup` | Guarda `originalRollInitiative` local | No | P1 compatibilidad Foundry/módulos. Evaluar Hook/API oficial o wrapper que preserve original en fase posterior |

La referencia original queda sin uso y no existe teardown/restauración.

---

## R. Sources of Truth

| Concepto | Source of Truth actual | Mirrors/caches | Evaluación |
|---|---|---|---|
| Orden de turno | `Combat.round/turn/turns` | Context helpers | Única |
| Acción consumida/follow-up | Combatant `turnState` | Sheet/Tracker | Única persistente |
| Movimiento TURN/ATTRIBUTE | Combatant `turnState` | reservation Map | Maestro/cache claros |
| GRANTED | Combatant `grantedMovement` | reservation Map | Maestro/cache claros |
| REACTION | `pendingActions[].reactionMovement` RAM | copias socket cliente + Chat UI | **Sin maestro persistente** |
| Preparación | Actor `preparation` + reservation/last flags | lock Set | Recuperable |
| Cooldown | Item `cooldown` flag | vistas | Única persistente |
| Pending Action | Primary GM `pendingActions` Map | clientes y Chat parcial | **P0 ambiguo tras F5** |
| Turn resolution | Combatant `turnResolution.ids` | pending Map | Persistencia insuficiente para reconstruir |
| HP/MP | Actor system | UI | Única, pero receipts no persistentes |
| MP stacks | Actor flag | cálculo local | Única persistente |
| Karma/Dharma | Actor system | roll context/chat metadata | Saldo persistente; operación no |
| Stun/general states | Actor flags + ActiveEffects | Token status | Dos representaciones coordinadas parcialmente |
| Death | HP + status effect | transition/FX caches | HP maestro; estado derivado |
| Trade activo | Primary GM TradeSessionStore RAM | clientSessions | **P0 no persistente** |
| Trade audit terminal | Journal flag | timelines RAM | Persistente sólo al terminar |
| Idempotencia turno | Combatant `turnAdvance` | lock Set | Parcialmente persistente |
| Idempotencia recursos | Maps de receipts | Document final | **P0 receipt no persistente** |
| Idempotencia damage socket raw | Ninguna command receipt | resource Map con ID nuevo | **P0** |

---

## S. Riesgos priorizados

### P0 — Bloquean recovery/corrección exactly-once

1. Pending actions, reacción y estado de resolución canónico sólo en RAM.
2. Receipts de HP/MP/Dharma/consumibles/transferencias sólo en RAM.
3. Raw socket de daño localizado sin transactionId estable ni respuesta; duplicación puede duplicar daño.
4. Token movement y consumo de allowance ocurren en Documents/operaciones separadas.
5. Sesiones, reservas, locks y receipts de comercio activo sólo en RAM.
6. Requests en vuelo se pierden con F5; el cliente no sabe si la mutación ocurrió.
7. No existe recovery coordinator en `ready` más allá de iniciar `turnState` si falta.

### P1 — Alto impacto/mantenibilidad

1. `aplicarDanioAutorizado` cambia de implementación entre `init` y `ready`.
2. Turn System, Action Engine y Sheet son God Objects y forman ciclos conceptuales.
3. Override total de `Combat.prototype.rollInitiative` sin llamada al original.
4. Estado general duplica flag + ActiveEffect; muerte sigue otra ruta.
5. Tres guards `preUpdateToken` dependen del orden de hooks.
6. State socket no usa el request/response común ni transactionId.
7. Chat cards no contienen snapshot suficiente para recuperación.

### P2 — Deuda controlable

1. Logs dispersos con `console.*`; `utils/logger.js` está vacío.
2. APIs globales mezclan público, interno y debug.
3. Sockets específicos por feature sin registry declarativo.
4. Direct document mutations dispersas fuera de repositorios.
5. No hay teardown central de hooks/timers.

### P3 — Higiene

1. Referencia original de iniciativa sin uso.
2. Módulos placeholder vacíos.
3. Integración Item Piles no alcanzable.
4. Sender legacy de comercio sin receptor.

---

## T. Arquitectura objetivo propuesta — no implementada

```text
Presentation
  Character Sheet | Combat Tracker | Chat Cards
                         ↓ intents / queries
Foundry Adapters
  Hooks | Socket transport | Document adapters
                         ↓ commands
Authority / Command Registry
  Primary GM validation | commandId | exactly-once receipt | status
                         ↓
Domain Services
  Turn | Movement | Action/Opposition | Damage | Resources | State
                         ↓
Repositories
  CombatAggregateRepository | ActorResourceRepository | ItemRepository
                         ↓
Foundry Documents
  Combat/Combatant flags | Actor | Item | ActiveEffect | Journal audit
```

Principios:

- `game.mtrol` queda como fachada estable y delgada.
- Hooks traducen eventos Foundry a comandos/queries; no deciden reglas.
- Socket transporta un envelope genérico versionado, pero conserva inicialmente los action names para compatibilidad.
- Todo comando mutante posee `commandId`, status persistido y receipt serializable.
- El aggregate persistente permite reanudar `ready` sin confiar en RAM cliente.
- Caches y locks pueden borrarse sin cambiar semántica.
- Repositories encapsulan Foundry updates y comparación optimista de versión.
- Los servicios de dominio permanecen puros donde sea viable.

---

## U. Decisiones que requieren aprobación

### U1. Ubicación del aggregate de combate

**Opción A — `Combat.flags.mtrol.runtime` versionado**

- Pros: un Document natural por combate; transacciones y recovery centralizables; fácil de localizar en `ready`.
- Contras: updates grandes y potencial contención; requiere control de versión/revisión.

**Opción B — flags distribuidos en Combatants + ChatMessage**

- Pros: menor cambio respecto del modelo actual.
- Contras: reconstrucción compleja, escrituras parciales y dificultad para atomicidad.

**Recomendación:** A, manteniendo temporalmente mirrors de Combatant durante migración.

### U2. Modelo de recovery

**Opción A — snapshot/estado actual + receipts**

- Pros: simple, rápido, adecuado a Foundry Documents.
- Contras: menor trazabilidad histórica.

**Opción B — event journal completo**

- Pros: auditoría y replay detallados.
- Contras: mucho mayor coste y riesgo de implementar event sourcing incompleto.

**Recomendación:** A más un journal de auditoría acotado; no event sourcing integral.

### U3. Autoridad/socket futuro

**Opción A — registry de comandos detrás del listener actual**

- Pros: migración incremental; conserva namespace y action strings.
- Contras: convivencia temporal entre handlers adaptados y legacy.

**Opción B — reemplazo inmediato por command bus nuevo**

- Pros: diseño uniforme desde el inicio.
- Contras: big bang, alto riesgo y contradice main siempre jugable.

**Recomendación:** A.

### U4. API pública

**Opción A — mantener `game.mtrol` como fachada estable**

- Pros: compatibilidad con macros/módulos/mundos.
- Contras: exige gobernar versionado y deprecaciones.

**Opción B — retirar globals y usar sólo imports**

- Pros: dependencias explícitas.
- Contras: rompe consumidores externos y macros.

**Recomendación:** A; separar internamente APIs públicas de service locators.

### U5. Estado `states` y ActiveEffects

**Opción A — ActiveEffect/status como maestro, flag sólo metadata**

- Pros: integración Foundry natural.
- Contras: migración y normalización de efectos existentes.

**Opción B — flag Actor como maestro, ActiveEffect como proyección**

- Pros: payload de dominio controlado.
- Contras: reconciliación permanente con Foundry status UI.

**Recomendación:** requiere decisión funcional sobre duración/stacking antes de elegir. No implementar aún.

### U6. Logging

Ya existe `scripts/utils/logger.js` vacío y `game.mtrol.debug` ocupado por herramientas diagnósticas.

- Opción A: logger interno central con setting y exposición de sólo configuración bajo `game.mtrol.debug`.
- Opción B: API pública completa de logging dentro de `game.mtrol.debug`.

**Recomendación:** A, con default WARN, canales definidos y ring buffer opcional únicamente en memoria. Falta aprobar formato, retención y si los jugadores pueden habilitar DEBUG.

### U7. Alcance de ataques

No existe metadata general de armas. Mantener adyacencia congelada ahora. Antes de soportar rango debe aprobarse si la fuente será Item, action definition o una política de Actor.

---

## V. Plan recomendado de Fases 1–8

| Fase | Objetivo/alcance | Archivos iniciales | Contratos preservados | Riesgo | Tests/smoke | Rollback |
|---|---|---|---|---|---|---|
| 1 | Contratos de persistencia: schema lógico versionado, repositories de lectura y logger interno | nuevos módulos internos + adapters, sin sustituir runtime | Todo baseline | Bajo/medio | Characterization + carga de mundos legacy | Retirar adapters; no migración destructiva |
| 2 | Command registry detrás de `system.mtrol`, envelope con commandId/receipt | `socket-requests.js`, `sockets.js`, authority adapters | Action names y APIs existentes | Medio | duplicados, timeout, respuesta tardía, cambio GM | Feature flag al dispatcher actual |
| 3 | Persistir pendingAction y recovery en `ready` | Action Engine + Combat repository + Chat adapter | Comparación/oposición/daño sin cambios | Alto | F5 en CREATE/WAITING/RESOLVING/RESOLVED | Dual-write y fallback temporal al Map |
| 4 | Extraer Turn/Movement por capas y hacer commit reconciliable | Turn System + movement/turn repositories | Hotfix completo y único `nextTurn()` | Alto | movimiento concurrente, GRANTED, REACTION, follow-up, F5 | Mantener fachada y ruta anterior tras feature flag |
| 5 | Exactly-once persistente para Damage/Resources | Actor Resource, MP, Dharma, Consumable, Damage | Fórmulas y saldos | Alto | socket duplicado, MP/cooldown/damage exactly-once, rollback | Dual receipt; desactivar nueva autoridad |
| 6 | Extraer Action/Damage domain y eliminar ciclos conceptuales | Action Engine, Damage Engine, resolution | Reglas de oposición y daño | Alto | doble ataque/defensa, contraataque, shield, stun | Facades compatibles hacia funciones previas |
| 7 | Convertir Sheet/Tracker/Chat a Presentation | Personaje Sheet, Tracker adapter, Chat presenters | UI visible y workflows | Medio | smoke completo y visual regression | Componentes por sección con toggle |
| 8 | Migración/deprecación legacy y hardening multiplayer | migrators, audit, docs | Mundos existentes | Alto | 1 GM + 2 jugadores, reconexión, upgrade world | Backups automáticos y migraciones reversibles |

Cada fase debe entrar en main en unidades pequeñas, con feature flags sólo como mecanismo temporal de rollout, no como arquitectura paralela permanente.

---

## Grafo lógico de dependencias

```text
Personaje Sheet
 ├─ Rolls / Dharma / Preparación
 ├─ Action Engine ───────────────┐
 ├─ Damage Engine ────────────┐  │
 ├─ Turn System ──────────────┼──┤
 ├─ Resources / Progression   │  │
 └─ Inventory / Trade         │  │
                              ▼  ▼
                      Socket request adapter
                              ↓
                       Primary GM listener
                  ┌───────────┼───────────┐
                  ▼           ▼           ▼
              Turn auth   Action auth  Resource/Damage auth
                  │           │           │
                  └──── Action ↔ Turn ────┘
                              ↓
                    Foundry Document updates
                              ↓
                 Hooks → Sheet/Tracker/Chat refresh
```

Ciclos conceptuales:

- Action → Turn por imports; Turn → Action por `game.mtrol.actions`.
- Action → Damage por import dinámico; Damage → Action y Turn por imports.
- Sheet orquesta todos los anteriores y además cierra turnos.
- Socket dispatcher conoce operaciones concretas de todos los dominios.

---

## Cobertura contractual existente

| Dominio | Tests principales |
|---|---|
| Turn/Movement/nextTurn | `turn-system.test.mjs`, `turn-runtime.test.mjs` |
| Opposition/Damage | `opposed-damage-flow.test.mjs`, `ability-architecture.test.mjs` |
| Shield/defense | `shield-defense.test.mjs` |
| HP/MP/idempotencia local | `actor-resource-authority.test.mjs`, `mp-engine.test.mjs` |
| Dharma | `dharma-consumption.test.mjs`, `dharma-roll-integration.test.mjs` |
| Classes/follow-up | `class-resource-contract.test.mjs` |
| Special abilities/Orbs | `special-ability-service.test.mjs`, `orb-*.test.mjs` |
| Consumables | `consumable-service.test.mjs` |
| Trade | suites `trade-*.test.mjs` |
| Legacy/data | `item-data-repair.test.mjs`, `world-item-audit.test.mjs`, progression legacy |
| UI/Chat | premium cards, sheet, inventory y visual tests |

Escenarios aún no caracterizados con persistencia real:

- F5 del Primary GM durante cada estado de pendingAction.
- Cambio de Primary GM con operación mutante en vuelo.
- Entrega duplicada real de raw damage socket.
- Respuesta socket tardía después del timeout.
- Movimiento Token confirmado pero allowance no consumido.
- Recovery de cooldown/MP/HP con command receipt persistida.

No se añadieron tests que congelen estos defectos como comportamiento deseado.

---

## Smoke test manual obligatorio

Ejecutar en un mundo de copia, con consola abierta y un Combat Tracker visible:

1. Crear combate con al menos un físico, un mágico/híbrido y dos objetivos.
2. Tirar iniciativa y verificar orden.
3. Mover una casilla de TURN movement y confirmar Tracker/guard.
4. Usar Destreza/Fuerza/Aura/Suerte para movimiento adicional.
5. Terminar a rango con físico: atacar a cualquiera de dos enemigos y verificar un solo follow-up.
6. Repetir con mágico/híbrido: confirmar avance sin follow-up.
7. Declarar ataque con oposición y comprobar Chat pendiente.
8. Responder defensa y resolver.
9. Ejecutar daño; verificar HP, armadura, MP y cooldown una sola vez.
10. Finalizar turno y comprobar exactamente el siguiente Combatant.
11. Aplicar hechizo de movilidad sobre tercero; mover parcialmente y renunciar.
12. Ganar Esquiva; mover diagonal/horizontal/vertical dentro de un cuadro.
13. Revisar que cada flujo terminal llame una sola vez a avance.
14. Repetir con consola sin errores y Tracker sin estado stale.
15. Antes de publicar, repetir con **1 GM + jugador A + jugador B reales** y probar una reconexión controlada.

Esta auditoría no afirma haber ejecutado la prueba Foundry multiplayer real.

---

## Resultado de Fase 0

- Baseline verificado.
- Lifecycle, APIs, hooks, sockets, memoria y persistencia inventariados.
- Movimiento y follow-up congelados y trazados.
- `nextTurn()` confirmado en un único punto runtime.
- Pending Action, Action, Damage, Resources, UI, legacy y monkey patch mapeados.
- Sources of Truth identificadas.
- Riesgos de recovery/exactly-once priorizados.
- Arquitectura objetivo y roadmap propuestos sin implementación.
- Siete decisiones materiales elevadas para aprobación.

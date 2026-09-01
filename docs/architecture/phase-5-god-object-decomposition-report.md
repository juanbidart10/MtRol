# MTROL — Fase 5: desmontaje incremental de God Objects

Fecha técnica: 2026-08-29  
Rama: `refactor/combat-architecture`  
Alcance: `action-engine.js`, `turn-system.js` y `personaje-sheet.js`  
Estado: implementación y QA automatizado completos; smoke real pendiente de ejecución/aprobación manual.

## A. Baseline

La fase comenzó sobre el baseline aprobado de Fases 0–4B, sin limpiar ni sustituir el worktree acumulado. La suite inicial contenía 951 pruebas: 950 aprobadas, 0 fallidas y 1 skip intencional. Se preservaron AuthorityService, Command Registry, TransactionCoordinator, ReceiptStore, RecoveryCoordinator, runtime persistente, logger, lifecycle, hooks, sockets, Primary GM authority, `game.mtrol`, oposición por capabilities, movimiento transaccional y Trade persistente.

No se modificó el schema persistente, no se ejecutaron migraciones de mundo, no se tocó `mtrol.zip` y no se creó infraestructura paralela.

## B. God Objects antes

| Módulo | Líneas iniciales | Responsabilidades mezcladas relevantes |
|---|---:|---|
| `action-engine.js` | 2.838 | metadata, definición, oposición, persistencia runtime, locks, chat, recovery, daño y cierre de turno |
| `turn-system.js` | 1.873 | estado, movimiento, follow-up, avance, cooldown, preparación, hooks y Combat Tracker |
| `personaje-sheet.js` | 3.158 | render, view-model, handlers, reglas, permisos y mutaciones directas de Actor/Item |

El problema principal no era el tamaño aislado, sino que cada cambio atravesaba varias capas y obligaba a simular Foundry incluso para predicates o transformaciones deterministas.

## C. Dependency graph before

```text
PersonajeSheet ─┬─> ActionEngine ───────> TurnSystem
                ├─> TurnSystem ─────────> Foundry globals/Documents
                ├─> dominio diverso
                └─> Actor/Item mutations

TurnSystem ─────┬─> Movement/Foundation
                ├─> class/special services
                ├─> Combat Tracker DOM
                └─> Hooks + Combat.nextTurn

ActionEngine ───┬─> opposition/damage/MP
                ├─> ChatMessage presentation
                ├─> runtime persistence
                └─> Foundry globals
```

High fan-out inicial: los tres módulos. High fan-in: exports legacy de Action/Turn consumidos por Sheet, sockets, chat y tests. Los imports dinámicos relevantes ya existentes se concentraban en comandos de oposición, daño y movimiento. Los globals dominantes eran `game`, `ui`, `Hooks`, `foundry` y `ChatMessage`.

## D. Action Engine audit

| Clasificación | Contenido encontrado | Decisión |
|---|---|---|
| ORCHESTRATION | creación, defensa, resolución y cierre | permanece como coordinación/compatibilidad |
| ACTION METADATA | actionType, capabilities, domain, responses, modes | extraído |
| DOMAIN RULE | resolución estructural y daño canónico | extraído como funciones deterministas |
| OPPOSITION | eligibility y resolución | delegación conservada a policy/engine existentes |
| COST | MP, stacks y recursos | se reutilizan servicios vigentes; no se duplican |
| COOLDOWN | eligibility, remaining y mark/use | extraído |
| EFFECT EXECUTION | daño/estado | sigue delegado a engines transaccionales existentes |
| PERSISTENCE | pending actions | runtime persistente sigue autoritativo; cache RAM explicitada |
| CHAT/PRESENTATION | pending, invalid defense y resolution | extraído |
| FOUNDRY ADAPTER | UUID, users, messages y hooks | queda en el boundary/orchestrator |
| LEGACY | exports públicos y fallback Cadenas Infernales | wrapper/fallback conservado para Fase 6 |

## E. Action slices ejecutados

1. Se extrajo `action-definition-resolver.js`, determinista y sin side effects.
2. Se conservaron `actionType`, capabilities, domain, allowed responses, execution modes y políticas existentes.
3. Coste y aplicación continuaron usando MP/Foundation de Fase 2; no se creó un calculador paralelo.
4. Se extrajo `action-cooldown-service.js` y Turn conserva el export compatible.
5. Se extrajo `pending-action-presentation.js` para chat y restauración visual de rolls.
6. Se extrajo `pending-action-cache.js`; Maps/Sets quedaron clasificados explícitamente como cache reconstruible.
7. Action Engine conserva orquestación, integración Foundry y exports legacy, con logging centralizado.

## F. Action target architecture

```text
ActionEngine (orchestrator/compatibility)
  ├─> ActionDefinitionResolver (pure metadata/policy)
  ├─> OppositionPolicy + ResolutionEngine
  ├─> MP/Damage/Resource transactional services
  ├─> ActionCooldownService
  ├─> PendingActionPresentation (Chat adapter)
  └─> RuntimeRepository + PendingActionCache
```

El archivo principal quedó en 2.341 líneas. La reducción es una consecuencia; el resultado relevante es que definición, presentación, cooldown y cache poseen límites testeables independientes.

## G. Turn System audit

| Clasificación | Contenido encontrado | Decisión |
|---|---|---|
| TURN STATE | flags y normalización | acceso persistente extraído a repository; dominio vigente reutilizado |
| MOVEMENT | guards y transacciones | se conserva MovementService de Fase 3; no se reescribe |
| FOLLOW-UP | elegibilidad física, clase, rango y target | policy extraída |
| ADVANCE | lock/retry/receipt y `nextTurn` | servicio extraído, ruta única |
| PREPARE | reserva, consumo y cancelación | reglas sin cambios dentro de orquestación existente |
| SPECIAL ABILITY | integración con servicios de Orbes | delegación conservada |
| UI/TRACKER | DOM, panel y controles | adapter extraído |
| SOCKET/FOUNDRY | hooks de combate y movimiento | boundary conservado |
| LEGACY | exports consumidos externamente | wrappers compatibles |

## H. Turn slices

1. `turn-state-repository.js` encapsula paths y read/write de flags sin reglas de gameplay.
2. `follow-up-policy.js` concentra predicates, clase desde `class-registry`, token, target y rango.
3. `turn-advance-service.js` concentra reentrancia reconstruible, receipt durable y la única llamada real a `combat.nextTurn()`.
4. `turn-tracker-adapter.js` contiene toda la presentación y controles del Combat Tracker.
5. `action-cooldown-service.js` sirve a Turn mediante wrapper compatible.
6. Movement y `getAvailableMovement()` mantienen sus contratos canónicos de Fase 3.

## I. Turn target architecture

```text
TurnSystem (turn domain/orchestrator)
  ├─> TurnStateRepository + turn-state domain
  ├─> MovementService/Foundation
  ├─> FollowUpPolicy
  ├─> TurnAdvanceService ─> Combat.nextTurn (única ruta)
  ├─> Prepare/Special services existentes
  └─> TurnTrackerAdapter (Foundry/UI boundary)
```

Turn System quedó en 1.556 líneas y ya no contiene la implementación visual del Tracker ni la operación real de avance.

## J. Sheet audit

| Clasificación | Contenido encontrado | Decisión |
|---|---|---|
| RENDER/VIEW MODEL | progreso, imágenes, recursos, ejecutabilidad | transformaciones extraídas |
| EVENT HANDLER | bind de botones y feedback | permanece en controller UI |
| COMMAND DISPATCH | Action/Turn/Trade/services | delegación conservada |
| DOMAIN RULE | nivel, creación/borrado/equipado e imágenes | extraído |
| DIRECT DOCUMENT MUTATION | Actor/Item/create/delete | retirada del Sheet |
| SOCKET | solicitudes a Primary GM existentes | no se amplió el scope |
| CHAT | mensajes/FX de presentación | permanece en UI |
| INVENTORY/COMBAT UI | selección, filtros y ejecución | controller/presentation |

## K. Sheet slices

1. `personaje-item-drag-policy.js` concentra clasificación y payload interno de drag/drop.
2. `personaje-sheet-view-model.js` concentra transforms de progreso, imágenes, fórmula visual, recursos y presentación ejecutable.
3. `personaje-inventory-controller.js` concentra creación, importación, equipamiento y borrado seguro; la autoridad final GM vive en el controller/service.
4. `personaje-image-controller.js` concentra mutaciones de imágenes de Actor/Item.
5. `competence-level-service.js` concentra permiso GM, clasificación, clamp y actualización.
6. Las pruebas visuales se actualizaron para verificar la nueva ubicación de la misma transformación, no para relajar contratos.

## L. Sheet target architecture

```text
PersonajeSheet (UI controller/event binder)
  ├─> PersonajeSheetViewModel
  ├─> Inventory/Image/Drag controllers
  ├─> Public action/turn/trade services
  └─> Domain/Command authority
```

Personaje Sheet quedó en 2.777 líneas. Mantiene UI y handlers, pero no contiene llamadas directas a `Actor.update`, `Item.update`, `createEmbeddedDocuments` ni `deleteEmbeddedDocuments`.

## M. Services nuevos

- `action-cooldown-service.js`
- `turn-advance-service.js`
- `personaje-inventory-controller.js`
- `personaje-image-controller.js`
- `competence-level-service.js`

## N. Repositories nuevos

- `turn-state-repository.js`: repository real de flags de Combatant.
- `pending-action-cache.js`: no es repository autoritativo; es una cache reconstruible documentada sobre RuntimeRepository.

No se crearon wrappers triviales por cada `update`.

## O. Pure functions/policies

- `action-definition-resolver.js`
- `follow-up-policy.js`
- `personaje-item-drag-policy.js`
- transforms de `personaje-sheet-view-model.js`

Estas unidades no importan los God Objects. El view-model puede consumir servicios públicos de turno, pero Turn/Action no importan Sheet.

## P. Legacy wrappers

- `getActionDefinitionFromItem` continúa exportado desde Action Engine y delega al resolver.
- `getItemCooldownStatus` continúa exportado desde Turn System y delega al servicio.
- `installCombatTrackerButton` continúa como entrypoint compatible y delega al adapter.
- wrappers internos de follow-up y turn-state conservan las firmas existentes.

Se conservaron porque poseen consumers reales. Su retiro debe hacerse con búsqueda de consumers y deprecation explícita en Fase 6.

## Q. Sockets legacy migrados

No se migraron sockets adicionales en Fase 5. Ready-damage ya usa la infraestructura command/adapter construida en fases anteriores; progresión y estados todavía presentan un scope mayor o reglas compartidas, por lo que forzar su migración habría ampliado esta fase. Quedan inventariados para Fase 6.

## R. Estado mutable detectado

- Pending actions: estado crítico en RuntimeRepository; `pendingActionCache` es reconstruible.
- Resolving/attaching locks: cache local transitoria e idempotente.
- Turn advance locks: cache reconstruible; el receipt/flag durable sigue siendo la autoridad.
- Reservations de movimiento: infraestructura transaccional de Fase 3, sin duplicación.
- Timers/handlers de chat: lifecycle existente e idempotente.

No se añadió estado crítico RAM-only.

## S. Circular dependencies

El análisis estático de boundaries y el grafo de imports no detectan ciclos nuevos entre módulos extraídos. Los módulos de dominio/policy nuevos no importan `action-engine.js`, `turn-system.js` ni `personaje-sheet.js`; el adapter del Tracker recibe callbacks y no importa Turn System. Esto evita `Action → Turn → Action` y `Sheet → Domain → Sheet`.

## T. game.mtrol compatibility

No se retiró ni renombró ninguna API de `game.mtrol`. Los nuevos módulos se consumen mediante imports internos y no aumentan su uso como service locator.

## U. Public API compatibility

Se mantuvieron exports legacy, macros, callers de UI y contratos observables. Los contract/static tests verifican que las fachadas antiguas deleguen o continúen disponibles. No hubo cambios de schema, fórmula, coste, cooldown, timing, permisos ni reglas.

## V. Tests nuevos

Se agregaron 30 tests directos en nueve archivos:

- definición de acción: 4
- cooldown: 4
- follow-up: 3
- turn-state repository: 3
- turn advance: 3
- Sheet view-model: 4
- Sheet controllers: 4
- pending action cache/presentation: 2
- límites, compatibilidad y única ruta `nextTurn`: 3

Además se adaptaron contratos estáticos existentes para leer los módulos extraídos.

## W. Suite global

Resultado final: **981 tests, 980 pass, 0 fail, 1 skip intencional**, duración aproximada 4,9 s. Cubre Opposition, Damage, Resources, Movement, Trade, Consumables, Turns, Authority, Hooks, Sockets, Recovery y public façade.

`git diff --check` no encontró errores de whitespace; sólo aparecen avisos de normalización LF/CRLF propios del worktree Windows.

## X. Performance before/after

| Aspecto | Antes | Después |
|---|---|---|
| Imports dinámicos | oposición/daño/movimiento | mismos boundaries; 3 en Action y 4 en Turn |
| Handlers/hooks | registrados por lifecycle existente | sin nuevos registries ni hooks paralelos |
| Document reads/writes | dispersos, varios desde Sheet | Sheet sin escrituras directas; repository/controllers explícitos |
| Rerenders | comportamiento existente | sin cambios funcionales ni rerenders añadidos |
| Resolución metadata | embebida en Action | resolver determinista reutilizable |
| `combat.nextTurn()` | una ruta | una ruta en `turn-advance-service.js` |

No se añadió trabajo recurrente por frame/render ni nuevas round-trips. La verificación de latencia perceptible corresponde al performance smoke manual.

## Y. Smoke test

No se ejecutó por instrucción expresa del usuario, quien se encarga del smoke real. Por lo tanto, la implementación está cerrada técnicamente en automatización, pero **la aprobación formal de Fase 5 queda pendiente** hasta confirmar el smoke 1 GM + 2 jugadores y su revisión de performance.

## Z. Riesgos restantes

- Action Engine todavía mantiene integración Foundry, persistencia/orquestación y una superficie legacy amplia.
- Turn System todavía agrupa preparación, hooks y guards de movimiento, aunque delega sus slices principales.
- Personaje Sheet conserva muchos handlers/UI y alto fan-out de imports, ahora con mutaciones críticas delegadas.
- Los globals Foundry siguen presentes en boundaries: son deuda de adapter, no dominio nuevo.
- El fallback nominal de Cadenas Infernales continúa por compatibilidad y no debe propagarse.

## AA. Código legacy para Fase 6

- sockets directos restantes de progresión y estados;
- revisión de ready-damage y sus consumers legacy;
- deprecation/retiro de wrappers demostrablemente sin consumers;
- fallback nominal Cadenas Infernales;
- reducción adicional de adapters Foundry dentro de Action/Turn;
- handlers cohesivos restantes de Personaje Sheet;
- auditoría de `game.mtrol` y macros para una superficie pública documentada.

## AB. Monkey patches pendientes

El monkey patch de iniciativa no fue modificado. Continúa como dependencia legacy y su encapsulación/eliminación queda expresamente para Fase 6.

## AC. Recomendación para Fase 6

Realizar primero el smoke real de Fase 5. Con esa evidencia, continuar por consumers legacy y sockets inventariados, con deprecations medibles y sin reabrir reglas. Prioridad sugerida: adapters/persistencia restantes de Action, sockets de progresión/estados, consolidación de façade pública y, por último, encapsulación del monkey patch de iniciativa. Mantener el mismo gate incremental: audit → extracción → contract tests → regresión → smoke.

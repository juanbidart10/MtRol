# Fase 6 — Sockets residuales, iniciativa y eliminación segura

Fecha: 2026-08-30. Rama: `refactor/combat-architecture`.

**Bloque implementado y validado. Fase 6 global todavía abierta. Sin commit.**

Este informe continúa `phase-6-state-authority-report.md`; no reabre la decisión de permisos de estados aprobada por el usuario. El Prompt Maestro de Fase 6 sigue siendo el contrato completo. Este corte no sustituye el informe final A–AO.

## Gate inicial y regresión

| Corte | Total | Pass | Fail | Skip |
|---|---:|---:|---:|---:|
| Fase 0 registrada | 875 | 874 | 0 | 1 |
| Entrada posterior a autoridad de estados, ejecutada de nuevo | 999 | 998 | 0 | 1 |
| Adopción de commands para sockets residuales | 1009 | 1008 | 0 | 1 |
| Cierre de este bloque | 1019 | 1018 | 0 | 1 |

Suite completa: todos los `tests/*.test.mjs` con `node --test`. Duración de la última ejecución: 4938,7528 ms. Es tiempo del runner, **no profiling del juego**. El skip sigue siendo `Owner contra Owner requiere verificación runtime con dos clientes reales`, en `shield-defense.test.mjs`; requiere SocketInterface y replicación reales.

Pruebas focalizadas:

- 76/76: nuevos commands, integración de daño/oposición, progresión y autoridad de estados.
- 7/7: caracterización del método original de iniciativa **antes** de moverlo.
- 20/20: 10 tests del adaptador final de iniciativa más 10 de integración Foundry de Fase 4A.
- `git diff --check`: sin errores; avisos de normalización LF/CRLF del worktree preexistente.

## Sockets: causa y solución

Progresión y ready-damage todavía tenían ramas directas de dominio dentro del dispatcher de sockets. La validación autoritativa de esos dominios existía; faltaba adoptar el Command Registry canónico. Se eliminaron las ramas y la proyección de daño del transporte.

| Acción de transporte conservada | Command canónico | Dominio existente |
|---|---|---|
| `mtrolSpendPendingAttribute` | `progression.spend-attribute` | `spendPendingAttributePointAuthoritative` |
| `mtrolSpendPendingCompetence` | `progression.spend-competence` | `spendPendingCompetencePointAuthoritative` |
| `mtrolCreateReadyDamageAction` | `action.ready-damage-create` | `createReadyDamageActionAuthoritative` |
| `mtrolExecuteResolvedDamage` | `action.resolved-damage-execute` | `executeResolvedDamageAuthoritative` |

Flujo: socket → autenticación de AuthorityService → adaptador de transporte → Command Registry → dominio existente. Los commands se registran en init, idempotentemente; la llamada defensiva desde el dispatcher reutiliza esos registros.

Se mantienen nombres de transporte porque tienen emisores reales: `progression-advancement-service.js`, `action-engine.js` y `action-damage-engine.js`; además están documentados y cubiertos por integración. Se retira el handler directo, no el contrato que todavía consumen los clientes. El cleanup restante de rutas antiguas ajenas a esta tabla continúa pendiente de consumer search específico.

Se conservan payloads, resolución canónica de Actor —incluidos Actors sintéticos—, ownership, snapshots, recibos y respuestas. `serializeResolvedDamageResult` conserva la misma proyección de daño localizado, coerciones y valores por defecto. Los errores pasan por el logger y respuesta comunes; no se capturan para repetir mutaciones.

Los registros son `scope: world` e `idempotent: false` **en el Registry**: no agregan una segunda transacción ni un requisito de Combat para progresión. La idempotencia que ya posee cada dominio permanece allí. Este cambio de routing no demuestra ni añade exactly-once donde antes no existía, especialmente para la creación de ready-damage. El hardening residual se audita por separado.

## Iniciativa: auditoría y decisión

El único patch original estaba en `scripts/core/hooks.js`, instalado durante setup. Sustituía `Combat.prototype.rollInitiative`; la variable `originalRollInitiative` no tenía consumidor y el método original nunca se ejecutaba. La razón funcional observable —no una atribución histórica especulativa— es ejecutar `rollMtrolInitiative`: preparación, evaluación MTROL, Karma/Dharma, chat, dado secundario y pifia.

Consumers internos: instalación desde setup; no hay llamadas directas de MTROL al método sobrescrito. Su contrato es público de Foundry. La documentación v14 indica que `rollAll` y `rollNPC` delegan opciones en `rollInitiative`.

Referencias oficiales consultadas:

- [Combat.rollInitiative, rollAll y rollNPC — Foundry v14](https://foundryvtt.com/api/v14/classes/foundry.documents.Combat.html#rollInitiative): opciones de fórmula/mensaje y mantenimiento del combatiente activo mediante `updateTurn`.
- [Combatant.getInitiativeRoll — Foundry v14](https://foundryvtt.com/api/v14/classes/foundry.documents.Combatant.html#getInitiativeRoll): devuelve un Roll sin evaluar.

Conclusión de la comparación con el código local: esas alternativas, usadas directamente, no reproducen inequívocamente el flujo asíncrono y sus efectos. El patch MTROL además ignora opciones y reinicia a `turn: 0` incluso sin tiradas. No se retiró ni se intentó adaptar reglas a la implementación stock.

Se movió a `scripts/combat/initiative-foundry-adapter.js`, conservando:

- ID único, listas ordenadas y selección por ownership cuando no hay lista.
- Omisión de combatientes inexistentes, sin Actor o con resultado nulo.
- Resultado cero válido, incluidas pifias.
- Tiradas secuenciales, una escritura de iniciativas si corresponde y después `turn: 0`.
- Retorno del Combat; propagación de errores sin retries ni nuevas escrituras.
- Comportamiento anterior de `options`, deliberadamente sin cambios.

La instalación ahora es idempotente por prototype: no añade otros métodos ni envuelve repetidamente. Si un módulo externo instala un wrapper después, una segunda llamada de setup no lo pisa. Un WeakSet guarda sólo identidad de registro, no estado de juego: clave prototype, vida de sesión/módulo, liberación débil; F5 lo reconstruye. No es una cache de resultados ni nueva fuente autoritativa.

**Deuda aceptada por la regla 16 del prompt:** continúa un único monkey patch. Riesgo: compatibilidad con módulos que sustituyan el mismo método. Retirarlo requiere demostrar equivalencia con una API oficial, pruebas de todos los efectos/errores y smoke real; cualquier cambio observable exige consulta al usuario.

## Legacy eliminado

Clasificación C: internos sin consumidores, vacíos (0 bytes), no APIs. Búsqueda de nombres/rutas en código, imports estáticos y dinámicos, tests, templates, manifiesto y documentación: sólo referencias históricas en el informe de Fase 0. Sin referencia de runtime.

- `scripts/combat/armor-engine.js`
- `scripts/combat/combat-flow.js`
- `scripts/combat/combat-helpers.js`
- `scripts/combat/damage-engine.js`

Retirados físicamente del sistema. Copia recuperable en `C:\Users\jbb10\.codex\.chatgpt-projects\g-p-6a1b188f3c348191abb93dd814719fb8\phase6\removed-legacy\scripts\combat`. También se eliminó la variable muerta `originalRollInitiative` al extraer el patch. No se borraron flags, schemas, Actors, Items ni datos del mundo.

## Inventario arquitectónico de este corte

Auditoría léxica de `scripts` y `models`, no mediciones de invocaciones reales:

| Métrica | Inicio de Fase 6 | Este corte |
|---|---:|---:|
| Sitios de registro Hooks | 50 | 50 |
| Coincidencias socket emit/on/action del scanner | 17 | 15 |
| Referencias léxicas a façade | 69 | 69 |
| Construcciones Map/Set, incluidas locales | 180 | 180 |
| Candidatos a mutación documental | 91 | 91 |
| Llamadas runtime a nextTurn | 1 | 1 |
| Patches de prototype | 1 | 1 |

La fila socket **no cuenta acciones únicas**; su descenso no implica haber retirado dos contratos. El WeakSet de registro del patch se clasifica aparte. Este inventario no sustituye la matriz formal completa Fase 0 vs Fase 6.

- `nextTurn` sigue únicamente en `turn-advance-service.js`.
- PersonajeSheet sigue sin mutaciones documentales directas de negocio.
- Sin imports literales rotos ni rutas inexistentes en el manifiesto auditado.
- Los tests nuevos protegen separación socket/commands, registro idempotente, payloads y errores; el test de bootstrap impide reintroducir el patch inline.
- High fan-in: socket-requests 21, item-invariants 20, logger 19, runtime-foundation 15.
- High fan-out: PersonajeSheet 41, init 30, action-engine 15, trade-authority 13.
- No se añadieron ciclos. **Persisten** el estático ambient-fx-app ↔ ambient-fx-manager y, incluyendo imports dinámicos, movement-service ↔ turn-system y el componente action-engine / action-damage-engine / opposition-commands.

## Archivos de este bloque

Modificados: `scripts/core/sockets.js`, `scripts/core/init.js`, `scripts/core/hooks.js`.

Nuevos: `scripts/runtime/progression-commands.js`, `scripts/runtime/action-commands.js`, `scripts/combat/initiative-foundry-adapter.js`, `tests/phase6-socket-command-adoption.test.mjs`, `tests/phase6-initiative-adapter.test.mjs` y este informe.

Retirados: los cuatro placeholders listados arriba. Las demás diferencias del worktree pertenecen a las fases previas y se preservaron.

## Próximo bloque y gates abiertos

1. RAM/receipts/recovery residual: `orb-management-service.js` conserva `completedTransactions` en Map; investigar/persistir por foundation sin cambiar permisos ni reglas. `ActorRuntimeRepository.prune` no distingue receipts pendientes de terminales; verificar retención de evidencia ambigua. `TransactionCoordinator` clasifica fallos según checkpoints; auditar ventanas de escritura sin checkpoint y bloqueo entre operaciones nuevas. Estos hallazgos no están corregidos por la adopción de commands.
2. Resolver los ciclos conocidos sin ocultarlos mediante globals/imports dinámicos arbitrarios. Completar consumer search de otros aliases, façade, sockets legacy y flags.
3. Completar hardening de errores/logging y guardrails globales; validar paths de assets/templates, no sólo manifiesto e imports literales.
4. Ejecutar profiling antes/después y stress integral. No se realizaron en este bloque y no se infieren a partir de tiempos de tests.
5. Documentación arquitectónica/onboarding consolidada, matriz final Fase 0 vs Fase 6 e informe A–AO.
6. Smoke multicliente final: pendiente a cargo del usuario por su indicación. No se operó el mundo Foundry en esta continuación.

Estas pendientes impiden marcar `MTROL ARCHITECTURAL REFACTOR — COMPLETE`. No se solicita commit final todavía.

## Seguridad de entrega

- Sin commit, push, release ni bump de versión.
- HEAD y main siguen en `fbf0f7e92a227d669fae1d132c3b08636076ce00`.
- `system.json` v1.2.9, exclusivamente v14; SHA-256 `E0995689EC030FA0797CACE5D9D0EDD9F686082DE282FF940C353C15D1802034`, igual al inicio.
- `mtrol.zip` no tocado: 453396771 bytes; última modificación 2026-08-27 19:34:03 -03:00, igual al registro inicial. Se verificaron metadatos, no un hash completo del archivo.
- Worktree acumulado: `git diff --stat` de archivos tracked registra 70 archivos, 4167 inserciones y 2466 eliminaciones; no incluye los untracked de esta y anteriores fases. No se atribuye ese total a este bloque.

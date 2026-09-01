# MTROL — Fase 6: ciclos, legacy residual y cierre de consumers internos

Fecha: 2026-08-31  
Rama: `refactor/combat-architecture`  
Alcance: dependencias circulares, legacy seguro, consumers internos, `game.mtrol`, estado mutable y guardrails.  
Fuera de alcance ejecutado: smoke, profiling, stress, versionado, release, commit y push.

## Resumen ejecutivo

El bloque termina con cero ciclos conocidos, incluida la combinación de imports estáticos y dinámicos; una única llamada runtime a `combat.nextTurn()`; cero mutaciones documentales de negocio desde `PersonajeSheet`; cero consumers internos de `game.mtrol`; y cero estado crítico exclusivamente en RAM.

Se retiraron físicamente dos módulos de Trade muertos y test-isolated. La API pública `game.mtrol` conserva sus nombres y firmas. La suite global finalizó con 1049 tests: 1048 pass, 0 fail y 1 skip intencional.

## Ciclos encontrados y resolución

### Ambient FX

Anterior: `ambient-fx-manager.js` ↔ `ambient-fx-app.js`.

Resolución: el manager ya no importa la Application. `core/init.js` registra explícitamente `MtrolAmbientFxApp` mediante `configureAmbientFxApp()`. La Application conserva su dependencia unidireccional hacia las operaciones del manager. Los botones internos llaman `openManager()` por import/local binding, no a `game.mtrol.fx`.

### Movimiento

Anterior: `movement-service.js` → `turn-system.js` y cuatro imports dinámicos inversos desde Turn hacia Movement.

Resolución: `turn-system.js` expone un puerto de integración con validación de lifecycle. `movement-service.js` registra `executeMovementTransaction` y `executeMovementRenounceTransaction`. Se eliminaron los cuatro imports dinámicos sin cambiar transactions, receipts, authority ni iniciativa.

### Action / Damage / Opposition

Anterior: componente combinado entre `action-engine.js`, `action-damage-engine.js` y `runtime/opposition-commands.js`.

Resolución:

- Action Damage recibe explícitamente seis operaciones canónicas de Action Engine.
- Action Engine importa directamente las dos ejecuciones de daño; Damage ya no importa Action.
- Opposition Commands recibe las operaciones autoritativas por un puerto explícito.
- Se conserva el registro perezoso observable de commands para consumers ESM que ejecutan antes de `init`.

El primer test focalizado detectó esa compatibilidad de registro perezoso; se preservó antes de continuar. El grafo final no contiene ciclos estáticos ni ciclos al incluir imports dinámicos literales.

## Legacy eliminado

Consumer search incluyó imports estáticos, imports dinámicos, scripts, templates, styles, tests, documentación, manifest y nombres de socket versionados.

Eliminado:

- `scripts/items/trade-engine.js`
- `scripts/ui/trade-dialog.js`
- action socket sin receptor `mtrolEjecutarComercio`
- `tests/trade-equipment-sync.test.mjs`, que era el único consumer del motor muerto

Motivo: el diálogo tenía cero consumers y el engine sólo era test-isolated. La ruta canónica de Trade ya cubre transferencia exactamente-once y rechaza Items equipados. El engine viejo implementaba otra regla —desequipar y transferir— fuera del runtime, por lo que conservarlo mantenía una segunda ruta de negocio inactiva.

La prueba aislada se sustituyó por `phase6-legacy-removal.test.mjs`, que impide reintroducir ambos archivos y el socket huérfano.

## Legacy preservado

Se preservó por ser público/documentado, contrato persistente o compatibilidad de mundo:

- superficie `game.mtrol` (`roll`, daño autorizado, `turns`, `actions`, `states`, `trade`, `specialAbilities`, `fx`, `fxDebug`, `debug`, `integration`);
- namespace histórico `game.mtrol3d`;
- wrappers públicos de daño y aliases ESM documentados;
- adapters socket `mtrol*` que todavía poseen emisores o contrato de transporte;
- aliases de Actor/Item `character` e `item`;
- readers/defaults de schema y flags legacy;
- nombres legacy de special abilities, peso por `slots` y `persistentSequencerFx`;
- monkey patch de iniciativa encapsulado y cubierto por tests previos;
- `styles/ui/trade-dialog.css`, aún importado por la UI moderna y cubierto por tests.

No se eliminó ni modificó dato persistente legacy.

## Consumers migrados

- controles Ambient FX: façade global → binding directo `openManager()`;
- Turn: imports dinámicos de Movement → puerto transaccional explícito;
- Action Damage: imports de Action Engine → operaciones configuradas;
- Opposition Commands: import de Action Engine → operaciones configuradas;
- Trade Runtime, Trade Proximity y Trade GM Runtime: `game.mtrol.trade` → `tradeClientApi` configurada durante setup;
- Trade App, GM Monitor y Audit History: `game.mtrol.trade` → API inyectada por su runtime.

## Estado final de `game.mtrol`

El conteo léxico bajó de 69 al inicio del bloque a 51. Las referencias restantes pertenecen exclusivamente a instaladores de façade pública, extensiones de debug o mensajes que documentan la entrada pública. No existe consumer interno restante bajo `scripts/trade`, `scripts/ui`, sockets, Turn ni Action.

`game.mtrol3d` permanece como namespace público histórico con consumers internos 3D. No se modificó porque su contrato y refactor no formaban parte de este bloque; queda como deuda explícita para una auditoría 3D específica, no como estado crítico del combate.

## Maps/Sets y estado mutable

El audit lexical cuenta 179 construcciones `Map/Set` en todos los scopes. Los 64 `Map/Set` module-level quedan enumerados por guardrail:

- `critical`: 0;
- `cache`: 25;
- `legitimate`: 39.

Caches relevantes y su fuente de verdad:

- pending/correlation/locks de Movement y Turn: optimistas o in-flight; fuente persistente `Combat`/runtime receipts;
- receipts completados de resources, Dharma y consumibles: aceleradores; fuente persistente TransactionCoordinator/Actor/Combat runtime;
- `clientSessions`: proyección pública local; fuente autoritativa Trade persistente del Primary GM;
- death/Sequencer FX: deduplicación visual derivable de Documents/estado actual;
- Apps/monitors: handles UI cerrables y reconstruibles;
- socket requests: correlación temporal con timeout;
- queues/locks: serialización in-flight, no resultado de negocio.

Los restantes son conjuntos constantes de validación/política. Los objetos y `let` module-level auditados son registradores idempotentes, adapters configurados, timers, handles UI o caches reconstruibles. No contienen autoridad mecánica ni resultados críticos sin respaldo persistente.

## Guardrails agregados

`tests/phase6-architecture-guardrails.test.mjs` verifica:

- cero ciclos sobre imports estáticos y dinámicos literales;
- `game.mtrol` sólo en instaladores de façade;
- una única llamada runtime a `nextTurn()`;
- cero business writes directos desde `PersonajeSheet`;
- ausencia del Trade legacy retirado;
- clasificación exhaustiva de todo `Map/Set` module-level y cero categoría critical RAM-only.

`tests/phase6-legacy-removal.test.mjs` verifica ausencia física y que el CSS activo permanezca.

## QA

Focalizados finales:

- ciclos Action/Movement/Foundation: 53 pass, 0 fail;
- legacy y transferencia Trade: 81 pass, 0 fail;
- adopción API Trade/UI/GM/Proximity: 141 pass, 0 fail;
- guardrails arquitectónicos: 4 pass, 0 fail.

Suite global:

- total: 1049;
- pass: 1048;
- fail: 0;
- skip: 1 intencional;
- duración: 4887 ms.

No se ejecutó smoke por instrucción del usuario.

## Integridad del repositorio

- branch: `refactor/combat-architecture`;
- HEAD y `main`: `fbf0f7e92a227d669fae1d132c3b08636076ce00`;
- `system.json` SHA-256: `E0995689EC030FA0797CACE5D9D0EDD9F686082DE282FF940C353C15D1802034`;
- `mtrol.zip` SHA-256: `5A19DC704CE99F935E162DF5F20FCC7E685AA77B355C6AEFB22B8ABCE2DCE693`;
- `mtrol.zip`: 453396771 bytes, timestamp 2026-08-27 19:34:03 -03;
- sin cambio de versión, commit, push ni release.

## Riesgos y deuda aceptada

- El detector de ciclos es estático y cubre imports literales; un import construido dinámicamente requeriría revisión manual.
- Los adapters configurados son estado module-level legítimo de composición; fallan explícitamente si el lifecycle no los instala.
- `game.mtrol3d` mantiene acoplamiento interno histórico.
- APIs públicas deprecated y readers legacy continúan por compatibilidad; su retiro exigiría decisión explícita y posiblemente migración de consumidores externos.
- No se ejecutaron smoke multiccliente, stress ni profiling en este bloque.

## Siguiente bloque recomendado de Fase 6

Continuar con **error handling + logging hardening**:

1. auditar `catch` silenciosos, promises ignoradas, fallbacks ambiguos y `return undefined` en commands;
2. reemplazar `console.*` de rutas críticas por logger estructurado, sin spam ni Documents/payloads completos;
3. preservar la distinción critical/non-critical;
4. ejecutar guardrails y suite global.

Después corresponde profiling y stress con métricas reales; no optimizar antes de obtener evidencia. La documentación arquitectónica consolidada, comparación Fase 0/Fase 6 y smoke final permanecen pendientes para el cierre total de Fase 6.

# MTROL — Fase 2: Damage + Resources Exactly-Once

## A. Baseline

- Rama: `refactor/combat-architecture`.
- Gate Fase 1B: smoke real 1 GM + 2 jugadores confirmado por el usuario el 28-08-2026.
- Baseline previo: 909 tests, 908 aprobados, 0 fallidos, 1 omitido.
- Retención no-combate aprobada: 128 receipts por Actor y 30 días.

## B. Archivos modificados

La Fase 2 agrega o modifica principalmente:

- `scripts/runtime/actor-runtime-repository.js`
- `scripts/runtime/transaction-coordinator.js`
- `scripts/runtime/transaction-commands.js`
- `scripts/runtime/receipt-store.js`
- `scripts/runtime/runtime-foundation.js`
- `scripts/runtime/recovery-coordinator.js`
- `scripts/combat/damage-authorized.js`
- `scripts/combat/damage-localized.js`
- `scripts/actors/actor-resource-service.js`
- `scripts/combat/mp-engine.js`
- `scripts/rolls/mtrol-dharma-karma.js`
- `scripts/rolls/dharma-spend-service.js`
- `scripts/items/consumable-service.js`
- `scripts/actions/competence-mode-service.js`
- `models/competencia-model.js`
- `scripts/sheets/actors/personaje-sheet.js`
- `scripts/core/init.js`, `ready.js` y `sockets.js`
- pruebas focalizadas de recursos, consumibles y Fase 2.

Los cambios anteriores de Hotfix 1, Fase 1 y Fase 1B permanecen sin separar en el worktree. `mtrol.zip` no fue modificado.

## C. Transaction Coordinator

`TransactionCoordinator` extiende la Foundation existente. Selecciona el mismo contrato `ReceiptStore` sobre Combat o Actor, administra `transactionId`, preparación, checkpoints, estados, replay y reconciliación. Estados observables: `prepared`, `applying`, `applied`, `completed`, `failed` y `recovery-required`.

No contiene reglas de daño, recursos ni consumibles.

## D. Damage canonical pipeline

`aplicarDanioCanonicoAutorizado()` es la única implementación pública autoritativa. El pipeline prepara una única localización y los valores before/after, aplica armadura, destrucción y HP en orden, registra checkpoints y devuelve un resultado uniforme.

La causa raíz era la coexistencia de tres writers: daño simple, daño localizado y una función pública sobrescrita en `ready` con semántica distinta de la instalada en `init`.

## E. Legacy wrappers

`aplicarDanioAutorizado()` y `aplicarDanioLocalizadoAutorizado()` se conservan como wrappers `DEPRECATED` hacia la ruta canónica. Los sockets legacy son sólo transporte hacia Command Registry y ya no ejecutan writers directos.

## F. Damage receipt schema

El receipt persiste, según corresponda: `transactionId`, command/status, source/target/item UUIDs, dominio, raw damage, localización, HP before/after, armadura, durability before/after, Item destruido, checkpoints, resultado, timestamps y revisión del aggregate.

No almacena snapshots completos de Actor ni Item.

## G. Localized damage

La tabla vigente permanece intacta. La localización se prepara una vez dentro de la transacción o consume el resultado estable ya resuelto. El replay devuelve el receipt y no vuelve a tirar.

## H. Durability/Item destruction

Durability y destrucción forman parte de la misma transacción raíz. La destrucción usa el engine seguro existente y se registra antes de continuar a HP. No se recrean Items automáticamente ante ambigüedad.

## I. HP

HP continúa en Actor. Daño y restauración llevan `transactionId`; límites mínimos/máximos no cambiaron. Una restauración sin cambio devuelve `RESOURCE_AT_MAXIMUM`.

## J. MP

MP continúa en Actor. Costos congelados y reembolsos se conservan. Los receipts sustituyen a los mapas RAM como garantía durable; los mapas restantes sólo optimizan concurrencia local.

## K. Competence stack

MP y `mpStacks` se escriben juntos en un único update de Actor. El Básico asociado conserva su +1 fijo sin stack propio. Replay no cobra ni incrementa otra vez.

## L. Karma/Dharma

Acumulación y gasto usan transacciones de recursos. El cliente solicita al Primary GM; el handler valida GM/OWNER antes de mutar. Las reglas de críticos, pifias y cartas no cambiaron.

## M. Restaurar día

El reset acepta `transactionId`, elimina la clave completa de stacks como antes y es idempotente. No añade reglas de descanso.

## N. Multimode competence

`executionModes[]` define `modeId`, label y strategy. La selección se registra antes de la tirada mediante `resource.competence-mode-intent`. La infraestructura no depende del nombre del Item.

## O. Meditar

Los modos actuales son `RECOVER_MP` y `ASTRAL_PROJECTION`. Ambos comparten la tirada y el stack del Item. Recover restaura `2 × costo` con éxito `>= 6`; Astral sólo produce narrativa, consume MP normalmente y no crea estados, ActiveEffects, movimiento ni tokens.

Compatibilidad: Items antiguos con `effect: mpRecovery` reciben ambos modos sin migración masiva.

## P. Consumables

Restauración y descuento de una unidad conservan una sola operación lógica. Si falla el descuento, la restauración se revierte de forma segura. En recurso máximo no hay descuento. La Card se enlaza al resultado persistido y puede recrearse sin repetir mecánica.

El contrato sigue limitado a HP/MP, pero modela el efecto separadamente para permitir un futuro `effects[]` sin implementar buffs.

## Q. Non-combat receipts

Fuera de combate se usa el mismo `ReceiptStore` con `ActorRuntimeRepository` y `flags.mtrol.transactionRuntime`. Retención aprobada: primero expiran receipts mayores a 30 días y luego se conservan los 128 más recientes. Tamaño medido: aproximadamente 470 bytes para recursos y 943 bytes para daño completo antes de overhead de Foundry.

## R. Recovery

El Primary GM inspecciona receipts incompletos de Combat y Actor al iniciar. `applied` con resultado estable se completa; `processing`, `prepared` o `applying` ambiguos pasan a `recovery-required`. Un retry de daño reconcilia estados reales inequívocos. No se simula ACID ni se recrean Items destruidos a ciegas.

## S. Commands/Sockets

Comandos registrados: `damage.apply`, `resource.mp-spend`, `resource.mp-refund`, `resource.meditate`, `resource.dharma-spend`, `resource.destiny-adjust`, `resource.daily-reset`, `resource.competence-mode-intent` y `consumable.use`.

El resultado uniforme es `{ ok, transactionId, status, changed, result, reasonCode }`. Movement, Trade y Opposition no se migraron.

## T. Logger

Se reutiliza el logger existente con contexto resumido de transaction, target y before/after. No se registran Documents completos.

## U. Tests

Regresión automatizada final: 915 tests, 914 aprobados, 0 fallidos y 1 omitido intencionalmente. Incluye replay exactamente una vez, daño/armadura/HP, retención, API estable, multimodo sin nombre y unicidad de `nextTurn()`.

## V. Smoke test

Pendiente de ejecución/aprobación real 1 GM + 2 jugadores. La Fase 2 no se considera formalmente aprobada hasta completar el guion del prompt maestro.

## W. Riesgos restantes

- Foundry no ofrece atomicidad ACID multi-Document; una interrupción en una ventana ambigua se detiene en `recovery-required`.
- Los wrappers deprecated continúan por compatibilidad hasta Fase 6.
- Items antiguos de Meditar requieren `effect: mpRecovery` o metadata `executionModes` para activar el selector; no se usa el nombre como fallback.

## X. Nuevos P0

No se detectaron P0 nuevos fuera de alcance.

## Y. Fuera de alcance

No se modificaron reglas de movimiento, iniciativa, oposición, daño matemático, costos, comercio, ActiveEffects generales ni follow-up por clase. Continúa existiendo una sola llamada real a `combat.nextTurn()`.

## Z. Recomendación para Fase 3

Ejecutar primero el smoke real de Fase 2 y resolver cualquier receipt que llegue a `recovery-required`. Sólo después aprobar formalmente la fase y abrir la siguiente migración arquitectónica.

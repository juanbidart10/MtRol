# MTROL — Fase 1B: oposición por capabilities y dominios

## A. Baseline inicial

- Rama auditada: `refactor/combat-architecture`.
- Suite previa: 895 tests, 894 aprobados, 0 fallidos, 1 omitido.
- El baseline coincidió antes de modificar código.

## B. Archivos modificados por Fase 1B

- `models/competencia-model.js`
- `scripts/actions/action-engine.js`
- `scripts/actions/opposition-policy.js` (nuevo)
- `scripts/actors/class-registry.js`
- `scripts/items/shield-wear-engine.js`
- `scripts/runtime/opposition-commands.js`
- `scripts/runtime/recovery-coordinator.js`
- `scripts/sheets/actors/personaje-sheet.js`
- `scripts/sheets/items/competencia-sheet.js`
- `templates/items/competencia-sheet.html`
- `tests/opposition-policy-phase1b.test.mjs` (nuevo)
- `tests/opposed-damage-flow.test.mjs`
- `tests/runtime-foundation.test.mjs`
- `tests/shield-defense.test.mjs`

Los demás archivos modificados en el worktree pertenecen al Hotfix 1 y a la Fase 1 previos; no fueron revertidos ni separados artificialmente.

## C. Modelo final de actionType

La definición canónica de runtime usa `actionType` exclusivamente como identidad: `spell`, `competence`, `combat`, `special` o `basic`.

Durante la transición, el valor persistido histórico (`attack`, `defense`, `movement`, etc.) se conserva como `legacyActionType`/`actionBehavior` y alimenta únicamente el adaptador. `system.actionIdentity` permite configurar explícitamente la identidad sin mutar en masa los Items existentes. La categoría sirve como fuente mecánica estructurada para la identidad cuando el campo explícito no existe.

## D. Modelo final de capabilities

Capabilities admitidas:

- `OFFENSIVE`
- `DEFENSE`
- `DODGE`
- `COUNTERATTACK`
- `REACTION`
- `MOVEMENT`

Una acción puede declarar varias. La identidad no se duplica como capability y `MOVEMENT` por sí sola no habilita oposición.

## E. Modelo de domains

Los únicos dominios son `PHYSICAL` y `MAGICAL`. Se resuelven exclusivamente desde `actionDomain`, `responseDomain` o `damageType`; nunca desde nombre, imagen, descripción o clase.

Toda acción ofensiva enfrentada sin dominio resoluble se rechaza antes de crear `pendingAction`. El dominio atacante se persiste en `pendingAction.actionDomain` y no se recalcula al defender.

## F. Política de clase

La política vive en `class-registry.js`:

- `PHYSICAL` → contraataques `PHYSICAL`.
- `MAGICAL` → contraataques `MAGICAL`.
- `HYBRID` → contraataques `PHYSICAL`.

La capa de oposición consulta la policy y no contiene nombres concretos de clases.

## G. Hybrid behavior

Por definición aprobada, `alquimista`, `bardo` y `clerigo` son `HYBRID`. El resto del antiguo grupo `magicHybrid` es `MAGICAL`. Los perfiles de HP/MP siguen compartiendo `magicHybrid`, por lo que esta clasificación no modifica recursos.

La extensión futura se admite mediante `counterattackDomainOverrides` en la habilidad. No se implementó ninguna excepción del Clérigo despertado ni se mutó su policy.

## H. allowedResponses

Cada oposición persiste su snapshot `allowedResponses`. El default compatible es `DEFENSE`, `DODGE`, `COUNTERATTACK`; un Item puede restringirlo explícitamente. Recovery consume el snapshot persistido y nunca lo reconstruye desde el atacante.

## I. Algoritmo de elegibilidad

`evaluateOppositionResponseEligibility` centraliza:

1. existencia y estado de `pendingAction`;
2. coincidencia exacta del target;
3. Item de respuesta válido;
4. guard/cooldown vigente;
5. capability declarada y `REACTION` explícita;
6. inclusión en `allowedResponses`;
7. dominio coincidente para `COUNTERATTACK`;
8. policy de clase y overrides de habilidad;
9. respuesta estructurada con `valid`, `selectedCapability`, `reasonCode`, `humanReason` y metadata.

La Sheet usa el mismo evaluador para deshabilitar acciones incompatibles y mostrar el motivo. El Primary GM lo ejecuta otra vez de forma autoritativa.

## J. Legacy mapper

- `actionType=defense` → `DEFENSE + REACTION`.
- `defenseType/oppositionType=dodge` → `DODGE + REACTION`.
- un dodge legacy de categoría `hechizo` agrega `MOVEMENT` mediante metadata estructurada, sin inspeccionar el nombre.
- categoría `contraataque` → `OFFENSIVE + COUNTERATTACK + REACTION`.
- tipos ofensivos históricos → `OFFENSIVE`.

La derivación ocurre en memoria, no actualiza documentos y usa logging técnico de canal `OPPOSITION`.

## K. Esquiva Áurica

La configuración declarativa soportada es:

- identidad `spell`;
- capabilities `DODGE`, `REACTION`, `MOVEMENT`;
- preset `DODGE`.

Es válida contra ambos dominios. Toda acción `DODGE + REACTION` se bloquea fuera de una oposición activa, de modo que no se convierte en movilidad genérica.

## L. Reaction movement

Sólo una respuesta cuyo `selectedCapability` persistido sea `DODGE` y que gane la oposición obtiene `reactionMovement.allowance = 1`. Si pierde, no se crea autorización. El consumo continúa exclusivamente por `getAvailableMovement()` y su fuente `REACTION`; no se añadieron bypasses.

## M. Recovery

La selección se declara mediante el command idempotente `opposition.declare-response` antes de tirar. Se persisten `itemUuid`, `itemId`, identidad, capability, dominio, modo, capabilities y transactionId. La fórmula no se congela.

Tras F5 o cambio de Primary GM, Runtime Foundation hidrata la misma `pendingAction` y conserva el snapshot. Al tirar se revalida que el Item existe, coincide y sigue siendo utilizable, sin permitir cambiar la intención declarada.

## N. Receipts

Los rechazos de elegibilidad que alcanzan Command Registry regresan un resultado mecánico estable (`rejected`, `reasonCode`, `humanReason`) y completan el receipt. Un retry con el mismo transactionId reproduce el mismo resultado sin volver a evaluar ni gastar recursos.

ReceiptStore no fue rediseñado.

## O. UI

La Item Sheet permite configurar identidad, capabilities, dominios, respuestas admitidas y preset. Durante una oposición, las acciones incompatibles permanecen visibles pero deshabilitadas con `humanReason`. La UI orienta; el Primary GM siempre revalida.

## P. Tests nuevos

Se cubren:

- matrices física/mágica/familias;
- híbridos;
- DODGE y DEFENSE transversales;
- contraataques y overrides futuros;
- `libre` no wildcard;
- mapper legacy sin mutación;
- Esquiva Áurica multi-capability;
- preset sin selector;
- target/estado/guard;
- falta de dominio;
- declaración antes de tirar y recovery;
- Esquiva ganadora/perdedora;
- rechazo idempotente con receipt;
- regresiones de daño, escudo y movimiento.

## Q. Regresión global

Resultado final: 909 tests, 908 aprobados, 0 fallidos y 1 omitido intencionalmente. La suite aumentó en 14 casos desde el baseline inicial y permaneció completamente verde.

## R. Smoke test 1 GM + 2 players

**Aprobado por confirmación del usuario el 28 de agosto de 2026.** El guion validado cubre:

1. físico vs físico: DEFENSE, DODGE y contraataque físico;
2. mágico vs físico: DODGE/DEFENSE válidos, contraataque físico rechazado;
3. físico vs mágico: DODGE/DEFENSE válidos, contraataque mágico rechazado;
4. mágico vs mágico: contraataque mágico válido;
5. híbrido: físico válido, mágico inválido;
6. Esquiva Áurica contra ambos dominios y movimiento REACTION sólo al ganar;
7. F5 del GM en `waiting-defense`;
8. F5 después de declarar y antes de tirar;
9. doble click/retry del mismo command.

## S. Warnings observados

- El test intencional de fórmula inválida conserva su log esperado.
- Git informa normalización LF/CRLF; no es un fallo funcional.
- Las acciones ofensivas enfrentadas legacy sin dominio ahora muestran error de configuración deliberado, sin fallback ambiguo.

## T. P0 nuevos

No se detectaron P0 nuevos durante la implementación automatizada.

## U. Cambios expresamente no realizados

- No se reescribieron oposición, daño, iniciativa, costos, cooldowns ni fórmulas.
- No se modificó ReceiptStore.
- No se creó API V2 ni runtime paralelo.
- No se migraron Items del mundo.
- No se implementó la excepción futura del Clérigo.
- No se añadieron dominios, bypasses de movimiento ni llamadas a `nextTurn()`.
- `mtrol.zip` no se tocó.

## V. Estado final de aprobación de Fase 1

La Fase 1B queda técnica y operativamente aprobada, incluida la confirmación del smoke test real de 1 GM + 2 players.

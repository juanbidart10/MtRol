# MTROL — Fase 3: movimiento transaccional

Estado: **infraestructura técnica y regresión automatizada completas; aprobación formal pendiente del smoke real 1 GM + 2 jugadores a cargo del usuario**.

## A. Baseline inicial

- Rama verificada: `refactor/combat-architecture`.
- Suite inicial heredada de Fase 2: 915 tests; 914 pass; 0 fail; 1 skip.
- Fase 2 estaba automatizada y estable.
- Existía y continúa existiendo una sola llamada runtime real a `combat.nextTurn()`, en `scripts/combat/turn-system.js`.
- El worktree ya contenía cambios acumulados de fases anteriores; no se realizaron commits ni se tocó `mtrol.zip`.

## B. Arquitectura previa

`preUpdateToken` calculaba y reservaba localmente el costo, Foundry persistía X/Y y `updateToken` enviaba después otro pedido para consumir movimiento. La posición del Token y el estado mecánico eran dos commits separados. Las reservas en RAM ayudaban a la UX, pero no podían reconstruir una operación tras F5 o cambio de GM.

## C. Causa raíz

No existía una identidad durable que uniera intención, posición y consumo. Un socket perdido podía dejar el Token en `to` con movimiento sin consumir; una interrupción inversa podía dejar consumo aplicado con el Token en `from`. Los sockets también conservaban handlers directos capaces de evitar la infraestructura transaccional.

## D. Movement transaction model

Se incorporó `MovementService`, apoyado en el runtime existente. Cada receipt `movement.commit` persiste:

- `transactionId`, `combatId`, `combatantId`, `actorUuid`, `tokenUuid`;
- `source`, `from`, `to`, `measuredDistance`;
- `movementBefore`, `movementAfter` dentro de `prepared`;
- estado, checkpoints, timestamps y revisión del aggregate runtime.

No se guarda un snapshot completo del Token.

## E. Movement sources

Fuentes regladas: `TURN`, `ATTRIBUTE`, `GRANTED`, `REACTION`. El contrato declara además `GM_BYPASS`, `SYSTEM_MOVE` y `SYSTEM_TELEPORT`, pero las dos fuentes de sistema no están habilitadas sin consumidores explícitos. El origen nunca se infiere por nombre, turno o usuario.

## F. Command Registry

Los sockets existentes de commit se adaptaron a `movement.commit`; la renuncia de GRANTED usa `movement.renounce`. No se creó un socket nuevo. Los handlers de reglas duplicados fueron retirados del switch de transporte.

## G. TransactionCoordinator integration

MovementService reutiliza el `TransactionCoordinator`, `ReceiptStore`, `RuntimeRepository` y el scope del Combat existentes. No se creó coordinador, store, registry ni runtime paralelo.

## H. Revision e idempotencia

El aggregate `Combat.flags.mtrol.runtime` mantiene su revisión monotónica y retries acotados. Un mismo `transactionId` devuelve el resultado persistido y no repite consumo, posición ni avance. Los eventos del hook GM y el retry de socket convergen sobre el mismo receipt. Transacciones distintas que compiten por la misma reserva lógica se serializan dentro del `TransactionCoordinator` mediante una clave de aggregate; no se agregó un coordinador ni un lock persistente paralelo.

## I. Token update flow

La integración elegida es el fallback aprobado para Foundry:

1. `preUpdateToken` detecta, bloquea provisionalmente y adjunta intención tipada.
2. Foundry aplica X/Y.
3. El `updateToken` observado por Primary GM procesa el metadata durable aunque el jugador cierre antes de enviar el socket.
4. El socket del jugador actúa como retry idempotente.
5. Primary GM relee documentos, valida Combat/ronda/turno/Combatant o concesión/reacción, recalcula distancia en grid cuadrada y confirma o revierte.

Los updates internos de rollback/reconciliation llevan `mtrolMovementInternal`, operación y transaction ID; sólo un contexto emitido por GM puede saltar el guard.

## J. TURN

Sigue consumiendo `baseMovementRemaining + extraMovementRemaining` mediante los helpers y el `turnState` actuales. Mantiene movimiento parcial y agotamiento sin cambiar fórmulas.

## K. ATTRIBUTE

Permanece en `turnState`, tipado como `ATTRIBUTE`. Sólo Destreza, Fuerza, Aura y Suerte conceden `floor(finalResult / 10)`. El servicio no contiene clases hardcodeadas.

## L. GRANTED

Continúa en el flag canónico vigente y no modifica `Combat.turn` ni el futuro `turnState` del target. Commit parcial, agotamiento y renuncia usan receipts. El modelo transaccional se identifica por `movementId`/target y no introduce una restricción adicional para una futura colección de múltiples grants; la regla actual continúa generando una concesión vigente por acción.

## M. REACTION

Continúa perteneciendo a `pendingAction.reactionMovement`. El commit de posición se transaccionalizó sin modificar oposición. La renuncia ya usa el comando idempotente `opposition.reaction-complete` de Fase 1B. No consume TURN ni GRANTED.

## N. GM bypass

Se preservó intacto: un movimiento administrativo del GM no genera metadata de movimiento reglado, no consume estado, no ensucia el Tracker y no produce warning. Un GM secundario no puede confirmar ni recuperar transacciones.

## O. Reservations

Las reservas locales siguen siendo sólo cache optimista. Se limpian tras commit/rechazo/error, cambios autoritativos, fin de Combat y recovery. Se agregó prueba de reserva zombie tras F5.

## P. Rollback

Si la validación autoritativa falla después de aplicar X/Y, Primary GM devuelve el Token al `from` declarado y validado. El update lleva contexto interno y no reingresa como intención. El movimiento mecánico permanece intacto. Los errores anteriores a la creación del receipt —incluida una grid no soportada— también ejecutan rollback. Un segundo evento sobre una posición ya confirmada por otro receipt completado no revierte ese commit válido.

## Q. Reconciliation

La matriz implementada distingue:

- posición en `to`, consumo en `before`: completa consumo;
- posición en `from`, consumo en `after`: completa posición;
- ambos aplicados: completa receipt sin repetir efectos;
- ninguno aplicado: completa posición y consumo;
- combinación no demostrable: `recovery-required`, sin mutación automática.

## R. Recovery

En `ready`, sólo Primary GM relee receipts incompletos y reconstruye desde datos persistidos. El mismo recovery específico de movimiento se ejecuta cuando cambia la autoridad activa, sin exigir F5 al nuevo Primary GM. Recupera commits y renuncias sin depender de promises o reservas del proceso anterior. Los casos ambiguos quedan persistidos, se registran y generan una única alerta al GM mediante IDs notificados en runtime.

## S. Follow-up

No se cambió la policy. Sólo ATTRIBUTE consulta `class-registry.js`; follow-up se evalúa después del consumo/posición confirmados por el adapter canónico. TURN, hechizo/autobuff, GRANTED, REACTION y Orbes no lo habilitan.

## T. Turn advance

MovementService nunca llama `combat.nextTurn()`. Consume adapters de dominio que convergen en `advanceCurrentTurnOnce`; sigue existiendo una única llamada runtime. Renuncia y replay demostraron exactly-one advance.

## U. Logger

Se reutiliza el logger existente en canal `MOVEMENT`, con transaction ID, Token, source, from/to, distancia y error/resultado. No se registran Documents completos.

## V. Tests nuevos

`tests/phase3-movement-transactions.test.mjs` cubre 16 escenarios focalizados:

- commit TURN y replay;
- cierre del jugador antes del socket;
- rechazo adulterado y rollback;
- rechazo y rollback sobre grid no soportada antes de crear receipt;
- rechazo de metadata de turno obsoleta;
- los cinco estados position/consumption;
- alerta recovery sin spam;
- renuncia GRANTED duplicada;
- fuentes ATTRIBUTE/GRANTED/REACTION;
- autoridad Primary GM;
- transacciones secuenciales distintas;
- transacciones concurrentes distintas serializadas por aggregate, sin doble consumo ni rollback del commit válido;
- cleanup de reserva zombie.

`tests/runtime-foundation.test.mjs` verifica además que el schema runtime inicializa explícitamente la metadata de recovery de movimiento.

Las suites existentes mantienen cobertura de parcial/agotar/overmove, atributos y `floor`, follow-up físico, magia/híbridos, Esquiva, futuro turnState, GM bypass, warnings y exactly-one advance.

## W. Regresión global

- Suite final: 932 tests.
- Pass: 931.
- Fail: 0.
- Skip intencional preexistente: 1.
- Syntax check de todos los módulos modificados: correcto.
- `git diff --check`: sin errores; sólo avisos de normalización LF/CRLF del entorno Windows.
- Llamadas runtime reales a `combat.nextTurn()`: 1.

## X. Smoke test

Pendiente y asumido manualmente por el usuario. Durante la preparación se verificó:

- Foundry Virtual Tabletop v14 Build 365;
- mundo activo `Mt rol Dev`;
- sistema MTROL cargado;
- sesión Gamemaster conectada;
- usuarios jugadores `Lerathiel` y `test` disponibles;
- acceso de ambos jugadores protegido por contraseña.

La ejecución A–J no forma parte de la automatización restante: el usuario indicó expresamente que realizará el smoke. Debe cubrir TURN, ATTRIBUTE, mágico/híbrido, GRANTED parcial/agotar/renunciar, REACTION, overmove, doble input, F5, logs y avance único sobre grid cuadrada. La fase no se declara formalmente aprobada hasta recibir ese resultado.

## Y. Riesgos restantes

- Foundry no ofrece aquí una preautorización asíncrona limpia sin alterar drag/drop; se usó el fallback post-update con confirmación desde el hook del Primary GM, receipt y rollback/reconciliation.
- El smoke real es la única validación pendiente para confirmar propagación de metadata de `updateToken`, latencia visual y cambio de Primary GM en una sesión multicliente real.
- Un estado físicamente ambiguo se detiene deliberadamente en `recovery-required`; no se adivina una corrección.

## Z. Próxima fase recomendada

Ejecutar y documentar primero el smoke real A–J. Con su aprobación, continuar con la siguiente fase arquitectónica sin limpiar masivamente adapters legacy antes de la Fase 6.

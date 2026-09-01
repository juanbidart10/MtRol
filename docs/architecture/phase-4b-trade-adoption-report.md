# MTROL — Fase 4B: Trade Adoption

Fecha: 2026-08-29  
Rama: `refactor/combat-architecture`  
Estado técnico automatizado: verde  
Estado de aprobación formal: pendiente del smoke real de 1 GM + 2 jugadores

## A. Baseline

- Suite inicial: 943 tests; 942 pass; 0 fail; 1 skip intencional.
- Tests Trade iniciales: 16 archivos.
- Worktree: ya contenía los cambios acumulados de Fases 1–4A; se preservaron.
- `main`: no fue modificada.
- `mtrol.zip`: no fue modificado; permanece fuera del alcance del trabajo.

## B. Arquitectura Trade previa

Trade ya tenía un dominio funcional maduro: sesiones, ofertas, confirmaciones, proximidad, movement locks, transferencias, auditoría y vistas diferenciadas para participantes/GM. Sin embargo, la continuidad dependía de instancias en memoria y varios comandos llegaban directamente desde sockets a handlers autoritativos.

| Concern | Source of Truth previa | RAM-only | Persistente | Recovery | Riesgo principal |
|---|---|---:|---:|---:|---|
| Sesiones activas | `TradeSessionStore.sessions` | Sí | No | No | F5 perdía la sesión |
| Actor ocupado | `activeSessionByActorUuid` | Sí | No | No | doble sesión tras reload |
| Reservas | `reservationsByItemUuid` | Sí | No | No | consumo/transferencia concurrente |
| Command receipts | `operationReceipts` | Sí | No | No | doble click/socket repetía intención |
| Commit receipts | `TradeTransferCoordinator.receipts` | Sí | No | Parcial | dupe tras interrupción |
| Exclusión commit | `inFlight` Map | Sí | No | No | handoff/F5 perdía lock |
| Movement locks | `TradeMovementLocks` | Sí | No | Reconstrucción limitada | locks zombie o ausentes |
| History | Journal dedicado | No | Sí | N/A | pruning automático a 500 |
| Authority | Primary GM local | Parcial | Epoch no adoptado por Trade | Invalidaba todo | pérdida de continuidad |

## C. Riesgos RAM-only encontrados

- F5 y cambio de Primary GM eliminaban la garantía de una sesión por Actor.
- Las reservas desaparecían aunque la UI aún representara una oferta.
- El receipt de transferencia no sobrevivía a una interrupción.
- Un commit parcial podía repetirse sin checkpoints persistentes.
- El handoff invalidaba sesiones sanas en vez de adoptarlas.
- El historial tenía una retención arbitraria incompatible con el contrato nuevo.

## D. Source of Truth elegida

Existe un único agregado canónico world-scoped: el setting oculto `mtrol.tradeRuntime`. Ningún Actor aloja el estado global y no se duplicó la sesión en los participantes. El índice Actor → Trade y las reservas se derivan al hidratar el agregado.

## E. Persistencia

`TradeRuntimeRepository` administra un schema versionado con inicialización lazy, revisión monotónica, cola de mutaciones y retry acotado ante conflicto. El agregado contiene sesiones activas, receipts de operación/commit, metadata de authority y recovery. Los registros históricos permanecen separados en el Journal de auditoría existente.

## F. Trade Aggregate

Cada sesión persiste `schemaVersion`, `id/tradeId`, `revision`, estado, timestamps, participantes, ofertas, confirmaciones, pausa, ejecución y recovery. Las reservas incluyen Trade, participante, Actor, Item, cantidad y revisión. No se persisten Documents completos ni inventarios redundantes.

## G. State Machine

Estados activos: `REQUESTED`, `NEGOTIATING`, `READY`, `EXECUTING`, `PAUSED`, `RECOVERY_REQUIRED`.

Estados terminales: `COMPLETED`, `CANCELLED`, `INVALID`.

Transiciones relevantes:

- `REQUESTED → NEGOTIATING` al aceptar.
- `NEGOTIATING ↔ READY` según confirmaciones de la revisión vigente.
- `NEGOTIATING|READY → PAUSED → estado previo válido` por GM.
- `READY → EXECUTING → COMPLETED` para commit normal.
- `EXECUTING → RECOVERY_REQUIRED` cuando no puede probarse rollback/continuación.
- Estados activos cancelables → `CANCELLED`, salvo commit en progreso.
- Divergencia externa segura → `INVALID` según la política existente.

Las ofertas quedan congeladas durante `EXECUTING`, `PAUSED` y `RECOVERY_REQUIRED`.

## H. Authority

Trade adopta `AuthorityService` y sólo el Primary GM autoriza comandos y mutaciones. La identidad se toma del contexto de transporte, no del payload. En ready, el Primary GM hidrata el agregado, adopta el epoch vigente, reconstruye caches/locks y publica las sesiones.

## I. Commands

Los intents existentes convergen en el `CommandRegistry` compartido:

- `trade.create`
- `trade.accept`
- `trade.offer-set`
- `trade.confirm`
- `trade.cancel`
- `trade.gm-cancel`
- `trade.pause`
- `trade.resume`

Todos usan scope world, `transactionId` estable y el `ReceiptStore` existente mediante un scope genérico. El resultado conserva compatibilidad con `session` y expone el contrato uniforme `ok`, `transactionId`, `status`, `changed`, `result` y `reasonCode`.

## J. Socket migration

Los sockets son adapters: traducen la acción legacy a comando, delegan al registry y responden. Se retiraron las ramas de dominio directas. Los mensajes de sync sólo se aceptan si provienen del Primary GM actual.

## K. UI adaptation

La UI continúa presentando inventario propio, oferta propia y oferta pública rival. Envía intents con `operationId` y revisión; no reserva ni transfiere Items. El monitor GM incorporó pausa/reanudación sin capacidad de editar ofertas.

## L. Reservations

Las reservas se reconstruyen desde las ofertas persistidas y se validan autoritativamente. Un boundary desacoplado expone cantidad reservada y disponibilidad efectiva a otros dominios. Consumibles y mutations de Item consultan ese boundary.

## M. Partial stack reservations

La reserva es por cantidad. Para un stack 10 con oferta 3, la disponibilidad efectiva es 7. Reducir el stack por debajo de la reserva, borrarlo o equiparlo se rechaza fuera de una mutación identificada de commit/rollback Trade. Una divergencia que el hook posterior detecta invalida la sesión; nunca reajusta la oferta silenciosamente.

## N. Money Items

El dinero conserva su modelo de Item stackeable. No se agregó wallet ni ledger paralelo.

## O. Confirmations

Las confirmaciones forman parte de la sesión persistida y están ligadas a una revisión. Una mutación real de oferta incrementa la revisión e invalida ambas. Un command stale se rechaza. Al confirmar ambos lados, `READY` usa un execution id estable derivado de Trade + revisión.

## P. Exactly-once commit

El commit material usa un único transaction id estable. Retries, doble click y entrega duplicada reproducen el receipt persistido. Los Items destino llevan metadata `flags.mtrol.tradeTransfer` con execution, Trade y entry key, lo que permite reconocer créditos ya aplicados incluso si se perdió memoria de proceso.

## Q. TransactionCoordinator

`TradeTransferCoordinator` quedó sólo como facade de dominio compatible. Ya no mantiene Maps, receipts ni primitive de exclusión propios: delega en el `TransactionCoordinator` compartido y en su `ReceiptStore` mediante el scope world de Trade.

## R. Partial failure

El plan serializado contiene checkpoints por entrada para créditos y débitos. La reconciliación relee Actors/Items, flags, cantidades y checkpoints:

- completa una operación faltante cuando el progreso es demostrable;
- evita repetir una operación ya aplicada;
- acepta rollback sólo cuando fue ejecutado y probado;
- conserva `recovery-required` ante ambigüedad.

Se cubrió automáticamente el caso F5 mid-commit con crédito destino aplicado, débito origen faltante y rollback fallido: recovery aplica únicamente el débito faltante.

## S. Recovery

Al iniciar, sólo `EXECUTING` y `RECOVERY_REQUIRED` se reconcilian automáticamente. Una sesión `READY` persistida se conserva y queda señalada para revisión GM; no se dispara un commit nuevo sin una ejecución previamente iniciada. Esta decisión evita transferencias consecuenciales causadas únicamente por startup. Los resultados se persisten en `tradeRuntime.recovery` y usan logging estructurado.

## T. GM Auditor

El monitor conserva inventarios y ofertas de ambos lados, estado, confirmaciones, reservas y participantes. Sigue siendo exclusivo de GM y read-only respecto de las ofertas.

## U. Pause/Resume/Cancel

Pause persiste el estado previo, bloquea oferta/confirmación/commit y conserva reservas. Resume restaura `NEGOTIATING` o `READY`. Cancel de jugador y GM es idempotente, no transfiere, libera reservas/locks, publica el terminal y escribe historial. GM puede cancelar una sesión pausada.

## V. Disconnect

Se mantuvo la regla vigente: la desconexión de un participante cancela autoritativamente la sesión. El operation id estable por Trade/usuario/revisión hace el lifecycle idempotente; se liberan reservas y movement locks y se registra `participant-disconnected`.

## W. F5

La hidratación reconstruye sesiones, índice Actor → Trade, reservas, receipts y metadata de pausa/ejecución. Los movement locks, que siguen siendo cache operativo, se reconstruyen desde la sesión persistida y ya no son garantía primaria de integridad.

## X. Primary GM handoff

El nuevo Primary GM adopta las sesiones activas y un nuevo authority epoch; ya no las invalida. Reconstruye estado local y ejecuta recovery sobre commits realmente iniciados sin depender del GM anterior.

## Y. History

History permanece separado del runtime activo. Los terminales incluyen schema, Trade, participantes, snapshots finales de ofertas, cantidades/dinero como Items, timestamps, confirmaciones, pause/cancel, estado final, transaction id y recovery/reason code cuando aplica.

## Z. Pruning-ready design

Se eliminó el límite automático de 500. `TradeAuditService.prune(policy, {apply:false})` permite previsualizar políticas por antigüedad, máximo, estado o combinación. No se ejecuta ninguna política automáticamente.

## AA. Tests nuevos

Se agregó `phase4b-trade-adoption.test.mjs` con 8 escenarios:

1. revisión world-scoped y replay de receipts;
2. hidratación F5 de sesión, índice, oferta y reserva;
3. carrera de create con un Actor compartido;
4. reserva parcial y disponibilidad restante;
5. rechazo de stale revision;
6. pausa persistente, bloqueo y resume;
7. history indefinida y prune preview;
8. recovery de commit parcial sin dupe.

La suite Trade/runtime focalizada quedó en 303/303.

## AB. Regresión global

Resultado final: 81 archivos, 951 tests, 950 pass, 0 fail, 1 skip intencional. La diferencia contra baseline son los 8 tests nuevos. Se verificó un único uso de `combat.nextTurn()` en runtime.

## AC. Smoke real

No ejecutado por Codex, por indicación del usuario. Permanece pendiente el smoke de 1 GM + 2 jugadores (casos A–M del prompt). Por lo tanto la implementación está completa a nivel automatizado, pero la aprobación formal de Fase 4B depende de ese resultado.

## AD. Performance observations

- No hay polling de Trade.
- Una mutación lógica de sesión produce una escritura serializada del agregado y una publicación por cambio real.
- History sólo escribe eventos relevantes/terminales.
- El commit usa checkpoints por entrada y sólo toca Documents pendientes.
- Conteo global estático tras Fase 4B: 46 registros `Hooks.on`, 7 emisiones socket, 69 referencias API `game.mtrol` y 1 `nextTurn()`.
- El setting serializa el agregado activo completo; es aceptable para el volumen actual. Si el volumen simultáneo creciera materialmente, convendría medir tamaño/latencia antes de cambiar storage.

## AE. Riesgos restantes

- Foundry real debe confirmar sincronización del setting world y re-render bajo 1 GM + 2 jugadores.
- La reproducción manual de F5 exactamente durante un commit sigue siendo difícil; está cubierta por test inyectado.
- `READY` recuperado requiere revisión GM deliberada; no se autoejecuta en startup.
- Un setting world es adecuado para el volumen previsto, pero no debe asumirse escalabilidad ilimitada.

## AF. Legacy restante

- Se preservan nombres de acciones socket legacy como capa de compatibilidad.
- `TradeTransferCoordinator` conserva su nombre/API como facade, sin primitives paralelas.
- `TradeMovementLocks` permanece como cache de UX/guard reconstruible; la integridad depende del agregado, revisión, reservas y receipts.
- La remoción definitiva de wrappers legacy queda para Fase 6.

## AG. Próxima fase

1. Ejecutar y registrar el smoke A–M.
2. Si queda verde, aprobar formalmente Fase 4B.
3. En Fase 6, retirar adapters legacy ya sin consumidores y evaluar métricas del setting world antes de cualquier cambio de almacenamiento.


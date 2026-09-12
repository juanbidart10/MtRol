# G0 Safety Audit — Ground Items / Trade Cross-Domain Exclusion

## 1. Executive summary

El sistema actual **no puede garantizar exclusión Ground ↔ Trade** sin un cambio adicional. La carrera fue reproducida: con cantidad real 1, una reserva `ground-test` queda `RESERVED` en `SharedReservationLedger` y una oferta Trade reserva simultáneamente la misma unidad en `session.reservations`.

La causa precisa es que `TradeSessionStore.setOffer` consulta únicamente `reservationsByItem`; `TradeReservationBoundary`, que sí suma el ledger global, no participa en esa ruta. La cola de `TradeSessionStore` y la cola del repositorio serializan escrituras locales, pero no convierten las dos decisiones de capacidad en una operación común.

Decisión: **OPTION A — TRADE MIGRATION REQUIRED**. Una frontera menor sólo sería equivalente si todas las creaciones y revisiones de ofertas Trade pasaran por ella y la reserva Trade quedara registrada en la misma autoridad persistente. Eso ya constituye la migración del write/read path de reservas, aunque no exige refactorizar el resto del lifecycle o UI Trade.

¿La migración completa de Trade es necesaria para Ground Items? **YES para el lifecycle autoritativo de reservas; NO para el resto de Trade.**

## 2. Inventory mutation map

| Dominio / entrada | Authority | Reservation check | Coordinator | Write | Verificación / recovery |
|---|---|---|---|---|---|
| Trade socket `setOffer` → `TradeSessionStore.setOffer` | Primary GM/socket en `trade-authority` | Sólo índice Trade RAM | `mutationQueue` + `TradeRuntimeRepository.queue` | setting world `tradeRuntime.sessions` | rollback RAM ante fallo de persistencia; receipts de command |
| Trade commit → `TradeTransferCoordinator.executePlan` | Primary GM y autoridad de sesión | `session.reservations` en `prepareTradeTransferPlan` | `TransactionCoordinator` | create destino; delete/update origen | checkpoints, verificación, rollback dirigido, recovery |
| Equipment `equiparObjeto` / `desequiparObjeto` | GM u OWNER | Hook global bloquea `system.equipado=true` si reservado | Transición propia, sin TransactionCoordinator | Actor equipment y flags Item | rollback best-effort; log recovery-required si incompleto |
| Destrucción `destroyEquippedItem` | caller; sin control propio explícito | `preDeleteItem` global salvo bypass Trade | Map local por Actor+Item | limpia slots y elimina Item | no receipt durable; resultado idempotente local |
| Consumable `useConsumableAuthoritative` | Primary GM/socket y ownership | `assertTradeQuantityAvailable` antes de update | TransactionCoordinator/actor receipts | `Item.update(system.cantidad)` | verificación y receipt; hay ventana entre check y write |
| PersonajeSheet create/import/delete | GM explícito | delete atraviesa hook; create no requiere capacidad | ninguno | create/item.delete | sin receipt durable |
| Combat damage / shield wear | flujo autoritativo del combate | hook de reservas al actualizar Item; bypass sólo si opción Trade | coordinadores del dominio según ruta | defensa/durabilidad/Actor equipment | receipts de combate donde aplica |
| ObjetoSheet | GM para system; Player sólo imagen | hook para cantidad/equipado | ninguno | Item sheet update | sin receipt durable |
| Item Piles sanitization | GM | sólo elimina competencias, no inventario `objeto` | ninguno | delete embedded | log, sin reservation/recovery |
| APIs directas Foundry / GM | permisos Foundry | hooks preUpdate/preDelete registrados globalmente | ninguno | Document API | los guards cubren update/delete, no una transacción multi-documento |

Los hooks globales cubren `preUpdateItem` y `preDeleteItem`, pero no serializan el check con la escritura ni protegen una decisión de reserva futura. Los bypass `mtrolTradeExecutionId`/`mtrolTradeRollback` son opciones internas sin validación criptográfica o vínculo comprobado a un receipt en el hook.

## 3. Trade reservation lifecycle real

1. `setOffer` corre en `TradeSessionStore.mutationQueue`.
2. Lee cantidad real con `resolveRealQuantity` y reservas Trade desde `reservationsByItem`.
3. Modifica `session.offers` y `#rebuildSessionReservations`; allí nacen `session.reservations` y el índice RAM.
4. `#runIdempotent` llama `#persistRuntime`, que persiste sesiones/receipts/authority mediante `TradeRuntimeRepository.mutate`.
5. Reload ejecuta `hydrateRuntime` y reconstruye el índice desde las sesiones persistidas.
6. `beginExecution` conserva la reserva porque `EXECUTING` sigue activo. `RECOVERY_REQUIRED` también permanece activo.
7. `completeSession`, cancelación e invalidación llaman `#finishSession/#releaseSessionResources` y eliminan la reserva.
8. Handoff actual puede invalidar/adoptar sesiones; no convierte la reserva en ledger ni aporta fencing server-side.

El punto exacto de competencia es el `await resolveRealQuantity/getAvailability` de `setOffer`, antes de `#rebuildSessionReservations` y antes de entrar a la cola del repositorio.

## 4. SharedLedger lifecycle real

`reserve` ejecuta check de cantidad real, suma de estados activos y creación del registro dentro de `SharedReservationLedger.#mutate`. Con repositorio, éste usa `TradeRuntimeRepository.mutate`; los estados activos son `RESERVED`, `COMMITTING` y `RECOVERY_REQUIRED`. Las transiciones terminales retienen el registro y su evidencia. Reload reconstruye exclusivamente desde `runtime.reservations`.

Garantías acreditadas:

- En una instancia de ledger/repository: serialización local y durable de sus llamadas.
- En el mismo Primary GM y singleton: las operaciones que realmente usan ese repositorio comparten su cola.
- Persistencia: registros y revisiones sobreviven reload.

No acreditado:

- Exclusión entre dos instancias/clients: las colas son RAM por instancia.
- Compare-and-set atómico server-side: `game.settings.get` + `set` no lo proporciona.
- Rechazo server-side de un writer obsoleto después de revalidación local.

## 5. TOCTOU findings

| Severidad | Secuencia | Resultado |
|---|---|---|
| P0 | Trade lee cantidad/índice → Ground reserva ledger → Trade crea `session.reservations` | doble compromiso de la última unidad, reproducido |
| P0 | Ground lee cantidad/ledger → Trade crea reserva local → Ground persiste | doble compromiso inverso posible |
| P1 | Consumable consulta boundary → await/update Item | reserva puede aparecer entre check y write |
| P1 | Hook lee reservas → Foundry aplica update/delete | no existe lock server-side entre hook y write |
| P1 | Dos clientes con repositorios distintos leen misma revisión → ambos llaman setting set | revisión optimista no es CAS server-side |
| P2 | Equipment actualiza Actor y luego flags Item | rollback puede quedar incompleto; ya se registra como recovery-required |

## 6. Race reproduction

`tests/g0-cross-domain-safety-audit.test.mjs` etiqueta explícitamente `CHARACTERIZATION / KNOWN GAP`. La secuencia reproducida es:

1. Trade inicia oferta y lee cantidad real 1.
2. Se pausa antes de crear su reserva.
3. `ground-test` reserva 1 en el ledger y persiste.
4. Trade continúa, no consulta el ledger y persiste la sesión.
5. Resultado: ledger 1 + Trade 1 sobre real 1.

## 7. Alternatives

### A — Migrar reservas Trade al ledger

Cambiar `setOffer`, revisión, begin execution, recovery, commit, rollback y release para que el ledger sea autoridad; derivar `session.reservations` para UI/compatibilidad. Afecta `trade-session-service`, `trade-transfer-service`, `trade-authority`, lifecycle, hydration y tests. Riesgo de implementación alto, riesgo runtime residual bajo dentro del Primary GM local. Es la única opción que elimina la doble autoridad.

### B — Frontera mínima común

Sólo funciona si Trade crea/modifica su compromiso dentro de la misma mutación canónica usada por Ground y ninguna ruta puede tocar capacidad fuera de ella. Como `session.reservations` se modifica hoy dentro de `setOffer` y reload la reconstruye, una frontera que deje esa autoridad intacta no puede abarcar atomicamente ambos stores. Convertir esa frontera en autoridad equivale a migrar los write/read paths de reservas y converge con A.

### C — Exclusión mutua conservadora

Bloquear Ground ante cualquier Trade de Actor/Item y Trade ante cualquier reserva Ground reduce casos, pero ambos checks siguen separados por `await` y colas diferentes. Actor-level disminuye frecuencia, no cierra TOCTOU. Sólo sería segura con un lock común durable, que vuelve a ser una autoridad canónica.

No se identificó una opción D más simple con las mismas garantías.

## 8. Blast-radius matrix

| Riesgo | A impl. | A residual | B impl. | B residual | C impl. | C residual |
|---|---:|---:|---:|---:|---:|---:|
| Pérdida/duplicación/cantidad | HIGH | MEDIUM | MEDIUM | CRITICAL si queda ruta paralela | LOW | HIGH |
| Regresión Trade | HIGH | LOW | MEDIUM | HIGH | LOW | MEDIUM |
| Equipment/Consumable | MEDIUM | MEDIUM | MEDIUM | HIGH | LOW | HIGH |
| Reload/recovery/handoff | HIGH | MEDIUM | HIGH | HIGH | MEDIUM | HIGH |
| Synthetic Actor/legacy worlds | HIGH | MEDIUM | HIGH | HIGH | MEDIUM | HIGH |
| Item Piles | MEDIUM | MEDIUM | MEDIUM | HIGH | LOW | HIGH |
| Mantenimiento futuro | MEDIUM | LOW | HIGH | HIGH | MEDIUM | HIGH |

## 9. Failure-mode matrix for recommendation A

| Falla | Estado seguro esperado | Garantía actual | Gap |
|---|---|---|---|
| Crash antes de reserva | sin reserva/efecto | sí | ninguno |
| Crash después de reserva | `RESERVED` durable | ledger sí; Trade no | migrar Trade |
| Crash después de débito | reserva conservada + recovery | receipts Trade parciales | vincular ledger/checkpoints |
| ACK perdido | retry idempotente, no release | receipts ayudan; sesión puede persistir | ledger lifecycle común |
| Handoff | writer viejo no produce nuevos efectos | fencing local mitigado | ventana server-side permanece |
| Player disconnect | no liberar operación ambigua | Trade cancela sesiones no EXECUTING | mapear ledger según evidencia |
| Actor/Item eliminado | recovery, no inventar estado | hooks invalidan Trade | persistir conflicto ledger |
| Cantidad externa | bloquear o recovery | hook/boundary local | TOCTOU server-side |
| Equipamiento externo | bloquear o invalidar | guard + reconcile | bypass no vinculado a receipt |
| Cancelación simultánea | una transición terminal | queue Trade local | transición ledger canónica |
| Pickup simultáneo | exactamente un ganador | Ground inexistente | implementar sobre ledger |
| Reload/recovery | mismo compromiso | cada store hidrata separado | Trade desde ledger |
| Retry | mismo resultado | receipts e IDs Trade | unificar fingerprint/operationId |

## 10. Invariants assessment

I1 no evaluable hasta Ground. I2 falla hoy y fue reproducida. I3 está cubierta por receipt/ledger dentro de cada dominio, no cross-domain. I4 está modelada en ledger y Trade, todavía separada. I5 Trade intenta rollback dirigido, pero una compensación puede ser ambigua. I6 cada store sobrevive reload, aunque preserva doble autoridad. I7 mitigada localmente; no server-side. I8 se puede mantener. I9 una frontera menor no demostró equivalencia. I10 permanece explícito: no se realizó Confidentiality.

## 11. Tests y resultados

Se agregó una única prueba aislada de caracterización; no se modificó código productivo en esta auditoría. Test específico: **1 pass, 0 fail**. Suite completa: **1411 tests, 1410 pass, 0 fail, 1 skipped**.

## 12. Recomendación

Migrar únicamente la autoridad de capacidad/reservas Trade al ledger compartido. Mantener sesiones, UI, negociación, transferencia y auditoría existentes, pero hacer que sus decisiones consulten/transicionen registros ledger deterministas. Próximo cambio mínimo recomendado, sin implementarlo: definir IDs `trade:<sessionId>:<participantKey>:<itemUuid>:r<revision>`, una mutación atómica de reemplazo de oferta en el ledger y una proyección read-only hacia `session.reservations`, empezando por tests equivalentes y migración conservadora de runtime legacy.

Confianza: **alta** para la existencia de la carrera y la necesidad de autoridad común; **media** para el blast radius exacto hasta probar la migración con todos los fixtures Trade y Foundry real.

Decisiones humanas pendientes: política de migración ante conflicto legacy/ledger y si los bypass internos de hooks deben exigir evidencia de receipt vigente.

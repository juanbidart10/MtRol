# Fase 6 — Slice de autoridad de estados

Fecha: 2026-08-30. Estado: implementado y validado automáticamente. **No es el cierre global de Fase 6.**

## Decisión aplicada

Se implementaron las reglas aprobadas por el usuario: GM o propietario pueden solicitar estados manuales; un jugador no propietario no puede aplicarlos sobre terceros. La excepción mecánica sólo se ejecuta desde la resolución autoritativa de una acción válida, con revalidación de dominio. El GM conserva el permiso global que ya define AuthorityService.

## Causa raíz

El socket autenticaba al emisor, pero `applyStateFromSocket` resolvía el objetivo y llamaba directamente a `applyStateDirect`. No comprobaba ownership del solicitante. La API pública incluso delegaba por socket cuando el cliente no era propietario, convirtiendo autenticación en autorización implícita.

## Modelo final

Ruta manual:

```text
game.mtrol.states.applyState / macro / UI
  → requestPrimaryGM (si el cliente no es Primary GM)
  → socket autenticado
  → Command Registry: state.manual-apply
  → applyManualStateAuthoritative
  → AuthorityService.ownsActor + resolución canónica Actor/Token
  → TransactionCoordinator + ActorRuntimeRepository
  → flags de estado + ActiveEffect + icono + chat
```

Una llamada local del Primary GM usa directamente el mismo servicio de dominio y sus validaciones, sin round-trip. No se confía en `actor.isOwner` del cliente. El Token, si se proporciona, debe corresponder exactamente al Actor canónico.

Ruta mecánica:

```text
Comando de oposición existente
  → resolvePendingActionAuthoritative
  → resultado recién calculado por el motor existente
  → applyResolvedActionStateAuthoritative (boundary interna, no socket/API pública)
  → RuntimeRepository: acción persistida en estado resolving
  → revalidación del solicitante sobre el defensor
  → efecto y objetivo reconstruidos desde la acción
  → mismo TransactionCoordinator y misma persistencia de Actor
```

Se mantienen los dos casos ya existentes: `stunned` al objetivo si gana el ataque y al atacante si gana una respuesta con ese efecto. No se recalculan oposición ni desempates. El resultado lo entrega el motor autoritativo; no existe un comando de socket que acepte ese resultado como prueba del cliente. `source`, `mechanical`, `authoritative` o `pendingActionId` enviados al socket manual no conceden permisos.

## Persistencia, replay y recovery

Se reutiliza `flags.mtrol.transactionRuntime`, sin nuevo schema. Tanto estados manuales como mecánicos usan receipts sobre el Actor y una cola por Actor. Antes de escribir estado/efecto se persiste un checkpoint de intención. Si se pierde una respuesta después de una escritura, no se repite ciegamente: la operación queda `recovery-required`.

El recovery existente reconoce ahora `state.apply`. Una operación ya marcada `recovery-required` bloquea nuevas solicitudes de estado sobre ese Actor. Replays completados utilizan el receipt persistido y no recrean chat/efectos. No se añadió un mecanismo de recovery paralelo ni limpieza de datos del mundo.

## Rechazos estables

| reasonCode | Motivo |
|---|---|
| `STATE_ACTOR_NOT_OWNED` | Estado manual sobre Actor ajeno |
| `STATE_TARGET_INVALID` | Actor/Token inexistente, malformado, de tipo incorrecto o discordante |
| `STATE_USER_INVALID` | Usuario solicitante inexistente |
| `NOT_PRIMARY_GM` | Intento de aplicación fuera de Primary GM |
| `STATE_INVALID` | Estado incompleto o clave inválida |
| `STATE_TRANSACTION_REQUIRED` | Falta identificador transaccional |
| `STATE_TRANSACTION_CONFLICT` | Identificador reutilizado con otro contexto/estado |
| `STATE_ACTION_CONTEXT_INVALID` | Acción inexistente, incompleta, terminal o en recovery |
| `STATE_ACTION_NOT_AUTHORIZED` | Solicitante no autorizado sobre el defensor |
| `STATE_ACTION_EFFECT_INVALID` | La mecánica no concede el efecto |
| `STATE_RECOVERY_REQUIRED` | Operación ambigua que necesita revisión |
| `STATE_APPLY_FAILED` | Error técnico de aplicación |
| `STATE_REQUEST_FAILED` | Fallo de transporte sin código más específico |

La autenticación conserva sus códigos (`SENDER_SPOOFED`, etc.). El transporte request/response propaga `reasonCode` opcional sin modificar la forma de respuestas anteriores cuando no existe ese campo. Los rechazos de permiso/contexto ocurren antes de receipts, flags, efectos, iconos o chat y generan logs estructurados con IDs, no Documents.

## Archivos del slice

- `scripts/states/state-engine.js`: autoridad, ruta manual/mecánica, transacción, logging y façade preservada.
- `scripts/runtime/state-commands.js`: traducción de transporte y registro en Command Registry existente.
- `scripts/actions/action-engine.js`: los dos efectos mecánicos delegan al boundary revalidado.
- `scripts/core/sockets.js`: elimina uso de `applyStateFromSocket`; responde mediante dispatcher/command.
- `scripts/core/socket-requests.js`: propagación opcional de `reasonCode`.
- `scripts/core/init.js`: registro idempotente del command dentro del lifecycle existente.
- `scripts/runtime/recovery-coordinator.js`: reconoce la familia `state`.
- `tests/phase6-state-authority.test.mjs`: 18 pruebas directas, de transporte y recovery.

`applyStateFromSocket` fue retirado físicamente tras búsqueda de consumidores: sólo lo utilizaba el dispatcher migrado, no formaba parte de `game.mtrol.states`. La façade pública `applyState` permanece. Su instalación ya no sobrescribe otros métodos de states, como los de death-engine.

## QA

- Baseline: 981 tests; 980 pass, 0 fail, 1 skip intencional.
- Slice: 18/18 pass.
- Regresión final: **999 tests; 998 pass, 0 fail, 1 skip intencional**, aproximadamente 4,9 s.
- Sintaxis de los siete módulos: correcta.
- `git diff --check`: correcto.
- Una sola llamada runtime real a `combat.nextTurn()`.
- Cero mutaciones documentales directas en PersonajeSheet.
- No hay imports literales rotos ni ciclos adicionales respecto del inventario inicial de Fase 6.
- main, versión y `mtrol.zip` no se modificaron. Sin commit ni push.

## Gates pendientes de Fase 6

Persisten los ciclos conocidos previos, sockets residuales de progresión/ready-damage y el resto del inventario de legacy/hardening. No se ejecutaron smoke real, profiling multicliente ni stress integral en este slice; las simulaciones focalizadas de F5 no los sustituyen. Fase 6 sigue abierta y no corresponde pedir el commit final todavía.

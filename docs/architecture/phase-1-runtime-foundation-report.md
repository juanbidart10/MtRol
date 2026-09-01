# MTROL — Fase 1: Runtime Foundation y recovery de pendingAction

Fecha: 2026-08-28  
Rama: `refactor/combat-architecture`  
Estado técnico automatizado: **implementado y verde**  
Estado de aprobación: **pendiente del smoke test físico 1 GM + 2 jugadores**

## A. Baseline inicial

Antes de modificar código se ejecutó `node --test tests/*.test.mjs`.

- Tests: 875
- Aprobados: 874
- Fallidos: 0
- Skipped intencionalmente: 1
- Rama encontrada inicialmente: `main`
- El working tree ya contenía el Hotfix 1 sin commit y el reporte de Fase 0.
- Se creó y activó `refactor/combat-architecture` sin descartar ni reescribir esos cambios.
- `mtrol.zip` permaneció sin seguimiento y no fue modificado.

No se hicieron commits porque el baseline anterior estaba sin commit y varios archivos se solapan con el Hotfix 1. Un commit parcial habría mezclado propiedad y alcance de cambios preexistentes. La rama y el working tree quedan preparados para que el usuario decida la estrategia de staging/commits.

## B. Arquitectura creada

### Archivos nuevos

- `scripts/runtime/runtime-repository.js`: aggregate, schema, lazy init, revision y persistencia.
- `scripts/runtime/receipt-store.js`: receipts persistentes e idempotencia reutilizable.
- `scripts/runtime/command-registry.js`: registro, boundary validation y dispatch.
- `scripts/runtime/opposition-commands.js`: adapter incremental de oposición sobre el socket existente.
- `scripts/runtime/recovery-coordinator.js`: reconciliación de runtime, cache y presentación.
- `scripts/runtime/runtime-foundation.js`: composición de servicios internos singleton.
- `tests/runtime-foundation.test.mjs`: contratos de foundation, conflictos, receipts y recovery.

### Archivos modificados por Fase 1

- `scripts/actions/action-engine.js`
- `scripts/actions/action-damage-engine.js` — sólo persistencia del estado de pendingAction ya mutado; no agrega receipts de daño.
- `scripts/core/init.js`
- `scripts/core/ready.js`
- `scripts/core/socket-requests.js`
- `scripts/core/sockets.js`
- `scripts/utils/logger.js`
- `tests/opposed-damage-flow.test.mjs`
- `tests/shield-defense.test.mjs`

Los demás archivos modificados que aparecen en Git pertenecen al Hotfix 1 previo y fueron preservados.

## C. Runtime schema

Fuente canónica:

```js
Combat.flags.mtrol.runtime = {
  schemaVersion: 1,
  revision: 0,
  pendingActions: {
    [pendingActionId]: { /* estado serializado */ }
  },
  receipts: {
    [transactionId]: {
      transactionId,
      command,
      pendingActionId,
      status: "processing" | "completed" | "failed",
      createdAt,
      updatedAt,
      completedAt,
      failedAt,
      result,
      error
    }
  },
  recovery: {
    lastRunAt,
    lastResult,
    requiredPendingActionIds: [],
    notifiedPendingActionIds: []
  },
  authority: {
    lastAuthorityUserId,
    lastAuthorityAt
  }
}
```

El aggregate contiene coordinación runtime del Combat. No incorpora HP, MP, Karma, Dharma, inventario, progresión ni configuración permanente de Items.

`pendingActions` es una colección indexada y soporta múltiples acciones por Combat. Cada acción conserva ID mecánico estable, `combatId`, transaction IDs relevantes, estado, tiradas serializadas y referencias de presentación.

## D. Runtime lifecycle

1. Un Combat viejo no necesita migración manual.
2. El primer acceso autoritativo ejecuta lazy init si falta `flags.mtrol.runtime`.
3. El schema se normaliza a `schemaVersion: 1`.
4. Toda mutación nueva se realiza mediante `RuntimeRepository.mutate()`.
5. Los clientes no autoritativos sólo leen e hidratan cache; nunca inicializan ni escriben recovery.
6. Los receipts y tombstones se conservan durante la vida del documento Combat.
7. Al eliminar el Combat, el runtime desaparece junto al documento. No se implementó auditoría histórica ni compactación prematura.

Rollback de código: retirar los adapters y servicios nuevos no requiere migración inversa ni elimina datos legacy. El flag nuevo es aditivo y puede quedar ignorado por una versión anterior.

## E. Revision

- `revision` es monotónica.
- Cada escritura recuerda la revisión leída, vuelve a verificarla y escribe `revision + 1`.
- Los conflictos lanzan `RuntimeRevisionConflictError`.
- Se relee y reintenta de forma acotada: máximo dos reintentos por defecto.
- Al agotarse los reintentos se aborta y se registra un error para recovery.
- Las mutaciones locales del mismo Primary GM se serializan por Combat mediante una cola en RAM. Esa cola es coordinación local, no fuente de verdad ni lock persistente.

La combinación Primary GM único + cola local + revisión persistente reduce colisiones sin introducir locks persistentes generales. El repositorio no presupone una operación CAS nativa de Foundry que el Document API no ofrece.

## F. ReceiptStore

API interna principal:

- `get(combat, transactionId)`
- `begin(combat, transactionId, metadata)`
- `complete(combat, transactionId, result)`
- `fail(combat, transactionId, error)`
- `execute(combat, metadata, operation)`

Contrato:

```text
mismo transactionId
→ receipt completed existente
→ devolver resultado persistido
→ no ejecutar nuevamente el handler
```

Un receipt `processing` después de perder RAM se considera ambiguo y no se reejecuta. Un receipt `failed` tampoco se reinicia automáticamente: se reproduce el fallo persistido porque pudo existir un efecto parcial antes del error. Esa primitive queda lista para adopción posterior por daño, recursos, consumibles y comercio, pero esas verticales no fueron migradas.

## G. Command Registry

Commands migrados:

- `opposition.create`
- `opposition.respond`
- `opposition.resolve`
- `opposition.cancel`
- `opposition.list`
- `opposition.reaction-complete`

Envelope:

```js
{
  command,
  transactionId,
  combatId,
  payload
}
```

Boundary validation comprueba command registrado, transaction ID, Combat ID, Primary GM y usuario solicitante presente. La validación de permisos mecánicos permanece dentro del Action Engine: control de actor, target, Item, estado y transición.

El socket `system.mtrol` se conserva como transporte. Los nombres socket existentes se adaptan a commands; no se creó un segundo socket. Los handlers switch duplicados de las acciones migradas fueron retirados. Las acciones no migradas siguen en el switch legacy actual.

Limitación del transporte existente: el raw system socket no entrega al handler un sender criptográficamente autenticado separado del payload. Se valida que el usuario exista y se revalidan permisos sobre documentos; no se añadió confianza nueva al `requestingUserId`. Un endurecimiento del transporte pertenece a una fase posterior.

## H. PendingAction

### Antes

- Source of truth: `Map pendingActions` del proceso.
- F5 del Primary GM: pérdida total del estado.
- Chat y socket sync dependían de la memoria anterior.
- Estados terminales se eliminaban del Map tras retención.

### Después

- Source of truth: `Combat.flags.mtrol.runtime.pendingActions`.
- El Map permanece como cache/adaptador para APIs síncronas y UI existente.
- Cada transición autoritativa relevante persiste antes de publicarse.
- `resolved` y `cancelled` quedan como tombstone durante el Combat.
- Se agrega `recovery-required` para ambigüedad.
- ChatMessage referencia `pendingActionId`, transaction ID y tipo de presentación, pero no decide mecánica.

Las APIs públicas existentes continúan presentes. En `game.mtrol.actions`, las variantes `*Authoritative` migradas son façades compatibles que pasan por Command Registry y receipts; los servicios internos usan imports directos.

## I. Recovery

`RecoveryCoordinator` se ejecuta en `ready` y ante un cambio relevante de actividad de usuarios cuando este cliente resulta Primary GM.

Flujos:

- `waiting-defense`: hidrata el mismo ID, restaura cache y valida/reconstruye presentación.
- `resolving` + receipt completed con resultado persistido: coherencia a `resolved` sin repetir side effects.
- `resolving` ambiguo: cambia a `recovery-required`.
- `waiting-defense` + receipt de create processing pero acción mecánica existente: completa el receipt de creación y continúa.
- terminal `resolved/cancelled` con command processing/failed: `recovery-required`, porque el avance o un efecto parcial puede ser ambiguo.
- `recovery-required`: preserva resultado/datos, no daña, no gasta, no avanza y no crea otra acción.
- Clientes no Primary GM: sólo hidratan cache si el runtime ya existe.

El aviso de `recovery-required` se muestra sólo al GM y se deduplica persistentemente por pendingAction ID.

## J. Primary GM

- Primary GM sigue siendo autoridad única.
- El estado crítico ya no depende de su RAM.
- Un GM nuevo lee el Combat, actualiza metadata diagnóstica, ejecuta recovery y reconstruye cache.
- `lastAuthorityUserId` es diagnóstico; nunca bloquea al nuevo Primary GM.

## K. Cache

Permanecen en RAM:

- `pendingActions` como cache compatible.
- Sets de operaciones simultáneas locales.
- Promesas in-flight de receipts.
- cola local de mutaciones del repositorio.

Ninguno es canónico. La prueba automatizada vacía el cache por completo, relee el documento Combat y continúa la misma oposición.

## L. Logger

`MtrolLogger` implementa niveles `debug`, `info`, `warn`, `error` y `silent`, canales normalizados y contexto compacto.

Default: `warn`.

Façade estable:

```js
game.mtrol.debug.setLevel(level)
game.mtrol.debug.getLevel()
game.mtrol.debug.enableChannel(channel)
game.mtrol.debug.disableChannel(channel)
game.mtrol.debug.resetChannels()
```

Se preservan las APIs de auditoría que ya vivían en `game.mtrol.debug`. Los nuevos flujos usan canales `COMMAND`, `COMBAT`, `OPPOSITION` y `RECOVERY` sin volcar payloads completos por defecto.

## M. game.mtrol

- No se renombró ninguna API existente.
- `game.mtrol.actions` conserva sus operaciones.
- `game.mtrol.debug` se amplió sin sobrescribir auditorías existentes.
- Repositorio, receipts, registry y coordinator no se exponen como service locator público.
- No se corrigió la sobrescritura lifecycle de `game.mtrol.aplicarDanioAutorizado`, expresamente fuera de alcance.

## N. UI recovery

- La tarjeta pending guarda `pendingActionId`, transaction ID y `presentationType`.
- Si la tarjeta existe, se reutiliza aunque el ID guardado haya quedado desactualizado.
- Si falta una tarjeta waiting-defense, se recrea una sola presentación y se persiste su nuevo ID.
- Una resolución con interacción pendiente —daño manual o REACTION MOVEMENT— también puede reconstruir su tarjeta si se perdió.
- No se modificaron reglas del Tracker, Sheet ni movimiento.

## O. Tests nuevos y ajustados

Cobertura agregada:

- lazy init;
- schema version;
- revision monotónica;
- conflicto, retry acotado y abort;
- persistencia y recarga desde otro repository;
- ReceiptStore exactly-once;
- receipt processing después de perder RAM;
- receipt failed sin reejecución;
- Command Registry y boundary;
- response/resolve duplicados sin doble daño, recurso, cooldown ni nextTurn;
- logger y façade debug;
- waiting-defense recovery;
- resolving completado y ambiguo;
- recovery-required y aviso único;
- create interrumpido recuperable;
- cliente no autoritativo read-only;
- F5 simulado end-to-end;
- misma pendingAction ID después de F5;
- Chat Card existente no duplicada;
- Chat Card faltante reconstruida;
- mocks de oposición actualizados para persistencia real en Combat.

## P. Regresión global

Resultado final:

- Tests: 895
- Aprobados: 894
- Fallidos: 0
- Skipped intencionalmente: 1
- `git diff --check`: sin errores; sólo advertencias de normalización LF/CRLF del entorno Windows.
- Llamadas runtime reales a `combat.nextTurn()`: exactamente una, en `scripts/combat/turn-system.js`.

## Q. Smoke test 1 GM + 2 Players

**No ejecutado físicamente.** No se afirma lo contrario. La suite simula roles, socket y F5, pero no reemplaza tres clientes Foundry separados. Por lo tanto, Fase 1 no debe marcarse aprobada hasta completar el siguiente guion.

### Preparación

1. Usar un mundo de QA o backup.
2. Abrir tres sesiones separadas: GM, Jugador A y Jugador B.
3. Asignar ownership de Actor A a Jugador A y Actor B a Jugador B.
4. Iniciar Combat con ambos Tokens y abrir consola del GM.
5. Opcionalmente ejecutar `game.mtrol.debug.setLevel("debug")` y habilitar `COMMAND`, `OPPOSITION`, `RECOVERY`.
6. Registrar antes/después: `game.combat.flags.mtrol.runtime` y turno activo.

### Caso 1 — oposición normal

1. A declara un ataque enfrentado contra B.
2. Verificar un único entry `waiting-defense` y una única tarjeta pending.
3. B responde.
4. Verificar `resolved`, receipt completed, efectos una vez y una tarjeta de resolución.
5. Confirmar avance de turno exactamente una vez.

### Caso 2 — F5 Primary GM en waiting-defense

1. A declara y no permitir todavía que B responda.
2. Confirmar pendingAction persistida y copiar su ID.
3. Hacer F5 sólo en el cliente GM.
4. Esperar `ready` y recovery.
5. Confirmar mismo ID, misma tarjeta y ningún nuevo ataque.
6. B responde y verificar resolución normal.

### Caso 3 — F5 cerca de resolving

1. Preparar una oposición con efecto observable controlado.
2. Enviar la defensa y recargar al GM inmediatamente.
3. Si existe evidencia completa, verificar `resolved` sin repetición.
4. Si el corte fue ambiguo, verificar `recovery-required`, aviso único al GM, cero reejecución y cero avance automático.
5. Confirmar que no se duplicó daño, MP, cooldown, desgaste ni turno.

### Caso 4 — respuesta duplicada

1. Ejecutar doble click o reenviar el mismo intento con el mismo transaction ID.
2. Verificar un receipt completed.
3. Confirmar una defensa, un gasto, un cooldown, una resolución y un avance.

### Caso 5 — UI

1. Confirmar target correcto y botones sólo para el Owner autorizado.
2. Confirmar que F5 no duplica Chat Cards.
3. Borrar en un mundo de QA una tarjeta pending y reconectar al GM.
4. Confirmar recreación de una sola tarjeta.
5. Forzar `recovery-required` de QA y comprobar aviso sólo al GM, una vez.

### Caso 6 — movimiento existente

1. Probar TURN MOVEMENT.
2. Probar GRANTED MOVEMENT sobre tercero.
3. Probar REACTION MOVEMENT por Esquiva.
4. Confirmar que iniciativa, allowances y futuro turnState no cambiaron.

### Caso 7 — turn advancement

1. Repetir resolución normal, cancelación y Esquiva con movimiento/renuncia.
2. Confirmar que cada cierre avanza exactamente una vez.
3. Confirmar que waiting-defense y recovery-required no avanzan.

Registrar por caso: fecha, cliente, resultado, pendingAction ID, transaction ID, revisión inicial/final, screenshots y cualquier log relevante.

## R. Riesgos restantes

### P0 conocidos y fuera de alcance

- atomicidad de movimiento Token/allowance;
- daño raw socket exactly-once general;
- receipts de HP, MP, Dharma y otros recursos;
- consumibles;
- sesiones, locks y transferencias de Trade;
- requests socket activos que siguen sólo en RAM.

### P1

- El transporte socket actual no aporta sender autenticado separado del payload.
- Action Engine continúa siendo grande; esta fase añadió boundaries, no su división física.
- `game.mtrol.aplicarDanioAutorizado` continúa sobrescribiéndose entre lifecycle stages.
- Foundry Documents no ofrecen CAS nativo; la estrategia depende de Primary GM único, cola local y revisión.

### P2

- No existe compactación de receipts/tombstones dentro de Combats de duración extrema.
- Recovery manual de `recovery-required` todavía no tiene una UI administrativa dedicada.

### P3

- Persisten logs legacy directos fuera de los flujos migrados.

## S. P0 expresamente fuera de alcance

No se implementaron:

- movement atomicity;
- damage exactly-once general;
- resource receipts;
- consumables;
- trade;
- persistencia/retry de active socket requests.

Las primitives nuevas pueden reutilizarse para esas verticales sin crear una arquitectura paralela.

## T. Legacy

- No se eliminaron tipos Actor/Item legacy.
- No se eliminaron APIs públicas.
- No se tocaron fórmulas, costos, cooldowns, iniciativa, alcance ni ActiveEffects.
- Los sockets no migrados conservan su switch y comportamiento.
- Los nombres socket antiguos de oposición siguen siendo compatibles mediante adapter al Command Registry.
- No se modificó `mtrol.zip`.

## U. Próxima fase recomendada

Después de aprobar el smoke test, la siguiente fase recomendada es **persistencia exactly-once de daño y recursos**, empezando por definir checkpoints de efectos y recovery operacional de `recovery-required`. No debe iniciarse hasta validar esta foundation con clientes reales.

## V. Decisiones que requieren aprobación

1. Aprobar o rechazar el smoke test físico 1 GM + 2 jugadores.
2. Definir quién ejecutará y documentará ese smoke test en el mundo de QA.
3. Decidir si se desea una UI GM explícita para resolver `recovery-required` antes de migrar daño/recursos.
4. Aprobar una estrategia de commits, dado que el Hotfix 1 preexistía sin commit y se solapa con archivos de Fase 1.


# Fase 6 — Retención, recuperación y Orbes persistentes

Estado: bloque aprobado implementado, con regresión verde. **No cierra la Fase 6 global.**

## Autorización y alcance

El usuario autorizó expresamente las tres decisiones detectadas en la auditoría previa:

1. Proteger recibos pendientes/ambiguos frente a la limpieza automática.
2. Tratar escrituras inciertas como recovery-required, bloquear operaciones incompatibles y evitar compensación ciega.
3. Persistir recibos de Orbes mediante foundation y delegar ejecución al Primary GM, conservando que cualquier GM pueda solicitarla.

No se cambiaron fórmulas, costes, clases, iniciativa, comparación de oposición ni reglas de movimiento. No se añadieron permisos para jugadores. Sin commit, push, release, bump de versión ni operaciones sobre el mundo Foundry.

## Causas raíz

- ActorRuntimeRepository aplicaba 128 recibos/30 días sin distinguir operaciones terminadas de evidencia pendiente.
- TransactionCoordinator deducía ausencia de efectos a partir de ausencia de checkpoints. Una escritura aplicada que perdía la confirmación antes del checkpoint podía quedar failed/changed:false.
- La cola y búsqueda por transactionId no impedían que otra transacción actuara sobre el mismo Actor aún ambiguo.
- Orbes guardaba resultados en un Map de sesión. Tras perder RAM, un replay podía convertirse en rechazo de snapshot en vez de devolver su resultado original.
- Consumibles y mejora de competencia compensaban escrituras anteriores después de cualquier excepción, incluso cuando la escritura fallida podía haber sido aplicada.

## Retención y persistencia

La limpieza automática sólo considera terminales inequívocos:

- `completed`.
- `failed` con certificación `failureSafety: no-effects` o `rolled-back`.

Los estados processing, prepared, applying, applied, recovery-required, desconocidos y failed históricos sin certificación se conservan. No se reinterpretan como completados ni se eliminan por antigüedad/cantidad. Esto permite que el total supere 128 cuando hay evidencia pendiente; requiere revisión, no pruning silencioso.

Se mantienen 128/30 días para terminales. No se toca la retención indefinida del historial Trade. No se eliminan datos históricos masivamente.

Se reutilizan `flags.mtrol.transactionRuntime` para Actor y el runtime de Combat existente; schemaVersion sigue en 1. **Sí se agregan metadatos de recibo en la estructura extensible existente:** failureSafety, orbIntent y checkpoints de intención/aplicación. No hay nuevo flag raíz, nuevo schema documental ni migración destructiva.

La garantía de replay de operaciones completadas está acotada a la retención de sus recibos. No se promete exactly-once histórico ilimitado después de podar un terminal.

## Fallos y bloqueo

TransactionCoordinator distingue:

| Situación | Resultado |
|---|---|
| Rechazo en prepare, antes de efectos | failed/no-effects |
| Rechazo previo a escritura, certificado por caller interno auditado | failed/no-effects |
| Compensación completa certificada | failed/rolled-back |
| Error tras entrar en apply sin prueba suficiente | recovery-required |
| Falla incluso persistir el error | conserva evidencia previa; log y error RECOVERY_REQUIRED |
| Resultado applied durable y falla cierre del recibo | conserva resultado; permite completar sólo el recibo |
| Completed confirmado pese a perder ACK del cierre | devuelve resultado persistido |

`changed: true` en un envelope de recovery es una indicación conservadora de **posibles efectos**, no prueba de que todas las escrituras se completaron. No se reporta falsamente changed:false ante incertidumbre.

Las operaciones `resource.*`, `damage.*` y `orb.*` se serializan por Actor afectado. Se consultan recibos persistidos antes de comenzar una nueva operación, incluidos el Actor y los Combats cargados relacionados. Así un fallo de daño no se evade iniciando otro ID o terminando el combate. Otros Actors pueden continuar. La protección es conservadora por Actor, no sólo por campo HP/MP.

La selección usa targetActorUuid para daño, no el atacante. La reutilización del mismo ID entre commands/Actors se rechaza, incluso mientras está en curso. Las colas se liberan en finally y son coordinación efímera, no fuente de resultados.

Los callers auditados de recursos usan un checkpoint de intención anterior a su primera mutación. `tracksWrites` y `beforeWrite` son contrato interno de código, no campos aceptados como prueba de seguridad desde socket. Se revisaron los 15 callbacks de recursos de Actor, clase, progresión, MP y Karma/Dharma. Los callbacks arbitrarios sin ese contrato no obtienen una excepción de seguridad por falta de checkpoints.

Los reconcilers existentes siguen determinando si hay evidencia suficiente. El coordinador no entrega un envelope de error como si fuera un resultado de dominio completado. No introduce un recovery paralelo ni una API de desbloqueo forzado.

### Compensación

Un error ambiguo al descontar inventario ya no restaura HP/MP automáticamente: se mantiene la evidencia y se exige revisión. Sólo un rechazo certificado anterior a la escritura de inventario permite compensar el recurso, comprobando además que conserva el valor aplicado por esta transacción. Una compensación fallida permanece en recovery.

La mejora de competencia tampoco revierte el Item después de una escritura incierta del Actor. No se consideran seguros los errores genéricos de confirmación.

Estas diferencias observables corresponden a la segunda decisión aprobada, no a nuevas reglas de juego.

## Orbes

Flujo remoto:

```text
GM solicitante → requestPrimaryGM → socket autenticado
  → Command Registry orb.add / orb.update / orb.delete
  → dominio con revalidación GM + Primary GM + Actor canónico
  → TransactionCoordinator / ActorRuntimeRepository
  → system.orbs
```

Acciones de transporte: mtrolAddActorOrb, mtrolUpdateActorOrb y mtrolDeleteActorOrb. El Primary GM local usa el mismo dominio sin round-trip. Los registros en init son idempotentes. Un GM secundario conserva el derecho de solicitar, pero no ejecuta el writer localmente. Un jugador no adquiere permiso por ownership ni por falsear el solicitante.

Se mantienen las funciones públicas addActorOrb, updateActorOrb y deleteActorOrb y el formato de resultado `{orb, operation, actorUuid, transactionId, replayed}`. La resolución admite Actors sintéticos por UUID y rechaza un Item como Actor objetivo. El socket no acepta trustedActor del cliente.

El dominio:

- valida los mismos tipos, niveles, IDs y snapshots;
- vincula el recibo a la intención para rechazar mismo ID con otro contenido;
- prepara la colección dentro de la serialización, escribe una vez y conserva checkpoints;
- devuelve replay persistido después de reconstruir caches;
- no deduce éxito sólo porque la colección actual parezca compatible;
- no reconstruye recibos históricos ausentes por suposición.

Se retiró el Map de completedTransactions de Orbes y el helper privado de usuario sin consumidores. Se conserva una cola efímera por Actor, liberada en finally. El helper de reset de tests limpia caches de fixtures, no flags persistidos.

## Recovery y observabilidad

RecoveryCoordinator reconoce `orb.*`. Completa recibos applied con resultado durable; processing/prepared/applying pasan a recovery-required. Informa también sobre recovery previo y evidencia legacy/desconocida, sin reescribir esta última por conjetura.

Ready y relevo de autoridad recorren Actors del mundo y Actors sintéticos cargados. Los logs usan IDs, comando, cantidad y causa, no Documents ni inventarios completos. El Primary GM recibe avisos. Los rechazos de operación usan RECOVERY_REQUIRED; la integración de estados conserva su código público STATE_RECOVERY_REQUIRED.

La recuperación ambigua sigue requiriendo revisión de evidencia por el GM; no se agregó botón ni comando de “forzar éxito”. La auditoría integral de otros dominios y sus compensaciones, incluido Trade, continúa pendiente en Fase 6. No se afirma que este bloque resuelva toda la recuperación global.

## QA

| Corte | Total | Pass | Fail | Skip |
|---|---:|---:|---:|---:|
| Entrada, repetida antes de modificar | 1019 | 1018 | 0 | 1 |
| Final de este bloque | 1044 | 1043 | 0 | 1 |

- 25 tests nuevos en phase6-recovery-orbs.test.mjs.
- Cobertura de retención, recarga simulada, pérdida de ACK, error al persistir fallo, cierre seguro de recibo, concurrencia, bloqueo cruzado daño/recursos/Orbes, Actor sintético, GM secundario, spoofing y compensación segura/incierta.
- Repetición acotada: 160 ediciones y 160 replays, con reconstrucción periódica de caches; 161 escrituras de negocio incluyendo alta, 128 recibos terminales, colas vacías al terminar.
- Tests anteriores actualizados: fixture de Orbes con usuarios activos/colección realista; retención con estados terminales explícitos; consumible con expectativa aprobada de no compensar a ciegas.
- Un fallo intermedio detectó traducción de reasonCode de estados; se corrigió preservando su contrato y regresión.
- Regresión completa final: 5659,7992 ms. Es tiempo del runner, no profiling Foundry.
- Skip intencional: Owner contra Owner requiere SocketInterface/replicación en sesiones reales.
- No smoke ni stress integral multicliente. La repetición acotada no sustituye esos gates.

## Archivos del bloque

Runtime: actor-runtime-repository.js, transaction-coordinator.js, runtime-foundation.js, recovery-coordinator.js, transaction-commands.js y nuevo orb-commands.js.

Dominio: progression/orb-management-service.js; actors/actor-resource-service.js, class-resource-service.js y progression-advancement-service.js; combat/damage-authorized.js y mp-engine.js; rolls/dharma-spend-service.js y mtrol-dharma-karma.js; items/consumable-service.js; states/state-engine.js (compatibilidad del reasonCode).

Integración: core/init.js, ready.js y sockets.js.

Tests: phase2-transactions.test.mjs, orb-management-phase5.test.mjs, consumable-service.test.mjs y nuevo phase6-recovery-orbs.test.mjs.

Documentación: este informe. Las demás modificaciones acumuladas del worktree se preservaron.

## Invariantes y entrega

- Una única llamada runtime a nextTurn, en turn-advance-service.js.
- PersonajeSheet sin mutaciones documentales directas de negocio.
- Sin imports literales o paths de manifiesto rotos en auditoría estática.
- Sin ciclos adicionales; persisten ambient-fx-app/manager y los componentes dinámicos movement-service/turn-system y action-engine/action-damage-engine/opposition-commands.
- Conteos léxicos: 50 registros Hooks, 15 coincidencias socket, 69 referencias façade, 180 construcciones Map/Set, 89 candidatos de mutación y un patch. No son métricas de ejecución ni acciones socket únicas.
- Rama refactor/combat-architecture. HEAD y main: fbf0f7e92a227d669fae1d132c3b08636076ce00.
- system.json intacto, v1.2.9/v14; SHA-256 E0995689EC030FA0797CACE5D9D0EDD9F686082DE282FF940C353C15D1802034.
- mtrol.zip no tocado: 453396771 bytes, modificación 2026-08-27 19:34:03 -03:00; verificación de metadatos, no hash completo.
- Sin commit ni push. El diff tracked acumulado registra 73 archivos, 4374 inserciones y 2551 eliminaciones; incluye fases previas y no incluye untracked. No representa el tamaño de este bloque.

Próximo bloque: dependencias circulares y consumer search residual, seguido del resto de hardening, profiling/stress, documentación consolidada y matriz final. Smoke final a cargo del usuario. Fase 6 permanece abierta; no corresponde solicitar commit final todavía.

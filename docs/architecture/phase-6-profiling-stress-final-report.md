# MTROL — Fase 6 — Informe final de Profiling/Stress

## Alcance cerrado

Se aplicaron exclusivamente las dos correcciones autorizadas:

1. eviction reconstructible del cache runtime de Actor mediante lifecycle real de Foundry;
2. expiracion del dedupe del logger segun el `windowMs` efectivo de cada clave.

Se preservaron sin cambios el lock global de `TradeSessionStore` y la retencion persistente de receipts de Combat. No se modificaron gameplay, formulas, iniciativa, turnos, movimiento, oposicion, Trade, schemas persistentes ni APIs publicas.

## 1. Eviction exacta del cache de Actor

`ActorRuntimeRepository.evict(actorOrId)` resuelve la clave canonica del Actor (`uuid`, luego `id`), espera todas las mutaciones actualmente en vuelo para esa misma clave y vuelve a comprobar la cola antes de borrar. Finalmente elimina unicamente la entrada reconstructible de `cache`.

Los hooks se registran una sola vez:

- `deleteActor`: eviction del Actor eliminado;
- `deleteToken`: eviction del Actor sintetico solamente cuando el Token no esta enlazado. Un Token enlazado no elimina el cache del Actor base.

El hook es fire-and-forget explicito, con rejection capturada y warning estructurado por el logger central. No se introdujo un lock, tracker, timer o repositorio paralelo.

## 2. Condicion segura de borrado

La entrada se elimina solamente cuando:

- existe una clave de Actor resoluble;
- no queda una mutacion en vuelo para esa clave;
- toda Promise previa, cumplida o rechazada, ya se ha asentado.

El borrado no toca flags, receipts, Documents ni estado persistente. Una operacion posterior reconstruye el cache desde el flag autoritativo del Actor.

## 3. Expiracion exacta del logger

Cada clave de `recentKeys` almacena su propio `expiresAt = now + effectiveWindowMs`. En cada llamada a `logOnce` se eliminan todas las claves cuyo `expiresAt <= now`; la misma clave se deduplica solo mientras su expiracion siga vigente. No hay timers ni schedulers nuevos.

Se preservaron el keying existente, la sanitizacion de contexto y la distincion entre errores diferentes.

## 4. Metricas Actor cache

Stress integrado:

- antes: 1;
- pico con 1000 Actors adicionales: 1001;
- despues del lifecycle de borrado: 1.

La entrada residual corresponde al Actor aun vigente usado por la prueba de receipts acotados. La prueba dedicada de borrado llevo 1000 entradas eliminadas de 1000 a 0 y confirmo que los receipts persistentes permanecieron intactos.

## 5. Metricas logger

- antes: 0 claves relevantes;
- pico: 1000 claves de ventana corta;
- despues de expirar y provocar limpieza normal: 1 clave vigente;
- despues de la ventana de retencion observada: 1 clave vigente.

Se emitieron 1002 eventos esperados y no quedo ningun Document retenido en el contexto compactado.

## 6. Tests nuevos

Se agregaron cinco tests:

- eviction de 1000 Actors por lifecycle sin tocar receipts persistentes;
- espera de mutacion en vuelo antes de eliminar;
- reconstruccion posterior desde estado persistente;
- dedupe por ventanas distintas y conservacion de errores diferentes;
- limpieza amortizada de 1000 claves expiradas del logger.

## 7. Tests focalizados

- Actor cache + logger: 27 aprobados, 0 fallos.
- guardrails arquitectonicos + integracion Foundry: 15 aprobados, 0 fallos.
- profiling/stress final: 11 aprobados, 0 fallos.

El stress confirmo ademas serializacion por Actor, concurrencia entre Actors distintos, recovery deduplicado, sockets sin Promises pendientes, exactamente una ejecucion para receipts duplicados y continuidad despues de un fallo sintetico de Trade.

## 8. Suite global

- total: 1070;
- aprobados: 1069;
- fallos: 0;
- skip intencional: 1;
- duracion: 19.424 s.

## 9. Trade preservado

`TradeSessionStore` conserva exactamente su serializacion global. El stress observo head-of-line blocking entre sesiones independientes, segun la decision aprobada. No se modificaron sus archivos, locks, schemas ni semantica.

Riesgo residual: **HIGH**. Una operacion lenta de Trade puede retrasar sesiones independientes.

## 10. Combat receipts preservados

La politica de retencion de receipts de Combat permanece exactamente igual. El stress de 1000 operaciones termino con 1001 receipts persistentes. No se agregaron TTL, limites, pruning, migraciones ni cambios de schema.

Riesgo residual: **HIGH**. El crecimiento persistente no acotado puede aumentar latencia y tamano documental en mundos de larga vida.

## 11. Riesgos residuales

- **HIGH** — lock global de `TradeSessionStore`, preservado por contrato.
- **HIGH** — receipts persistentes de Combat sin politica de retencion, preservados por contrato.
- **MEDIUM** — las colas por Actor y reservas de movimiento producen latencia lineal bajo contention deliberada; mantienen exactly-once y orden correcto.
- **MEDIUM** — la limpieza del logger es amortizada y ocurre con una llamada posterior; sin trafico nuevo, las claves expiradas permanecen en memoria hasta el siguiente uso del logger.
- **LOW** — `console.*` permanece en herramientas manuales de debug/auditoria/reparacion; no forma parte del runtime normal ni se migro fuera del alcance autorizado.

## 12. Recomendacion futura para receipts

Disenar en una fase separada una politica persistente explicita y versionada para receipts de Combat: definir primero ventana de idempotencia, estados protegidos (incluido recovery-required), limite por Actor/Combat, criterio determinista de pruning, migracion no destructiva y observabilidad. Validar el contrato con replay tardio, reinicio del Primary GM y mundos de larga duracion antes de implementarlo.

Esta recomendacion no fue implementada.

## Invariantes finales

- una sola llamada runtime real a `combat.nextTurn()`;
- cero mutaciones de negocio directas desde `PersonajeSheet`;
- cero cambios de gameplay o schema persistente;
- `system.json` SHA-256 `E0995689EC030FA0797CACE5D9D0EDD9F686082DE282FF940C353C15D1802034`;
- `mtrol.zip` SHA-256 `5A19DC704CE99F935E162DF5F20FCC7E685AA77B355C6AEFB22B8ABCE2DCE693`, 453396771 bytes, timestamp 2026-08-27 19:34:03;
- HEAD `fbf0f7e92a227d669fae1d132c3b08636076ce00`;
- sin smoke, commit, push, release ni cambio de version.

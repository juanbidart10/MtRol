# G0 — Transfer Foundation & Authority Hardening

Fecha: 2026-09-10. Estado de Ground Items: **BLOCKED**.
Estado P0 Primary GM handoff: **MITIGATED / SERVER FENCING UNAVAILABLE**.
Estado de G0: implementación de la primitiva y caracterización local terminadas;
prueba Player real pendiente. No se declara G0 validado hasta completar ese spike.

## 1. Hallazgos de Item transfer

`template.json:8` permite competencia, objeto e item. La primitiva acepta los tres
sin convertir el alias item en objeto. `scripts/items/inventory-engine.js` está vacío.
`personaje-inventory-controller.js:54` reemplaza system por un subconjunto; no sirve
para preservar una competencia. `trade-transfer-service.js:52` elimina flags,
_stats y otras propiedades, desactiva equipado y vacía slot. Su contrato continúa
intacto: G0 no adopta la nueva primitiva en Trade ni modifica sus reglas.

`slot` es compatibilidad declarada, no la referencia activa. La referencia activa
vive en Actor.system.equipamiento; debe tratarla el coordinador de transferencia,
no esta función pura. No se ha modificado equipamiento, gameplay, turnos, oposición
ni iniciativa. La primitiva no autoriza usuarios, reserva cantidades ni escribe.

## 2. Contrato adoptado

`createItemTransferSnapshot(source)` devuelve schemaVersion=1, sourceUuid e item.
item es un clon completo de toObject() sin normalización destructiva.
`reconstructItemTransferData(snapshot, options)` devuelve data y changes, lista
explícita de transformaciones. La evidencia original siempre permanece en snapshot.
El resultado es dato de creación, no una instancia Foundry creada/verificada.

| Campo | Snapshot | Datos destino |
| --- | --- | --- |
| name, type, img | Exactos | Exactos |
| system | Completo | Completo salvo cambios explícitos siguientes |
| system.cantidad | Exacto | Igual o cantidad parcial entera positiva <= origen |
| Tipo sin cantidad | Sin campo artificial | No permite solicitar un stack artificial |
| system.slot | Exacto | Exacto: compatibilidad declarada |
| equipado/equipadaCombate | Exactos | false sólo si existen en origen |
| flags, incluidos módulos | Exactos | Exactos; sin limpieza indiscriminada |
| effects | Completos | Se conservan cambios, flags e IDs embebidos |
| Effect.origin igual a sourceUuid | Exacto | Se remapea al UUID destino explícito |
| Referencias externas/flags opacos | Exactas | Se preservan; no se adivina su semántica |
| _id/id/uuid/parent/actor raíz | Exactos si serializados | Omitidos; identidad nueva |
| ownership/folder/sort raíz | Exactos | Los determina el contexto destino |
| _stats raíz y de efectos | Exactos | Los genera Foundry en destino |
| Actor.system.equipamiento | Fuera del Item | Responsabilidad del coordinador existente |
| Peso derivado/efectos derivados | No se inventan valores | Recalculados por Foundry/MtRol |

Si hay Effect.origin propio y no se suministra destinationItemUuid nuevo, la
reconstrucción falla explícitamente. El consumidor debe asignar ese ID al crear
el Item con keepId; no basta pasar un UUID y dejar que Foundry genere otro.
Los IDs de efectos se conservan porque pertenecen al nuevo padre y pueden estar
referenciados dentro de flags. El consumidor deberá conservar IDs embebidos al
crear; G0 aún no acredita esas opciones con documentos reales.

No se remapean referencias arbitrarias dentro de flags/system: requieren contrato
del módulo dueño. La preservación exacta no prueba que una referencia externa siga
teniendo sentido después de transferir. Tampoco se promete trasladar literalmente
_stats al nuevo documento: su información histórica queda en el snapshot.
El snapshot requiere datos serializables de Item.toObject(), no valores calculados
ni objetos runtime. Las comprobaciones actuales son de datos en Node; falta round
trip real por el schema y los hooks de Foundry antes de integrar consumidores.

## 3. Archivos de G0

- scripts/items/item-transfer-data.js — nueva primitiva interna, no game.mtrol.
- tests/item-transfer-data-g0.test.mjs — tests escritos antes de la primitiva.
- tests/authority-handoff-g0.test.mjs — caracterización y pruebas de protección local.
- tests/helpers/g0-confidentiality-spike.mjs — instrumentación manual, sin import
  desde runtime; no se ejecuta automáticamente.
- docs/architecture/g0-confidentiality-protocol.md — procedimiento de dos clientes.
- Este informe.

Ningún archivo productivo existente fue modificado por G0. El workspace contenía
cambios anteriores en competencias/oposición/UI/tests; no son parte de este trabajo.

## 4. Tests nuevos y resultado completo

Primero se crearon tests; la primera ejecución falló por ausencia del módulo.
Después se implementó y se verificaron 8 pruebas de datos: los tres tipos,
preservación de system/flags/slot, independencia de clones, cantidad parcial,
rechazo de cantidades inválidas, tipo/schema inválidos, referencias de efectos
y conservación/declaración explícita de metadata de efectos.
La caracterización de handoff añade una prueba: pasa cuando reproduce el defecto,
Las pruebas nuevas de protección fallan si se elimina `AuthorityWriteContext`:
el siguiente efecto/checkpoint queda bloqueado, la operación entra en
`recovery-required`, el retry no reaplica y A→B→A no revive una generación vieja.

`npm test`: **1405 tests, 1404 pass, 0 fail, 1 skipped**, código de salida 0.
La omitida está en shield-defense.test.mjs:1387 y requiere dos sesiones Foundry
para SocketInterface/replicación. Incluye todas las suites Trade existentes.
Las pruebas específicas se ejecutan con:

    node --test tests/item-transfer-data-g0.test.mjs tests/authority-handoff-g0.test.mjs

No se agregaron tests ficticios para una reserva compartida aún no implementada.

## 5. Shared reservations: diseño, no migración aplicada

Estado actual: TradeSessionStore reserva por Actor + Item, deriva índices RAM de
ofertas persistidas y serializa mutaciones mediante mutationQueue. La persistencia
es tradeRuntime (world setting); RECOVERY_REQUIRED y EXECUTING son estados activos.
hydrateRuntime reconstruye reservas desde ofertas, no de un ledger independiente.
Los guards actuales impiden eliminación, equipado=true y cantidades inferiores a
la reserva. Admiten edición de otros campos y bypass mediante opciones Trade.
Eso no es una frontera de seguridad de servidor contra un cliente modificado.

Referencias: trade-session-service.js:240, :317, :444, :880, :942;
trade-reservation-boundary.js:1; trade-hooks.js:85.

### Una sola fuente de verdad

Generalizar el repositorio world existente con un campo inventoryReservations
versionado y reutilizar su cola/ReceiptStore/TransactionCoordinator. No crear un
GroundReservation store ni un segundo repositorio de cantidades. El nombre
tradeRuntime puede mantenerse por compatibilidad durante esta fase de adopción.
Cada entrada se identifica por operationId + Actor UUID completo + Item ID,
incluyendo contexto de Actor sintético. UUID e ID declarados deben corresponder.

Campos: domain, operationId, itemUuid, actorUuid, quantity, state, fingerprint,
authorityEpoch, revision y referencias a evidencia del commit; sin snapshots
secretos. Varios dominios comparten suma reservada. La exclusión de una operación
al recalcular una oferta se hace por identidad canónica autenticada, no por un
excludeOperationId arbitrario enviado por Player.

Reserva: dentro de una única operación serializada del repositorio, volver a leer
cantidad real y ledger, comprobar sum(active)+requested <= real, persistir reserva
y sólo entonces responder. Un provider que meramente suma reservas de otros
dominios NO cierra la carrera check-then-reserve y no es la solución adoptada.

### Ciclo durable

| Estado/evento | Cantidad bloqueada y transición |
| --- | --- |
| RESERVED | Bloquea cantidad; se puede cancelar antes de efectos |
| COMMITTING | Conserva reserva durante crédito/débito y verificación |
| RECOVERY_REQUIRED | Conserva reserva; nunca expira automáticamente |
| COMMITTED | Libera sólo tras verificar el débito; conserva tombstone |
| ROLLED_BACK | Libera sólo con compensación probada |
| RELEASED | Cancelación sin efectos; replay no recrea reserva |
| Reload/handoff | Reconstruye desde ledger; prohíbe nuevas mutaciones conflictivas |

Commit y rollback usan el coordinador actual y checkpoints persistidos. Un ACK
perdido no libera. Eliminar Actor/Item durante una operación ambigua requiere
recovery, no borrar la reserva. La retención terminal debe impedir replays más
viejos que la ventana de receipts; el pruning actual no acredita esa garantía.

### Guardas y compatibilidad

Todas las rutas de consumo consultan la misma frontera. La mutación autorizada
debe probar correspondencia con operationId y plan vigente; un booleano de options
no acredita permiso. Proteger también escrituras de slots en Actor, equipadaCombate
y reemplazos completos de system. Una edición que cambie el fingerprint debe
invalidar/revalidar el plan, nunca transferir datos viejos silenciosamente. No
bloquear modificaciones inocuas de Items no reservados.

Adopción futura: con admisión pausada y sin commits en vuelo, importar las reservas
Trade a ledger mediante una escritura versionada idempotente; verificar equivalencia
por Item/cantidad. Cambiar reads y writes Trade al ledger en la misma versión;
session.reservations pasa a proyección. No operar con dos fuentes de verdad ni
clientes legacy capaces de escribir el schema anterior. Abortar importación
conflictiva sin cambiar datos. Tests de equivalencia deben cubrir oferta, revisión,
cancelación, commit, rollback, reload y failure injection.

Este diseño sólo garantiza exclusión local bajo un escritor activo. Sigue sujeto
al bloqueo P0 de handoff descrito abajo; no se presenta como solución distribuida
ya implementada. No se ha migrado destructivamente ninguna sesión.

## 6. Primary GM handoff reproducible

El test usa las clases reales AuthorityService, CommandRegistry, ReceiptStore,
TradeRuntimeRepository y TransactionCoordinator. Dos instancias representan dos
clientes (no se agregan servicios productivos). Comparten un setting simulado;
cada cliente tiene las colas locales que tendría en dos navegadores.

Secuencia sin sleeps:
1. A es Primary y atraviesa admisión; persiste prepared/applying y se suspende.
2. A deja de estar activo; B es Primary según la elección actual.
3. B persiste b-epoch y reconcilia el mismo transactionId/recurso: escribe B.
4. Se reanuda A; el callback admitido escribe A.
5. Resultado asertado: [b, a], aun con epoch nuevo persistido.

El riesgo queda demostrado en el runtime cliente. No es todavía evidencia de
dos escrituras de documentos contra un servidor real ni una reproducción completa
del handler Trade. El test demuestra que el coordinador no impide ese patrón.
El contrato de autorización actual valida Primary al entrar (command-registry:68),
no cerca los efectos asíncronos posteriores. transaction-coordinator:211 usa Maps
por proceso. Adoptar epoch en Trade no revoca callbacks admitidos.

### Cambio mínimo propuesto y límite técnico

En el AuthorityService actual, emitir un contexto de escritura (GM ID + generación)
y revalidarlo en el coordinador antes de cada efecto, checkpoint y compensación.
Al perder autoridad, detener nuevas admisiones y suspender la continuación. En
el relevo, conservar reservas y marcar in-flight como recovery-required.
La implementación G0 reduce el riesgo local: `AuthorityService.createWriteContext`
emite identidad/generación; `TransactionCoordinator` valida antes de iniciar,
expone `assertAuthority` para cada efecto cooperativo, y valida checkpoint y
completion. `AUTHORITY_CONTEXT_STALE` se conserva como causa mientras el receipt
queda `recovery-required`; no se ejecutan compensaciones ciegas.

La protección está cubierta por cuatro pruebas nuevas: bloqueo antes del segundo
efecto, bloqueo antes del checkpoint, retry/recovery sin reaplicación y generación
A→B→A inválida. La caracterización antigua se conserva como evidencia del defecto
preexistente; no cuenta como prueba de protección.

Eso reduce el riesgo, pero NO establece fencing durable por sí solo: una petición
ya enviada puede llegar después de esa comprobación.

Para recuperación automática segura hace falta que la frontera que acepta la
escritura rechace generaciones obsoletas atómicamente con la mutación. No se ha
identificado una opción pública de Foundry que valide un epoch MtRol en el servidor.
modifyBatch agrupa operaciones; no sustituye ese predicado ni acredita atomicidad
multi-documento. No se modifica core ni se inventa un segundo dispatcher.

Alternativa conservadora compatible: no recuperar operaciones en vuelo hasta
acreditar quiescencia del escritor anterior y resolver solicitudes pendientes;
sin esa evidencia, mantener bloqueo durable y revisión GM. Un timeout, desconexión
observada o lease vencido no es prueba suficiente. Concede seguridad sacrificando
disponibilidad; no satisface handoff automático irrestricto. No se aplicó una
corrección superficial que fingiera resolver el fencing.

## 7. Confidentiality spike

**PENDIENTE / NO EJECUTADO contra Player.** Se verificó desde la sesión GM activa
que Foundry responde en `http://localhost:30000`, versión `14.365`, mundo
`mt-rol-dev`, usuario `Gamemaster` (`BXLdaRyx6ITAvrcG`). Los usuarios disponibles
son `Lerathiel` (`yKaeyDkzSNWmWvN4`) y `test` (`8vE0rxg7KgDduY5`), ambos Player.
La segunda sesión Player quedó bloqueada por el límite de uso del entorno y el
browser perdió posteriormente la pestaña GM; no se pudo observar el cliente
Lerathiel ni ejecutar el helper desde la interfaz. No se ha iniciado ni modificado
un mundo de producción.

La lectura del core instalado sigue indicando distribución de flags/documentos
y settings; no se eleva esa inferencia a prueba empírica. Matriz requerida:

| Superficie | Evidencia estática | Clasificación empírica A/B/C |
| --- | --- | --- |
| Scene flags | Dump de Scene distribuido | Pendiente |
| Tile flags | Embebidos expandidos en dump | Pendiente |
| World setting config:false | Dump de settings; config controla UI | Pendiente |
| Actor/Item/Journal ownership default:0 | Datos del mundo sin filtro por campo acreditado | Pendiente |
| Embedded Item/Journal page | Embebidos incluidos en documentos | Pendiente |
| Eventos modifyDocument/system.mtrol | Broadcast y filtrado posterior cliente | Pendiente |

A = secreto frente al cliente; B = oculto únicamente por UI; C = contenido completo
distribuido. B y C describen dimensiones distintas: si no se ve en UI pero se recibe
entero, informar B(UI) + C(datos). Ausencia en game.scenes o un evento no prueba A.
Hace falta observar bootstrap, solicitudes de documentos y actualizaciones.

El helper manual usa sentinel MTROL_SECRET_GROUND_TEST_7F3A más ID aleatorio,
documentos nuevos marcados, validación de versión y mundo, y cleanup restringido a
IDs y marcas propios. El protocolo distingue game.data de captura real de Network.
No implementa cifrado, keys, renderer, groundItems ni una API pública.

## 8. Item Piles arbitration

Item Piles 3.3.4 instalado declara item-piles.preDropItemDetermined (:282), lo
invoca sincrónicamente antes de resolver destino/cantidad (:85183) y retorna si
recibe false. Su wrapper (:99676) delega en Hooks.call. Existe además
item-piles.preDropItem (:85298), antes de emitir DROP_ITEMS al GM.

Éste es el mecanismo soportado mínimo: un veto síncrono instalado en MtRol antes
de admitir gestos Ground. No parchear Item Piles, no async false y no depender del
orden del hook dropCanvasData. El veto consulta una política de reclamación única,
igual a la del futuro consumidor MtRol; un fallo posterior de MtRol no vuelve a
habilitar Item Piles para el mismo gesto. La UI podrá reintentar con un gesto nuevo.

Limitación importante: el callback preDropItemDetermined recibe source, target,
itemData y position, pero NO el payload original completo ni mtrolInternal. _dropData
reconstruye itemData sólo con item/quantity/uuid. Por tanto, un marcador arbitrario
en el drag no basta para identificar el gesto en este hook. Debe cerrarse primero
la política (por ejemplo, todos los drags de Item embebido del Actor controlado
admitidos por el modo Ground) que ambos lados puedan resolver determinísticamente.
Si se requiere arbitraje por gesto y coexistencia de otros drags del mismo UUID,
hay que acreditar un canal de correlación conservado; una Set por UUID con timeout
no prueba exactamente un consumidor. No se afirma esa garantía antes de probarla.

También hay que verificar el estado hooks.run de Item Piles: runWithout desactiva
sus hooks temporalmente. Si el veto no está operativo, no admitir Ground en esa
configuración. Deshabilitar el dropping de Item Piles es una alternativa de
configuración para exclusividad total, no una modificación del módulo.
No se implementó consumidor Ground ni se modificó Item Piles.

## 9. Riesgos y decisión

P0: fencing no acreditado en servidor; shared ledger no implementado/adoptado;
confidencialidad Player aún no probada; arbitraje por gesto no acreditado en vivo.
P1: semántica de flags externos; IDs embebidos y metadata en creación real;
retención de receipts/tombstones; migración de reservas y clientes legacy;
referencias activas y Actors sintéticos durante transferencia.
P2: coste/tamaño de snapshots y ergonomía de la futura integración.

Ground Items: **BLOCKED**. Hay una primitiva interna probada y un diseño de
fundación, pero no READY FOR IMPLEMENTATION. Esta fase no implementa Ground Items.
No se emite la declaración G0 COMPLETE mientras la prueba real obligatoria siga
pendiente; hacerlo confundiría evidencia estática y mocks con validación completa.

# G0 Final Gate — Player Confidentiality Spike

## Resultado

El spike se ejecutó empíricamente en Foundry VTT 14.365 con dos sesiones de navegador aisladas: `Gamemaster` (`role=4`, `isGM=true`) y `Lerathiel` (`role=1`, `isGM=false`). Mundo: `mt-rol-dev`; sistema MtRol 1.4.2.

**Conclusión:** ninguna de las superficies públicas evaluadas es apta para guardar el snapshot autoritativo secreto de un futuro Ground Item. Foundry distribuyó el sentinel al cliente Player en la carga inicial, en actualizaciones en vivo y nuevamente después de recargar y reconectar. La invisibilidad en UI, ownership `NONE`, `hidden` y `config:false` no proporcionaron confidencialidad.

No se implementó Ground Items ni se modificó código productivo.

## Amenaza y método

El observador fue un Player legítimo autenticado, capaz de inspeccionar documentos JavaScript, `toObject()`, flags, settings, hooks, bootstrap retenido y mensajes del socket del sistema. Compromiso del servidor, filesystem o cuenta GM quedaron fuera de alcance.

Sentinel de ejecución:

`MTROL_SECRET_GROUND_TEST_7F3A:irO8UBgmrnjnEy12`

El GM creó una Scene inactiva con Tile oculto, un Actor sin ownership Player con Item embebido, un Item de mundo sin ownership Player, un Journal sin ownership Player con página, y un setting `scope:"world", config:false`. El Player inició el observer antes de la creación. La inspección sólo registró presencia y coincidencia del sentinel, sin volcar datos ajenos.

## Evidencia de identidad

| Cliente | User ID | Nombre | Role | isGM |
| --- | --- | --- | ---: | --- |
| Autoridad | `BXLdaRyx6ITAvrcG` | Gamemaster | 4 | true |
| Observador | `yKaeyDkzSNWmWvN4` | Lerathiel | 1 | false |

Manifest controlado:

| Fixture | ID |
| --- | --- |
| Scene | `5pfYRuG67r3xuYIN` |
| Tile | `TsMl5mNHzx7BHqUa` |
| Actor | `rWMoeTzJ0YwncYs8` |
| Embedded Item | `NbMTTVAVNPjvAvZW` |
| World Item | `1tZ0xZTURCQD89uo` |
| Journal | `U1hn0oHNbzsrMICD` |

## Resultados por superficie

Clasificación:

- A: secreto/no distribuido.
- B: oculto en UI, pero distribuido al cliente.
- C: contenido distribuido y accesible desde el cliente.
- D: inconcluso.

| Mecanismo | Estado/UI Player | Acceso local al contenido | Sync inicial | Update en vivo | Reload/reconnect | Clase |
| --- | --- | --- | --- | --- | --- | --- |
| Scene flags | Scene recibida | Sentinel en `flags`/`toObject()` | Sí | Sí, `modifyDocument` | Sí/Sí | C |
| Tile flags | `hidden=true` | Tile y sentinel accesibles | Sí | Recibido con Scene | Sí/Sí | C |
| Setting world `config:false` | No aparece como opción de UI | `game.settings.get` devolvió el sentinel | Sí | Persistido | Sí/Sí | C |
| Actor ownership default NONE | `visible=false` | Actor completo y sentinel accesibles | Sí | Sí, creación | Sí/Sí | C |
| Item embebido del Actor | No accesible por navegación normal | Item, `system`, `flags` y `effects` recibidos | Sí | Sí, con Actor | Sí/Sí | C |
| Item world ownership default NONE | `visible=false` | Item, `system`, `flags` y `effects` recibidos | Sí | Sí, creación | Sí/Sí | C |
| Journal ownership default NONE | `visible=false` | Journal, página, texto y flags recibidos | Sí | Sí, creación | Sí/Sí | C |
| Documento hidden | Tile oculto en UI | Contenido íntegro accesible | Sí | Sí | Sí/Sí | C |
| Flags de documentos recibidos/no visibles | UI los omite | Flags presentes en el documento local | Sí | Sí | Sí/Sí | C |
| Payload de actualización documental | Sin representación propia | Observer Player recibió sentinel en `modifyDocument` | N/A | Sí | N/A | C |
| Payload `system.mtrol` dirigido al GM | Sin representación de UI | Observer Player recibió el payload y sentinel | N/A | Sí | N/A | C |

La etiqueta C expresa la propiedad de seguridad relevante: el secreto estaba disponible al código del cliente. Algunas filas también exhiben comportamiento B en la UI, pero esa ocultación no reduce la exposición local y no cambia su clasificación final.

## Sincronización, actualización y reconexión

Antes de crear fixtures, el observer Player quedó activo. La creación generó siete eventos `modifyDocument` con el sentinel. Después, el GM actualizó un flag de la Scene y emitió un mensaje `system.mtrol`; el Player recibió ambos payloads con el sentinel.

La inspección directa del Player encontró las siete superficies y el sentinel en todas ellas. `game.data` retenido también contenía el sentinel. Después de una recarga completa se repitió el mismo resultado. Luego Lerathiel cerró sesión, volvió a autenticarse sin contraseña y una nueva inspección volvió a encontrar las siete superficies y el sentinel en el bootstrap retenido.

El control GM confirmó la presencia de todos los documentos y el valor exacto del setting. En el Player se observaron los campos relevantes (`name`, `type`, `img`, `system`, `flags`, `effects`, páginas y texto), no una proyección sanitizada de los fixtures.

## Lectura arquitectónica para G1

No hay candidato aprobado dentro de Scene flags, Tile flags, settings world, documentos con ownership `NONE`, documentos embebidos, documentos `hidden` ni sockets públicos del sistema. Todos atraviesan la frontera hacia el Player.

G1 deberá separar la proyección pública de Ground de su estado autoritativo secreto y elegir una frontera que Foundry no distribuya a clientes Player. Este spike no diseña ni implementa esa frontera. Tampoco prueba que una API privada, un servicio externo o almacenamiento exclusivamente servidor sea seguro; cada alternativa necesita evidencia propia.

## Limitaciones y riesgo residual

- La captura de eventos se realizó mediante hooks/documentos y listener de `system.mtrol`, más inspección del bootstrap retenido. No se conserva un archivo PCAP o HAR.
- La prueba acredita Foundry 14.365, mundo `mt-rol-dev` y sistema 1.4.2; cambios de versión requieren revalidación.
- No se probaron mecanismos de almacenamiento exclusivamente servidor que no formen parte del world bootstrap público.
- Que un documento sea invisible o no pueda abrirse por UI no implica que su contenido no esté en memoria del cliente.

## Fixtures, limpieza y archivos

El helper `tests/helpers/g0-confidentiality-spike.mjs` y el protocolo `docs/architecture/g0-confidentiality-protocol.md` fueron usados como instrumentación manual. La limpieza se ejecutó con el manifest y marker de esta ejecución. El helper rechazaba cualquier documento cuyo flag no coincidiera antes de borrarlo.

Resultado del control posterior:

- Scene, Tile, Actor, Item embebido, Item world y Journal: ausentes por sus seis IDs.
- Setting `mtrol.g0ConfidentialityProbe`: ausente del storage world.
- Tres macros temporales G0: ausentes por sus IDs; el directorio no contiene macros G0 restantes.
- Barrido de documentos cargados y settings world por `MTROL_SECRET_GROUND_TEST_7F3A`: cero coincidencias.
- `allClean=true` en el resultado del runner GM.

El sentinel permanece deliberadamente en el helper y en este informe como nombre estable del probe y evidencia reproducible. No permanece en contenido activo del World.

Archivos productivos modificados por este spike: **ninguno**.

El único skip de la suite corresponde a sincronización/replicación de documentos que requiere dos sesiones Foundry. Debe permanecer como integración manual: convertirlo en un pass unitario no reproduciría esta frontera. Este informe aporta la evidencia empírica del run real.

Validación final:

- Sintaxis del helper: `node --check tests/helpers/g0-confidentiality-spike.mjs` — exit 0.
- Suite que contiene el boundary manual: `node --test tests/shield-defense.test.mjs` — 18 total / 17 pass / 0 fail / 1 skip intencional.
- Infraestructura G0 dirigida: 80/80 pass.
- Trade existente: 299/299 pass.
- `npm test`: 1481 total / 1480 pass / 0 fail / 1 skip intencional.

## Estado G0

El Player Confidentiality Spike queda resuelto con resultado negativo para todos los mecanismos evaluados. Ground Items permanece **NO IMPLEMENTADO**. G0 queda listo para revisión final; este resultado no autoriza por sí solo comenzar G1 sin una decisión explícita sobre la frontera de secretos.

G0 PLAYER CONFIDENTIALITY SPIKE COMPLETE — G0 READY FOR FINAL REVIEW.

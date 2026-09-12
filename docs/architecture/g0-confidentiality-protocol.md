# G0 — protocolo aislado de confidencialidad

Estado: **ejecutado** el 2026-09-11 en Foundry 14.365 con sesiones GM y Player
aisladas. Los resultados y su clasificación están en
`docs/architecture/g0-player-confidentiality-spike-report.md`.

Requisitos: Foundry 14.365, sistema MtRol, mundo descartable separado de la partida,
dos clientes independientes (GM y Player), sin compartir cookies de sesión.
No usar cuentas reales ni copiar datos de la campaña. No modificar archivos core.

## Observación de eventos (Player conectado antes de crear fixtures)

En DevTools del Player, sustituir WORLD_ID por el ID real del mundo aislado:

```js
var g0 = await import('/systems/mtrol/tests/helpers/g0-confidentiality-spike.mjs');
var g0Events = g0.observe({worldId: 'WORLD_ID'});
```

El helper rechaza GM como observador y versiones/mundos distintos. No buscar el
sentinel en el código del helper: su constante no demuestra distribución de datos.
El listener sólo registra eventos cuyo payload recibido contiene el sentinel.
Abrir Network, activar Preserve log y filtrar el WebSocket de Foundry.

## Creación (GM)

```js
var g0 = await import('/systems/mtrol/tests/helpers/g0-confidentiality-spike.mjs');
var manifest = await g0.setup({worldId: 'WORLD_ID', isolatedWorldConfirmed: true});
JSON.stringify(manifest);
```

Se crea Scene inactiva, Tile hidden, Actor con Item embebido, Item de mundo,
Journal con página y setting world config:false. Todos usan un sentinel con sufijo
de ejecución y ownership default:0 donde corresponde. No hay gameplay ni Ground
Items. Guardar manifest: contiene sólo IDs de fixtures y sentinel de prueba.
Si falla setup, globalThis.mtrolG0ProbeManifest contiene IDs parciales para cleanup.

## Inspección Player

Copiar manifest de la ejecución (no código de contenido de documentos):

```js
var manifest = /* objeto de IDs y marker devuelto por GM */;
g0.inspect(manifest);
g0Events.events;
```

Capturar para cada superficie: presencia, sentinel en contenido, nivel OWNER
efectivo y visibilidad de UI. No publicar contenido ajeno a los fixtures.
Consultar directamente game.scenes.get(manifest.sceneId).flags, tiles, game.actors,
game.items, game.journal y game.settings.storage.get('world'). El helper agrupa las
lecturas y sólo devuelve booleanos. Abrir desde consola un documento sin ownership
no equivale a recibir datos: distinguir lookup de UI/sheet frente a toObject.

## Bootstrap/reconexión

Detener listeners con g0Events.stop(). Recargar Player conservando Network y
buscar el marker completo en la respuesta inicial/WebSocket de world data.
Volver a importar helper e inspeccionar usando el mismo manifest. game.data es
el objeto bootstrap retenido; su lectura NO sustituye la captura de red.
Repetir cerrando sesión y entrando otra vez como Player.

## Actualización posterior y socket del sistema

Reinstalar observer en Player. En GM, actualizar sólo la Scene fixture:

```js
await game.scenes.get(manifest.sceneId).setFlag('mtrol', 'g0ProbeUpdate', manifest.marker);
game.socket.emit('system.mtrol', {
  action: 'mtrolG0ConfidentialityProbe', targetUserId: game.user.id,
  probe: manifest.marker
});
```

La acción no registrada puede generar advertencia esperada del dispatcher; no
hay handler de mutación. El mensaje lleva únicamente el sentinel descartable.
Observar si Player recibe el payload aunque targetUserId sea el GM. No confundir
el filtro del listener de aplicación con filtrado del servidor.

## Evidencia y clasificación

Registrar versión, IDs de usuarios de prueba, isGM=false, ID de mundo y marker.
Para Scene, Tile, setting, Actor/Item/Journal y embebidos guardar:

| Superficie | UI visible | toObject/flags | Bootstrap recibido | Update recibido | A/B/C |
| --- | --- | --- | --- | --- | --- |
| Completar con ejecución real | | | | | |

A requiere demostrar que el servidor no entrega secretos incluso solicitando el
documento por sus vías accesibles. B indica ocultación de UI; C distribución del
contenido entero. Se puede informar B(UI)+C(datos). Una consulta vacía no prueba A.
Guardar sólo fragmentos/presencias del sentinel, nunca un dump completo del mundo.

## Limpieza

Detener observer Player. En GM:

```js
await g0.cleanup(manifest);
```

La limpieza borra exclusivamente los documentos cuyos IDs y marcas coinciden con
esta ejecución y el setting de prueba si su valor coincide. Scene/Actor/Journal
eliminan sus fixtures embebidos. No borra documentos ajenos. Verificar ausencia de
los IDs y del setting. No limpiar ni reutilizar un mundo de campaña con este flujo.

Tras la ejecución, incorporar resultados al informe G0 y recién entonces decidir
si se puede declarar completo el spike. No hay cifrado ni key management en G0.

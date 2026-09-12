# G1A.1 — Foundry server-side secret authority feasibility audit

Fecha: 2026-09-11. Foundry VTT: v14.365 stable. System: MtRol 1.4.2.

Modo: auditoría técnica y caracterización no destructiva. No implementa Ground Items, backend, módulo ni cambios productivos.

> **Decisión posterior:** el 2026-09-12 se aprobó conscientemente Level 1 — UI Privacy para Ground MVP, con migration boundary Level 2 obligatorio. Esta auditoría conserva íntegros sus hallazgos técnicos. Véase [G1 — Ground confidentiality human decision](./g1-ground-confidentiality-human-decision.md).

## 1. Executive summary

Un System puro de Foundry v14.365 no dispone de una frontera durable Level 2 para Ground secrets. Un Module estándar tampoco agrega esa capacidad. Sus `scripts` y `esmodules` se insertan en la vista de juego y ejecutan en el navegador. La opción `socket:true` registra en el servidor un relay genérico entre clientes; no ejecuta un handler de negocio del paquete en el proceso Node.

Foundry sí posee un servidor Node, sesiones autenticadas, LevelDB, filesystem, rutas HTTP y handlers Socket.IO. Esas capacidades pertenecen al core. La inspección del schema de packages, del montaje de la vista, del registro de rutas y de los listeners socket no encontró una API pública para que un System o Module instale código Node, una ruta autenticada, un socket handler server-side o una colección privada propia.

La v14 agrega `persistentStorage` para conservar la carpeta `/storage` de un System o Module durante updates. No es un secret store: se opera mediante FilePicker/upload y `Data` se sirve como contenido estático. El backup del paquete puede incluirla, pero durabilidad y backup no implican confidencialidad.

Un compendium con ownership `NONE` tampoco se acredita como autoridad secreta. El cliente usa ownership para `visible`, pero `getDocuments` puede emitir una lectura directa; en el servidor, `ServerCompendiumMixin` agrega guards de ownership para create/update/delete y no para get. La ruta general `_getDocuments` no aplica `canUserModify`. La documentación de módulos describe `NONE` como “can't see”, lo cual es suficiente para UI pero queda contradicho para la lectura directa por el source local. No se creó un fixture en el World productivo para resolver empíricamente esa contradicción.

Los únicos caminos plausibles de Level 2 son componentes fuera del package runtime estándar: un companion first-party o un servicio backend first-party con autenticación, storage y backup propios. Ambos conservan al Primary GM como autoridad de gameplay y actúan sólo como frontera confiable de persistencia. Su viabilidad queda condicionada a acreditar autenticación, autorización, transporte, restart, handoff, backup y denial frente a un Player real.

## 2. Question investigated

Pregunta: ¿puede MtRol persistir un Universal Item Transfer Snapshot durable, disponible después de reload/restart y Primary GM handoff, sin distribuirlo a un Player autenticado, usando una extensión pública y soportada de Foundry v14.365?

Respuesta: no dentro de un System o Module estándar. Foundry ofrece las piezas server-side a su propio core, pero no una extensión pública que permita a un package ejecutar lógica confiable dentro de ese proceso. Un componente externo puede satisfacer el contrato en principio, pero todavía no está diseñado ni acreditado.

## 3. G0/G1A baseline

G0 acreditó Primary GM Authority, `AuthorityWriteContext`, `TransactionCoordinator`, `RecoveryCoordinator`, `CommandRegistry`, `ReceiptStore`, Universal Item Transfer Data, `SharedReservationLedger`, atomic replacement/set mutation, quarantine, REACQUIRE y exclusión Ground↔Trade.

Baseline previo y nuevamente esperado:

- 1481 tests;
- 1480 pass;
- 0 fail;
- 1 skip manual del boundary de confidencialidad.

El spike Player real con Lerathiel (`role=1`, `isGM=false`) cubrió initial sync, live update, reload y reconnect. Todos los mecanismos probados quedaron en clase C: contenido distribuido y accesible al cliente. No se reabren como candidatos Scene flags, Tile flags, Documents ocultos, ownership NONE de Documents, settings world, `config:false`, Journal ni flags de Documents sincronizados.

G1A separó proyección pública y autoridad secreta por `groundId` y terminó bloqueado porque ningún repository MtRol actual ofrece Level 2.

## 4. Environment

Observado localmente:

- `C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json`: generation 14, build 365, channel stable, version 14.365.0, runtime Node 24;
- `system.json`: MtRol 1.4.2, `type:"system"`, un único `esmodules` entrypoint (`scripts/mtrol.js`) y `socket:true`;
- Foundry instalado como Desktop/Electron, pero el análisis trata el servidor Node y la vista web como contextos separados;
- ningún backend, módulo server-side o servicio adicional fue instalado;
- no se escribieron DB, World, firewall, puertos ni package internals.

## 5. Evidence sources and confidence labels

### Official documentation

- [Introduction to Module Development](https://foundryvtt.com/article/module-development/): los `scripts`/`esmodules` se cargan en la sesión del navegador; `socket:true` retransmite paquetes entre clientes.
- [Foundry v14 SystemManifestData](https://foundryvtt.com/api/v14/interfaces/foundry.packages.types.SystemManifestData.html): enumera el schema soportado del manifest, incluido `persistentStorage`, sin server entrypoint.
- [Foundry v14 ModuleManifestData](https://foundryvtt.com/api/v14/interfaces/foundry.packages.types.ModuleManifestData.html): mismo modelo para módulos.
- [Foundry v14 PACKAGE_TYPES](https://foundryvtt.com/api/v14/variables/foundry.packages.PACKAGE_TYPES.html): tipos soportados `module`, `system` y `world`.
- [Foundry v14 FilePicker](https://foundryvtt.com/api/v14/classes/foundry.applications.apps.FilePicker.html): el FilePicker navega y sube al path público del servidor; expone `uploadPersistent`.
- [Backups and Snapshots](https://foundryvtt.com/article/backups/): package backups y snapshots copian contenido de las carpetas de Worlds, Systems y Modules; otros assets requieren backup aparte.
- [Foundry v14 API](https://foundryvtt.com/api/v14/): los elementos marcados `@internal` no deben ser usados ni overridden por packages externos.

### Local source observation

Se inspeccionaron únicamente archivos de la instalación v14.365:

- `common/packages/base-package.mjs`, `base-system.mjs`, `base-module.mjs`, `base-world.mjs`;
- `client/packages/system.mjs`, `module.mjs`, `world.mjs`;
- `dist/server/views/view.mjs`, `dist/server/express.mjs`, `dist/server/sockets.mjs`;
- `dist/packages/package.mjs`, `installer.mjs`, `package-backups.mjs`, `world.mjs`;
- `dist/files/files.mjs`, `dist/server/views/upload.mjs`;
- `dist/database/database.mjs`, `backend/server-backend.mjs`, `backend/server-compendium.mjs`;
- `client/documents/collections/compendium-collection.mjs`.

### Inference and unknowns

La ausencia de un campo/registro en el schema exhaustivo y el registro fijo de rutas/listeners prueban que esta build no carga un entrypoint server declarado por package. No prueban que Foundry jamás pueda ofrecerlo en otra versión. Managed hosts pueden agregar APIs propias; eso queda fuera del contrato Foundry v14.365 y debe evaluarse por proveedor.

## 6. System runtime

**Evidence:** `system.json` declara `esmodules:["scripts/mtrol.js"]`. `View._getStaticContent` toma `world.system.esmodules/scripts` y los incorpora a la vista de juego. La documentación oficial define esos campos como archivos JavaScript incluidos en la sesión.

**Evidence:** el schema `BasePackage.defineSchema()` contiene metadata, `scripts`, `esmodules`, styles, languages, packs, relationships, `socket`, update URLs, protected/exclusive y `persistentStorage`. `BaseSystem` sólo agrega document types, background, initiative, grid y token attributes. No existe `serverScript`, server hooks, routes, database collections ni lifecycle Node del package.

**Conclusion:** el código productivo MtRol ejecuta en browser clients. El servidor carga y valida el manifest y template como datos core; no importa ni ejecuta `scripts/mtrol.js` dentro de Node.

**Node/filesystem/DB:** no hay API productiva soportada por la cual un System importe `node:fs`, acceda a `global.db` o registre lógica en `global.express`. Que tests de MtRol ejecuten en Node no cambia el runtime de Foundry.

## 7. Module runtime

**Official evidence:** la guía de módulos dice que sus scripts son cargados y ejecutados por el navegador al abrir la game view. También indica que un módulo sólo puede afectar la vista de juego, no Setup o Join.

**Local evidence:** `BaseModule` hereda los mismos campos cliente y sólo agrega library, translations, document types y quickstart. `View._getStaticContent` incluye `scripts` y `esmodules` de módulos activos en la misma página que el System. No hay campo server-only.

**Conclusion:** un first-party `mtrol-server` implementado como Module estándar no sería servidor. Sería otra entrega de JavaScript a los clientes y no constituiría Level 2.

## 8. Package types

Foundry v14.365 soporta exactamente `system`, `module` y `world` en `PACKAGE_TYPES`.

| Type | Package code execution | Durable content | Level 2 secret code/storage |
| --- | --- | --- | --- |
| System | Scripts/ES modules en game browser | Packs, package files, persistent folder, world Documents vía client API | No |
| Module | Scripts/ES modules en game browser | Igual, más content packs | No |
| World | Scripts/ES modules heredados se cargan en game browser; core server administra el World | World LevelDB, packs y files | No custom private package collection/API |

El server usa clases server-side propias para representar esos packages, validar manifests, instalar, actualizar y hacer backups. Esas clases son core; no ejecutan el código declarado por el autor como Node.

## 9. Foundry server extension model

No se encontró una API pública v14.365 para:

- server plugins o server modules de terceros;
- custom Express routes;
- server-only hooks de package;
- custom Socket.IO listeners ejecutados por el servidor;
- custom document classes/collections server-side;
- trusted Node entrypoints;
- acceso package a filesystem o LevelDB.

**Evidence:** `Express` construye una lista fija de vistas core y monta sus rutas. `sockets.activate` registra listeners core y luego los namespaces custom mediante `registerCustomSocket`, que apunta al relay genérico `handleCustomSocket`. `database.mjs` registra una lista core fija de Document classes. Los manifests no tienen campos para extender esas listas.

Modificar esos imports, monkey-patchear internals desde el proceso host o envolver el launcher sería una modificación/inyección no soportada, rompe la condición de no tocar core y amplía la superficie de upgrade.

## 10. Socket architecture

### Foundry package socket

Flujo real:

```text
Player browser
  -> Socket.IO event system.mtrol
  -> Foundry handleCustomSocket (relay)
  -> other browser clients
  -> MtRol game.socket.on handler in each browser
```

El relay server no interpreta `ground.drop`, Trade ni otra semántica MtRol. `handleCustomSocket` reenvía el payload y añade el `this.user.id` autenticado como argumento al receptor. Puede restringir recipients en su implementación local, pero esa opción no aparece como contrato arquitectónico documentado para construir un backend secreto y sigue sin ejecutar lógica de negocio.

### MtRol current behavior

`scripts/core/sockets.js` registra `game.socket.on("system.mtrol", ...)` en clientes. Sólo el browser del Primary GM continúa hacia `AuthorityService.authenticateSocketRequest`, `CommandRegistry` y handlers. El `senderUserId` agregado por el relay se usa para reemplazar/rechazar identidad declarada por payload. Esta defensa es válida dentro del modelo Primary GM, pero el handler sigue siendo un cliente GM.

**Conclusion:** socket relay no es secret authority ni server fencing.

## 11. Authentication context

El core server sí tiene identidad confiable. Durante `sockets.activate`, la cookie de sesión se resuelve a una sesión y a un User del World; el socket recibe `socket.user`. Los handlers core usan esa identidad. `ServerDatabaseBackend` toma `socket.user`, impone `request.userId=user.id` y realiza permissions checks para mutations.

El package socket relay transmite al receptor el ID obtenido de `this.user`, no el `userId` inventado en el payload. Esto permite al Primary GM autenticar el emisor de un intent dentro del browser.

El gap es de extensibilidad: un System/Module no puede registrar un handler dentro de ese contexto server autenticado. Un companion o servicio necesita su propio mecanismo de autenticación. No se ha acreditado que pueda validar cookies/sesiones Foundry mediante API pública. Copiar el session cookie a un servicio o aceptar `{userId,isGM}` del body no es válido.

## 12. Persistence options

| Storage | Durable | Server process owns bytes | Delivered/directly reachable by Player | Supported package API | Result |
| --- | --- | --- | --- | --- | --- |
| World Documents/settings/flags | YES | YES | YES, G0 class C | YES | Public only |
| World LevelDB direct | YES | YES | UNKNOWN if custom | NO direct package API | Unsupported |
| World/private compendium | YES | YES | Direct get not server-guarded in observed path | YES as compendium, NO as secret contract | Reject |
| Package `persistentStorage` | YES across updates | YES | Static Data path/file API; not private | YES | Reject secret |
| FilePicker/S3 asset | YES/PARTIAL | Server/provider | URL and browse model, not per-record secret API | YES | Reject secret |
| GM RAM/local/session storage | NO canonical | Client | Not normally other Players | YES browser primitives | Reject durability/handoff |
| Electron filesystem | PARTIAL | GM machine | Deployment-dependent | NO Foundry package contract | Reject |
| Companion process DB/file | Conditional YES | Separate trusted process | Can be NO if correctly designed | Outside Foundry package API | Candidate |
| External backend | Conditional YES | Trusted service | Can be NO if correctly designed | Standard web service, not Foundry storage | Candidate |

No server-only setting, package KV store, private Journal-like type ni public custom collection API fue encontrado.

## 13. Filesystem

El Foundry server tiene acceso al Data path y usa `node:fs`. MtRol ejecutado en browser no comparte ese capability. `FilePicker.uploadPersistent` permite subir un `File` al directorio `systems/<id>/storage/...` o `modules/<id>/storage/...` cuando `persistentStorage:true`; no permite que el package ejecute código filesystem server-side.

Además, `Express` monta `express.static(paths.data)` después de bloquear sólo extensiones/nombres DB específicos. Un JSON u otro formato permitido dentro de package storage queda conceptualmente en el espacio web estático. Los permisos de `FILES_BROWSE`/`FILES_UPLOAD` regulan las operaciones FilePicker, no convierten una URL conocida en un registro Level 2.

El installer preserva `/storage` durante una actualización cuando el manifest habilita `persistentStorage`. Los package backups archivan la carpeta completa. Esto resuelve update/backup del archivo, no confidencialidad, autenticación, CAS, schema ni world scoping.

Un `import fs from "node:fs"` en el ES module del package se resolvería en el browser, no en el servidor. Incluso si un renderer Electron expusiera alguna capacidad accidental, no sería portable a GM por navegador, VPS o hosting administrado y no sería una API soportada.

## 14. Database

Esta instalación usa LevelDB/sublevels para World Documents y compendia. `database.mjs` registra clases core concretas y `ServerDatabaseBackend` procesa operaciones de Documents conocidas.

No hay API pública para que un System/Module:

- registre una clase Document server-only;
- agregue una colección a `db.documents`;
- cree un sublevel privado arbitrario;
- haga queries directas a la DB;
- incluya automáticamente una colección custom en backup del World.

### Private compendium characterization

El bootstrap agrega metadata e índice de packs activos. En el cliente, `CompendiumCollection.visible` aplica ownership para UI. Sin embargo, `getDocument` llama `getDocuments`; éste emite una operación DB aun sin comprobar `visible`. En el servidor, `ServerCompendiumMixin.metadata.permissions` sólo agrega `create`, `update` y `delete`. `ServerDatabaseBackend._getDocuments` llama `_preGetOperation`, lee y devuelve; no llama `canUserModify` ni `getUserLevel`.

Por source v14.365, ownership `NONE` no constituye un guard server-side suficiente para read directo. La documentación oficial de módulos dice que `NONE` “can't see”; se interpreta como promesa de visibilidad/uso ordinario, no como prueba más fuerte que la ruta directa observada. Un spike Player read-only sería evidencia adicional útil, pero no es necesario para rechazar el candidato: la frontera no está acreditada y no debe alojar secretos.

## 15. HTTP/custom routes

`Express` registra rutas mediante una lista fija de View classes core (`AuthView`, `PlayersView`, `GameView`, `SetupView`, `FileUploadView`, etc.). No existe campo de manifest, hook público o registry para que un package agregue `GET /...` o `POST /...` dentro del proceso Foundry.

El server obtiene sesión e identidad antes de sus rutas core. Un custom route implementado modificando `dist/server/express.mjs`, importando internals desde un wrapper o parcheando el proceso sería unsupported y falla las stop conditions.

Un companion puede exponer su propio HTTPS endpoint. En ese caso debe resolver por separado TLS, CSRF/origin, autenticación, autorización, world tenancy, rate limits y lifecycle. No hereda automáticamente la sesión Foundry.

## 16. Custom server socket handlers

No existe API legítima encontrada para que `system.json`/`module.json` registre un callback server-side. `socket:true` sólo provoca que core escuche el namespace y ejecute `handleCustomSocket`, un relay.

Los listeners server confiables existen para core (`modifyDocument`, files, FogExploration, Scene, Actor, ProseMirror, etc.) y reciben `socket.user`. No son registries públicos de packages.

Un proceso externo podría usar su propio WebSocket/HTTPS o actuar como cliente automatizado de Foundry. La segunda opción dependería de protocolos/session behavior no documentados como backend API y no debe aceptarse sin spike y soporte explícito.

## 17. Node and Electron distinction

| Context | Node/fs | MtRol package code | Trust conclusion |
| --- | --- | --- | --- |
| Foundry server process | YES | NO custom entrypoint | Trusted core, inaccessible to package logic |
| Browser Player | NO | YES | Untrusted |
| Browser GM | NO | YES | Trusted for G0 application authority, not durable host storage |
| Desktop Electron renderer | Deployment-specific | YES | A client capability, not server authority |
| Node test runner/build | YES | Test/build code | No runtime evidence |

Una capacidad exclusiva del Desktop GM falla cuando Foundry corre en VPS/Docker y el GM entra por navegador. No acredita restart, handoff ni Level 2 server storage.

## 18. Hosting portability

| Deployment | System/Module | Same-host companion | External service |
| --- | --- | --- | --- |
| Self-hosted Windows | Instala normal; no Level 2 | Viable condicional, proceso/service adicional | Viable condicional |
| Self-hosted Linux | Igual | Viable condicional | Viable condicional |
| Docker | Igual | Requiere sidecar/volume/network/config | Viable condicional |
| Remote VPS | Igual | Requiere administración del host | Viable condicional |
| Managed Foundry host | Igual | Normalmente UNKNOWN/no permitido | Más portable si outbound HTTPS y políticas lo permiten |

No se verificaron proveedores concretos. Cualquier matriz comercial debe listar Forge y otros hosts con sus APIs/políticas vigentes antes de prometer soporte.

## 19. Primary GM handoff

| Option | A disconnects; can B read immediately? | Needs A? | Player receives secret? |
| --- | --- | --- | --- |
| System/Module client RAM | NO | YES | Not necessarily, but not durable |
| Scene/settings/Documents | YES | NO | YES, fails Level 2 |
| Package persistent file | Technically fetchable, but no private read boundary | NO | Potentially YES |
| Companion/backend | YES if world-scoped auth for B is designed | NO | NO if boundary passes Player spike |

Un backend apto no liga records a la sesión o browser de GM A. B obtiene credenciales/autorización válidas para el mismo `worldId`, crea un `AuthorityWriteContext` nuevo y recupera records/receipts. Esto no convierte automáticamente la generación local en un server fencing token.

## 20. World restart

| Option | Persists server restart |
| --- | --- |
| World Documents/settings | YES |
| Compendium | YES |
| Package persistent storage | YES |
| GM RAM/session storage | NO |
| Browser localStorage | YES on same profile only; NO as canonical handoff/world storage |
| Companion/backend | UNKNOWN until service lifecycle and durable volume/DB are specified |

Los tres primeros persisten pero fallan la frontera de secreto o soporte de acceso privado. Un servicio no es canonical hasta demostrar restart con una instancia nueva leyendo el mismo storage.

## 21. Backup

Foundry package backups archivan el directorio completo del package. Por eso `persistentStorage` puede entrar en un backup del System/Module, pero no en un backup individual del World. Asociar secretos de varios Worlds al directorio del System complicaría aislamiento y restore; además la ruta sigue siendo pública.

Un backup de World incluye su propio directorio y DB/compendia, pero esos backends no cumplen Level 2 acreditado para el package.

Companion/backend requiere:

- export consistente por `worldId`;
- schema/version y manifest de integridad;
- coordinación del punto temporal con el backup World;
- orden de restore;
- prueba de restore;
- política de retención y tombstones.

Si se restaura sólo el World, public projection y secret authority pueden divergir. G1A ya define fail-closed y reconciliation; eso mitiga gameplay, no reemplaza un backup coordinado.

## 22. Migration and versioning

Todas las alternativas técnicamente viables pueden guardar `schemaVersion`, pero sólo companion/backend puede migrar secretos sin entregarlos a Players. El servicio debe soportar lectura de versiones previas, migración transaccional/CAS, backup previo, fingerprint old/new y rechazo fail-closed de versiones desconocidas.

No se debe ligar el schema del servicio a la versión del documento público. Public projection se regenera; secret record y Universal Item Transfer Snapshot conservan versiones independientes.

## 23. Distribution

| Option | Installation |
| --- | --- |
| System only | `Data/systems/mtrol/` |
| First-party standard Module | además `Data/modules/mtrol-server/`; no agrega server runtime |
| Official server extension | No existe package instalable soportado encontrado |
| Same-host companion | System + proceso/container/sidecar + storage/credentials + posiblemente reverse proxy |
| External first-party service | System + cuenta/configuración de endpoint; infraestructura alojada separada |
| Level 1 Scene | System only; requiere aceptar explícitamente confidencialidad Level 1 |

No se recomienda distribuir un Module llamado `mtrol-server`: el nombre induciría una garantía que el runtime no ofrece.

## 24. Update model

System-only y Module estándar usan manifests/downloads independientes. Un Module first-party tendría versionado aparte y podría declarar relationship, pero seguiría sin Level 2.

Companion/backend necesita un protocolo versionado y handshake, por ejemplo `apiVersion`, `secretSchemaVersions`, `minimumSystemVersion` y feature flags. MtRol debe bloquear mutaciones secret-dependent ante mismatch; nunca degradar a Scene storage.

La actualización del System no actualiza automáticamente un proceso o servicio externo. Same-host companion requiere release/install coordinado. Un servicio administrado reduce instalación del host pero agrega compatibilidad rolling y operación central.

## 25. Dependency-zero impact

Un companion/backend first-party no es dependencia de un tercero, pero sí rompe “System-only/dependency-zero” operacionalmente:

- instalación y credenciales adicionales;
- coordinación de releases;
- observabilidad y soporte;
- nueva superficie de disponibilidad y seguridad;
- backup/restore separado;
- variación por hosting.

Un Module first-party sería fácil de instalar, pero no resuelve el requisito. La distinción correcta es first-party frente a third-party y, separadamente, package único frente a componente operativo adicional.

## 26. Security boundary and threat model

Trusted: Foundry server core/OS, backend o companion acreditado, su DB/volume y GM autenticado. Un Primary GM continúa siendo autoridad de aplicación y de derivación del snapshot.

Untrusted: Player browser, DevTools, payload Player, public projection, package source descargado, client caches y cualquier credencial incluida en el System/Module distribuido.

La autorización real de un companion/backend debe ocurrir dentro de ese componente usando una identidad obtenida independientemente del payload. El Player no puede obtener `getSecretGroundRecord`; idealmente el API ni siquiera expone una lectura general a clientes Player. Las respuestas secretas sólo llegan a una sesión GM autorizada.

Threat model fuera de alcance: compromiso del host/OS, credenciales GM robadas o administrador malicioso.

## 27. Level 2 analysis

Level 2 significa que el Player autenticado nunca recibe snapshot ni clave suficiente para reconstruirlo en operación normal.

- UI hidden, ownership, `visible:false`, encoding y `config:false` no cumplen.
- Ciphertext distribuido sólo cumple si la key permanece en una frontera server confiable. System/Module no proveen esa key boundary.
- Foundry core puede mantener secretos para funciones core específicas, pero no ofrece ese mecanismo como custom package storage.
- Companion/backend puede cumplir sólo después de un spike Player que cubra bootstrap, sockets, HTTP, direct object IDs, errors/logs, cache, reconnect y retry.

## 28. Minimal Ground Secret Authority contract

Contrato mínimo, no plataforma genérica:

```text
create(record, operationId, fingerprint)
read(groundId)
compareAndSet(groundId, expectedRevision, lifecyclePatch, operationId)
listForScene(worldId, sceneId)
tombstone(groundId, expectedRevision, evidence, operationId)
healthAndCapabilities()
```

Propiedades necesarias:

- namespace por `worldId` y unique `groundId`;
- create/retry idempotente por `operationId + fingerprint`;
- CAS/revision para lifecycle y pickup claim;
- full snapshot sólo en request/response autorizada;
- immutable snapshot y mutable lifecycle separado;
- tombstone antes de delete físico;
- audit mínimo sin volcar secret payload;
- schema/capability handshake.

No se incluye query arbitraria, generic blob platform ni Player read API. `delete` físico es mantenimiento posterior, no operación normal de gameplay.

## 29. Existing MtRol integration

Se reutiliza:

- `AuthorityService`: Primary GM y `AuthorityWriteContext` local;
- socket transport y sender ID autenticado para intents Player→Primary GM;
- `CommandRegistry`: comandos futuros Ground;
- `TransactionCoordinator`: saga, checkpoints y revalidación local;
- `ReceiptStore`: mediante un Ground-specific receipt scope;
- `RecoveryCoordinator`: extensión/provider, sin segunda instancia;
- `SharedReservationLedger`: capacidad Actor durante drop, no lifecycle Ground;
- Universal Item Transfer Data: serializer/reconstructor único.

No debe conocer snapshots secretos:

- Scene public projection;
- renderer G2;
- `TradeRuntimeRepository` y compat projections;
- shared capacity ledger;
- broadcasts generales y logs.

Gap concreto: `GroundSecretRepository` necesita un transport/storage Level 2 y un modelo de autenticación para GM handoff. Nada más justifica una arquitectura paralela.

## 30. Candidate architecture data flows

### D — Same-host companion

```text
DROP
Player --public intent/Foundry relay--> Primary GM browser
Primary GM --authenticated TLS--> companion --private write--> durable DB/volume

PICKUP
Player --groundId intent--> Primary GM
Primary GM --authorized read/CAS--> companion
companion --secret snapshot only--> Primary GM
Primary GM --Foundry document mutation--> destination Actor

REVEAL
GM --authorized read--> companion
GM --allowlist projection--> Scene/public clients
```

El snapshot viaja sólo entre Primary GM y companion. Requiere endpoint alcanzable desde el navegador GM; un proceso ligado a localhost del host no sirve cuando GM y host están en máquinas distintas. Reverse proxy/port/TLS no se implementaron ni evaluaron.

### E — External first-party service

El flujo es igual, con Internet HTTPS y tenancy/account propios. Mejora portabilidad en managed hosting, a costa de disponibilidad remota, privacidad comercial, operación y compatibilidad.

### F — Level 1 Scene

```text
Player intent -> Primary GM -> Scene flag containing snapshot -> all clients
```

Es durable, simple y migrable, pero el enlace final entrega el secreto al Player. Sólo existe como opción de producto si una decisión humana cambia explícitamente el requisito.

## 31. Candidate architectures and decision matrix

Las celdas usan únicamente YES/NO/PARTIAL/UNKNOWN; “PARTIAL” significa que depende de diseño y acreditación aún inexistentes.

| Option | Level 2 | Durable | Restart | GM Handoff | Supported | Extra Install | Hosting Portable | Backup | Complexity | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A. System puro | NO | YES | YES | YES | YES | NO | YES | PARTIAL | YES | YES |
| B. First-party Module estándar | NO | YES | YES | YES | YES | YES | YES | PARTIAL | YES | YES |
| C. Server extension Foundry oficial | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | NO | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | YES |
| D. Same-host companion first-party | PARTIAL | PARTIAL | PARTIAL | PARTIAL | YES | YES | PARTIAL | PARTIAL | YES | YES |
| E. External/backend service first-party | PARTIAL | PARTIAL | PARTIAL | PARTIAL | YES | YES | YES | PARTIAL | YES | YES |
| F. Level 1 Scene temporal | NO | YES | YES | YES | YES | NO | YES | YES | YES | YES |
| G1. Private compendium | NO | YES | YES | YES | YES | NO | YES | YES | YES | YES |
| G2. Package persistent storage | NO | YES | YES | YES | YES | NO | YES | YES | YES | YES |

“Complexity YES” y “Risk YES” sólo satisfacen el formato cerrado solicitado de celda; la evaluación cualitativa útil está en la tabla siguiente. A/B/F/G son durables pero no secretas. C no existe como extensión pública encontrada. D/E son candidates, no garantías.

## 32. Cost model

| Option | Implementation | Maintenance | Operational complexity | Security surface |
| --- | --- | --- | --- | --- |
| A. System puro / F. Level 1 | LOW | LOW | LOW | HIGH confidentiality failure |
| B. Module estándar | LOW | MEDIUM | LOW | HIGH confidentiality failure |
| D. Same-host companion | HIGH | HIGH | HIGH | HIGH |
| E. External first-party service | HIGH | HIGH | HIGH | HIGH |

C no se estima porque no hay mecanismo soportado. G1/G2 son LOW/MEDIUM de implementación, pero su costo es irrelevante: no cumplen Level 2.

## 33. Reversibility

El `groundId` estable y la separación public/secret permiten mantener Canvas y renderer durante una migración de storage. Un MVP Level 1 puede migrarse técnicamente a Level 2 copiando snapshots a un backend y sanitizando Scene, pero no puede revocar secretos ya distribuidos. Por eso la migración preserva funcionalidad futura, no confidencialidad histórica.

Empezar con Level 2 evita esa divulgación, pero hace depender el lanzamiento de backend/auth/backup. Mantener `GroundSecretRepository` pequeño y Ground-specific reduce lock-in entre companion y servicio externo.

## 34. Risks

| Risk | Impact | Evidence/detection | Required mitigation |
| --- | --- | --- | --- |
| Confundir Module con server | Critical | Manifest/view audit | Rechazar B para secrets |
| Persistent folder accessible by URL | Critical | `express.static(paths.data)` | No almacenar snapshots allí |
| Compendium direct read | Critical | client/server get path | Rechazar hasta denial empírico y contrato soportado |
| Service trusts payload identity | Critical | auth review/red-team | Independent authentication |
| GM B cannot authenticate | Critical | handoff test | World-scoped role authorization |
| Backend mismatch | High | capability handshake | Fail closed |
| Split backup/restore | High | restore drill | Coordinated export/integrity manifest |
| Service outage | High | health check | Disable mutations; safe public render only |
| Secret in errors/logs/socket | Critical | sentinel search | Structured redaction and Player spike |
| Local companion not reachable remotely | High | browser/VPS matrix | Reverse proxy/TLS or external service |
| Level 1 later called Level 2 | Critical | architecture review | Explicit product decision and labeling |
| Internal Foundry API dependency | High | API `@internal` audit | Do not ship against internals |

## 35. Unknowns

- Managed-host policies for custom outbound HTTPS, CORS and service credentials.
- Commercial acceptance of a first-party service and its data/privacy terms.
- How a companion authenticates Foundry GM status without using an unsupported session API.
- Whether a supported OAuth/service account model should replace Foundry session coupling.
- Required offline behavior.
- Backup ownership and retention.
- Whether Level 2 requires server-side fencing/CAS beyond local authority fencing.
- Empirical direct Player result for compendium `getDocument/getDocuments` on v14.365; source already prevents accreditation.
- Public support commitment for any package socket recipients behavior.

## 36. Evidence still required before production

For D or E:

1. written auth/threat/tenancy contract;
2. protocol/version/capability contract;
3. Player denial tests for create/read/list/CAS/tombstone and guessed IDs;
4. initial sync, live operations, reload and reconnect sentinel test;
5. A→B handoff without A or client-to-client secret transfer;
6. clean service restart and Foundry World restart;
7. crash/lost ACK at each drop/pickup boundary;
8. CAS concurrency and stale generation tests;
9. backup/export/restore drill paired with a World backup;
10. hosted deployment compatibility matrix;
11. secret redaction in logs, errors, metrics and browser caches;
12. security review of credentials, TLS, CSRF/CORS and rate limits;
13. operational update/mismatch/rollback procedure.

No productive Ground code should precede this boundary accreditation.

## 37. Required final answers

**Q1. ¿System puro puede implementar Level 2 durable?** No. Ejecuta package code en clientes y sus storages soportados son distribuidos o públicos.

**Q2. ¿Module estándar puede implementar Level 2 durable?** No. También ejecuta scripts en browsers; `module` no significa proceso servidor.

**Q3. ¿Foundry v14.365 ofrece server-side extension API pública para este caso?** No se encontró ninguna. Manifest schemas y registries locales no exponen server entrypoints, routes, sockets o collections custom.

**Q4. ¿Existe storage durable server-only soportado?** Existe storage server-side para core, pero no uno privado y extensible por System/Module mediante API pública. `persistentStorage` es durable, no secreto.

**Q5. ¿Podemos autenticar server-side al requester?** Foundry core sí autentica sockets/rutas. MtRol recibe el sender ID autenticado mediante relay, pero no puede ejecutar allí un custom handler. Companion/backend necesita auth propia; hoy está UNKNOWN.

**Q6. ¿Qué pasa en Primary GM handoff?** Storages públicos sobreviven pero filtran. RAM GM falla. Companion/backend sólo cumple si GM B obtiene autorización world-scoped sin depender de A; debe probarse.

**Q7. ¿Qué pasa en World restart?** Documents, compendia y package files persisten, pero no cumplen el boundary. Companion/backend es UNKNOWN hasta especificar durable volume/DB y lifecycle.

**Q8. ¿Cómo entra en backup?** Package storage entra en backup del System/Module, no en el World y no es secreto. Companion/backend requiere export/backup coordinado separado.

**Q9. ¿Cuál es la mínima instalación adicional para Level 2?** Un único componente first-party fuera del package runtime: companion/service con endpoint autenticado y storage durable. Un Module solo no alcanza.

**Q10. ¿Qué alternativa tiene menor blast radius?** Entre soluciones Level 2 plausibles, un `GroundSecretRepository` adapter hacia un único companion/service de persistencia, conservando Primary GM y toda G0. La elección local vs external depende de hosting.

**Q11. ¿Level 1→Level 2 posterior es migrable sin rehacer Ground Canvas?** Sí, si Canvas sólo consume la public projection por `groundId`; los secretos divulgados antes no recuperan confidencialidad.

**Q12. ¿Qué evidencia falta antes de código productivo?** Auth, Player denial, handoff, restart, CAS, crash/retry, backup/restore, hosting, redaction y update mismatch del componente elegido.

## 38. Recommendation candidates and human decisions

Candidatos que merecen una decisión humana posterior:

1. mantener Level 2 y autorizar la fase de diseño/acreditación de un companion first-party para despliegues controlados;
2. mantener Level 2 y evaluar un servicio first-party para mayor portabilidad de hosting;
3. aceptar explícitamente Level 1 para un MVP, entendiendo que el snapshot será accesible al Player y que una migración futura no revoca lo ya divulgado;
4. posponer Ground Items.

La auditoría no elige entre ellos. Las decisiones requeridas son nivel de confidencialidad comercial, hosts soportados, operación/backup, credenciales, disponibilidad y coste de mantener un componente adicional.

## 39. GO / NO-GO for G1B

**NO-GO para G1B productivo con System-only o Module estándar.** También NO-GO para compendium y `persistentStorage` como secret authority.

GO únicamente para una fase posterior de diseño y acreditación no productiva de D o E si una decisión humana mantiene Level 2. Un resultado satisfactorio de esa fase puede desbloquear el repository Ground; no autoriza Canvas, drop o pickup por sí solo.

No se crearon fixtures ni helpers. No hubo cleanup necesario.

G1A.1 AUDIT COMPLETE — SYSTEM-ONLY LEVEL 2 NOT AVAILABLE, ALTERNATIVES DOCUMENTED.

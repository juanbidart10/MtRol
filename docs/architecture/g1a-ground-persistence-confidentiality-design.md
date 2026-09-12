# G1A — Ground Persistence & Confidentiality Design

Fecha: 2026-09-11. Modo: auditoría arquitectónica y diseño. No incluye implementación productiva.

> **Decisión posterior:** el 2026-09-12 se aprobó conscientemente Level 1 — UI Privacy para Ground MVP, con migration boundary Level 2 obligatorio. Este informe conserva su evidencia y conclusión histórica. Véase [G1 — Ground confidentiality human decision](./g1-ground-confidentiality-human-decision.md).

## 1. Executive summary

Ground necesita dos representaciones relacionadas sólo por `groundId`:

1. una proyección pública mínima, durable por Scene y deliberadamente distribuible;
2. un registro autoritativo con el Universal Item Transfer Snapshot completo, durable y no entregado a Players.

La primera puede materializarse como un flag versionado de Scene porque su contenido es público por contrato. La segunda **no tiene hoy un storage apto en un System puro de Foundry**. Los repositorios MtRol existentes persisten en flags de Combat/Actor, Journal o el setting world `mtrol.tradeRuntime`; el spike real demostró que esas clases de storage llegan completas al Player. Reutilizar `TradeRuntimeRepository` tampoco cambia esa frontera y además mezclaría el ciclo Ground con el agregado Trade.

La inspección del runtime local de Foundry 14.365 tampoco acredita un escape server-only para Systems. Los scripts del System se cargan como ES modules del cliente. `gmOnlyFields` restringe quién puede modificar un campo, no quién lo recibe. FilePicker guarda archivos, pero no ofrece un repositorio privado arbitrario. Un compendium world privado es durable, pero no es una frontera aceptable: su índice entra en el bootstrap y la ruta server de lectura de documentos no aplica el ownership del pack como autorización de lectura; el ownership del pack se aplica a create/update/delete.

La única opción que puede cumplir Level 2 es un componente confiable server-side, adicional a un System estándar, con storage, autenticación, autorización y backup propios. Ese componente aún no existe ni fue aprobado. Por eso G1B no debe comenzar con persistencia productiva.

## 2. G0 baseline

G0 está cerrado con Universal Item Transfer Data, Primary GM authority, `AuthorityWriteContext`, `TransactionCoordinator`, `RecoveryCoordinator`, `CommandRegistry`, `ReceiptStore`, `SharedReservationLedger`, replacement/set mutation atómicos, quarantine, REACQUIRE y adopción Trade. La última suite acreditada antes de G1A fue 1481 total, 1480 pass, 0 fail y 1 skip manual.

El spike usó a Lerathiel (`role=1`, `isGM=false`) y cubrió initial sync, live update, reload y reconnect. Scene flags, Tile flags, setting world `config:false`, ownership NONE, documentos hidden, Item embebido, Journal y socket `system.mtrol` clasificaron C: contenido distribuido y accesible en el cliente.

## 3. Confidentiality evidence and threat model

El adversario es un Player autenticado que puede abrir DevTools, inspeccionar `game`, documentos, flags, settings, bootstrap, requests y sockets, o modificar su cliente. UI, ownership y ocultación visual no son controles contra ese adversario. GM, host y componente server confiable quedan dentro del perímetro de confianza; compromiso del host queda fuera de alcance.

El contrato requerido para HIDDEN es Level 2: el Player no recibe nombre, descripción, `system`, flags, effects, fórmulas, provenance ni metadata secreta salvo campos que el GM autorice expresamente como públicos. Cualquier degradación a ocultación visual necesita decisión humana explícita.

## 4. Requirements and design principles

El diseño conserva: apariencia real o genérica, tamaño visual pequeño, inspector, pickup global controlado por GM, visibilidad independiente de pickup, quantity parcial, cualquier `Item.type`, persistencia por Scene y reconstrucción íntegra del Item. El renderer debe funcionar sin snapshot secreto.

Principios:

- data minimization en toda proyección pública;
- snapshot creado por autoridad desde el Item canónico, nunca desde payload Player;
- una sola autoridad de ciclo Ground: el registro secreto;
- proyección pública materializada, derivable y reconciliable;
- fail closed ante ausencia o contradicción de autoridad;
- tombstones y evidencia antes de eliminación física;
- reutilización de coordinadores, commands, receipts, authority y ledger existentes.

## 5. Foundry constraints and server-side capability audit

El código local de Foundry 14.365 muestra que el bootstrap del World hace `dump()` de Actors, Items, Journals, Scenes, Settings y demás documentos para cada usuario. Esto coincide con el spike. La configuración de ownership modifica capacidad de uso/UI; no convierte esos dumps en secretos.

`gmOnlyFields` significa “sólo modificable por GM/Assistant” durante sanitización server-side. No es una marca de redacción de salida. Los sockets custom del System se registran en el servidor, pero el handler pertenece al paquete cliente y los mensajes del namespace del System se distribuyen a clientes; no existe una API pública para instalar lógica Node, rutas privadas o tablas LevelDB propias desde `system.json`.

FilePicker delega operaciones de archivos al servidor con permisos de browse/upload. No proporciona lectura privada por registro, transacciones, CAS, esquema, migración o binding seguro a `groundId`; una URL subida tampoco es confidencial por defecto.

FogExploration posee filtrado server-side específico por usuario, pero es una clase core con semántica fija. No existe una extensión pública que permita usarla como base de datos Ground arbitraria.

Un compendium world tiene LevelDB, restart y backup razonables. Sin embargo:

- el bootstrap incluye metadata e índice de cada pack activo;
- el servidor usa ownership del pack para create/update/delete;
- `getDocuments` llega a `_getDocuments`, y los hooks `_preGetOperation`/`_onGetOperation` generales no imponen ownership de lectura al pack;
- pedir directamente el documento no queda acreditado como denegado para un Player.

Por ello el compendium no se considera secreto. Como mínimo exigiría un nuevo spike Player que intente index custom fields, `getDocument`, `getDocuments`, UUID fetch, reload y socket payload. Aun si una versión concreta lo negara, sería una dependencia sensible a cambios de core y necesitaría contrato soportado.

## 6. Canonical identity

Recomendación:

```text
ground:<worldId>:<authority-generated-random-id>
```

El Primary GM genera un random ID criptográficamente suficiente mediante la utilidad pública de Foundry; se recomienda 24 caracteres si la API lo permite. El prefijo y `worldId` dan namespace, el valor no contiene nombre, Item UUID ni datos secretos. El servidor/repository aplica unique-create: reusar el mismo `groundId` con igual fingerprint es retry; con otro fingerprint es conflicto. El ID permanece estable durante move, reveal, hide, pickup, recovery y tombstone.

## 7. Public projection model

La proyección es una vista durable y derivable. Puede vivir en un único flag público versionado por Scene, por ejemplo conceptualmente:

```js
{
  schemaVersion: 1,
  revision: 12,
  sceneId: "Scene-id",
  entries: {
    "ground:world:random": {
      groundId: "ground:world:random",
      x: 120,
      y: 360,
      elevation: 0,
      visibility: "HIDDEN",
      appearance: { mode: "generic", src: "systems/mtrol/assets/..." },
      display: { name: "Objeto desconocido" },
      interaction: { inspectable: true, pickupAvailable: false }
    }
  }
}
```

`sceneId` exterior permite detectar escritura en Scene equivocada. Dentro de cada entrada son obligatorios `groundId`, `x`, `y`, `visibility`, `appearance`, `display` e `interaction`. `elevation` puede iniciar en 0. Rotation, width y height no pertenecen al MVP: el renderer normaliza tamaño y orientación.

No contiene snapshot, `system`, flags originales, effects, fórmulas, descripción original, provenance, source UUID, receipt, estado interno ni real image cuando la política es generic. Quantity sólo se publica si el diseño de producto decide que el Player debe verla; de lo contrario se omite. `pickupEnabled` global debe ser un setting público separado y seguro; `pickupAvailable` es la decisión por entrada derivada de estado, visibilidad y toggle global.

Sólo HIDDEN y REVEALED poseen entrada pública. INVISIBLE no se materializa para Players. Foundry no ofrece filtrado por usuario dentro de un flag de Scene, por lo que guardar una entrada INVISIBLE y pedir al renderer que la ignore sería privacidad de UI.

PENDING tampoco se publica. La proyección sólo representa Ground activo o, si UX lo requiere, una representación segura con pickup deshabilitado. Nunca debe revelar por qué una operación está en recovery.

## 8. Public appearance and visibility

| Visibility | Proyección | Apariencia y datos permitidos |
| --- | --- | --- |
| INVISIBLE | Ausente | Ningún dato nuevo. El GM usa el lado autoritativo para administrarlo. |
| HIDDEN + generic | Presente | Asset genérico, “Objeto desconocido”, campos seguros explícitos. |
| HIDDEN + real | Presente | Icono real sólo por decisión explícita del GM; no se infieren otros campos. |
| REVEALED | Presente | DTO allowlisted derivado por autoridad; nunca el snapshot entero por comodidad. |

Hide o invisible posteriores detienen distribución futura, pero no pueden borrar memoria, logs o conocimiento ya entregado. Re-hide no restaura confidencialidad histórica.

## 9. Secret authority model

El registro conceptual mínimo es:

```js
{
  schemaVersion: 1,
  revision: 7,
  groundId,
  worldId,
  sceneId,
  state: "ACTIVE",
  visibility: "HIDDEN",
  position: { x, y, elevation: 0 },
  appearancePolicy: { mode: "generic", allowedPublicFields: [] },
  quantity,
  transfer: {
    snapshotSchemaVersion: 1,
    snapshot,
    fingerprint
  },
  provenance: {
    sourceActorUuid,
    sourceItemUuid,
    requestingUserId,
    authorityUserId,
    dropTransactionId,
    createdAt
  },
  lifecycle: {
    activeTransactionId,
    reservationOperationId,
    checkpoints,
    recoveryReason,
    tombstonedAt
  }
}
```

`snapshot` es exactamente la salida de `createItemTransferSnapshot`. No se crea otro serializer. `quantity` es autoridad Ground para el stack depositado y queda ligada al fingerprint del snapshot y a las opciones de reconstrucción. El snapshot original es inmutable; move, visibility y appearance sólo cambian campos Ground. Pickup usa `reconstructItemTransferData(snapshot, {quantity, destinationItemUuid})`.

La provenance completa es secreta. Se conservan source Actor/Item UUID, requesting user, autoridad, transaction/receipt y tiempos. El registro no depende de que el Item fuente siga existiendo.

## 10. Candidate storage audit

| Candidate | Durable/restart | Handoff | Client confidentiality | Cohesion | Result |
| --- | --- | --- | --- | --- | --- |
| Scene/Tile flags | Sí | Sí | No, clase C | Buena sólo para public projection | Public only |
| World setting | Sí | Sí | No, clase C | Posible agregado, inseguro | Reject secret |
| Actor/Combat flags | Sí | Sí | No, clase C | Scope incorrecto | Reject secret |
| Journal | Sí | Sí | No, clase C | Auditoría, no secret DB | Reject secret |
| `TradeRuntimeRepository` | Sí | Sí | No: usa world setting | Agregado Trade + shared capacity | Reject secret |
| Private world compendium | Sí | Sí | No acreditado; read path no muestra guard | Ground repository sería posible, seguridad no | Reject pending proof |
| FilePicker/upload | Archivo sí | Sí | No contrato privado | Sin transacciones/esquema | Reject |
| GM RAM/local/session storage | No | No | Local al GM actual | Cache solamente | Reject |
| Ciphertext en storage C, key en cliente | Ciphertext sí | Frágil | No hay key boundary | Crypto ad hoc | Reject |
| Componente server confiable | Sí, si se diseña | Sí, si es world-scoped | Potencialmente sí | Responsabilidad nueva legítima | Only viable Level 2 option |

## 11. Existing repository audit

`TradeRuntimeRepository` aporta schema, revision, queue y retry, pero guarda el agregado completo en `game.settings`. Sirve para exclusión e idempotencia que no son secretas. Agregar `groundSecrets` allí expondría el snapshot y convertiría un repositorio Trade en una base genérica accidental.

`RuntimeRepository` y `ActorRuntimeRepository` usan flags de Combat/Actor. También son storage C y sus scopes no coinciden con Ground por World/Scene. `TradeAuditService` usa Journal y tampoco es confidencial.

La abstracción reutilizable es el contrato repository/receipt (`read`, `ensure`, `mutate`, revision, receipt scope), no ninguno de esos backends. Una futura persistencia Ground representa una responsabilidad nueva e irreducible, pero sólo debe crearse cuando exista un backend Level 2 acreditado.

## 12. Primary GM handoff, restart and backup

Un backend apto debe identificar records por `worldId + groundId`, no por sesión de GM. GM B debe leerlos después del handoff aunque A esté desconectado. El cliente B obtiene un `AuthorityWriteContext` nuevo; una generación de A no revive. La validación local vigente sigue siendo local fencing. Si un componente externo implementa CAS/revision o lease, esa garantía debe describirse separadamente y no presentarse como server fencing hasta probarla.

El backend debe sobrevivir shutdown/restart y abrir antes de recovery Ground. Si está inaccesible, se bloquean pickup, reveal, delete y toda materialización pública que pudiera filtrar datos. Una proyección pública segura ya recibida puede seguir renderizando, pero su interacción queda deshabilitada.

El backup del World estándar incluye flags/setting público, pero no incluye automáticamente un servicio externo. La opción server necesita export/import versionado por world ID, backup coordinado, restore order, integrity manifest y política de borrado. Sin eso queda riesgo operativo alto y no puede llamarse world-lifecycle compatible.

## 13. Public-secret relationship and rebuild

La igualdad única es:

```text
publicProjection.groundId === secretRecord.groundId
```

El registro secreto es autoridad de lifecycle, quantity, visibility policy, Scene, position y contenido. La proyección pública es un materialized view durable para bootstrap/render. No es una segunda autoridad. El Primary GM la reconstruye desde records secretos ACTIVE de una Scene y una función pura de proyección allowlisted.

Cada write público incluye revision derivada del secret record o un projection revision monotónico. La reconciliación compara `groundId`, Scene, estado, visibility y fingerprint de la proyección segura. Nunca copia campos desconocidos del snapshot.

Query futura del repositorio secreto: `listForScene(sceneId)`. Query pública del renderer: el flag de esa Scene. Cambiar de Scene no muta Ground.

`sceneId` es obligatorio y define la pertenencia lógica del Ground. La API de dominio futura puede exponer `getGroundItemsForScene(sceneId)` sobre `listForScene(sceneId)` y sólo materializa la proyección de esa Scene. La identidad y persistencia canónicas no dependen de un `TileDocument`.

La posición canónica del MVP es `{x, y, elevation}`. `elevation` comienza en `0` cuando no se especifica; rotation, width y height quedan fuera hasta que exista un requisito real. El renderer G2 debe poder decidir exclusivamente desde la proyección pública `groundId`, posición, presencia/visibility, apariencia e interacción. Acceder al snapshot secreto desde el renderer viola el criterio de aceptación.

## 14. Canonical lifecycle

| State | Meaning | Public projection | Mutations |
| --- | --- | --- | --- |
| PENDING | Secret record durable; source debit no acreditado | Ausente | Sólo drop/recovery |
| ACTIVE | Débito de drop verificado; Ground usable | HIDDEN/REVEALED presente; INVISIBLE ausente | Move/visibility/pickup/delete GM |
| PICKUP_PENDING | Claim exclusivo durable; crédito en progreso o ambiguo | Segura, pickup false; puede retirarse | Sólo pickup/recovery |
| RECOVERY_REQUIRED | Evidencia insuficiente o divergencia | Ausente o segura con pickup false | Sólo reconciliación autorizada |
| TOMBSTONED | Efecto terminal probado; retiene evidencia | Ausente | Replay/retención/cleanup físico |

No se copia `RESERVED` del ledger: el claim Ground es `PICKUP_PENDING`. El ledger conserva su máquina propia para capacidad de inventario.

## 15. Drop invariant

Flujo diseñado:

1. `ground.drop` recibe intent con Actor UUID, Item UUID, quantity, Scene y posición.
2. Primary GM autentica sender, ownership del Actor, Scene, Item, quantity y política.
3. GM lee el Item real y crea el Universal Item Transfer Snapshot; ignora cualquier snapshot Player.
4. SharedReservationLedger adquiere capacidad del Item fuente bajo un operation ID estable del dominio Ground.
5. Se persiste secret record PENDING y se relee/fingerprint-verifica.
6. `TransactionCoordinator` debita/reduce el Item fuente con `AuthorityWriteContext` y checkpoints.
7. Se verifica el débito. Ambigüedad conserva PENDING/RECOVERY_REQUIRED y reserva.
8. El secret record pasa a ACTIVE.
9. Se materializa la proyección pública sólo si no es INVISIBLE.
10. Se completa receipt y la reserva pasa a COMMITTED.

Este orden respeta `VALIDATE → PERSIST PENDING → VERIFY → DEBIT → VERIFY → ACTIVATE → RECEIPT`. Un crash tras débito deja snapshot y receipt para recovery; un crash tras ACTIVE pero antes del flag deja `secret exists/public missing`, que se reconstruye sin repetir débito.

## 16. Pickup invariant

Flujo diseñado:

1. `ground.pickup` recibe `groundId` y, cuando sea necesario, un Actor destino permitido.
2. Primary GM autentica sender, ownership, setting global, Scene y secret record ACTIVE.
3. CAS/revision cambia ACTIVE a PICKUP_PENDING con transaction ID/claimant. Sólo un pickup gana.
4. `TransactionCoordinator` reconstruye y acredita el Item destino, usando ID nuevo estable y marker de origen Ground para reconocer lost ACK.
5. Se verifica el crédito.
6. Secret record pasa a TOMBSTONED y se elimina la proyección pública.
7. Se completa receipt.

Retry del mismo transaction ID reproduce resultado. Otro transaction ID ve PICKUP_PENDING/TOMBSTONED y no acredita un segundo Item. Si el destino fue creado pero el tombstone falló, recovery reconoce el marker/fingerprint del crédito y sólo completa tombstone; no vuelve a crear.

## 17. Existing infrastructure responsibilities

### SharedReservationLedger

Sólo protege capacidad del Item fuente mientras drop todavía depende del inventario Actor y mantiene exclusión Ground↔Trade/Trade↔Trade. No guarda snapshot, posición, visibility ni lifecycle Ground. Pickup de un Ground ya independiente del Actor usa claim Ground, no una reserva de inventario ficticia.

### TransactionCoordinator

Puede expresar drop y pickup sin otro coordinator. `receiptScope` ya permite que el `ReceiptStore` existente resuelva un repository/target custom. `apply({checkpoint, assertAuthority})` cerca cada efecto y checkpoint localmente. El dominio debe invocar `assertAuthority` antes de cada documento externo y antes de cualquier compensación. Persiste el plan/fingerprints necesarios para reconciliar.

Gap: no existe todavía un receipt scope durable y secreto porque falta el backend. Tampoco hay atomicidad entre backend secreto y documento/flag Foundry; la máquina y los checkpoints deben tratar esa frontera como saga.

### RecoveryCoordinator

La instancia actual recupera Combat y Actor y filtra comandos conocidos. Debe ampliarse en el futuro con un provider/handler registrado para el receipt scope Ground, no reemplazarse ni duplicarse. Debe escanear PENDING, PICKUP_PENDING y RECOVERY_REQUIRED y correlacionar receipt, reserva, source debit, destination marker y proyección.

### ReceiptStore

Receipts necesarios:

- drop: intent fingerprint, groundId, source refs, quantity, PENDING persisted, debit evidence, activation y projection result;
- pickup: ground revision, claimant, destination, credit marker, tombstone y projection removal;
- GM delete: logical tombstone y razón;
- move/visibility: basta mutation ID + expected revision si el repository ofrece idempotencia; no necesitan saga receipt salvo que crucen secret/public writes.

### CommandRegistry

Nombres compatibles con la convención existente: `ground.drop`, `ground.pickup`, `ground.update`, `ground.delete`. Scope world, `transactionId` obligatorio, `receiptTarget` al scope Ground. No se crea dispatcher ni socket paralelo; el adapter de socket existente entrega intents al registry.

### Authority and trust boundary

El Player nunca envía snapshot, visibility efectiva, pickup efectivo o destino arbitrario como autoridad. Envía referencias e intención. El Primary GM deriva groundId, resuelve documentos, valida ownership y crea snapshot/projection. Todas las mutaciones usan `AuthorityWriteContext`. La ventana local validate→send→authority loss→server accepts continúa existiendo para writes Foundry; no se la presenta como fencing distribuido.

## 18. Inspector, reveal, hide and invisible

El double click sólo usa `groundId`. Para HIDDEN, la respuesta y/o proyección se limita a `{groundId, displayName:"Objeto desconocido", displayImage, pickupAvailable}` más campos allowlisted. Para REVEALED, el Primary GM deriva un DTO explícito del snapshot y lo persiste/publica; el DTO no puede ser `item.toObject()`.

Reveal es una divulgación irreversible para los clientes que la recibieron. Hide reemplaza la proyección futura por datos genéricos, pero no hace que esos clientes “olviden”. Invisible elimina la proyección futura; tampoco borra conocimiento histórico. Los logs deben evitar snapshots y DTOs revelados salvo necesidad de auditoría.

## 19. Divergence matrix

| Case | Authority | Safe behavior | Recovery/quarantine | Player result |
| --- | --- | --- | --- | --- |
| Secret exists, public missing | Secret | Rebuild allowlisted projection if ACTIVE/non-INVISIBLE | Registrar reparación | Aparece sólo tras rebuild |
| Public exists, secret missing/unavailable | Ninguna afirmación pública es confiable | No pickup; retirar/sanitizar projection sin destruir evidencia | RECOVERY_REQUIRED | No secreto; interaction false |
| groundId mismatch | Secret records + evidence | No emparejar por posición/nombre | Quarantine ambos IDs | Ocultar entradas afectadas |
| sceneId mismatch | Secret | No mover automáticamente; retirar projection incorrecta | RECOVERY_REQUIRED si origen incierto | No interaction |
| Public ACTIVE-like, secret PENDING | Secret | PENDING no se publica | Retirar projection, recover drop | No Ground activo |
| Public REVEALED, secret HIDDEN | Secret, pero leak ya ocurrió | Reemplazar por HIDDEN y registrar incidente | RECOVERY_REQUIRED para revisión | Datos futuros minimizados |
| Quantity mismatch | Secret | No pickup ni ajuste silencioso | RECOVERY_REQUIRED | Omitir quantity/interaction |
| Secret ACTIVE, duplicate public entries | Secret | Conservar una projection por groundId/revision | Reparación idempotente | Una representación |

La reconciliación conserva evidencia y nunca borra automáticamente el registro secreto o tombstone para “hacer coincidir” el flag.

## 20. Fail-closed behavior

Si no se puede leer/verificar la autoridad secreta:

- bloquear drop activation, pickup, reveal, delete y mutation secret-dependent;
- no reconstruir Item desde datos públicos;
- no confiar en una proyección que diga REVEALED o pickup true;
- preservar reservas y receipts ambiguos;
- retirar o sanitizar proyecciones contradictorias cuando el Primary pueda escribir con seguridad;
- marcar recovery y notificar al GM sin publicar secreto.

## 21. Delete, tombstone and physical cleanup

“Eliminar” primero crea TOMBSTONED con expected revision, reason, authority, transaction ID y evidencia de que no existe pickup ambiguo. Después remueve la proyección. La eliminación física sólo es segura cuando no hay receipt/reserva/claim abierto, la retención de idempotencia superó su ventana y backup/audit permite demostrar el terminal. La acción permanente del GM requiere confirmación en UI. Una operación ambigua nunca se destruye para liberar espacio.

## 22. Schema version and migration

Public y secret comienzan independientemente en `schemaVersion:1`. Cada reader acepta únicamente versiones conocidas y falla cerrado. Migraciones secretas ocurren server-side o bajo Primary GM después de backup, con old/new fingerprint y checkpoint. La proyección puede reconstruirse desde secret, por lo que su migración preferida es regenerate, no traducción destructiva. Nunca se migra el snapshot con normalización que pierda campos; Universal Item Transfer conserva su propia versión.

## 23. Quantity, immutability and provenance

`secretRecord.quantity` es la única quantity Ground autoritativa. El snapshot conserva el Item original; quantity parcial es una opción explícita de reconstrucción, fingerprintada. Public quantity es derivada y opcional. Un mismatch bloquea pickup.

El snapshot ACTIVE es inmutable. Cambios posteriores al Item fuente no alteran Ground. Editar un Ground que deba cambiar contenido es una operación explícita versionada que crea nueva evidencia; no enlaza mágicamente al source Item. Provenance se conserva secretamente y no entra en renderer ni inspector público.

## 24. Confidentiality levels

| Level | Contract | Current support |
| --- | --- | --- |
| Level 1 — UI privacy | El Player recibe snapshot/datos y la UI los oculta | Posible con Foundry puro; demostrado insuficiente |
| Level 2 — client confidentiality | El Player no recibe datos secretos | No disponible en la arquitectura actual |

HIDDEN exige Level 2. No se degrada a Level 1 por implementación implícita.

## 25. Architectural options

| Option | Real confidentiality | Durable | Restart safe | GM handoff | New dependency | Complexity | Reversible | Recommendation |
|--------|----------------------|---------|--------------|------------|----------------|------------|------------|----------------|
| A. Full snapshot in Foundry public storage, UI-hidden | No | Sí | Sí | Sí | No | Baja | Alta | Rechazar: viola Level 2 |
| B. Trusted server companion + public Scene projection | Sí, condicionado a auth/test | Sí | Sí | Sí | Sí | Alta | Media | Recomendada si Level 2 es obligatorio |
| C. Persist only safe public data; no full snapshot | Sí porque no hay secreto | Sí | Sí | Sí | No | Baja | Alta | No cumple reconstrucción/pickup |
| D. Private world compendium | No acreditada | Sí | Sí | Sí | No | Media | Media | Rechazar hasta evidencia Player y contrato soportado |

### Option B requirements

El componente debe ofrecer repository world-scoped con CAS/revision, unique groundId, transactions o mutations serializadas, auth que no dependa de un token incluido en el cliente Player, autorización GM, rate/audit controls, encrypted transport, backup/export, schema migrations y lifecycle de instalación/upgrades. Un módulo Foundry ordinario sigue siendo código cliente; “hacer un módulo” no basta. El host o servicio debe ejecutar la parte confiable.

Impacto comercial: instalación y soporte adicionales, diferencias entre self-hosted/managed hosting, política de datos, credenciales, upgrades y posibles incompatibilidades. También rompe el objetivo dependency-zero. Es reversible en el renderer/projection si el repository se mantiene tras una interfaz, pero migrar secretos requiere export/import seguro.

## 26. Recommended option and confidence

Si Level 2 permanece obligatorio, la recomendación técnica es Option B. Confianza: alta (0.9) en que los backends MtRol actuales no sirven; media-alta (0.8) en que un companion correctamente autenticado puede cumplir, porque aún falta especificar hosting y probar su frontera.

No se recomienda elegir automáticamente. La decisión humana debe aceptar dependencia, operación, backup y soporte, o cambiar explícitamente el requisito de confidencialidad. Option C sólo sería válida si el producto renuncia a reconstruir un Item secreto; Option A sólo si acepta Level 1.

## 27. Risk register

| Risk | Likelihood | Impact | Detection | Mitigation | Residual |
| --- | --- | --- | --- | --- | --- |
| Player receives secret snapshot | Alta con storage actual | Crítico | Spike Player sentinel/bootstrap/socket/fetch | Server boundary + allowlist projection | Baja sólo tras acreditación |
| Public/secret divergence | Media | Alta | Revision/fingerprint reconciliation | Secret authoritative, idempotent rebuild | Media |
| Primary GM handoff | Media | Alta | A→B tests y restart smoke | World-scoped backend, local context revalidation | Media; no server fencing probado |
| Crash between secret/public writes | Media | Alta | PENDING/receipt scan | Saga order, checkpoints, rebuild | Baja-media |
| Orphan public projection | Media | Alta | Public without secret scan | Fail closed, quarantine, sanitize/remove | Baja |
| Orphan secret record | Media | Media | Secret without public scan | Rebuild only ACTIVE; retain evidence | Baja |
| Duplicate groundId | Baja | Alta | Unique constraint/fingerprint conflict | Authority random ID + create-if-absent | Baja |
| Double pickup | Media | Crítico | Destination markers/receipts | ACTIVE→PICKUP_PENDING CAS, idempotency | Baja-media |
| Item loss during drop | Media | Crítico | Source quantity + checkpoints | Persist/verify PENDING before debit | Baja-media |
| Item duplication during pickup | Media | Crítico | Ground marker on destination + receipt | Verify credit, never blind retry | Baja-media |
| World restart | Media | Alta | Restart integration test | Durable backend + startup recovery | Baja tras prueba |
| Schema migration | Media | Alta | Version/fingerprint validation | Backup, fail closed, regenerate public | Media |
| External dependency unavailable | Media | Alta | Health/read check | Disable mutations, cached safe public only | Media |
| External backup omitted | Media | Crítico | Restore drill/integrity manifest | Coordinated export/backup | Media |
| Re-hide assumed to erase knowledge | Alta | Media | Security review | Explicit product copy and audit | Media |

## 28. Minimal implementation blast radius

Cuando exista backend aprobado, la implementación mínima debería tocar:

- schemas y funciones puras Ground;
- un repository Ground que adapte el backend seguro;
- un materializador de proyección pública en Scene;
- registro de cuatro commands en el `CommandRegistry` existente;
- handlers que usen `authorityService`, `transactionCoordinator`, `receiptStore` y `sharedReservationLedger` existentes;
- extensión del `RecoveryCoordinator` existente para un provider Ground;
- init para registrar schema/commands/recovery;
- tests y documentación.

Trade, Item Piles, oposición, iniciativa, turnos y renderer G2 quedan fuera. No se crea Ground manager/engine/coordinator/ledger/socket paralelo.

## 29. Expected conditional G1B files

Nombres orientativos, sujetos a la decisión del backend:

- `scripts/ground/ground-schemas.js`
- `scripts/ground/ground-secret-repository.js`
- `scripts/ground/ground-public-projection-repository.js`
- `scripts/ground/ground-reconciliation.js`
- `scripts/runtime/ground-commands.js`
- cambios pequeños en `scripts/core/init.js`, `scripts/runtime/runtime-foundation.js` y `scripts/runtime/recovery-coordinator.js`
- `tests/ground-schemas-g1b.test.mjs`
- `tests/ground-secret-repository-g1b.test.mjs`
- `tests/ground-projection-reconciliation-g1b.test.mjs`
- `tests/ground-authority-lifecycle-g1b.test.mjs`
- helper/manual Player boundary para el backend elegido.

`ground-secret-repository.js` sólo es justificable porque Ground persistence es una responsabilidad nueva. No debe envolver `game.settings` fingiendo Level 2.

## 30. G1B plan after the blocker is resolved

1. **G1B.0 — boundary accreditation:** elegir backend, definir threat/auth/backup contract y repetir spike con Player intentando todas las rutas directas.
2. **G1B.1 — schemas + persistence primitive:** pure schemas, groundId, create/read/CAS, restart and handoff contract; todavía sin Canvas.
3. **G1B.2 — repository CRUD + reload:** secret repository, receipt scope y immutable snapshot round trip.
4. **G1B.3 — public projection + reconciliation:** Scene projection allowlist, rebuild y divergence matrix.
5. **G1B.4 — authority integration:** commands, coordinator/ledger/recovery wiring; aún sin renderer/pickup UI.

No se salta G1B.0.

## 31. Tests required for G1B

Tests-first:

- create/read/update/CAS y reload;
- restart con instancia nueva y storage existente;
- groundId estable, unique y fingerprint conflict;
- snapshot Universal Item Transfer completo e inmutable para todos los Item types;
- public allowlist/minimization que falla ante `system`, flags, effects, fórmulas o provenance;
- Player real no recibe sentinel por bootstrap, update, socket, fetch directo, UUID ni endpoint del backend;
- secret exists/public missing; public exists/secret missing; ID/Scene/state/visibility/quantity mismatch;
- estados y transiciones legales, tombstone y cleanup retention;
- drop/pickup retry, lost ACK, crash en cada checkpoint e idempotencia;
- dos pickups concurrentes, drop vs Trade y Trade vs Ground;
- authority loss antes de cada efecto/checkpoint/compensación/completion y A→B→A;
- schema unknown/corruption fail closed;
- source Item sin mutación durante schema/repository tests;
- suites Trade 299 y `npm test` sin regresión.

El test de confidencialidad debe fallar si el Player logra recuperar el sentinel. Un test que sólo verifica que la UI no lo muestra es inválido.

## 32. Stop conditions for G1B

STOP inmediato si:

1. el snapshot entra en storage clase C sin aprobación explícita de Level 1;
2. Level 2 se degrada silenciosamente;
3. se necesita modificar Foundry core;
4. aparece otra autoridad de identidad;
5. aparece otro TransactionCoordinator o RecoveryCoordinator;
6. se confía en snapshot Player;
7. canonical state queda RAM-only;
8. public y secret se tratan como autoridades equivalentes;
9. no hay restart o handoff independiente de GM A;
10. pérdida/duplicación no converge a recovery;
11. renderer requiere snapshot secreto;
12. se amplía hacia Canvas/drop/pickup antes de acreditar repository;
13. credencial/key del backend llega al Player;
14. backup/export del componente externo queda indefinido;
15. compendium o FilePicker se aceptan sin spike Player de acceso directo.

## 33. Unresolved questions

- ¿Level 2 es requisito comercial no negociable o se acepta Level 1 para un MVP?
- ¿Se acepta un companion server y qué entornos de hosting debe soportar?
- ¿Cómo autentica el companion a un GM de Foundry sin secreto distribuido al Player?
- ¿El companion corre junto al host, como servicio administrado o ambos?
- ¿Cómo se incluye en backup/export/restore y ownership de datos?
- ¿Cuál es la retención de tombstones/receipts?
- ¿Quantity es pública para HIDDEN/REVEALED?
- ¿Qué campos exactos forman el DTO REVEALED?
- ¿Se exige server-side fencing/CAS además del fencing local acreditado?

## 34. GO / NO-GO

**NO-GO para G1B productivo en la arquitectura actual.** El modelo public/secret, identidad, lifecycle, invariantes y puntos de reutilización están definidos, pero falta la precondición central: un backend durable Level 2 acreditado. Scene flags pueden alojar la proyección pública; no pueden alojar el snapshot. Ningún repository actual puede hacerlo sin exponerlo.

Próximo paso permitido: decisión humana sobre el contrato de confidencialidad y, si se mantiene Level 2, diseño/acreditación de un componente server-side. No implementar G1, Ground Items, Canvas, drop ni pickup hasta resolverlo.

G1A BLOCKED — NO DURABLE SECRET AUTHORITY AVAILABLE IN CURRENT ARCHITECTURE.

# G1 — Ground confidentiality human decision

Fecha de decisión: 2026-09-12.

Estado: decisión arquitectónica registrada. Este documento no implementa G1B ni modifica código productivo.

## HUMAN DECISION — LEVEL 1 MVP

Se aprueba explícitamente que Ground Items MVP use **Level 1 — UI Privacy**. Level 2 Client Confidentiality no es requisito del MVP y queda diferido.

La decisión es consciente y se toma después de revisar:

- el G0 Player Confidentiality Spike;
- G1A Ground Persistence & Confidentiality Design;
- G1A.1 Foundry Server-Side Secret Authority Feasibility Audit.

La falta de una primitive Level 2 en el System actual deja de bloquear el MVP. Esta decisión no contradice ni reescribe la evidencia histórica: acepta expresamente su consecuencia para el producto.

## 1. Accepted evidence

Se acepta como acreditado para Foundry VTT v14.365:

- un System puro no proporciona storage durable Level 2;
- un Module estándar no es una trusted server boundary;
- los mecanismos Foundry auditados distribuyen información al Player;
- Scene flags, settings y otros mecanismos clase C no son secretos;
- `persistentStorage` y FilePicker no proporcionan confidencialidad;
- no se acreditó una API pública para server entrypoints privados de packages;
- Level 2 requeriría infraestructura first-party adicional y una nueva acreditación.

No se continuará buscando una primitive Level 2 inexistente dentro del System para iniciar Ground MVP.

## 2. MVP security contract

### HIDDEN / OCULTO

HIDDEN significa **privacidad de interfaz**.

En el flujo normal, un Player:

- ve `Objeto desconocido`;
- recibe únicamente la apariencia pública elegida;
- no ve en UI el nombre, descripción, stats, fórmulas, effects, flags ni metadata privada;
- puede recibir una apariencia genérica configurada por GM.

Un Player técnicamente avanzado puede inspeccionar con DevTools información subyacente que Foundry haya distribuido. Ésta es una limitación conocida y aceptada.

HIDDEN no debe describirse en UI, documentación ni código como secure, secret, server-private, confidential o Level 2.

### INVISIBLE

INVISIBLE significa que el Player no obtiene render, interacción ni inspector normales. También es Level 1: no garantiza ocultación de existencia o contenido frente a DevTools.

### REVEALED and re-hide

REVEALED entrega la información pública autorizada. Si un cliente ya recibió información real, volver el Ground a HIDDEN sólo cambia la UI y distribución futuras. No borra caches, logs, memoria ni conocimiento previo y no restaura confidencialidad histórica.

## 3. Required migration boundary

G1B debe mantener dos responsabilidades lógicas separadas:

```text
                         stable groundId
                              |
                  +-----------+-----------+
                  |                       |
                  v                       v
         Public Projection         Authority Record
         Canvas / Player UI        complete Item snapshot
         minimized safe DTO        quantity/lifecycle/evidence
```

Durante el MVP ambos lados podrán persistir mediante Foundry Level 1 storage distribuible. Compartir una frontera física no los convierte en una sola responsabilidad lógica.

La separación debe permitir que una migración futura cambie únicamente el adapter del Authority Record:

```text
MVP:     Authority Record -> Foundry Level 1 persistence adapter
Future:  Authority Record -> trusted Level 2 persistence adapter
```

Canvas, inspector, drag/drop UI y pickup UI no pueden leer directamente el storage físico del Authority Record. Deben consumir la Public Projection o contratos de dominio Ground. El cambio futuro no debe exigir rehacer `groundId`, Canvas, public projection, gameplay ni semántica transaccional.

La abstracción será Ground-specific y mínima. Esta decisión no autoriza una plataforma genérica de secretos, provider ecosystem, `GroundServer` ni backend framework.

## 4. Public Projection contract

La Public Projection aplica data minimization y contiene sólo lo necesario para:

- `groundId`;
- `sceneId`;
- posición;
- render y visibility de UI;
- pickup público efectivo;
- apariencia pública;
- interacción pública;
- lifecycle público mínimo, cuando sea necesario.

No copia por comodidad `system`, flags, effects, descripción, fórmulas, provenance ni metadata privada. Tampoco copia nombre o imagen real cuando la política pública no los autoriza.

## 5. Authority Record contract

El Authority Record continúa siendo la fuente lógica de verdad para:

- Universal Item Transfer Snapshot completo y reconstructible;
- `system`, flags, effects y metadata relevantes del Item;
- provenance necesaria;
- quantity Ground;
- lifecycle, receipts y recovery evidence.

El MVP permite que este record resida en storage Foundry conocido como distribuible. Esa distribución define el nivel de seguridad, pero no cambia la responsabilidad del record ni autoriza a otros consumidores a tratar la Public Projection como autoridad.

No se crea otro serializer. G1B debe usar Universal Item Transfer Data.

## 6. Canonical identity

`groundId` queda confirmado como identidad estable común. Debe ser generado por la autoridad, namespaced para el World y ajeno a nombre, imagen, posición o índice de array. Un Player no lo controla arbitrariamente.

Debe permanecer estable para public↔authority linkage, receipts, retries, recovery, tombstones y una migración Level 1→Level 2.

## 7. Trust boundary remains unchanged

La aceptación de Level 1 no modifica la autoridad G0:

```text
Player -> intent only -> Primary GM -> validation and canonical mutation
```

El Primary GM resuelve Actor e Item reales, valida ownership y quantity, genera `groundId`, crea el Universal Item Transfer Snapshot y ejecuta las mutaciones. Nunca se confía en un full Item snapshot enviado por Player.

Level 1 permite distribución de datos persistidos; no permite desplazar la autoridad de negocio al Player.

## 8. Existing G0 infrastructure

G1B debe reutilizar:

- `AuthorityService` y `AuthorityWriteContext`;
- el `TransactionCoordinator` existente;
- el `RecoveryCoordinator` existente;
- `CommandRegistry`;
- `ReceiptStore`;
- Universal Item Transfer Data;
- `SharedReservationLedger`.

No se autoriza un segundo selector de autoridad, transaction coordinator, recovery coordinator, receipt system, command registry ni socket architecture Ground paralela.

`SharedReservationLedger` mantiene exclusivamente inventory capacity y cross-domain exclusion. No se convierte en Ground lifecycle database.

## 9. Level 2 deferred

No se implementan ahora companion, backend, service, crypto, custom database, custom HTTP service ni external persistence.

Level 2 puede reconsiderarse si Ground realmente secreto, traps, hidden entities, procedural secret loot, anticheat, dedicated servers, commercial hosting u otro caso justifican una trusted server boundary first-party.

Antes de esa migración deben acreditarse al menos:

- autenticación y autorización independientes del payload Player;
- Player denial sobre reads/list/CAS y IDs adivinados;
- Primary GM handoff;
- service y World restart;
- idempotencia, CAS y recovery;
- backup/export/restore coordinado;
- compatibilidad de hosting;
- redacción de secretos en logs, errores, sockets y caches;
- version handshake y update/rollback.

Una migración futura protege operaciones futuras. No revoca datos ya distribuidos durante Level 1.

## 10. Resulting architecture status

| Area | Status |
| --- | --- |
| G0 | COMPLETE |
| G1A | COMPLETE |
| G1A.1 | COMPLETE |
| Human confidentiality decision | COMPLETE |
| Ground MVP confidentiality | LEVEL 1 — UI PRIVACY |
| Level 2 | DEFERRED |
| Migration boundary | REQUIRED |
| G1B | UNBLOCKED BUT NOT STARTED |

## 11. Authorized future G1B scope

Cuando exista una autorización separada, el plan es:

1. G1B.1 — Ground schemas y persistence primitive mínima;
2. G1B.2 — Ground Repository CRUD y reload persistence;
3. G1B.3 — public/authority reconciliation y recovery evidence;
4. G1B.4 — Primary GM y Command Registry integration;
5. después, G2 — Canvas Renderer y primer Ground visible seguro para Level 1.

Esta decisión desbloquea el plan; no lo inicia.

## 12. Changes made by this decision record

- documentación creada: este registro;
- documentación histórica referenciada: G1A y G1A.1;
- archivos productivos modificados: 0;
- schemas, repository, Scene flags, Documents, Canvas, Trade, ledger, sockets e Item Transfer modificados: 0;
- G1B implementation started: NO.

G1A HUMAN DECISION RECORDED — LEVEL 1 MVP APPROVED WITH LEVEL 2 MIGRATION BOUNDARY — G1B UNBLOCKED.

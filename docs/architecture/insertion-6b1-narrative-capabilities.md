# Inserción 6B.1 — Capacidades narrativas

Fecha: 2026-09-04. Sistema: 1.3.0, Foundry VTT v14.

## A. Auditoría inicial

- PassiveAssignmentResolver ya resuelve pasivas activas mediante providers y emite diagnósticos estructurados; no necesitó cambios.
- PassiveCatalog ya contenía CAPABILITY para comunicación, Ánima, vuelo y posesión. Posesión no tenía autorización para UI y continúa inactiva.
- Detección usaba DETECTION_CAPABILITY con ID `see_hidden_targets`; se conserva el ID y se normaliza el tipo.
- Alimentación era FEEDING_RESOURCE_RESTORE sin cantidad ni handler. Se sustituye exclusivamente esa declaración por CAPABILITY narrativa, siguiendo la regla actual, sin restauración de HP/MP.
- La hoja ya tiene identidad racial, pero no botones genéricos derivados de pasivas. Se agrega una lista junto a identidad sin rediseñar la hoja.
- ChatMessage y la clase visual `mtrol-chat-card` son reutilizables. No hay un flujo de aprobación necesario: basta declarar intención.
- AuthorityService, CommandRegistry, requestPrimaryGM y el socket autenticado ya existen. Se añade un command al mismo registro/transporte.
- ActorReceiptStore permite deduplicar concurrencia y replay sin crear coordinador ni persistencia de capabilities. Se usa exclusivamente su receipt de auditoría, separado de flags de gameplay.
- Foundry v14 usa `author` para ChatMessage: el autor documental es el GM autoritativo; el declarante real se identifica en contenido y flags.
- El estado inicial real tenía 1193 tests (1192 aprobados, 1 omitido), no los 1168 del documento de continuidad. Los cambios preexistentes se preservaron.

## B. Arquitectura final

Actor → resolveActivePassives → PassiveDefinitions → effects CAPABILITY con mode=narrative y requiresGmResolution=true → resolveNarrativeCapabilities → lista de botones.

El resolver no conoce raceId, no lee descripciones para identificar acciones y no modifica EffectResolver. Deduplica por capability ID y conserva passiveIds de origen. Los providers existentes permiten probar una pasiva futura de Despertar sin implementar selección de Despertar.

El click delega a `capability.narrative-declare`. Primary GM resuelve Actor/Token, comprueba ownership, revalida la capability activa y genera una tarjeta declarativa. Actor sin Token y sin escena está soportado. Un Token explícito debe pertenecer al Actor.

Las tarjetas se susurran al declarante y a todos los GM. No se publican a jugadores ajenos. El nombre de una escena no vista por el jugador se omite. No se inspeccionan targets, visibilidad, visión o secretos de otros Tokens.

La única persistencia añadida por una declaración es ChatMessage y el receipt de auditoría ya existente en flags.mtrol.transactionRuntime. No hay schema, migración, listado persistido de capabilities, cooldown ni flags de habilitación.

F5 reconstruye la lista desde pasivas activas. El replay usa receipt persistente o evidencia del ChatMessage, incluyendo una confirmación perdida tras crear la tarjeta y cambio de Primary GM. La UI bloquea envío concurrente y el segundo evento de doble click; no es un cooldown de gameplay.

## C–G. Capacidades

| Pasiva | ID técnico | Botón | Garantías |
|---|---|---|---|
| comunicacion_animal | speak_with_animals | Declarar Comunicación Animal | Sin Roll, diálogo con NPC, target ni control mental |
| anima | reshape_own_body | Declarar Ánima | Sin cambios de cuerpo persistidos, tamaño, colisiones o atributos |
| virtus | flight | Declarar Vuelo | Sin elevation/movimiento; recuperación mecánica de MP intacta |
| instinto_racial | see_hidden_targets | Declarar Detectar Ocultos | Sin revelar Tokens; iniciativa +10 exactamente una vez, independiente del botón |
| maldito_alimentacion | feed_on_living_being | Declarar Alimentarse | Sin víctima obligatoria, cantidades, HP/MP, edad, daño o cooldown; límites exclusivamente GM |

El ID de detección existente se conserva deliberadamente en lugar de duplicarlo como detect_hidden. Maldición de la Raza Maldito no concede Alimentarse ni un botón de posesión.

## H. Cambio de Raza

La lista se deriva en cada getData, no se copia al Actor. Elfo → Gnomo elimina Comunicación Animal; Gnomo → Hada agrega Vuelo; Hada → Animalium reemplaza Vuelo por Detectar Ocultos. Un click de una hoja desactualizada se rechaza en la autoridad si la pasiva ya no está activa.

## I. Autoridad

Owner puede declarar por su Actor; GM puede declarar por cualquier Actor autorizado por AuthorityService. Usuarios ajenos, capability falsa/inactiva, Token ajeno y payloads con cantidades/pasivas suministradas por el cliente se rechazan. El socket valida identidad real del emisor antes del command. Ninguna declaración consulta turno, acción consumida o pendingAction. No requiere Combat. Un jugador requiere Primary GM conectado, como las solicitudes autoritativas existentes.

## J. Archivos de esta inserción

### Creados

- scripts/effects/narrative-capability-resolver.js: derivación genérica y deduplicación.
- scripts/effects/narrative-capability-service.js: autoridad, revalidación, receipt y publicación.
- scripts/runtime/narrative-capability-commands.js: command y traducción al transporte existente.
- scripts/sheets/actors/personaje-narrative-controller.js: click, lock UI y feedback.
- scripts/ui/narrative-capability-card.js: presentación escapada, sin mecánicas.
- tests/narrative-capabilities-6b1.test.mjs: 23 pruebas nuevas.
- docs/architecture/insertion-6b1-narrative-capabilities.md: este informe.

### Modificados

- scripts/races/racial-passive-catalog.js: metadata narrativa de las cinco capacidades; sin alterar effects mecánicos.
- scripts/core/init.js: registro del command.
- scripts/core/sockets.js: ruta por transporte autenticado existente.
- scripts/sheets/actors/personaje-sheet.js: contexto derivado y delegación del click.
- templates/actors/personaje-sheet.html: sección dinámica junto a identidad racial.
- styles/sheets/personaje.css: estilos mínimos y acotados.
- tests/effect-resolver-expansion.test.mjs: expectativa del tipo de detección normalizado; conserva ID y prueba de ausencia de handler mecánico.

Eliminados: ninguno. No se modificó system.json; no se generaron release, ZIP, commit ni push.

## K. Tests

| Conjunto | Total | Aprobados | Fallidos | Omitidos |
|---|---:|---:|---:|---:|
| Base existente | 1193 | 1192 | 0 | 1 |
| Nuevos 6B.1 | 23 | 23 | 0 | 0 |
| Regresión final | 1216 | 1215 | 0 | 1 |

Cobertura específica: cinco declaraciones con snapshot de gameplay intacto dentro/fuera de combate, permisos Owner/GM, emisor falsificado, payloads inválidos, capabilities inactivas, cambio de Raza, reload simulado, providers futuros, duplicados, double click, cinco envíos simultáneos, pérdida de confirmación, cambio de GM, Actor sintético/sin Token/sin escena, contexto de escena, escape HTML, privacidad, command y transporte, contratos UI e iniciativa +10 antes/después del click.

La UI se verificó mediante resolver, controlador y contratos del template; no se realizó una sesión visual/multiplayer real de Foundry en esta inserción.

## L. Regresión

Suite global green: 46 Competencias y fórmulas @competencias/@atributos, 26 Clases y Aprendiz, 16 Razas, catálogos, EffectResolver, Sed de Batalla, Elemental, Inquebrantable, Frenesí, Instinto, Virtus, Maldición, Prodigio, Bendición, Subyugador, Celestial, Infinito y Awakening foundation. Pasaron también las suites existentes de combate, oposición, defensas, movimiento, turnos, recursos, daño, cooldowns, Preparación, críticos/pifias, Karma/Dharma, integraciones de dados/chat y PersonajeSheet.

git diff --check sin errores; advertencias LF/CRLF informativas.

## M. Deuda y límites

- Se conserva el skip preexistente que requiere clientes reales de Foundry; no se presenta como prueba multiplayer aprobada.
- No hay nuevas reglas de gameplay. El GM decide tiradas, dificultad, consumo y consecuencias manualmente.
- Los receipts tienen la retención del repositorio existente. No se promete replay indefinido después de purgar tanto receipt como ChatMessage.
- Si una declaración falla sin evidencia de Chat, la política existente de receipt fallido evita repetición automática incierta; requiere revisión, no aplica efectos mecánicos.
- Sin Despertar seleccionable, Trascendental, revive, transformación racial, cooldown por partidas, posesión, Habilidad I/II, Absolute Resolution, alineamientos ni Character Creator.
- No se inicia 6B.2.

## N. Resultado

READY — Inserción 6B.1 apta para continuar.

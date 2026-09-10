# Action Lifecycle P0 — auditoría de implementación

Fecha: 2026-09-07. Base instalada: 1.4.1; `system.json` no se modifica.
Pendiente de validación en Foundry real. No constituye autorización de release.

## A–B. Causa y flujo final

La brecha era de composición: crear la oposición, consumir MP y finalizar el
uso del turno eran operaciones separadas, terminadas desde la Sheet después
de tirar. La respuesta permitía omitir su consumo mediante `consumeResponse`.

Flujo de la Sheet para una oposición:

```text
intención con id estable, sin Roll local
  → commandRegistry: opposition.create
  → Primary GM: createPendingActionAuthoritative
  → transactionCoordinator: opposition.activation, cola por Actor
  → validación canónica de permiso, turno, Item, fórmula, target y respuestas
  → aplicarConsumoMP: servicio/recibo existente, id hijo estable
  → resolverCompetencia: Roll original en autoridad, consumo ya pagado
  → finalizeResolvedCompetenciaUse: cooldown/turno existentes
  → persistir pendingAction y completar recibo raíz
  → publicar/reconstruir la tarjeta y sincronizar
```

Las entradas legacy que suministran una tirada siguen pagando y consumiendo
acción por esta frontera. La Sheet ya no usa esa modalidad ni finaliza/cobra
la oposición a posteriori. No se agrega socket, motor de costes o estado de
acción paralelo: la reserva se deduce del recibo persistente existente.

## C–D. MP y actionConsumed

La autoridad valida MP durante preparación y vuelve a calcular antes del
débito. El recibo de activación en preparación/aplicación bloquea otra main
action antes del Roll. Después del Roll válido, el finalizador existente
consume `actionConsumed`, actualiza cooldown y asocia la resolución pendiente.
La oposición sólo se ofrece como respuesta cuando el recibo raíz y el de MP
están completos y consta la finalización de acción.

El snapshot de daño conserva el coste realmente cobrado, no un preview enviado
por el cliente. Lanzar daño no vuelve a cobrar la activación. Se conserva el
coste adicional básico de resolución y su excepción cuando ya fue incluido.
Stack, penalizadores, Meditar y follow-up físico conservan sus reglas.

## E–F. Respuestas e idempotencia

`opposition.respond` usa `opposition.response-activation`, con cola por
oposición y recibo hijo de MP. La elegibilidad identifica la reacción por
oposición pendiente y Actor objetivo; el finalizador reactivo conserva el turno
futuro. Declarar la respuesta no cobra. Ejecutarla siempre cobra, incluso con
`consumeResponse=false`. Auto se resuelve a la capability efectiva antes del
snapshot público.

La Sheet conserva el id ante ACK desconocido y bloquea doble clic en vuelo.
El coordinador comparte la misma operación para duplicados y devuelve el
resultado persistido en reintentos. Dos ids distintos compiten por la cola del
Actor; la segunda main action encuentra la reserva/acción consumida. Los
reintentos leen el pending actual para no restaurar estados antiguos.

## G. Fallos y recuperación

| Momento del fallo | Resultado |
| --- | --- |
| Permiso, configuración, target, turno o MP inválidos, antes de efectos | Rechazo sin Roll, débito ni oposición publicable; recibo fallido sin efectos. |
| Escritura de coste, Roll, cooldown, turno o pending interrumpidos | Recibo ambiguo/recovery-required; se conserva evidencia, se bloquea repetición y se notifica revisión del GM. |
| Débito confirmado pero falta consolidar el resto | No se reembolsa a ciegas ni se repite; MP/stack quedan registrados para revisión. |
| Resultado aplicado y sólo falta completar recibo | Recuperación del coordinador puede cerrar el recibo usando evidencia durable, sin repetir efectos. |
| ChatMessage falla después de consolidar | La acción permanece pagada/consumida; se registra fallo y se recupera presentación. |
| Cambio de Primary GM | Las fronteras comprueban autoridad; el nuevo GM recupera recibos completos o marca ambigüedad. Requiere ensayo multicliente real. |
| Pending legacy sin evidencia de activación/coste o respuesta consolidada | Se pone en recovery-required. No se inventa un pago retroactivo. |

No hay rollback automático entre documentos. Se adopta recuperación explícita
y conservadora mediante los recibos existentes. El daño exige evidencia de
activación y respuesta completas, también después de recarga. La tarjeta final
de respuesta se publica después de completar su recibo raíz.

## H–J. Tarjeta y privacidad

Se actualiza preferentemente el mensaje original, sin mantener una declaración
inicial desactualizada como tarjeta principal. La presentación consume el
snapshot; no vuelve a comparar resultados ni decide quién puede actuar.

| Estado | Contenido visible |
| --- | --- |
| waiting-defense | Iniciador, Item, total, modo, consecuencia configurada, objetivo y respuestas permitidas. |
| Respuesta declarada / resolving | Item de respuesta, capability efectiva, total cuando existe y consecuencia de respuesta. |
| resolved | Ganador y consecuencia canónica; desempate cuando corresponde. |
| waiting-damage (resolved con daño disponible) | Dueño real del daño, objetivo real y controles de lanzar/cancelar. Contraataque invierte correctamente los actores. |
| Movimiento de reacción disponible | Allowance concedido real y control para renunciar. |
| cancelled / recovery-required | Estado de cierre o revisión, sin botones de daño habilitado. |

Item y modo vienen de configuración canónica; `selectedCapability`, de la
declaración/eligibilidad efectiva; ganador, del resultado de oposición;
consecuencia, de `winnerResolutionResult`; dueño/target del daño, del entitlement.
No se publica daño final/HP, defensa restante, desgaste ni su Roll, ni detalles
internos de errores de daño. Se conservan las tiradas públicas de oposición y
desempate, y la noticia narrativa de escudo destruido.

## K–M. Archivos y verificación

Creados: `package.json` (sólo runner `npm test`, sin dependencias),
`scripts/actions/action-lifecycle-evidence.js` y este informe.

Modificados: `action-engine.js`, `action-damage-engine.js`,
`pending-action-presentation.js`, `competencia-engine.js`, `turn-system.js`,
`opposition-commands.js`, `recovery-coordinator.js`, `personaje-sheet.js`;
tests `opposed-damage-flow`, `shield-defense`, `runtime-foundation`,
`phase6-architecture-guardrails`, `chat-roll-breakdown` y
`combat-damage-manual-phase`. No se eliminan archivos.

Las expectativas antiguas de versión de dos tests se ajustan a la versión
instalada 1.4.1; no se cambia el manifest. Los mocks de escudo ahora representan
MP, fórmula y términos de Roll serializables. Las pruebas ya no pagan
manualmente después de crear pending, lo que ocultaba la brecha anterior.

La suite incluye MP20→15, MP insuficiente antes del Roll, ids concurrentes y
replay, stack una vez, fallos de persistencia, cambio de autoridad tras débito,
Defense/Dodge/Counterattack, auto efectivo, daño sin recobro, bloqueo mientras
hay resolución pendiente, follow-up físico y cuarentena de recibos incompletos.
Resultado de `npm test`: 1312 tests, 1311 passed, 0 failed y 1 skipped.
`git diff --check`: sin errores; `git diff --stat` y `git diff` revisados.

## N–P. Límites y validación runtime pendiente

Movimiento: **NO corregido y NO alterado funcionalmente** por este hotfix.
El síntoma A→B→A y su reconciliación/reserva siguen pendientes de investigación
runtime. Sólo se añaden guards de lifecycle al sistema compartido de turnos.
No se modifica `movement-service.js` ni su algoritmo, reservas o timeouts.

Continúa abierta la duplicación de tiradas remotas. El cambio evita duplicar
el cobro/ejecución del mismo intento; no declara resuelto ese defecto de chat.
La prueba Owner contra Owner permanece omitida porque requiere dos clientes.
No se ejecutaron validaciones manuales multicliente, ni se declara release-ready.
No se versiona, commitea, pushea, empaqueta ni publica.

Checklist de Foundry real:

1. Actor MP20 usa acción coste5: termina con MP15 y una oposición.
2. Intentar segunda main action: rechazada.
3. Objetivo responde Defense: permitida y cobra su coste canónico.
4. Objetivo responde Dodge: permitida; allowance visible coincide con el concedido.
5. Objetivo responde Counterattack: coste correcto, dueño y target del daño correctos.
6. Ganador lanza daño: no se recobra activación; básico adicional sólo si corresponde.
7. Mientras espera daño: otra main action permanece bloqueada.
8. La tarjeta muestra Item y capability reales, sin datos defensivos internos.
9. Respuesta Auto: se muestra la capability efectiva.
10. Empate: mismo mensaje actualiza desempate, ganador y consecuencia correctamente.
11. Recargar: reconstruye estado y tarjeta; recibos ambiguos bloquean y requieren GM.
12. Cambiar Primary GM, incluyendo durante activación: no duplica MP/acción ni reroll.

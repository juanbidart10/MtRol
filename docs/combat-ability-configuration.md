# Configuración de habilidades de combate en MTROL

Este manual describe la configuración canónica de un Item `competencia`. La regla central es: una acción ofensiva primero confronta su `formula`; sólo el ganador cuyo modo declara `resolutionResult: damage` obtiene el botón **Lanzar Daño** para resolver su `damageFormula`.

## Campos canónicos

- `formula`: tirada inicial de confrontación. Admite dados, críticos, pifias, Karma, Dharma, `@atributos`, `@competencias` y `@competenciasDado`. No es daño.
- `damageFormula`: tirada independiente de daño inicial. Admite el motor completo y además `@armas` y modifiers de daño. Sólo se lanza desde un derecho de daño.
- `capabilities`: capacidades reales del Item. Vocabulario actual: `OFFENSIVE`, `DEFENSE`, `DODGE`, `COUNTERATTACK`, `REACTION`, `MOVEMENT`.
- `allowedResponses`: familias que la acción iniciadora acepta: `DEFENSE`, `DODGE` y/o `COUNTERATTACK`. Una acción con resultado `damage` no puede dejar este campo vacío.
- `responseCapability`: preset cuando una respuesta posee más de una capability compatible. No agrega capabilities ni modifica `allowedResponses`.
- `actionDomain`: `PHYSICAL` o `MAGICAL`. Una acción ofensiva necesita uno.
- `responseDomain`: dominio de una respuesta ofensiva, especialmente un contraataque.
- `resolutionResult`: única consecuencia al ganar: `damage`, `defense`, `movement` o `utility`.
- `damageSourceAttribute`: atributo canónico que identifica el origen del daño para efectos posteriores; no reemplaza términos de la fórmula.
- `executionModes`: si una habilidad tiene varios modos, cada modo puede declarar su propio `resolutionResult` y `damageFormula`. El modo se elige y persiste antes de la tirada inicial.

Los campos legacy `danio`, `damageResolution`, `damageMode` y `ejecutaDanio` se leen sólo para migración. La configuración nueva usa `damageFormula`, oposición y lanzamiento manual.

## Capacidades y consecuencia al ganar

**Capacidades** responde a “¿qué sabe hacer y cómo puede utilizarse esta habilidad?”. Los botones con casilla se activan y desactivan con un clic o con el teclado. Podés marcar varios o ninguno. **Tipo** reúne Ofensiva, Defensa, Esquiva y Contraataque; **Propiedades** reúne Reacción y Movimiento. La separación es visual: se conserva una sola lista de capacidades y los Items existentes mantienen sus selecciones.

**Consecuencia al ganar** responde a “¿qué ocurre cuando gana esta ejecución?”. Elegí una sola opción entre **Daño**, **Defensa**, **Movimiento** y **Utilidad**. El texto bajo los botones explica la opción activa. La consecuencia principal requiere uno de esos valores; su valor inicial es Utilidad. No es lo mismo que las capacidades y no se cambia automáticamente al marcarlas.

| Ejemplo | Capacidades | Consecuencia |
| --- | --- | --- |
| Ataque ofensivo | Ofensiva | Daño: obtiene derecho a Lanzar Daño |
| Defensa | Defensa, Reacción | Defensa: evita la acción enemiga |
| Esquiva | Esquiva, Reacción, Movimiento | Movimiento: concede el movimiento configurado |
| Contraataque | Ofensiva, Contraataque, Reacción | Daño: obtiene derecho a Lanzar Daño |
| Acción de utilidad | Ofensiva, Reacción | Utilidad: resuelve un efecto sin daño directo |

Son ejemplos de configuración, no restricciones nuevas. Tener Ofensiva no obliga a elegir Daño. La selección de Daño mantiene las validaciones existentes de fórmula de daño, oposición y respuestas permitidas.

## Configurar las respuestas desde la hoja

**Respuestas permitidas** indica qué puede hacer el objetivo contra esta acción. Marcá las casillas visibles **Defensa**, **Esquiva** y **Contraataque** que quieras permitir. Por ejemplo, un ataque puede permitir las tres. El objetivo necesita además una habilidad compatible; marcar una casilla no se la concede. Las casillas guardan el mismo array `allowedResponses`, incluso vacío; las acciones con resultado de daño siguen exigiendo al menos una respuesta en su validación de ejecución.

**Tipo de respuesta de esta habilidad** indica cómo funciona esta misma habilidad cuando se usa como respuesta. No cambia lo que puede hacer el objetivo ni agrega capacidades:

- Sin capacidades de Defensa, Esquiva o Contraataque: la sección se oculta.
- Con una sola: se muestra su nombre sin selector, determinado automáticamente. Una Esquiva responde como `DODGE`.
- Con varias: elegí una mediante los botones de opción antes de guardar. Se conserva la elección compatible que ya tenga el Item. Si eliminás esa capacidad y quedan varias, elegí otra; si queda una, se deriva automáticamente.

La antigua opción **Automática** representaba un valor vacío: el motor sólo podía resolverlo cuando había una única respuesta compatible con el ataque. No significaba “permite todas”. Los Items históricos se pueden abrir sin migración; si tienen varias respuestas y ninguna elección válida, la hoja pide elegir una para guardar. No se agrega un diálogo durante el combate.

**Requiere oposición** aparece marcado y bloqueado cuando la consecuencia es **Daño**, conforme a la regla existente. Para las demás consecuencias sigue siendo editable. El guardado y el resolver de acciones mantienen la obligación para daño aunque se intente enviar `false`.

Un ataque con `allowedResponses: [DEFENSE, DODGE, COUNTERATTACK]` permite las tres familias al objetivo. Una habilidad con `capabilities: [DEFENSE, DODGE, REACTION]` y `responseCapability: DODGE` responde como Esquiva: son configuraciones independientes.

## Referencias de fórmula

`@atributos.fuerza` usa un atributo canónico. Un typo como `@atributos.fuerzzza` es error; no se transforma en cero.

`@competencias.combate_con_armas` conserva la semántica de Inserción 1. Por ejemplo, nivel 3 se resuelve como `(1d8 + 3)` con términos de dado reales. Una competencia inexistente aporta cero.

### Competencia completa o solamente su dado

Usá `@competencias.<technicalId>` para sumar **dado + bonus de nivel**. Usá `@competenciasDado.<technicalId>` cuando el diseño de la habilidad deba sumar **solamente el dado**, sin el bonus de nivel. Ambas referencias están disponibles en `formula` y `damageFormula` para las 46 competencias canónicas.

| Nivel | `@competencias` | `@competenciasDado` |
| --- | --- | --- |
| 1 | `(1d4 + 1)` | `1d4` |
| 2 | `(1d6 + 2)` | `1d6` |
| 3 | `(1d8 + 3)` | `1d8` |
| 4 | `(1d10 + 4)` | `1d10` |
| 5 | `(1d12 + 5)` | `1d12` |

Con Inteligencia 4 y Magia 5, `1d20 + @atributos.inteligencia + @competenciasDado.magia` equivale a `1d20 + 4 + 1d12`. El d12 llega al Roll sin evaluarse previamente y participa del desglose y las reglas generales de dados.

En daño, `1d20 + @atributos.fuerza + @competenciasDado.combate_con_armas + @armas` combina el dado de competencia con Fuerza y el daño de armas existente. También se pueden combinar ambos namespaces: con Magia 5, `@competencias.magia + @competenciasDado.magia` equivale a `(1d12 + 5) + 1d12`, conservando los dos dados.

La referencia usa `system.technicalId`, nunca el nombre visible. Una competencia ausente, con nivel inválido o duplicada aporta `0`. Conforme a la policy existente, un ID desconocido con formato válido también aporta `0`; no hay validación de pertenencia al catálogo en la fórmula. El nuevo namespace rechaza referencias incompletas como `@competenciasDado.` e IDs mal formados. No se migran ni sustituyen fórmulas existentes.

### Armas

`@armas` sólo se admite en `damageFormula`. Al pulsar **Lanzar Daño**, suma el daño plano de los Items únicos con `system.tipoObjeto: arma` referenciados por `manoIzq` y `manoDer`:

- sin armas: `0`;
- Espada 15: `15`;
- Espada 15 + Daga 10: `25`;
- el mismo Espadón 15 en ambas manos: `15`;
- Espada 15 + Escudo: `15`;
- Nudillos tipados como arma, daño 10: `10`;
- un arma eliminada o ya no equipada deja de sumar;
- un arma equipada exige daño entero entre 0 y 30; vacío, decimal, negativo, no numérico o 31 bloquea el Roll y conserva el derecho.

## Modifiers contextuales

Cada modifier conserva `sourceId`, `sourceType`, `label` y `value`. Los aditivos se incorporan a la fórmula efectiva antes del Roll y stackean normalmente. Ejemplo:

```text
damageFormula base: 1d20 + @atributos.fuerza + @competencias.combate_con_armas + @armas
+5 Habilidad
+3 Estado
-5 Diferencia de nivel
efectiva: 1d20 + @atributos.fuerza + @competencias.combate_con_armas + @armas + 5 + 3 - 5
```

**Diferencia de nivel** es exclusivamente contextual y de GM. El GM puede mantener `Shift` al ejecutar una habilidad para adjudicar `-5` a la fórmula inicial, a la tirada de daño o a ambas instancias. El Owner ve el término, pero no puede crearlo, retirarlo ni alterar su valor. Nunca se persiste como stat del Actor.

## Ciclo de oposición y daño

1. El jugador elige modo, si existe.
2. Se valida configuración, objetivo, dominio y respuesta técnicamente compatible.
3. Se lanza `formula` y nace `pendingAction` en `waiting-defense`.
4. El target declara una respuesta compatible y lanza su fórmula.
5. El motor compara ambos outcomes. Un empate muestra el overlay efímero, espera brevemente y lanza `1d10`: 1–5 atacante, 6–10 respuesta.
6. Se lee exclusivamente el `resolutionResult` del ganador.
7. `defense` evita la acción y termina el turno; `movement` concede un cuadro por cada 10 puntos y termina al completar; `utility` usa su infraestructura; `damage` crea un `damageEntitlement` persistido.
8. El Owner del Actor fuente del daño o un GM puede pulsar **Lanzar Daño**. Sólo el GM puede **Cancelar Daño**.
9. Lanzar resuelve a la vez `damageFormula` y localización, completa críticos/cadenas y recién entonces ejecuta: daño inicial → slot → armadura → mitigación → daño final → HP → efectos posteriores → receipt → fin de turno.

No hay timeout, derrota automática ni daño automático mientras se espera una respuesta. Un fallo técnico durante daño no avanza turno ni consume silenciosamente el derecho: queda disponible para corregir y reintentar, o el GM puede cancelarlo.

## Ejemplos de seteo

### Ataque físico — Corte de Espada

```yaml
formula: 1d20 + @atributos.fuerza + @competencias.combate_con_armas
damageFormula: 1d20 + @atributos.fuerza + @competencias.combate_con_armas + @armas
capabilities: [OFFENSIVE]
allowedResponses: [DEFENSE, DODGE, COUNTERATTACK]
actionDomain: PHYSICAL
resolutionResult: damage
damageSourceAttribute: fuerza
```

### Defensa — Bloqueo

```yaml
formula: 1d20 + @atributos.resistencia
damageFormula: ""
capabilities: [DEFENSE, REACTION]
responseCapability: DEFENSE
resolutionResult: defense
```

Ganar evita el ataque; no crea derecho de daño.

### Esquiva

```yaml
formula: 1d20 + @atributos.destreza
damageFormula: ""
capabilities: [DODGE, REACTION, MOVEMENT]
responseCapability: DODGE
resolutionResult: movement
```

Al ganar concede `floor(total / 10)` cuadros y no causa daño.

### Contraataque físico

```yaml
formula: 1d20 + @atributos.destreza + @competencias.combate_con_armas
damageFormula: 1d20 + @atributos.fuerza + @armas
capabilities: [OFFENSIVE, COUNTERATTACK, REACTION]
responseCapability: COUNTERATTACK
responseDomain: PHYSICAL
allowedResponses: [DEFENSE, DODGE, COUNTERATTACK]
resolutionResult: damage
```

Si gana, el responder es `damageSourceActor` y el iniciador es `damageTargetActor`.

### Hechizos

Un hechizo ofensivo usa `OFFENSIVE`, dominio `MAGICAL`, respuestas permitidas y `resolutionResult: damage`. Un hechizo reactivo defensivo usa `DEFENSE` o `DODGE`, `REACTION` y resultado `defense` o `movement`. Un hechizo utilitario usa `utility`. Tener una `damageFormula` no transforma por sí solo una consecuencia en daño.

### Habilidad con modos

```yaml
executionModes:
  - modeId: STRIKE
    label: Ataque
    resolutionResult: damage
    damageFormula: 1d20 + @atributos.fuerza + @armas
  - modeId: WITHDRAW
    label: Movimiento
    resolutionResult: movement
    damageFormula: ""
```

La selección queda fijada antes de conocer el resultado.

## Errores comunes

- `resolutionResult: damage` sin `damageFormula`;
- acción de daño sin `allowedResponses`, dominio o respuesta posible en el target;
- usar `@armas` en la fórmula inicial;
- atributo mal escrito;
- preset que el Item no declara en `capabilities`;
- contraataque con dominio incompatible;
- arma equipada con daño plano fuera de 0–30;
- pretender que `damageFormula` implica daño sin `resolutionResult: damage`;
- intentar cancelar como Owner o alterar el modifier de nivel sin ser GM.

La tarjeta pública de daño explica únicamente la construcción ofensiva: dados, atributo, competencia, `@armas`, modifiers, daño inicial y localización. Armadura, mitigaciones, daño final, HP, Virtus y Maldición se procesan internamente y no se publican en esa tarjeta.

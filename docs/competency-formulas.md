# Competencias en fórmulas

Las 46 Competencias oficiales poseen un `system.technicalId` canónico, estable e
independiente del nombre visible. Las fórmulas las referencian con:

```text
@competencias.<technicalId>
@competenciasDado.<technicalId>
```

Por ejemplo, `@competencias.magia` se mantiene válido aunque el Item se renombre.
La referencia es una expresión de dados, no el número de nivel:

| Nivel | Expresión |
| --- | --- |
| 1 | `1d4 + 1` |
| 2 | `1d6 + 2` |
| 3 | `1d8 + 3` |
| 4 | `1d10 + 4` |
| 5 | `1d12 + 5` |

La expansión de `@competencias` siempre se agrupa entre paréntesis. Así,
`2 * @competencias.magia` con Magia 5 equivale a `2 * (1d12 + 5)` y conserva el
`1d12` como dado real dentro de la misma Roll. Una Competencia ausente, con nivel
inválido o duplicada en el mismo Actor resuelve a `0`; los dos últimos casos emiten
un diagnóstico sin bloquear la tirada.

`@competenciasDado.<technicalId>` utiliza solamente el dado asociado al nivel de la Competencia, sin sumar el bonus de nivel: `1d4`, `1d6`, `1d8`, `1d10` o `1d12` para niveles 1–5. Comparte identidad técnica y manejo de ausencias, niveles inválidos y duplicados con `@competencias`. El namespace original conserva su fórmula completa.

Con Magia 5, `@competencias.magia + @competenciasDado.magia` se expande como `(1d12 + 5) + 1d12`. Ambos dados llegan al Roll y se evalúan allí. Se admite el nuevo namespace tanto en la tirada inicial como en daño, junto a atributos y, para daño, `@armas`. Un ID desconocido con formato válido resuelve a `0` según la policy actual; las referencias incompletas del nuevo namespace son inválidas.

Al cargar un mundo, el GM primario migra de forma determinista los Items oficiales
sin `technicalId` mediante el catálogo canónico. La operación sólo actualiza el
campo de identidad: no crea, elimina ni renombra Items. IDs desconocidos,
duplicados y nombres no pertenecientes al catálogo se reportan y no se alteran.

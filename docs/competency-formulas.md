# Competencias en fórmulas

Las 46 Competencias oficiales poseen un `system.technicalId` canónico, estable e
independiente del nombre visible. Las fórmulas las referencian con:

```text
@competencias.<technicalId>
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

La expansión siempre se agrupa entre paréntesis. Así,
`2 * @competencias.magia` con Magia 5 equivale a `2 * (1d12 + 5)` y conserva el
`1d12` como dado real dentro de la misma Roll. Una Competencia ausente, con nivel
inválido o duplicada en el mismo Actor resuelve a `0`; los dos últimos casos emiten
un diagnóstico sin bloquear la tirada.

Al cargar un mundo, el GM primario migra de forma determinista los Items oficiales
sin `technicalId` mediante el catálogo canónico. La operación sólo actualiza el
campo de identidad: no crea, elimina ni renombra Items. IDs desconocidos,
duplicados y nombres no pertenecientes al catálogo se reportan y no se alteran.

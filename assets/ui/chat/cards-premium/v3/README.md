# MtROL Cards Premium — Assets v3

Paquete visual precompuesto para las cards de tiradas de MtROL en Foundry VTT.

## Arquitectura

Cada PNG contiene el acabado visual completo: marco, metal, pátina, textura,
medallón, placa semántica, cámara de resultado, paneles de desglose y pie.

El CSS de integración no debe recrear bordes, gradientes, sombras, brillos,
texturas ni ornamentos. Sólo debe posicionar contenido dinámico, aplicar
Morpheus, adaptar el ancho y controlar la apertura del desglose.

## Formatos

- `compact`: card cerrada con resultado y acceso al desglose.
- `expanded`: card con un bloque de Roll desplegado.
- `composite`: card larga con dos bloques para daño, localización, tiradas
  enfrentadas u otras resoluciones múltiples.

## Familias normales

- `attack`: ataque dorado.
- `defense`: defensa borgoña.
- `damage`: daño carmesí.
- `healing`: curación verde.
- `spell`: hechizo violeta.
- `save`: salvación ámbar.
- `check`: prueba azul acero.
- `utility`: utilidad grafito/plata.

## Estados prioritarios

- `critical`: sustituye la familia normal cuando la tirada es crítica.
- `fumble`: sustituye la familia normal cuando la tirada es pifia.

## Contenido dinámico

Los assets no contienen palabras, números, dados ni iconos. El sistema debe
insertar el icono real de la acción, título, categoría, fórmula, resultado,
modificadores reales y el Roll nativo de Foundry. Esto conserva el desglose
clickeable y evita duplicar o inventar dados.

La selección exacta de archivos y dimensiones está documentada en
`manifest.json`.

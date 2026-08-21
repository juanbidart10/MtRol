# MtROL — Cards Premium v4

Este paquete reemplaza visualmente las cards anteriores. La referencia de calidad es la composición profesional con marco fino grabado, medallón superior, jerarquía tipográfica compacta, total central y panel inferior de desglose.

## Qué contiene

- 30 PNG runtime: 10 familias por cada formato `compact`, `expanded` y `composite`.
- Tres maestros sin escalar y tres bases runtime de 720 px.
- `manifest.json`: rutas, tamaños y reglas de selección.
- `layout.json`: zonas porcentuales medidas para HTML/CSS.
- `palette.json`: colores semánticos para Morpheus.
- `layout-contract.css`: contrato de integración, no una hoja que deba cargarse automáticamente.
- Previews sobre negro para auditar bordes y coherencia entre familias.

## Responsabilidad del asset y del renderer

El PNG contiene exclusivamente marco, metal, textura, medallón vacío, placas vacías, círculo rúnico, paneles y ornamentos. No contiene texto, iconos, dados, resultados ni modificadores falsos.

El renderer debe colocar:

1. El icono real de la acción dentro del medallón superior.
2. Título, categoría y fórmula reales.
3. El resultado final dentro del círculo rúnico central.
4. `CRÍTICO` o `PIFIA` en la placa de estado sólo cuando corresponda.
5. El DOM nativo de Foundry para el desglose de dados.
6. Únicamente los modificadores reales derivados de la fórmula evaluada.

El medallón superior nunca debe contener el total. El total pertenece al círculo rúnico central.

## Formatos

- `compact`: card cerrada, sin panel de dados.
- `expanded`: un Roll con panel de desglose.
- `composite`: dos Rolls relacionados, cada uno con su panel. Si hubiera más de dos, el renderer debe crecer mediante HTML/CSS o usar un subpanel controlado; no se debe deformar el PNG.

El desglose abierto debe aumentar la altura real de la card. No usar un contenedor exterior con altura fija ni `overflow: auto` sobre toda la card. La barra de scroll sólo puede existir dentro de un subpanel explícito cuando el contenido exceda el máximo decidido para ese subpanel.

## Instalación

Descomprimir el ZIP desde la raíz del sistema MtROL. Las rutas de producción quedan bajo:

`assets/ui/chat/cards-premium/v4/`

Morpheus no se incluye porque ya forma parte del sistema. Tampoco se incluyen imágenes de dados: el renderer debe conservar los dados y listeners nativos de Foundry.

## Reglas visuales innegociables

- No aplicar filtros, recoloreos CSS, gradientes ni sombras decorativas al PNG.
- No usar bordes CSS blancos o grises alrededor de la card, del Roll o del tooltip.
- No estirar un formato para simular otro.
- Mantener `background-size: 100% 100%` con el `aspect-ratio` correspondiente.
- La familia `fumble` tiene prioridad sobre `critical`; luego se usa la familia semántica normal.
- El texto usa Morpheus y el color indicado en `palette.json`.

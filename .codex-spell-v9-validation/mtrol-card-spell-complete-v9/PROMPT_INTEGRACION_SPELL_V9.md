Trabajá sobre `C:\FoundryVTT\Data\systems\mtrol`. En la raíz estará `mtrol-card-spell-complete-v9.zip`.

Descomprimilo temporalmente y copiá únicamente `assets/ui/chat/cards-premium/v9/spell.png` a la misma ruta dentro del sistema. No uses ningún asset de card v5, v6 o v7 para las tiradas clasificadas como hechizo.

`spell.png` es un único asset completo de 720 × 1440 que debe renderizarse a 303 × 606. Ya contiene marco, medallón, símbolo, placa `HECHIZO`, `RESULTADO`, círculo rúnico, panel `DESGLOSE DE DADOS`, guías de filas, `MODIFICADORES` y cuatro cubículos. No agregues capas independientes para esos elementos y no los reconstruyas con CSS.

El DOM dinámico debe superponer exclusivamente:

1. nombre del hechizo en el área superior vacía;
2. fórmula real debajo de la placa `HECHIZO`;
3. total final en el centro del círculo rúnico;
4. dados y resultados reales dentro de las tres guías;
5. valores reales dentro de los cuatro cubículos de modificadores.

Si existen menos de cuatro modificadores, dejá vacíos los cubículos restantes. Si existen más de cuatro, compactá los valores reales dentro de los cuatro cubículos sin aumentar la altura de la card; no crees cubículos ornamentales adicionales.

Cada dado debe aparecer una sola vez. No muestres simultáneamente un slot personalizado y el resultado nativo. No renderices `Resultado base sin crítico`, `Crítico en D10`, expresiones como `[D10: 9 x2]`, emojis, flags o textos de depuración.

El fondo se implementa como un único `<img class="mtrol-roll-card__art">` absoluto con `inset:0`, `width:100%`, `height:100%`, `object-fit:fill`, sin borde, filtro, sombra ni fondo adicional. Neutralizá pseudo-elementos decorativos heredados dentro de la card.

No reevaluar Rolls, no crear mensajes adicionales y no modificar cálculos. Agregá pruebas de dimensiones, ausencia de capas estáticas duplicadas, un único valor visible por dado y ausencia de diagnóstico técnico. Ejecutá suite completa, sintaxis y `git diff --check`. No hagas commit, tag o push.

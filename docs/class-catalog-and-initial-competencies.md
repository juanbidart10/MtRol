# Catálogo de Clases y Competencias iniciales

MtRol posee 26 Clases canónicas identificadas por un `technicalId` estable. El
catálogo autoritativo vive en `scripts/actors/class-registry.js` y declara el
nombre visible, el dominio y las Competencias iniciales de cada Clase.

Las 25 Clases normales garantizan tres Competencias canónicas en nivel 1. Este
grant representa adquisición inicial: no es un modificador dinámico. Una
Competencia existente se conserva sin duplicarse, subir o bajar de nivel, aunque
su nombre visible haya cambiado. Cambiar de Clase tampoco elimina progreso
histórico.

Aprendiz declara una estrategia de selección en vez de Competencias fijas:

- exactamente tres `technicalId` distintos del catálogo de 46 Competencias;
- nivel inicial 1;
- `classDomain` explícito: `physical`, `magical` o `hybrid`.

El selector existente continúa siendo exclusivo del GM. Al elegir Aprendiz abre
un diálogo mínimo para recoger el dominio y las tres selecciones. El servicio
autoritativo valida catálogo, estado actual y capacidad de creación antes de
escribir. Los Items faltantes se crean en un solo lote dentro de la transacción
existente de configuración de Clase.

Los duplicados históricos se reportan y conservan; nunca se crea un tercero. No
se ejecuta ninguna Habilidad I/II ni regla de resolución absoluta en esta fase.

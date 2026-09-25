// MARCO DE PINTADO DEL PATIO DEL INSTITUTO.
//
// El patio (`highSchoolCourtyard.js`) se diseñó como escenario de un juego de
// lucha 2D a 480x270, y está compuesto, medido y testeado contra ESE marco
// (ver tests/stage.test.mjs). Desde el paso a platform fighter ya no es el
// suelo que pisan los luchadores: es el FONDO LEJANO que se ve detrás del
// Patio Flotante (ver engine/backdrop.js y engine/stage.js).
//
// Estas constantes vivían en characters/character.js, que desapareció con el
// motor de lucha tradicional. Se quedan aquí, con sus valores de siempre,
// porque son las coordenadas en las que está PINTADO el patio — no tienen
// nada que ver con el mundo de 1280x720 en el que se pelea ahora.
export const STAGE_WIDTH = 480;
export const STAGE_HEIGHT = 270;
// La línea de los pies del antiguo combate: el patio deriva de aquí su
// horizonte (la base del polideportivo).
export const GROUND_Y = 200;
// Margen horneado a cada lado y por arriba para que el fondo cubra el
// recorrido de su propio parallax.
export const CAMERA_MARGIN_X = 160;
export const CAMERA_MARGIN_TOP = 110;

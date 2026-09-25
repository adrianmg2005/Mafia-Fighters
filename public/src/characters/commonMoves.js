// OPCIONES DE MOVILIDAD Y DEFENSA COMUNES A TODO EL ROSTER.
//
// Esquivas, opciones de borde, levantadas y techs son "movimientos" igual que
// un F-Tilt: una duración, una pose y ventanas de frames. Se escriben con el
// mismo formato que la moveTable de un personaje (ver characters/samuel.js)
// para que el Fighter los ejecute por el mismo camino, y un personaje puede
// sobrescribir cualquiera declarando la misma clave en su propia tabla.
//
// Convenciones de tabla (todas en FRAMES @60Hz y px/frame):
//   frames       duración total
//   intangible   { from, to }: ventana en la que ningún golpe conecta
//   drift        { from, to, vx }: velocidad horizontal forzada (vx > 0 = hacia
//                delante según facing) durante esa ventana
//   ledgePath    { frames, dx }: opción de borde; el cuerpo viaja desde la
//                posición de colgado hasta encima de la losa, `dx` px tierra
//                adentro desde el borde
//   hitboxes     igual que en un ataque (ver samuel.js)

export const commonMoves = {
  // --- Escudo (sección 3: Espacio/Shift) ----------------------------------
  spotdodge: {
    pose: 'crouch', frames: 22, intangible: { from: 3, to: 15 },
  },
  // Rodada: avanza y, si es hacia delante, termina mirando al otro lado (lo
  // decide el Fighter al arrancarla, igual que en Smash).
  roll: {
    pose: 'crouch', frames: 30, intangible: { from: 4, to: 18 }, drift: { from: 3, to: 22, vx: 3.8 },
  },
  // Esquiva aérea direccional: la velocidad la pone el Fighter según la
  // dirección mantenida; la tabla solo fija duración e intangibilidad.
  airdodge: {
    pose: 'jump_fall', frames: 34, intangible: { from: 3, to: 22 }, landingLag: 10,
  },

  // --- Borde (sección 1.C) -------------------------------------------------
  ledge_climb: {
    pose: 'wakeup', frames: 24, intangible: { from: 1, to: 20 }, ledgePath: { frames: 18, dx: 30 },
  },
  ledge_attack: {
    pose: 'lowsweep',
    frames: 34,
    intangible: { from: 1, to: 16 },
    ledgePath: { frames: 14, dx: 30 },
    // Barre la losa desde el borde: caja larga y baja por delante.
    hitboxes: [{
      from: 18, to: 22, x: 38, y: -22, w: 80, h: 34, damage: 8, bkb: 60, kbg: 20, angle: 45, sfx: 'hit_normal',
    }],
  },
  ledge_roll: {
    pose: 'crouch', frames: 34, intangible: { from: 1, to: 26 }, ledgePath: { frames: 28, dx: 110 },
  },

  // --- Derribo y techs (sección 2.C) ---------------------------------------
  getup: {
    pose: 'wakeup', frames: 26, intangible: { from: 1, to: 20 },
  },
  getup_attack: {
    pose: 'lowsweep',
    frames: 34,
    intangible: { from: 1, to: 18 },
    hitboxes: [
      {
        from: 16, to: 19, x: 38, y: -20, w: 60, h: 30, damage: 7, bkb: 60, kbg: 30, angle: 30, launchAway: true,
      },
      {
        from: 16, to: 19, x: -38, y: -20, w: 60, h: 30, damage: 7, bkb: 60, kbg: 30, angle: 30, launchAway: true,
      },
    ],
  },
  getup_roll: {
    pose: 'crouch', frames: 34, intangible: { from: 1, to: 24 }, drift: { from: 2, to: 26, vx: 3.2 },
  },
  tech: {
    pose: 'wakeup', frames: 26, intangible: { from: 1, to: 20 },
  },
  tech_roll: {
    pose: 'crouch', frames: 40, intangible: { from: 1, to: 24 }, drift: { from: 2, to: 30, vx: 3 },
  },
};

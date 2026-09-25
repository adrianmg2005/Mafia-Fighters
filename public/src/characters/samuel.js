// "Samuel" — HEAVYWEIGHT BRAWLER. El mecánico del callejón, ahora en un
// platform fighter: pesa como un motor (116), cuesta muchísimo sacarlo a
// porcentajes bajos y lo paga con la movilidad más torpe del juego y un
// recovery que es un solo pedo propulsado.
//
// Este archivo es SOLO DATOS (sección 4 del diseño). Toda la lógica —estados,
// física, carga de smash, contraataque, agarres— vive en characters/fighter.js
// y la interpreta genéricamente. Un personaje nuevo es otro archivo con esta
// misma forma.
//
// ============================================================================
// CÓMO SE LEE UNA ENTRADA
// ============================================================================
// Tiempos en FRAMES @60Hz, velocidades en px/frame (ver engine/physics.js).
//
//   pose        animación del atlas (engine/spriteAtlasBuilder.js)
//   frames      duración total del movimiento
//   hitboxes[]  { from, to, x, y, w, h, damage, bkb, kbg, angle, ... }
//               (x, y) = CENTRO de la caja respecto al centro del cuerpo a la
//               altura de los PIES; x hacia delante (se refleja con facing),
//               y negativa hacia arriba. Ventana `from..to` inclusiva.
//     group     golpes del mismo grupo conectan UNA vez por movimiento (por
//               defecto todos comparten grupo). Un multi-hit usa grupos
//               distintos: los tres ganchos del Nair son tres grupos.
//     setKb     knockback FIJO en vez de la fórmula (golpes de enganche)
//     reverse   lanza hacia atrás (la coz del Bair)
//     launchAway  lanza hacia el lado en que esté la víctima (barridos)
//     bury      contra un rival en el suelo, lo ENTIERRA (D-Tilt)
//     unblockable  atraviesa el escudo (Rap Battle Dash)
//     stopOnHit    al conectar, corta la deriva del que golpea: frena en seco
//     recoil    { vx, vy }: al conectar, el que golpea sale rebotado (vx hacia
//               delante: negativo = hacia atrás)
//     extraHitlag  frames de hitstop que se SUMAN al del golpe
//     impact    'invert' | 'redwhite': IMPACT FRAMES del golpe limpio
//               (presentación, ver engine/impactFrames.js)
//   next        { button, from, to, at, move }: pulsar `button` en la ventana
//               encadena `move` (Jab 1 -> Jab 2 -> ráfaga)
//   loop        el movimiento se repite mientras se mantenga el botón
//   charge      { frame, max, mul }: smash cargable (sección 3)
//   armor       { from, to, maxDamage }: Heavy Armor
//   counter     { from, to, move, multiplier, teleport?, freeze? }: ventana de
//               contragolpe. `teleport` aparece a la espalda del atacante
//               (parry); `freeze` = hitlag de la congelación
//               (12 por defecto)
//   landingLag  frames de aterrizaje si toca suelo a medio movimiento
//   airControl  fracción del control aéreo disponible durante el movimiento
//   velocity[]  { frame, vx?, vy?, vxScale?, vxFromInput? }: impulsos puntuales
//               (vx hacia delante; vxFromInput = deriva según la dirección
//               mantenida en ese frame)
//   helplessAirControl  control aéreo en la caída indefensa que provoca
//   drift       { from, to, vx }: velocidad horizontal forzada
//   dive        { from, to, vy }: velocidad vertical FORZADA, sin gravedad ni
//               deriva (el picado del Dair despertado)
//   spawn[]     { frame, projectile, x, y }: proyectiles (engine/projectiles.js)
//   fx[]        { frame, fx }: efectos de PRESENTACIÓN, sin efecto en la física
//
// ============================================================================
// CALIBRACIÓN
// ============================================================================
// Daño, BKB, KBG y ángulo son los del diseño, literales. El frame data
// (startup/activos/duración) no venía en el diseño y está escrito con el
// criterio de un peso pesado de Smash: startup largo en todo lo que mata, y
// el golpe rápido (jab, frame 4) es su única salida de presión.

import { commonMoves } from './commonMoves.js';

export const samuelStats = {
  weight: 116, // súper pesado: muere tarde
  walkSpeed: 2.4,
  dashSpeed: 5.2, // carrera
  // Dash inicial: 6.0 px/f los primeros 8 frames, más rápido que la carrera.
  // Es lo que hace reactivo el dash dance: las fintas se hacen con el dash
  // inicial, no corriendo.
  initialDashSpeed: 6.0,
  initialDashFrames: 4,
  maxAirSpeed: 3.6,
  // Movilidad aérea 0.55 px/f²: invertir la deriva cuesta ~13 frames. Estuvo
  // en 0.2 (~35 frames) para "vender el peso", y lo que vendía era no poder
  // corregir la trayectoria para volver a la losa. El peso se lee en la
  // caída, el knockback y el startup de sus golpes, no en el control.
  airAcceleration: 0.55,
  gravity: 0.58, // "fallSpeed" del diseño: la aceleración de caída
  maxFallSpeed: 11.0,
  groundJumpVelocity: -12.5,
  shortHopVelocity: -8.0,
  doubleJumpVelocity: -11.0,
  jumpSquatFrames: 3,
  // Cuerpo golpeable: más estrecho y bajo que el sprite (80x120). También es
  // el cuerpo físico contra las paredes de la losa.
  hurtboxWidth: 52,
  hurtboxHeight: 108,
  shieldMax: 50,
  finalMeterMax: 100,
};

export const samuelMoveTable = {
  ...commonMoves,

  // ##########################################################################
  // # A) NORMALES, TILTS Y AÉREOS                                            #
  // ##########################################################################

  // JAB 1 — puñetazo con guante de grasa.
  jab: {
    pose: 'jab',
    // 13 frames: el único golpe SEGURO en escudo a bocajarro (-3: el agarre
    // fuera de escudo sale en el 7 y llega tarde). Con 18 era castigable a
    // cualquier distancia, y la presión de un peso pesado se acababa en él.
    frames: 13,
    hitboxes: [{
      from: 4, to: 5, x: 34, y: -70, w: 38, h: 24, damage: 3, bkb: 15, kbg: 20, angle: 80, sfx: 'hit_light',
    }],
    next: {
      button: 'attack', from: 4, to: 13, at: 8, move: 'jab2',
    },
  },
  // JAB 2 — codazo de hollín.
  jab2: {
    pose: 'elbow',
    frames: 20,
    hitboxes: [{
      from: 4, to: 6, x: 36, y: -66, w: 42, h: 28, damage: 4, bkb: 20, kbg: 25, angle: 75, sfx: 'hit_normal',
    }],
    next: {
      button: 'attack', from: 4, to: 20, at: 9, move: 'jab_rapid',
    },
  },
  // JAB 3 — RÁFAGA de manotazos mecánicos: 1% por golpe mientras se mantenga
  // (o se machaque) U, con knockback FIJO bajo y ángulo rasante. El hitstun
  // de setKb 14 (floor(14*0.4) = 5 frames) iguala el bucle de 5 frames: es lo
  // justo para que el rival se quede enganchado y ni un frame más. Como
  // MÁXIMO 6 golpes (mínimo 3): al sexto, o al soltar U después del mínimo,
  // sale solo el remate. Estuvo en 24, y machacando U el rival se quedaba
  // enganchado 2 segundos (con 7, el séptimo ya no llega: la ráfaga lo ha
  // empujado fuera de la caja).
  jab_rapid: {
    pose: 'rapidjab',
    frames: 5,
    hitboxes: [{
      from: 2, to: 3, x: 40, y: -62, w: 52, h: 42, damage: 1, setKb: 14, angle: 20, sfx: 'hit_light',
    }],
    loop: {
      button: 'attack', grace: 8, min: 3, max: 6, exit: 'jab_finisher',
    },
  },
  // ...que remata con un empujón de panza.
  jab_finisher: {
    pose: 'bellybump',
    frames: 30,
    hitboxes: [{
      from: 6, to: 8, x: 40, y: -58, w: 52, h: 44, damage: 5, bkb: 45, kbg: 70, angle: 45, sfx: 'headbutt',
    }],
  },

  // F-TILT — patadón con bota de puntera de acero. Gran empuje horizontal.
  // Startup 7 (antes 9) y 18 de recovery (antes 22): el tilt con el que
  // Samuel gana el espacio a media distancia tiene que poder usarse en neutro.
  ftilt: {
    pose: 'bootkick',
    frames: 28,
    hitboxes: [{
      from: 7, to: 10, x: 46, y: -44, w: 58, h: 28, damage: 11, bkb: 35, kbg: 85, angle: 35, sfx: 'hit_heavy',
    }],
  },
  // U-TILT — barrido de 180° por encima de la cabeza con la llave grifa.
  // La caja llega a 150 px de altura: alcanza a quien esté de pie en una
  // semisólida (110 px por encima de la losa), que es para lo que existe.
  utilt: {
    pose: 'wrencharc',
    frames: 36,
    hitboxes: [{
      from: 8,
      to: 13,
      x: 0,
      y: -124,
      w: 124,
      h: 56,
      damage: 9,
      bkb: 40,
      kbg: 65,
      angle: 85,
      launchAway: true,
      vfx: 'metal',
      sfx: 'wrench',
    }],
  },
  // D-TILT — pisotón seco. Ángulo 280° contra un rival en el suelo: lo
  // ENTIERRA (combat.js#computeLaunch), tanto más tiempo cuanto más %.
  dtilt: {
    pose: 'stomp',
    frames: 26,
    hitboxes: [{
      from: 7, to: 9, x: 34, y: -10, w: 46, h: 22, damage: 8, bkb: 30, kbg: 45, angle: 280, bury: true, sfx: 'stomp',
    }],
    // Polvo y escombros del pisotón contra la losa, en el primer frame activo.
    fx: [{ frame: 7, fx: 'stompDust' }],
  },
  // DASH ATTACK — se tira de rodillas a meterse bajo un chasis.
  dashattack: {
    pose: 'lowsweep',
    frames: 40,
    drift: { from: 1, to: 16, vx: 5.8 },
    hitboxes: [{
      from: 8, to: 18, x: 32, y: -26, w: 60, h: 38, damage: 10, bkb: 50, kbg: 55, angle: 60, sfx: 'hit_normal',
    }],
  },

  // NAIR — giro con los brazos abiertos manchados de aceite. Multi-hit: tres
  // enganches de 2% (grupos a/b/c, knockback fijo para que no se escape) y el
  // golpe final de 4% que es el que lanza. Sale en el frame 6 y su caja es la
  // más ANCHA de sus aéreos (124x86, casi dos cuerpos): es el aéreo con el que
  // un peso pesado se defiende de las aproximaciones.
  nair: {
    pose: 'spin360',
    frames: 42,
    landingLag: 7,
    hitboxes: [
      {
        group: 'a', from: 6, to: 8, x: 0, y: -58, w: 124, h: 86, damage: 2, setKb: 18, angle: 70, sfx: 'hit_light',
      },
      {
        group: 'b', from: 11, to: 13, x: 0, y: -58, w: 124, h: 86, damage: 2, setKb: 18, angle: 70, sfx: 'hit_light',
      },
      {
        group: 'c', from: 16, to: 18, x: 0, y: -58, w: 124, h: 86, damage: 2, setKb: 18, angle: 70, sfx: 'hit_light',
      },
      {
        group: 'd',
        from: 23,
        to: 26,
        x: 0,
        y: -58,
        w: 128,
        h: 90,
        damage: 4,
        bkb: 35,
        kbg: 60,
        angle: 55,
        launchAway: true,
        vfx: 'oil',
        sfx: 'hit_normal',
      },
    ],
  },
  // FAIR — mazazo vertical descendente con la llave grifa. SWEETSPOT en la
  // mordaza metálica (la caja pequeña de la punta, que se comprueba PRIMERO)
  // con los números del diseño y chispas; el mango da un golpe más flojo.
  fair: {
    pose: 'hammer',
    frames: 46,
    landingLag: 8,
    hitboxes: [
      {
        from: 14, to: 18, x: 54, y: -38, w: 36, h: 36, damage: 13, bkb: 30, kbg: 88, angle: 45, vfx: 'metal', sfx: 'wrench',
      },
      {
        from: 14, to: 18, x: 24, y: -70, w: 40, h: 58, damage: 10, bkb: 30, kbg: 80, angle: 45, sfx: 'hit_normal',
      },
    ],
  },
  // BAIR — coz hacia atrás con giro de cadera. El aéreo más potente: K.O.
  // fuera del escenario. `reverse` lanza hacia la espalda de Samuel; la pose
  // (backkick) ya patea hacia atrás, sin espejar el sprite.
  bair: {
    pose: 'backkick',
    frames: 38,
    landingLag: 7,
    hitboxes: [{
      from: 9, to: 12, x: -46, y: -52, w: 56, h: 38, damage: 14, bkb: 42, kbg: 95, angle: 40, reverse: true, sfx: 'hit_heavy',
    }],
  },
  // UAIR — eructo sónico en cono hacia el techo. Remata por la blast zone
  // superior.
  uair: {
    pose: 'burpup',
    frames: 40,
    landingLag: 6,
    hitboxes: [{
      from: 8, to: 13, x: 4, y: -150, w: 86, h: 66, damage: 11, bkb: 45, kbg: 90, angle: 90, vfx: 'sonic', sfx: 'burp',
    }],
    fx: [{ frame: 8, fx: 'burpCone' }],
  },
  // DAIR — METEOR SMASH. Se deja caer de culo con una explosión de gas: un
  // frenazo en el aire (frame 8) y luego se desploma, con la caja por debajo
  // de los pies a 270° — spike vertical hacia el abismo.
  dair: {
    pose: 'buttslam',
    frames: 50,
    // El meteoro es el único aéreo por encima de 8: estrellarse con él contra
    // la losa tiene que costar algo, o sería un golpe sin riesgo.
    landingLag: 10,
    velocity: [{ frame: 8, vy: -3 }, { frame: 13, vy: 7 }],
    // SWEETSPOT en la BASE (justo bajo el culo): el meteoro. Los bordes de la
    // nube son la parte floja: menos daño y lanzan hacia el lado en vez de
    // hundir. El sweetspot va PRIMERO: si tocan los dos, gana él.
    hitboxes: [
      {
        from: 14, to: 20, x: 0, y: 10, w: 28, h: 30, damage: 12, bkb: 35, kbg: 82, angle: 270, vfx: 'gas', sfx: 'gas_blast',
      },
      {
        from: 14, to: 20, x: 0, y: 8, w: 64, h: 42, damage: 8, bkb: 30, kbg: 70, angle: 45, launchAway: true, vfx: 'gas', sfx: 'hit_normal',
      },
    ],
    fx: [{ frame: 14, fx: 'gasBurst' }],
  },

  // ##########################################################################
  // # B) SMASH ATTACKS (I + dirección), cargables hasta 60 frames (x1.4)     #
  // ##########################################################################
  // `charge.frame` es el frame en que se congela la animación mientras se
  // mantiene I. La carga multiplica el DAÑO; el knockback crece a través de
  // la fórmula, que ya depende del daño (ver Fighter#hitboxDamage).

  // F-SMASH — "Bateo de Cigüeñal". 19% -> 26.6% con carga máxima. Ángulo
  // Sakurai (361): a bajo % empuja por el suelo, a alto % levanta.
  fsmash: {
    pose: 'crankswing',
    frames: 56,
    charge: { frame: 9, max: 60, mul: 1.4 },
    // SWEETSPOT en la PUNTA del cigüeñal (68..100 px por delante): es el
    // golpe calibrado de la tabla de umbrales. Pegado al cuerpo, el mango es
    // la parte floja. La punta va PRIMERO: si tocan las dos, gana ella.
    hitboxes: [
      {
        from: 17, to: 20, x: 84, y: -60, w: 32, h: 34, damage: 19, bkb: 6, kbg: 112, angle: 361, vfx: 'metal', sfx: 'clank',
      },
      {
        from: 17, to: 20, x: 42, y: -60, w: 48, h: 34, damage: 15, bkb: 6, kbg: 100, angle: 361, vfx: 'metal', sfx: 'hit_heavy',
      },
    ],
    // Chispas de fricción del bateo, en el primer frame activo.
    fx: [{ frame: 17, fx: 'crankSparks' }],
  },
  // U-SMASH — "Pistón Neumático". 17% -> 23.8%.
  usmash: {
    pose: 'uppercut',
    frames: 52,
    charge: { frame: 7, max: 60, mul: 1.4 },
    hitboxes: [{
      from: 14, to: 19, x: 6, y: -140, w: 54, h: 100, damage: 17, bkb: 50, kbg: 116, angle: 88, vfx: 'metal', sfx: 'clank',
    }],
  },
  // D-SMASH — "EL SILLAZO GAMER". 15% -> 21%. Carga con la silla gamer en
  // alto (agarrada por la base de las ruedas y el pistón) y la estrella de
  // respaldo contra el suelo: escombros y polvo a los dos lados.
  dsmash: {
    pose: 'chairslam',
    frames: 60,
    charge: { frame: 10, max: 60, mul: 1.4 },
    hitboxes: [
      {
        from: 19, to: 22, x: 50, y: -16, w: 66, h: 34, damage: 15, bkb: 18, kbg: 80, angle: 28, launchAway: true, sfx: 'barrel_slam',
      },
      {
        from: 19, to: 22, x: -50, y: -16, w: 66, h: 34, damage: 15, bkb: 18, kbg: 80, angle: 28, launchAway: true, sfx: 'barrel_slam',
      },
    ],
    fx: [{ frame: 19, fx: 'chairDust' }],
  },

  // ##########################################################################
  // # C) ESPECIALES (O + dirección)                                          #
  // ##########################################################################

  // O NEUTRO — "Eructo Sónico Cargable". Pulsar O empieza a inhalar; volver a
  // pulsarlo suelta el eructo con el nivel alcanzado y el ESCUDO guarda la
  // carga para más tarde (como el Disparo Cargado de Samus). En el aire no se
  // carga: suelta lo que hubiera guardado (nivel 1 como mínimo).
  nspecial: {
    pose: 'inhale',
    chargeShot: {
      framesPerLevel: 30,
      maxFrames: 90,
      levels: ['nspecial_l1', 'nspecial_l2', 'nspecial_l3'],
    },
  },
  nspecial_l1: {
    pose: 'burp',
    frames: 34,
    landingLag: 8,
    hitboxes: [{
      from: 10, to: 14, x: 54, y: -66, w: 62, h: 42, damage: 5, bkb: 25, kbg: 30, angle: 45, vfx: 'gas', sfx: 'burp',
    }],
    fx: [{ frame: 10, fx: 'burpSmall' }],
  },
  nspecial_l2: {
    pose: 'burp',
    frames: 38,
    landingLag: 8,
    hitboxes: [{
      from: 10, to: 15, x: 64, y: -66, w: 86, h: 56, damage: 12, bkb: 40, kbg: 65, angle: 42, vfx: 'gas', sfx: 'burp',
    }],
    fx: [{ frame: 10, fx: 'burpMedium' }],
  },
  // Nivel 3 — "ERUCTO NUCLEAR": gran área de gas ácido y sacudida de pantalla.
  nspecial_l3: {
    pose: 'burp',
    frames: 46,
    landingLag: 10,
    hitboxes: [{
      from: 12, to: 18, x: 86, y: -64, w: 144, h: 92, damage: 22, bkb: 55, kbg: 105, angle: 40, vfx: 'gas', sfx: 'gas_blast',
    }],
    fx: [{ frame: 12, fx: 'burpNuclear' }],
  },

  // A/D + O — "EL COJÍN DONUT". Embiste con un cojín con forma de donut rosa
  // gigante por delante, con HEAVY ARMOR: aguanta sin hitstun cualquier golpe
  // de 12% o menos (el daño sí entra). Volver a pulsar O lanza el donut
  // girando: rebota en el suelo (dos botes) y golpea con 14%.
  sspecial: {
    pose: 'special',
    frames: 52,
    landingLag: 10,
    continueOnLand: true,
    armor: { from: 3, to: 40, maxDamage: 12 },
    drift: { from: 8, to: 40, vx: 5.5 },
    hitboxes: [{
      from: 8, to: 40, x: 32, y: -58, w: 46, h: 66, damage: 10, bkb: 50, kbg: 60, angle: 40, sfx: 'clank',
    }],
    next: {
      button: 'special', from: 10, to: 40, at: 10, move: 'sspecial_throw',
    },
  },
  sspecial_throw: {
    pose: 'hook',
    frames: 32,
    landingLag: 8,
    continueOnLand: true,
    spawn: [{
      frame: 8, projectile: 'donutCushion', x: 36, y: -72,
    }],
  },

  // W + O — "EL ABRAZO AÉREO" (Flying Slam). Salta a -16.5 px/f con los
  // brazos abiertos hacia arriba, buscando atrapar. La subida es la de
  // siempre (angulable: la dirección del frame 6 da 2.6 px/f de deriva;
  // helpless en el ápice con el 85% del control aéreo): sigue siendo SU
  // recuperación, y la del rival de referencia con el que se calibran los
  // K.O. (sección 3 de CLAUDE.md).
  //
  // Los brazos son un AGARRE DE COMANDO (`commandGrab`, no lo para el
  // escudo): una caja generosa sobre el torso y los brazos alzados, activa
  // TODA la subida (del frame 4 al ápice). En el aire
  // atrapa a un rival que esté en el aire; saliendo DESDE EL SUELO atrapa
  // también a uno en el suelo (al recuperar desde abajo, nunca al que está de
  // pie en la losa: ese es el que le hace edge-guard y el de las
  // calibraciones). Si engancha, `uspecial_slam`: lo lleva en brazos hasta
  // lo más alto del salto, parón de 3 frames, se voltean y caen en picado; al
  // tocar suelo o tablón lo ESTAMPA (onda de choque a los dos lados, 14%).
  // Fuera de la losa no hay suelo: caen juntos al abismo.
  uspecial: {
    pose: 'flyingslam',
    frames: 90,
    airControl: 0.85,
    helplessAtApex: 7,
    helplessAirControl: 0.85,
    velocity: [{
      frame: 6, vy: -16.5, vxScale: 0.5, vxFromInput: 2.6,
    }],
    hitboxes: [{
      from: 4, to: 34, x: 22, y: -100, w: 116, h: 140, grab: true, commandGrab: 'uspecial_slam',
    }],
    fx: [{ frame: 6, fx: 'slamJump' }],
  },
  uspecial_slam: {
    pose: 'slamdive',
    frames: 240, // cae hasta tocar suelo o salir por abajo
    landingLag: 22,
    // Con él en brazos SIGUE su salto hasta el ápice (si lo ha enganchado en
    // el suelo, despega con el mismo -16.5), 3 frames de parón en lo alto, y
    // picado a 18 px/f.
    slam: {
      launchVy: -16.5, hang: 3, vy: 18, damage: 14, bkb: 70, kbg: 60, angle: 40, risePose: 'flyingslam',
    },
  },

  // S + O — "EL PEDO ATÓMICO" (Wario Waft). Se agacha, flexiona las piernas y
  // detona una nube densa de gas bajo el cuerpo: una caja grande bajo él y a
  // los lados, con el golpe fuerte PEGADO al cuerpo (la caja de dentro va
  // primero) y la parte floja en el borde de la nube. La detonación lo
  // catapulta hacia arriba (-17.5 px/f: sube más que el Up-B), en el suelo o en
  // el aire.
  dspecial: {
    pose: 'waft',
    frames: 56,
    landingLag: 12,
    airControl: 0.6,
    velocity: [{ frame: 12, vy: -17.5 }],
    hitboxes: [
      {
        from: 12, to: 16, x: 0, y: -24, w: 120, h: 96, damage: 18, bkb: 55, kbg: 88, angle: 60, launchAway: true, vfx: 'gas', sfx: 'gas_blast',
      },
      {
        from: 12, to: 16, x: 0, y: -20, w: 230, h: 120, damage: 9, bkb: 40, kbg: 60, angle: 45, launchAway: true, vfx: 'gas', sfx: 'gas_blast',
      },
    ],
    fx: [{ frame: 12, fx: 'waftBlast' }],
  },

  // ##########################################################################
  // # AGARRE Y LANZAMIENTOS (tecla J)                                         #
  // ##########################################################################
  // El diseño no fija números para los lanzamientos; están escritos para dar
  // a cada dirección un papel: adelante y atrás mandan fuera, arriba sube al
  // rival hacia el Uair y abajo es el lanzamiento de combo (ángulo 70°, poco
  // crecimiento: al 0-40% cae justo delante).
  grab: {
    pose: 'jab',
    frames: 32,
    hitboxes: [{
      from: 7, to: 8, x: 36, y: -60, w: 44, h: 58, grab: true,
    }],
  },
  pummel: {
    pose: 'headbutt', frames: 14, pummel: { frame: 5, damage: 1.5 },
  },
  fthrow: {
    pose: 'sidekick',
    frames: 30,
    throw: {
      frame: 10, damage: 9, bkb: 60, kbg: 60, angle: 45,
    },
  },
  bthrow: {
    pose: 'smokespin',
    frames: 34,
    throw: {
      frame: 14, damage: 11, bkb: 60, kbg: 70, angle: 45, reverse: true,
    },
  },
  uthrow: {
    pose: 'launcher',
    frames: 36,
    throw: {
      frame: 14, damage: 7, bkb: 70, kbg: 60, angle: 90,
    },
  },
  dthrow: {
    pose: 'stomp',
    frames: 34,
    throw: {
      frame: 16, damage: 6, bkb: 80, kbg: 40, angle: 70,
    },
  },

  // ##########################################################################
  // # D) FINAL SMASH — "BATALLA DE GALLOS" (tecla P con el medidor lleno)    #
  // ##########################################################################
  // Onda sónica frontal. Si atrapa a un rival: cinemática de 90 frames
  // (cadenas, gorra rapera, Mic Drop): 42% en total, repartido entre los
  // compases del rap (`pulses` golpes de `pulseDamage`) y la detonación, que
  // lanza con el resto (30%) hacia la blast zone lateral.
  final: {
    pose: 'micshout',
    frames: 60,
    intangible: { from: 1, to: 24 },
    spawn: [{
      frame: 16, projectile: 'sonicWave', x: 44, y: -58,
    }],
    finalSmash: {
      cinematicFrames: 90,
      damage: 42, // TOTAL: pulsos + detonación
      pulses: 3,
      pulseDamage: 4,
      bkb: 4,
      kbg: 148,
      angle: 38,
      transformPose: 'rapintro',
      attackerPose: 'rap',
      victimPose: 'earpain',
    },
  },
};

// ============================================================================
// MODO DESPERTADO — "el rapero chetado" (10 s tras la cinemática de la Ñ)
// ============================================================================
// Mientras dura, el Fighter lee ESTOS stats y ESTA tabla en vez de los de
// arriba (ver Fighter#stats / Fighter#moves). Lo que no se sobrescribe es lo
// de siempre: tilts, Nair, Bair, Uair, agarres, esquivas.

// Buffs pasivos. Literales, con el multiplicador del diseño al lado.
export const samuelAwakenedStats = {
  dashSpeed: 6.5, // carrera x1.25 (5.2)
  maxAirSpeed: 4.32, // velocidad aérea x1.2 (3.6)
  airJumps: 3, // tres saltos aéreos en vez de uno
  // HEAVY ARMOR PASIVA: un golpe de MENOS de 8% no le hace retroceder ni le
  // aturde (el % sí entra), en cualquier estado.
  passiveArmor: 8,
};

export const samuelAwakenedMoveTable = {
  ...samuelMoveTable,

  // JAB — "PUNCHLINE METRALLETA". Micro dorado a la boca en una mano y
  // ráfaga de puñetazos al aire con la otra: 6 golpes de 2% (un bucle de 6
  // vueltas de 4 frames que sale con UNA pulsación) que RETIENEN (knockback
  // fijo y rasante: hitstun floor(15·0.4) = 6, más que el bucle, y lo justo
  // para aguantar hasta el remate) y el remate, el micrófono estampado contra
  // el suelo, que manda a ras de suelo. 6 x 2 + 6 = 18% en total.
  jab: {
    pose: 'micjab',
    frames: 4,
    hitboxes: [{
      from: 2, to: 2, x: 48, y: -66, w: 40, h: 44, damage: 2, setKb: 15, angle: 20, vfx: 'sonic', sfx: 'hit_light',
    }],
    fx: [{ frame: 2, fx: 'rhymeBars' }],
    loop: {
      button: 'attack', grace: 0, min: 6, max: 6, exit: 'jab_finisher',
    },
  },
  jab_finisher: {
    pose: 'micslam',
    frames: 28,
    hitboxes: [{
      from: 4, to: 6, x: 68, y: -34, w: 64, h: 68, damage: 6, bkb: 55, kbg: 55, angle: 0, vfx: 'sonic', sfx: 'mic_drop',
    }],
    fx: [{ frame: 4, fx: 'micCrater' }],
  },

  // F-SMASH — "DROP THE MIC". Carga con el brazo atrás (pose de hip-hop) y
  // estrella el micro dorado contra el suelo delante: cráter de energía y una
  // explosión sónica VERTICAL. SWEETSPOT en la cabeza del micro (la caja de
  // delante, que va primero); el brazo es la parte floja. En el golpe limpio,
  // 3 IMPACT FRAMES: pantalla invertida en blanco y negro con la estrella roja
  // en el punto de impacto. Mata desde el centro a partir del 65% (rival de
  // referencia, ver tests).
  fsmash: {
    pose: 'micslam',
    frames: 58,
    charge: { frame: 10, max: 60, mul: 1.4 },
    hitboxes: [
      {
        from: 18, to: 21, x: 68, y: -34, w: 64, h: 68, damage: 22, bkb: 70, kbg: 152, angle: 80, impact: 'invert', vfx: 'sonic', sfx: 'mic_drop',
      },
      {
        from: 18, to: 21, x: 26, y: -66, w: 40, h: 44, damage: 16, bkb: 50, kbg: 120, angle: 60, vfx: 'sonic', sfx: 'hit_heavy',
      },
    ],
    fx: [{ frame: 18, fx: 'micCrater' }],
  },

  // U-SMASH — "ERUCTO SÓNICO SUBWOOFER". Echado atrás agarrándose la barriga,
  // eructa en vertical: un CAÑÓN de ondas en cono de 60° que llega por encima
  // de las semisólidas (la caja de arriba cruza la altura de los tablones y
  // la de un rival de pie en ellos). La base del cono alcanza a quien esté
  // pegado a él en el suelo. Lanza recto arriba: mata desde el 70%.
  usmash: {
    pose: 'burpsky',
    frames: 56,
    charge: { frame: 8, max: 60, mul: 1.4 },
    hitboxes: [
      { from: 16, to: 22, x: 0, y: -84, w: 132, h: 76, damage: 18, bkb: 70, kbg: 155, angle: 90, vfx: 'sonic', sfx: 'burp' },
      { from: 16, to: 22, x: 0, y: -172, w: 160, h: 100, damage: 18, bkb: 70, kbg: 155, angle: 90, vfx: 'sonic', sfx: 'burp' },
      { from: 16, to: 22, x: 0, y: -282, w: 290, h: 120, damage: 18, bkb: 70, kbg: 155, angle: 90, vfx: 'sonic', sfx: 'burp' },
      { from: 16, to: 22, x: 0, y: -392, w: 420, h: 100, damage: 18, bkb: 70, kbg: 155, angle: 90, vfx: 'sonic', sfx: 'burp' },
    ],
    fx: [{ frame: 16, fx: 'subwoofer' }],
  },

  // D-SMASH — "BREAKDANCE TERREMOTO". Se tira al suelo en un molino de
  // breakdance con las piernas abiertas y remata de culo: dos ondas de humo y
  // polvo barren el suelo a los DOS lados a la vez, y lanzan en diagonal baja
  // (25°), la que saca de la losa sin dar altura para volver.
  dsmash: {
    pose: 'windmill',
    frames: 56,
    charge: { frame: 9, max: 60, mul: 1.4 },
    hitboxes: [
      {
        from: 17, to: 21, x: 56, y: -16, w: 80, h: 32, damage: 16, bkb: 45, kbg: 82, angle: 25, launchAway: true, sfx: 'stomp',
      },
      {
        from: 17, to: 21, x: -56, y: -16, w: 80, h: 32, damage: 16, bkb: 45, kbg: 82, angle: 25, launchAway: true, sfx: 'stomp',
      },
    ],
    fx: [{ frame: 17, fx: 'breakDust' }],
  },

  // F-AIR — "DROPKICK". Las dos piernas por delante, de lucha libre. Si
  // conecta: 4 frames MÁS de hitstop y Samuel sale rebotado hacia atrás.
  fair: {
    pose: 'dropkick',
    frames: 40,
    landingLag: 9,
    hitboxes: [{
      from: 9, to: 13, x: 48, y: -50, w: 64, h: 44, damage: 15, bkb: 40, kbg: 90, angle: 38, extraHitlag: 4, recoil: { vx: -5.5, vy: -5 }, sfx: 'hit_heavy',
    }],
  },

  // D-AIR — "BOMBA FÉTIDA METEÓRICA". Cae en picado a 22 px/f con el culo por
  // delante durante 30 frames, dejando una columna de humo verde: la caja
  // (270°, meteoro) está activa TODO el descenso. Después sigue cayendo
  // normal, con sus saltos: fuera de la losa es un riesgo, no un suicidio.
  dair: {
    pose: 'divebomb',
    frames: 44,
    landingLag: 12,
    dive: { from: 6, to: 35, vy: 22 },
    hitboxes: [{
      from: 6, to: 35, x: 0, y: 6, w: 52, h: 44, damage: 14, bkb: 40, kbg: 80, angle: 270, vfx: 'gas', sfx: 'gas_blast',
    }],
    fx: [6, 10, 14, 18, 22, 26, 30, 34].map((frame) => ({ frame, fx: 'gasColumn' })),
  },

  // O NEUTRO — "PURO HABANERO". Saca un puro gigante, da una calada (la brasa
  // al rojo) y exhala una nube de humo de 200 px (un tercio de la losa) que
  // dura 4 s: dentro, el rival pierde 0.5% cada 15 frames (2% por segundo) y
  // se mueve un 40% más lento. No es un golpe: ni aturde ni lanza.
  nspecial: {
    pose: 'habano',
    frames: 64,
    landingLag: 10,
    spawn: [{
      frame: 38, projectile: 'cigarCloud', x: 120, y: -60,
    }],
  },

  // LATERAL + O — "RAP BATTLE DASH". Deslizamiento agachado a 15 px/f que
  // cruza la losa, con rimas flotando. ATRAVIESA ESCUDOS; si conecta, Samuel
  // FRENA EN SECO y el rival sale volando hacia arriba (88°).
  sspecial: {
    pose: 'rapdash',
    frames: 50,
    landingLag: 10,
    continueOnLand: true,
    drift: { from: 6, to: 34, vx: 15 },
    hitboxes: [{
      from: 6, to: 34, x: 30, y: -40, w: 60, h: 76, damage: 12, bkb: 70, kbg: 60, angle: 88, unblockable: true, stopOnHit: true, sfx: 'hit_heavy',
    }],
    fx: [{ frame: 8, fx: 'rhymePA' }, { frame: 22, fx: 'rhymeTOMA' }],
  },

  // ARRIBA + O — "PROPULSIÓN NITRO GAS". Detonación masiva bajo los pies que
  // lo catapulta el DOBLE de alto que su Up-B normal (452 px frente a 226).
  // Con 2.5x, como pedía el diseño, usado desde una semisólida su centro
  // cruzaba la blast zone de arriba (-180) por 30 px: Samuel se mataba solo.
  // A 2x, desde los tablones su centro se queda en -96. La explosión es un
  // METEORO: a quien esté debajo lo hunde.
  uspecial: {
    pose: 'rocket',
    frames: 110,
    airControl: 0.85,
    helplessAtApex: 7,
    helplessAirControl: 0.85,
    velocity: [{
      frame: 6, vy: -23.2, vxScale: 0.5, vxFromInput: 2.6,
    }],
    spawn: [{
      frame: 6, projectile: 'nitroBlast', x: 0, y: 20,
    }],
    fx: [{ frame: 6, fx: 'nitroJet' }, { frame: 10, fx: 'gasTrail' }, { frame: 14, fx: 'gasTrail' }, { frame: 18, fx: 'gasTrail' }],
  },

  // ABAJO + O — "PARRY / VACILE CALLEJERO". Brazos cruzados y sonrisa
  // sobrada: si le golpean en los frames 2-18, el tiempo se congela 20
  // frames (fogonazo blanco), se TELETRANSPORTA a la espalda del rival y le
  // encaja un puñetazo cargado con impact frames en blanco y rojo.
  dspecial: {
    pose: 'parry',
    frames: 40,
    landingLag: 8,
    counter: {
      from: 2, to: 18, move: 'dspecial_hit', teleport: true, freeze: 20,
    },
  },
  dspecial_hit: {
    pose: 'parrypunch',
    frames: 30,
    intangible: { from: 1, to: 8 },
    hitboxes: [{
      from: 5, to: 7, x: 46, y: -64, w: 56, h: 40, damage: 15, bkb: 60, kbg: 85, angle: 40, impact: 'redwhite', sfx: 'hit_heavy',
    }],
  },

  // FINAL SMASH DESPERTADO — "LA BATALLA DE GALLOS DEFINITIVA". Despertado
  // sale SIN medidor. Lanza la gorra a toda pantalla (16 px/f, 80 frames);
  // si toca, cinemática de 240 frames: foco sobre el rival, entrada de
  // Samuel, tres rimas que golpean (3 x 10%) y la detonación final con el
  // resto (20%). Si el rival tenía MÁS del 30% al empezar, el K.O. es
  // automático.
  final: {
    pose: 'capthrow',
    frames: 50,
    intangible: { from: 1, to: 20 },
    spawn: [{
      frame: 12, projectile: 'capThrow', x: 40, y: -80,
    }],
    finalSmash: {
      kind: 'battle',
      free: true,
      cinematicFrames: 240,
      damage: 50,
      pulses: 3,
      pulseDamage: 10,
      pulseFrames: [120, 145, 170],
      impactFrame: 228, // el IMPACT FRAME de la detonación (presentación)
      autoKoAbove: 30,
      bkb: 4,
      kbg: 148,
      angle: 38,
      attackerPose: 'battlestance',
      victimPose: 'stagger',
    },
  },
};

// ============================================================================
// GUÍA DE COMBATE (pestaña MOVIMIENTOS de la pausa)
// ============================================================================
// Solo TEXTO: los números de cada fila (daño, frame de salida) los saca
// engine/moveGuide.js de la moveTable de arriba, así que no pueden quedarse
// desfasados. Mayúsculas y sin acentos: es lo que tiene la fuente 5x7.
export const samuelGuide = {
  sections: [
    {
      title: 'ESPECIALES',
      entries: [
        {
          input: 'O',
          moves: ['nspecial_l1', 'nspecial_l2', 'nspecial_l3'],
          name: 'ERUCTO SONICO CARGABLE',
          tip: 'ZONER / CONTROL DE ESPACIO. O CARGA, O SUELTA, ESCUDO GUARDA LA CARGA (3 NIVELES).',
        },
        {
          input: 'LATERAL + O',
          moves: ['sspecial', 'sspecial_throw'],
          name: 'COJIN DONUT',
          tip: 'AVANCE CON SUPER ARMOR (AGUANTA GOLPES DE HASTA 12%). O OTRA VEZ LANZA EL DONUT, QUE REBOTA.',
        },
        {
          input: 'ARRIBA + O',
          moves: ['uspecial', 'uspecial_slam'],
          name: 'ABRAZO AEREO',
          tip: 'RECUPERACION ANGULABLE. AGARRE DE COMANDO: LO SUBE Y LO ESTAMPA. FUERA DE LA LOSA OS LLEVA AL ABISMO.',
        },
        {
          input: 'ABAJO + O',
          moves: ['dspecial'],
          name: 'PEDO ATOMICO',
          tip: 'NUBE ENORME BAJO TI Y A LOS LADOS QUE TE CATAPULTA ARRIBA. PEGADO AL RIVAL PEGA EL DOBLE.',
        },
      ],
    },
    {
      title: 'AEREOS',
      entries: [
        {
          input: 'AIRE + S + U',
          moves: ['dair'],
          name: 'DAIR - METEOR SMASH',
          tip: 'SPIKE VERTICAL CON DETONACION VERDE: FUERA DE LA LOSA MANDA AL ABISMO.',
        },
        {
          input: 'AIRE + U',
          moves: ['nair'],
          name: 'NAIR - GIRO ACEITOSO',
          tip: 'MULTI-HIT DE RADIO AMPLIO A LOS DOS LADOS: TU DEFENSA CONTRA LAS APROXIMACIONES.',
        },
        {
          input: 'AIRE + ADEL. + U',
          moves: ['fair'],
          name: 'FAIR - MAZAZO DE LLAVE',
          tip: 'LA MORDAZA DE LA PUNTA ES EL SWEETSPOT: PEGA MAS FUERTE QUE EL MANGO.',
        },
        {
          input: 'AIRE + ATRAS + U',
          moves: ['bair'],
          name: 'BAIR - COZ DOBLE',
          tip: 'EL AEREO MAS FUERTE: TU REMATE FUERA DE LA LOSA.',
        },
        {
          input: 'AIRE + W + U',
          moves: ['uair'],
          name: 'UAIR - ERUCTO AL CIELO',
          tip: 'REMATA POR LA BLAST ZONE DE ARRIBA A RIVALES SOBRE LOS TABLONES.',
        },
      ],
    },
    {
      title: 'SMASH (MANTENER I PARA CARGAR)',
      entries: [
        {
          input: 'LATERAL + I',
          moves: ['fsmash'],
          name: 'F-SMASH - BATEO DE CIGUENAL',
          tip: 'KILLER HORIZONTAL PRINCIPAL: CERCA DEL BORDE MATA A PARTIR DE 90%.',
        },
        {
          input: 'ARRIBA + I',
          moves: ['usmash'],
          name: 'U-SMASH - PISTON NEUMATICO',
          tip: 'KILLER VERTICAL HACIA LA BLAST ZONE DE ARRIBA. CASTIGA SALTOS ENCIMA TUYA.',
        },
        {
          input: 'ABAJO + I',
          moves: ['dsmash'],
          name: 'D-SMASH - SILLAZO GAMER',
          tip: 'ESTAMPA LA SILLA Y BARRE LOS DOS LADOS: CASTIGA RODADAS Y LEVANTADAS.',
        },
      ],
    },
    {
      title: 'SUELO',
      entries: [
        {
          input: 'U (REPETIDO)',
          moves: ['jab', 'jab2', 'jab_finisher'],
          name: 'JAB 1-2 + RAFAGA',
          tip: 'EL GOLPE MAS RAPIDO: CASTIGA DE CERCA. MANTEN U: RAFAGA DE HASTA 6 GOLPES Y REMATE.',
        },
        {
          input: 'LATERAL + U',
          moves: ['ftilt'],
          name: 'F-TILT - BOTA DE ACERO',
          tip: 'GANA ESPACIO A MEDIA DISTANCIA CON MUCHO EMPUJE HORIZONTAL.',
        },
        {
          input: 'ARRIBA + U',
          moves: ['utilt'],
          name: 'U-TILT - LLAVE EN ARCO',
          tip: 'BARRE 180 GRADOS POR ENCIMA: LLEGA A QUIEN ESTE DE PIE EN UN TABLON.',
        },
        {
          input: 'ABAJO + U',
          moves: ['dtilt'],
          name: 'D-TILT - PISOTON',
          tip: 'ENTIERRA AL RIVAL EN EL SUELO: MAS TIEMPO CUANTO MAS PORCENTAJE TENGA.',
        },
        {
          input: 'CORRIENDO + U',
          moves: ['dashattack'],
          name: 'DASH ATTACK - DERRAPE',
          tip: 'SE TIRA DE RODILLAS DESLIZANDO: CASTIGO A DISTANCIA.',
        },
      ],
    },
    {
      title: 'AGARRE Y FINAL SMASH',
      entries: [
        {
          input: 'J',
          moves: ['grab'],
          name: 'AGARRE',
          tip: 'GANA AL ESCUDO. U GOLPEA, UNA DIRECCION LANZA (ABAJO = LANZAMIENTO DE COMBO).',
        },
        {
          input: 'J + DIRECCION',
          moves: ['fthrow', 'bthrow', 'uthrow', 'dthrow'],
          name: 'LANZAMIENTOS',
          tip: 'ADELANTE Y ATRAS SACAN DE LA LOSA, ARRIBA PREPARA EL UAIR.',
        },
        {
          input: 'P',
          moves: ['final'],
          name: 'BATALLA DE GALLOS',
          tip: 'CON EL MEDIDOR LLENO: ONDA QUE ATRAVIESA EL ESCUDO Y DETONA HACIA LA BLAST ZONE.',
        },
      ],
    },
    {
      // Los números de esta sección salen de la tabla DESPERTADA.
      title: 'MODO DESPERTADO (10 SEGUNDOS)',
      table: 'awakened',
      entries: [
        {
          input: 'PASIVAS',
          moves: [],
          name: 'EL RAPERO CHETADO',
          tip: 'CARRERA X1.25, AIRE X1.2, 3 SALTOS AEREOS Y ARMADURA CONTRA GOLPES DE MENOS DE 8%.',
        },
        {
          input: 'U',
          moves: ['jab', 'jab_finisher'],
          name: 'PUNCHLINE METRALLETA',
          tip: 'UNA PULSACION: 6 GOLPES QUE RETIENEN Y MICROFONAZO A RAS DE SUELO.',
        },
        {
          input: 'LATERAL + I',
          moves: ['fsmash'],
          name: 'DROP THE MIC',
          tip: 'SWEETSPOT EN LA CABEZA DEL MICRO. DESDE EL CENTRO MATA A PARTIR DE 65%.',
        },
        {
          input: 'ARRIBA + I',
          moves: ['usmash'],
          name: 'ERUCTO SUBWOOFER',
          tip: 'CONO HACIA ARRIBA QUE LLEGA A LOS TABLONES. MATA DESDE EL 70%.',
        },
        {
          input: 'ABAJO + I',
          moves: ['dsmash'],
          name: 'BREAKDANCE TERREMOTO',
          tip: 'BARRE LOS DOS LADOS A LA VEZ EN DIAGONAL BAJA: SACA DE LA LOSA.',
        },
        {
          input: 'AIRE + ADEL. + U',
          moves: ['fair'],
          name: 'DROPKICK',
          tip: 'SI CONECTA, 4 FRAMES MAS DE PARON Y SALES REBOTADO HACIA ATRAS.',
        },
        {
          input: 'AIRE + S + U',
          moves: ['dair'],
          name: 'BOMBA FETIDA',
          tip: 'PICADO A TODA VELOCIDAD CON METEORO EN TODO EL DESCENSO.',
        },
        {
          input: 'O',
          moves: ['nspecial'],
          name: 'PURO HABANERO',
          tip: 'NUBE DE 4 S: EL RIVAL DENTRO PIERDE 2% POR SEGUNDO Y VA UN 40% MAS LENTO.',
        },
        {
          input: 'LATERAL + O',
          moves: ['sspecial'],
          name: 'RAP BATTLE DASH',
          tip: 'CRUZA LA LOSA Y ATRAVIESA ESCUDOS. SI CONECTA, FRENAS EN SECO Y LO MANDAS ARRIBA.',
        },
        {
          input: 'ARRIBA + O',
          moves: ['uspecial'],
          name: 'NITRO GAS',
          tip: 'SUBE EL DOBLE QUE EL NORMAL. LA DETONACION ES UN METEORO.',
        },
        {
          input: 'ABAJO + O',
          moves: ['dspecial', 'dspecial_hit'],
          name: 'PARRY / VACILE',
          tip: 'SI TE GOLPEAN EN SU VENTANA: CONGELA, APARECES A SU ESPALDA Y PEGAS.',
        },
        {
          input: 'P',
          moves: ['final'],
          name: 'BATALLA DEFINITIVA',
          tip: 'SIN MEDIDOR, UNA VEZ POR DESPERTAR. CON EL RIVAL POR ENCIMA DEL 30%, K.O. SEGURO.',
        },
      ],
    },
  ],
};

export const samuelConfig = {
  id: 'samuel',
  name: 'Samuel',
  color: '#e8a33d',
  art: 'mecanico',
  spriteSheet: 'assets/samuel.png',
  archetype: 'HEAVYWEIGHT BRAWLER',
  blurb: 'LLAVE GRIFA, GAS Y UNA BATALLA DE GALLOS',
  stats: samuelStats,
  moveTable: samuelMoveTable,
  guide: samuelGuide,
  awakened: { stats: samuelAwakenedStats, moveTable: samuelAwakenedMoveTable },
};

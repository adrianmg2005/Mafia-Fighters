import { KEYED_POSES, applyKeyedPose } from './keyedPoses.js';
// Sube linealmente hasta `peak` y baja hasta `end`; usado para que un golpe
// se sienta como un latigazo (extensión rápida, retracción algo más lenta)
// en vez de una interpolación lineal plana.
export function triangleEase(p, peak, end) {
  if (p <= peak) return p / peak;
  if (p <= end) return 1 - (p - peak) / (end - peak);
  return 0;
}

// Sube, se mantiene en el pico y baja: para la pose de ulti, que debe
// "sostenerse" un instante en vez de picar y volver enseguida.
export function holdEase(p, start, end) {
  if (p < start) return p / start;
  if (p < end) return 1;
  return Math.max(0, 1 - (p - end) / (1 - end));
}

// Anticipación (startup) -> impacto -> recuperación, en una sola curva.
// Devuelve NEGATIVO mientras el personaje "carga" el golpe hacia atrás y
// positivo al lanzarlo. Es lo que hace legible un golpe fuerte: sin el tramo
// negativo, un heavy se ve igual que un jab, solo que más lento.
function windupEase(p, windupEnd, peak, end) {
  if (p < windupEnd) return -Math.sin((p / windupEnd) * Math.PI) * 0.55;
  if (p < peak) return (p - windupEnd) / (peak - windupEnd);
  if (p < end) return 1 - (p - peak) / (end - peak);
  return 0;
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

function emptyPose() {
  return {
    headOffX: 0, headOffY: 0,
    torsoOffX: 0, torsoOffY: 0,
    armBackOffX: 0, armBackOffY: 0,
    armFrontOffX: 0, armFrontOffY: 0,
    legBackOffX: 0, legBackOffY: 0,
    legFrontOffX: 0, legFrontOffY: 0,
    scale: 1,
    // --- extras de presentación (los lee engine/pixelFighterArt.js) ---
    hairSwing: 0, // inercia de coleta/banda de Vixen; + = arrastra hacia atrás
    arc: 0, // fuerza del arco de ataque dibujado (0 = sin arco)
    arcY: 0.38, // centro vertical del arco, en fracción de la altura
    arcAngle: 0, // hacia dónde apunta el arco, en radianes
    alpha: 1, // opacidad del cuerpo (desvanecimiento del warp)
    armorGlow: 0, // brillo de armadura de Rook (Armor Flash)
    superGlow: 0, // carga dorada/roja del startup de una Ultimate
    // Smear del frame de impacto: copias arrastradas del miembro que golpea,
    // en la dirección del golpe. Es el recurso clásico de animación para que
    // un golpe rápido no "teletransporte" entre dos frames.
    smear: 0,
    smearAngle: 0, // hacia dónde arrastra la estela, en radianes
    smoke: 0, // humo pixelado del teletransporte de Vixen
    // --- utillaje y gas de Samuel (los lee pixelFighterArt.js) ---
    tool: 0, // presencia de la herramienta en la mano delantera (0 = sin nada)
    toolKind: 'wrench', // 'wrench' (llave) | 'donut' (cojín) | 'mic' | 'cigar'
    toolAngle: -0.4, // hacia dónde apunta la llave, en radianes
    gas: 0, // fuerza de la nube de gas cómica (0 = sin nube)
    gasX: 0.34, // origen de la nube, en fracción del ancho
    gasY: 0.62, // ...y de la altura
    gasAngle: Math.PI * 0.85, // dirección del chorro
    fist: 0, // > 0.5 dibuja el puño cerrado con nudillos (jab de Samuel)
    // --- cuerpo del kit de Samuel (poses por claves, engine/keyedPoses.js) ---
    lean: 0, // hombros y cabeza respecto a la cadera (+ adelante, - atrás)
    inflate: 0, // 0..1: se hincha (barriga y mofletes) al cargar el eructo
    breath: 0, // -1..1: respiración del pecho en el reposo
    mouthOpen: 0, // 0..1: boca abierta (eructo) en vez de la sonrisa
    shockAngle: 0, // dirección de la onda del eructo (0 = al frente)
    shockX: 0.7, // origen de la onda, en fracción del ancho...
    shockY: 0.16, // ...y de la altura
    trails: null, // estelas de movimiento activas (ver keyedPoses.js)
    // Guardia de brawler (0..1): sube las manos del reposo bajo a los puños
    // en alto. Solo en las poses neutras (reposo, andar, aire, agachado): los
    // golpes parten del reposo bajo, que es con el que se ajustaron sus
    // offsets y el sitio de sus hitboxes. La lee el kit de Samuel.
    guard: 0,
    sparks: 0, // chispas arrastrando el bloque de motor por el suelo
    smokePuff: 0, // humo gris de cigarro soplado por la boca
    shock: 0, // onda de choque translúcida por delante de la cara (eructo)
    // --- Ultimate "Batalla de Gallos" ---
    rapper: 0, // > 0 dibuja gorra hacia atrás, gafas de sol y cadenas de oro
    mic: 0, // micrófono con cable en la mano delantera
    // --- Modo Despertado ---
    ember: 0, // brasa del puro habanero (0 apagada, 1 al blanco)
    chair: 0, // > 0.5: la silla gamer en la mano (D-Smash)
    chairAngle: -Math.PI / 2, // su orientación: -PI/2 en vertical
    capOff: 0, // > 0.5: sin la gorra (la acaba de lanzar)
    notes: 0, // notas musicales y barras de distorsión alrededor
    earBlood: 0, // chorros de píxeles rojos saliendo de las orejas (víctima)
  };
}

// Pose "pura": dado un tipo de animación y unos parámetros de muestreo
// (tiempo continuo `t` para ciclos como idle/walk/air_hurt, `progress` 0..1
// para golpes/aturdimientos, o `rising` para el salto), devuelve el
// desplazamiento de cada bloque del cuerpo. No sabe nada de Character ni del
// tiempo real de juego: por eso la puede usar tanto
// engine/spriteAtlasBuilder.js (para hornear frames discretos del atlas) como
// cualquier otro consumidor futuro sin duplicar esta geometría.
//
// `kit` ('rook' | 'vixen' | 'default') solo modula matices de
// interpretación: Rook se mueve con más peso y menos recorrido, Vixen más
// amplia y elástica, y solo ella tiene inercia de pelo. La geometría del
// cuerpo en sí vive en pixelFighterArt.js, no aquí.
// Reposo de Samuel (coordenadas del sprite de 80x120): el puño de delante,
// delante de la barriga; el de atrás, junto a la mandíbula.
export const MEC_REST_F = [59, 68];
export const MEC_REST_B = [61, 30];

export function computePoseForKind(kind, {
  t = 0, progress = 0, rising = true, h = 120, kit = 'default',
} = {}) {
  const pose = emptyPose();
  // Samuel anima sus golpes con poses por FOTOGRAMAS CLAVE sobre la fase
  // canónica del movimiento (ver engine/keyedPoses.js y movePhase.js).
  const keyed = kit === 'mecanico' ? KEYED_POSES[kind] : null;
  if (keyed) return applyKeyedPose(pose, keyed, progress);
  // Los dos pesados del roster comparten temperamento: poco recorrido por
  // miembro y mucho peso. Lo que los separa es la silueta (pixelFighterArt)
  // y, aquí, que Samuel saca herramientas donde Rook enseña armadura.
  const heavyKit = kit === 'rook' || kit === 'mecanico';
  const agileKit = kit === 'vixen';
  const toolKit = kit === 'mecanico';
  // Rook recorre menos distancia con cada miembro (pesado), Vixen más (elástica).
  const reach = heavyKit ? 0.85 : (agileKit ? 1.2 : 1);
  const hairs = agileKit ? 1 : 0;

  // Pone las manos de Samuel en unas coordenadas del sprite (los offsets van
  // sobre las manos de base del kit: la de delante en (61, 62), la de atrás
  // en (20, 61)).
  const restArms = (p, [fx, fy], [bx, by]) => {
    p.armFrontOffX = fx - 61;
    p.armFrontOffY = fy - 62;
    p.armBackOffX = bx - 20;
    p.armBackOffY = by - 61;
  };

  if (kind === 'idle') {
    // Respiración rítmica: el torso sube y baja y los brazos se balancean en
    // contrafase, que es lo que impide que un idle parezca una estatua.
    const breathe = Math.sin(t * 3);
    const sway = Math.sin(t * 1.6);
    pose.headOffY = -breathe * 0.8;
    pose.torsoOffY = -breathe * 1.2;
    pose.armBackOffY = sway * 1.2;
    pose.armFrontOffY = -sway * 1.2;
    pose.armFrontOffX = sway * 0.6;
    pose.guard = 1;
    // Samuel, DESPUÉS de lo genérico (antes iba delante y lo genérico le
    // volvía a poner la guardia: el reposo con los brazos caídos nunca se
    // aplicaba, y el test del reposo lo cazó).
    if (kit === 'mecanico') {
      // Rebote rítmico en las rodillas (el torso BAJA y las piernas, que son
      // articuladas, se flexionan) y el pecho que se hincha al inspirar.
      pose.torsoOffY = 1.2 + breathe * 1.4;
      pose.headOffY = 1 + breathe * 1.1;
      pose.breath = -breathe;
      // POSTURA DE COMBATE en 3/4, con los brazos DESACOPLADOS (los dos
      // iguales colgando era un maniquí): el de ATRÁS, detrás del pecho con
      // el codo cerrado, asoma el puño junto a la mandíbula, listo para el
      // directo; el de DELANTE, relajado, con el codo un poco doblado hacia
      // atrás y el antebrazo y el puño por delante de la barriga. Los puños
      // siguen al hombro al respirar.
      pose.guard = 0;
      // Marca de REPOSO: el kit la usa para la actitud del Despertar (pecho
      // fuera, barbilla alta).
      pose.stance = 'idle';
      restArms(pose, MEC_REST_F, MEC_REST_B);
      pose.armFrontOffX += sway * 0.5;
      pose.armFrontOffY += breathe * 1.4;
      pose.armBackOffX += sway * 0.4;
      pose.armBackOffY += breathe * 1.4;
    }
    // Rook se apoya pesadamente; Vixen mantiene la postura baja y elástica.
    if (heavyKit) pose.legFrontOffY = -breathe * 0.4;
    if (agileKit) {
      pose.torsoOffY += 1.5; // postura de combate baja
      pose.legFrontOffX = 1.5;
      pose.legBackOffX = -1.5;
    }
    pose.hairSwing = hairs * (1.2 + sway * 0.9);
  } else if (kind === 'walk-fwd' || kind === 'walk-back') {
    const forward = kind === 'walk-fwd';
    // El paso defensivo es más corto y con la guardia algo más alta: no es
    // el mismo ciclo reproducido al revés.
    const amp = (forward ? 1 : 0.55) * reach;
    const cadence = forward ? 10 : 7;
    const stride = Math.sin(t * cadence);
    pose.legFrontOffX = stride * 4.5 * amp;
    pose.legFrontOffY = -Math.abs(stride) * 2.2;
    pose.legBackOffX = -stride * 4.5 * amp;
    pose.legBackOffY = -Math.abs(Math.sin(t * cadence + Math.PI)) * 2.2;
    pose.armFrontOffX = -stride * 3 * amp;
    pose.armBackOffX = stride * 3 * amp;
    pose.torsoOffX = forward ? 1.5 : -2;
    pose.torsoOffY = -Math.abs(stride) * 1.2;
    // Andando, los brazos balancean abajo, como en el reposo; la guardia
    // alta solo al retroceder.
    pose.guard = forward ? 0 : 1;
    if (!forward) {
      pose.armFrontOffY = -3; // guardia levantada al retroceder
      pose.armBackOffY = -2;
      pose.headOffX = -1;
      if (kit === 'mecanico') {
        // En guardia de boxeo los puños casi no se mueven: con el balanceo
        // entero, el de delante y el de atrás llegaban a cruzarse.
        pose.armFrontOffX = -stride * 1.2;
        pose.armBackOffX = stride * 0.8;
      }
    } else if (kit === 'mecanico') {
      // Andando hacia delante, la postura del reposo con un PÉNDULO suave a
      // contrapié: el brazo de delante avanza cuando el de atrás se va
      // hacia atrás, y al revés; el puño que va adelante sube un pelo.
      restArms(pose, MEC_REST_F, MEC_REST_B);
      pose.armFrontOffX += -stride * 2.5;
      pose.armFrontOffY -= Math.max(0, -stride) * 1.5;
      pose.armBackOffX += stride * 2;
      pose.armBackOffY += Math.abs(stride) * 0.8;
    }
    pose.hairSwing = hairs * (forward ? 2.2 + stride : 1.4);
  } else if (kind === 'jump') {
    pose.legFrontOffY = rising ? -7 : -2;
    pose.legBackOffY = rising ? -7 : -2;
    pose.legFrontOffX = rising ? 2.5 : 4.5;
    pose.legBackOffX = rising ? -2.5 : -4.5;
    pose.armFrontOffY = rising ? -4 : 2;
    pose.armBackOffY = rising ? -4 : 2;
    pose.torsoOffY = rising ? -2.5 : 1.5;
    pose.guard = 1;
    pose.hairSwing = hairs * (rising ? 4 : -1.5);
  } else if (kind === 'jab') {
    // Golpe rápido: extensión casi inmediata del brazo y retracción algo más
    // lenta. El pico (progress ~0.35) es el frame de impacto.
    const ext = triangleEase(progress, 0.35, 0.72);
    pose.armFrontOffX = ext * 12 * reach;
    pose.armFrontOffY = -1;
    pose.armBackOffX = -ext * 3;
    pose.torsoOffX = ext * 2.5;
    pose.headOffX = ext * 1.5;
    pose.legFrontOffX = ext * 2;
    pose.arc = ext > 0.85 ? 0.45 : 0;
    pose.arcY = 0.34;
    pose.hairSwing = hairs * (1 + ext * 2.5);
    // Puño cerrado con nudillos marcados en la extensión: le da al golpe
    // ligero un sprite propio en vez de "el brazo estirado" sin más.
    if (toolKit) {
      pose.fist = ext;
      // ANTICIPACIÓN: antes de salir, el puño se recoge un pelín. Son 3-4
      // frames de nada, pero sin ese retroceso el jab aparece ya estirado.
      const carga = progress < 0.14 ? Math.sin((progress / 0.14) * Math.PI) : 0;
      pose.armFrontOffX -= carga * 4;
      pose.torsoOffX -= carga * 2;
      // SMEAR en el frame de impacto: la estela va en la dirección del golpe.
      pose.smear = progress > 0.24 && progress < 0.46 ? 1 : 0;
      pose.smearAngle = 0;
      // FOLLOW-THROUGH: la recogida no vuelve a cero en línea recta, se pasa
      // un poco hacia atrás y rebota. Es lo que la hace "reactiva".
      const vuelta = Math.max(0, (progress - 0.6) / 0.4);
      pose.armFrontOffX -= Math.sin(vuelta * Math.PI) * 3.5;
      pose.armBackOffX += Math.sin(vuelta * Math.PI) * 2;
    }
  } else if (kind === 'kick') {
    // Patada con anticipación: la pierna se recoge antes de salir.
    const ext = windupEase(progress, 0.3, 0.5, 0.85);
    pose.legFrontOffX = ext * 15 * reach;
    pose.legFrontOffY = -Math.max(0, ext) * 6;
    pose.torsoOffX = -ext * 3.5;
    pose.torsoOffY = Math.max(0, ext) * 2;
    pose.armBackOffX = -ext * 5;
    pose.armFrontOffY = -Math.max(0, ext) * 3;
    pose.arc = Math.max(0, ext);
    pose.arcY = 0.55;
    pose.arcAngle = 0.35;
    pose.hairSwing = hairs * (2 + Math.max(0, ext) * 4);
  } else if (kind === 'launcher') {
    // Gancho ascendente: el brazo carga abajo y sube con fuerza, el torso se
    // estira. Se lee claramente distinto de un 'kick'.
    const ext = windupEase(progress, 0.32, 0.52, 0.88);
    pose.armFrontOffX = ext * 9 * reach;
    pose.armFrontOffY = -ext * 16;
    pose.torsoOffY = -Math.max(0, ext) * 5;
    pose.headOffY = -Math.max(0, ext) * 3;
    pose.legBackOffY = -Math.max(0, ext) * 4;
    pose.legFrontOffX = ext * 3;
    pose.arc = Math.max(0, ext);
    pose.arcY = 0.3;
    pose.arcAngle = -1.1; // arco hacia arriba
    pose.hairSwing = hairs * (2 + Math.max(0, ext) * 5);
    if (toolKit) {
      // Llavezo ascendente: la llave inglesa acompaña el arco del brazo en
      // vez de ir clavada en una postura fija, así que la HERRAMIENTA es el
      // golpe y no un adorno pegado a la mano. Durante la anticipación (ext
      // negativo) baja hasta el suelo; al soltarse barre hacia arriba.
      const swing = Math.max(0, ext);
      pose.tool = 0.45 + swing * 0.55; // visible también mientras carga
      pose.toolKind = 'wrench';
      pose.toolAngle = 0.6 - swing * 2.2;
      pose.arc = swing * 1.35; // arco más largo: la llave tiene más alcance
      // GIRO DE HOMBRO visible: el brazo trasero baja mientras el delantero
      // sube, y el torso acompaña. Sin la contrafase el gancho parecía subir
      // el brazo solo, sin cuerpo detrás.
      pose.armBackOffY = swing * 9 - Math.min(0, ext) * 6;
      pose.armBackOffX = -swing * 7;
      pose.torsoOffX = ext * 4;
      pose.headOffX = ext * 3;
      // La estela barre el arco entero, no solo el frame de impacto.
      pose.smear = swing > 0.35 ? Math.min(1, swing * 1.2) : 0;
      pose.smearAngle = -1.1; // igual que arcAngle: acompaña el barrido
      // Inercia al final: la llave se pasa de largo y vuelve.
      const inercia = Math.max(0, (progress - 0.72) / 0.28);
      pose.armFrontOffY -= Math.sin(inercia * Math.PI) * 4;
    }
  } else if (kind === 'special') {
    // Embestida pesada (Rook): hombro por delante, cuerpo inclinado y el
    // brillo de armadura marcando los frames con Armor Frames activos.
    if (heavyKit) {
      const drive = holdEase(progress, 0.28, 0.72);
      pose.torsoOffX = drive * 7;
      pose.torsoOffY = drive * 3;
      pose.headOffX = drive * 6;
      pose.headOffY = drive * 3;
      pose.armFrontOffX = drive * 5;
      pose.armFrontOffY = drive * 2;
      pose.armBackOffX = -drive * 6;
      pose.legFrontOffX = drive * 9;
      pose.legBackOffX = -drive * 7;
      pose.armorGlow = toolKit ? 0 : drive;
      pose.arc = drive * 0.6;
      pose.arcY = 0.45;
      if (toolKit) {
        // Samuel no entra protegido por una armadura: entra usando de ariete
        // el cojín donut que lleva cargado por delante.
        pose.tool = 0.5 + drive * 0.5;
        pose.toolKind = 'donut';
        pose.armFrontOffY = -2 + drive * 2;
        pose.armFrontOffX = drive * 3;
      }
    } else {
      // Teletransporte (Vixen): se deshace en humo, desaparece del todo en
      // mitad de la animación y reaparece golpeando por el otro lado.
      const fade = progress < 0.4 ? 1 - progress / 0.4 : Math.min(1, (progress - 0.55) / 0.2);
      pose.alpha = Math.max(0, Math.min(1, fade));
      pose.smoke = 1 - Math.abs(progress - 0.45) / 0.45;
      const strike = triangleEase(Math.max(0, (progress - 0.6) / 0.4), 0.4, 0.9);
      pose.armFrontOffX = strike * 13;
      pose.armFrontOffY = -strike * 4;
      pose.torsoOffX = strike * 3;
      pose.legFrontOffX = strike * 4;
      pose.arc = strike;
      pose.arcY = 0.36;
      pose.arcAngle = 0.2;
      pose.hairSwing = 5 - progress * 3;
    }
  } else if (kind === 'ultra') {
    const ext = holdEase(progress, 0.25, 0.75);
    pose.armFrontOffX = ext * 10;
    pose.armFrontOffY = -ext * 7;
    pose.armBackOffX = ext * 9;
    pose.armBackOffY = -ext * 7;
    pose.torsoOffY = -ext * 3;
    pose.scale = 1 + ext * 0.14;
    pose.armorGlow = heavyKit && !toolKit ? ext : 0;
    pose.smoke = agileKit ? ext * 0.6 : 0;
    pose.arc = ext;
    pose.arcY = 0.35;
    pose.hairSwing = hairs * ext * 6;
    if (toolKit) {
      // "Taller Callejero": llave en alto y el escape ya humeando antes de
      // que empiece la cinemática.
      pose.tool = ext;
      pose.toolKind = 'wrench';
      pose.toolAngle = -1.25 - ext * 0.35;
      pose.gas = Math.max(0, (progress - 0.5) / 0.5) * 0.85;
      pose.gasX = 0.3;
      pose.gasY = 0.7;
    }
  } else if (kind === 'gasblast') {
    // Remate aéreo cómico de Samuel: se da la vuelta en el aire y suelta un
    // escape de gas que estampa al rival contra el suelo.
    //
    // El rig no tiene giro real (es un muñeco de bloques visto de perfil),
    // así que la vuelta se SIMULA cruzando miembros al lado contrario,
    // metiendo la cabeza y encogiendo un pelín la escala: leído a 60fps se
    // interpreta como que se ha dado media vuelta, que es justo lo que hace
    // falta para que el chorro salga por detrás.
    const turn = triangleEase(progress, 0.42, 1);
    const blast = Math.max(0, (progress - 0.38) / 0.62);
    pose.torsoOffX = -turn * 7;
    pose.headOffX = -turn * 9;
    pose.headOffY = turn * 2.5;
    pose.armBackOffX = turn * 7;
    pose.armBackOffY = -turn * 3;
    pose.armFrontOffX = -turn * 10;
    pose.armFrontOffY = turn * 4;
    pose.legBackOffX = turn * 5;
    pose.legBackOffY = -turn * 4;
    pose.legFrontOffX = turn * 2;
    pose.legFrontOffY = -turn * 6;
    pose.scale = 1 - turn * 0.05;
    // El origen va FUERA de la silueta (por detras de la cadera): la nube se
    // dibuja por detras del cuerpo, asi que con el origen dentro del torso el
    // propio luchador la tapaba casi entera y solo asomaba un borde verde.
    pose.gas = Math.min(1, blast * 1.25);
    pose.gasX = 0.85;
    pose.gasY = 0.52;
    // Abajo y hacia AFUERA. Con el chorro apuntando abajo-izquierda barría
    // por dentro de la silueta y el propio cuerpo tapaba media nube: al dar
    // media vuelta, la espalda queda del lado derecho, y de ahí sale el gas.
    pose.gasAngle = Math.PI * 0.35;
    pose.arc = blast * 0.5;
    pose.arcY = 0.75;
    pose.arcAngle = 1.3;
    pose.hairSwing = hairs * turn * 4;
  } else if (kind === 'stomp') {
    // PISOTÓN: se alza la rodilla y se clava la bota en el pie del rival. El
    // cuerpo se hunde en el impacto (el peso va hacia abajo, no hacia
    // delante), que es lo que lo separa de una patada normal.
    // La subida de rodilla se sostiene casi hasta el final: con una curva
    // que se apagaba en 0.62 el pisoton se pasaba media animacion en pose de
    // reposo y no se leia como un pisoton, sino como estar de pie.
    const lift = triangleEase(progress, 0.42, 0.95);
    const slam = Math.max(0, (progress - 0.45) / 0.3);
    pose.legFrontOffY = -lift * 18 + slam * 6;
    pose.legFrontOffX = lift * 6 + slam * 3;
    pose.torsoOffY = lift * -2 + slam * 4;
    pose.headOffY = lift * -1 + slam * 4;
    pose.armBackOffY = -lift * 4;
    pose.armFrontOffY = lift * 3 + slam * 2;
    pose.armFrontOffX = -lift * 3;
    pose.legBackOffX = -lift * 2;
    pose.arc = slam > 0.6 ? 0.7 : 0;
    pose.arcY = 0.92; // el arco va a ras de suelo
    pose.arcAngle = 1.4;
    // CONTRAPESO: el torso se va hacia atrás mientras la rodilla sube y se
    // echa encima al clavar la bota. Un pisotón con el tronco quieto se lee
    // como levantar el pie, no como cargar el peso.
    pose.torsoOffX = -lift * 5 + slam * 7;
    pose.headOffX = -lift * 3 + slam * 5;
    pose.armBackOffX = lift * 6 - slam * 4;
    pose.armFrontOffX += -lift * 2 + slam * 3;
    // Rebote al replegar: la pierna no vuelve recta.
    const repliegue = Math.max(0, (progress - 0.78) / 0.22);
    pose.legFrontOffY += Math.sin(repliegue * Math.PI) * 4;
    pose.smear = slam > 0.15 && slam < 0.75 ? 0.8 : 0;
    pose.smearAngle = 1.4;
    pose.hairSwing = hairs * (1 + slam * 3);
  } else if (kind === 'smokekick') {
    // PATADA DE FURIA + BOCANADA DE HUMO: patada frontal larga y, en el
    // impacto, la calada se suelta por la boca. El humo sale del frame en que
    // conecta y se queda flotando en la recuperación, que es donde vive el
    // chiste.
    const ext = windupEase(progress, 0.26, 0.48, 0.9);
    pose.legFrontOffX = ext * 19 * reach;
    pose.legFrontOffY = -Math.max(0, ext) * 8;
    pose.torsoOffX = -ext * 4;
    pose.torsoOffY = Math.max(0, ext) * 2;
    pose.armBackOffX = -ext * 7;
    pose.armFrontOffY = -Math.max(0, ext) * 4;
    pose.headOffX = ext * 2;
    pose.arc = Math.max(0, ext);
    pose.arcY = 0.58;
    pose.arcAngle = 0.3;
    pose.smokePuff = Math.max(0, (progress - 0.42) / 0.58);
    pose.hairSwing = hairs * (2 + Math.max(0, ext) * 4);
  } else if (kind === 'lowswing') {
    // LLAVEZO A LA ESPINILLA: mismo arco que el gancho pero AL REVÉS, de
    // arriba abajo y terminando a la altura de la rodilla. Se lee distinto del
    // launcher precisamente por eso: el arco baja en vez de subir.
    const ext = windupEase(progress, 0.3, 0.5, 0.88);
    pose.armFrontOffX = ext * 11 * reach;
    pose.armFrontOffY = Math.max(0, ext) * 13;
    pose.torsoOffY = Math.max(0, ext) * 5;
    pose.torsoOffX = ext * 3;
    pose.headOffY = Math.max(0, ext) * 4;
    pose.headOffX = ext * 2;
    pose.armBackOffY = -ext * 3;
    pose.legFrontOffX = ext * 2;
    pose.arc = Math.max(0, ext);
    pose.arcY = 0.78;
    pose.arcAngle = 0.9; // arco hacia abajo
    pose.hairSwing = hairs * (1 + Math.max(0, ext) * 3);
    if (toolKit) {
      const swing = Math.max(0, ext);
      pose.tool = 0.5 + swing * 0.5;
      pose.toolKind = 'wrench';
      pose.toolAngle = -0.9 + swing * 2.0; // de arriba abajo
    }
  } else if (kind === 'headbutt') {
    // CABEZAZO: echa el torso ATRÁS (anticipación larga, es lo que justifica
    // la armadura) y lanza la cabeza por delante de todo el cuerpo. Los brazos
    // se quedan abajo, agarrando: no es un puñetazo.
    const ext = windupEase(progress, 0.38, 0.56, 0.9);
    pose.headOffX = ext * 14;
    pose.headOffY = Math.max(0, ext) * 3;
    pose.torsoOffX = ext * 8;
    pose.torsoOffY = Math.max(0, ext) * 2;
    pose.armBackOffX = -ext * 8;
    pose.armBackOffY = Math.max(0, ext) * 5;
    pose.armFrontOffX = -ext * 5;
    pose.armFrontOffY = Math.max(0, ext) * 6;
    pose.legFrontOffX = ext * 7;
    pose.legBackOffX = -ext * 4;
    pose.arc = Math.max(0, ext) * 0.9;
    pose.arcY = 0.22; // a la altura de la frente
    pose.arcAngle = -0.15;
    pose.hairSwing = hairs * (1 + Math.max(0, ext) * 5);
  } else if (kind === 'gutknee') {
    // RODILLAZO AL ESTÓMAGO: la rodilla delantera SUBE mientras el torso se
    // echa encima del rival y los dos brazos tiran hacia abajo — es el gesto
    // de agarrar la nuca y clavar la rodilla, no una patada. Por eso la
    // pierna no se extiende hacia delante: sube.
    const ext = windupEase(progress, 0.34, 0.52, 0.9);
    const golpe = Math.max(0, ext);
    pose.legFrontOffY = -golpe * 22; // la rodilla, que es el golpe
    pose.legFrontOffX = ext * 6;
    pose.legBackOffX = -ext * 3;
    pose.torsoOffX = ext * 7;
    pose.torsoOffY = golpe * 4; // se dobla encima
    pose.headOffX = ext * 5;
    pose.headOffY = golpe * 5;
    // Los dos brazos tiran hacia ABAJO: sujetan al rival contra la rodilla.
    pose.armFrontOffX = ext * 4;
    pose.armFrontOffY = golpe * 9;
    pose.armBackOffX = ext * 2;
    pose.armBackOffY = golpe * 7;
    pose.arc = golpe * 0.7;
    pose.arcY = 0.52; // a la altura del estómago
    pose.arcAngle = -1.2; // vertical: el arco sube
    pose.hairSwing = hairs * (1 + golpe * 3);
  } else if (kind === 'gutpunch') {
    // DOBLADO POR EL ESTÓMAGO: la reacción al rodillazo. A diferencia del
    // `hitstun` normal —que arquea hacia ATRÁS y se amortigua deprisa—, aquí
    // el cuerpo se pliega hacia DELANTE y se queda ahí: es un estado de
    // ventaja, y lo que lo vende es que no se recupera durante el plano.
    // Esa postura es además el enganche visual del remate de la cadena: un
    // bate horizontal a la altura del pecho contra alguien doblado se lee
    // como un golpe limpio, y contra alguien erguido no.
    const dobla = Math.min(1, progress * 3); // se pliega rápido...
    const temblor = Math.sin(progress * 24) * (1 - progress) * 1.5;
    pose.torsoOffY = dobla * 9; // ...y se queda plegado
    pose.torsoOffX = -dobla * 5 + temblor;
    pose.headOffY = dobla * 13; // la cabeza cae por delante del pecho
    pose.headOffX = -dobla * 7 + temblor;
    // Los brazos se cierran sobre el vientre.
    pose.armFrontOffX = -dobla * 8;
    pose.armFrontOffY = dobla * 7;
    pose.armBackOffX = -dobla * 5;
    pose.armBackOffY = dobla * 6;
    // Las rodillas ceden un poco, pero los PIES no se mueven: está clavado.
    pose.legFrontOffY = -dobla * 2;
    pose.legBackOffX = dobla * 3;
    pose.hairSwing = hairs * dobla * 6;
  } else if (kind === 'burp') {
    // ERUCTO SÓNICO: hincha el pecho, se echa atrás y suelta la onda. El
    // cuerpo se queda quieto —no avanza— porque el golpe es la ONDA, no él.
    const charge = progress < 0.4 ? progress / 0.4 : 1;
    const release = Math.max(0, (progress - 0.4) / 0.6);
    pose.torsoOffY = -charge * 4 + release * 2;
    pose.torsoOffX = -charge * 3 + release * 5;
    pose.headOffX = -charge * 4 + release * 7;
    pose.headOffY = -charge * 2 + release * 2;
    pose.armBackOffX = -charge * 5;
    pose.armFrontOffX = -charge * 4 + release * 2;
    pose.armFrontOffY = charge * 3;
    pose.legBackOffX = -charge * 3;
    pose.shock = release > 0.05 ? release : 0;
    pose.smokePuff = release * 0.35; // un hilillo de humo acompaña a la onda
    pose.hairSwing = hairs * (1 + release * 4);
  } else if (kind === 'sidekick') {
    // PATADA LATERAL DE MACARRA: la cadera SE VA con la pierna. Es lo que la
    // separa de la patada frontal — el torso se inclina hacia atrás para
    // contrapesar y el hombro trasero se abre, como al dar una patada de
    // verdad. Sin ese contrapeso la pierna parece de goma.
    const ext = windupEase(progress, 0.28, 0.5, 0.9);
    const hip = Math.max(0, ext);
    pose.legFrontOffX = ext * 21 * reach;
    pose.legFrontOffY = -hip * 4;
    pose.torsoOffX = -ext * 6; // contrapeso de cadera
    pose.torsoOffY = hip * 3;
    pose.headOffX = -ext * 5;
    pose.armBackOffX = -ext * 10;
    pose.armBackOffY = -hip * 5;
    pose.armFrontOffX = -ext * 4;
    pose.armFrontOffY = hip * 4;
    pose.legBackOffX = -ext * 3;
    pose.arc = hip;
    pose.arcY = 0.6;
    pose.arcAngle = 0.15;
    // El contrapeso de cadera ya estaba; lo que faltaba era la INERCIA. Al
    // replegar, la pierna se pasa hacia atrás y el tronco vuelve DETRÁS de
    // ella, no los dos a la vez — que es lo que se leía mecánico.
    const repliegue = Math.max(0, (progress - 0.7) / 0.3);
    const vuelta = Math.sin(repliegue * Math.PI);
    pose.legFrontOffX -= vuelta * 6;
    pose.torsoOffX += vuelta * 4;
    pose.armBackOffX += vuelta * 5;
    pose.smear = hip > 0.4 ? 1 : 0;
    pose.smearAngle = 0.15;
    pose.hairSwing = hairs * (2 + hip * 5);
  } else if (kind === 'crankswing') {
    // CULATAZO DE CIGÜEÑAL: batazo HORIZONTAL a dos manos a la altura del
    // pecho. Estaba prestado del giro de gas, que SUELTA la nube verde —
    // así que el culatazo escupía la nube verde mientras decía ser un golpe
    // metálico. Aquí no hay gas: hay una herramienta que barre en plano.
    const ext = windupEase(progress, 0.3, 0.5, 0.9);
    const golpe = Math.max(0, ext);
    // Las dos manos van juntas: se agarra un cigüeñal como un bate.
    pose.armFrontOffX = ext * 16;
    pose.armBackOffX = ext * 12;
    pose.armFrontOffY = -golpe * 3;
    pose.armBackOffY = -golpe * 2;
    pose.torsoOffX = ext * 9;
    pose.headOffX = ext * 6;
    pose.legFrontOffX = ext * 7;
    pose.legBackOffX = -ext * 5;
    pose.tool = golpe;          // la herramienta ES el golpe
    pose.toolAngle = 0.06;      // HORIZONTAL, como un bate
    pose.arc = golpe * 0.95;
    pose.arcY = 0.42;           // a la altura del pecho
    pose.arcAngle = 0.05;
    pose.hairSwing = hairs * ext * 6;
  } else if (kind === 'uppercut') {
    // NUDILLAZO ASCENDENTE: el puño sale desde abajo buscando el mentón. Lo
    // que lo separa de un jab a esta resolución no es el brazo —los dos se
    // estiran parecido— sino que el cuerpo se HUNDE al cargar y se ESTIRA al
    // soltar: el golpe viene de las piernas, y eso es lo que se lee.
    const carga = Math.min(1, progress / 0.3);
    const ext = windupEase(progress, 0.3, 0.52, 0.9);
    const golpe = Math.max(0, ext);
    pose.armFrontOffX = ext * 9;
    pose.armFrontOffY = carga * 5 - golpe * 20; // baja y sube
    pose.armBackOffX = -ext * 5;
    pose.torsoOffY = carga * 4 - golpe * 6;
    pose.torsoOffX = ext * 5;
    pose.headOffY = carga * 3 - golpe * 5;
    pose.headOffX = ext * 4;
    pose.legFrontOffY = carga * 3 - golpe * 2; // se agacha para impulsarse
    pose.legBackOffX = -ext * 3;
    pose.arc = golpe * 0.75;
    pose.arcY = 0.3;
    pose.arcAngle = -1.1; // el arco SUBE
    pose.hairSwing = hairs * (carga * -2 + golpe * 6);
  } else if (kind === 'elbow') {
    // CODAZO SUCIO: el brazo se pliega y entra de canto con el hombro por
    // delante. Lo que lo separa de un jab es que NO se estira — el recorrido
    // lo pone el TORSO girando, no el brazo. A esta resolución esa diferencia
    // (brazo corto + torso que se adelanta mucho) es todo lo que hace falta
    // para que se lea como codazo y no como otro directo.
    const ext = windupEase(progress, 0.24, 0.46, 0.9);
    pose.torsoOffX = ext * 13 * reach;
    pose.torsoOffY = -Math.max(0, ext) * 2;
    pose.headOffX = ext * 9;
    pose.headOffY = Math.max(0, ext) * 2;
    // Brazo delantero RECOGIDO y alto: el codo es lo que sobresale.
    pose.armFrontOffX = ext * 6 - Math.max(0, ext) * 2;
    pose.armFrontOffY = -Math.max(0, ext) * 9;
    pose.armBackOffX = -ext * 8;
    pose.legFrontOffX = ext * 5;
    pose.legBackOffX = -ext * 2;
    pose.arc = Math.max(0, ext) * 0.8;
    pose.arcY = 0.34;
    pose.arcAngle = -0.15;
    pose.fist = Math.max(0, ext) > 0.4 ? 1 : 0;
    // El codazo entra de canto: la estela va con el hombro, no con el puño.
    pose.smear = ext > 0.45 ? 1 : 0;
    pose.smearAngle = -0.15;
    // Recogida reactiva: el torso rebota hacia atrás tras el impacto.
    const rebote = Math.max(0, (progress - 0.58) / 0.42);
    pose.torsoOffX -= Math.sin(rebote * Math.PI) * 5;
    pose.headOffX -= Math.sin(rebote * Math.PI) * 4;
    pose.hairSwing = hairs * ext * 4;
  } else if (kind === 'lowsweep') {
    // RASTRERA: la pierna barre el suelo casi tumbado, con la mano de apoyo
    // en el asfalto. El cuerpo BAJA de verdad (no es una patada baja de pie),
    // que es lo que la hace legible y lo que justifica que sea la apertura
    // más rápida de su repertorio.
    // Medido sobre el rasterizado: con el primer reparto (torso 16, pierna
    // +9 en Y) la cabeza solo bajaba 13px de 120 —se leía como estar de pie—
    // y encima la bota se hundía 9px POR DEBAJO del suelo. Ahora el cuerpo
    // baja el doble y la pierna se va en HORIZONTAL, que es lo que hace un
    // barrido: los pies no pueden bajar de `h`, ahí está el pavimento.
    const ext = windupEase(progress, 0.22, 0.44, 0.9);
    const crouch = triangleEase(progress, 0.42, 0.96);
    pose.torsoOffY = crouch * 26;
    pose.headOffY = crouch * 28;
    pose.headOffX = -crouch * 5;
    // Pierna delantera estirada a ras de suelo, sin hundirse en él.
    pose.legFrontOffX = ext * 32 * reach;
    pose.legFrontOffY = 0;
    pose.legBackOffY = crouch * 2;
    pose.legBackOffX = -crouch * 7;
    // Mano de apoyo: baja hasta el suelo y se queda ahí mientras barre.
    pose.armBackOffY = crouch * 30;
    pose.armBackOffX = -crouch * 13;
    pose.armFrontOffY = crouch * 12;
    pose.armFrontOffX = ext * 6;
    pose.arc = Math.max(0, ext);
    pose.arcY = 0.95; // a ras de suelo, igual que el pisotón
    pose.arcAngle = 0.05;
    pose.sparks = Math.max(0, ext) > 0.5 ? 0.6 : 0; // la bota raspando
    pose.hairSwing = hairs * (1 + crouch * 3);
  } else if (kind === 'hook') {
    // GANCHO CORTO: arco horizontal cerrado a la altura de la cabeza. Es el
    // hermano corto del 'launcher' (que sube y lanza): mismo brazo, mismo
    // giro de cadera, pero el arco se queda a la altura del pecho y NO
    // levanta al rival. Se distingue del jab por el arco, que el jab no tiene.
    const ext = windupEase(progress, 0.26, 0.48, 0.9);
    pose.armFrontOffX = ext * 13 * reach;
    pose.armFrontOffY = -Math.max(0, ext) * 6;
    pose.torsoOffX = ext * 6;
    pose.torsoOffY = -Math.max(0, ext) * 3;
    pose.headOffX = ext * 5;
    pose.armBackOffX = -ext * 9;
    pose.armBackOffY = Math.max(0, ext) * 3;
    pose.legFrontOffX = ext * 4;
    pose.arc = Math.max(0, ext);
    pose.arcY = 0.4;
    pose.arcAngle = -0.45; // arco cerrado que sube un poco, sin llegar a lanzar
    pose.fist = Math.max(0, ext) > 0.35 ? 1 : 0;
    pose.hairSwing = hairs * (1 + Math.max(0, ext) * 3);
  } else if (kind === 'smokespin') {
    // GIRO DE HUMO: media vuelta soltando humo de cigarro en vez de gas —
    // es la CALADA del cigarro —humo gris denso— en vez de gas verde. La
    // distinción no es decorativa: el gas es el remate que estampa y el humo
    // es el que manda contra la pared, así que tienen que leerse distinto de
    // un vistazo. Por eso comparten movimiento y NO paleta.
    const turn = triangleEase(progress, 0.38, 1);
    const puff = Math.max(0, (progress - 0.34) / 0.66);
    pose.torsoOffX = -turn * 7;
    pose.headOffX = -turn * 12;
    pose.headOffY = -turn * 2;
    pose.armBackOffX = turn * 10;
    pose.armBackOffY = -turn * 5;
    pose.armFrontOffX = -turn * 9;
    pose.armFrontOffY = -turn * 4;
    // La pierna que gira sube más que en el remate aéreo: aquí el golpe es la
    // patada y el humo es el adorno, al revés que en el remate de gas.
    pose.legFrontOffX = turn * 17 * reach;
    pose.legFrontOffY = -turn * 11;
    pose.legBackOffX = -turn * 5;
    pose.smokePuff = Math.min(1, puff * 1.4);
    pose.arc = Math.max(0, turn);
    pose.arcY = 0.54;
    pose.arcAngle = 0.15;
    pose.hairSwing = hairs * turn * 6;
  } else if (kind === 'micshout') {
    // ACTIVACIÓN DE LA ULTI: se para EN SECO, saca el micro y pega el
    // berrido que dispara la onda. La anticipación es larga y el cuerpo se
    // echa atrás cargando aire; el grito sale de golpe con el torso hacia
    // delante. No avanza ni un píxel: el que viaja es la onda, no él.
    const charge = progress < 0.45 ? progress / 0.45 : 1;
    const shout = Math.max(0, (progress - 0.45) / 0.55);
    // El berrido tira el cuerpo hacia delante con ganas: con el +9 de antes
    // el torso acababa casi donde empezo y el grito no se leia como un
    // esfuerzo, que es justo lo que tiene que vender la pose.
    pose.torsoOffX = -charge * 5 + shout * 14;
    pose.torsoOffY = -charge * 3 + shout * 2;
    pose.headOffX = -charge * 6 + shout * 12;
    pose.headOffY = -charge * 2 + shout * 3;
    pose.armFrontOffX = -charge * 2 + shout * 6;
    pose.armFrontOffY = -charge * 10 - shout * 4; // el micro sube a la boca
    pose.armBackOffX = -charge * 7 + shout * 3;
    pose.armBackOffY = charge * 4;
    pose.legFrontOffX = shout * 4;
    pose.legBackOffX = -charge * 4;
    pose.mic = 1;
    // Destello dorado/rojo de carga durante la anticipación: el aviso de que
    // lo que viene es LA ulti. Se apaga al soltar el berrido, cuando el
    // protagonismo pasa a la onda.
    pose.superGlow = charge * (1 - shout);
    pose.shock = shout > 0.05 ? shout : 0;
    pose.notes = shout * 0.5;
    pose.hairSwing = hairs * (1 + shout * 6);
  } else if (kind === 'micdash') {
    // ACTIVACIÓN DE LA ULTI (starter tipo Fatal Blow). Tres tramos que
    // calcan el frame data del movimiento (10 startup / 6 activos / 24 de
    // recovery, ver samuel.js), porque la animación va montada sobre
    // `progress` y no sobre un reloj propio:
    //
    //   0.00-0.25  se agazapa cargando, el micro echado atrás. Aquí se
    //              enciende `superGlow`: el destello dorado/rojo que avisa
    //              de que lo que viene es LA ulti y no otro especial.
    //   0.25-0.40  embestida: todo el cuerpo se estira hacia delante con el
    //              micro por delante, que es lo que conecta.
    //   0.40-1.00  frenada. Si ha capturado, esto no se llega a ver (la
    //              cinemática interrumpe); si ha fallado, ES el castigo, así
    //              que tiene que leerse como "se ha pasado de frenada".
    const COIL_END = 0.25;
    const LUNGE_END = 0.4;
    const coil = progress < COIL_END ? progress / COIL_END : 1;
    const lunge = progress < COIL_END
      ? 0
      : Math.min(1, (progress - COIL_END) / (LUNGE_END - COIL_END));
    const skid = Math.max(0, (progress - LUNGE_END) / (1 - LUNGE_END));

    // La carga se DESHACE al lanzarse (`coilOut`), no se suma a la embestida.
    // Sin ese factor los dos tramos se cancelaban a medias y el cuerpo apenas
    // salía hacia delante: la anticipación se comía el golpe.
    const coilOut = coil * (1 - lunge);
    pose.torsoOffX = -coilOut * 7 + lunge * 18 - skid * 9;
    pose.torsoOffY = coilOut * 3 - lunge * 4 + skid * 2;
    pose.headOffX = -coilOut * 5 + lunge * 16 - skid * 11;
    pose.headOffY = coilOut * 2 - lunge * 3 + skid * 3;
    // El brazo del micro es el que marca el golpe: se retrasa en la carga y
    // sale disparado con la embestida.
    pose.armFrontOffX = -coilOut * 9 + lunge * 26 - skid * 16;
    pose.armFrontOffY = -coilOut * 4 - lunge * 6 + skid * 8;
    pose.armBackOffX = coilOut * 6 - lunge * 8 + skid * 4;
    pose.armBackOffY = coilOut * 3 - lunge * 5;
    // Las piernas se abren en tijera durante la embestida y se clavan en la
    // frenada: pierna de delante estirada, la de atrás arrastrando.
    pose.legFrontOffX = -coilOut * 3 + lunge * 13 - skid * 3;
    pose.legBackOffX = coilOut * 2 - lunge * 11 + skid * 5;
    pose.legFrontOffY = -lunge * 2;

    pose.mic = 1;
    pose.superGlow = coil * (1 - lunge * 0.4); // máximo justo antes de salir
    pose.arc = lunge * (1 - skid) * 0.9;
    pose.arcY = 0.42;
    pose.arcAngle = 0;
    // Las chispas de la frenada: los pies raspando el asfalto.
    pose.sparks = skid > 0.05 && skid < 0.7 ? (1 - skid) * 0.8 : 0;
    pose.notes = lunge * 0.35;
    pose.hairSwing = hairs * (coil * -3 + lunge * 8 - skid * 4);
  } else if (kind === 'rapintro') {
    // TRANSFORMACIÓN (TOMA 1 de la cinemática): se cala la gorra hacia atrás,
    // se ajusta las gafas, saca las cadenas y agarra el micro. Cuatro tiempos
    // en un solo plano, y cada uno con un GESTO distinto de la mano — si los
    // cuatro usaran el mismo movimiento de brazo, el cambio de look parecería
    // que ocurre solo.
    //
    // `pose.rapper` sube de 0 a 1 a lo largo del plano y es lo que hace que
    // el rasterizador vaya sacando prenda a prenda (ver pixelFighterArt).
    const gorra = clamp01(progress / 0.3);
    const gafas = clamp01((progress - 0.3) / 0.25);
    const cadenas = clamp01((progress - 0.55) / 0.25);
    const micro = clamp01((progress - 0.8) / 0.2);
    pose.rapper = progress;

    // Mano delantera: sube al cráneo (gorra), baja al puente de la nariz
    // (gafas), al pecho (cadenas) y por último agarra el micro a la altura
    // de la boca.
    pose.armFrontOffY = -gorra * 16 + gafas * 5 + cadenas * 6 - micro * 13;
    pose.armFrontOffX = gorra * 2 + gafas * 4 - cadenas * 2 + micro * 6;
    // Mano trasera: acompaña en las cadenas y luego se abre gesticulando.
    pose.armBackOffY = -cadenas * 7 - micro * 4;
    pose.armBackOffX = -cadenas * 5 - micro * 7;
    // El cuerpo se va creciendo: chepa al ponerse la gorra y pecho fuera al
    // final, que es la postura con la que se planta a rapear.
    pose.torsoOffY = gorra * 3 - cadenas * 2 - micro * 3;
    pose.torsoOffX = micro * 4;
    pose.headOffY = gorra * 2 - micro * 2;
    pose.headOffX = gafas * 2 + micro * 3;
    pose.legFrontOffX = micro * 4;
    pose.legBackOffX = -micro * 3;
    pose.mic = micro;
    pose.notes = micro * 0.4;
    pose.hairSwing = hairs * (gorra * 4 - micro * 3);
  } else if (kind === 'rap') {
    // MODO RAPERO (cinemática): bota al ritmo con el micro en la mano y la
    // otra gesticulando. El rebote es lo único que hace falta para que se lea
    // "está rapeando" — la identidad la ponen la gorra, las gafas y las
    // cadenas, que dibuja el rasterizador cuando ve `pose.rapper`.
    const bounce = Math.sin(t * 9);
    const gesture = Math.sin(t * 9 + Math.PI * 0.5);
    pose.torsoOffY = -Math.abs(bounce) * 4;
    pose.headOffY = -Math.abs(bounce) * 5;
    pose.headOffX = bounce * 2;
    pose.armFrontOffY = -12 - bounce * 3; // micro en alto, pegado a la boca
    pose.armFrontOffX = 3 + bounce;
    pose.armBackOffY = -6 + gesture * 6;
    pose.armBackOffX = -4 + gesture * 7;
    pose.legFrontOffX = 3;
    pose.legBackOffX = -3;
    pose.legFrontOffY = -Math.abs(bounce) * 2;
    pose.rapper = 1; // ya transformado: la TOMA 1 lo ha subido de 0 a 1
    pose.mic = 1;
    pose.notes = 0.6 + Math.abs(bounce) * 0.4;
    pose.hairSwing = hairs * bounce * 3;
  } else if (kind === 'earpain') {
    // AGONÍA CÓMICA (víctima de la cinemática): DE RODILLAS, las dos manos
    // tapándose las orejas y temblando. Los brazos suben hasta la altura de
    // la cabeza, que es lo que lo hace legible de un vistazo.
    //
    // La caída al suelo se hace bajando el cuerpo entero y recogiendo las
    // piernas hacia dentro, no reorientando el rig: es la misma aproximación
    // que usa `knockdown`, y por el mismo motivo —un sprite de rodillas de
    // verdad exige redibujar la silueta—. Con `h` a mano la caída es
    // proporcional al personaje; sin ella (algún muestreo suelto) se cae a un
    // valor fijo en vez de romperse.
    const shake = Math.sin(t * 26) * 2;
    const cower = Math.sin(t * 5) * 0.5 + 0.5;
    const drop = (h || 120) * 0.17; // cuánto baja el cuerpo al arrodillarse
    pose.headOffX = shake - 2;
    pose.headOffY = drop + 3 + cower * 2;
    pose.torsoOffX = shake * 0.6 - 3;
    pose.torsoOffY = drop + 3 + cower * 2;
    pose.armFrontOffY = drop - 12 + shake; // manos a las orejas
    pose.armFrontOffX = -6;
    pose.armBackOffY = drop - 11 - shake;
    pose.armBackOffX = 4;
    // Muslos recogidos: las piernas se juntan y se hunden, que es lo que
    // convierte la postura encogida en un arrodillado.
    pose.legFrontOffX = -2;
    pose.legFrontOffY = drop;
    pose.legBackOffX = 2;
    pose.legBackOffY = drop;
    pose.earBlood = 1;
    pose.hairSwing = hairs * shake;
  } else if (kind === 'crouch') {
    // Postura baja. El rig no tiene rodillas articuladas, así que lo que se
    // hace es BAJAR torso, cabeza y brazos hasta solaparse con las piernas y
    // separar los pies: la silueta se lee agachada y, sobre todo, su parte
    // alta desaparece — que es exactamente lo que hace la hurtbox reducida.
    // Las piernas NO se desplazan en Y: son las que están en el suelo, y
    // moverlas hacia abajo metería los pies por debajo del plano.
    const breathe = Math.sin(t * 2.5) * 0.6;
    pose.torsoOffY = h * 0.14 + breathe;
    pose.headOffY = h * 0.16 + breathe;
    pose.headOffX = 1.5;
    pose.armBackOffY = h * 0.12;
    pose.armFrontOffY = h * 0.12;
    pose.armFrontOffX = 2.5;
    pose.legBackOffX = -3.5;
    pose.legFrontOffX = 3.5;
    pose.guard = 1;
    pose.hairSwing = hairs * 0.6;
  } else if (kind === 'block') {
    // Guardia sólida: los dos antebrazos cruzados cubriendo torso y cabeza,
    // el cuerpo girado y el peso atrás. Tiene que leerse de un vistazo como
    // "estoy defendiendo", claramente distinto de idle y de hitstun.
    const brace = Math.sin(t * 2) * 0.5;
    pose.armFrontOffX = -2;
    pose.armFrontOffY = -9 + brace;
    pose.armBackOffX = 2;
    pose.armBackOffY = -6 + brace;
    pose.torsoOffX = -3.5;
    pose.torsoOffY = 1.5;
    pose.headOffX = -2.5;
    pose.headOffY = 1.5;
    pose.legFrontOffX = -2.5;
    pose.legBackOffX = -4;
    pose.hairSwing = hairs * 0.8;
    if (kit === 'mecanico') {
      // Samuel: GUARDIA DE BOXEO. Nada de brazos cruzados (se leía como una
      // momia): los dos puños a la altura de la mandíbula, los codos cerrados
      // contra las costillas y apuntando al suelo, y el torso encorvado
      // hacia delante, compacto, con la cabeza hundida entre los hombros.
      // (Los puños, POR DELANTE de los hombros: con el torso encorvado, a la
      // altura de siempre quedaban justo encima del hombro y el codo, sin
      // sitio para bajar, se iba de lado cruzando el pecho.)
      pose.guard = 1;
      pose.armFrontOffX = 2;
      pose.armFrontOffY = 1 + brace;
      pose.armBackOffX = 0;
      pose.armBackOffY = 1 + brace;
      pose.torsoOffX = 1;
      pose.torsoOffY = 2;
      pose.lean = 3;
      pose.headOffX = 0;
      pose.headOffY = 3;
      pose.legFrontOffX = 2;
      pose.legBackOffX = -3;
    }
  } else if (kind === 'hitstun') {
    // Reacción de impacto: el torso se arquea hacia atrás y la cabeza va
    // detrás, con una vibración que se amortigua.
    const decay = 1 - progress;
    const shake = Math.sin(progress * 30) * decay * 2;
    pose.headOffX = shake - decay * 5;
    pose.headOffY = -decay * 2;
    pose.torsoOffX = shake * 0.6 - decay * 3.5;
    pose.armBackOffY = decay * 3;
    pose.armFrontOffY = decay * 3;
    pose.armFrontOffX = -decay * 4;
    if (kit === 'mecanico') {
      // Samuel: los brazos CUELGAN como en el reposo y el golpe los sacude
      // hacia arriba y atrás (desde el puño del kit original, junto a la
      // cadera y por fuera, los codos se cerraban hacia dentro: pinzas).
      pose.armFrontOffX = -5 - decay * 2;
      pose.armFrontOffY = 10.8 - decay * 6;
      pose.armBackOffX = 4 - decay * 2;
      pose.armBackOffY = 11.8 - decay * 6;
    }
    pose.legFrontOffX = -decay * 2;
    pose.hairSwing = hairs * -decay * 4;
  } else if (kind === 'air_hurt') {
    // Víctima de un juggle: flotando indefensa, sin control.
    const flail = Math.sin(t * 6) * 2.5;
    pose.armBackOffY = -5 + flail;
    pose.armFrontOffY = -5 - flail;
    pose.armFrontOffX = -3;
    if (kit === 'mecanico') {
      // Los brazos cuelgan y aletean arriba y abajo, a contrapié.
      pose.armFrontOffX = -5;
      pose.armFrontOffY = 7 - flail;
      pose.armBackOffX = 4;
      pose.armBackOffY = 8 + flail;
    }
    pose.legBackOffX = -4;
    pose.legFrontOffX = 4;
    pose.legBackOffY = 3;
    pose.legFrontOffY = 3;
    pose.headOffY = -2.5;
    pose.torsoOffX = -2;
    pose.hairSwing = hairs * (3 + flail);
  } else if (kind === 'knockdown') {
    // Derribo: la figura se aplasta contra el suelo y se ESTIRA en
    // horizontal (scale < 1 achata el rig entero y los miembros se separan),
    // para que la silueta tumbada se lea de verdad y no como un personaje
    // agachado. Sigue siendo una aproximación sobre el mismo rig: un sprite
    // tumbado real exigiría redibujar la silueta entera.
    pose.torsoOffY = h * 0.26;
    pose.headOffY = h * 0.23;
    pose.headOffX = -h * 0.05;
    pose.legBackOffY = h * 0.14;
    pose.legFrontOffY = h * 0.14;
    pose.legBackOffX = h * 0.05;
    pose.legFrontOffX = h * 0.08;
    pose.armBackOffY = h * 0.18;
    pose.armFrontOffY = h * 0.18;
    pose.armFrontOffX = -h * 0.06;
    pose.scale = 0.92;
    pose.hairSwing = hairs * -3;
  } else if (kind === 'wakeup') {
    // Levantarse: exactamente la pose de 'knockdown' interpolada de vuelta a
    // la de pie, así que derribo y wakeup encajan sin salto visual. Al final
    // se pasa un poco de largo (overshoot), que es el impulso de incorporarse.
    const down = 1 - progress;
    const rise = Math.sin(progress * Math.PI) * 2;
    pose.torsoOffY = h * 0.26 * down - rise;
    pose.headOffY = h * 0.23 * down - rise;
    pose.headOffX = -h * 0.05 * down;
    pose.legBackOffY = h * 0.14 * down;
    pose.legFrontOffY = h * 0.14 * down;
    pose.legBackOffX = h * 0.05 * down;
    pose.legFrontOffX = h * 0.08 * down;
    pose.armBackOffY = h * 0.18 * down;
    pose.armFrontOffY = h * 0.18 * down;
    pose.armFrontOffX = -h * 0.06 * down;
    pose.scale = 0.92 + 0.08 * progress;
    pose.hairSwing = hairs * (-3 + progress * 5);
  } else if (kind === 'stagger') {
    // Spin stagger: tambaleo sin control, con el torso y la cabeza oscilando
    // a contrafase de los brazos — se lee como "descompuesto pero en pie", a
    // diferencia del hitstun (que es un retroceso breve y se amortigua).
    const wobble = Math.sin(t * 5);
    pose.headOffX = wobble * 7;
    pose.headOffY = -1;
    pose.torsoOffX = wobble * 4.5;
    pose.armBackOffX = -wobble * 8;
    pose.armFrontOffX = wobble * 8;
    pose.armBackOffY = -2.5;
    pose.armFrontOffY = -2.5;
    if (kit === 'mecanico') {
      // Colgando y balanceándose, no con los puños abiertos a la cadera.
      pose.armFrontOffX = -5 + wobble * 5;
      pose.armFrontOffY = 9;
      pose.armBackOffX = 4 - wobble * 5;
      pose.armBackOffY = 10;
    }
    pose.legBackOffX = -wobble * 2.5;
    pose.legFrontOffX = wobble * 2.5;
    pose.hairSwing = hairs * wobble * 5;
  }

  return pose;
}

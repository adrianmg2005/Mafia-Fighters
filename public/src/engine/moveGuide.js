// GUÍA DE MOVIMIENTOS: qué se muestra en la pestaña "MOVIMIENTOS" de la pausa.
//
// Puro (sin canvas ni input) y DERIVADO: los números de cada fila —daño,
// frame de salida, ángulo— se leen de la moveTable del personaje, no se
// escriben a mano. Una guía que miente es peor que no tener guía: el jugador
// practica algo que el motor no hace. Lo único escrito a mano son los textos
// (nombre, entrada, consejo), que declara el propio personaje en su `guide`
// (ver characters/samuel.js).

import { PROJECTILE_KINDS } from './projectiles.js';

const round1 = (v) => Math.round(v * 10) / 10;

/**
 * Datos de un movimiento, derivados de su entrada.
 * @returns {{ damage: number|null, counter: number|null, startup: number|null,
 *             angle: number|null, charge: number|null }}
 */
export function moveData(moveTable, id) {
  const move = moveTable[id];
  if (!move) return null;
  let damage = null;
  let startup = null;
  let angle = null;
  let counter = null;
  // Un multi-hit suma un golpe por GRUPO (los tres enganches y el final del
  // Nair son 10%); un sweetspot y su parte floja son el mismo grupo, y se
  // muestra el mejor.
  const byGroup = new Map();
  for (const hb of move.hitboxes || []) {
    if (hb.grab) continue;
    startup = startup === null ? hb.from : Math.min(startup, hb.from);
    if (hb.damage === 'counter') continue;
    const g = hb.group ?? 'main';
    const prev = byGroup.get(g);
    if (!prev || hb.damage > prev.damage) byGroup.set(g, hb);
  }
  for (const hb of byGroup.values()) {
    damage = (damage ?? 0) + hb.damage;
    angle = hb.angle;
  }
  for (const spawn of move.spawn || []) {
    const hitbox = PROJECTILE_KINDS[spawn.projectile]?.hitbox;
    startup = startup === null ? spawn.frame : Math.min(startup, spawn.frame);
    if (hitbox) {
      damage = (damage ?? 0) + hitbox.damage;
      angle = hitbox.angle;
    }
  }
  if (move.throw) {
    damage = move.throw.damage;
    angle = move.throw.angle;
    startup = move.throw.frame;
  }
  if (move.slam) {
    damage = move.slam.damage;
    angle = move.slam.angle;
  }
  if (move.finalSmash) damage = move.finalSmash.damage;
  if (move.counter) {
    counter = move.counter.multiplier;
    startup = move.counter.from;
  }
  return {
    damage: damage === null ? null : round1(damage),
    counter,
    startup,
    angle,
    charge: move.charge ? move.charge.mul : null,
  };
}

/**
 * Filas de la guía para un personaje: los textos de su `guide` + los números
 * sacados de la tabla. `moves` lista los ids que cubre la fila (el primero
 * da el frame de salida; el daño se muestra como rango si varía).
 */
export function buildGuide(config) {
  return (config.guide?.sections || []).map((section) => {
    // Una sección puede ser del MODO DESPERTADO: sus números salen de esa tabla.
    const table = section.table === 'awakened' && config.awakened ? config.awakened.moveTable : config.moveTable;
    return {
    title: section.title,
    rows: section.entries.map((entry) => {
      const data = entry.moves.map((id) => moveData(table, id)).filter(Boolean);
      const damages = data.map((d) => d.damage).filter((d) => d !== null);
      const counter = data.find((d) => d.counter)?.counter ?? null;
      const charge = data.find((d) => d.charge)?.charge ?? null;
      let damageLabel = '-';
      if (damages.length) {
        const lo = Math.min(...damages);
        const hi = Math.max(...damages);
        damageLabel = lo === hi ? `${lo}%` : `${lo}-${hi}%`;
      } else if (counter) {
        damageLabel = `X${counter}`;
      }
      const startup = data[0]?.startup ?? null;
      return {
        input: entry.input,
        name: entry.name,
        tip: entry.tip,
        damage: damageLabel,
        startup: startup === null ? '-' : `F${startup}`,
        charge: charge ? `CARGA X${charge}` : '',
        moves: entry.moves,
      };
    }),
    };
  });
}

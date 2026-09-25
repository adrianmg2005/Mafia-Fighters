// PROYECTILES: todo lo que hace daño sin ser el cuerpo de un luchador.
//
// Viven en la simulación (host-autoritativa) y viajan en el snapshot como
// datos planos: el cliente remoto solo los coloca y los dibuja. Un movimiento
// los crea declarando `spawn: [{ frame, projectile, x, y }]` en su moveTable;
// el catálogo de abajo dice cómo se comporta cada uno. Añadir uno nuevo es
// una entrada aquí, no un caso especial en la simulación.
//
// Unidades: px/frame, como toda la física.

/**
 * @typedef {Object} ProjectileKind
 * @property {number} w, h          caja (centrada en x, y)
 * @property {number} vx, vy        velocidad inicial (vx hacia delante)
 * @property {number} gravity       px/f²
 * @property {number} life          frames de vida máxima
 * @property {object} [hitbox]      daño/bkb/kbg/ángulo como un hitbox normal
 * @property {boolean} [capture]    no golpea: ATRAPA (Final Smash)
 * @property {string} [cine]        con `capture`: qué cinemática ('gallos' por defecto, 'battle')
 * @property {object} [field]       no golpea: CAMPO { chipEvery, chipDamage, slow } (ver
 *                                  Simulation#applyFields)
 * @property {boolean} [breaksOnStage]  se rompe al tocar la losa
 * @property {object} [bounce]      { restitution, max }: rebota en superficies al caer
 * @property {boolean} [lingering]  caja estática que dura toda su vida
 */
export const PROJECTILE_KINDS = {
  // COJÍN DONUT de la embestida: parábola corta que REBOTA en el suelo (y en
  // los tablones) dos veces, perdiendo el 45% de su velocidad vertical en
  // cada bote, y al tercer contacto se deshace.
  donutCushion: {
    w: 48,
    h: 40,
    vx: 5.5,
    vy: -7,
    gravity: 0.45,
    life: 150,
    bounce: { restitution: 0.55, max: 2 },
    hitbox: {
      damage: 14, bkb: 50, kbg: 75, angle: 40, sfx: 'headbutt',
    },
  },
  // "Batalla de Gallos": la onda frontal que, si toca, arranca la cinemática.
  sonicWave: {
    w: 64,
    h: 116,
    vx: 11,
    vy: 0,
    gravity: 0,
    life: 56,
    capture: true,
  },
  // --- Modo Despertado ---------------------------------------------------
  // Puro Habanero: nube de humo de 200 px (un tercio de la losa) que dura
  // 4 s. No golpea: es un CAMPO. Al rival que esté dentro le quita
  // `chipDamage` cada `chipEvery` frames (2% por segundo) y le ralentiza un
  // `slow` (40%) mientras siga dentro.
  cigarCloud: {
    w: 200,
    h: 150,
    vx: 0,
    vy: 0,
    gravity: 0,
    life: 240,
    lingering: true,
    field: { chipEvery: 15, chipDamage: 0.5, slow: 0.4 },
  },
  // Nitro Gas: la detonación bajo los pies del Up-B despertado. Meteoro.
  nitroBlast: {
    w: 120,
    h: 80,
    vx: 0,
    vy: 0,
    gravity: 0,
    life: 10,
    lingering: true,
    hitbox: {
      damage: 16, bkb: 45, kbg: 95, angle: 270, vfx: 'gas', sfx: 'gas_blast',
    },
  },
  // Batalla de Gallos DEFINITIVA: la gorra lanzada a toda pantalla (16 px/f
  // durante 80 frames: 1280 px). Si toca, la cinemática de la batalla.
  capThrow: {
    w: 70,
    h: 60,
    vx: 16,
    vy: 0,
    gravity: 0,
    life: 80,
    capture: true,
    cine: 'battle',
  },
};

export class ProjectileSystem {
  constructor() {
    this.list = [];
    this.nextId = 1;
  }

  clear() {
    this.list.length = 0;
  }

  /**
   * @param {object} owner  luchador que lo lanza (se usa su slot, x, y y facing)
   * @param {{ projectile: string, x?: number, y?: number }} spec
   */
  spawn(owner, spec) {
    const kind = PROJECTILE_KINDS[spec.projectile];
    if (!kind) return null;
    const p = {
      id: this.nextId,
      kind: spec.projectile,
      owner: owner.slot,
      dir: owner.facing,
      x: owner.x + (spec.x ?? 0) * owner.facing,
      y: owner.y + (spec.y ?? 0),
      vx: kind.vx * owner.facing,
      vy: kind.vy,
      age: 0,
      dead: false,
    };
    this.nextId += 1;
    this.list.push(p);
    return p;
  }

  box(p) {
    const kind = PROJECTILE_KINDS[p.kind];
    return {
      x: p.x - kind.w / 2, y: p.y - kind.h / 2, w: kind.w, h: kind.h,
    };
  }

  /**
   * Un tick: mueve, envejece y rompe contra la losa. Devuelve los eventos de
   * presentación (roturas) para que la simulación los reenvíe.
   */
  update(geometry, blastZones) {
    const events = [];
    for (const p of this.list) {
      const kind = PROJECTILE_KINDS[p.kind];
      const prevBottom = p.y + kind.h / 2;
      p.age += 1;
      p.vy += kind.gravity;
      p.x += p.vx;
      p.y += p.vy;
      if (p.age >= kind.life) p.dead = true;
      if (kind.bounce && p.vy > 0) this.bounce(p, kind, geometry, prevBottom, events);
      if (kind.breaksOnStage) {
        const bottom = p.y + kind.h / 2;
        for (const s of geometry.solids) {
          if (p.x >= s.left && p.x <= s.right && bottom >= s.top && p.y - kind.h / 2 <= s.bottom) {
            p.dead = true;
            events.push({
              type: 'projectileBreak', kind: p.kind, x: p.x, y: s.top,
            });
            break;
          }
        }
      }
      if (p.x < blastZones.left || p.x > blastZones.right || p.y > blastZones.bottom || p.y < blastZones.top) {
        p.dead = true;
      }
    }
    this.list = this.list.filter((p) => !p.dead);
    return events;
  }

  // Bote: si en este tick ha cruzado hacia abajo la tapa de un sólido o de
  // un tablón, se posa encima y sale hacia arriba con `restitution` de su
  // velocidad; pasados `max` botes, se deshace.
  bounce(p, kind, geometry, prevBottom, events) {
    const bottom = p.y + kind.h / 2;
    const surfaces = [
      ...geometry.solids.map((s) => ({ left: s.left, right: s.right, top: s.top })),
      ...(geometry.platforms || []).map((s) => ({ left: s.left, right: s.right, top: s.y })),
    ];
    for (const s of surfaces) {
      if (p.x < s.left || p.x > s.right || prevBottom > s.top || bottom < s.top) continue;
      p.bounces = (p.bounces ?? 0) + 1;
      if (p.bounces > kind.bounce.max) {
        p.dead = true;
        events.push({
          type: 'projectileBreak', kind: p.kind, x: p.x, y: s.top,
        });
        return;
      }
      p.y = s.top - kind.h / 2;
      p.vy = -p.vy * kind.bounce.restitution;
      events.push({
        type: 'projectileBounce', kind: p.kind, x: p.x, y: s.top,
      });
      return;
    }
  }

  serialize() {
    return this.list.map((p) => ({
      id: p.id, kind: p.kind, owner: p.owner, dir: p.dir, x: p.x, y: p.y, vx: p.vx, vy: p.vy, age: p.age,
    }));
  }
}

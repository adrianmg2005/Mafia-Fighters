import { samuelConfig } from './samuel.js';

// Plantilla del juego: la ÚNICA lista de personajes. La simulación resuelve
// el `id` de cada ranura contra ella y el atlas de sprites se hornea por
// entrada.
//
// Desde el paso a platform fighter el roster es solo Samuel: es el único con
// kit completo estilo Smash (normales, tilts, aéreos, smash, especiales,
// agarres y Final Smash). Rook y Vixen tenían tablas de cadenas fijas
// (dial-a-combo), un sistema que ya no existe; se reincorporan escribiendo su
// `characters/nombre.js` con el formato de samuel.js y añadiéndolos aquí.
export const ROSTER = [samuelConfig];

export function rosterIndexOf(id) {
  const index = ROSTER.findIndex((entry) => entry.id === id);
  return index < 0 ? 0 : index;
}

export function rosterConfigById(id) {
  return ROSTER[rosterIndexOf(id)];
}

// Poses con las que un personaje puede acabar REACCIONANDO a un golpe ajeno
// (hoy: taparse los oídos en la cinemática de un Final Smash). Se recogen de
// TODO el roster porque cualquiera puede ser víctima de cualquiera, así que
// todos los atlas tienen que llevarlas horneadas.
export function rosterVictimPoses() {
  const poses = new Set();
  for (const entry of ROSTER) {
    for (const move of Object.values(entry.moveTable || {})) {
      if (move.finalSmash?.victimPose) poses.add(move.finalSmash.victimPose);
    }
  }
  return [...poses];
}

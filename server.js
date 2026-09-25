const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const DEFAULT_ROOM = 'lan-arena';

// Espejo de las blast zones del escenario (public/src/stages/patioFlotante.js)
// y de los topes del juego. Duplicadas a propósito —el servidor es CommonJS y
// el cliente ESM— y usadas SOLO para sanear lo que llega de fuera, nunca para
// simular. El margen es generoso: un luchador puede estar un frame más allá de
// la blast zone justo antes de que el host lo cuente como K.O.
const BLAST_ZONES = {
  top: -180, bottom: 780, left: -120, right: 1400,
};
const POSITION_SLACK = 400;
const MAX_PERCENT = 999;
const MAX_STOCKS = 3;
const MAX_PROJECTILES = 32;
const MAX_EVENTS = 256;
const PHASES = new Set(['lobby', 'countdown', 'fight', 'game', 'results']);

app.use(express.static(path.join(__dirname, 'public')));

// Modelo host-autoritativo: p1 (el primero en unirse a la sala) es siempre
// quien simula la partida completa; p2 solo envía su input y renderiza lo
// que p1 le manda. Un tercer cliente (o más) entra como espectador: no
// controla nada, solo recibe el mismo estado que p2. server.js sigue sin
// simular nada — es un relay entre quien manda ('p1') y quien escucha, que
// además valida lo que retransmite.
const rooms = new Map();

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { p1: null, p2: null, spectators: new Set() });
  }
  return rooms.get(roomId);
}

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

// Traza de la cadena de input. Se apaga con NET_LOG=0 en el entorno.
const NET_LOG = process.env.NET_LOG !== '0';

function describeInput(state) {
  const active = Object.entries(state || {}).filter(([, value]) => value).map(([key]) => key);
  return active.length ? active.join(', ') : '(neutro)';
}

const inRange = (v, lo, hi) => isFiniteNumber(v) && v >= lo && v <= hi;

// Sanidad mínima de un luchador dentro del snapshot. No recalcula nada: solo
// rechaza paquetes malformados (o manipulados) para que un cliente roto no
// pueda dejar el porcentaje de la otra pantalla en NaN, o un luchador dibujado
// a diez mil píxeles.
function isSaneFighterState(f) {
  if (!f || typeof f !== 'object') return false;
  if (f.slot !== 'p1' && f.slot !== 'p2') return false;
  if (typeof f.state !== 'string' || typeof f.anim !== 'string') return false;
  if (!inRange(f.x, BLAST_ZONES.left - POSITION_SLACK, BLAST_ZONES.right + POSITION_SLACK)) return false;
  if (!inRange(f.y, BLAST_ZONES.top - POSITION_SLACK, BLAST_ZONES.bottom + POSITION_SLACK)) return false;
  if (!inRange(f.percent, 0, MAX_PERCENT)) return false;
  if (!Number.isInteger(f.stocks) || f.stocks < 0 || f.stocks > MAX_STOCKS) return false;
  if (!inRange(f.meterMax, 1, 1000) || !inRange(f.meter, 0, f.meterMax)) return false;
  if (f.facing !== 1 && f.facing !== -1) return false;
  if (f.awakened !== undefined && typeof f.awakened !== 'boolean') return false;
  if (f.awakenLeft !== undefined && !inRange(f.awakenLeft, 0, 6000)) return false;
  return true;
}

function isSaneProjectile(p) {
  if (!p || typeof p !== 'object' || typeof p.kind !== 'string') return false;
  if (p.owner !== 'p1' && p.owner !== 'p2') return false;
  if (!inRange(p.x, BLAST_ZONES.left - POSITION_SLACK, BLAST_ZONES.right + POSITION_SLACK)) return false;
  return inRange(p.y, BLAST_ZONES.top - POSITION_SLACK, BLAST_ZONES.bottom + POSITION_SLACK);
}

// Cinemática del Final Smash. Es lo único que cambia el encuadre de las dos
// pantallas a la vez, así que un frame NaN o un total absurdo se descarta.
function isSaneCinematic(cine) {
  if (cine === undefined || cine === null) return true;
  if (typeof cine !== 'object') return false;
  if (!inRange(cine.total, 1, 600) || !inRange(cine.frame, 0, cine.total)) return false;
  // Qué cinemática: la Batalla de Gallos de siempre o la DEFINITIVA (Despertado).
  if (cine.kind !== undefined && cine.kind !== 'gallos' && cine.kind !== 'battle') return false;
  const slots = ['p1', 'p2'];
  return slots.includes(cine.attacker) && slots.includes(cine.victim) && cine.attacker !== cine.victim;
}

// Cinemática de corte del Despertar: congela las dos pantallas a la vez, así
// que un frame fuera de rango o un dueño inventado se descarta.
function isSaneCutin(cutin) {
  if (cutin === undefined || cutin === null) return true;
  if (typeof cutin !== 'object') return false;
  if (cutin.slot !== 'p1' && cutin.slot !== 'p2') return false;
  return inRange(cutin.total, 1, 600) && Number.isInteger(cutin.frame) && inRange(cutin.frame, 0, cutin.total);
}

// Validación del snapshot completo, aislada y testeable.
function isSaneSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  if (!PHASES.has(snapshot.phase)) return false;
  if (!Array.isArray(snapshot.fighters) || snapshot.fighters.length !== 2) return false;
  if (!snapshot.fighters.every(isSaneFighterState)) return false;
  if (!Array.isArray(snapshot.projectiles) || snapshot.projectiles.length > MAX_PROJECTILES) return false;
  if (!snapshot.projectiles.every(isSaneProjectile)) return false;
  if (!isSaneCinematic(snapshot.cine)) return false;
  if (!isSaneCutin(snapshot.cutin)) return false;
  // Pausa: un booleano y, si está pausado, quién pausó. Un `paused` basura
  // dejaría el panel de pausa abierto para siempre en la otra pantalla.
  if (snapshot.paused !== undefined && typeof snapshot.paused !== 'boolean') return false;
  if (snapshot.paused && snapshot.pausedBy !== 'p1' && snapshot.pausedBy !== 'p2') return false;
  if (snapshot.events !== undefined && (!Array.isArray(snapshot.events) || snapshot.events.length > MAX_EVENTS)) return false;
  return true;
}

io.on('connection', (socket) => {
  console.log(`[net] cliente conectado: ${socket.id}`);

  socket.on('join', (roomId = DEFAULT_ROOM) => {
    const room = getOrCreateRoom(roomId);
    let role;

    if (!room.p1) {
      room.p1 = socket.id;
      role = 'p1';
    } else if (!room.p2) {
      room.p2 = socket.id;
      role = 'p2';
    } else {
      room.spectators.add(socket.id);
      role = 'spectator';
    }

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = role;

    socket.emit('role_assigned', { role, roomId });
    console.log(`[net] ${socket.id} -> sala "${roomId}" como ${role}`);

    if (room.p1 && room.p2) {
      io.to(roomId).emit('match-start');
    }
  });

  // Input local de p1 o p2, retransmitido al resto de la sala. Solo el host
  // (p1) lo necesita de verdad (para simular al rival), pero se reenvía sin
  // filtrar por si un futuro espectador quiere mostrarlo.
  socket.on('input', (inputState) => {
    const { roomId, role } = socket.data;
    if (!roomId || role === 'spectator') return;
    socket.to(roomId).emit('peer-input', { role, inputState });

    // Traza del eslabón intermedio de la cadena de input. Solo escribe CUANDO
    // CAMBIA: el input llega 60 veces por segundo y sin el filtro la consola
    // del servidor sería ilegible. Es el punto de control que dice si el
    // problema está antes (el cliente no emite) o después (el host no aplica).
    if (NET_LOG) {
      const label = describeInput(inputState);
      if (label !== socket.data.lastInputLabel) {
        socket.data.lastInputLabel = label;
        const listeners = (io.sockets.adapter.rooms.get(roomId)?.size ?? 1) - 1;
        console.log(`[Net] Input de ${role} retransmitido a sala "${roomId}" (${listeners} receptor/es): ${label}`);
      }
    }
  });

  // Solo el host (p1) tiene autoridad para difundir el estado de la partida;
  // cualquier otro origen se ignora (evita que un cliente manipulado o un
  // espectador intenten suplantar la simulación). Además se valida que
  // posiciones, porcentajes, stocks y medidores sean números sanos y dentro de
  // rango: el relay no arregla un snapshot malo, lo descarta entero, que es
  // preferible a propagar un NaN a las otras pantallas.
  socket.on('state', (snapshot) => {
    const { roomId, role } = socket.data;
    if (!roomId || role !== 'p1') return;
    if (!isSaneSnapshot(snapshot)) return;
    socket.to(roomId).emit('state-sync', snapshot);
  });

  socket.on('disconnect', () => {
    const { roomId, role } = socket.data;
    if (roomId && rooms.has(roomId)) {
      const room = rooms.get(roomId);
      if (role === 'p1' && room.p1 === socket.id) room.p1 = null;
      if (role === 'p2' && room.p2 === socket.id) room.p2 = null;
      room.spectators.delete(socket.id);

      io.to(roomId).emit('opponent-left', { role });

      if (!room.p1 && !room.p2 && room.spectators.size === 0) {
        rooms.delete(roomId);
      }
    }
    console.log(`[net] cliente desconectado: ${socket.id}`);
  });
});

// Solo se levanta el listener al ejecutar `node server.js` directamente. Al
// requerirlo desde un test se exportan únicamente las funciones puras de
// arbitraje/validación, sin ocupar el puerto.
if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`Servidor LAN escuchando en http://${HOST}:${PORT}`);
    console.log('Otros jugadores en la misma red local pueden conectarse usando la IP de esta máquina.');
  });
}

module.exports = {
  isSaneSnapshot,
  isSaneFighterState,
  isSaneProjectile,
  isSaneCinematic,
  getOrCreateRoom,
  BLAST_ZONES,
};

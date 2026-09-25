const ROOM_ID = new URLSearchParams(window.location.search).get('room') || 'lan-arena';

// Cliente de Socket.io para el modelo host-autoritativo: p1 es siempre quien
// simula la partida (emite 'state'); p2 y los espectadores solo envían su
// input local (si tienen uno) y reciben 'state-sync' para dibujar.
//
// El Final Smash ya no necesita un protocolo propio de confirmación: su
// cinemática es parte de la simulación (engine/simulation.js) y viaja en el
// snapshot como cualquier otro estado, así que las dos pantallas la ven en el
// mismo frame por construcción.
export class NetworkClient {
  constructor({
    onRoleAssigned, onMatchStart, onPeerInput, onStateSync, onOpponentLeft,
  } = {}) {
    this.socket = io();
    this.role = null;

    this.socket.on('connect', () => {
      this.socket.emit('join', ROOM_ID);
    });
    this.socket.on('role_assigned', ({ role, roomId }) => {
      this.role = role;
      onRoleAssigned?.({ role, roomId });
    });
    this.socket.on('match-start', () => onMatchStart?.());
    this.socket.on('peer-input', (payload) => onPeerInput?.(payload));
    this.socket.on('state-sync', (snapshot) => onStateSync?.(snapshot));
    this.socket.on('opponent-left', (payload) => onOpponentLeft?.(payload));
  }

  get isHost() {
    return this.role === 'p1';
  }

  // p1 y p2 tienen input local propio que enviar; un espectador no controla nada.
  sendInput(inputState) {
    if (this.role === 'spectator' || this.role === null) return;
    this.socket.emit('input', inputState);
  }

  // Solo el host (p1) tiene autoridad para difundir el estado de la partida.
  sendState(snapshot) {
    if (this.role !== 'p1') return;
    this.socket.emit('state', snapshot);
  }
}

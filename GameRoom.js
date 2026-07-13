/**
 * GameRoom.js
 * Sala de jogo multiplayer — modelo de autoridade no cliente.
 *
 * A física NÃO roda no servidor. O cliente dono da vez (posse) simula a
 * física localmente e envia snapshots via `physics_state`; o servidor apenas
 * repassa ao outro cliente (relay puro). Esta classe só guarda os sockets
 * da sala e qual time detém a autoridade no momento (informativo).
 */

export class GameRoom {
  constructor(roomCode, config) {
    this.roomCode = roomCode;
    this.config = config;
    this.yellowSocketId = null;
    this.blueSocketId = null;

    // Time que detém a autoridade da física (dono da vez).
    // Atualizado a partir dos snapshots recebidos — o jogo começa com yellow.
    this.authorityTeam = 'yellow';

    this.isRunning = false;
    this.createdAt = Date.now();

    console.log(`[GameRoom] ${roomCode} criada (relay puro, física no cliente)`);
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`[GameRoom] ${this.roomCode} iniciada`);
  }

  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    console.log(`[GameRoom] ${this.roomCode} parada`);
  }

  /**
   * Dado um socket, retorna o time correspondente (ou null).
   */
  teamOf(socketId) {
    if (socketId === this.yellowSocketId) return 'yellow';
    if (socketId === this.blueSocketId) return 'blue';
    return null;
  }

  /**
   * Dado um socket, retorna o socketId do oponente (ou null).
   */
  opponentSocketId(socketId) {
    if (socketId === this.yellowSocketId) return this.blueSocketId;
    if (socketId === this.blueSocketId) return this.yellowSocketId;
    return null;
  }
}

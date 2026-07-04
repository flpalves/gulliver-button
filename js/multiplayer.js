/**
 * js/multiplayer.js
 * Gerenciador de conexão multiplayer do cliente
 *
 * Responsável por:
 * - Passo 19: Conectar ao servidor via Socket.io
 * - Passo 20: Receber state_update
 * - Passo 21: Interpolar movimento visual
 * - Passo 22: Enviar player_input
 * - Passo 23: Sincronizar HUD
 */

export class MultiplayerManager {
  constructor() {
    this.socket = null;
    this.isActive = false;
    this.roomCode = null;
    this.myTeam = null;
    this.isConnected = false;
    this.isRoomCreator = false;
    this.gameState = null;
    this.previousState = null;
    this.interpolationAlpha = 0;
    this.lastStateTime = Date.now();
    this.isMyTurn = false;
    this.onStateUpdated = null;
    this.onRoomReady = null;
    this.onOpponentDisconnected = null;
    this.onConnected = null;
    this.onError = null;
    this.pendingRoomConfig = null;
    this.pendingRoomCodeToJoin = null;
    console.log('[Multiplayer] Manager inicializado');
  }

  // PASSO 19: CONECTAR AO SERVIDOR
  connect(serverUrl = 'http://localhost:3000') {
    console.log(`[Multiplayer] Conectando a ${serverUrl}...`);
    if (typeof window.io === 'undefined') {
      console.error('[Multiplayer] Socket.io não carregado');
      if (this.onError) this.onError('Socket.io não disponível');
      return;
    }
    this.socket = window.io(serverUrl, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5
    });
    this.setupEventListeners();
  }

  setupEventListeners() {
    this.socket.on('connect', () => {
      this.isConnected = true;
      console.log(`[Multiplayer] Conectado. ID: ${this.socket.id.substring(0, 8)}...`);
      if (this.onConnected) {
        console.log('[Multiplayer] Chamando onConnected callback...');
        this.onConnected();
      }
      // Se há uma sala pendente para criar, criar agora
      if (this.pendingRoomConfig) {
        console.log('[Multiplayer] Criando sala pendente...');
        this.socket.emit('create_room', { gameConfig: this.pendingRoomConfig });
        this.pendingRoomConfig = null;
      }
      // Se há uma sala pendente para entrar, entrar agora
      if (this.pendingRoomCodeToJoin) {
        console.log('[Multiplayer] Entrando em sala pendente:', this.pendingRoomCodeToJoin);
        this.socket.emit('join_room', this.pendingRoomCodeToJoin);
        this.pendingRoomCodeToJoin = null;
      }
    });

    this.socket.on('disconnect', () => {
      this.isConnected = false;
      this.isActive = false;
      console.log('[Multiplayer] Desconectado');
    });

    this.socket.on('room_created', (data) => {
      this.roomCode = data.roomCode;
      this.myTeam = 'yellow';
      this.isRoomCreator = true;
      console.log(`[Multiplayer] Sala criada: ${this.roomCode}`);
      this._dispatch('roomCreated', { roomCode: data.roomCode, myTeam: this.myTeam });
    });

    this.socket.on('room_ready', (data) => {
      this.isActive = true;
      this.myTeam = data.myTeam || this.myTeam;
      this.roomCode = data.roomCode;
      console.log(`[Multiplayer] Sala pronta! Time: ${this.myTeam}`, data);
      console.log(`[Multiplayer] onRoomReady callback exists: ${!!this.onRoomReady}`);
      if (this.onRoomReady) {
        console.log('[Multiplayer] Chamando onRoomReady callback...');
        this.onRoomReady(data);
      } else {
        console.error('[Multiplayer] ❌ onRoomReady callback NÃO foi definido!');
      }
      this._dispatch('roomReady', data);
    });

    // PASSO 20: Receber state_update
    this.socket.on('state_update', (state) => {
      console.log('[Multiplayer] Received state_update from server:', {
        ballPos: state?.ball?.pos,
        possession: state?.possession,
        yellowPlayers: state?.players?.yellow?.length,
        bluePlayers: state?.players?.blue?.length
      });

      this.previousState = this.gameState;
      this.gameState = state;
      this.lastStateTime = Date.now();
      this.interpolationAlpha = 0;
      // Atualizar se é minha vez
      this.isMyTurn = state.possession === this.myTeam;

      if (this.onStateUpdated) {
        console.log('[Multiplayer] Calling onStateUpdated callback');
        this.onStateUpdated(state);
      } else {
        console.warn('[Multiplayer] No onStateUpdated callback set!');
      }
    });

    this.socket.on('opponent_disconnected', () => {
      this.isActive = false;
      console.log('[Multiplayer] Oponente desconectou');
      if (this.onOpponentDisconnected) this.onOpponentDisconnected();
      this._dispatch('opponentDisconnected', {});
    });

    this.socket.on('team_changed', (payload) => {
      console.log('[Multiplayer] 🔔 RECEIVED team_changed:', payload);
      this._dispatch('teamChanged', payload);
    });

    this.socket.on('settings_changed', (payload) => {
      console.log('[Multiplayer] 🔔 RECEIVED settings_changed:', payload);
      this._dispatch('settingsChanged', payload);
    });

    this.socket.on('join_error', (data) => {
      console.error('[Multiplayer] Join error:', data.message);
      this._dispatch('joinError', data);
    });

    this.socket.on('settings_error', (data) => {
      console.error('[Multiplayer] Settings error:', data.message);
      this._dispatch('settingsError', data);
    });

    this.socket.on('both_players_ready', (data) => {
      console.log('[Multiplayer] 🚀 Both players ready! Game starting...');
      this._dispatch('bothPlayersReady', data);
    });

    this.socket.on('shot_fired', (payload) => {
      console.log('[Multiplayer] 📤 RECEIVED shot_fired:', payload);
      if (this.onRemoteShotFired) {
        this.onRemoteShotFired(payload);
      }
    });

    this.socket.on('error', (data) => {
      console.error('[Multiplayer] Erro:', data.message);
      if (this.onError) this.onError(data.message);
    });
  }

  createRoom(gameConfig) {
    console.log('[Multiplayer] createRoom chamado, isConnected:', this.isConnected);
    if (!this.isConnected) {
      console.log('[Multiplayer] Aguardando conexão... Armazenando config para criar sala depois');
      this.pendingRoomConfig = gameConfig;
      return;
    }
    console.log('[Multiplayer] Emitindo create_room event...');
    this.socket.emit('create_room', { gameConfig });
  }

  joinRoom(roomCode) {
    console.log('[Multiplayer] joinRoom chamado, roomCode:', roomCode, 'isConnected:', this.isConnected);
    if (!this.isConnected) {
      console.log('[Multiplayer] Aguardando conexão para entrar na sala...');
      this.pendingRoomCodeToJoin = roomCode;
      return;
    }
    console.log('[Multiplayer] Emitindo join_room event...');
    this.socket.emit('join_room', roomCode);
  }

  // PASSO 22: ENVIAR PLAYER INPUT
  sendPlayerInput(playerIdx, directionX, directionZ, intensity) {
    if (!this.isActive || !this.socket) return;

    const dirMag = Math.sqrt(directionX ** 2 + directionZ ** 2);
    if (dirMag === 0) return;

    const normX = directionX / dirMag;
    const normZ = directionZ / dirMag;
    const clampedIntensity = Math.max(0, Math.min(intensity, 1.0));

    this.socket.emit('player_input', {
      playerIdx,
      directionX: normX,
      directionZ: normZ,
      intensity: clampedIntensity,
      timestamp: Date.now()
    });
  }

  // PASSO 20: Getters para estado remoto
  getPlayerPosition(team, playerIdx) {
    if (!this.gameState?.players) return null;

    const currentPlayer = this.gameState.players[team][playerIdx];
    if (!currentPlayer) return null;

    if (this.previousState?.players[team][playerIdx]) {
      const prevPlayer = this.previousState.players[team][playerIdx];
      const alpha = this.interpolationAlpha;

      return {
        x: prevPlayer.pos.x + (currentPlayer.pos.x - prevPlayer.pos.x) * alpha,
        y: currentPlayer.pos.y,
        z: prevPlayer.pos.z + (currentPlayer.pos.z - prevPlayer.pos.z) * alpha
      };
    }

    return currentPlayer.pos;
  }

  getBallPosition() {
    if (!this.gameState?.ball) return null;

    const currentBall = this.gameState.ball;

    if (this.previousState?.ball) {
      const prevBall = this.previousState.ball;
      const alpha = this.interpolationAlpha;

      return {
        x: prevBall.pos.x + (currentBall.pos.x - prevBall.pos.x) * alpha,
        y: prevBall.pos.y + (currentBall.pos.y - prevBall.pos.y) * alpha,
        z: prevBall.pos.z + (currentBall.pos.z - prevBall.pos.z) * alpha
      };
    }

    return currentBall.pos;
  }

  canDragPiece(team, playerIdx) {
    if (!this.isActive || !this.gameState) return false;
    if (team !== this.myTeam) return false;
    if (this.gameState.possession !== this.myTeam) return false;
    if (this.gameState.canInteract && !this.gameState.canInteract[this.myTeam]) return false;
    return true;
  }

  // PASSO 23: SINCRONIZAR HUD
  getHUDData() {
    if (!this.gameState) return null;

    return {
      scores: this.gameState.scores,
      possession: this.gameState.possession,
      touches: this.gameState.touches,
      maxTouches: this.gameState.maxTouches || 4,
      half: this.gameState.half,
      timeLeft: this.gameState.timeLeft,
      gameStatus: this.gameState.gameStatus,
      myTeam: this.myTeam,
      ping: this.calculatePing()
    };
  }

  calculatePing() {
    if (!this.gameState) return 0;
    const latency = Date.now() - this.gameState.timestamp;
    return Math.max(0, latency);
  }

  getSyncInfo() {
    return {
      isActive: this.isActive,
      isConnected: this.isConnected,
      roomCode: this.roomCode,
      myTeam: this.myTeam,
      tick: this.gameState?.tick || 0,
      stateAge: Date.now() - this.lastStateTime
    };
  }

  emitTeamChanged(team1Id, team2Id) {
    if (!this.isConnected || !this.socket) return;
    this.socket.emit('team_changed', { team1: team1Id, team2: team2Id });
    console.log('[Multiplayer] Emitted team_changed:', { team1: team1Id, team2: team2Id });
  }

  emitSettingsChanged(gameConfig) {
    if (!this.isConnected || !this.socket) return;
    this.socket.emit('settings_changed', { gameConfig });
    console.log('[Multiplayer] Emitted settings_changed:', gameConfig);
  }

  emitPlayerReady() {
    if (!this.isConnected || !this.socket) return;
    this.socket.emit('player_ready', {});
    console.log('[Multiplayer] Emitted player_ready');
  }

  emitShotFired(playerIdx, impulse, bodyStates) {
    if (!this.isActive || !this.socket) return;
    this.socket.emit('shot_fired', {
      playerIdx,
      impulse,
      bodyStates,
      timestamp: Date.now()
    });
    console.log('[Multiplayer] Emitted shot_fired:', { playerIdx, impulse });
  }

  _dispatch(eventName, detail) {
    const event = new CustomEvent(`multiplayer:${eventName}`, { detail });
    window.dispatchEvent(event);
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.isActive = false;
      this.isConnected = false;
      console.log('[Multiplayer] Desconectado');
    }
  }
}

export const multiplayer = new MultiplayerManager();

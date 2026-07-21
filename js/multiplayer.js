/**
 * js/multiplayer.js
 * Gerenciador de conexão multiplayer do cliente
 *
 * Modelo: autoridade no cliente dono da vez.
 * - O cliente com a posse (autoridade) simula a física e envia snapshots
 *   (`physics_state`) ao servidor a ~20 Hz; o servidor repassa ao outro.
 * - O cliente espectador pausa a física local e aplica os snapshots
 *   recebidos com interpolação.
 * - Quando a posse muda e a jogada termina (bola parada), o dono envia um
 *   snapshot final com `handoff: true` e a autoridade passa ao outro lado.
 */

const SESSION_KEY = 'gulliver_mp_session';

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

    // ── Autoridade da física (dono da vez) ──
    this.isAuthority = false;         // true = eu simulo a física e envio snapshots
    this.currentSnapshot = null;      // último snapshot recebido do oponente
    this.previousSnapshot = null;     // snapshot anterior (para interpolação)
    this.onPhysicsState = null;       // callback(snapshot) a cada snapshot recebido
    this.onRemoteKeeperReposition = null;   // callback({playerIdx, x, z}) — goleiro do espectador movido

    this.onStateUpdated = null;
    this.onRoomReady = null;
    this.onOpponentDisconnected = null;
    this.onOpponentReconnected = null;
    this.onOpponentLeft = null;
    this.onConnected = null;
    this.onError = null;
    this.pendingRoomConfig = null;
    this.pendingRoomCodeToJoin = null;
    this.pendingRejoin = null;
    console.log('[Multiplayer] Manager inicializado');
  }

  // PASSO 19: CONECTAR AO SERVIDOR
  // Por padrão conecta na mesma origem que serviu a página (o Express serve
  // cliente e Socket.io juntos), funcionando em qualquer porta/host.
  connect(serverUrl = window.location.origin) {
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
      // Se há uma reconexão pendente (ex.: F5 durante a partida), retomar agora
      if (this.pendingRejoin) {
        console.log('[Multiplayer] Reconectando à sala pendente:', this.pendingRejoin);
        this.socket.emit('rejoin_room', this.pendingRejoin);
        this.pendingRejoin = null;
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

    // Receber snapshot de física do oponente (via relay do servidor)
    this.socket.on('physics_state', (snapshot) => {
      if (!snapshot) return;
      snapshot.receivedAt = performance.now();
      this.previousSnapshot = this.currentSnapshot;
      this.currentSnapshot = snapshot;
      this.lastStateTime = Date.now();

      if (this.onPhysicsState) {
        this.onPhysicsState(snapshot);
      }
    });

    // Oponente caiu, mas a sala é mantida por um período de graça — o jogo
    // continua pausado à espera de reconexão (ver `rejoin_room`).
    this.socket.on('opponent_disconnected', (data) => {
      console.log('[Multiplayer] Oponente desconectou (aguardando reconexão)', data);
      if (this.onOpponentDisconnected) this.onOpponentDisconnected(data);
      this._dispatch('opponentDisconnected', data);
    });

    // Oponente voltou dentro do período de graça
    this.socket.on('opponent_reconnected', (data) => {
      console.log('[Multiplayer] Oponente reconectou', data);
      if (this.onOpponentReconnected) this.onOpponentReconnected(data);
      this._dispatch('opponentReconnected', data);
    });

    // Período de graça expirou sem o oponente voltar — a sala foi encerrada
    this.socket.on('opponent_left', (data) => {
      this.isActive = false;
      this.clearSession();
      console.log('[Multiplayer] Oponente não reconectou a tempo, sala encerrada', data);
      if (this.onOpponentLeft) this.onOpponentLeft(data);
      this._dispatch('opponentLeft', data);
    });

    // Resposta ao pedido de reconexão (ex.: depois de um F5)
    this.socket.on('rejoin_success', (data) => {
      this.isActive = true;
      this.myTeam = data.myTeam || this.myTeam;
      this.roomCode = data.roomCode;
      console.log('[Multiplayer] Reconectado à sala com sucesso', data);
      this._dispatch('rejoined', data);
    });

    this.socket.on('rejoin_failed', (data) => {
      console.warn('[Multiplayer] Falha ao reconectar:', data.message);
      this.clearSession();
      this._dispatch('rejoinFailed', data);
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

    this.socket.on('opponent_ready', (data) => {
      console.log('[Multiplayer] Oponente está pronto', data);
      this._dispatch('opponentReady', data);
    });

    this.socket.on('shot_fired', (payload) => {
      console.log('[Multiplayer] 📤 RECEIVED shot_fired:', payload);
      if (this.onRemoteShotFired) {
        this.onRemoteShotFired(payload);
      }
    });

    // Espectador reposicionando o próprio goleiro — só faz sentido aplicar
    // se formos nós a autoridade da física agora (ver Game._onRemoteKeeperReposition).
    this.socket.on('keeper_reposition', (payload) => {
      if (this.onRemoteKeeperReposition) {
        this.onRemoteKeeperReposition(payload);
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

  // Retomar uma sala existente após perder a conexão (ex.: F5 sem querer).
  rejoinRoom(roomCode, team) {
    console.log('[Multiplayer] rejoinRoom chamado, roomCode:', roomCode, 'team:', team, 'isConnected:', this.isConnected);
    if (!this.isConnected) {
      this.pendingRejoin = { roomCode, team };
      return;
    }
    this.socket.emit('rejoin_room', { roomCode, team });
  }

  // ── Persistência da sessão (permite retomar a partida depois de um F5) ──
  saveSession(gameConfig) {
    if (typeof sessionStorage === 'undefined') return;
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        roomCode: this.roomCode,
        myTeam: this.myTeam,
        isRoomCreator: this.isRoomCreator,
        gameConfig
      }));
    } catch (e) {
      console.warn('[Multiplayer] Falha ao salvar sessão:', e);
    }
  }

  static loadSession() {
    if (typeof sessionStorage === 'undefined') return null;
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  clearSession() {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.removeItem(SESSION_KEY);
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

  // Cue de chute para o espectador (som/UI) — a física em si viaja via snapshots
  emitShotFired(playerIdx, impulse) {
    if (!this.isActive || !this.socket) return;
    this.socket.emit('shot_fired', {
      playerIdx,
      impulse,
      timestamp: Date.now()
    });
  }

  // Enviar snapshot de física ao servidor (apenas quando somos a autoridade)
  sendPhysicsState(snapshot) {
    if (!this.isActive || !this.socket) return;
    this.socket.emit('physics_state', snapshot);
  }

  // Reposicionamento livre do próprio goleiro enquanto somos espectador (sem
  // autoridade de física) — o dono da vez aplica direto na simulação dele.
  emitKeeperReposition(playerIdx, x, z) {
    if (!this.isActive || !this.socket) return;
    this.socket.emit('keeper_reposition', { playerIdx, x, z });
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
    this.clearSession();
  }
}

export const multiplayer = new MultiplayerManager();

// ── App indo para background (troca de app / bloqueio de tela) ──
// Socket.io já reconecta sozinho (reconnection: true no connect()); aqui só
// avisamos o jogador com um toast, já que em mobile é comum minimizar o
// navegador no meio de uma jogada e voltar sem entender por que travou.
function _showBackgroundToast(msg) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const pill = document.createElement('div');
  pill.className = 'toast-pill toast-warning';
  pill.textContent = msg;
  container.appendChild(pill);
  setTimeout(() => pill.remove(), 3000);
}

document.addEventListener('visibilitychange', () => {
  if (!multiplayer.isActive) return;
  if (document.hidden) {
    console.log('[Multiplayer] App em segundo plano — aguardando volta...');
  } else {
    console.log('[Multiplayer] App voltou ao primeiro plano.');
    if (!multiplayer.isConnected) {
      _showBackgroundToast('🔌 Reconectando...');
    }
  }
});

// iOS Safari nem sempre dispara visibilitychange ao trocar de app; pagehide
// é o sinal mais confiável ali.
window.addEventListener('pagehide', () => {
  if (multiplayer.isActive) {
    console.log('[Multiplayer] Página suspensa (pagehide) durante partida ativa.');
  }
});

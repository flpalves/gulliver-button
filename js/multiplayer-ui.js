/**
 * js/multiplayer-ui.js
 * Gerencia UI e fluxo do multiplayer integrado ao jogo
 *
 * Responsável por:
 * - Menu de escolha (Local vs Online)
 * - Lobby (Criar/Entrar Sala)
 * - Sala de Espera
 * - Sincronizar HUD com servidor
 */

import { MultiplayerManager } from './multiplayer.js';

export class MultiplayerUI {
  constructor() {
    this.multiplayer = null;
    this.gameMode = 'local';
    this.onGameStart = null;
    this.setupEventListeners();
    console.log('[MultiplayerUI] Inicializado');
  }

  setupEventListeners() {
    // Menu principal
    document.getElementById('local-mode-btn').onclick = () => this.startLocal();
    document.getElementById('online-mode-btn').onclick = () => this.startOnline();

    // Lobby
    document.getElementById('back-to-mode-btn').onclick = () => this.backToModeSelection();
    document.getElementById('create-room-btn').onclick = () => this.startCreateRoom();
    document.getElementById('join-room-btn').onclick = () => this.startJoinRoom();
  }

  // ========== LOCAL MODE ==========
  startLocal() {
    console.log('[MultiplayerUI] Iniciando modo LOCAL');
    this.gameMode = 'local';
    document.getElementById('mode-select-overlay').classList.add('hidden');
    
    if (this.onGameStart) {
      this.onGameStart('local', null);
    }
  }

  // ========== ONLINE MODE ==========
  startOnline() {
    console.log('[MultiplayerUI] Iniciando modo ONLINE');
    this.gameMode = 'multiplayer';
    
    // Mostrar lobby
    document.getElementById('mode-select-overlay').classList.add('hidden');
    document.getElementById('lobby-overlay').classList.remove('hidden');
  }

  backToModeSelection() {
    document.getElementById('lobby-overlay').classList.add('hidden');
    document.getElementById('mode-select-overlay').classList.remove('hidden');
  }

  // ========== CRIAR SALA ==========
  startCreateRoom() {
    console.log('[MultiplayerUI] Criando sala...');
    
    // Mostrar tela de conexão
    document.getElementById('lobby-overlay').classList.add('hidden');
    document.getElementById('create-room-overlay').classList.remove('hidden');

    // Inicializar multiplayer
    this.multiplayer = new MultiplayerManager();

    this.multiplayer.onRoomReady = (data) => {
      console.log('[MultiplayerUI] Sala pronta!', data);
      this.showWaitingRoom(data.roomCode, data.myTeam);
      
      // Iniciar jogo após 2 segundos
      setTimeout(() => {
        this.startMultiplayerGame(data.myTeam);
      }, 2000);
    };

    this.multiplayer.onError = (msg) => {
      alert('Erro: ' + msg);
      this.backToModeSelection();
    };

    // Conectar e criar sala
    this.multiplayer.connect();
    this.multiplayer.createRoom({
      gameMode: 'button_football',
      yellowTeam: 'flamengo',
      blueTeam: 'palmeiras',
      matchDuration: 600
    });
  }

  // ========== ENTRAR EM SALA ==========
  startJoinRoom() {
    const roomCode = prompt('Digite o código da sala (4 letras):');
    if (!roomCode || roomCode.length !== 4) {
      alert('Código inválido');
      return;
    }

    console.log('[MultiplayerUI] Entrando na sala', roomCode);

    // Mostrar tela de conexão
    document.getElementById('lobby-overlay').classList.add('hidden');
    document.getElementById('create-room-overlay').classList.remove('hidden');
    document.querySelector('.menu-title').textContent = 'Entrando na sala...';

    // Inicializar multiplayer
    this.multiplayer = new MultiplayerManager();

    this.multiplayer.onRoomReady = (data) => {
      console.log('[MultiplayerUI] Sala pronta!', data);
      this.showWaitingRoom(data.roomCode, data.myTeam);
      
      // Iniciar jogo após 2 segundos
      setTimeout(() => {
        this.startMultiplayerGame(data.myTeam);
      }, 2000);
    };

    this.multiplayer.onError = (msg) => {
      alert('Erro: ' + msg);
      this.backToModeSelection();
    };

    // Conectar e entrar na sala
    this.multiplayer.connect();
    this.multiplayer.joinRoom(roomCode);
  }

  // ========== SALA DE ESPERA ==========
  showWaitingRoom(roomCode, myTeam) {
    document.getElementById('create-room-overlay').classList.add('hidden');
    document.getElementById('waiting-room-overlay').classList.remove('hidden');
    document.getElementById('room-code-display').textContent = roomCode;
    
    // Mostrar qual time você é
    const teamDisplay = myTeam === 'yellow' ? '🟡 AMARELO' : '🔵 AZUL';
    const waitingMsg = document.createElement('div');
    waitingMsg.style.color = '#fff';
    waitingMsg.style.marginTop = '20px';
    waitingMsg.textContent = `Seu time: ${teamDisplay}`;
    document.querySelector('#waiting-room-overlay .menu-box').appendChild(waitingMsg);
  }

  // ========== INICIAR JOGO MULTIPLAYER ==========
  startMultiplayerGame(myTeam) {
    console.log('[MultiplayerUI] Iniciando jogo multiplayer, seu time:', myTeam);
    
    document.getElementById('waiting-room-overlay').classList.add('hidden');

    if (this.onGameStart) {
      this.onGameStart('multiplayer', this.multiplayer);
    }
  }

  // ========== SINCRONIZAR HUD COM SERVIDOR ==========
  syncHUDWithServer() {
    if (!this.multiplayer || !this.multiplayer.isActive) {
      return; // Modo local, não sincroniza
    }

    const hud = this.multiplayer.getHUDData();
    if (!hud) return;

    // Sincronizar HUD
    document.getElementById('sy').textContent = hud.scores.yellow;
    document.getElementById('sb').textContent = hud.scores.blue;

    const timeStr = `${hud.half}T ${Math.floor(hud.timeLeft / 60).toString().padStart(2, '0')}:${(hud.timeLeft % 60).toString().padStart(2, '0')}`;
    document.getElementById('timer-val').textContent = timeStr;

    const possStr = hud.possession === 'yellow' ? '🟡 Amarelo' : '🔵 Azul';
    document.getElementById('poss-val').textContent = possStr;

    document.getElementById('touch-val').textContent = `${hud.touches} / ${hud.maxTouches}`;

    // Mostrar ping no console (pode adicionar ao HUD depois)
    // console.log(`Ping: ${hud.ping}ms`);
  }

  // ========== SINCRONIZAR POSIÇÕES COM SERVIDOR ==========
  syncPositionsWithServer(onUpdatePos) {
    if (!this.multiplayer || !this.multiplayer.isActive) {
      return; // Modo local
    }

    // Callback chamado a cada state_update
    this.multiplayer.onStateUpdated = (state) => {
      // Sincronizar HUD
      this.syncHUDWithServer();

      // Callback para game.js atualizar posições
      if (onUpdatePos) {
        onUpdatePos(state, this.multiplayer);
      }
    };
  }

  // ========== ENVIAR INPUT DO JOGADOR ==========
  sendPlayerInput(playerIdx, directionX, directionZ, intensity) {
    if (!this.multiplayer || !this.multiplayer.isActive) {
      return; // Modo local
    }

    this.multiplayer.sendPlayerInput(playerIdx, directionX, directionZ, intensity);
  }

  // ========== VALIDAR DRAG ==========
  canDragPiece(team, playerIdx) {
    if (!this.multiplayer || !this.multiplayer.isActive) {
      return true; // Modo local, pode arrastar
    }

    return this.multiplayer.canDragPiece(team, playerIdx);
  }
}

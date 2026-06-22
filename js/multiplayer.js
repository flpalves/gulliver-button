// Multiplayer Manager — handles Socket.io connection and relay

export class MultiplayerManager {
  constructor() {
    this.socket = null;
    this.isActive = false;
    this.myTeam = null; // 'yellow' or 'blue'
    this.roomCode = null;
    this.isMyTurn = false;
    this.isRoomCreator = false; // true if I created the room
    this.gameInstance = null;
    this.inputInstance = null;
    this.serverGameState = null; // Game state from server

    // Callbacks for game sync
    this.onRemoteShotFired = null;
    this.onPhysicsSettled = null;
    this.onGameEvent = null;
    this.onOpponentDisconnected = null;
    this.onRemoteTeamChanged = null;
    this.onRemoteSettingsChanged = null;
    this.onGameStateUpdated = null;
  }

  connect(serverUrl = 'http://localhost:3000') {
    return new Promise((resolve, reject) => {
      try {
        this.socket = io(serverUrl, {
          reconnection: true,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
          reconnectionAttempts: 5
        });

        this.socket.on('connect', () => {
          console.log('[Multiplayer] Connected to server');

          // If we have an active room, try to rejoin
          if (this.roomCode && this.isActive) {
            console.log('[Multiplayer] Attempting to rejoin room after reconnection...');
            this.rejoinRoom();
          }

          resolve();
        });

        this.socket.on('connect_error', (error) => {
          console.error('[Multiplayer] Connection error:', error);
          reject(error);
        });

        this.socket.on('room_created', (data) => {
          console.log('[Multiplayer] Room created:', data.roomCode);
          this.roomCode = data.roomCode;
          this.myTeam = 'yellow';
          this.isRoomCreator = true;
          this.isMyTurn = true;
          this._dispatch('roomCreated', { roomCode: data.roomCode, myTeam: this.myTeam });
        });

        this.socket.on('room_ready', (data) => {
          console.log('[Multiplayer] Room ready:', data);
          // Blue player's socket already knows their team from join, but we set isMyTurn to false
          if (this.socket.id === data.blueSocketId) {
            this.isMyTurn = false;
          }
          this._dispatch('roomReady', data);
        });

        this.socket.on('join_error', (data) => {
          console.error('[Multiplayer] Join error:', data.message);
          this._dispatch('joinError', data);
        });

        this.socket.on('shot_fired', (payload) => {
          if (this.onRemoteShotFired) {
            this.onRemoteShotFired(payload);
          }
        });

        this.socket.on('reposition', (payload) => {
          // For future: handle remote reposition
        });

        this.socket.on('physics_settled', (payload) => {
          if (this.onPhysicsSettled) {
            this.onPhysicsSettled(payload);
          }
        });

        this.socket.on('game_event', (payload) => {
          if (this.onGameEvent) {
            this.onGameEvent(payload);
          }
        });

        this.socket.on('opponent_disconnected', (data) => {
          console.log('[Multiplayer] Opponent disconnected:', data);
          if (this.onOpponentDisconnected) {
            this.onOpponentDisconnected(data);
          }
          this._dispatch('opponentDisconnected', data);
        });

        this.socket.on('opponent_reconnected', (data) => {
          console.log('[Multiplayer] Opponent reconnected:', data);
          // Reset game state on reconnection
          this.serverGameState = data.gameState;
          this._dispatch('opponentReconnected', data);
        });

        this.socket.on('opponent_reconnect_timeout', (data) => {
          console.log('[Multiplayer] Opponent timeout - room closing');
          this._dispatch('opponentReconnectTimeout', data);
        });

        this.socket.on('team_changed', (payload) => {
          console.log('[Multiplayer] 🔔 RECEIVED team_changed:', payload);
          if (this.onRemoteTeamChanged) {
            console.log('[Multiplayer] Calling onRemoteTeamChanged callback');
            this.onRemoteTeamChanged(payload);
          }
          console.log('[Multiplayer] Dispatching multiplayer:teamChanged event');
          this._dispatch('teamChanged', payload);
        });

        this.socket.on('settings_changed', (payload) => {
          console.log('[Multiplayer] 🔔 RECEIVED settings_changed:', payload);
          if (this.onRemoteSettingsChanged) {
            console.log('[Multiplayer] Calling onRemoteSettingsChanged callback');
            this.onRemoteSettingsChanged(payload);
          }
          console.log('[Multiplayer] Dispatching multiplayer:settingsChanged event');
          this._dispatch('settingsChanged', payload);
        });

        this.socket.on('settings_error', (data) => {
          console.error('[Multiplayer] Settings error:', data.message);
          this._dispatch('settingsError', data);
        });

        this.socket.on('both_players_ready', (data) => {
          console.log('[Multiplayer] 🚀 Both players ready! Game starting...');
          this._dispatch('bothPlayersReady', data);
        });

        this.socket.on('game_state', (data) => {
          console.log('[Multiplayer] 📊 Game state updated:', data);
          this.serverGameState = data.gameState;
          this.isMyTurn = data.isMyTurn;
          if (this.onGameStateUpdated) {
            this.onGameStateUpdated(data);
          }
          this._dispatch('gameStateUpdated', data);
        });

        this.socket.on('disconnect', (reason) => {
          console.log('[Multiplayer] Disconnected from server:', reason);

          // If not intentional disconnection, try to reconnect
          if (reason !== 'io client namespace disconnect' && this.roomCode && this.isActive) {
            console.log('[Multiplayer] Unintentional disconnect - scheduling reconnection attempt');
            // Try to reconnect after 2 seconds
            setTimeout(() => {
              if (this.socket && !this.socket.connected) {
                console.log('[Multiplayer] Reconnecting to server...');
                this.socket.connect();
              }
            }, 2000);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  createRoom(gameConfig) {
    if (!this.socket) {
      console.error('[Multiplayer] Not connected');
      return;
    }
    this.isActive = true;
    this.socket.emit('create_room', gameConfig);
  }

  joinRoom(roomCode) {
    if (!this.socket) {
      console.error('[Multiplayer] Not connected');
      return;
    }
    this.isActive = true;
    this.roomCode = roomCode;
    this.myTeam = 'blue';
    this.socket.emit('join_room', roomCode);
  }

  emitShotFired(playerIdx, impulse, bodyStates) {
    if (!this.socket || !this.isActive) return;
    this.socket.emit('shot_fired', {
      playerIdx,
      team: this.myTeam,
      impulse,
      bodyStates,
      timestamp: Date.now()
    });
  }

  emitPhysicsSettled(bodyStates, lastTouchTeam, playerIdx) {
    if (!this.socket || !this.isActive) return;
    this.socket.emit('physics_settled', {
      bodyStates,
      lastTouchTeam,
      playerIdx,
      timestamp: Date.now()
    });
  }

  emitGameEvent(type, data) {
    if (!this.socket || !this.isActive) return;
    this.socket.emit('game_event', {
      type,
      data,
      team: this.myTeam,
      timestamp: Date.now()
    });
  }

  emitTeamChanged(team1, team2) {
    if (!this.socket || !this.isActive) {
      console.warn('[Multiplayer] Cannot emit team_changed: socket not ready', { active: this.isActive, socketExists: !!this.socket });
      return;
    }
    console.log('[Multiplayer] Emitting team_changed:', { team1, team2 });
    this.socket.emit('team_changed', {
      team1,
      team2,
      timestamp: Date.now()
    });
  }

  emitSettingsChanged(gameConfig) {
    if (!this.socket || !this.isActive) {
      console.warn('[Multiplayer] Cannot emit settings_changed: socket not ready', { active: this.isActive, socketExists: !!this.socket });
      return;
    }
    console.log('[Multiplayer] Emitting settings_changed:', gameConfig);
    this.socket.emit('settings_changed', {
      gameConfig,
      timestamp: Date.now()
    });
  }

  emitPlayerReady() {
    if (!this.socket || !this.isActive) {
      console.warn('[Multiplayer] Cannot emit player_ready: socket not ready', { active: this.isActive, socketExists: !!this.socket });
      return;
    }
    console.log('[Multiplayer] 🎮 Emitting player_ready');
    this.socket.emit('player_ready', {
      team: this.myTeam,
      timestamp: Date.now()
    });
  }

  // isMyTurn is now controlled by the server via game_state events

  rejoinRoom() {
    if (!this.socket || !this.roomCode) {
      console.warn('[Multiplayer] Cannot rejoin: socket not ready or no roomCode');
      return;
    }
    console.log('[Multiplayer] Attempting to rejoin room:', this.roomCode);
    this.socket.emit('rejoin_room', this.roomCode);
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.isActive = false;
    }
  }

  // Simple event dispatcher for UI updates
  _dispatch(eventName, data) {
    window.dispatchEvent(new CustomEvent(`multiplayer:${eventName}`, { detail: data }));
  }
}

// Global instance
export let multiplayer = new MultiplayerManager();

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const port = process.env.PORT || 3000;

// Serve static files
app.use(express.static(__dirname));

// Room management
const rooms = new Map();
const DISCONNECT_WAIT_TIME = 30000; // 30 seconds to wait for reconnection
const DISCONNECT_CHECK_INTERVAL = 5000; // Check every 5 seconds

// Helper: Create initial game state based on rule mode
function createGameState(ruleMode) {
  const maxTouches = ruleMode === '12-toques' ? 12 : 4;
  return {
    possession: 'yellow',
    touches: 0,
    maxTouches,
    lastTouchTeam: null,
    lastShooter: null,
    shooterTouchCount: 0,
    locked: false,
    ballDead: false,
    lastShooterTeam: null,
    bodyStates: null // Synchronized body positions from the active player
  };
}

// Helper: Get opponent team
function getOpponent(team) {
  return team === 'yellow' ? 'blue' : 'yellow';
}

// Generate random 4-letter room code
function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Track disconnected sockets to allow reconnection
function _markPlayerDisconnected(room, team) {
  if (team === 'yellow') {
    room.yellowDisconnectTime = Date.now();
    room.yellowSocketPending = room.yellowSocket; // Keep reference for reconnection
  } else {
    room.blueDisconnectTime = Date.now();
    room.blueSocketPending = room.blueSocket; // Keep reference for reconnection
  }
  console.log(`[DISCONNECT] ${team} marked as disconnected, waiting for reconnection...`);
}

// Check if disconnected player can reconnect
function _isPlayerDisconnected(room, team) {
  if (team === 'yellow') {
    if (!room.yellowDisconnectTime) return false;
    const elapsed = Date.now() - room.yellowDisconnectTime;
    return elapsed < DISCONNECT_WAIT_TIME;
  } else {
    if (!room.blueDisconnectTime) return false;
    const elapsed = Date.now() - room.blueDisconnectTime;
    return elapsed < DISCONNECT_WAIT_TIME;
  }
}

// Broadcast game state to both players with turn info and positions
function _broadcastGameState(io, roomCode, room) {
  const { yellowSocket, blueSocket, gameState } = room;

  // Determine who has the turn
  const yellowTurn = gameState.possession === 'yellow' && !gameState.locked;
  const blueTurn = gameState.possession === 'blue' && !gameState.locked;

  // Send to Yellow
  io.to(yellowSocket).emit('game_state', {
    gameState: {
      ...gameState,
      bodyStates: gameState.bodyStates
    },
    isMyTurn: yellowTurn
  });

  // Send to Blue
  io.to(blueSocket).emit('game_state', {
    gameState: {
      ...gameState,
      bodyStates: gameState.bodyStates
    },
    isMyTurn: blueTurn
  });

  console.log(`[GAME_STATE] 🎮 ${roomCode}: Possession=${gameState.possession} Touches=${gameState.touches}/${gameState.maxTouches} Locked=${gameState.locked}`);
}

io.on('connection', (socket) => {
  console.log(`\n[CONNECT] ✅ ${socket.id}`);
  console.log(`[CONNECT] Total sockets: ${io.engine.clientsCount}`);

  // ─── CREATE ROOM (Yellow player) ───
  socket.on('create_room', (gameConfig) => {
    let code = generateRoomCode();
    while (rooms.has(code)) {
      code = generateRoomCode();
    }

    rooms.set(code, {
      yellowSocket: socket.id,
      blueSocket: null,
      gameConfig,
      roomCreator: socket.id,
      yellowReady: false,
      blueReady: false,
      gameState: createGameState(gameConfig.rule)
    });

    socket.join(code);
    console.log(`[ROOM] ${code} created by ${socket.id} (yellow)`);
    socket.emit('room_created', { roomCode: code });
  });

  // ─── JOIN ROOM (Blue player) ───
  socket.on('join_room', (roomCode) => {
    const room = rooms.get(roomCode);

    if (!room) {
      console.log(`[ERROR] ${socket.id} tried to join non-existent room ${roomCode}`);
      socket.emit('join_error', { message: 'Room does not exist' });
      return;
    }

    if (room.blueSocket !== null) {
      console.log(`[ERROR] ${socket.id} tried to join full room ${roomCode}`);
      socket.emit('join_error', { message: 'Room is full' });
      return;
    }

    room.blueSocket = socket.id;
    // Reset ready flags when a new player joins
    room.yellowReady = false;
    room.blueReady = false;
    socket.join(roomCode);

    console.log(`[ROOM] ${roomCode} joined by ${socket.id} (blue) ✅`);
    console.log(`[ROOM] ${roomCode} is now READY! Yellow: ${room.yellowSocket} | Blue: ${room.blueSocket}`);

    // Notify both players that the room is ready
    io.to(roomCode).emit('room_ready', {
      yellowSocketId: room.yellowSocket,
      blueSocketId: room.blueSocket,
      gameConfig: room.gameConfig
    });
    console.log(`[ROOM] ${roomCode} room_ready event sent to both players`);
  });

  // ─── REJOIN ROOM (after disconnection) ───
  socket.on('rejoin_room', (roomCode) => {
    const room = rooms.get(roomCode);

    if (!room) {
      console.log(`[REJOIN] ❌ ${socket.id} tried to rejoin non-existent room ${roomCode}`);
      socket.emit('rejoin_error', { message: 'Room no longer exists' });
      return;
    }

    // Determine which team this socket belongs to based on pending reference
    let playerTeam = null;
    if (room.yellowSocketPending === room.yellowSocket && _isPlayerDisconnected(room, 'yellow')) {
      playerTeam = 'yellow';
    } else if (room.blueSocketPending === room.blueSocket && _isPlayerDisconnected(room, 'blue')) {
      playerTeam = 'blue';
    }

    if (!playerTeam) {
      console.log(`[REJOIN] ❌ ${socket.id} cannot rejoin ${roomCode} (not in reconnection window)`);
      socket.emit('rejoin_error', { message: 'Reconnection window expired' });
      return;
    }

    // Update socket reference
    if (playerTeam === 'yellow') {
      room.yellowSocket = socket.id;
      room.yellowDisconnectTime = null;
      if (room.yellowDisconnectTimer) {
        clearTimeout(room.yellowDisconnectTimer);
      }
      console.log(`[REJOIN] ✅ 🟡 Yellow reconnected to ${roomCode}`);
    } else {
      room.blueSocket = socket.id;
      room.blueDisconnectTime = null;
      if (room.blueDisconnectTimer) {
        clearTimeout(room.blueDisconnectTimer);
      }
      console.log(`[REJOIN] ✅ 🔵 Blue reconnected to ${roomCode}`);
    }

    // Join the room
    socket.join(roomCode);

    // Notify both players of successful reconnection
    io.to(roomCode).emit('opponent_reconnected', {
      team: playerTeam,
      gameState: room.gameState
    });
    console.log(`[REJOIN] ${roomCode} - ${playerTeam} reconnection notified to opponent`);

    // Send current game state to the reconnected player
    socket.emit('game_state', {
      gameState: room.gameState,
      isMyTurn: room.gameState.possession === playerTeam && !room.gameState.locked
    });
  });

  // ─── SHOT FIRED (server-controlled) ───
  socket.on('shot_fired', (payload) => {
    const roomCode = Array.from(socket.rooms).find(r => rooms.has(r));
    if (!roomCode) return;

    const room = rooms.get(roomCode);
    if (!room) return;

    const { gameState } = room;
    const shooterTeam = socket.id === room.yellowSocket ? 'yellow' : 'blue';

    // Validate: is it this team's turn and game not locked?
    if (gameState.possession !== shooterTeam || gameState.locked) {
      console.log(`[SHOT] ❌ ${roomCode} - Invalid shot from ${shooterTeam}: possession=${gameState.possession}, locked=${gameState.locked}`);
      return;
    }

    // Lock the game while shot is resolving
    gameState.locked = true;
    gameState.lastShooterTeam = shooterTeam;

    // Store body positions from the active player
    if (payload.bodyStates) {
      gameState.bodyStates = payload.bodyStates;
    }

    // Relay shot to opponent with positions
    socket.to(roomCode).emit('shot_fired', payload);
    console.log(`[SHOT] ${roomCode} - ${shooterTeam} fired shot`);

    // Broadcast game state (locked, awaiting physics_settled)
    _broadcastGameState(io, roomCode, room);
  });

  // ─── REPOSITION (relay) ───
  socket.on('reposition', (payload) => {
    const roomCode = Array.from(socket.rooms).find(r => rooms.has(r));
    if (roomCode) {
      socket.to(roomCode).emit('reposition', payload);
    }
  });

  // ─── PHYSICS SETTLED (server-controlled) ───
  socket.on('physics_settled', (payload) => {
    const roomCode = Array.from(socket.rooms).find(r => rooms.has(r));
    if (!roomCode) return;

    const room = rooms.get(roomCode);
    if (!room) return;

    const { gameState } = room;

    // Process shot result - apply game rules
    // payload.lastTouchTeam indicates which team last touched the ball
    if (payload.lastTouchTeam === gameState.possession) {
      // Valid touch - ball touched by team with possession
      gameState.touches++;

      if (gameState.maxTouches === 12) {
        // 12-touch mode: track consecutive touches
        if (gameState.lastShooter === payload.playerIdx) {
          gameState.shooterTouchCount++;
        } else {
          gameState.lastShooter = payload.playerIdx;
          gameState.shooterTouchCount = 1;
        }

        // Check if exceeded max consecutive touches
        if (gameState.shooterTouchCount > 3) {
          gameState.possession = getOpponent(gameState.possession);
          gameState.touches = 0;
          gameState.lastShooter = null;
          gameState.shooterTouchCount = 0;
        } else if (gameState.touches >= gameState.maxTouches) {
          gameState.possession = getOpponent(gameState.possession);
          gameState.touches = 0;
          gameState.lastShooter = null;
          gameState.shooterTouchCount = 0;
        }
      } else {
        // 4-touch mode
        if (gameState.touches >= gameState.maxTouches) {
          gameState.possession = getOpponent(gameState.possession);
          gameState.touches = 0;
          gameState.lastShooter = null;
          gameState.shooterTouchCount = 0;
        }
      }
    } else {
      // Invalid touch (missed or deflected) - switch possession
      gameState.possession = getOpponent(gameState.possession);
      gameState.touches = 0;
      gameState.lastShooter = null;
      gameState.shooterTouchCount = 0;
    }

    // Store final body positions
    if (payload.bodyStates) {
      gameState.bodyStates = payload.bodyStates;
    }

    // Unlock game - next player can shoot
    gameState.locked = false;
    gameState.lastTouchTeam = payload.lastTouchTeam;

    // Relay physics settled to opponent
    socket.to(roomCode).emit('physics_settled', payload);
    console.log(`[PHYSICS] ${roomCode} - Shot resolved. New possession: ${gameState.possession}`);

    // Broadcast updated game state with final positions
    _broadcastGameState(io, roomCode, room);
  });

  // ─── GAME EVENT (relay) ───
  socket.on('game_event', (payload) => {
    const roomCode = Array.from(socket.rooms).find(r => rooms.has(r));
    if (roomCode) {
      socket.to(roomCode).emit('game_event', payload);
      console.log(`[EVENT] ${roomCode} - ${payload.type}`);
    }
  });

  // ─── TEAM CHANGED (relay) ───
  socket.on('team_changed', (payload) => {
    const roomCode = Array.from(socket.rooms).find(r => rooms.has(r));
    console.log(`\n[TEAM_CHANGED] 📤 ${socket.id} emitted:`);
    console.log(`  Team1: ${payload.team1} | Team2: ${payload.team2}`);

    if (roomCode) {
      const room = rooms.get(roomCode);
      const sender = socket.id === room.yellowSocket ? '🟡 Yellow' : '🔵 Blue';
      const receiver = socket.id === room.yellowSocket ? '🔵 Blue' : '🟡 Yellow';
      console.log(`  Room: ${roomCode}`);
      console.log(`  Sender: ${sender} (${socket.id})`);
      console.log(`  Relaying to: ${receiver}`);

      socket.to(roomCode).emit('team_changed', payload);
      console.log(`[TEAM_CHANGED] ✅ Event relayed`);
    } else {
      console.log(`[TEAM_CHANGED] ❌ Socket ${socket.id} not in any room!`);
    }
  });

  // ─── SETTINGS CHANGED (relay + validation) ───
  socket.on('settings_changed', (payload) => {
    const roomCode = Array.from(socket.rooms).find(r => rooms.has(r));
    console.log(`\n[SETTINGS_CHANGED] 📤 ${socket.id} emitted:`);
    console.log(`  Mode: ${payload.gameConfig.mode} | Ball: ${payload.gameConfig.ball}`);
    console.log(`  Rule: ${payload.gameConfig.rule} | Time: ${payload.gameConfig.time}`);

    if (!roomCode) {
      console.log(`[SETTINGS_CHANGED] ❌ Socket ${socket.id} not in any room!`);
      return;
    }

    const room = rooms.get(roomCode);
    const sender = socket.id === room.roomCreator ? '✅ Creator' : '❌ Not Creator';
    console.log(`  Room: ${roomCode}`);
    console.log(`  Sender: ${sender} (${socket.id})`);

    // Only room creator can change settings
    if (socket.id === room.roomCreator) {
      room.gameConfig = payload.gameConfig;
      const receiver = socket.id === room.yellowSocket ? '🔵 Blue' : '🟡 Yellow';
      console.log(`  Relaying to: ${receiver}`);
      socket.to(roomCode).emit('settings_changed', payload);
      console.log(`[SETTINGS_CHANGED] ✅ Event relayed`);
      // Reset ready status when settings change
      room.yellowReady = false;
      room.blueReady = false;
    } else {
      console.log(`[SETTINGS_CHANGED] ❌ Not room creator (creator: ${room.roomCreator})`);
      socket.emit('settings_error', { message: 'Only room creator can change settings' });
      console.log(`[SETTINGS_CHANGED] ❌ Sent settings_error to client`);
    }
  });

  // ─── PLAYER READY ───
  socket.on('player_ready', (payload) => {
    console.log(`\n[PLAYER_READY] 📤 ${socket.id} emitted player_ready`);
    const roomCode = Array.from(socket.rooms).find(r => rooms.has(r));

    if (!roomCode) {
      console.log(`[PLAYER_READY] ❌ Socket ${socket.id} not in any room!`);
      return;
    }

    const room = rooms.get(roomCode);
    if (!room) {
      console.log(`[PLAYER_READY] ❌ Room ${roomCode} not found!`);
      return;
    }

    const player = socket.id === room.yellowSocket ? '🟡 Yellow' : '🔵 Blue';
    console.log(`[PLAYER_READY] 🎮 ${player} is ready`);
    console.log(`[PLAYER_READY] Room: ${roomCode}`);
    console.log(`[PLAYER_READY] Yellow socket: ${room.yellowSocket}`);
    console.log(`[PLAYER_READY] Blue socket: ${room.blueSocket}`);

    // Mark this player as ready
    if (socket.id === room.yellowSocket) {
      room.yellowReady = true;
      console.log(`[PLAYER_READY] Set yellowReady = true`);
    } else if (socket.id === room.blueSocket) {
      room.blueReady = true;
      console.log(`[PLAYER_READY] Set blueReady = true`);
    } else {
      console.log(`[PLAYER_READY] ⚠️ Socket ${socket.id} is neither yellow nor blue!`);
      return;
    }

    console.log(`[PLAYER_READY] Status: Yellow=${room.yellowReady ? '✅' : '⏳'} | Blue=${room.blueReady ? '✅' : '⏳'}`);

    // If both players are ready, emit start_game
    if (room.yellowReady && room.blueReady) {
      console.log(`[PLAYER_READY] 🚀 BOTH READY! Emitting both_players_ready to room ${roomCode}`);
      // Reset game state when game starts
      room.gameState = createGameState(room.gameConfig.rule);
      io.to(roomCode).emit('both_players_ready', {
        gameConfig: room.gameConfig,
        gameState: room.gameState
      });
      // Broadcast initial game state
      _broadcastGameState(io, roomCode, room);
      console.log(`[PLAYER_READY] ✅ both_players_ready event sent`);
    } else {
      console.log(`[PLAYER_READY] ⏳ Waiting for second player...`);
    }
  });

  // ─── DISCONNECT (with reconnection support) ───
  socket.on('disconnect', () => {
    const roomCode = Array.from(socket.rooms).find(r => rooms.has(r));
    if (roomCode) {
      const room = rooms.get(roomCode);
      const isYellow = socket.id === room.yellowSocket;
      const isBlue = socket.id === room.blueSocket;
      const playerTeam = isYellow ? 'yellow' : isBlue ? 'blue' : null;
      const playerEmoji = isYellow ? '🟡 Yellow' : '🔵 Blue';

      if (playerTeam) {
        console.log(`\n[DISCONNECT] ❌ ${playerEmoji} (${socket.id}) from ${roomCode}`);

        // Mark player as disconnected (allow reconnection window)
        _markPlayerDisconnected(room, playerTeam);

        // Notify opponent of disconnection
        socket.to(roomCode).emit('opponent_disconnected', {
          team: playerTeam,
          canReconnect: true,
          waitSeconds: DISCONNECT_WAIT_TIME / 1000
        });
        console.log(`[DISCONNECT] Notified opponent - waiting ${DISCONNECT_WAIT_TIME / 1000}s for reconnection`);

        // Schedule room cleanup if no reconnection within timeout
        const cleanupTimer = setTimeout(() => {
          if (_isPlayerDisconnected(room, playerTeam)) {
            console.log(`[DISCONNECT] ⏱️ Timeout: ${playerEmoji} did not reconnect. Cleaning up room ${roomCode}`);

            // Notify the other player that room will close
            if (isYellow && room.blueSocket) {
              io.to(room.blueSocket).emit('opponent_reconnect_timeout', { team: 'yellow' });
            } else if (isBlue && room.yellowSocket) {
              io.to(room.yellowSocket).emit('opponent_reconnect_timeout', { team: 'blue' });
            }

            // Delete the room
            rooms.delete(roomCode);
            console.log(`[DISCONNECT] Room ${roomCode} deleted after timeout`);
          }
        }, DISCONNECT_WAIT_TIME);

        // Store timer reference for cleanup
        if (isYellow) {
          room.yellowDisconnectTimer = cleanupTimer;
        } else if (isBlue) {
          room.blueDisconnectTimer = cleanupTimer;
        }
      } else {
        console.log(`\n[DISCONNECT] ❌ ${socket.id} disconnected (not assigned to any team)`);
      }
    } else {
      console.log(`\n[DISCONNECT] ❌ ${socket.id} (not in any room)`);
    }
  });
});

httpServer.listen(port, () => {
  console.log(`🎮 Gulliver server listening on http://localhost:${port}`);
});

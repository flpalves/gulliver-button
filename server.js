import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import * as CANNON from 'cannon-es';
import { GameRoom } from './GameRoom.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.static(__dirname));
app.use(express.json());

// ============================================
// HEALTH CHECK
// ============================================
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    rooms: rooms.size,
    timestamp: Date.now()
  });
});

// ============================================
// GERENCIADOR DE SALAS
// ============================================
const rooms = new Map(); // { roomCode: { yellowSocketId, blueSocketId, config, gameRoom } }

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function findRoomBySocket(socketId) {
  for (const [code, room] of rooms) {
    if (room.yellowSocketId === socketId || room.blueSocketId === socketId) {
      return { code, ...room };
    }
  }
  return null;
}

// ============================================
// SOCKET.IO EVENTS
// ============================================
io.on('connection', (socket) => {
  console.log(`[Connected] ${socket.id}`);
  console.log(`[Connected] Registering shot_fired listener...`);

  // Debug: Log all socket events
  socket.onAny((event, ...args) => {
    console.log(`[Socket] 📨 EVENT: ${event}`, args.length > 0 ? args[0] : '');
  });

  // ==========================================
  // EVENTO: Criar Sala
  // ==========================================
  socket.on('create_room', (data) => {
    const roomCode = generateRoomCode();

    rooms.set(roomCode, {
      yellowSocketId: socket.id,
      blueSocketId: null,
      config: data.gameConfig || {},
      gameRoom: null,
      createdAt: Date.now()
    });

    socket.emit('room_created', { roomCode, config: data.gameConfig });

    // Enviar room_ready imediatamente para o criador (para mostrar tela de espera)
    socket.emit('room_ready', {
      myTeam: 'yellow',
      roomCode,
      config: data.gameConfig
    });

    console.log(`[Room Created] ${roomCode} by ${socket.id.substring(0, 8)}`);
  });

  // ==========================================
  // EVENTO: Entrar em Sala
  // ==========================================
  socket.on('join_room', (roomCode) => {
    const room = rooms.get(roomCode);

    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      console.warn(`[Join Failed] Room ${roomCode} not found`);
      return;
    }

    if (room.blueSocketId !== null) {
      socket.emit('error', { message: 'Room is full' });
      console.warn(`[Join Failed] Room ${roomCode} is full`);
      return;
    }

    room.blueSocketId = socket.id;

    // Criar GameRoom (será implementado no Passo 4)
    const gameRoom = new GameRoom(roomCode, room.config);
    gameRoom.yellowSocketId = room.yellowSocketId;
    gameRoom.blueSocketId = room.blueSocketId;
    room.gameRoom = gameRoom;

    // Notifica ambos que sala está pronta
    const yellowSocket = io.sockets.sockets.get(room.yellowSocketId);
    const blueSocket = io.sockets.sockets.get(room.blueSocketId);

    yellowSocket?.emit('room_ready', {
      myTeam: 'yellow',
      roomCode,
      config: room.config
    });

    blueSocket?.emit('room_ready', {
      myTeam: 'blue',
      roomCode,
      config: room.config
    });

    // NÃO inicia GameRoom aqui - esperar ambos os jogadores ficarem prontos!
    // gameRoom.start(io);

    console.log(`[Room Joined] ${roomCode} by ${socket.id.substring(0, 8)} (sala cheia - AGUARDANDO PLAYER_READY)`);
  });

  // ==========================================
  // EVENTO: Player Input
  // ==========================================
  socket.on('player_input', (inputData) => {
    const room = findRoomBySocket(socket.id);
    if (!room || !room.gameRoom) {
      return;
    }

    const team = socket.id === room.gameRoom.yellowSocketId ? 'yellow' : 'blue';
    room.gameRoom.receiveInput(team, inputData);
  });

  // ==========================================
  // EVENTO: Shot Fired (processar no GameRoom e retransmitir)
  // ==========================================
  socket.on('shot_fired', (payload) => {
    console.log(`[Shot Fired] ✅ SERVER RECEIVED shot_fired event!`);
    console.log(`[Shot Fired] Socket ID: ${socket.id.substring(0, 8)}`);
    console.log(`[Shot Fired] Payload:`, JSON.stringify(payload, null, 2));

    const room = findRoomBySocket(socket.id);
    if (!room || !room.gameRoom) {
      console.warn('[Shot Fired] ❌ Room or gameRoom not found!');
      return;
    }

    console.log(`[Shot Fired] RECEIVED in ${room.code}: playerIdx=${payload.playerIdx}`);
    console.log(`[Shot Fired] Payload:`, { playerIdx: payload.playerIdx, impulse: payload.impulse });

    // Converter índice global para índice dentro do time
    // playerIdx 0-10 = yellow, 11-21 = blue
    let team, localIdx;
    if (payload.playerIdx < 11) {
      team = 'yellow';
      localIdx = payload.playerIdx;
    } else {
      team = 'blue';
      localIdx = payload.playerIdx - 11;
    }

    console.log(`[Shot Fired] Mapped to ${team}[${localIdx}]`);

    const playersArray = room.gameRoom.gameState.players[team];
    console.log(`[Shot Fired] Team "${team}" has ${playersArray ? playersArray.length : 'UNDEFINED'} players`);

    const player = playersArray ? playersArray[localIdx] : null;
    console.log(`[Shot Fired] Player found:`, !!player, 'Has physBody:', player?.physBody ? '✓' : '✗');

    if (!player) {
      console.warn(`[Shot Fired] ❌ Player not found at ${team}[${localIdx}]`);
      return;
    }

    if (!payload.impulse) {
      console.warn(`[Shot Fired] ❌ No impulse in payload`);
      return;
    }

    console.log(`[Shot Fired] ✅ Applying impulse:`, payload.impulse);
    player.physBody.velocity.set(0, 0, 0);
    player.physBody.applyImpulse(
      new CANNON.Vec3(payload.impulse.x, payload.impulse.y, payload.impulse.z),
      player.physBody.position
    );
    console.log(`[Shot Fired] ✅ Impulse applied!`);

    // Retransmitir para o outro player também
    const yellowSocket = io.sockets.sockets.get(room.yellowSocketId);
    const blueSocket = io.sockets.sockets.get(room.blueSocketId);
    const otherSocket = socket.id === room.yellowSocketId ? blueSocket : yellowSocket;

    if (otherSocket) {
      otherSocket.emit('shot_fired', payload);
    }
  });

  // ==========================================
  // EVENTO: Mudança de Time
  // ==========================================
  socket.on('team_changed', (data) => {
    const room = findRoomBySocket(socket.id);
    if (!room) return;

    const yellowSocket = io.sockets.sockets.get(room.yellowSocketId);
    const blueSocket = io.sockets.sockets.get(room.blueSocketId);

    // Enviar para ambos os clientes
    if (yellowSocket) yellowSocket.emit('team_changed', data);
    if (blueSocket) blueSocket.emit('team_changed', data);

    console.log(`[Team Changed] ${room.code}: ${data.team1} vs ${data.team2}`);
  });

  // ==========================================
  // EVENTO: Player Ready
  // ==========================================
  socket.on('player_ready', (data) => {
    const room = findRoomBySocket(socket.id);
    if (!room) return;

    console.log(`[Player Ready] ${socket.id.substring(0, 8)} in ${room.code}`);

    const yellowSocket = io.sockets.sockets.get(room.yellowSocketId);
    const blueSocket = io.sockets.sockets.get(room.blueSocketId);

    // Se ambos estão prontos, iniciar o jogo
    if (yellowSocket && blueSocket) {
      // Iniciar o GameRoom AQUI (física começa apenas quando ambos estão prontos!)
      if (room.gameRoom && !room.gameRoom.isRunning) {
        console.log(`[Game Start] Iniciando GameRoom e física...`);
        room.gameRoom.start(io);
      }

      yellowSocket.emit('both_players_ready', {});
      blueSocket.emit('both_players_ready', {});
      console.log(`[Game Start] Both players ready in ${room.code}`);
    }
  });

  // ==========================================
  // EVENTO: Desconexão
  // ==========================================
  socket.on('disconnect', () => {
    const room = findRoomBySocket(socket.id);

    if (room) {
      const otherTeam = socket.id === room.yellowSocketId ? room.blueSocketId : room.yellowSocketId;

      if (otherTeam) {
        const otherSocket = io.sockets.sockets.get(otherTeam);
        if (otherSocket) {
          otherSocket.emit('opponent_disconnected', {
            message: 'Seu oponente desconectou'
          });
        }
      }

      rooms.delete(room.code);
      console.log(`[Room Deleted] ${room.code}`);
    }

    console.log(`[Disconnected] ${socket.id.substring(0, 8)}`);
  });
});

// ============================================
// PASSO 11-12: TICK LOOP GLOBAL (60 FPS)
// ============================================
const TICK_RATE = 60;
const TICK_INTERVAL = 1000 / TICK_RATE; // ~16ms

console.log(`[TickLoop] Global loop iniciando: ${TICK_RATE} FPS`);

setInterval(() => {
  for (const [roomCode, room] of rooms) {
    if (room.gameRoom && room.gameRoom.isRunning) {
      // PASSO 12: Broadcast estado para ambos clientes
      room.gameRoom.broadcast(io);
    }
  }
}, TICK_INTERVAL);

// ============================================
// INICIAR SERVIDOR
// ============================================
httpServer.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║   🚀 GULLIVER MULTIPLAYER SERVER 🚀    ║
╚════════════════════════════════════════╝

  Rodando em: http://localhost:${PORT}
  Health: http://localhost:${PORT}/health

  Aguardando conexões Socket.io...
  `);
});

export { io, rooms };

import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
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

const PORT = process.env.PORT || 3002;

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
const rooms = new Map(); // { roomCode: { yellowSocketId, blueSocketId, config, gameRoom, disconnectTimers } }
const RECONNECT_GRACE_MS = 30000; // tempo que a sala espera por uma reconexão (ex.: F5 sem querer)

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
      createdAt: Date.now(),
      disconnectTimers: { yellow: null, blue: null },
      ready: { yellow: false, blue: false }
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
  // EVENTO: Reconectar a uma sala (ex.: F5 sem querer durante a partida)
  // ==========================================
  socket.on('rejoin_room', ({ roomCode, team } = {}) => {
    const room = rooms.get(roomCode);

    if (!room || (team !== 'yellow' && team !== 'blue')) {
      socket.emit('rejoin_failed', { message: 'Sala não encontrada' });
      console.warn(`[Rejoin Failed] Sala ${roomCode} não encontrada`);
      return;
    }

    const currentSocketId = team === 'yellow' ? room.yellowSocketId : room.blueSocketId;
    if (currentSocketId !== null) {
      socket.emit('rejoin_failed', { message: 'Este time já está conectado' });
      console.warn(`[Rejoin Failed] Time ${team} da sala ${roomCode} já está conectado`);
      return;
    }

    // Cancela o timer de expiração da sala e reocupa o slot com o novo socket
    if (room.disconnectTimers[team]) {
      clearTimeout(room.disconnectTimers[team]);
      room.disconnectTimers[team] = null;
    }

    if (team === 'yellow') room.yellowSocketId = socket.id;
    else room.blueSocketId = socket.id;

    if (room.gameRoom) {
      if (team === 'yellow') room.gameRoom.yellowSocketId = socket.id;
      else room.gameRoom.blueSocketId = socket.id;
    }

    socket.emit('rejoin_success', { myTeam: team, roomCode, config: room.config });

    const otherSocketId = team === 'yellow' ? room.blueSocketId : room.yellowSocketId;
    const otherSocket = otherSocketId ? io.sockets.sockets.get(otherSocketId) : null;
    otherSocket?.emit('opponent_reconnected', { team });

    console.log(`[Rejoined] ${team} reconectou à sala ${roomCode}`);
  });

  // ==========================================
  // EVENTO: Physics State (relay puro)
  // O cliente dono da vez simula a física e envia snapshots (~20 Hz).
  // O servidor apenas repassa ao outro cliente, sem simular nada.
  // ==========================================
  socket.on('physics_state', (snapshot) => {
    const room = findRoomBySocket(socket.id);
    if (!room || !room.gameRoom) return;

    // Atualiza (informativo) qual time detém a autoridade
    if (snapshot?.game?.possession) {
      room.gameRoom.authorityTeam = snapshot.game.possession;
    }

    const otherSocketId = room.gameRoom.opponentSocketId(socket.id);
    const otherSocket = otherSocketId ? io.sockets.sockets.get(otherSocketId) : null;
    if (otherSocket) {
      otherSocket.emit('physics_state', snapshot);
    }
  });

  // ==========================================
  // EVENTO: Shot Fired (relay puro — usado como cue de som/UI no espectador)
  // ==========================================
  socket.on('shot_fired', (payload) => {
    const room = findRoomBySocket(socket.id);
    if (!room || !room.gameRoom) return;

    const otherSocketId = room.gameRoom.opponentSocketId(socket.id);
    const otherSocket = otherSocketId ? io.sockets.sockets.get(otherSocketId) : null;
    if (otherSocket) {
      otherSocket.emit('shot_fired', payload);
    }
  });

  // ==========================================
  // EVENTO: Keeper Reposition (relay puro)
  // O espectador move o próprio goleiro a qualquer momento; o servidor só
  // repassa para o dono da vez aplicar na simulação real dele.
  // ==========================================
  socket.on('keeper_reposition', (payload) => {
    const room = findRoomBySocket(socket.id);
    if (!room || !room.gameRoom) return;

    const otherSocketId = room.gameRoom.opponentSocketId(socket.id);
    const otherSocket = otherSocketId ? io.sockets.sockets.get(otherSocketId) : null;
    if (otherSocket) {
      otherSocket.emit('keeper_reposition', payload);
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

    const roomEntry = rooms.get(room.code);
    if (!roomEntry) return;

    const team = socket.id === roomEntry.yellowSocketId ? 'yellow'
      : socket.id === roomEntry.blueSocketId ? 'blue' : null;
    if (!team) return;

    roomEntry.ready[team] = true;
    console.log(`[Player Ready] ${team} (${socket.id.substring(0, 8)}) in ${room.code}`);

    const yellowSocket = io.sockets.sockets.get(roomEntry.yellowSocketId);
    const blueSocket = io.sockets.sockets.get(roomEntry.blueSocketId);

    // Avisa o oponente que este jogador já está pronto (para UI de espera)
    const opponentSocket = team === 'yellow' ? blueSocket : yellowSocket;
    opponentSocket?.emit('opponent_ready', { team });

    // Só inicia quando AMBOS os times clicaram em "pronto"
    if (roomEntry.ready.yellow && roomEntry.ready.blue && yellowSocket && blueSocket) {
      if (room.gameRoom && !room.gameRoom.isRunning) {
        console.log(`[Game Start] Iniciando GameRoom (relay)...`);
        room.gameRoom.start();
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
      const team = socket.id === room.yellowSocketId ? 'yellow' : 'blue';
      const roomEntry = rooms.get(room.code);

      if (roomEntry) {
        if (team === 'yellow') roomEntry.yellowSocketId = null;
        else roomEntry.blueSocketId = null;

        // Se o jogo ainda não começou, desconectar cancela o "pronto" desse time
        if (!roomEntry.gameRoom || !roomEntry.gameRoom.isRunning) {
          roomEntry.ready[team] = false;
        }
        if (roomEntry.gameRoom) {
          if (team === 'yellow') roomEntry.gameRoom.yellowSocketId = null;
          else roomEntry.gameRoom.blueSocketId = null;
        }

        const otherSocketId = team === 'yellow' ? roomEntry.blueSocketId : roomEntry.yellowSocketId;
        const otherSocket = otherSocketId ? io.sockets.sockets.get(otherSocketId) : null;

        if (!otherSocket) {
          // Ninguém mais na sala — encerra imediatamente
          rooms.delete(room.code);
          console.log(`[Room Deleted] ${room.code} (ambos jogadores fora)`);
        } else {
          // Dá um período de graça para o jogador reconectar (ex.: F5 sem querer)
          const waitSeconds = RECONNECT_GRACE_MS / 1000;
          otherSocket.emit('opponent_disconnected', { team, waitSeconds });

          roomEntry.disconnectTimers[team] = setTimeout(() => {
            otherSocket.emit('opponent_left', { team });
            rooms.delete(room.code);
            console.log(`[Room Deleted] ${room.code} (reconexão de ${team} expirou)`);
          }, RECONNECT_GRACE_MS);

          console.log(`[Disconnected] ${team} em ${room.code} — aguardando reconexão (${waitSeconds}s)`);
        }
      }
    }

    console.log(`[Disconnected] ${socket.id.substring(0, 8)}`);
  });
});

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

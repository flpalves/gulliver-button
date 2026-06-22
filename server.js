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

// Room management: { code: { yellowSocket, blueSocket, gameConfig, roomCreator } }
const rooms = new Map();

// Generate random 4-letter room code
function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

io.on('connection', (socket) => {
  console.log(`[CONNECT] ${socket.id}`);

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
      roomCreator: socket.id
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
    socket.join(roomCode);

    console.log(`[ROOM] ${roomCode} joined by ${socket.id} (blue)`);

    // Notify both players that the room is ready
    io.to(roomCode).emit('room_ready', {
      yellowSocketId: room.yellowSocket,
      blueSocketId: room.blueSocket,
      gameConfig: room.gameConfig
    });
  });

  // ─── SHOT FIRED (relay) ───
  socket.on('shot_fired', (payload) => {
    const roomCode = Array.from(socket.rooms).find(r => rooms.has(r));
    if (roomCode) {
      socket.to(roomCode).emit('shot_fired', payload);
      console.log(`[SHOT] ${roomCode} - ${socket.id} fired shot`);
    }
  });

  // ─── REPOSITION (relay) ───
  socket.on('reposition', (payload) => {
    const roomCode = Array.from(socket.rooms).find(r => rooms.has(r));
    if (roomCode) {
      socket.to(roomCode).emit('reposition', payload);
    }
  });

  // ─── PHYSICS SETTLED (relay) ───
  socket.on('physics_settled', (payload) => {
    const roomCode = Array.from(socket.rooms).find(r => rooms.has(r));
    if (roomCode) {
      socket.to(roomCode).emit('physics_settled', payload);
      console.log(`[PHYSICS] ${roomCode} - ${socket.id} settled`);
    }
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
    if (roomCode) {
      socket.to(roomCode).emit('team_changed', payload);
      console.log(`[TEAM] ${roomCode} - team changed`);
    }
  });

  // ─── SETTINGS CHANGED (relay + validation) ───
  socket.on('settings_changed', (payload) => {
    const roomCode = Array.from(socket.rooms).find(r => rooms.has(r));
    if (!roomCode) return;

    const room = rooms.get(roomCode);
    // Only room creator can change settings
    if (socket.id === room.roomCreator) {
      room.gameConfig = payload.gameConfig;
      socket.to(roomCode).emit('settings_changed', payload);
      console.log(`[SETTINGS] ${roomCode} - updated`);
    } else {
      socket.emit('settings_error', { message: 'Only room creator can change settings' });
    }
  });

  // ─── DISCONNECT ───
  socket.on('disconnect', () => {
    const roomCode = Array.from(socket.rooms).find(r => rooms.has(r));
    if (roomCode) {
      const room = rooms.get(roomCode);
      socket.to(roomCode).emit('opponent_disconnected');
      console.log(`[DISCONNECT] ${socket.id} from ${roomCode}`);

      // Clean up the room
      rooms.delete(roomCode);
    }
    console.log(`[DISCONNECT] ${socket.id}`);
  });
});

httpServer.listen(port, () => {
  console.log(`🎮 Gulliver server listening on http://localhost:${port}`);
});

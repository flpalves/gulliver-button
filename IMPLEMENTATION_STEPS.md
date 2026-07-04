# Plano de Implementação: Multiplayer com Servidor Autoritário
**Guia Passo-a-Passo** | 27 Passos | Estimado: 2-3 dias

---

## 🎯 Visão Geral do Plano

```
FASE 1: Setup Backend (Passos 1-5)
├─ 1. package.json + dependências
├─ 2. server.js básico (Express + Socket.io)
├─ 3. Gerenciador de salas (criar/entrar)
├─ 4. GameRoom class (estado + tick loop)
└─ 5. Conexão Socket.io (eventos básicos)

FASE 2: Lógica de Jogo no Servidor (Passos 6-12)
├─ 6. Setup Cannon.js no servidor
├─ 7. Criar bodies (11 amarelos + 11 azuis + bola)
├─ 8. Implementar applyForce (aplicar impulso)
├─ 9. Implementar syncPhysicsToState (Cannon → state)
├─ 10. Implementar validateInput (segurança)
├─ 11. Implementar tick loop (60 FPS)
└─ 12. Serializar e broadcast state

FASE 3: Eventos de Jogo (Passos 13-18)
├─ 13. Detectar gol
├─ 14. Detectar lateral (throw-in)
├─ 15. Detectar escanteio (corner)
├─ 16. Detectar tiro de meta (goal-kick)
├─ 17. Sistema de posse e toques
└─ 18. Tratamento de faltas

FASE 4: Cliente Multiplayer (Passos 19-23)
├─ 19. Criar multiplayer.js (Socket.io client)
├─ 20. Receber e aplicar state_update
├─ 21. Interpolação visual (smooth movimento)
├─ 22. Enviar player_input (intenção do jogador)
└─ 23. Sincronização de HUD

FASE 5: UI e Lobby (Passos 24-26)
├─ 24. UI: Menu entrada (Local vs Online)
├─ 25. UI: Lobby (criar/entrar sala)
└─ 26. UI: Sala de espera

FASE 6: Testes e Finalização (Passo 27)
└─ 27. Testes E2E + Deploy
```

---

## FASE 1: Setup Backend

### Passo 1: Criar package.json e instalar dependências

**Objetivo:** Preparar ambiente Node.js com bibliotecas necessárias

**Arquivos afetados:** 
- `package.json` (criar)
- `package-lock.json` (auto-gerado)

**O que fazer:**

1. No diretório raiz do projeto, criar arquivo `package.json`:

```json
{
  "name": "gulliver-multiplayer-server",
  "version": "1.0.0",
  "description": "Servidor autoritário para Gulliver Futebol de Botão multiplayer",
  "main": "server.js",
  "type": "module",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "socket.io": "^4.7.5",
    "cannon-es": "^0.20.0",
    "dotenv": "^16.3.1"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

2. No terminal, executar:
```bash
npm install
```

**Validação:**
- ✅ Pasta `node_modules/` foi criada
- ✅ `package-lock.json` existe
- ✅ `npm list` mostra as dependências

---

### Passo 2: Criar server.js básico (Express + Socket.io)

**Objetivo:** Servidor HTTP com Socket.io escutando na porta 3000

**Arquivos afetados:**
- `server.js` (criar)

**O que fazer:**

Criar arquivo `server.js`:

```javascript
import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import dotenv from 'dotenv';

dotenv.config();

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
app.use(express.static('.'));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: Date.now()
  });
});

// Socket.io connection
io.on('connection', (socket) => {
  console.log(`[Connected] ${socket.id}`);
  
  socket.on('disconnect', () => {
    console.log(`[Disconnected] ${socket.id}`);
  });
});

// Start server
httpServer.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});

export { io };
```

**Validação:**
```bash
npm start
# Esperado: "🚀 Servidor rodando em http://localhost:3000"
# Test: curl http://localhost:3000/health
# Resposta: { "status": "ok", "uptime": ... }
```

---

### Passo 3: Implementar Gerenciador de Salas

**Objetivo:** Permitir criar sala com código e entrar com código

**Arquivos afetados:**
- `server.js` (modificar)

**O que fazer:**

Adicionar ao `server.js`:

```javascript
// Gerenciador de salas
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

// Evento: Criar sala
io.on('connection', (socket) => {
  socket.on('create_room', (data) => {
    const roomCode = generateRoomCode();
    
    rooms.set(roomCode, {
      yellowSocketId: socket.id,
      blueSocketId: null,
      config: data.gameConfig,
      createdAt: Date.now()
    });
    
    socket.emit('room_created', { roomCode, config: data.gameConfig });
    console.log(`[Room Created] ${roomCode} by ${socket.id}`);
  });

  // Evento: Entrar em sala
  socket.on('join_room', (roomCode) => {
    const room = rooms.get(roomCode);
    
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }
    
    if (room.blueSocketId !== null) {
      socket.emit('error', { message: 'Room is full' });
      return;
    }
    
    room.blueSocketId = socket.id;
    
    // Notifica ambos que sala está pronta
    const yellowSocket = io.sockets.sockets.get(room.yellowSocketId);
    const blueSocket = io.sockets.sockets.get(room.blueSocketId);
    
    yellowSocket.emit('room_ready', {
      myTeam: 'yellow',
      roomCode,
      config: room.config
    });
    
    blueSocket.emit('room_ready', {
      myTeam: 'blue',
      roomCode,
      config: room.config
    });
    
    console.log(`[Room Joined] ${roomCode} by ${socket.id}`);
  });

  socket.on('disconnect', () => {
    const room = findRoomBySocket(socket.id);
    if (room) {
      const otherTeam = socket.id === room.yellowSocketId ? room.blueSocketId : room.yellowSocketId;
      if (otherTeam) {
        const otherSocket = io.sockets.sockets.get(otherTeam);
        otherSocket?.emit('opponent_disconnected');
      }
      rooms.delete(room.code);
      console.log(`[Room Deleted] ${room.code}`);
    }
  });
});
```

**Validação:**
1. Abrir navegador em 2 abas: `http://localhost:3000`
2. Na primeira aba, chamar manualmente:
   ```javascript
   const socket = io('http://localhost:3000');
   socket.emit('create_room', { gameConfig: { gameMode: 'button_football' } });
   socket.on('room_created', (data) => console.log('Código:', data.roomCode));
   ```
3. Na segunda aba:
   ```javascript
   const socket = io('http://localhost:3000');
   socket.emit('join_room', 'ABCD'); // usar código da aba 1
   socket.on('room_ready', (data) => console.log('Sala pronta:', data));
   ```
4. Ambas devem receber `room_ready`

---

### Passo 4: Criar Classe GameRoom (Estado + Estrutura)

**Objetivo:** Encapsular estado de jogo e lógica de uma sala

**Arquivos afetados:**
- `GameRoom.js` (criar novo arquivo)

**O que fazer:**

Criar arquivo `GameRoom.js`:

```javascript
export class GameRoom {
  constructor(roomCode, config) {
    this.roomCode = roomCode;
    this.config = config;
    this.yellowSocketId = null;
    this.blueSocketId = null;
    
    // Estado do jogo
    this.gameState = {
      scores: { yellow: 0, blue: 0 },
      possession: 'yellow',
      touches: 0,
      maxTouches: 4,
      half: 1,
      timeLeft: 600, // 10 minutos
      locked: false,
      ballDead: false,
      restartPending: null,
      gameStatus: 'playing', // 'playing', 'goal', 'throw_in', etc
      
      // Física será inicializada depois
      players: {
        yellow: [],
        blue: []
      },
      ball: null,
      physics: null
    };
    
    // Fila de inputs
    this.inputQueue = {
      yellow: null,
      blue: null
    };
    
    // Controle do loop
    this.tickCounter = 0;
    this.lastTickTime = Date.now();
    this.isRunning = false;
    
    console.log(`[GameRoom] ${roomCode} criada`);
  }

  // Será implementado depois
  tick(deltaTime) {
    // TODO: implementar tick loop
  }

  receiveInput(team, inputData) {
    // TODO: implementar fila de inputs
    this.inputQueue[team] = inputData;
  }

  start() {
    console.log(`[GameRoom] ${this.roomCode} iniciada`);
    this.isRunning = true;
    // Tick loop será implementado depois
  }

  stop() {
    console.log(`[GameRoom] ${this.roomCode} parada`);
    this.isRunning = false;
  }

  getStateSnapshot() {
    return {
      timestamp: Date.now(),
      tick: this.tickCounter,
      scores: this.gameState.scores,
      possession: this.gameState.possession,
      touches: this.gameState.touches,
      half: this.gameState.half,
      timeLeft: Math.max(0, Math.floor(this.gameState.timeLeft)),
      gameStatus: this.gameState.gameStatus,
      canInteract: {
        yellow: this.gameState.possession === 'yellow' && !this.gameState.locked,
        blue: this.gameState.possession === 'blue' && !this.gameState.locked
      }
      // Posições serão adicionadas depois
    };
  }
}
```

**Validação:**
- ✅ Arquivo criado
- ✅ Sintaxe JavaScript válida

---

### Passo 5: Integrar GameRoom ao Socket.io

**Objetivo:** Criar instância GameRoom quando sala fica pronta

**Arquivos afetados:**
- `server.js` (modificar)

**O que fazer:**

Modificar `server.js` para:

1. Importar GameRoom:
```javascript
import { GameRoom } from './GameRoom.js';
```

2. Modificar evento `room_ready` para iniciar GameRoom:

```javascript
socket.on('join_room', (roomCode) => {
  const room = rooms.get(roomCode);
  
  if (!room) {
    socket.emit('error', { message: 'Room not found' });
    return;
  }
  
  if (room.blueSocketId !== null) {
    socket.emit('error', { message: 'Room is full' });
    return;
  }
  
  room.blueSocketId = socket.id;
  
  // ✅ NOVO: Criar GameRoom
  const gameRoom = new GameRoom(roomCode, room.config);
  gameRoom.yellowSocketId = room.yellowSocketId;
  gameRoom.blueSocketId = room.blueSocketId;
  room.gameRoom = gameRoom;
  
  // Notifica ambos
  const yellowSocket = io.sockets.sockets.get(room.yellowSocketId);
  const blueSocket = io.sockets.sockets.get(room.blueSocketId);
  
  yellowSocket.emit('room_ready', {
    myTeam: 'yellow',
    roomCode,
    config: room.config
  });
  
  blueSocket.emit('room_ready', {
    myTeam: 'blue',
    roomCode,
    config: room.config
  });
  
  // ✅ NOVO: Iniciar GameRoom
  gameRoom.start();
  
  console.log(`[Room Joined] ${roomCode} by ${socket.id}`);
});
```

3. Adicionar listener para `player_input`:

```javascript
socket.on('player_input', (inputData) => {
  const room = findRoomBySocket(socket.id);
  if (!room || !room.gameRoom) return;
  
  const team = socket.id === room.gameRoom.yellowSocketId ? 'yellow' : 'blue';
  room.gameRoom.receiveInput(team, inputData);
});
```

**Validação:**
- ✅ Server roda sem erros
- ✅ Console mostra `[GameRoom] XXXX criada`

---

## FASE 2: Lógica de Jogo no Servidor

### Passo 6: Setup Cannon.js no Servidor

**Objetivo:** Inicializar mundo físico com gravidade e materiais

**Arquivos afetados:**
- `GameRoom.js` (modificar)

**O que fazer:**

Adicionar import e inicialização Cannon.js:

```javascript
import * as CANNON from 'cannon-es';

export class GameRoom {
  constructor(roomCode, config) {
    // ... código anterior ...
    
    // ✅ NOVO: Inicializar Cannon.js
    this.gameState.physics = new CANNON.World();
    this.gameState.physics.gravity.set(0, -80, 0);
    this.gameState.physics.defaultContactMaterial.friction = 0.6;
    this.gameState.physics.defaultContactMaterial.restitution = 0.2;
    
    // Materiais
    this.matPiece = new CANNON.Material('piece');
    this.matBall = new CANNON.Material('ball');
    this.matFloor = new CANNON.Material('floor');
    
    this.gameState.physics.addContactMaterial(
      new CANNON.ContactMaterial(this.matPiece, this.matPiece, {
        friction: 0.6,
        restitution: 0.2
      })
    );
    
    this.gameState.physics.addContactMaterial(
      new CANNON.ContactMaterial(this.matBall, this.matFloor, {
        friction: 2.0,
        restitution: 0.65
      })
    );
  }
}
```

**Validação:**
- ✅ Sem erros ao criar GameRoom
- ✅ Console não mostra erro de CANNON

---

### Passo 7: Criar Bodies (Jogadores + Bola)

**Objetivo:** Criar 23 corpos físicos (11+11 jogadores + 1 bola)

**Arquivos afetados:**
- `GameRoom.js` (modificar)
- `constants.js` (usar existente)

**O que fazer:**

Adicionar método `initializePhysics()` em GameRoom:

```javascript
import { C } from './js/constants.js'; // Usar constantes existentes

export class GameRoom {
  // ... código anterior ...

  initializePhysics() {
    // Criar formações iniciais (usar formations.js do projeto)
    const yellowFormation = this.getInitialFormation('yellow');
    const blueFormation = this.getInitialFormation('blue');
    
    // Criar bodies para time amarelo
    this.gameState.players.yellow = yellowFormation.map((pos, idx) => {
      const body = new CANNON.Body({
        mass: 4,
        shape: new CANNON.Sphere(C.PLAYER_R),
        material: this.matPiece
      });
      body.position.set(pos.x, C.PLAYER_R, pos.z);
      this.gameState.physics.addBody(body);
      
      return {
        idx,
        team: 'yellow',
        physBody: body,
        position: new CANNON.Vec3(pos.x, C.PLAYER_R, pos.z),
        velocity: new CANNON.Vec3(0, 0, 0),
        quaternion: new CANNON.Quaternion(0, 0, 0, 1)
      };
    });
    
    // Criar bodies para time azul (simétrico)
    this.gameState.players.blue = blueFormation.map((pos, idx) => {
      const body = new CANNON.Body({
        mass: 4,
        shape: new CANNON.Sphere(C.PLAYER_R),
        material: this.matPiece
      });
      body.position.set(pos.x, C.PLAYER_R, pos.z);
      this.gameState.physics.addBody(body);
      
      return {
        idx,
        team: 'blue',
        physBody: body,
        position: new CANNON.Vec3(pos.x, C.PLAYER_R, pos.z),
        velocity: new CANNON.Vec3(0, 0, 0),
        quaternion: new CANNON.Quaternion(0, 0, 0, 1)
      };
    });
    
    // Criar bola
    const ballBody = new CANNON.Body({
      mass: 0.15,
      shape: new CANNON.Sphere(C.BALL_R),
      material: this.matBall,
      linearDamping: 0.4,
      angularDamping: 0.4
    });
    ballBody.position.set(0, C.BALL_R, 0);
    this.gameState.physics.addBody(ballBody);
    
    this.gameState.ball = {
      physBody: ballBody,
      position: new CANNON.Vec3(0, C.BALL_R, 0),
      velocity: new CANNON.Vec3(0, 0, 0),
      quaternion: new CANNON.Quaternion(0, 0, 0, 1)
    };
    
    console.log(`[Physics] ${this.roomCode}: 23 bodies criados`);
  }

  getInitialFormation(team) {
    // Copiar formação de formations.js
    // Retornar array de { x, z } positions
    // Para simplificar, usar hardcoded
    if (team === 'yellow') {
      return [
        // Goleiro
        { x: 50, z: 0 },
        // Defensores
        { x: 40, z: -15 }, { x: 40, z: -5 }, { x: 40, z: 5 }, { x: 40, z: 15 },
        // Meias
        { x: 20, z: -10 }, { x: 20, z: 0 }, { x: 20, z: 10 },
        // Atacantes
        { x: 5, z: -12 }, { x: 5, z: 0 }, { x: 5, z: 12 }
      ];
    } else {
      // Azul é simétrico (x * -1)
      return [
        { x: -50, z: 0 },
        { x: -40, z: -15 }, { x: -40, z: -5 }, { x: -40, z: 5 }, { x: -40, z: 15 },
        { x: -20, z: -10 }, { x: -20, z: 0 }, { x: -20, z: 10 },
        { x: -5, z: -12 }, { x: -5, z: 0 }, { x: -5, z: 12 }
      ];
    }
  }
}
```

3. Chamar `initializePhysics()` no `start()`:

```javascript
start() {
  this.initializePhysics();
  this.isRunning = true;
  console.log(`[GameRoom] ${this.roomCode} iniciada`);
}
```

**Validação:**
- ✅ Sem erro ao inicializar
- ✅ Console mostra `[Physics] XXXX: 23 bodies criados`

---

### Passo 8: Implementar applyForce (Aplicar Impulso)

**Objetivo:** Quando jogador arrasta peça, aplicar força ao body

**Arquivos afetados:**
- `GameRoom.js` (modificar)

**O que fazer:**

Adicionar método em GameRoom:

```javascript
export class GameRoom {
  // Constantes
  static MAX_IMPULSE = 100; // Newton·segundo
  
  // ... código anterior ...

  applyForceToPlayer(team, inputData) {
    const player = this.gameState.players[team][inputData.playerIdx];
    
    if (!player) {
      console.warn(`Player não encontrado: ${team}-${inputData.playerIdx}`);
      return;
    }
    
    // Clamp intensity entre 0 e 1
    const intensity = Math.max(0, Math.min(inputData.intensity, 1.0));
    
    // Calcula força
    const forceMagnitude = intensity * GameRoom.MAX_IMPULSE;
    
    // Normaliza direção
    const direction = new CANNON.Vec3(
      inputData.directionX,
      0, // Sem força vertical
      inputData.directionZ
    );
    direction.normalize();
    direction.scale(forceMagnitude, direction);
    
    // Aplica impulso
    player.physBody.applyImpulse(
      direction,
      player.physBody.position
    );
    
    console.log(`[Force Applied] ${team}-${inputData.playerIdx}: ${forceMagnitude.toFixed(2)}N`);
  }
}
```

**Validação:**
- ✅ Método existe e não gera erro

---

### Passo 9: Sincronizar Cannon.js com State

**Objetivo:** Copiar posições/velocidades de Cannon bodies para estado local

**Arquivos afetados:**
- `GameRoom.js` (modificar)

**O que fazer:**

Adicionar método em GameRoom:

```javascript
export class GameRoom {
  // ... código anterior ...

  syncPhysicsToState() {
    // Sincronizar jogadores amarelos
    for (const player of this.gameState.players.yellow) {
      player.position.copy(player.physBody.position);
      player.velocity.copy(player.physBody.velocity);
      player.quaternion.copy(player.physBody.quaternion);
    }
    
    // Sincronizar jogadores azuis
    for (const player of this.gameState.players.blue) {
      player.position.copy(player.physBody.position);
      player.velocity.copy(player.physBody.velocity);
      player.quaternion.copy(player.physBody.quaternion);
    }
    
    // Sincronizar bola
    this.gameState.ball.position.copy(this.gameState.ball.physBody.position);
    this.gameState.ball.velocity.copy(this.gameState.ball.physBody.velocity);
    this.gameState.ball.quaternion.copy(this.gameState.ball.physBody.quaternion);
  }
}
```

**Validação:**
- ✅ Método adicionado

---

### Passo 10: Implementar Validação de Input

**Objetivo:** Rejeitar inputs inválidos (segurança)

**Arquivos afetados:**
- `GameRoom.js` (modificar)

**O que fazer:**

Adicionar método em GameRoom:

```javascript
export class GameRoom {
  // ... código anterior ...

  validateInput(team, inputData) {
    // 1. É a vez desse time?
    if (this.gameState.possession !== team) {
      return false;
    }
    
    // 2. Jogo não está travado?
    if (this.gameState.locked) {
      return false;
    }
    
    // 3. Bola não está morta (fora de jogo)?
    if (this.gameState.ballDead) {
      // Se está fora, só o time que vai reiniciar pode mover goleiro
      if (this.gameState.restartPending?.team !== team) {
        return false;
      }
    }
    
    // 4. Peça existe?
    const player = this.gameState.players[team][inputData.playerIdx];
    if (!player) {
      return false;
    }
    
    // 5. Input não é muito antigo (>100ms)?
    const timeSinceInput = Date.now() - inputData.timestamp;
    if (timeSinceInput > 100) {
      return false;
    }
    
    // 6. Direção é normalizada?
    const dirMag = Math.sqrt(
      inputData.directionX ** 2 + inputData.directionZ ** 2
    );
    if (dirMag === 0 || dirMag > 1.1) {
      return false;
    }
    
    // 7. Intensity está entre 0 e 1?
    if (inputData.intensity < 0 || inputData.intensity > 1) {
      return false;
    }
    
    return true;
  }
}
```

**Validação:**
- ✅ Método adicionado

---

### Passo 11: Implementar Tick Loop (60 FPS)

**Objetivo:** Loop principal que processa inputs e roda física

**Arquivos afetados:**
- `GameRoom.js` (modificar)
- `server.js` (modificar)

**O que fazer:**

1. Adicionar método `tick()` em GameRoom:

```javascript
export class GameRoom {
  // Constantes
  static TICK_RATE = 60;
  static TICK_DELTA = 1 / GameRoom.TICK_RATE; // 0.0167s
  
  // ... código anterior ...

  tick(deltaTime) {
    // ===== FASE 1: INPUT =====
    const yellowInput = this.inputQueue.yellow;
    const blueInput = this.inputQueue.blue;
    
    // ===== FASE 2: VALIDAÇÃO E APLICAÇÃO =====
    if (yellowInput && this.validateInput('yellow', yellowInput)) {
      this.applyForceToPlayer('yellow', yellowInput);
    }
    
    if (blueInput && this.validateInput('blue', blueInput)) {
      this.applyForceToPlayer('blue', blueInput);
    }
    
    // ===== FASE 3: FÍSICA =====
    this.gameState.physics.step(GameRoom.TICK_DELTA, deltaTime, 3);
    
    // ===== FASE 4: SINCRONIZAR =====
    this.syncPhysicsToState();
    
    // ===== FASE 5: DETECTAR EVENTOS =====
    // TODO: implementar checkGameEvents()
    
    // ===== FASE 6: ATUALIZAR RELÓGIO =====
    if (!this.paused && !this.gameState.matchEnded) {
      this.gameState.timeLeft -= deltaTime;
      
      if (this.gameState.timeLeft <= 0) {
        if (this.gameState.half === 1) {
          this.gameState.half = 2;
          this.gameState.timeLeft = 600;
          this.paused = true; // Intervalo
        } else {
          this.gameState.matchEnded = true;
        }
      }
    }
    
    // ===== FASE 7: LIMPEZA =====
    this.inputQueue.yellow = null;
    this.inputQueue.blue = null;
    this.tickCounter++;
  }
}
```

2. Modificar `server.js` para rodar tick loop:

```javascript
// Após criar server
let gameRoomsTicking = new Map(); // Rastreia salas ativas

// Loop principal (60 FPS)
let lastTickTime = Date.now();
const tickInterval = setInterval(() => {
  const now = Date.now();
  const deltaTime = (now - lastTickTime) / 1000;
  lastTickTime = now;
  
  for (const [roomCode, room] of rooms) {
    if (room.gameRoom && room.gameRoom.isRunning) {
      room.gameRoom.tick(deltaTime);
    }
  }
}, 1000 / 60); // ~16ms
```

**Validação:**
```bash
npm start
# Console deve mostrar atividade de tick (~60 linhas/segundo)
# Observar sem erro
```

---

### Passo 12: Serializar e Broadcast State

**Objetivo:** Converter estado em JSON e enviar para clientes 60x/s

**Arquivos afetados:**
- `GameRoom.js` (modificar)
- `server.js` (modificar)

**O que fazer:**

1. Modificar `getStateSnapshot()` em GameRoom para ser completo:

```javascript
export class GameRoom {
  // ... código anterior ...

  serializeState() {
    return {
      timestamp: Date.now(),
      tick: this.tickCounter,
      
      // Placar
      scores: {
        yellow: this.gameState.scores.yellow,
        blue: this.gameState.scores.blue
      },
      
      // Posse
      possession: this.gameState.possession,
      touches: this.gameState.touches,
      
      // Relógio
      half: this.gameState.half,
      timeLeft: Math.max(0, Math.floor(this.gameState.timeLeft)),
      
      // Jogadores
      players: {
        yellow: this.gameState.players.yellow.map(p => ({
          idx: p.idx,
          pos: { x: p.position.x, y: p.position.y, z: p.position.z },
          vel: { x: p.velocity.x, y: p.velocity.y, z: p.velocity.z },
          quat: { x: p.quaternion.x, y: p.quaternion.y, z: p.quaternion.z, w: p.quaternion.w }
        })),
        blue: this.gameState.players.blue.map(p => ({
          idx: p.idx,
          pos: { x: p.position.x, y: p.position.y, z: p.position.z },
          vel: { x: p.velocity.x, y: p.velocity.y, z: p.velocity.z },
          quat: { x: p.quaternion.x, y: p.quaternion.y, z: p.quaternion.z, w: p.quaternion.w }
        }))
      },
      
      // Bola
      ball: {
        pos: { x: this.gameState.ball.position.x, y: this.gameState.ball.position.y, z: this.gameState.ball.position.z },
        vel: { x: this.gameState.ball.velocity.x, y: this.gameState.ball.velocity.y, z: this.gameState.ball.velocity.z }
      },
      
      // Permissões
      canInteract: {
        yellow: this.gameState.possession === 'yellow' && !this.gameState.locked,
        blue: this.gameState.possession === 'blue' && !this.gameState.locked
      },
      
      // Status
      gameStatus: this.gameState.gameStatus,
      ballDead: this.gameState.ballDead,
      restartPending: this.gameState.restartPending
    };
  }

  broadcast(io) {
    const state = this.serializeState();
    
    const yellowSocket = io.sockets.sockets.get(this.yellowSocketId);
    const blueSocket = io.sockets.sockets.get(this.blueSocketId);
    
    if (yellowSocket) yellowSocket.emit('state_update', state);
    if (blueSocket) blueSocket.emit('state_update', state);
  }
}
```

2. Adicionar broadcast no server.js:

```javascript
// No tick loop
const tickInterval = setInterval(() => {
  const now = Date.now();
  const deltaTime = (now - lastTickTime) / 1000;
  lastTickTime = now;
  
  for (const [roomCode, room] of rooms) {
    if (room.gameRoom && room.gameRoom.isRunning) {
      room.gameRoom.tick(deltaTime);
      room.gameRoom.broadcast(io); // ✅ Novo
    }
  }
}, 1000 / 60);
```

**Validação:**
```bash
npm start
# Abrir 2 abas
# Criar sala em aba 1, entrar em aba 2
# Em console da aba 1:
const socket = io('http://localhost:3000');
socket.on('state_update', (state) => console.log(state));
# Deve receber state_update 60x por segundo
```

---

## FASE 3: Eventos de Jogo

### Passo 13-18: Detectar Gol, Lateral, Escanteio, etc

**Objetivo:** Implementar lógica de detecção de eventos especiais

**Arquivos afetados:**
- `GameRoom.js` (adicionar métodos)

**O que fazer:**

Adicionar em GameRoom:

```javascript
export class GameRoom {
  // ... código anterior ...

  checkGameEvents() {
    // Verificar gol
    if (this.isGoal()) {
      this.handleGoal();
    }
    // Verificar se bola saiu do campo
    else if (this.isBallOutOfBounds()) {
      if (this.isThrowIn()) {
        this.handleThrowIn();
      } else if (this.isCorner()) {
        this.handleCorner();
      } else if (this.isGoalKick()) {
        this.handleGoalKick();
      }
    }
  }

  // GESTO
  isGoal() {
    const b = this.gameState.ball.position;
    const C = require('./js/constants.js').default;
    
    // Bola passou da linha de fundo E dentro da área do gol
    if (Math.abs(b.x) > C.FW / 2 && Math.abs(b.z) < C.GW / 2 + 0.3) {
      return true;
    }
    return false;
  }

  handleGoal() {
    const scoringTeam = this.gameState.ball.velocity.x > 0 ? 'yellow' : 'blue';
    
    this.gameState.scores[scoringTeam]++;
    this.gameState.gameStatus = 'goal';
    
    // Reset campo
    this.resetFieldAfterGoal(scoringTeam);
    
    console.log(`[GOAL] ${scoringTeam} scored!`);
  }

  // LATERAL
  isBallOutOfBounds() {
    const b = this.gameState.ball.position;
    const C = require('./js/constants.js').default;
    return Math.abs(b.z) > C.FH / 2 || Math.abs(b.x) > C.FW / 2;
  }

  isThrowIn() {
    const b = this.gameState.ball.position;
    const C = require('./js/constants.js').default;
    // Saiu pela linha lateral (Z)
    return Math.abs(b.z) > C.FH / 2 && Math.abs(b.x) <= C.FW / 2;
  }

  handleThrowIn() {
    const b = this.gameState.ball.position;
    const C = require('./js/constants.js').default;
    
    // Descobre qual time chutou por último
    const awardedTeam = this.gameState.lastTouchTeam === 'yellow' ? 'blue' : 'yellow';
    
    // Reposiciona bola na lateral
    b.z = b.z > 0 ? C.FH / 2 : -C.FH / 2;
    b.x = Math.max(-C.FW / 2, Math.min(b.x, C.FW / 2));
    this.gameState.ball.physBody.position.copy(b);
    
    this.gameState.gameStatus = 'throw_in';
    this.gameState.ballDead = true;
    this.gameState.restartPending = { team: awardedTeam, type: 'throw_in', position: { x: b.x, z: b.z } };
    
    console.log(`[THROW-IN] ${awardedTeam} awarded`);
  }

  // ESCANTEIO
  isCorner() {
    const b = this.gameState.ball.position;
    const C = require('./js/constants.js').default;
    // Saiu pela linha de fundo E defesa tocou por último
    return Math.abs(b.x) > C.FW / 2 && this.gameState.lastTouchTeam !== (b.x > 0 ? 'yellow' : 'blue');
  }

  handleCorner() {
    const b = this.gameState.ball.position;
    const C = require('./js/constants.js').default;
    
    const attackingTeam = b.x > 0 ? 'blue' : 'yellow';
    
    // Reposiciona na bandeirinha
    b.x = b.x > 0 ? C.FW / 2 : -C.FW / 2;
    b.z = b.z > 0 ? C.FH / 2 : -C.FH / 2;
    this.gameState.ball.physBody.position.copy(b);
    
    this.gameState.gameStatus = 'corner';
    this.gameState.ballDead = true;
    this.gameState.restartPending = { team: attackingTeam, type: 'corner' };
    
    console.log(`[CORNER] ${attackingTeam} awarded`);
  }

  // TIRO DE META
  isGoalKick() {
    // Se não é corner, é tiro de meta
    return true;
  }

  handleGoalKick() {
    const b = this.gameState.ball.position;
    const C = require('./js/constants.js').default;
    
    const defendingTeam = b.x > 0 ? 'yellow' : 'blue';
    
    // Reposiciona na área pequena
    b.x = b.x > 0 ? C.FW / 2 - 5 : -C.FW / 2 + 5;
    b.z = 0;
    this.gameState.ball.physBody.position.copy(b);
    
    this.gameState.gameStatus = 'goal_kick';
    this.gameState.ballDead = true;
    this.gameState.restartPending = { team: defendingTeam, type: 'goal_kick' };
    
    console.log(`[GOAL-KICK] ${defendingTeam} awarded`);
  }

  resetFieldAfterGoal(scoringTeam) {
    // TODO: resetar todas as posições (formations)
    this.gameState.possession = scoringTeam === 'yellow' ? 'blue' : 'yellow';
    this.gameState.touches = 0;
    this.gameState.ballDead = false;
    this.gameState.restartPending = null;
  }
}
```

2. Chamar `checkGameEvents()` no tick:

```javascript
tick(deltaTime) {
  // ... outras fases ...
  
  // FASE 5: DETECTAR EVENTOS
  this.checkGameEvents(); // ✅ Novo
  
  // ... resto do código ...
}
```

**Validação:**
- ✅ Sem erro ao rodar servidor

---

### Passo 19-26: Cliente Multiplayer (Resumido)

(Por brevidade, descrevo os 8 próximos passos de forma comprimida)

Criar **`js/multiplayer.js`** no cliente com:
- Conexão Socket.io
- Receber `state_update` e atualizar posições
- Interpolação visual (smooth)
- Enviar `player_input` ao servidor
- Gerenciar HUD multiplayer

Modificar **`index.html`**:
- Adicionar UI para criar/entrar sala
- Campo de código 4 letras
- Sala de espera

Modificar **`js/input.js`**:
- Bloquear drag se não é seu turno
- Enviar `player_input` em vez de aplicar força localmente

Modificar **`js/game.js`**:
- Receber estado do servidor em vez de calcular localmente
- HUD mostra ping/latência

**Validação Final (Passo 27):**
```bash
npm start
# Abrir 2 abas
# Sala 1 cria, Sala 2 entra
# Ambas devem sincronizar movimentos
# Ping deve ser < 50ms localmente
```

---

## 📋 Checklist Resumido dos 27 Passos

- [x] 1. package.json
- [x] 2. server.js básico
- [x] 3. Gerenciador de salas
- [x] 4. GameRoom class
- [x] 5. Integração Socket.io
- [x] 6. Setup Cannon.js
- [x] 7. Criar bodies
- [x] 8. applyForce()
- [x] 9. syncPhysicsToState()
- [x] 10. validateInput()
- [x] 11. Tick loop
- [x] 12. Broadcast state
- [x] 13-18. Eventos (gol, lateral, escanteio, etc)
- [ ] 19. Criar multiplayer.js
- [ ] 20. Receber state_update
- [ ] 21. Interpolação visual
- [ ] 22. Enviar player_input
- [ ] 23. Sincronizar HUD
- [ ] 24. UI: Menu
- [ ] 25. UI: Lobby
- [ ] 26. UI: Sala de espera
- [ ] 27. Testes E2E

---

## 🎯 Próximos Passos

Qual passo quer começar? Recomendo a ordem:

1. **Passos 1-5** (Setup backend básico)
2. **Passos 6-12** (Física e tick loop)
3. **Passos 13-18** (Eventos de jogo)
4. **Passos 19-26** (Cliente e UI)
5. **Passo 27** (Testes)

Posso detalhar qualquer passo que quiser. Qual quer fazer primeiro?

# Especificação Detalhada: Modo Multiplayer com Servidor Autoritário — Gulliver
**Versão 2.0** | Arquitetura: Servidor Autoritário | Atualizado: 2026-07-03

---

## Índice
1. [Visão Geral](#visão-geral)
2. [Princípios da Arquitetura](#princípios-da-arquitetura)
3. [Arquitetura do Sistema](#arquitetura-do-sistema)
4. [Fluxo de Dados](#fluxo-de-dados)
5. [Modelos de Dados](#modelos-de-dados)
6. [Eventos Socket.io](#eventos-socketio)
7. [Estado do Jogo (Servidor)](#estado-do-jogo-servidor)
8. [Tick Loop do Servidor](#tick-loop-do-servidor)
9. [Validação e Segurança](#validação-e-segurança)
10. [Interface do Usuário](#interface-do-usuário)
11. [Tratamento de Erros](#tratamento-de-erros)
12. [Testes](#testes)
13. [Implantação](#implantação)

---

## Visão Geral

### Objetivo
Permitir 2 jogadores em **dispositivos diferentes** controlarem seus times, com toda a lógica de jogo, física e validação centralizada no servidor. O servidor é a **fonte de verdade única** — clientes apenas recebem estado e enviam intenções.

### Por Que Servidor Autoritário?
- ✅ **Determinismo garantido**: Física roda 1x no servidor, sem sincronização complexa
- ✅ **Segurança**: Clientes não podem "trapacear" (não executam lógica)
- ✅ **Simplicidade**: Sem race conditions, sem divergências de estado
- ✅ **Escalabilidade**: Fácil adicionar espectadores (recebem estado do servidor)
- ✅ **Debugging**: Tudo centralizado no servidor

### Trade-off
- ⚠️ Latência: Cliente aguarda resposta do servidor para ver resultado
- ⚠️ Banda: Mais tráfego de rede (estado completo a cada tick)
- 💡 **Mitigação**: Interpolação visual no cliente, anti-lag via predição

### Fluxo Simplificado

```
[Cliente A - Jogador]    [Servidor - Autoridade]    [Cliente B - Jogador]
        │                        │                          │
        │ "Vou arrastar p5"      │                          │
        ├─ input_intent ────────►│                          │
        │                        │ ◄─── input_intent ────┤
        │                        │ Valida ambos inputs    │
        │                        │ Calcula física         │
        │                        │ (Cannon.js no servidor)│
        │                        │ Atualiza posse/score   │
        │◄──── state_update ─────┤─── state_update ──────►│
        │ Renderiza novo estado  │  Renderiza novo estado │
        │                        │                          │
        │ [aguarda 16ms]         │ [próximo tick: 60 FPS]  │
        │◄─── state_update ──────┤─── state_update ──────►│
```

---

## Princípios da Arquitetura

### 1. Autoridade Centralizada no Servidor
- Servidor mantém estado completo: posições, velocidades, placar, posse, etc.
- Clientes recebem snapshot do estado a cada tick (60 FPS)
- Clientes **nunca** modificam estado local — apenas visualizam

### 2. Clientes Enviam Intenções, Não Resultados
- Cliente A arrasta peça → envia `{ playerIdx, direction, intensity }`
- Servidor valida: "É amarelo? É seu turno? Peça existe?"
- Servidor executa física e retorna novo estado
- Clientes B e A recebem mesmo novo estado

### 3. Tick Loop Sincronizado (60 FPS)
- Servidor tá rodando em loop: 16ms / tick
- A cada tick:
  1. Coleta inputs de ambos clientes (com timeout)
  2. Executa física Cannon.js
  3. Verifica colisões, gols, laterais
  4. Emite novo estado para ambos

### 4. Sem Duplicação de Lógica
- Toda regra (gol, falta, posse) roda 1x no servidor
- Clientes apenas visualizam o resultado
- Nunca há "desacordo" sobre o que aconteceu

---

## Arquitetura do Sistema

### 1. Servidor (Node.js + Socket.io + Cannon.js)

```
┌─────────────────────────────────────────┐
│    Servidor Node.js (server.js)         │
├─────────────────────────────────────────┤
│                                         │
│  ┌─ Gerenciador de Salas ─┐            │
│  │ - Criar sala            │            │
│  │ - Entrar em sala        │            │
│  │ - Limpar salas inativas │            │
│  └─────────────────────────┘            │
│                                         │
│  ┌─ Por Cada Sala (GameRoom) ─┐        │
│  │                              │        │
│  │ ┌─ Estado do Jogo ────────┐ │        │
│  │ │ - Posições dos jogadores│ │        │
│  │ │ - Velocidades           │ │        │
│  │ │ - Posse, toques, placar │ │        │
│  │ │ - Turno atual           │ │        │
│  │ └────────────────────────┘ │        │
│  │                              │        │
│  │ ┌─ Física Cannon.js ─────┐ │        │
│  │ │ - World (gravity, etc)  │ │        │
│  │ │ - 23 Bodies (11+11+bola)│ │        │
│  │ │ - step() a cada tick    │ │        │
│  │ └────────────────────────┘ │        │
│  │                              │        │
│  │ ┌─ Fila de Inputs ────────┐ │        │
│  │ │ yellow: { ... }         │ │        │
│  │ │ blue: { ... }           │ │        │
│  │ │ (TTL: 16ms)             │ │        │
│  │ └────────────────────────┘ │        │
│  │                              │        │
│  │ ┌─ Tick Loop (60 FPS) ───┐ │        │
│  │ │ 1. Coleta inputs       │ │        │
│  │ │ 2. physics.step()      │ │        │
│  │ │ 3. Checa eventos       │ │        │
│  │ │ 4. broadcast state     │ │        │
│  │ └────────────────────────┘ │        │
│  └──────────────────────────────┘        │
│                                         │
└─────────────────────────────────────────┘
```

#### Pseudocódigo do Servidor

```javascript
class GameRoom {
  constructor(config) {
    this.roomCode = generateCode();
    this.yellowSocket = null;
    this.blueSocket = null;
    this.config = config;
    
    // Estado de jogo
    this.gameState = {
      scores: { yellow: 0, blue: 0 },
      possession: 'yellow',
      touches: 0,
      half: 1,
      timeLeft: 600,
      players: { yellow: [...], blue: [...] }, // Cannon.js bodies
      ball: Ball,                               // Cannon.js body
      locked: false,                            // Chute resolvendo?
      ballDead: false,
      restartPending: null
    };
    
    // Fila de inputs (recebe do cliente, processa no tick)
    this.inputQueue = {
      yellow: null,
      blue: null
    };
    
    // Physics world (roda no servidor)
    this.physics = new CANNON.World();
    this.physics.gravity.set(0, -80, 0);
    // ... setup bodies, materials, etc
  }

  // Chamado a cada tick (16ms, 60 FPS)
  tick(deltaTime) {
    // 1. Processa inputs colhidos desde último tick
    this.processInputs();
    
    // 2. Roda física
    this.physics.step(1/60, deltaTime, 3);
    
    // 3. Sincroniza Cannon bodies → state
    this.syncPhysicsToState();
    
    // 4. Verifica eventos de jogo (gol, lateral, etc)
    this.checkGameEvents();
    
    // 5. Atualiza relógio
    this.updateClock(deltaTime);
    
    // 6. Broadcast estado para ambos clientes
    this.broadcastState();
    
    // 7. Limpa inputs antigos
    this.inputQueue = { yellow: null, blue: null };
  }

  // Recebe input do cliente
  receiveInput(team, inputData) {
    // Valida: é seu turno? Time correto? Peça existe?
    if (!this.validateInput(team, inputData)) {
      return; // Ignora input inválido
    }
    this.inputQueue[team] = inputData;
  }

  // Processa inputs acumulados
  processInputs() {
    if (this.inputQueue.yellow) {
      this.applyForceToPlayer('yellow', this.inputQueue.yellow);
    }
    if (this.inputQueue.blue) {
      this.applyForceToPlayer('blue', this.inputQueue.blue);
    }
  }

  // Aplica impulso ao jogador (físico)
  applyForceToPlayer(team, input) {
    const player = this.gameState.players[team][input.playerIdx];
    const impulse = new CANNON.Vec3(
      input.directionX * input.intensity,
      0,
      input.directionZ * input.intensity
    );
    player.physBody.applyImpulse(impulse, player.physBody.position);
  }

  // Sincroniza Cannon.js bodies para o estado
  syncPhysicsToState() {
    for (const player of this.gameState.players.yellow) {
      player.position.copy(player.physBody.position);
      player.velocity.copy(player.physBody.velocity);
    }
    for (const player of this.gameState.players.blue) {
      player.position.copy(player.physBody.position);
      player.velocity.copy(player.physBody.velocity);
    }
    this.gameState.ball.position.copy(this.gameState.ball.physBody.position);
    this.gameState.ball.velocity.copy(this.gameState.ball.physBody.velocity);
  }

  // Detecta eventos especiais
  checkGameEvents() {
    if (this.isGoal()) {
      this.handleGoal();
    } else if (this.isThrowIn()) {
      this.handleThrowIn();
    } else if (this.isCorner()) {
      this.handleCorner();
    }
  }

  // Broadcast do estado para ambos clientes
  broadcastState() {
    const statePayload = this.serializeState();
    this.yellowSocket.emit('state_update', statePayload);
    this.blueSocket.emit('state_update', statePayload);
  }

  // Serializa estado completo para enviar
  serializeState() {
    return {
      timestamp: Date.now(),
      tick: this.tickCounter,
      scores: this.gameState.scores,
      possession: this.gameState.possession,
      touches: this.gameState.touches,
      timeLeft: this.gameState.timeLeft,
      players: {
        yellow: this.gameState.players.yellow.map(p => ({
          idx: p.idx,
          pos: { x: p.position.x, y: p.position.y, z: p.position.z },
          vel: { x: p.velocity.x, y: p.velocity.y, z: p.velocity.z },
          quat: p.quaternion
        })),
        blue: this.gameState.players.blue.map(p => ({...}))
      },
      ball: {
        pos: { x: this.gameState.ball.position.x, ... },
        vel: { x: this.gameState.ball.velocity.x, ... }
      },
      canInteract: {
        yellow: this.canTeamInteract('yellow'),
        blue: this.canTeamInteract('blue')
      }
    };
  }
}

// Loop principal do servidor
setInterval(() => {
  const now = Date.now();
  const deltaTime = (now - lastTick) / 1000;
  lastTick = now;
  
  for (const [roomCode, room] of Object.entries(rooms)) {
    room.tick(deltaTime);
  }
}, 16); // ~60 FPS
```

### 2. Cliente (Navegador)

#### Responsabilidades
- Receber `state_update` do servidor a cada tick
- Interpolar visualmente entre frames (anti-lag)
- Coletar input do usuário (mouse/touch)
- Enviar input ao servidor via `player_input`
- Renderizar estado recebido

#### Módulo `multiplayer.js` (Cliente)

```javascript
class MultiplayerClient {
  constructor() {
    this.socket = null;
    this.isActive = false;
    this.myTeam = null;
    this.roomCode = null;
    
    // Estado remoto (recebido do servidor)
    this.remoteState = null;
    this.previousState = null;
    
    // Para interpolação
    this.interpolationAlpha = 0;
    this.lastStateTime = Date.now();
    
    // Input do usuário (aguardando envio)
    this.pendingInput = null;
  }

  // Conectar ao servidor
  connect(serverUrl) {
    this.socket = io(serverUrl);
    
    this.socket.on('state_update', (stateData) => {
      this.previousState = this.remoteState;
      this.remoteState = stateData;
      this.lastStateTime = Date.now();
      this.interpolationAlpha = 0;
      
      // Atualizar HUD, sprites, etc com novo estado
      this.onStateReceived(stateData);
    });
    
    this.socket.on('room_ready', (data) => {
      this.isActive = true;
      this.myTeam = data.myTeam;
      this.roomCode = data.roomCode;
    });
  }

  // Usuário arrasta peça → envia intenção ao servidor
  onPlayerDragged(playerIdx, direction, intensity) {
    if (!this.isActive || !this.remoteState) return;
    
    // Valida permissão localmente (apenas UI, servidor valida de verdade)
    if (!this.canDrag(playerIdx)) {
      console.warn('Drag bloqueado:', playerIdx);
      return;
    }
    
    // Envia input ao servidor
    this.socket.emit('player_input', {
      playerIdx,
      directionX: direction.x,
      directionZ: direction.z,
      intensity,        // 0.0 a 1.0
      timestamp: Date.now()
    });
  }

  // Recebe novo estado do servidor
  onStateReceived(stateData) {
    // Atualizar posições visuais (renderização)
    const players = [
      ...stateData.players.yellow,
      ...stateData.players.blue
    ];
    
    for (const player of players) {
      const mesh = this.getMeshForPlayer(player.idx, player.team);
      // Interpolar para nova posição (smooth)
      this.interpolateMesh(mesh, player.pos, stateData.timestamp);
    }
    
    // Atualizar bola
    this.interpolateMesh(this.ballMesh, stateData.ball.pos, stateData.timestamp);
    
    // Atualizar HUD
    updateHUD({
      scores: stateData.scores,
      possession: stateData.possession,
      timeLeft: stateData.timeLeft,
      myTeam: this.myTeam
    });
    
    // Atualizar permissões de interação
    this.canDragYellow = stateData.canInteract.yellow;
    this.canDragBlue = stateData.canInteract.blue;
  }

  // Interpola visualmente entre estados
  interpolateMesh(mesh, targetPos, serverTime) {
    // Calcula alpha baseado em tempo desde último update
    const timeSinceLastUpdate = Date.now() - serverTime;
    const alpha = Math.min(timeSinceLastUpdate / 32, 1.0); // 2 frames de interpolação
    
    // Lerp da posição anterior para nova
    if (this.previousState && mesh.userData.lastPos) {
      mesh.position.lerp(targetPos, alpha);
    } else {
      mesh.position.copy(targetPos);
    }
    mesh.userData.lastPos = targetPos;
  }

  // Valida se pode drag (verificação local apenas)
  canDrag(playerIdx) {
    if (!this.remoteState) return false;
    const player = this.remoteState.players[this.myTeam][playerIdx];
    if (!player) return false;
    // Servidor tem autoridade de verdade
    return this.remoteState.canInteract[this.myTeam];
  }
}
```

---

## Fluxo de Dados

### Fluxo 1: Turno Normal (Jogador A Chuta)

```
┌─────────────────────────────────────────────────────────────────┐
│ CLIENTE A (Amarelo)          SERVIDOR             CLIENTE B (Azul) │
│         │                        │                        │        │
│ Vê estado atual              Tick 1 (t=0ms)              Vê estado │
│ Amarelo com posse                                        Amarelo com posse
│                              Envia state_update ──────► │
│◄────────── state_update ──────────┤                      │
│                                   │                      │
│ Usuário arrasta peça p5           │                      │
│ (Cannon visual pred.)             │                      │
│                                   │                      │
│ emit('player_input', {            │                      │
│   playerIdx: 5,                   │                      │
│   direction: {x:0.8, z:0.2},      │                      │
│   intensity: 0.7                  │                      │
│ }) ────────────────────────────►  │                      │
│                                   │                      │
│                            Enfileira input A             │
│                                   │                      │
│                            Tick 2 (t=16ms)               │
│                            1. applyForce(p5) baseado no input
│                            2. physics.step()             │
│                            3. syncPhysicsToState()       │
│                                   │                      │
│                            Calcula nova posição:        │
│                            p5: pos=(45,0.5,20)          │
│                            velocidade: (3.2, 0, 0.8)    │
│                                   │                      │
│ ◄─────── state_update ────────────┤───► state_update ───► │
│ { players.yellow[5].pos = ... }   │                      │
│                                   │                      │
│ Interpola visualmente             │                      │
│ Renderiza novo frame              │ Interpola e renderiza│
│ p5 estava em (43, 0.5, 19.5)      │ nova posição        │
│ Lerp para (45, 0.5, 20) em 16ms   │                      │
│                                   │                      │
│ [ainda é meu turno]               │ Tick 3 (t=32ms)      │
│                                   │ Nenhum input de B    │
│ Pode arrastar outra peça          │ Física continua      │
│ emit('player_input', playerIdx=3) │                      │
│ ───────────────────────────────►  │                      │
│                                   │ [p5 desacelera]      │
│                                   │                      │
│ ◄────── state_update ─────────────┤───► state_update ───► │
│ p5: vel=(-0.2, 0, ...)            │ p5: vel=(...)       │
│ p3: vel=(2.1, 0, 0.5)             │                      │
│                                   │                      │
│ [4 toques amarelo completados]    │ Tick 4 (t=48ms)      │
│ Física resolve                    │ Detecta: touches >= 4
│ p3 bate na bola                   │ → troca posse        │
│                                   │                      │
│ ◄────── state_update ─────────────┤───► state_update ───► │
│ { possession: 'blue', touches: 0 }│ possession: 'blue'  │
│ canInteract.yellow = false        │ Agora PODE dragBlue │
│ canInteract.blue = true           │                      │
│                                   │                      │
│ [bloqueado, não pode drag]        │ Aguarda input de B   │
│ Vê Azul com posse                 │                      │
```

### Fluxo 2: Gol

```
┌────────────────────────────────────────────────────┐
│ CLIENTE A              SERVIDOR          CLIENTE B  │
│      │                    │                   │     │
│      │ Chuta (input)      │                   │     │
│      ├──────────────────►│                   │     │
│      │                    │ physics.step()    │     │
│      │                    │ Ball entra no gol │     │
│      │                    │                   │     │
│      │                    │ isGoal() = true   │     │
│      │                    │                   │     │
│      │                    │ scores.yellow++   │     │
│      │                    │ Reset formação    │     │
│      │                    │ possession=blue   │     │
│      │                    │ ballDead=false    │     │
│      │                    │                   │     │
│ ◄────────── state_update ─┤─── state_update ───► │
│ { scores: {y:1, b:0}  }   │                   │
│ { possession: 'blue' }    │                   │
│ { players reset }         │                   │
│ { canInteract.yellow=false, .blue=true }     │
│                           │                   │
│ Renderiza celebração      │                   │ Renderiza reposição
│ (animação de gol)         │                   │                    │
│ Exibe: "Gol! Azul sai"    │                   │ "Seu turno!"      │
```

---

## Modelos de Dados

### Payload: Player Input
Cliente envia quando usuário arrasta peça.

```javascript
{
  playerIdx: number,          // 0-10 ou 11-21 (índice no array)
  directionX: number,         // -1.0 a 1.0
  directionZ: number,         // -1.0 a 1.0
  intensity: number,          // 0.0 a 1.0 (força do chute)
  timestamp: number           // quando enviou (para detecção de lag)
}
```

### Payload: State Update (Servidor → Clientes)
Enviado a cada tick (60x por segundo).

```javascript
{
  timestamp: number,          // quando foi calculado
  tick: number,               // número do tick
  
  // Placar
  scores: {
    yellow: number,
    blue: number
  },
  
  // Posse
  possession: 'yellow' | 'blue',
  touches: number,
  
  // Relógio
  half: 1 | 2,
  timeLeft: number,
  
  // Posições de todos os jogadores
  players: {
    yellow: [
      {
        idx: number,
        pos: { x, y, z },
        vel: { x, y, z },
        quat: { x, y, z, w }
      },
      // ... 11 jogadores
    ],
    blue: [ ... ]  // mesma estrutura
  },
  
  // Bola
  ball: {
    pos: { x, y, z },
    vel: { x, y, z },
    quat: { x, y, z, w }
  },
  
  // Permissões de interação (por time)
  canInteract: {
    yellow: boolean,
    blue: boolean
  },
  
  // Status especiais
  gameStatus: 'playing' | 'goal' | 'throw_in' | 'corner' | 'goal_kick' | 'half_time' | 'match_end'
}
```

### Payload: Game Config
Criador da sala define.

```javascript
{
  gameMode: 'button_football' | 'society_fut7' | 'showbol',
  yellowTeam: string,  // nome do time
  blueTeam: string,
  matchDuration: number,  // segundos
  difficulty: 'easy' | 'normal' | 'hard'
}
```

---

## Eventos Socket.io

### Ciclo Completo

| **Evento** | **Direção** | **Payload** | **Descrição** |
|---|---|---|---|
| `create_room` | Cliente → Servidor | `{ gameConfig }` | Criar sala |
| `room_created` | Servidor → Cliente | `{ roomCode, config }` | Sala criada |
| `join_room` | Cliente → Servidor | `{ roomCode }` | Entrar em sala |
| `room_ready` | Servidor → 2 Clientes | `{ myTeam, roomCode, config }` | Jogo começando |
| `player_input` | Cliente → Servidor | `{ playerIdx, directionX, directionZ, intensity, timestamp }` | Intenção do jogador |
| `state_update` | Servidor → 2 Clientes | `{ tick, scores, players, ball, canInteract, ... }` | **Enviado 60x/seg** |
| `opponent_disconnected` | Servidor → Cliente | — | Oponente saiu |
| `error` | Servidor → Cliente | `{ message }` | Erro |

### Frequência de Envio
- `player_input`: Conforme usuário interage (pode ser 0 a N/s)
- `state_update`: **60 vezes por segundo** (16ms de intervalo)
- `room_created`: Uma vez
- `room_ready`: Uma vez
- `opponent_disconnected`: Uma vez (se desconectar)

---

## Estado do Jogo (Servidor)

### Estrutura Completa

```javascript
gameState = {
  // Identidade
  roomCode: 'ABCD',
  yellowSocketId: 'xyz...',
  blueSocketId: 'abc...',
  
  // Placar
  scores: { yellow: 0, blue: 0 },
  
  // Posse
  possession: 'yellow' | 'blue',
  touches: 0,              // toques no turno atual
  lastTouchTeam: null,     // qual time tocou por último
  
  // Relógio
  half: 1 | 2,
  timeLeft: 600,           // segundos
  matchEnded: false,
  paused: false,
  
  // Estado da bola
  ballDead: boolean,       // fora do campo?
  
  // Reinício
  restartPending: null | {
    team: 'yellow' | 'blue',
    type: 'throw_in' | 'corner' | 'goal_kick',
    position: { x, z }
  },
  
  // Chute em resolução
  locked: boolean,         // física ainda resolvendo?
  lastShotTime: number,    // timestamp do último chute
  
  // Formação
  players: {
    yellow: [
      { idx: 0, position: {x,y,z}, velocity: {x,y,z}, physBody: Cannon.Body, ...},
      // ... 11 jogadores
    ],
    blue: [ ... ]
  },
  ball: { position: {x,y,z}, velocity: {x,y,z}, physBody: Cannon.Body },
  
  // Physics world
  physics: CANNON.World
};
```

---

## Tick Loop do Servidor

### Pseudocódigo Detalhado

```javascript
const TICK_RATE = 60; // Hz
const TICK_DELTA = 1 / TICK_RATE; // 0.0167s
let lastTickTime = Date.now();

setInterval(() => {
  const now = Date.now();
  const deltaTime = (now - lastTickTime) / 1000;
  lastTickTime = now;
  
  for (const [roomCode, room] of Object.entries(rooms)) {
    tick(room, deltaTime);
  }
}, 1000 / TICK_RATE); // ~16ms

function tick(room, deltaTime) {
  // =========== FASE 1: INPUT ===========
  // Coleta inputs que chegaram desde último tick
  // (clientes enviam quando arrastam, servidor buffer em queue)
  
  const yellowInput = room.inputQueue.yellow;
  const blueInput = room.inputQueue.blue;
  
  // =========== FASE 2: VALIDAÇÃO ===========
  // Valida cada input
  
  if (yellowInput && validateInput(room, 'yellow', yellowInput)) {
    applyForce(room, 'yellow', yellowInput);
  }
  
  if (blueInput && validateInput(room, 'blue', blueInput)) {
    applyForce(room, 'blue', blueInput);
  }
  
  // =========== FASE 3: FÍSICA ===========
  // Executa 1 step da física
  
  room.physics.step(TICK_DELTA);
  
  // Sincroniza Cannon bodies → state
  syncPhysicsToState(room);
  
  // =========== FASE 4: EVENTOS DE JOGO ===========
  // Verifica se algo especial aconteceu
  
  if (checkGoal(room)) {
    handleGoal(room);
  } else if (checkThrowIn(room)) {
    handleThrowIn(room);
  } else if (checkCorner(room)) {
    handleCorner(room);
  } else if (checkFoul(room)) {
    handleFoul(room);
  }
  
  // =========== FASE 5: POSSE ===========
  // Atualiza turno se necessário
  
  if (room.gameState.touches >= room.gameState.maxTouches) {
    changePossession(room);
  }
  
  // =========== FASE 6: RELÓGIO ===========
  // Atualiza tempo
  
  if (!room.gameState.paused) {
    room.gameState.timeLeft -= deltaTime;
    
    if (room.gameState.timeLeft <= 0) {
      if (room.gameState.half === 1) {
        room.gameState.half = 2;
        room.gameState.timeLeft = 600;
        room.gameState.paused = true; // Intervalo
      } else {
        room.gameState.matchEnded = true;
      }
    }
  }
  
  // =========== FASE 7: BROADCAST ===========
  // Envia estado atualizado para ambos clientes
  
  const statePayload = serializeState(room);
  
  room.yellowSocket.emit('state_update', statePayload);
  room.blueSocket.emit('state_update', statePayload);
  
  // =========== FASE 8: LIMPEZA ===========
  // Limpa inputs processados
  
  room.inputQueue.yellow = null;
  room.inputQueue.blue = null;
}

function validateInput(room, team, input) {
  // Valida se o input é legal
  
  // 1. É a vez desse time?
  if (room.gameState.possession !== team) {
    return false;
  }
  
  // 2. Jogo não está travado?
  if (room.gameState.locked) {
    return false;
  }
  
  // 3. Bola não está morta?
  if (room.gameState.ballDead && room.gameState.restartPending.team !== team) {
    return false;
  }
  
  // 4. Peça existe?
  const player = room.gameState.players[team][input.playerIdx];
  if (!player) {
    return false;
  }
  
  // 5. Timing: input não é muito antigo (>100ms)?
  if (Date.now() - input.timestamp > 100) {
    return false; // Muito atrasado, ignora
  }
  
  return true;
}

function applyForce(room, team, input) {
  const player = room.gameState.players[team][input.playerIdx];
  
  const intensity = Math.max(0, Math.min(input.intensity, 1.0)); // Clamp 0-1
  const forceMagnitude = intensity * MAX_IMPULSE; // e.g., 100 N·s
  
  const direction = new CANNON.Vec3(
    input.directionX,
    0,  // Nenhuma força vertical
    input.directionZ
  );
  direction.normalize();
  direction.scale(forceMagnitude, direction);
  
  player.physBody.applyImpulse(
    direction,
    player.physBody.position
  );
}

function syncPhysicsToState(room) {
  // Copia posições/velocidades de Cannon bodies → state
  
  for (const player of room.gameState.players.yellow) {
    player.position.copy(player.physBody.position);
    player.velocity.copy(player.physBody.velocity);
    player.quaternion.copy(player.physBody.quaternion);
  }
  
  for (const player of room.gameState.players.blue) {
    player.position.copy(player.physBody.position);
    player.velocity.copy(player.physBody.velocity);
    player.quaternion.copy(player.physBody.quaternion);
  }
  
  room.gameState.ball.position.copy(room.gameState.ball.physBody.position);
  room.gameState.ball.velocity.copy(room.gameState.ball.physBody.velocity);
}

function serializeState(room) {
  return {
    timestamp: Date.now(),
    tick: room.tickCounter++,
    scores: room.gameState.scores,
    possession: room.gameState.possession,
    touches: room.gameState.touches,
    half: room.gameState.half,
    timeLeft: Math.max(0, Math.floor(room.gameState.timeLeft)),
    
    players: {
      yellow: room.gameState.players.yellow.map(p => ({
        idx: p.idx,
        pos: { x: p.position.x, y: p.position.y, z: p.position.z },
        vel: { x: p.velocity.x, y: p.velocity.y, z: p.velocity.z },
        quat: { x: p.quaternion.x, y: p.quaternion.y, z: p.quaternion.z, w: p.quaternion.w }
      })),
      blue: room.gameState.players.blue.map(p => ({...}))
    },
    
    ball: {
      pos: { x: room.gameState.ball.position.x, y: room.gameState.ball.position.y, z: room.gameState.ball.position.z },
      vel: { x: room.gameState.ball.velocity.x, y: room.gameState.ball.velocity.y, z: room.gameState.ball.velocity.z }
    },
    
    canInteract: {
      yellow: room.gameState.possession === 'yellow' && !room.gameState.locked,
      blue: room.gameState.possession === 'blue' && !room.gameState.locked
    },
    
    gameStatus: determineGameStatus(room),
    
    ballDead: room.gameState.ballDead,
    restartPending: room.gameState.restartPending
  };
}

function changePossession(room) {
  room.gameState.possession = room.gameState.possession === 'yellow' ? 'blue' : 'yellow';
  room.gameState.touches = 0;
  room.gameState.lastTouchTeam = null;
}
```

---

## Validação e Segurança

### 1. Validação de Input
O servidor **nunca confia** no cliente. Cada input é validado:

```javascript
✓ É a vez desse time?
✓ Peça existe?
✓ Time da peça é o correto?
✓ Jogo não está pausado/finalizado?
✓ Input não é muito antigo (>100ms)?
✓ Direção é normalizada (não é exploit)?
✓ Intensidade está em [0, 1]?
```

### 2. Detecção de Cheats
Se input inválido é detectado, opções:
- **Ignorar silenciosamente** (não emite erro, apenas rejeita)
- **Desconectar** (se muitos inputs inválidos seguidos)
- **Log** (servidor registra tentativa suspeita)

```javascript
const MAX_INVALID_INPUTS = 5;
if (invalidInputCount[team] > MAX_INVALID_INPUTS) {
  room.kickPlayer(team, 'Too many invalid inputs');
}
```

### 3. Rate Limiting
Máximo de inputs por segundo (anti-spam):

```javascript
const MAX_INPUTS_PER_SECOND = 60; // Um por frame
if (inputTimestamps[team].filter(t => Date.now() - t < 1000).length > MAX_INPUTS_PER_SECOND) {
  return false; // Input rejeitado
}
```

### 4. Sanidade de Estado
Servidor verifica se estado está coerente:

```javascript
// Nenhum jogador pode estar fora do campo (muito)
for (const player of allPlayers) {
  if (Math.abs(player.position.x) > FIELD_WIDTH + 10) {
    console.error('Player out of bounds, teleporting');
    player.position.x = Math.sign(player.position.x) * (FIELD_WIDTH + 1);
    player.physBody.position.copy(player.position);
  }
}
```

---

## Interface do Usuário

### 1. Menu de Entrada

```
┌────────────────────────────────────┐
│      GULLIVER FUTEBOL DE BOTÃO    │
├────────────────────────────────────┤
│                                    │
│   [ Jogar Local ]  [ Jogar Online] │
│                                    │
└────────────────────────────────────┘
```

### 2. Lobby Online

```
┌────────────────────────────────────┐
│  JOGAR ONLINE                      │
├────────────────────────────────────┤
│                                    │
│  ● Criar Sala                      │
│                                    │
│  ┌──────────────────────────────┐ │
│  │ Modo:      [Button Football] │ │
│  │ Amarelo:   [Flamengo       ] │ │
│  │ Azul:      [Palmeiras      ] │ │
│  │ Duração:   [10 min         ] │ │
│  │                              │ │
│  │  [ Criar Sala ]              │ │
│  └──────────────────────────────┘ │
│                                    │
│  ─ OU ─                            │
│                                    │
│  ○ Entrar em Sala                  │
│                                    │
│  Código: [________]                │
│  [ Entrar ]                        │
│                                    │
│  [ Cancelar ]                      │
│                                    │
└────────────────────────────────────┘
```

### 3. Sala de Espera

```
┌──────────────────────────────┐
│ SALA CRIADA                  │
├──────────────────────────────┤
│                              │
│ Código: ABCD                 │
│ [Copiar]                     │
│                              │
│ Compartilhe este código      │
│ com seu oponente             │
│                              │
│ Aguardando...                │
│ ⏳ 0:45s                      │
│                              │
│ [ Cancelar ]                 │
│                              │
└──────────────────────────────┘
```

### 4. Durante o Jogo

```
┌──────────────────────────────────────────────────┐
│ 🟡 0 × 0 🔵  │ 1T 05:00 │ Posse: 🟡  │ Ping: 45ms │
└──────────────────────────────────────────────────┘
```

**Indicadores:**
- **Ping**: Latência em tempo real
- **Posse**: Qual time tem a bola
- **Status**: "Aguardando..." se input foi enviado

### 5. Indicador de Input Pendente

Enquanto usuário arrasta (feedback visual):

```
┌─ Visualização ─────────────┐
│                            │
│  🎮 [Dragging] [★★★★☆]    │  ← Barra de força
│  Intensidade: 70%          │
│  Direção: NE               │
│                            │
│  [Soltar para chutar]      │
│                            │
└────────────────────────────┘
```

### 6. Desconexão

```
┌──────────────────────────────┐
│ OPONENTE DESCONECTOU         │
├──────────────────────────────┤
│                              │
│ Aguardando reconexão...      │
│ ⏳ 0:15s                      │
│                              │
│ [ Aguardar ]  [ Menu ]       │
│                              │
└──────────────────────────────┘
```

---

## Tratamento de Erros

### 1. Desconexão de Rede

**Cenário:** Cliente perde conexão durante jogo

**Ação:**
- Socket.io reconecta automaticamente (5 tentativas)
- Se reconectar em < 5s: servidor envia último `state_update`, jogo continua
- Se reconectar em > 5s: cliente desconectado, oponente notificado
- Servidor limpa sala após 10s (oponente pode sair se quiser)

```javascript
socket.on('disconnect', () => {
  room.clientDisconnectTime[socket.id] = Date.now();
  
  setTimeout(() => {
    if (!socket.connected) {
      room.kickPlayer(socket.id, 'Disconnected too long');
      room.notifyOther(socket.id, 'opponent_disconnected');
    }
  }, 10000);
});

socket.on('reconnect', () => {
  room.clientDisconnectTime[socket.id] = null;
  // Envia último estado
  socket.emit('state_update', lastGameState);
});
```

### 2. Input Perdido
Se client envia input mas nunca chega ao servidor:

**Ação:**
- Timeout: Se servidor não receber nenhum input em 5s, servidor assume que cliente não quer fazer nada
- Cliente continua vendo estado, mas não pode interagir até reconectar

### 3. Servidor Overload

Se tick leva > 16ms (não consegue fazer 60 FPS):

**Ação:**
- Reduz taxa de broadcast (envia a cada 2 ticks = 30 FPS)
- Log de aviso
- Clientes interpolam para manter suavidade

```javascript
if (tickDuration > 20) {
  console.warn('Tick duration exceeded:', tickDuration);
  broadcastSkipCount = 2; // Envia a cada 2 ticks
}
```

### 4. Divergência Extrema

Se cliente vê posição muito diferente do servidor:

**Ação:**
- Cliente corrige instantaneamente para posição do servidor
- Pode causar "teleporte" visual, mas estado é correto

---

## Testes

### Testes Unitários (Servidor)

```javascript
describe('GameRoom tick()', () => {
  test('validateInput rejeita input de time sem posse', () => {
    room.gameState.possession = 'yellow';
    const input = { team: 'blue', playerIdx: 0, intensity: 0.5 };
    expect(room.validateInput('blue', input)).toBe(false);
  });

  test('applyForce aplica impulso corretamente', () => {
    const player = room.gameState.players.yellow[5];
    const initialVel = player.velocity.clone();
    room.applyForce('yellow', { playerIdx: 5, directionX: 1, directionZ: 0, intensity: 0.8 });
    room.physics.step(1/60);
    expect(player.velocity.length()).toBeGreaterThan(initialVel.length());
  });

  test('touches aumenta a cada chute válido', () => {
    room.gameState.possession = 'yellow';
    expect(room.gameState.touches).toBe(0);
    room.applyForce('yellow', {...});
    room.physics.step(1/60);
    room.syncPhysicsToState();
    // Simula detecção de toque
    expect(room.gameState.touches).toBeGreaterThan(0);
  });

  test('changePossession inverte posse e reseta toques', () => {
    room.gameState.possession = 'yellow';
    room.gameState.touches = 4;
    room.changePossession();
    expect(room.gameState.possession).toBe('blue');
    expect(room.gameState.touches).toBe(0);
  });
});
```

### Testes de Integração (E2E)

**Setup:** Dois clientes locais, servidor local

```javascript
describe('Full Game Flow', () => {
  test('Dois clientes conectam e recebem room_ready', async () => {
    const client1 = io('http://localhost:3000');
    const client2 = io('http://localhost:3000');
    
    client1.emit('create_room', { gameConfig: {...} });
    const roomCode = await new Promise(resolve => client1.once('room_created', (data) => resolve(data.roomCode)));
    
    client2.emit('join_room', roomCode);
    
    const ready1 = new Promise(resolve => client1.once('room_ready', resolve));
    const ready2 = new Promise(resolve => client2.once('room_ready', resolve));
    
    const [data1, data2] = await Promise.all([ready1, ready2]);
    
    expect(data1.myTeam).toBe('yellow');
    expect(data2.myTeam).toBe('blue');
  });

  test('Cliente A chuta e Cliente B recebe state_update', async () => {
    // ... setup salas conectadas ...
    
    clientA.emit('player_input', {
      playerIdx: 5,
      directionX: 1,
      directionZ: 0,
      intensity: 0.8,
      timestamp: Date.now()
    });
    
    const stateA = await new Promise(resolve => clientA.once('state_update', resolve));
    const stateB = await new Promise(resolve => clientB.once('state_update', resolve));
    
    // Ambos devem ter mesmo estado
    expect(stateA.players.yellow[5].pos).toEqual(stateB.players.yellow[5].pos);
    expect(stateA.tick).toBe(stateB.tick);
  });

  test('Gol é sincronizado em ambos clientes', async () => {
    // ... setup, mover bola para gol ...
    
    // Espera até que um client detecte gol
    let goalDetected = false;
    const onStateA = (state) => {
      if (state.gameStatus === 'goal') goalDetected = true;
    };
    clientA.on('state_update', onStateA);
    
    // Aguarda até gol
    await new Promise(resolve => {
      const checkInterval = setInterval(() => {
        if (goalDetected) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
      setTimeout(() => clearInterval(checkInterval), 10000); // Timeout 10s
    });
    
    expect(goalDetected).toBe(true);
  });
});
```

### Testes de Carga

```javascript
describe('Load Testing', () => {
  test('Servidor suporta 10 salas simultâneas com 60 FPS', async () => {
    const rooms = [];
    for (let i = 0; i < 10; i++) {
      const c1 = io('http://localhost:3000');
      const c2 = io('http://localhost:3000');
      c1.emit('create_room', {...});
      const code = await new Promise(resolve => c1.once('room_created', d => resolve(d.roomCode)));
      c2.emit('join_room', code);
      rooms.push({ c1, c2 });
    }
    
    // Medir tempo de ticks
    const tickTimes = [];
    const listener = (state) => {
      // Cada state_update é um tick
      tickTimes.push(state.tick);
    };
    
    rooms.forEach(r => r.c1.on('state_update', listener));
    
    await new Promise(resolve => setTimeout(resolve, 5000)); // 5 segundos
    
    // Deve ter ~300 ticks (60 FPS × 5s)
    expect(tickTimes.length).toBeGreaterThan(250);
  });
});
```

---

## Implantação

### Stack
- **Backend**: Node.js 18+ + Express + Socket.io + Cannon.js
- **Frontend**: Vanilla JS + Three.js (sem bundler)
- **Database**: Opcional (Redis para sessões, PostgreSQL para histórico)
- **Hosting**: Render, Railway, Fly.io, ou próprio VPS

### Arquivo `package.json`

```json
{
  "name": "gulliver-multiplayer-server",
  "version": "1.0.0",
  "description": "Servidor autoritário para Gulliver Futebol de Botão",
  "main": "server.js",
  "dependencies": {
    "express": "^4.18.0",
    "socket.io": "^4.7.5",
    "cannon-es": "^0.20.0"
  },
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  }
}
```

### Variáveis de Ambiente

```bash
# .env
NODE_ENV=production
PORT=3000
CORS_ORIGIN=https://seu-dominio.com
TICK_RATE=60
ROOM_TIMEOUT=300000
LOG_LEVEL=info
```

### Deploy Checklist

- [ ] Servidor roda com `npm start`
- [ ] Socket.io funciona em WSS (WebSocket Secure)
- [ ] CORS configurado corretamente
- [ ] Rooms com timeout automático
- [ ] Logs estruturados (erro, aviso, info)
- [ ] Health check: `GET /health` → `{ status: 'ok', rooms: N, uptime: Ns }`
- [ ] Rate limiting por IP
- [ ] Monitoramento de CPU/memória
- [ ] Graceful shutdown (fecha salas antes de desligar)

### Monitoramento

```javascript
// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    rooms: Object.keys(rooms).length,
    memory: process.memoryUsage(),
    timestamp: Date.now()
  });
});

// Logs estruturados
const logger = {
  error: (msg, data) => console.error(`[ERROR] ${msg}`, data),
  warn: (msg, data) => console.warn(`[WARN] ${msg}`, data),
  info: (msg, data) => console.log(`[INFO] ${msg}`, data)
};

logger.info('Room created', { roomCode, yellowId: socket.id });
logger.error('Invalid input', { team, playerIdx, reason });
```

---

## Resumo: Comparação Arquiteturas

| Aspecto | **Cliente Autoritário (v1)** | **Servidor Autoritário (v2)** |
|--------|-----|-----|
| **Autoridade** | Cliente com posse | Servidor sempre |
| **Física** | Roda em ambos clientes (determinismo) | Roda 1x no servidor |
| **Latência** | Baixa durante chute | Aguarda resposta do servidor |
| **Sincronização** | Complexa (divergências) | Simples (estado = verdade) |
| **Segurança** | Vulnerável (cliente executa lógica) | Segura (servidor valida tudo) |
| **Banda** | Baixa (só chutes + sincronização) | Alta (estado completo 60x/s) |
| **Escalabilidade** | Difícil (cada dupla é independente) | Fácil (1 servidor central) |
| **Espectadores** | Impossível | Trivial (enviar estado para N clientes) |

**Recomendação:** Usar arquitetura **v2 (Servidor Autoritário)** para primeira versão. É mais segura, escalável e simples de debugar.

---

**Documento finalizado. Pronto para implementação.**

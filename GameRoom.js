/**
 * GameRoom.js
 * Encapsula o estado de uma sala de jogo multiplayer
 * Responsável por: estado, fila de inputs, física, tick loop
 */

import * as CANNON from 'cannon-es';

// ============================================
// CONSTANTES
// ============================================
const TICK_RATE = 60; // Hz
const TICK_DELTA = 1 / TICK_RATE; // 0.0167s
const MAX_IMPULSE = 100; // Newton·segundo

// Dimensões do campo (escalado em metros)
const FIELD_WIDTH = 105;
const FIELD_HEIGHT = 68;
const BALL_RADIUS = 0.5;
const PLAYER_RADIUS = 2.0;
const PLAYER_MASS = 4;
const BALL_MASS = 0.15;

// ============================================
// FORMAÇÕES (same as client-side formations.js)
// ============================================
function getInitialFormation(team) {
  // Standard Futebol de Botão — 4-3-3, 11 jogadores por time
  const yellowFormation = [
    { x: 102.2, z: 0 }, // Goleiro
    // Defensores (4)
    { x: 72.8, z: -42 }, { x: 72.8, z: -14 }, { x: 72.8, z: 14 }, { x: 72.8, z: 42 },
    // Meias (3)
    { x: 43.4, z: -22.4 }, { x: 43.4, z: 0 }, { x: 43.4, z: 22.4 },
    // Atacantes (3)
    { x: 12.6, z: -16.8 }, { x: 12.6, z: 16.8 }, { x: 26.6, z: 0 },
  ];

  const blueFormation = yellowFormation.map(pos => ({ x: -pos.x, z: pos.z }));

  return team === 'yellow' ? yellowFormation : blueFormation;
}

export class GameRoom {
  constructor(roomCode, config) {
    this.roomCode = roomCode;
    this.config = config;
    this.yellowSocketId = null;
    this.blueSocketId = null;

    // ==========================================
    // ESTADO DO JOGO
    // ==========================================
    this.gameState = {
      // Placar
      scores: { yellow: 0, blue: 0 },

      // Posse
      possession: 'yellow', // Time que tem a bola
      touches: 0, // Quantos toques no turno atual
      maxTouches: 4, // Toques máximos antes de trocar posse
      lastTouchTeam: null, // Qual time tocou por último

      // Relógio
      half: 1, // Tempo 1 ou 2
      timeLeft: 600, // Segundos (10 minutos = 600s)

      // Estado do jogo
      locked: false, // Chute resolvendo?
      ballDead: false, // Bola fora do campo?
      restartPending: null, // Reinício aguardando?
      gameStatus: 'playing', // 'playing', 'goal', 'throw_in', 'corner', 'goal_kick'
      matchEnded: false,

      // Física (será inicializado no Passo 6)
      players: {
        yellow: [],
        blue: []
      },
      ball: null,
      physics: null
    };

    // ==========================================
    // FILA DE INPUTS
    // ==========================================
    this.inputQueue = {
      yellow: null,
      blue: null
    };

    // ==========================================
    // CONTROLE DO LOOP
    // ==========================================
    this.tickCounter = 0;
    this.lastTickTime = Date.now();
    this.isRunning = false;
    this.tickInterval = null;

    console.log(`[GameRoom] ${roomCode} criada`);
  }

  // ==========================================
  // MÉTODOS PÚBLICOS
  // ==========================================

  /**
   * Iniciar a sala (começar tick loop)
   * Passos 6-11: Inicializar física e loop
   */
  start(io) {
    if (this.isRunning) {
      console.warn(`[GameRoom] ${this.roomCode} já está rodando`);
      return;
    }

    console.log(`[GameRoom] ${this.roomCode} iniciada`);
    this.isRunning = true;
    this.lastTickTime = Date.now();
    this.io = io; // Guardar referência do Socket.io

    try {
      // PASSO 6: Inicializar Cannon.js
      console.log(`[GameRoom] ${this.roomCode} - Inicializando física...`);
      this.initializePhysics();

      // PASSO 11: Iniciar tick loop
      console.log(`[GameRoom] ${this.roomCode} - Iniciando tick loop...`);
      this.startTickLoop();
    } catch (error) {
      console.error(`[GameRoom] ${this.roomCode} - ERRO:`, error);
      this.isRunning = false;
    }
  }

  /**
   * Criar o piso (floor) - CRÍTICO para a bola não cair infinitamente!
   * Usando Box MUITO grande e MUITO fino (Plane tem bug com Spheres)
   */
  _buildFloor() {
    const floorHalfX = 500;  // Muito grande em X
    const floorHalfZ = 500;  // Muito grande em Z
    const floorHalfH = 0.5;  // Muito fino em Y

    const floor = new CANNON.Body({ mass: 0, material: this.matFloor });
    const floorShape = new CANNON.Box(new CANNON.Vec3(floorHalfX, floorHalfH, floorHalfZ));
    floor.addShape(floorShape);
    floor.updateMassProperties();  // Recalcular propriedades após adicionar forma

    // Posiciona o topo da caixa em y=0 (o centro fica em -floorHalfH)
    floor.position.set(0, -floorHalfH, 0);

    // Collision mask: apenas a bola pode colidir com o piso
    floor.collisionFilterGroup = 8;  // GROUP.BALL_WALL
    floor.collisionFilterMask = 2;   // GROUP.BALL
    this.gameState.physics.addBody(floor);

    // Adicionar listener de colisão no floor também (para debug)
    floor.addEventListener('collide', (e) => {
      console.log(`[Floor Collision] Colidiu com body group=${e.body.collisionFilterGroup}`);
      if (e.body.collisionFilterGroup === 2) {
        console.log(`[Floor Collision] ✅ BALL HIT FLOOR!`);
      }
    });

    console.log(`[Physics] Floor criado (BOX gigante): pos=${floor.position.y}, size=(${2*floorHalfX}x${2*floorHalfH}x${2*floorHalfZ}), groups: ${floor.collisionFilterGroup}, mask: ${floor.collisionFilterMask}`);
  }

  /**
   * Aplicar física EXATAMENTE como o cliente (physics.js)
   * CRÍTICO: Chamar physics.step múltiplas vezes por tick!
   */
  _applyPhysicsStep() {
    const PHYS = {
      SPHERE_GRAVITY: -45,
      CUBE_GRAVITY: -45,
      BALL_GROUND_DAMPING: 0.82,
      BALL_LIN_DAMPING: 0.2,
      BALL_ANG_DAMPING: 0.15,
      FIXED_DT: 1 / 240,  // ← CRÍTICO: 1/240, não outro valor!
    };

    // Aplicar gravidade UMA ÚNICA VEZ antes do loop (não 4x!)
    const ball = this.gameState.ball;
    if (ball && ball.physBody) {
      const gravity = PHYS.SPHERE_GRAVITY;  // ou CUBE_GRAVITY se for cubo
      ball.physBody.force.y += ball.physBody.mass * gravity;
    }

    // Chamar physics.step MÚLTIPLAS VEZES por tick
    // Servidor roda em 60 FPS (1/60 por tick)
    // FIXED_DT = 1/240
    // Logo: 1/60 = 4 * (1/240), então precisa 4 chamadas por tick
    const SUBSTEPS = 4;

    for (let i = 0; i < SUBSTEPS; i++) {
      // Damping dinâmico baseado se está no chão ou no ar
      if (ball && ball.physBody) {
        const ballRadius = BALL_RADIUS;
        const onGround = ball.physBody.position.y <= ballRadius * 1.15;
        ball.physBody.linearDamping = onGround ? PHYS.BALL_GROUND_DAMPING : PHYS.BALL_LIN_DAMPING;
        ball.physBody.angularDamping = PHYS.BALL_ANG_DAMPING;

        // Spin calculado dinamicamente (rolling without slipping)
        const speed = Math.hypot(ball.physBody.velocity.x, ball.physBody.velocity.z);
        if (speed > 0.05) {
          const r = ballRadius;
          ball.physBody.angularVelocity.set(
            ball.physBody.velocity.z / r,
            0,
            -ball.physBody.velocity.x / r
          );
        }
      }

      // Rodar física com FIXED_DT (1/240)
      this.gameState.physics.step(PHYS.FIXED_DT);
    }
  }

  /**
   * Parar a sala
   */
  stop() {
    if (!this.isRunning) return;

    console.log(`[GameRoom] ${this.roomCode} parada`);
    this.isRunning = false;

    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  /**
   * Receber input do cliente e enfileirar para processamento
   */
  receiveInput(team, inputData) {
    if (!this.isRunning) return;

    this.inputQueue[team] = {
      ...inputData,
      receivedAt: Date.now()
    };
  }

  /**
   * Executar um tick de jogo (Passo 11)
   * 7 fases de processamento
   */
  tick(deltaTime) {
    if (!this.isRunning) return;

    // ===== FASE 1: INPUT =====
    const yellowInput = this.inputQueue.yellow;
    const blueInput = this.inputQueue.blue;

    // ===== FASE 2: VALIDAÇÃO E APLICAÇÃO (Passo 10) =====
    if (yellowInput && this.validateInput('yellow', yellowInput)) {
      this.applyForceToPlayer('yellow', yellowInput);
    }

    if (blueInput && this.validateInput('blue', blueInput)) {
      this.applyForceToPlayer('blue', blueInput);
    }

    // ===== FASE 3: FÍSICA =====
    // Aplicar física EXATAMENTE como o cliente (physics.js step())
    this._applyPhysicsStep();

    // Debug: Log ball position every 10 ticks
    if (this.tickCounter % 10 === 0) {
      const ballY = this.gameState.ball.physBody.position.y;
      const ballVelY = this.gameState.ball.physBody.velocity.y;
      const onGround = ballY <= BALL_RADIUS * 1.15;
      console.log(`[Ball] tick=${this.tickCounter}, y=${ballY.toFixed(2)}, velY=${ballVelY.toFixed(3)}, onGround=${onGround}`);

      // Quando a bola passa por y=0 (floor top), verificar colisão
      if (ballY < 0 && this.tickCounter < 100) {
        console.warn(`[Ball] ⚠️ Ball at y=${ballY.toFixed(2)} but NO COLLISION! Should have hit floor at y=0!`);
        console.warn(`[Ball] Floor is at y=-0.5 (position), extends to y=0 (top surface)`);
      }
    }

    // ===== FASE 4: SINCRONIZAR (Passo 9) =====
    this.syncPhysicsToState();

    // ===== FASE 5: DETECTAR EVENTOS (Passos 13-18) =====
    this.checkGameEvents();

    // ===== FASE 6: ATUALIZAR RELÓGIO =====
    if (!this.gameState.matchEnded) {
      this.gameState.timeLeft -= deltaTime;

      if (this.gameState.timeLeft <= 0) {
        if (this.gameState.half === 1) {
          this.gameState.half = 2;
          this.gameState.timeLeft = 600;
          console.log(`[GameRoom] ${this.roomCode} - Intervalo`);
        } else {
          this.gameState.matchEnded = true;
          console.log(`[GameRoom] ${this.roomCode} - Fim de jogo`);
        }
      }
    }

    // ===== FASE 7: LIMPEZA =====
    this.inputQueue.yellow = null;
    this.inputQueue.blue = null;
    this.tickCounter++;
  }

  /**
   * Serializar estado para enviar aos clientes
   */
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

      // Jogadores (será preenchido no Passo 12)
      players: {
        yellow: this.gameState.players.yellow.map(p => ({
          idx: p.idx || 0,
          pos: p.position ? { x: p.position.x, y: p.position.y, z: p.position.z } : { x: 0, y: 0, z: 0 },
          vel: p.velocity ? { x: p.velocity.x, y: p.velocity.y, z: p.velocity.z } : { x: 0, y: 0, z: 0 },
          quat: p.quaternion ? { x: p.quaternion.x, y: p.quaternion.y, z: p.quaternion.z, w: p.quaternion.w } : { x: 0, y: 0, z: 0, w: 1 }
        })),
        blue: this.gameState.players.blue.map(p => ({
          idx: p.idx || 0,
          pos: p.position ? { x: p.position.x, y: p.position.y, z: p.position.z } : { x: 0, y: 0, z: 0 },
          vel: p.velocity ? { x: p.velocity.x, y: p.velocity.y, z: p.velocity.z } : { x: 0, y: 0, z: 0 },
          quat: p.quaternion ? { x: p.quaternion.x, y: p.quaternion.y, z: p.quaternion.z, w: p.quaternion.w } : { x: 0, y: 0, z: 0, w: 1 }
        }))
      },

      // Bola (será preenchido no Passo 12)
      ball: this.gameState.ball
        ? {
            pos: { x: this.gameState.ball.position.x, y: this.gameState.ball.position.y, z: this.gameState.ball.position.z },
            vel: { x: this.gameState.ball.velocity.x, y: this.gameState.ball.velocity.y, z: this.gameState.ball.velocity.z },
            quat: this.gameState.ball.quaternion ? { x: this.gameState.ball.quaternion.x, y: this.gameState.ball.quaternion.y, z: this.gameState.ball.quaternion.z, w: this.gameState.ball.quaternion.w } : { x: 0, y: 0, z: 0, w: 1 }
          }
        : { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 } },

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

  /**
   * Broadcast estado para ambos clientes (Passo 12)
   */
  broadcast(io) {
    const state = this.serializeState();

    // Debug: Verificar se bola está no estado
    if (!state.ball) {
      console.warn('[Broadcast] ❌ BALL NOT IN STATE!');
    } else if (!state.ball.pos) {
      console.warn('[Broadcast] ❌ BALL HAS NO POSITION!');
    }

    const yellowSocket = io.sockets.sockets.get(this.yellowSocketId);
    const blueSocket = io.sockets.sockets.get(this.blueSocketId);

    if (yellowSocket) {
      yellowSocket.emit('state_update', state);
    }
    if (blueSocket) {
      blueSocket.emit('state_update', state);
    }
  }

  // ==========================================
  // PASSO 6: SETUP CANNON.JS
  // ==========================================
  initializePhysics() {
    console.log(`[Physics] ${this.roomCode}: Inicializando Cannon.js (CLIENT PHYSICS)`);

    // Criar mundo físico - EXATAMENTE como no cliente (physics.js)
    this.gameState.physics = new CANNON.World();
    this.gameState.physics.gravity.set(0, 0, 0);                    // Gravidade global = 0 (cliente faz assim)
    this.gameState.physics.broadphase = new CANNON.SAPBroadphase(this.gameState.physics);
    this.gameState.physics.solver.iterations = 12;                 // Mesmo do cliente
    this.gameState.physics.defaultContactMaterial.friction = 0.6;
    this.gameState.physics.defaultContactMaterial.restitution = 0.2;
    this.gameState.physics.allowSleep = false;  // Desabilitar sleep para debug

    // Criar materiais - mesmos do cliente
    const matPiece = new CANNON.Material('piece');
    const matFloor = new CANNON.Material('floor');

    // Contact materials - EXATAMENTE como no cliente
    this.gameState.physics.addContactMaterial(
      new CANNON.ContactMaterial(matPiece, matPiece, {
        friction: 0.6,
        restitution: 0.2
      })
    );

    this.gameState.physics.addContactMaterial(
      new CANNON.ContactMaterial(matPiece, matFloor, {
        friction: 2.0,
        restitution: 0.65
      })
    );

    this.matPiece = matPiece;
    this.matFloor = matFloor;

    // CRÍTICO: Criar o piso (floor) como no cliente
    // Sem isso, a bola cai infinitamente!
    this._buildFloor();

    // Criar bodies dos players e bola
    this.createBodies();

    console.log(`[Physics] ${this.roomCode}: 23 bodies criados (11+11+1) - Usando física do cliente`);
    console.log(`[Physics] Total bodies in world: ${this.gameState.physics.bodies.length}`);

    // Debug: Listar todos os bodies
    this.gameState.physics.bodies.forEach((body, idx) => {
      console.log(`  [Body ${idx}] group=${body.collisionFilterGroup}, mask=${body.collisionFilterMask}, mass=${body.mass}, pos.y=${body.position.y.toFixed(2)}`);
    });
  }

  // ==========================================
  // PASSO 7: CRIAR BODIES (Jogadores + Bola)
  // ==========================================
  createBodies() {
    const PLAYER_LIN_DAMPING = 0.72;  // Player friction (do cliente)
    const COL_H = 6;  // Altura do collider (do cliente)

    // AMARELO
    const yellowFormation = getInitialFormation('yellow');
    this.gameState.players.yellow = yellowFormation.map((pos, idx) => {
      // Players são cilindros (como no cliente physics.js)
      const shape = new CANNON.Cylinder(PLAYER_RADIUS, PLAYER_RADIUS, COL_H, 20);
      const body = new CANNON.Body({
        mass: PLAYER_MASS,
        material: this.matPiece
      });

      // Rotação do cilindro: -90° no eixo X (como no cliente)
      const shapeQuat = new CANNON.Quaternion();
      shapeQuat.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
      body.addShape(shape, new CANNON.Vec3(0, 0, 0), shapeQuat);

      body.position.set(pos.x, PLAYER_RADIUS, pos.z);
      body.fixedRotation = true;  // Players não rotam
      body.linearDamping = PLAYER_LIN_DAMPING;  // Friction da mesa (cliente)

      // Collision filters - players colidem entre si e com a bola
      body.collisionFilterGroup = 1;   // GROUP.PLAYER
      body.collisionFilterMask = 1 | 2 | 16;  // PLAYER | BALL | FAR_WALL

      this.gameState.physics.addBody(body);

      return {
        idx,
        team: 'yellow',
        physBody: body,
        position: new CANNON.Vec3(pos.x, PLAYER_RADIUS, pos.z),
        velocity: new CANNON.Vec3(0, 0, 0),
        quaternion: new CANNON.Quaternion(0, 0, 0, 1)
      };
    });

    // AZUL (espelhado)
    const blueFormation = getInitialFormation('blue');
    this.gameState.players.blue = blueFormation.map((pos, idx) => {
      const shape = new CANNON.Cylinder(PLAYER_RADIUS, PLAYER_RADIUS, COL_H, 20);
      const body = new CANNON.Body({
        mass: PLAYER_MASS,
        material: this.matPiece
      });

      const shapeQuat = new CANNON.Quaternion();
      shapeQuat.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
      body.addShape(shape, new CANNON.Vec3(0, 0, 0), shapeQuat);

      body.position.set(pos.x, PLAYER_RADIUS, pos.z);
      body.fixedRotation = true;
      body.linearDamping = PLAYER_LIN_DAMPING;

      // Collision filters
      body.collisionFilterGroup = 1;   // GROUP.PLAYER
      body.collisionFilterMask = 1 | 2 | 16;  // PLAYER | BALL | FAR_WALL

      this.gameState.physics.addBody(body);

      return {
        idx,
        team: 'blue',
        physBody: body,
        position: new CANNON.Vec3(pos.x, PLAYER_RADIUS, pos.z),
        velocity: new CANNON.Vec3(0, 0, 0),
        quaternion: new CANNON.Quaternion(0, 0, 0, 1)
      };
    });

    // BOLA
    const ballBody = new CANNON.Body({
      mass: BALL_MASS,
      material: this.matPiece,
      linearDamping: 0.2,  // Será dinâmico em step()
      angularDamping: 0.15  // Ball angular damping (do cliente)
    });
    ballBody.position.set(0, BALL_RADIUS, 0);
    ballBody.isBall = true;  // Flag para identif. a bola em step()

    // Collision filters - bola pode colidir com tudo
    ballBody.collisionFilterGroup = 2;   // GROUP.BALL
    ballBody.collisionFilterMask = 1 | 2 | 8 | 16;  // PLAYER | BALL | BALL_WALL | FAR_WALL

    console.log(`[Physics] Ball criado: pos=${ballBody.position.y}, mass=${ballBody.mass}, groups: ${ballBody.collisionFilterGroup}, mask: ${ballBody.collisionFilterMask}`);

    // Listener de colisão: quando bola bate em jogador, adiciona upward impulse
    ballBody.addEventListener('collide', (e) => {
      console.log(`[Collision] Ball hit: ${e.body.id}, filterGroup: ${e.body.collisionFilterGroup}`);
      if (e.body.collisionFilterGroup === 8) {
        // Colidiu com BALL_WALL (floor)
        console.log(`[Collision] ✅ Ball hit FLOOR!`);
      } else if (e.body.collisionFilterGroup === 1) {
        // Colidiu com PLAYER
        const impact = Math.abs(e.contact.getImpactVelocityAlongNormal());
        ballBody.velocity.y += Math.min(impact, 25) * 0.55;  // Hop effect (do cliente)
        console.log(`[Collision] Ball hit PLAYER, hop +${Math.min(impact, 25) * 0.55}`);
      }
    });

    this.gameState.physics.addBody(ballBody);

    this.gameState.ball = {
      physBody: ballBody,
      position: new CANNON.Vec3(0, BALL_RADIUS, 0),
      velocity: new CANNON.Vec3(0, 0, 0),
      quaternion: new CANNON.Quaternion(0, 0, 0, 1)
    };
  }

  // ==========================================
  // PASSO 8: APLICAR IMPULSO
  // ==========================================
  applyForceToPlayer(team, inputData) {
    const player = this.gameState.players[team][inputData.playerIdx];

    if (!player) {
      console.warn(`[Force] Player não encontrado: ${team}-${inputData.playerIdx}`);
      return;
    }

    // Clamp intensity
    const intensity = Math.max(0, Math.min(inputData.intensity, 1.0));
    const forceMagnitude = intensity * MAX_IMPULSE;

    // Normalizar direção
    const direction = new CANNON.Vec3(inputData.directionX, 0, inputData.directionZ);
    direction.normalize();
    direction.scale(forceMagnitude, direction);

    // Aplicar impulso
    player.physBody.applyImpulse(direction, player.physBody.position);

    // Log
    // console.log(`[Force] ${team}-${inputData.playerIdx}: ${forceMagnitude.toFixed(1)}N`);
  }

  // ==========================================
  // PASSO 9: SINCRONIZAR CANNON → STATE
  // ==========================================
  syncPhysicsToState() {
    // Amarelos
    for (const player of this.gameState.players.yellow) {
      player.position.copy(player.physBody.position);
      player.velocity.copy(player.physBody.velocity);
      player.quaternion.copy(player.physBody.quaternion);
    }

    // Azuis
    for (const player of this.gameState.players.blue) {
      player.position.copy(player.physBody.position);
      player.velocity.copy(player.physBody.velocity);
      player.quaternion.copy(player.physBody.quaternion);
    }

    // Bola
    if (this.gameState.ball && this.gameState.ball.physBody) {
      this.gameState.ball.position.copy(this.gameState.ball.physBody.position);
      this.gameState.ball.velocity.copy(this.gameState.ball.physBody.velocity);
      this.gameState.ball.quaternion.copy(this.gameState.ball.physBody.quaternion);
    }
  }

  // ==========================================
  // PASSO 10: VALIDAR INPUT (Segurança)
  // ==========================================
  validateInput(team, inputData) {
    // 1. É a vez desse time?
    if (this.gameState.possession !== team) {
      return false;
    }

    // 2. Jogo não está travado?
    if (this.gameState.locked) {
      return false;
    }

    // 3. Bola não está morta?
    if (this.gameState.ballDead) {
      return false;
    }

    // 4. Peça existe?
    const player = this.gameState.players[team][inputData.playerIdx];
    if (!player) {
      return false;
    }

    // 5. Input não é muito antigo (>100ms)?
    if (!inputData.receivedAt) {
      return false;
    }
    const timeSinceInput = Date.now() - inputData.receivedAt;
    if (timeSinceInput > 100) {
      return false;
    }

    // 6. Direção é válida?
    const dirMag = Math.sqrt(inputData.directionX ** 2 + inputData.directionZ ** 2);
    if (dirMag === 0 || dirMag > 1.1) {
      return false;
    }

    // 7. Intensity está entre 0 e 1?
    if (inputData.intensity < 0 || inputData.intensity > 1) {
      return false;
    }

    return true;
  }

  // ==========================================
  // PASSO 11: TICK LOOP (60 FPS)
  // ==========================================
  startTickLoop() {
    console.log(`[TickLoop] ${this.roomCode}: Iniciando 60 FPS`);

    let lastTickTime = Date.now();
    let broadcastCounter = 0;
    const BROADCAST_EVERY_N_TICKS = 3; // Broadcast a cada 3 ticks (~20ms, 50 Hz)

    this.tickInterval = setInterval(() => {
      const now = Date.now();
      const deltaTime = (now - lastTickTime) / 1000;
      lastTickTime = now;

      this.tick(deltaTime);

      // Broadcast estado para clientes a cada N ticks
      broadcastCounter++;
      if (broadcastCounter >= BROADCAST_EVERY_N_TICKS && this.io) {
        this.broadcast(this.io);
        broadcastCounter = 0;
      }
    }, 1000 / TICK_RATE); // ~16ms
  }

  // ==========================================
  // PASSOS 13-18: EVENTOS DE JOGO
  // ==========================================

  /**
   * Passo 13: Detectar gol
   */
  isGoal() {
    const b = this.gameState.ball.position;
    const HW = FIELD_WIDTH / 2; // metade da largura
    const GW = 7.32; // largura do gol

    // Bola passou da linha de fundo E dentro da área do gol
    if (Math.abs(b.x) > HW && Math.abs(b.z) < GW / 2 + 0.3) {
      return true;
    }
    return false;
  }

  /**
   * Passo 13: Tratar gol
   */
  handleGoal() {
    const b = this.gameState.ball.position;
    const scoringTeam = b.x > 0 ? 'yellow' : 'blue';

    this.gameState.scores[scoringTeam]++;
    this.gameState.gameStatus = 'goal';

    console.log(`[GOAL] 🟡⚽ ${scoringTeam.toUpperCase()} scored! (${this.gameState.scores.yellow} × ${this.gameState.scores.blue})`);

    // Reset do campo
    this.resetField();
  }

  /**
   * Passo 14: Detectar lateral
   */
  isThrowIn() {
    const b = this.gameState.ball.position;
    const HH = FIELD_HEIGHT / 2; // metade da altura

    // Saiu pela linha lateral (Z), mas não pela linha de fundo (X)
    return Math.abs(b.z) > HH && Math.abs(b.x) <= FIELD_WIDTH / 2;
  }

  /**
   * Passo 14: Tratar lateral
   */
  handleThrowIn() {
    const b = this.gameState.ball.position;
    const HH = FIELD_HEIGHT / 2;

    // Time que chutou por último perde a bola
    const awardedTeam = this.gameState.lastTouchTeam === 'yellow' ? 'blue' : 'yellow';

    // Reposiciona bola na linha lateral
    b.z = b.z > 0 ? HH : -HH;
    b.x = Math.max(-FIELD_WIDTH / 2, Math.min(b.x, FIELD_WIDTH / 2));
    this.gameState.ball.physBody.position.copy(b);
    this.gameState.ball.physBody.velocity.set(0, 0, 0);

    this.gameState.gameStatus = 'throw_in';
    this.gameState.ballDead = true;
    this.gameState.possession = awardedTeam;
    this.gameState.touches = 0;
    this.gameState.locked = true;

    console.log(`[THROW-IN] ${awardedTeam.toUpperCase()} awarded`);

    // Liberar após 100ms
    setTimeout(() => {
      this.gameState.locked = false;
    }, 100);
  }

  /**
   * Passo 15: Detectar escanteio
   */
  isCorner() {
    const b = this.gameState.ball.position;
    const HW = FIELD_WIDTH / 2;
    const GW = 7.32;

    // Saiu pela linha de fundo AND defesa tocou por último
    const outByGoalLine = Math.abs(b.x) > HW && Math.abs(b.z) >= GW / 2 + 0.3;
    const defenseTouched = this.gameState.lastTouchTeam === (b.x > 0 ? 'yellow' : 'blue');

    return outByGoalLine && defenseTouched;
  }

  /**
   * Passo 15: Tratar escanteio
   */
  handleCorner() {
    const b = this.gameState.ball.position;
    const HW = FIELD_WIDTH / 2;
    const HH = FIELD_HEIGHT / 2;

    const attackingTeam = b.x > 0 ? 'blue' : 'yellow';

    // Reposiciona na bandeirinha
    b.x = b.x > 0 ? HW : -HW;
    b.z = b.z > 0 ? HH : -HH;
    this.gameState.ball.physBody.position.copy(b);
    this.gameState.ball.physBody.velocity.set(0, 0, 0);

    this.gameState.gameStatus = 'corner';
    this.gameState.ballDead = true;
    this.gameState.possession = attackingTeam;
    this.gameState.touches = 0;
    this.gameState.locked = true;

    console.log(`[CORNER] ${attackingTeam.toUpperCase()} awarded`);

    setTimeout(() => {
      this.gameState.locked = false;
    }, 100);
  }

  /**
   * Passo 16: Detectar tiro de meta
   */
  isGoalKick() {
    const b = this.gameState.ball.position;
    const HW = FIELD_WIDTH / 2;
    const GW = 7.32;

    // Saiu pela linha de fundo AND ataque tocou por último (defesa não tocou)
    const outByGoalLine = Math.abs(b.x) > HW && Math.abs(b.z) >= GW / 2 + 0.3;
    const attackTouched = this.gameState.lastTouchTeam !== (b.x > 0 ? 'yellow' : 'blue');

    return outByGoalLine && attackTouched;
  }

  /**
   * Passo 16: Tratar tiro de meta
   */
  handleGoalKick() {
    const b = this.gameState.ball.position;
    const HW = FIELD_WIDTH / 2;

    const defendingTeam = b.x > 0 ? 'yellow' : 'blue';

    // Reposiciona na borda da área (5m da linha de fundo)
    b.x = b.x > 0 ? HW - 5 : -HW + 5;
    b.z = 0;
    this.gameState.ball.physBody.position.copy(b);
    this.gameState.ball.physBody.velocity.set(0, 0, 0);

    this.gameState.gameStatus = 'goal_kick';
    this.gameState.ballDead = true;
    this.gameState.possession = defendingTeam;
    this.gameState.touches = 0;
    this.gameState.locked = true;

    console.log(`[GOAL-KICK] ${defendingTeam.toUpperCase()} awarded`);

    setTimeout(() => {
      this.gameState.locked = false;
    }, 100);
  }

  /**
   * Passo 17: Gerenciar posse e toques
   */
  managePossession() {
    if (this.gameState.ballDead) {
      return; // Durante reinício, não muda posse automaticamente
    }

    // Verificar se time mudou de posse (toque na bola)
    // O lastTouchTeam é definido pela colisão na física (TODO: implementar)

    // Aumentar toques se o mesmo time tocou
    if (this.gameState.lastTouchTeam === this.gameState.possession) {
      // Mesmo time tocou novamente = toque válido
      if (this.gameState.lastTouchTeam !== null) {
        this.gameState.touches++;
      }
    } else if (this.gameState.lastTouchTeam !== null) {
      // Time diferente tocou = mudança de posse
      this.gameState.possession = this.gameState.lastTouchTeam;
      this.gameState.touches = 1;
      console.log(`[POSSESSION] ${this.gameState.possession.toUpperCase()} takes possession`);
    }

    // Verificar se atingiu máximo de toques
    if (this.gameState.touches >= this.gameState.maxTouches) {
      this.gameState.possession = this.gameState.possession === 'yellow' ? 'blue' : 'yellow';
      this.gameState.touches = 0;
      console.log(`[POSSESSION] Max touches reached. ${this.gameState.possession.toUpperCase()} takes possession`);
    }
  }

  /**
   * Passo 18: Detectar faltas
   */
  detectFoul() {
    // TODO: Implementar detecção de falta
    // Falta = time tocou na bola mas antes bateu em jogador adversário
    // Requer rastreamento de última colisão
  }

  /**
   * Verificar se bola saiu do campo
   */
  isBallOutOfBounds() {
    const b = this.gameState.ball.position;
    return Math.abs(b.z) > FIELD_HEIGHT / 2 || Math.abs(b.x) > FIELD_WIDTH / 2;
  }

  /**
   * Passo 13-18: Verificar todos os eventos de jogo
   */
  checkGameEvents() {
    if (this.gameState.locked || this.gameState.matchEnded) {
      return;
    }

    // PASSO 13: Gol
    if (this.isGoal()) {
      this.handleGoal();
      return;
    }

    // PASSO 14-16: Bola fora de campo
    if (this.isBallOutOfBounds()) {
      if (this.isThrowIn()) {
        this.handleThrowIn();
      } else if (this.isCorner()) {
        this.handleCorner();
      } else if (this.isGoalKick()) {
        this.handleGoalKick();
      }
      return;
    }

    // PASSO 17: Gerenciar posse e toques
    this.managePossession();

    // PASSO 18: Detectar faltas
    // this.detectFoul();
  }

  /**
   * Reset do campo após gol
   */
  resetField() {
    // Reset de posições
    for (const team of ['yellow', 'blue']) {
      const formation = this.getInitialFormation(team);
      for (let i = 0; i < this.gameState.players[team].length; i++) {
        const player = this.gameState.players[team][i];
        const pos = formation[i];
        player.physBody.position.set(pos.x, PLAYER_RADIUS, pos.z);
        player.physBody.velocity.set(0, 0, 0);
      }
    }

    // Reset bola
    this.gameState.ball.physBody.position.set(0, BALL_RADIUS, 0);
    this.gameState.ball.physBody.velocity.set(0, 0, 0);

    // Próxima posse: time que sofreu o gol
    const scoringTeam = this.gameState.ball.position.x > 0 ? 'yellow' : 'blue';
    this.gameState.possession = scoringTeam === 'yellow' ? 'blue' : 'yellow';

    this.gameState.touches = 0;
    this.gameState.ballDead = false;
    this.gameState.locked = false;
    this.gameState.gameStatus = 'playing';

    console.log(`[RESET] Campo resetado. ${this.gameState.possession.toUpperCase()} terá a posse.`);
  }
}

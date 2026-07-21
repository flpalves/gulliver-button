import { PHYS, Physics } from './physics.js';
import { initThree, initCameraButtons, initZoom, initPan, initTouchGestures, onViewChange, viewHalfX, viewHalfZ, scene, camera, renderer } from './scene.js';
import { Field } from './field.js';
import { createTeams } from './formations.js';
import { Ball } from './ball.js';
import { InputHandler } from './input.js';
import { Game, RULE_MODES } from './game.js';
import { setGameMode, setTeamColors, resetTeamColors, GAME_MODES } from './constants.js';
import { clearTextureCache } from './textures.js';
import { hexToNumber } from './teams.js';
import { MultiplayerUI } from './multiplayer-ui.js';

// ─────────────────────────────────────────────
// INIT & LOOP
// ─────────────────────────────────────────────
let field, players, ball, input, physics, game;
let lastFrameTime = 0;
let accumulator = 0;
let multiplayerUI = null;
let gameMode = 'local';
let mp = null;                 // MultiplayerManager ativo (null em modo local)
let snapshotTimer = null;      // intervalo de envio de snapshots (dono da vez)

const SNAPSHOT_INTERVAL_MS = 50;   // ~20 Hz

const _stadiumAudio = new Audio('assets/stadium.mp3');
_stadiumAudio.loop = true;
_stadiumAudio.volume = 0.3;

function init(ruleMode = RULE_MODES.FOUR_TOUCHES, ballType = 'sphere', gameMode = GAME_MODES.STANDARD, halfSeconds = 5 * 60, teamConfig = null) {
  // Apply team colours before any Player is constructed (they read C.COL_Y / C.RIM_Y etc.)
  if (teamConfig) {
    setTeamColors(
      hexToNumber(teamConfig.left.color),
      hexToNumber(teamConfig.left.rimColor),
      hexToNumber(teamConfig.right.color),
      hexToNumber(teamConfig.right.rimColor)
    );
  } else {
    resetTeamColors();
  }
  clearTextureCache();

  // Apply field/player config before constructing anything that reads C
  setGameMode(gameMode);

  initThree();
  initCameraButtons();
  initZoom();
  initPan();
  initTouchGestures();
  physics = new Physics();
  // Showbol boards must be built before player/ball bodies so their masks include SHOWBOL_WALL
  if (gameMode === GAME_MODES.SHOWBOL) physics.buildShowbolWalls();
  field = new Field(physics, gameMode);
  // Far perimeter wall (camera-edge boundary) tracks the camera's current
  // view bounds — set it from whatever initThree() just computed, then keep
  // it in sync across resizes and the top-down/isometric toggle.
  physics.setFarWalls(viewHalfX, viewHalfZ);
  onViewChange((hx, hz) => physics.setFarWalls(hx, hz));

  const teamIds = teamConfig
    ? { yellow: teamConfig.left.id, blue: teamConfig.right.id }
    : { yellow: 'yellow', blue: 'blue' };
  players = createTeams(gameMode, teamIds);
  players.forEach(p => physics.addPlayerBody(p));

  ball = new Ball(ballType);
  physics.addBallBody(ball);

  const teamNames = teamConfig
    ? { yellow: teamConfig.left.name, blue: teamConfig.right.name }
    : undefined;
  game = new Game({ players, ball, physics, field, ruleMode, gameMode, halfSeconds, teamNames });
  input = new InputHandler(players, game);

  lastFrameTime = performance.now();
  requestAnimationFrame(animate);
  _stadiumAudio.play().catch(() => {});
}

function syncMeshes() {
  // Sync all player meshes from physics bodies
  players.forEach(p => {
    p.group.position.copy(p.physBody.position);
  });

  // Sync ball mesh from physics body
  if (ball) {
    ball.group.position.copy(ball.physBody.position);
    ball.mesh.quaternion.copy(ball.physBody.quaternion);
  }
}

function animate(now) {
  requestAnimationFrame(animate);

  let frameTime = (now - lastFrameTime) / 1000;
  lastFrameTime = now;
  frameTime = Math.min(frameTime, 0.1);   // clamp huge gaps (tab switch, etc.)

  // MULTIPLAYER: física roda no cliente dono da vez (autoridade).
  // O espectador pausa a simulação local e apenas aplica os snapshots
  // recebidos, interpolando entre os dois últimos para suavidade.
  const mpActive = mp && mp.isActive;

  if (!mpActive || mp.isAuthority) {
    accumulator += frameTime;
    while (accumulator >= PHYS.FIXED_DT) {
      physics.step();
      accumulator -= PHYS.FIXED_DT;
    }
  } else {
    accumulator = 0;
    applyInterpolatedSnapshot();
  }

  syncMeshes();
  field.goals.forEach(goal => goal.update());

  // Regras do jogo — internamente só rodam no dono da vez (ver Game.update)
  game.update(frameTime);
  renderer.render(scene, camera);
}

// Espectador: escreve nos corpos físicos as posições interpoladas entre os
// dois últimos snapshots do dono da vez (a física local está pausada, então
// os corpos são puramente cinemáticos — syncMeshes leva isso para os meshes).
function applyInterpolatedSnapshot() {
  if (!mp || !mp.currentSnapshot || !mp.currentSnapshot.bodyStates) return;
  const curr = mp.currentSnapshot;
  const prev = mp.previousSnapshot;

  let alpha = 1;
  let prevMap = null;
  if (prev && prev.bodyStates) {
    const interval = Math.max(curr.receivedAt - prev.receivedAt, 1);
    alpha = Math.min((performance.now() - curr.receivedAt) / interval, 1);
    prevMap = new Map(prev.bodyStates.map(s => [s.id, s]));
  }

  const lerpPos = (a, b) => ({
    x: a.x + (b.x - a.x) * alpha,
    y: a.y + (b.y - a.y) * alpha,
    z: a.z + (b.z - a.z) * alpha
  });

  curr.bodyStates.forEach(state => {
    const prevState = prevMap ? prevMap.get(state.id) : null;
    const pos = prevState ? lerpPos(prevState.pos, state.pos) : state.pos;

    let body = null;
    if (state.id === 'ball' && ball) {
      body = ball.physBody;
    } else if (state.id.startsWith('player_')) {
      const idx = parseInt(state.id.split('_')[1], 10);
      if (players && players[idx]) body = players[idx].physBody;
    }
    if (!body) return;

    // Don't clobber a piece we're actively free-dragging locally (e.g. our
    // own keeper while spectating) — its position is authoritative from our
    // own input until the drag ends, not from the incoming snapshot.
    if (input && input.dragging && input.dragging.physBody === body) return;

    body.position.set(pos.x, pos.y, pos.z);
    body.velocity.set(0, 0, 0);
    if (state.quat) {
      body.quaternion.set(state.quat.x, state.quat.y, state.quat.z, state.quat.w);
    }
  });
}

function initMultiplayer(ruleMode = RULE_MODES.FOUR_TOUCHES, ballType = 'sphere', gameMode = GAME_MODES.STANDARD, halfSeconds = 5 * 60, multiplayer, teamConfig = null, opts = {}) {
  if (!multiplayer) return init(ruleMode, ballType, gameMode, halfSeconds);
  const isReconnect = !!opts.isReconnect;

  // Apply team colours before any Player is constructed (they read C.COL_Y / C.RIM_Y etc.)
  if (teamConfig) {
    setTeamColors(
      hexToNumber(teamConfig.left.color),
      hexToNumber(teamConfig.left.rimColor),
      hexToNumber(teamConfig.right.color),
      hexToNumber(teamConfig.right.rimColor)
    );
  } else {
    resetTeamColors();
  }
  clearTextureCache();
  setGameMode(gameMode);

  initThree();
  initCameraButtons();
  initZoom();
  initPan();
  initTouchGestures();
  physics = new Physics();
  if (gameMode === GAME_MODES.SHOWBOL) physics.buildShowbolWalls();
  field = new Field(physics, gameMode);
  physics.setFarWalls(viewHalfX, viewHalfZ);
  onViewChange((hx, hz) => physics.setFarWalls(hx, hz));

  // Determine my team from multiplayer
  const myTeam = multiplayer.myTeam; // 'yellow' or 'blue'
  const opponentTeam = myTeam === 'yellow' ? 'blue' : 'yellow';
  const teamIds = teamConfig
    ? { yellow: teamConfig.left.id, blue: teamConfig.right.id }
    : { yellow: 'yellow', blue: 'blue' };

  players = createTeams(gameMode, teamIds);
  players.forEach(p => physics.addPlayerBody(p));

  ball = new Ball(ballType);
  physics.addBallBody(ball);

  const teamNames = teamConfig
    ? { yellow: teamConfig.left.name, blue: teamConfig.right.name }
    : undefined;
  game = new Game({ players, ball, physics, field, ruleMode, gameMode, halfSeconds, teamNames, multiplayer });
  input = new InputHandler(players, game, multiplayer);

  mp = multiplayer;

  if (isReconnect) {
    // Quem reconecta (ex.: F5 sem querer) perdeu todo o estado local — volta
    // sempre como espectador e aguarda um snapshot completo do oponente para
    // resincronizar placar, cronômetro e posições (ver Game._onOpponentReconnected).
    multiplayer.isAuthority = false;
    multiplayer.isMyTurn = false;
  } else {
    // Autoridade inicial: o jogo sempre começa com a posse do amarelo
    multiplayer.isAuthority = (multiplayer.myTeam === 'yellow');
    multiplayer.isMyTurn = multiplayer.isAuthority;
  }

  // Espectador: recebe snapshots do dono da vez (relay do servidor)
  multiplayer.onPhysicsState = (snapshot) => {
    if (!game || multiplayer.isAuthority) return;

    game.applySnapshotGame(snapshot.game);

    // Handoff: a jogada terminou e a posse agora é nossa — aplicamos o
    // estado final exato e assumimos a simulação da física.
    if (snapshot.handoff && snapshot.game?.possession === multiplayer.myTeam) {
      game.applyBodyStates(snapshot.bodyStates, true);
      multiplayer.previousSnapshot = null;
      multiplayer.currentSnapshot = null;
      multiplayer.isAuthority = true;
      multiplayer.isMyTurn = true;
      // Reexecuta o HUD agora como autoridade (inicia timers de turno/reposição)
      game._updateHUD();
      console.log('[Main] 🔑 Autoridade da física assumida (posse nossa)');
    }
  };

  // Dono da vez: envia snapshots a ~20 Hz enquanto detém a autoridade.
  // A autoridade só é entregue quando a jogada termina de verdade: posse
  // trocou E nada mais está resolvendo (bola parada, sem reinício pendente).
  if (snapshotTimer) clearInterval(snapshotTimer);
  snapshotTimer = setInterval(() => {
    if (!multiplayer.isActive || !multiplayer.isAuthority || !game) return;

    const stillMine =
      game.possession === multiplayer.myTeam ||
      game.locked || game.ballDead ||
      game.paused || game.matchEnded ||
      !physics.allAtRest();

    if (stillMine) {
      multiplayer.sendPhysicsState(game.buildSnapshot());
    } else {
      multiplayer.sendPhysicsState(game.buildSnapshot({ handoff: true }));
      multiplayer.isAuthority = false;
      multiplayer.isMyTurn = false;
      // Descarta snapshots velhos do período anterior como espectador — os
      // corpos ficam parados onde estão até o novo dono começar a transmitir.
      multiplayer.previousSnapshot = null;
      multiplayer.currentSnapshot = null;
      console.log('[Main] 🔑 Autoridade da física entregue ao oponente');
    }
  }, SNAPSHOT_INTERVAL_MS);

  lastFrameTime = performance.now();
  requestAnimationFrame(animate);
  _stadiumAudio.play().catch(() => {});
}

// ─────────────────────────────────────────────
// MULTIPLAYER UI INTEGRATION
// ─────────────────────────────────────────────
function initMultiplayerUI() {
  multiplayerUI = new MultiplayerUI();

  multiplayerUI.onGameStart = (mode, multiplayer) => {
    gameMode = mode;

    if (mode === 'local') {
      // Modo local: inicia jogo normalmente
      init();
    } else if (mode === 'multiplayer' && multiplayer) {
      // Modo multiplayer: inicia jogo com multiplayer.
      // A sincronização de posições agora acontece via snapshots
      // physics_state (ver initMultiplayer/applyInterpolatedSnapshot).
      initMultiplayer(RULE_MODES.FOUR_TOUCHES, 'sphere', GAME_MODES.STANDARD, 5 * 60, multiplayer);
    }
  };

  // Menu começa visível, aguardando escolha do jogador
  console.log('[Main] Multiplayer UI iniciado, aguardando escolha do modo');
}

// Export for use in HTML
export {
  init as initGame,
  initMultiplayer as initGameMultiplayer,
  initMultiplayerUI,
  RULE_MODES,
  GAME_MODES
};


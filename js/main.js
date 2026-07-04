import { PHYS, Physics } from './physics.js';
import { initThree, initCameraButtons, initZoom, initPan, onViewChange, viewHalfX, viewHalfZ, scene, camera, renderer } from './scene.js';
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

const _stadiumAudio = new Audio('assets/stadium.mp3');
_stadiumAudio.loop = true;
_stadiumAudio.volume = 0.5;

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
  players.forEach(p => {
    p.group.position.x = p.physBody.position.x;
    p.group.position.z = p.physBody.position.z;
  });
  ball.group.position.copy(ball.physBody.position);
  ball.mesh.quaternion.copy(ball.physBody.quaternion);
}

function animate(now) {
  requestAnimationFrame(animate);

  let frameTime = (now - lastFrameTime) / 1000;
  lastFrameTime = now;
  frameTime = Math.min(frameTime, 0.1);   // clamp huge gaps (tab switch, etc.)

  // In multiplayer: DON'T run local physics, server is authority
  // Just sync meshes from the state we receive from server
  if (!multiplayerUI || gameMode !== 'multiplayer') {
    // Local mode: run physics normally
    accumulator += frameTime;
    while (accumulator >= PHYS.FIXED_DT) {
      physics.step();
      accumulator -= PHYS.FIXED_DT;
    }
  }

  syncMeshes();
  field.goals.forEach(goal => goal.update());
  game.update(frameTime);
  renderer.render(scene, camera);
}

function initMultiplayer(ruleMode = RULE_MODES.FOUR_TOUCHES, ballType = 'sphere', gameMode = GAME_MODES.STANDARD, halfSeconds = 5 * 60, multiplayer) {
  if (!multiplayer) return init(ruleMode, ballType, gameMode, halfSeconds);

  // Apply team colours before any Player is constructed
  clearTextureCache();
  setGameMode(gameMode);

  initThree();
  initCameraButtons();
  initZoom();
  initPan();
  physics = new Physics();
  if (gameMode === GAME_MODES.SHOWBOL) physics.buildShowbolWalls();
  field = new Field(physics, gameMode);
  physics.setFarWalls(viewHalfX, viewHalfZ);
  onViewChange((hx, hz) => physics.setFarWalls(hx, hz));

  // Determine my team from multiplayer
  const myTeam = multiplayer.myTeam; // 'yellow' or 'blue'
  const opponentTeam = myTeam === 'yellow' ? 'blue' : 'yellow';
  const teamIds = { yellow: 'yellow', blue: 'blue' };

  players = createTeams(gameMode, teamIds);
  players.forEach(p => physics.addPlayerBody(p));

  ball = new Ball(ballType);
  physics.addBallBody(ball);

  game = new Game({ players, ball, physics, field, ruleMode, gameMode, halfSeconds, multiplayer });
  input = new InputHandler(players, game, multiplayer);

  // Initialize isMyTurn - game always starts with yellow team
  multiplayer.isMyTurn = (multiplayer.myTeam === 'yellow');

  // Configure multiplayer callbacks for game sync
  multiplayer.onRemoteShotFired = (payload) => game._onRemoteShotFired(payload);

  // Sincronizar estado do jogo com updates do servidor
  multiplayer.onStateUpdated = (state) => {
    console.log('[Main] Received state_update:', { possession: state.possession, ballPos: state.ball?.pos, hasPlayers: !!state.players });

    if (!game) {
      console.error('[Main] Game not initialized yet!');
      return;
    }

    if (!state.players) {
      console.error('[Main] State has no players!');
      return;
    }

    try {
      // Sincronizar estado de possessão e física
      game.possession = state.possession;
      game.touches = state.touches;
      game.locked = state.locked;

      // Construir array de body states para aplicar ao game
      const bodyStates = [];

      // Adicionar estado da bola
      if (state.ball && state.ball.pos) {
        console.log('[Main] Adding ball state:', state.ball.pos);
        bodyStates.push({
          id: 'ball',
          pos: state.ball.pos,
          vel: state.ball.vel || { x: 0, y: 0, z: 0 },
          quat: state.ball.quat || { x: 0, y: 0, z: 0, w: 1 }
        });
      } else {
        console.warn('[Main] No ball in state!');
      }

      // Adicionar estado dos jogadores
      // Nota: players[0-10] = amarelo, players[11-21] = azul
      let playerGlobalIdx = 0;
      for (const team of ['yellow', 'blue']) {
        if (state.players[team]) {
          for (let i = 0; i < state.players[team].length; i++) {
            const statePlayer = state.players[team][i];
            if (statePlayer && statePlayer.pos) {
              bodyStates.push({
                id: `player_${playerGlobalIdx}`,
                pos: statePlayer.pos,
                vel: statePlayer.vel || { x: 0, y: 0, z: 0 },
                quat: statePlayer.quat || { x: 0, y: 0, z: 0, w: 1 }
              });
            }
            playerGlobalIdx++;
          }
        }
      }

      console.log('[Main] Applying body states:', bodyStates.length, 'bodies');

      // Aplicar estados da física para sincronizar com servidor
      if (bodyStates.length > 0) {
        game.applyBodyStates(bodyStates, true);
      }

      // Atualizar HUD com estado do servidor
      if (game._updateHUD) game._updateHUD();
    } catch (error) {
      console.error('[Main] Error in onStateUpdated:', error);
    }
  };

  // Turn state is now controlled by the server via game_state events

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
      // Modo multiplayer: inicia jogo com multiplayer
      initMultiplayer(RULE_MODES.FOUR_TOUCHES, 'sphere', GAME_MODES.STANDARD, 5 * 60, multiplayer);

      // Sincronizar posições com servidor a cada frame
      if (multiplayer.onStateUpdated) {
        multiplayerUI.syncPositionsWithServer((state, mp) => {
          // Atualizar posições dos jogadores
          if (players && state.players) {
            for (const team of ['yellow', 'blue']) {
              for (let i = 0; i < Math.min(players.length / 2, state.players[team].length); i++) {
                const pos = mp.getPlayerPosition(team, i);
                const playerTeam = players.filter(p => p.team === team);
                if (playerTeam[i] && pos) {
                  playerTeam[i].group.position.copy(pos);
                }
              }
            }

            // Atualizar bola
            const ballPos = mp.getBallPosition();
            if (ball && ballPos) {
              ball.group.position.copy(ballPos);
            }
          }
        });
      }
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


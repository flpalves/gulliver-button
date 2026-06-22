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

// ─────────────────────────────────────────────
// INIT & LOOP
// ─────────────────────────────────────────────
let field, players, ball, input, physics, game;
let lastFrameTime = 0;
let accumulator = 0;

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

  accumulator += frameTime;
  while (accumulator >= PHYS.FIXED_DT) {
    physics.step();
    accumulator -= PHYS.FIXED_DT;
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

  // Turn state is now controlled by the server via game_state events

  lastFrameTime = performance.now();
  requestAnimationFrame(animate);
  _stadiumAudio.play().catch(() => {});
}

// Export for use in HTML
export { init as initGame, initMultiplayer as initGameMultiplayer, RULE_MODES, GAME_MODES };


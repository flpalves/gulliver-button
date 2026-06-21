import { Player } from './player.js';
import { GAME_MODES } from './constants.js';

// ─────────────────────────────────────────────
// FORMATIONS
// ─────────────────────────────────────────────

// Standard Futebol de Botão — 4-3-3, 11 jogadores por time
function buildStandardFormation(side) {
  const s = side;
  return [
    { isKeeper: true, x: s * -102.2, z: 0 },
    // Defenders (4)
    { x: s * -72.8, z: -42 }, { x: s * -72.8, z: -14 }, { x: s * -72.8, z: 14 }, { x: s * -72.8, z: 42 },
    // Midfielders (3)
    { x: s * -43.4, z: -22.4 }, { x: s * -43.4, z: 0 }, { x: s * -43.4, z: 22.4 },
    // Forwards (3) — two close to centre for kickoff, one withdrawn
    { x: s * -12.6, z: -16.8 }, { x: s * -12.6, z: 16.8 }, { x: s * -26.6, z: 0 },
  ];
}

// Society Fut7 — 1-2-2, 6 jogadores por time, campo 50%
// Posições escaladas 0.5× em relação ao campo padrão
function buildSocietyFormation(side) {
  const s = side;
  return [
    { isKeeper: true, x: s * -51.1, z: 0 },
    // Defenders (2)
    { x: s * -36.4, z: -14 }, { x: s * -36.4, z: 14 },
    // Midfielders (2)
    { x: s * -21.7, z: -11.2 }, { x: s * -21.7, z: 11.2 },
    // Forwards (2) — fora do círculo central (CR=9.59, d≈16.4)
    { x: s * -13, z: -10 }, { x: s * -13, z: 10 },
  ];
}

// Showbol — 1-2-2-1, 6 jogadores por time, campo igual ao Fut7 com paredes
function buildShowbolFormation(side) {
  const s = side;
  return [
    { isKeeper: true, x: s * -51.1, z: 0 },
    // Defensores (2)
    { x: s * -36, z: -15 }, { x: s * -36, z: 15 },
    // Meias (2)
    { x: s * -22, z: -12 }, { x: s * -22, z: 12 },
    // Atacante (1) — fora do círculo central (CR≈9.6, distância=11)
    { x: s * -11, z: 0 },
  ];
}

export function createTeams(gameMode = GAME_MODES.STANDARD, teamIds = { yellow: 'yellow', blue: 'blue' }) {
  const build = gameMode === GAME_MODES.SOCIETY  ? buildSocietyFormation
              : gameMode === GAME_MODES.SHOWBOL   ? buildShowbolFormation
              : buildStandardFormation;
  const players = [];
  build(+1).forEach((p, i) => players.push(new Player({ team: 'yellow', teamId: teamIds.yellow, isKeeper: !!p.isKeeper, x: p.x, z: p.z, playerIndex: i + 1 })));
  build(-1).forEach((p, i) => players.push(new Player({ team: 'blue',   teamId: teamIds.blue,   isKeeper: !!p.isKeeper, x: p.x, z: p.z, playerIndex: i + 1 })));
  return players;
}

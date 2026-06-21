// ─────────────────────────────────────────────
// GAME MODES
// ─────────────────────────────────────────────
export const GAME_MODES = {
  STANDARD: 'standard',   // Futebol de Botão — campo completo, 11 jogadores
  SOCIETY:  'society',    // Society Fut7 — campo ~50%, 6 jogadores por time
  SHOWBOL:  'showbol',    // Showbol — campo Fut7 com paredes, 5+1 por time
};

// ─────────────────────────────────────────────
// VISUAL / FIELD CONSTANTS  (mutável — ver setGameMode)
// ─────────────────────────────────────────────
export const C = {
  // Field (world units; scaled ×1.5 from the original 105×68, then +40% bigger)
  FW: 220.5, FH: 142.8,      // field length / width (+40%)
  GW: 14.5,                  // goal mouth (Z)
  GH: 3.5,                   // goal height (Y)
  GD: 3.0,                   // goal depth (X) — unchanged
  PR: 0.25,                  // post radius — unchanged
  SAW: 38.472, SAD: 11.55,   // small area (goal area) — scaled +40%
  BAW: 84.672, BAD: 34.65,   // big area (penalty area) — scaled +40%
  PEN: 23.1,                 // penalty distance from goal line — scaled +40%
  CR:  19.18,                // centre circle radius — scaled +40%
  DAR: 19.18,                // D-arc radius — scaled +40%
  COR: 2.1,                  // corner arc radius — scaled +40%

  // Pieces (sized 20% smaller than the original draft)
  PLAYER_R: 2.0, PLAYER_H: 0.48,
  KEEP_W: 5.2,   KEEP_D: 1.2, KEEP_H: 1.68,  // keeper: +30% width, +250% height
  BALL_R: 0.5,
  BALL_CUBE_SIZE: 0.8,  // cube side length (same diameter as sphere for consistency)
  PLAYER_RIM: 0.25,   // extra radius/margin the visual rim adds beyond the body
  KEEP_RIM:   0.3,

  // Colours
  COL_Y:     0xFFD700,
  COL_B:     0x87CEEB,
  RIM_Y:     0xAA8800,
  RIM_B:     0x4488AA,
  COL_FIELD: 0x2D7A2D,
  COL_WHITE: 0xffffff,
};
C.HW = C.FW / 2;   // half-width (X)
C.HH = C.FH / 2;   // half-height (Z)
// Minimum center-to-center distance from ball to any player during set pieces.
// "2 vezes o tamanho do botão" = 2 × button diameter = 2 × 2×(PLAYER_R+PLAYER_RIM)
C.MIN_RESTART_DIST = 2 * 2 * (C.PLAYER_R + C.PLAYER_RIM); // = 9 units

// Standard field values (snapshot for reset)
const _STD = {
  FW: 220.5, FH: 142.8, GW: 14.5,  GH: 3.5,  GD: 3.0, PR: 0.25,
  SAW: 38.472, SAD: 11.55, BAW: 84.672, BAD: 34.65, PEN: 23.1,
  CR: 19.18, DAR: 19.18, COR: 2.1,
};

// Applies field dimensions for the chosen game mode by mutating C in place.
// Must be called before Field, Physics, and Player constructors run.
function _applySocietyDimensions() {
  const sf  = 0.5;      // campo 50% do padrão
  const ssa = 0.82875;  // pequena área: 0.975 × 0.85
  const sba = 0.6825;   // grande área:  0.975 × 0.70
  C.FW = _STD.FW * sf; C.FH = _STD.FH * sf;
  // Gol igual ao padrão — não escala
  C.GW = _STD.GW; C.GH = _STD.GH; C.GD = _STD.GD; C.PR = _STD.PR;
  C.SAW = _STD.SAW * ssa; C.SAD = _STD.SAD * ssa;
  C.BAW = _STD.BAW * sba; C.BAD = _STD.BAD * sba;
  // PEN proporcional à grande área; DAR mantido em 0.975 → (BAD-PEN)/DAR ≈ 0.42 ✓
  C.PEN = _STD.PEN * sba;
  C.CR  = _STD.CR  * sf;
  C.DAR = _STD.DAR * 0.975;
  C.COR = _STD.COR * sf;
}

export function setTeamColors(colorY, rimY, colorB, rimB) {
  C.COL_Y = colorY;
  C.RIM_Y = rimY;
  C.COL_B = colorB;
  C.RIM_B = rimB;
}

export function resetTeamColors() {
  C.COL_Y = 0xFFD700; C.RIM_Y = 0xAA8800;
  C.COL_B = 0x87CEEB; C.RIM_B = 0x4488AA;
}

export function setGameMode(mode) {
  if (mode === GAME_MODES.SOCIETY || mode === GAME_MODES.SHOWBOL) {
    _applySocietyDimensions();
  } else {
    Object.assign(C, _STD);
  }
  C.HW = C.FW / 2;
  C.HH = C.FH / 2;
  C.MIN_RESTART_DIST = 2 * 2 * (C.PLAYER_R + C.PLAYER_RIM);
}

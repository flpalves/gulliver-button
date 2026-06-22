// Canvas-based avatar textures for player buttons.
// Images are generated procedurally; drop a real PNG at
// assets/players/{team}/{index}.png to override any slot.

const _cache   = new Map();
export function clearTextureCache() { _cache.clear(); }
const _loader  = new THREE.TextureLoader();

function _buildAvatarCanvas(playerIndex, teamColorHex) {
  const S = 256, cx = S / 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');

  // ── clip everything to a circle ──────────────────────────
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cx, cx, 0, Math.PI * 2);
  ctx.clip();

  // light-grey background (skin/neck area)
  ctx.fillStyle = '#f0f0f0';
  ctx.fillRect(0, 0, S, S);

  // jersey (lower portion, shoulder-curve top edge)
  const teamHex = '#' + teamColorHex.toString(16).padStart(6, '0');
  ctx.fillStyle = teamHex;
  ctx.beginPath();
  ctx.moveTo(0, S * 0.52);
  ctx.quadraticCurveTo(cx * 0.42, S * 0.41, cx, S * 0.52);
  ctx.quadraticCurveTo(cx * 1.58, S * 0.41, S, S * 0.52);
  ctx.lineTo(S, S);
  ctx.lineTo(0, S);
  ctx.closePath();
  ctx.fill();

  // head (skin tone)
  ctx.beginPath();
  ctx.arc(cx, S * 0.335, S * 0.20, 0, Math.PI * 2);
  ctx.fillStyle = '#FDDBB4';
  ctx.fill();

  // hair cap (upper half of head)
  ctx.beginPath();
  ctx.arc(cx, S * 0.335, S * 0.20, -Math.PI * 0.95, Math.PI * 0.05);
  ctx.lineTo(cx, S * 0.335);
  ctx.closePath();
  ctx.fillStyle = '#4a2e12';
  ctx.fill();

  ctx.restore(); // end circle clip

  // jersey number
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.round(S * 0.30)}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(playerIndex), cx, S * 0.725);

  return cv;
}

/**
 * Returns a THREE.CanvasTexture for the given player.
 * Looks for assets/players/{teamId}/{playerIndex}.png and swaps it in if found.
 * Falls back to a procedurally-generated avatar while the image loads (or if absent).
 */
export function makePlayerTexture(playerIndex, teamColorHex, teamId) {
  const key = `${teamId}_${playerIndex}`;
  if (_cache.has(key)) return _cache.get(key);

  // Canvas placeholder (shown immediately)
  const tex = new THREE.CanvasTexture(_buildAvatarCanvas(playerIndex, teamColorHex));
  _cache.set(key, tex);

  // Try individual PNG first; if missing and it's an outfield player, try players.png
  _loader.load(
    `assets/players/${teamId}/${playerIndex}.png`,
    (loaded) => {
      tex.image = loaded.image;
      tex.needsUpdate = true;
    },
    undefined,
    playerIndex >= 2 ? () => {
      _loader.load(`assets/players/${teamId}/players.png`, (loaded) => {
        const S = 256, cx = S / 2;
        const cv = document.createElement('canvas');
        cv.width = cv.height = S;
        const ctx = cv.getContext('2d');
        ctx.drawImage(loaded.image, 0, 0, S, S);
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${Math.round(S * 0.30)}px Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(playerIndex), cx, S * 0.725);
        tex.image = cv;
        tex.needsUpdate = true;
      });
    } : undefined
  );

  return tex;
}

// ────────────────────────────────────────────────
// BALL TEXTURE

function _buildBallCanvas() {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, S, S);

  // Classic soccer ball pattern: pentagons and hexagons
  // Simplified as black curved patches radiating from poles
  ctx.fillStyle = '#000000';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2;

  // Draw 5 pentagons arranged as a classic ball pattern
  const centerX = S / 2, centerY = S / 2;
  const radius = S * 0.35;

  for (let i = 0; i < 5; i++) {
    const angle = (i * Math.PI * 2) / 5;
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle) * radius;

    // Draw a pentagon at each point
    ctx.beginPath();
    for (let j = 0; j < 5; j++) {
      const a = angle + (j * Math.PI * 2) / 5;
      const px = x + Math.cos(a) * (S * 0.08);
      const py = y + Math.sin(a) * (S * 0.08);
      if (j === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }

  // Add horizontal stripe for visual interest
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, S * 0.45, S, S * 0.1);

  return cv;
}

// ────────────────────────────────────────────────
// CUBE (DADINHO) TEXTURE — one canvas per face (1–6 pips)

const CUBE_DOT_LAYOUTS = [
  // face 1 — centre only
  [[0.5, 0.5]],
  // face 2 — top-right, bottom-left
  [[0.72, 0.28], [0.28, 0.72]],
  // face 3 — diagonal + centre
  [[0.72, 0.28], [0.5, 0.5], [0.28, 0.72]],
  // face 4 — four corners
  [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
  // face 5 — four corners + centre
  [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]],
  // face 6 — two columns of three
  [[0.28, 0.22], [0.72, 0.22], [0.28, 0.5], [0.72, 0.5], [0.28, 0.78], [0.72, 0.78]],
];

function _buildCubeFaceCanvas(pips) {
  const S = 256, R = S * 0.12;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');

  // Rounded white background
  ctx.fillStyle = '#f5f5f5';
  ctx.beginPath();
  ctx.roundRect(4, 4, S - 8, S - 8, S * 0.14);
  ctx.fill();

  // Border
  ctx.strokeStyle = '#cccccc';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Pips
  ctx.fillStyle = '#1a1a1a';
  for (const [u, v] of pips) {
    ctx.beginPath();
    ctx.arc(u * S, v * S, R, 0, Math.PI * 2);
    ctx.fill();
  }

  return cv;
}

export function makeCubeTextures() {
  const key = 'cube_faces';
  if (_cache.has(key)) return _cache.get(key);

  const textures = CUBE_DOT_LAYOUTS.map((pips) => {
    const tex = new THREE.CanvasTexture(_buildCubeFaceCanvas(pips));
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    return tex;
  });

  _cache.set(key, textures);
  return textures;
}

/**
 * Returns a THREE.CanvasTexture for the ball.
 * If assets/ball.png exists it will replace the canvas fallback once loaded.
 */
export function makeBallTexture() {
  const key = 'ball';
  if (_cache.has(key)) return _cache.get(key);

  // Canvas placeholder (shown immediately)
  const tex = new THREE.CanvasTexture(_buildBallCanvas());
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  _cache.set(key, tex);

  // Try to swap in a real PNG if one exists
  _loader.load('assets/ball.png', (loaded) => {
    tex.image = loaded.image;
    tex.needsUpdate = true;
  });

  return tex;
}

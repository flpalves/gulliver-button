import { C } from './constants.js';

// ─────────────────────────────────────────────
// THREE.JS GLOBALS  (live bindings — other modules import these directly)
// ─────────────────────────────────────────────
export let scene, renderer, camera;

// Overview tilt angles.
export const CAM_TILT_TOP = 0;
export const CAM_TILT_ISO = 22 * Math.PI / 180;
export let camTilt = CAM_TILT_TOP;

// Camera mode: 'overview' | 'goal-left' | 'goal-right'
export let camMode = 'overview';

// Tilt angle used by the two goal cameras.
const CAM_TILT_GOAL = 20 * Math.PI / 180;

// Fixed on-screen margin around the field in world units.
const MARGIN = 25;

// Zoom factor: < 1 zooms in (pieces look bigger), > 1 zooms out (more field visible).
export let zoomFactor = 1.0;
const ZOOM_MIN  = 0.15;  // allows much closer zoom
const ZOOM_MAX  = 2.0;
const ZOOM_STEP = 0.08;

// Pan offset in world units. Applied to the camera position so the view can be
// shifted freely without changing the frustum size (zoom stays independent).
export let panX = 0, panZ = 0;

// Current world-space half-extents the camera shows — X is always
// screen-horizontal, Z is the (tilt-foreshortened) screen-vertical axis.
// Recomputed every time the camera is (re)built; physics.js's far wall
// reads these (via onViewChange) to stay lined up with whatever's actually
// on screen, across resizes and the top-down/isometric toggle.
export let viewHalfX = 0, viewHalfZ = 0;

// Base (unzoomed) half-extents for the goal cameras, updated each build so
// initPan can convert screen pixels to the right world-unit step size.
export let goalCamHalfH = 0, goalCamHalfV = 0;
const viewChangeListeners = [];
export function onViewChange(fn) { viewChangeListeners.push(fn); }

export function initThree() {
  const wrap = document.getElementById('canvas-wrap');
  const W = wrap.clientWidth, H = wrap.clientHeight;

  renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('canvas'), antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(W, H);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1117);

  camera = makeOrthoCamera(W, H);
  setupLights();
}

export function makeOrthoCamera(W, H) {
  const aspect = W / H;
  // Base extents that always fit the full field + margin (no zoom applied yet).
  let baseHalfZ = (C.HH + MARGIN) / Math.cos(camTilt);
  let baseHalfX = baseHalfZ * aspect;
  if (baseHalfX < C.HW + MARGIN) {
    baseHalfX = C.HW + MARGIN;
    baseHalfZ = baseHalfX / aspect;
  }
  // Physics far walls always track the base (zoom=1) extents so pieces never
  // escape off-screen when zoomed in.
  viewHalfX = baseHalfX;
  viewHalfZ = baseHalfZ;
  viewChangeListeners.forEach(fn => fn(baseHalfX, baseHalfZ));

  // Apply zoom to the actual camera frustum.
  const halfX = baseHalfX * zoomFactor;
  const halfZ = baseHalfZ * zoomFactor;
  const cam = new THREE.OrthographicCamera(-halfX, halfX, halfZ, -halfZ, 0.1, 600);
  const dist = 200;
  // Pan: shift camera position in world space so the view centre tracks panX/panZ.
  cam.position.set(panX, dist * Math.cos(camTilt), panZ + dist * Math.sin(camTilt));
  _orientCamera(cam, camTilt);
  return cam;
}

// Builds the camera's rotation directly from an explicit (right, up, backward)
// basis instead of camera.lookAt(). At camTilt=0 the view direction (0,-1,0)
// is parallel to the naive up vector (0,1,0) — a degenerate case where
// lookAt()'s internal cross products are numerically unstable and can resolve
// to a mirrored basis (yellow/blue swapping screen sides) depending on
// floating-point noise. Pinning xAxis = world +X always, and deriving a
// y-axis that's never parallel to the view direction even at camTilt=0,
// keeps the basis continuous (and the left/right layout stable) across the
// whole tilt range.
function _orientCamera(cam, t) {
  const right    = new THREE.Vector3(1, 0, 0);
  const backward = new THREE.Vector3(0, Math.cos(t), Math.sin(t));   // away from the field
  // backward × right (not right × backward) — the order that keeps the
  // basis right-handed for makeBasis(right, up, backward) *and* gives up a
  // positive world-Y component, so taller objects (goal posts, players)
  // project upward on screen instead of sinking "into" the ground.
  const up = new THREE.Vector3().crossVectors(backward, right);   // = (0, sin t, -cos t)
  cam.up.copy(up);
  cam.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, backward));
}

// Builds an orthographic camera facing one of the goals from outside the field.
// side: 'left' (goal at -HW, camera looks +X) | 'right' (goal at +HW, looks -X)
//
// Pan mapping (same grab-world-and-drag convention as the overview camera):
//   panX → screen-horizontal offset  (world +Z for left-goal, world -Z for right-goal)
//   panZ → screen-vertical offset    (along the camera's up-vector)
export function makeGoalCamera(side, W, H) {
  const t = CAM_TILT_GOAL;
  const aspect = W / H;
  // Show the full penalty-area width plus a small margin.
  const baseHalf = C.BAW / 2 + 10;
  goalCamHalfH = baseHalf;
  goalCamHalfV = baseHalf / aspect;
  const halfX = baseHalf * zoomFactor;
  const halfY = goalCamHalfV * zoomFactor;

  const cam = new THREE.OrthographicCamera(-halfX, halfX, halfY, -halfY, 0.1, 600);

  const dist = 150;
  const goalX = side === 'left' ? -C.HW : C.HW;
  const sign  = side === 'left' ? -1 : 1;

  if (side === 'left') {
    // screen-right = world +Z;  up = (sin t, cos t, 0)
    // panX shifts camera in Z; panZ shifts camera along up (negated to match drag convention).
    const upX = Math.sin(t), upY = Math.cos(t);
    cam.position.set(
      goalX + sign * dist * Math.cos(t) - panZ * upX,
      dist * Math.sin(t) - panZ * upY,
      panX
    );
    const right    = new THREE.Vector3(0, 0, 1);
    const backward = new THREE.Vector3(-Math.cos(t), Math.sin(t), 0);
    const up       = new THREE.Vector3().crossVectors(backward, right);
    cam.up.copy(up);
    cam.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, backward));
  } else {
    // screen-right = world -Z;  up = (-sin t, cos t, 0)
    // panX shifts camera in -Z; panZ shifts camera along up (negated).
    const upX = -Math.sin(t), upY = Math.cos(t);
    cam.position.set(
      goalX + sign * dist * Math.cos(t) - panZ * upX,
      dist * Math.sin(t) - panZ * upY,
      -panX
    );
    const right    = new THREE.Vector3(0, 0, -1);
    const backward = new THREE.Vector3(Math.cos(t), Math.sin(t), 0);
    const up       = new THREE.Vector3().crossVectors(backward, right);
    cam.up.copy(up);
    cam.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, backward));
  }

  return cam;
}

// Rebuilds the camera in place at the current viewport size, dispatching to
// the right builder based on camMode.
export function refreshCamera() {
  const wrap = document.getElementById('canvas-wrap');
  const W = wrap.clientWidth, H = wrap.clientHeight;
  const nc = camMode === 'overview'
    ? makeOrthoCamera(W, H)
    : makeGoalCamera(camMode === 'goal-left' ? 'left' : 'right', W, H);
  camera.position.copy(nc.position);
  camera.up.copy(nc.up);
  camera.quaternion.copy(nc.quaternion);
  ['left','right','top','bottom'].forEach(k => camera[k] = nc[k]);
  camera.updateProjectionMatrix();
}

export function initCameraButtons() {
  const overviewBtn  = document.getElementById('cam-overview-btn');
  const goalLeftBtn  = document.getElementById('cam-goal-left-btn');
  const goalRightBtn = document.getElementById('cam-goal-right-btn');

  const updateActive = () => {
    overviewBtn .classList.toggle('cam-active', camMode === 'overview');
    goalLeftBtn .classList.toggle('cam-active', camMode === 'goal-left');
    goalRightBtn.classList.toggle('cam-active', camMode === 'goal-right');
  };

  const updateOverviewLabel = () => {
    overviewBtn.textContent = camTilt === CAM_TILT_TOP ? '📷 Vista de cima' : '📷 Vista geral';
  };

  overviewBtn.addEventListener('click', () => {
    if (camMode === 'overview') {
      // Already in overview: cycle between top-down and isometric tilt.
      camTilt = camTilt === CAM_TILT_TOP ? CAM_TILT_ISO : CAM_TILT_TOP;
      updateOverviewLabel();
    } else {
      camMode = 'overview';
      updateActive();
    }
    refreshCamera();
  });

  goalLeftBtn.addEventListener('click', () => {
    camMode = 'goal-left';
    panX = 0; panZ = 0;
    updateActive();
    refreshCamera();
  });

  goalRightBtn.addEventListener('click', () => {
    camMode = 'goal-right';
    panX = 0; panZ = 0;
    updateActive();
    refreshCamera();
  });

  // Initialise label and active state for the default mode.
  updateOverviewLabel();
  updateActive();
}

export function resetView() {
  panX = 0; panZ = 0;
  zoomFactor = 1.0;
  refreshCamera();
}

export function initZoom() {
  const applyZoom = (delta) => {
    zoomFactor = Math.min(Math.max(zoomFactor + delta, ZOOM_MIN), ZOOM_MAX);
    refreshCamera();
  };

  // Mouse wheel
  window.addEventListener('wheel', (e) => {
    e.preventDefault();
    applyZoom(e.deltaY > 0 ? ZOOM_STEP : -ZOOM_STEP);
  }, { passive: false });

  document.getElementById('zoom-in-btn').addEventListener('click',   () => applyZoom(-ZOOM_STEP * 2));
  document.getElementById('zoom-out-btn').addEventListener('click',  () => applyZoom( ZOOM_STEP * 2));
  document.getElementById('reset-view-btn').addEventListener('click', resetView);
}

export function initPan() {
  let panning = false;
  let lastClientX = 0, lastClientY = 0;

  const onDown = (e) => {
    if (e.button !== 1 && e.button !== 2) return;
    e.preventDefault();
    panning = true;
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    document.body.style.cursor = 'grabbing';
  };

  const onMove = (e) => {
    if (!panning) return;
    const dx = e.clientX - lastClientX;
    const dy = e.clientY - lastClientY;
    lastClientX = e.clientX;
    lastClientY = e.clientY;

    const wrap = document.getElementById('canvas-wrap');
    // Pick the base half-extents that match the active camera so the drag
    // speed is always 1 world-unit-per-pixel regardless of mode.
    const hH = camMode === 'overview' ? viewHalfX  : goalCamHalfH;
    const hV = camMode === 'overview' ? viewHalfZ  : goalCamHalfV;
    const wPerPxX = (hH * zoomFactor * 2) / wrap.clientWidth;
    const wPerPxZ = (hV * zoomFactor * 2) / wrap.clientHeight;

    panX -= dx * wPerPxX;
    panZ -= dy * wPerPxZ;
    refreshCamera();
  };

  const onUp = () => {
    if (!panning) return;
    panning = false;
    document.body.style.cursor = '';
  };

  const canvas = document.getElementById('canvas');
  canvas.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  // Suppress right-click context menu on the canvas so right-drag works cleanly.
  canvas.addEventListener('contextmenu', e => e.preventDefault());
}

function setupLights() {
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));

  const sun = new THREE.DirectionalLight(0xfff8e1, 0.9);
  sun.position.set(60, 100, 40);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left:-120, right:120, top:80, bottom:-80, near:.5, far:400 });
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.001;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0x4488cc, 0.35);
  fill.position.set(-60, 60, -40);
  scene.add(fill);
}

window.addEventListener('resize', () => {
  const wrap = document.getElementById('canvas-wrap');
  const W = wrap.clientWidth, H = wrap.clientHeight;
  renderer.setSize(W, H);
  refreshCamera();
});

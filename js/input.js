import { camera, renderer, scene, multiTouchActive, onMultiTouchStart, panByPixels } from './scene.js';
import { C } from './constants.js';
import { GROUP } from './physics.js';

// ─────────────────────────────────────────────
// INPUT  (hover + click-and-drag slingshot + keeper reposition)
// ─────────────────────────────────────────────
export const INPUT = {
  MAX_DRAG: 28,       // world units of pull at which force is fully maxed out (larger = more precision)
  MIN_DRAG: 0.4,      // below this, release counts as a no-op click (not a shot)
  MAX_IMPULSE: 350,    // impulse magnitude applied at full draw
  DRAG_LIFT: 4,       // how high (world units) a piece floats above the board mid-reposition
  TRAJ_DOTS: 14,      // number of trajectory preview dots
  TRAJ_MAX_DIST: 55,  // world units the trajectory preview extends at full force
};

export class InputHandler {
  constructor(players, rules, multiplayer = null) {
    this.players = players;
    this.rules = rules;        // Game instance — canDrag/isReposition/onShotFired/onReposition
    this.multiplayer = multiplayer;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.07);

    this.hovered = null;
    this.dragging = null;     // Player currently being dragged (shot aim or keeper reposition)
    this.dragMode = null;     // 'shot' | 'reposition'
    this.anchor = null;       // THREE.Vector3 — piece position when drag started
    this.pendingDir = null;   // THREE.Vector3 — current drag vector (anchor → cursor)

    // Multiplayer: true while dragging our own keeper as a spectator (no local
    // physics authority) — the position is mirrored to the opponent instead
    // of being resolved by our own (paused) physics simulation.
    this._dragIsRemoteKeeper = false;
    this._lastKeeperSendTime = 0;

    // Single-finger pan: active while a touch that didn't land on a
    // draggable piece is dragging across empty field/board.
    this._panTouch = null;

    this._buildForceLine();
    this._buildTrajectory();

    const dom = renderer.domElement;
    dom.addEventListener('mousemove', e => this._onMove(e));
    dom.addEventListener('mousedown', e => this._onDown(e));
    window.addEventListener('mouseup', e => this._onUp(e));
    dom.addEventListener('touchstart', e => {
      if (e.touches.length > 1) return;   // 2nd finger: scene.js owns pinch/pan
      e.preventDefault();
      const started = this._onDown(this._touchToMouse(e));
      if (!started) {
        const t = e.touches[0];
        this._panTouch = { x: t.clientX, y: t.clientY };
      }
    }, { passive: false });
    dom.addEventListener('touchmove', e => {
      if (multiTouchActive || e.touches.length > 1) return;
      e.preventDefault();
      if (this._panTouch) {
        const t = e.touches[0];
        panByPixels(t.clientX - this._panTouch.x, t.clientY - this._panTouch.y);
        this._panTouch.x = t.clientX;
        this._panTouch.y = t.clientY;
        return;
      }
      this._onMove(this._touchToMouse(e));
    }, { passive: false });
    dom.addEventListener('touchend', e => {
      if (multiTouchActive) return;
      e.preventDefault();
      if (this._panTouch) { this._panTouch = null; return; }
      this._onUp();
    }, { passive: false });

    // A second finger just landed mid-drag: abandon the drag with no shot
    // fired (piece stays put) so it doesn't fight the pinch/pan gesture.
    onMultiTouchStart(() => { this._cancelDrag(); this._panTouch = null; });
  }

  _cancelDrag() {
    if (!this.dragging) return;
    const piece = this.dragging;
    if (this.dragMode === 'reposition') {
      piece.physBody.collisionFilterMask = GROUP.PLAYER | GROUP.BALL;
      piece.physBody.position.y = piece.restY;
      piece.group.position.y = 0;
    } else {
      this.forceLine.visible = false;
      this.trajDots.visible = false;
    }
    this.dragging = null;
    this.dragMode = null;
    this._setCursor('default');
  }

  _touchToMouse(e) {
    const t = e.touches[0] || e.changedTouches[0];
    return { clientX: t.clientX, clientY: t.clientY, button: 0 };
  }

  _buildForceLine() {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.lineMat = new THREE.LineDashedMaterial({ color: 0x33ff33, dashSize: 0.8, gapSize: 0.5, linewidth: 2 });
    this.forceLine = new THREE.Line(geo, this.lineMat);
    this.forceLine.visible = false;
    scene.add(this.forceLine);
  }

  _buildTrajectory() {
    const N = INPUT.TRAJ_DOTS;
    const positions = new Float32Array(N * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    // Varying sizes: dots closer to player are larger, fade into smaller ones
    const sizes = new Float32Array(N);
    for (let i = 0; i < N; i++) sizes[i] = Math.max(0.6, 2.2 * (1 - i / N));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    this.trajMat = new THREE.PointsMaterial({
      color: 0xffffff, size: 1.9, transparent: true, opacity: 0.92,
      sizeAttenuation: true, depthTest: false,
    });
    this.trajDots = new THREE.Points(geo, this.trajMat);
    this.trajDots.visible = false;
    this.trajDots.renderOrder = 1;
    scene.add(this.trajDots);
  }

  _updateMouseNDC(e) {
    const rect = renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  _groundPoint() {
    this.raycaster.setFromCamera(this.mouse, camera);
    const pt = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(this.groundPlane, pt);
    return pt;
  }

  _forceColor(t) {
    const green = new THREE.Color(0x33ff33);
    const yellow = new THREE.Color(0xffee33);
    const red = new THREE.Color(0xff3333);
    return t < 0.5 ? green.lerp(yellow, t / 0.5) : yellow.lerp(red, (t - 0.5) / 0.5);
  }

  // High-contrast palette for trajectory dots — white at low force (stands out on dark
  // green field), through bright yellow, to vivid orange at full power.
  _trajColor(t) {
    const white  = new THREE.Color(0xffffff);
    const yellow = new THREE.Color(0xffee00);
    const orange = new THREE.Color(0xff6600);
    return t < 0.5 ? white.lerp(yellow, t / 0.5) : yellow.lerp(orange, (t - 0.5) / 0.5);
  }

  _pieceAt(e) {
    this._updateMouseNDC(e);
    this.raycaster.setFromCamera(this.mouse, camera);
    const hits = this.raycaster.intersectObjects(this.players.map(p => p.body));
    return hits.length ? hits[0].object.userData.playerObj : null;
  }

  _onMove(e) {
    this._updateMouseNDC(e);

    if (this.dragging) {
      if (this.dragMode === 'shot') this._updateDrag(this._groundPoint());
      else this._updateReposition(this._groundPoint());
      return;
    }

    this.raycaster.setFromCamera(this.mouse, camera);
    const hits = this.raycaster.intersectObjects(this.players.map(p => p.body));
    if (this.hovered) { this.hovered.setHighlight(false); this.hovered = null; }
    let cursor = this.rules.hasPendingReposition ? (this.rules.hasPendingReposition() ? 'move' : 'default') : 'default';
    if (hits.length) {
      const obj = hits[0].object.userData.playerObj;
      if (obj && this.rules.canDrag(obj)) {
        obj.setHighlight(true);
        this.hovered = obj;
        cursor = this.rules.isReposition(obj) ? 'move' : 'grab';
      }
    }
    this._setCursor(cursor);
  }

  _setCursor(cursor) {
    renderer.domElement.style.cursor = cursor;
  }

  _onDown(e) {
    if (e.button !== 0 || this.dragging) return;

    const piece = this._pieceAt(e);
    console.log('[Input] Piece at cursor:', piece?.team, piece?.playerIndex);

    if (!piece) {
      console.log('[Input] No piece at cursor');
      return;
    }

    // Block input if multiplayer and not my turn — except our own keeper,
    // who (like in singleplayer) can be repositioned at any time, even while
    // the opponent holds physics authority. That case is handled specially
    // below since our local physics is paused while spectating.
    const mp = this.multiplayer;
    const isOwnFreeKeeper = mp && mp.isActive && piece.isKeeper && piece.team === mp.myTeam;
    if (mp && mp.isActive && !mp.isMyTurn && !isOwnFreeKeeper) {
      console.log('[Input] Not my turn, blocking input');
      return;
    }

    if (!this.rules.canDrag(piece)) {
      console.log('[Input] Cannot drag piece:', piece.team, piece.playerIndex);
      return;
    }

    this.dragging = piece;
    this.dragMode = this.rules.isReposition(piece) ? 'reposition' : 'shot';
    this._dragIsRemoteKeeper = !!(mp && mp.isActive && !mp.isAuthority && isOwnFreeKeeper);
    this._setCursor(this.dragMode === 'reposition' ? 'move' : 'grabbing');

    if (this.dragMode === 'shot') {
      this.anchor = new THREE.Vector3(piece.group.position.x, 0.07, piece.group.position.z);
      this.pendingDir = new THREE.Vector3();
      this.forceLine.visible = true;
    } else {
      // Fully "suspend" the piece for the whole free-reposition drag
      // (keeper, restart-kick placement, or dragging a stray piece back
      // in): lift it above board height and drop its collision mask to
      // nothing, so it can be slid straight through the ball *and* other
      // players without touching/knocking any of them. Both are undone in
      // _onUp once the piece is set back down.
      piece.physBody.collisionFilterMask = 0;
      piece.physBody.position.y = piece.restY + INPUT.DRAG_LIFT;
      piece.group.position.y = INPUT.DRAG_LIFT;
    }
    return true;
  }

  _updateDrag(pt) {
    if (!pt) return;
    const dragVec = new THREE.Vector3(pt.x - this.anchor.x, 0, pt.z - this.anchor.z);
    let len = dragVec.length();
    if (len > INPUT.MAX_DRAG) { dragVec.setLength(INPUT.MAX_DRAG); len = INPUT.MAX_DRAG; }

    const end = new THREE.Vector3(this.anchor.x + dragVec.x, 0.07, this.anchor.z + dragVec.z);
    const pos = this.forceLine.geometry.attributes.position;
    pos.setXYZ(0, this.anchor.x, 0.07, this.anchor.z);
    pos.setXYZ(1, end.x, 0.07, end.z);
    pos.needsUpdate = true;
    this.forceLine.geometry.computeBoundingSphere();
    this.forceLine.computeLineDistances();

    const t = len / INPUT.MAX_DRAG;
    const col = this._forceColor(t);
    this.lineMat.color.copy(col);
    this.pendingDir = dragVec;

    this._updateTrajectory(t, dragVec, col);
  }

  _updateTrajectory(t, dragVec, col) {
    if (dragVec.length() < 0.01) { this.trajDots.visible = false; return; }
    const N = INPUT.TRAJ_DOTS;
    const dir = dragVec.clone().normalize().negate(); // shot direction
    const maxDist = t * INPUT.TRAJ_MAX_DIST;

    const arr = this.trajDots.geometry.attributes.position.array;
    for (let i = 0; i < N; i++) {
      // Quadratic easing: dots bunch near origin (deceleration effect)
      const p = (i + 1) / N;
      const dist = maxDist * (1 - Math.pow(1 - p, 2));
      arr[i * 3]     = this.anchor.x + dir.x * dist;
      arr[i * 3 + 1] = 0.1;
      arr[i * 3 + 2] = this.anchor.z + dir.z * dist;
    }
    this.trajDots.geometry.attributes.position.needsUpdate = true;
    this.trajMat.color.copy(this._trajColor(t));
    this.trajMat.opacity = 0.75 + t * 0.2;  // more opaque as force increases
    this.trajDots.visible = true;
  }

  // Free drag: follows the cursor directly, no slingshot aim line, no
  // impulse — just a live reposition. The only clamp left is the defending
  // keeper's own small area (a deliberate game rule, not a leftover field
  // boundary) — every other free reposition (restart-kick placement,
  // dragging a stray piece back in) follows the cursor with no clamp at
  // all, on or off the pitch, since there's no perimeter wall anymore.
  _updateReposition(pt) {
    if (!pt || !this.dragging) return;
    const piece = this.dragging;
    const isDefendingKeeper = piece.isKeeper && piece.team !== this.rules.possession;
    const { x, z } = isDefendingKeeper ? this._clampKeeper(piece, pt.x, pt.z) : pt;
    const body = piece.physBody;
    body.position.x = x;
    body.position.z = z;
    body.velocity.set(0, 0, 0);

    // Spectating while dragging our own keeper: our physics is paused (the
    // opponent is the authority), so mirror this position to them instead —
    // they apply it directly to their live simulation of this piece.
    if (this._dragIsRemoteKeeper) this._sendKeeperPosition(piece, x, z);
  }

  _sendKeeperPosition(piece, x, z, force = false) {
    const mp = this.multiplayer;
    if (!mp) return;
    const now = performance.now();
    if (!force && now - this._lastKeeperSendTime < 50) return;   // throttle to ~20 Hz
    this._lastKeeperSendTime = now;
    mp.emitKeeperReposition(this.players.indexOf(piece), x, z);
  }

  _clampKeeper(piece, x, z) {
    const sign = piece.team === 'yellow' ? -1 : 1;   // yellow defends -HW, blue defends +HW
    const gx = sign * C.HW;
    const halfD = C.KEEP_D / 2, halfW = C.KEEP_W / 2;
    const minX = sign < 0 ? gx + halfD : gx - C.SAD + halfD;
    const maxX = sign < 0 ? gx + C.SAD - halfD : gx - halfD;
    const limZ = C.SAW / 2 - halfW;
    return {
      x: Math.min(Math.max(x, minX), maxX),
      z: Math.min(Math.max(z, -limZ), limZ),
    };
  }

  _onUp() {
    if (!this.dragging) return;
    const piece = this.dragging;
    const mode = this.dragMode;
    this.dragging = null;
    this.dragMode = null;
    this._setCursor(this.hovered
      ? (this.rules.isReposition(piece) ? 'move' : 'grab')
      : (this.rules.hasPendingReposition && this.rules.hasPendingReposition() ? 'move' : 'default'));

    if (mode === 'reposition') {
      // Set back down: re-enable collisions with everyone and drop it back
      // to board height before handing control back to Game.
      piece.physBody.collisionFilterMask = GROUP.PLAYER | GROUP.BALL;
      piece.physBody.position.y = piece.restY;
      piece.group.position.y = 0;
      this.rules.onReposition(piece);
      if (this._dragIsRemoteKeeper) {
        this._sendKeeperPosition(piece, piece.physBody.position.x, piece.physBody.position.z, true);
        this._dragIsRemoteKeeper = false;
      }
      return;
    }

    this.forceLine.visible = false;
    this.trajDots.visible = false;
    const dragVec = this.pendingDir || new THREE.Vector3();
    const len = dragVec.length();

    if (len < INPUT.MIN_DRAG) return;   // tiny accidental drag — no shot fired

    const t = Math.min(len / INPUT.MAX_DRAG, 1);
    const impulseMag = t * INPUT.MAX_IMPULSE;
    const dir = dragVec.clone().normalize().negate();   // slingshot: fires opposite the pull

    const impulse = { x: dir.x * impulseMag, y: 0, z: dir.z * impulseMag };

    // A física roda sempre no cliente que chuta: em modo local somos a única
    // simulação; em multiplayer somos o dono da vez (autoridade) — o input só
    // chega até aqui quando isMyTurn é true. O movimento resultante viaja
    // para o oponente via snapshots (physics_state).
    piece.physBody.velocity.set(0, 0, 0);
    piece.physBody.applyImpulse(
      new CANNON.Vec3(impulse.x, impulse.y, impulse.z),
      piece.physBody.position
    );
    this.rules.onShotFired(piece, impulse);
  }
}

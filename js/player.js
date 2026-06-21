import { C } from './constants.js';
import { scene } from './scene.js';
import { makePlayerTexture } from './textures.js';

// ─────────────────────────────────────────────
// PLAYER  (field button or goalkeeper bar)
// ─────────────────────────────────────────────
export class Player {
  constructor({ team, teamId, isKeeper, x, z, playerIndex = 1 }) {
    this.team = team;             // 'yellow' | 'blue' (slot interno)
    this.teamId = teamId || team; // id do time real (ex: 'flamengo')
    this.isKeeper = isKeeper;
    this.playerIndex = playerIndex;
    this.initPos = { x, z };
    this.highlighted = false;
    this.body = null;             // THREE.Mesh — main coloured piece (raycast target)
    this.physBody = null;         // CANNON.Body — set by Physics.addPlayerBody()
    this.restY = 0;

    this.group = new THREE.Group();
    this.group.position.set(x, 0, z);

    if (isKeeper) this._buildKeeper();
    else          this._buildFieldPlayer();

    this.body.userData.playerObj = this;
    scene.add(this.group);
  }

  _teamColor() { return this.team === 'yellow' ? C.COL_Y : C.COL_B; }
  _rimColor()  { return this.team === 'yellow' ? C.RIM_Y : C.RIM_B; }

  _buildFieldPlayer() {
    const R = C.PLAYER_R, H = C.PLAYER_H;
    const col = this._teamColor(), rimCol = this._rimColor();

    // Rim — darker ring, slightly larger, reads as a bevel/border
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(R + C.PLAYER_RIM, R + C.PLAYER_RIM, H, 32),
      new THREE.MeshPhongMaterial({ color: rimCol })
    );
    rim.position.y = H / 2;
    rim.castShadow = true;
    this.group.add(rim);

    // Button body — solid team colour (the sticker sits on top of this)
    this.body = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, H + 0.1, 32),
      new THREE.MeshPhongMaterial({ color: col, emissive: 0x000000, shininess: 60 })
    );
    this.body.position.y = H / 2 + 0.05;
    this.body.castShadow = true;
    this.group.add(this.body);

    // Sticker — flat disc glued on top, leaves a thin colour border visible
    const tex = makePlayerTexture(this.playerIndex, this._teamColor(), this.teamId);
    const sticker = new THREE.Mesh(
      new THREE.CircleGeometry(R * 0.88, 48),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true })
    );
    sticker.rotation.x = -Math.PI / 2;
    sticker.position.y = H + 0.13;   // sits just above the button surface
    this.group.add(sticker);
  }

  _buildKeeper() {
    // BoxGeometry(x-size, y-size, z-size): KEEP_D runs along X (field depth),
    // KEEP_W runs along Z (spans the goal mouth).
    const H = C.KEEP_H;
    const rimCol = this._rimColor();
    const keeperCol = this._teamColor();

    const rim = new THREE.Mesh(
      new THREE.BoxGeometry(C.KEEP_D + C.KEEP_RIM, H, C.KEEP_W + C.KEEP_RIM),
      new THREE.MeshPhongMaterial({ color: rimCol })
    );
    rim.position.y = H / 2;
    rim.castShadow = true;
    this.group.add(rim);

    this.body = new THREE.Mesh(
      new THREE.BoxGeometry(C.KEEP_D, H + 0.1, C.KEEP_W),
      new THREE.MeshPhongMaterial({ color: keeperCol, emissive: 0x000000, shininess: 50 })
    );
    this.body.position.y = H / 2 + 0.05;
    this.body.castShadow = true;
    this.group.add(this.body);

    // White stripe on top — marks it as the goalkeeper
    const stripe = new THREE.Mesh(
      new THREE.PlaneGeometry(C.KEEP_D * 0.6, C.KEEP_W),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 })
    );
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.y = H + 0.11;
    this.group.add(stripe);
  }

  setHighlight(on) {
    if (this.highlighted === on) return;
    this.highlighted = on;
    this.body.material.emissive.set(on ? 0x3a3a3a : 0x000000);
  }

  reset() {
    this.group.position.set(this.initPos.x, 0, this.initPos.z);
    this.group.rotation.set(0, 0, 0);
    if (this.physBody) {
      this.physBody.position.set(this.initPos.x, this.restY, this.initPos.z);
      this.physBody.velocity.set(0, 0, 0);
      this.physBody.angularVelocity.set(0, 0, 0);
      this.physBody.quaternion.set(0, 0, 0, 1);
    }
  }
}

import { C } from './constants.js';
import { scene } from './scene.js';

// ─────────────────────────────────────────────
// GOAL  (posts, crossbar with physics, net impact effects)
// ─────────────────────────────────────────────
export class Goal {
  constructor(physics, gx, facingRight) {
    this.physics = physics;
    this.gx = gx;                          // goal X position
    this.nd = facingRight ? 1 : -1;       // net direction along X
    this.bx = gx + this.nd * C.GD;        // back of net X

    this.group = new THREE.Group();
    this.netMeshes = [];  // track net planes for impact effects
    this.impactAnimations = [];  // track active impact animations

    // Track ball interactions with the goal
    this.ballCollisions = { posts: 0, bars: 0, nets: 0 };
    this.ballInGoalZone = false;

    this._buildVisuals();
    this._buildPhysics();
    scene.add(this.group);
  }

  _buildVisuals() {
    const wMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const nMat = new THREE.MeshBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.18, side: THREE.DoubleSide });
    const gnd  = new THREE.MeshLambertMaterial({ color: 0x1f5e1f });

    const postGeo  = new THREE.CylinderGeometry(C.PR, C.PR, C.GH + C.PR, 8);
    const cbarGeo  = new THREE.CylinderGeometry(C.PR, C.PR, C.GW + C.PR*2, 8);

    // Front posts (at goal line)
    for (const sz of [-1, 1]) {
      const p = new THREE.Mesh(postGeo, wMat);
      p.position.set(this.gx, C.GH/2, sz * C.GW/2);
      p.castShadow = true;
      p.userData.goalPart = 'post-front';
      this.group.add(p);
    }

    // Crossbar
    const cb = new THREE.Mesh(cbarGeo, wMat);
    cb.rotation.x = Math.PI / 2;   // Y → Z
    cb.position.set(this.gx, C.GH, 0);
    cb.castShadow = true;
    cb.userData.goalPart = 'crossbar';
    this.group.add(cb);

    // Back posts
    for (const sz of [-1, 1]) {
      const p = new THREE.Mesh(postGeo, wMat);
      p.position.set(this.bx, C.GH/2, sz * C.GW/2);
      p.castShadow = true;
      p.userData.goalPart = 'post-back';
      this.group.add(p);
    }

    // ── Net panels ──
    // Back net (perpendicular to X)
    const backN = new THREE.Mesh(new THREE.PlaneGeometry(C.GW, C.GH, 4, 4), nMat);
    backN.rotation.y = Math.PI / 2;
    backN.position.set(this.bx, C.GH/2, 0);
    backN.userData.goalPart = 'net-back';
    this.netMeshes.push(backN);
    this.group.add(backN);

    // Side nets (parallel to XZ-plane, at ±GW/2)
    for (const sz of [-1, 1]) {
      const sn = new THREE.Mesh(new THREE.PlaneGeometry(C.GD, C.GH, 4, 4), nMat);
      sn.position.set(this.gx + this.nd * C.GD/2, C.GH/2, sz * C.GW/2);
      sn.userData.goalPart = 'net-side';
      this.netMeshes.push(sn);
      this.group.add(sn);
    }

    // Top net (horizontal, at Y = GH)
    const tn = new THREE.Mesh(new THREE.PlaneGeometry(C.GD, C.GW, 4, 4), nMat);
    tn.rotation.x = -Math.PI / 2;
    tn.position.set(this.gx + this.nd * C.GD/2, C.GH, 0);
    tn.userData.goalPart = 'net-top';
    this.netMeshes.push(tn);
    this.group.add(tn);

    // Ground inside net (darker green)
    const gr = new THREE.Mesh(new THREE.PlaneGeometry(C.GD, C.GW), gnd);
    gr.rotation.x = -Math.PI / 2;
    gr.position.set(this.gx + this.nd * C.GD/2, 0.002, 0);
    this.group.add(gr);
  }

  _buildPhysics() {
    const GROUP = { PLAYER: 1, BALL: 2, BALL_WALL: 8, FAR_WALL: 16, NET: 32 };

    // Posts and crossbar as static bodies (can be hit but don't move)
    const postRadius = C.PR;
    const postHeight = C.GH + C.PR;

    // Front posts (at goal line)
    for (const sz of [-1, 1]) {
      this._addPostBody(this.gx, sz * C.GW/2, postRadius, postHeight);
    }

    // Crossbar (horizontal cylinder along Z)
    const barRadius = C.PR;
    const barLength = C.GW + C.PR * 2;

    const barBody = new CANNON.Body({ mass: 0, material: this.physics.matPiece });
    barBody.addShape(
      new CANNON.Cylinder(barRadius, barRadius, barLength, 8),
      new CANNON.Vec3(),
      new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(1, 0, 0), Math.PI / 2)
    );
    barBody.position.set(this.gx, C.GH, 0);
    barBody.collisionFilterGroup = 0;  // static, no collisions group
    barBody.collisionFilterMask = GROUP.BALL | GROUP.PLAYER;
    barBody.userData = { goalPart: 'crossbar' };

    barBody.addEventListener('collide', (e) => {
      this._onImpact(e, 'crossbar');
    });

    this.physics.world.addBody(barBody);

    // Back posts
    for (const sz of [-1, 1]) {
      this._addPostBody(this.bx, sz * C.GW/2, postRadius, postHeight);
    }

    // ── Net collision bodies ──
    this._addNetBodies(GROUP);
  }

  _addPostBody(x, z, radius, height) {
    const GROUP = { PLAYER: 1, BALL: 2, BALL_WALL: 8, FAR_WALL: 16 };

    const body = new CANNON.Body({ mass: 0, material: this.physics.matPiece });
    body.addShape(new CANNON.Cylinder(radius, radius, height, 8));
    body.position.set(x, height / 2, z);
    body.collisionFilterGroup = 0;  // static
    body.collisionFilterMask = GROUP.BALL | GROUP.PLAYER;
    body.userData = { goalPart: 'post' };

    body.addEventListener('collide', (e) => {
      this._onImpact(e, 'post');
    });

    this.physics.world.addBody(body);
  }

  _addNetBodies(GROUP) {
    // Back net — wall perpendicular to X at the back of the goal
    // Half-extents: thin in X, full height in Y, full width in Z
    const backNetBody = new CANNON.Body({ mass: 0, material: this.physics.matNet });
    backNetBody.addShape(new CANNON.Box(new CANNON.Vec3(0.15, C.GH / 2, C.GW / 2)));
    backNetBody.position.set(this.bx, C.GH / 2, 0);
    backNetBody.collisionFilterGroup = GROUP.NET;
    backNetBody.collisionFilterMask = GROUP.BALL;
    backNetBody.userData = { goalPart: 'net-back' };
    backNetBody.addEventListener('collide', (e) => {
      this._onImpact(e, 'net-back');
    });
    this.physics.world.addBody(backNetBody);

    // Side nets — walls perpendicular to Z at ±GW/2
    // Half-extents: full depth in X, full height in Y, thin in Z
    for (const sz of [-1, 1]) {
      const sideNetBody = new CANNON.Body({ mass: 0, material: this.physics.matNet });
      sideNetBody.addShape(new CANNON.Box(new CANNON.Vec3(C.GD / 2, C.GH / 2, 0.15)));
      sideNetBody.position.set(this.gx + this.nd * C.GD / 2, C.GH / 2, sz * C.GW / 2);
      sideNetBody.collisionFilterGroup = GROUP.NET;
      sideNetBody.collisionFilterMask = GROUP.BALL;
      sideNetBody.userData = { goalPart: 'net-side' };
      sideNetBody.addEventListener('collide', (e) => {
        this._onImpact(e, 'net-side');
      });
      this.physics.world.addBody(sideNetBody);
    }

    // Top net — ceiling perpendicular to Y at GH
    // Half-extents: full depth in X, thin in Y, full width in Z
    const topNetBody = new CANNON.Body({ mass: 0, material: this.physics.matNet });
    topNetBody.addShape(new CANNON.Box(new CANNON.Vec3(C.GD / 2, 0.15, C.GW / 2)));
    topNetBody.position.set(this.gx + this.nd * C.GD / 2, C.GH, 0);
    topNetBody.collisionFilterGroup = GROUP.NET;
    topNetBody.collisionFilterMask = GROUP.BALL;
    topNetBody.userData = { goalPart: 'net-top' };
    topNetBody.addEventListener('collide', (e) => {
      this._onImpact(e, 'net-top');
    });
    this.physics.world.addBody(topNetBody);
  }

  _onImpact(e, partType) {
    // The colliding body is e.body (the "other" body that hit this goal part)
    const collidingBody = e.body;
    const isBall = collidingBody.isBall === true;
    if (!isBall) return;

    // Track collision type
    if (partType.includes('post')) this.ballCollisions.posts++;
    else if (partType.includes('bar')) this.ballCollisions.bars++;
    else if (partType.includes('net')) this.ballCollisions.nets++;

    // Find closest net mesh and apply impact effect
    const ballPos = collidingBody.position;
    let closestNet = null;
    let minDist = Infinity;

    for (const net of this.netMeshes) {
      const netPos = net.position;
      const dist = Math.hypot(
        ballPos.x - netPos.x,
        ballPos.y - netPos.y,
        ballPos.z - netPos.z
      );
      if (dist < minDist) {
        minDist = dist;
        closestNet = net;
      }
    }

    if (closestNet) {
      this._createImpactEffect(closestNet, ballPos);
    }
  }

  _createImpactEffect(netMesh, ballPos) {
    // Store original positions if not already done
    if (!netMesh.userData.originalPositions) {
      const geo = netMesh.geometry;
      const positions = geo.attributes.position.array;
      netMesh.userData.originalPositions = new Float32Array(positions);
    }

    // Create ripple/deformation animation
    const animation = {
      mesh: netMesh,
      startTime: Date.now(),
      duration: 300,  // ms
      ballPos: new CANNON.Vec3(ballPos.x, ballPos.y, ballPos.z),
      intensity: 1.0
    };

    this.impactAnimations.push(animation);
  }

  // Check if a ball position is in the goal zone (valid goal area)
  // Returns true if the ball is between the posts and within goal height
  isInGoalZone(ballPos) {
    const inZ = Math.abs(ballPos.z) < C.GW / 2 + 0.3;  // within goal mouth
    const inY = ballPos.y >= 0 && ballPos.y <= C.GH;    // between ground and crossbar
    return inZ && inY;
  }

  // Check if a ball passed through the goal (without hitting posts/crossbar)
  // Used to validate that a goal is legitimate
  didBallPassCleanly() {
    return this.ballCollisions.posts === 0 && this.ballCollisions.bars === 0;
  }

  // Reset collision tracking when ball is respawned or reset
  resetCollisionTracking() {
    this.ballCollisions = { posts: 0, bars: 0, nets: 0 };
    this.ballInGoalZone = false;
  }

  update() {
    const now = Date.now();
    const dead = [];

    for (let i = 0; i < this.impactAnimations.length; i++) {
      const anim = this.impactAnimations[i];
      const elapsed = now - anim.startTime;
      const progress = Math.min(elapsed / anim.duration, 1.0);

      if (progress >= 1.0) {
        // Animation finished — restore original positions
        const geo = anim.mesh.geometry;
        geo.attributes.position.array.set(anim.mesh.userData.originalPositions);
        geo.attributes.position.needsUpdate = true;
        dead.push(i);
      } else {
        // Apply deformation based on progress
        this._updateNetDeformation(anim.mesh, anim.ballPos, progress);
      }
    }

    // Remove finished animations (in reverse order to preserve indices)
    for (let i = dead.length - 1; i >= 0; i--) {
      this.impactAnimations.splice(dead[i], 1);
    }
  }

  _updateNetDeformation(netMesh, ballPos, progress) {
    const geo = netMesh.geometry;
    const pos = geo.attributes.position.array;
    const orig = netMesh.userData.originalPositions;

    // Ease-out animation (fast start, slow end)
    const easeOut = 1 - (1 - progress) * (1 - progress);
    const deformStr = (1 - easeOut) * 0.8;  // max deformation strength

    // Get world position of mesh to calculate distance properly
    const meshWorldPos = new THREE.Vector3();
    netMesh.getWorldPosition(meshWorldPos);

    for (let i = 0; i < pos.length; i += 3) {
      const x = orig[i];
      const y = orig[i + 1];
      const z = orig[i + 2];

      // Distance from vertex to ball impact in local space
      const dx = x - (ballPos.x - meshWorldPos.x);
      const dy = y - (ballPos.y - meshWorldPos.y);
      const dz = z - (ballPos.z - meshWorldPos.z);
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      // Gaussian falloff — stronger near impact, fades outward
      const falloff = Math.exp(-(dist * dist) / 4);
      const deform = deformStr * falloff;

      // Push vertices outward from ball (away from impact)
      const nx = dx === 0 && dy === 0 && dz === 0 ? 0 : dx / (dist || 1);
      const ny = dy === 0 && dx === 0 && dz === 0 ? 0 : dy / (dist || 1);
      const nz = dz === 0 && dx === 0 && dy === 0 ? 0 : dz / (dist || 1);

      pos[i]     = orig[i] + nx * deform;
      pos[i + 1] = orig[i + 1] + ny * deform;
      pos[i + 2] = orig[i + 2] + nz * deform;
    }

    geo.attributes.position.needsUpdate = true;
  }
}

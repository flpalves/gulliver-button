import { C } from './constants.js';

// ─────────────────────────────────────────────
// PHYSICS  (Cannon.js)
// ─────────────────────────────────────────────
export const GROUP = {
  PLAYER:       1,
  BALL:         2,
  BALL_WALL:    8,    // the ball-only floor (catches vertical drift)
  FAR_WALL:     16,   // far-out perimeter at the edge of what the camera shows (see setFarWalls)
  NET:          32,   // goal net walls (back, sides, top) — bounces ball like a wall
  SHOWBOL_WALL: 64,   // perimeter boards at the field boundary (showbol mode only)
};

// How far inside the camera's visible edge the far wall sits, so a piece
// that slams into it still stops fully on-screen instead of clipping the
// literal frustum boundary. ~2.5x a field player's on-screen size.
const WALL_BUFFER = 2.5 * 2 * (C.PLAYER_R + C.PLAYER_RIM);

export const PHYS = {
  PLAYER_MASS: 4,
  KEEPER_MASS: 10,
  SPHERE_MASS: 0.15,       // mass of the sphere ball
  CUBE_MASS:   0.45,       // mass of the cube ball (3x heavier)
  LIN_DAMPING:      0.72,   // table-friction substitute for players/keeper
  BALL_LIN_DAMPING:        0.2,   // air drag (when airborne)
  BALL_GROUND_DAMPING:     0.82,  // rolling drag (when on the ground) — applied dynamically in step()
  BALL_ANG_DAMPING:        0.15,  // lighter touch — lets the ball keep spinning on its own axis
  CUBE_GROUND_DAMPING:     0.99,  // cube rolls shorter distances than the sphere
  CUBE_ANG_DAMPING:        0.99,  // cube stops spinning much faster after a hit
  CUBE_SPIN_FACTOR:        0.3,  // fraction of rolling spin applied to cube (1 = full, 0 = no spin)
  RESTITUTION_PIECE: 0.2,
  RESTITUTION_FLOOR: 0.65,  // gives the ball its little post-collision "quique"
  FRICTION_PIECE: 0.6,
  FRICTION_FLOOR: 2,         // contact friction on bounce — rolling drag is handled dynamically in step()
  // Pieces are flat buttons sliding on a table — they never need gravity.
  // The ball, though, can pick up stray vertical velocity from contacts
  // (its sphere centre sits higher than the players' cylinder top, so a
  // glancing hit can angle the contact normal slightly upward). With no
  // gravity that upward nudge never comes back down — the ball "floats".
  // Applying gravity to the ball alone, plus a floor it can bounce on,
  // fixes that while leaving the players' physics untouched. A lighter
  // ball + softer gravity lets that upward nudge actually carry it into
  // a visible little hop before it comes back down — and keeps it hanging
  // in the air a little longer once it does.
  SPHERE_GRAVITY: -45,     // gravity applied to the sphere ball
  CUBE_GRAVITY: -45,     // gravity applied to the cube ball (same as sphere — stays airborne longer)
  REST_VEL: 0.06,          // below this speed a body counts as "stopped"
  // A 1/60 step let fast shots (esp. after the +50% force tuning) cross more
  // than their own collision margin in a single step, "tunnelling" past the
  // contact before the solver caught it. 1/240 keeps per-step displacement
  // small enough that contacts are detected at the visual edge reliably.
  FIXED_DT: 1 / 240,
};

export class Physics {
  constructor() {
    this.world = new CANNON.World();
    this.world.gravity.set(0, 0, 0);          // flat table — no vertical fall needed
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.solver.iterations = 12;

    this.matPiece = new CANNON.Material('piece');
    this.matFloor = new CANNON.Material('floor');
    this.matNet   = new CANNON.Material('net');
    this.matWall  = new CANNON.Material('wall');

    this.world.addContactMaterial(new CANNON.ContactMaterial(this.matPiece, this.matPiece, {
      friction: PHYS.FRICTION_PIECE, restitution: PHYS.RESTITUTION_PIECE,
    }));
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.matPiece, this.matFloor, {
      friction: PHYS.FRICTION_FLOOR, restitution: PHYS.RESTITUTION_FLOOR,
    }));
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.matPiece, this.matNet, {
      friction: 0.1, restitution: 0.75,
    }));
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.matPiece, this.matWall, {
      friction: 0.05, restitution: 0.7,
    }));

    this.dynamicBodies = [];   // every non-static body, for the "all at rest" check
    this.onPlayerHitBall = null;   // set by Game — fired with the player CANNON.Body that touched the ball
    this.onPlayerHitPlayer = null; // set by Game — fired(bodyA, bodyB, cx, cz) on player-player contact
    this._farWalls = [];   // rebuilt by setFarWalls() whenever the camera's view bounds change
    this._showbolWalls = [];
    this.hasShowbolWalls = false;
    this._buildWalls();
  }

  // No perimeter wall right at the lines — players and the ball are free to
  // leave the field, cross it, and have out-of-bounds handled positionally
  // in Game (see Game._checkOutOfPlay / _checkPlayersOutOfBounds). There IS
  // a much farther-out perimeter, though — see setFarWalls() below — so a
  // hard shot can't sail off past where the camera can even show it.
  _buildWalls() {
    // Ball-only floor — catches stray vertical velocity from contacts
    // (see PHYS.BALL_GRAVITY) and gives it somewhere to land/bounce on,
    // including while it's flying around outside the field during the
    // snap-back delay after going out of play. Sized generously since
    // there's no longer a perimeter wall to keep the ball nearby.
    const FLOOR_MARGIN = 80;
    const floorHalfH = 1;
    const floor = new CANNON.Body({ mass: 0, material: this.matFloor });
    floor.addShape(new CANNON.Box(new CANNON.Vec3(C.HW + FLOOR_MARGIN, floorHalfH, C.HH + FLOOR_MARGIN)));
    floor.position.set(0, -floorHalfH, 0);
    floor.collisionFilterGroup = GROUP.BALL_WALL;
    floor.collisionFilterMask = GROUP.BALL;
    this.world.addBody(floor);
  }

  // (Re)builds the far-out perimeter wall from the camera's current
  // world-space view half-extents (see scene.js's viewHalfX/viewHalfZ and
  // onViewChange) — called once right after construction with the initial
  // view bounds, then again every time those bounds change (window resize,
  // top-down/isometric toggle). Inset by WALL_BUFFER so a piece visibly
  // stops before reaching the literal edge of what's on screen.
  setFarWalls(halfX, halfZ) {
    this._farWalls.forEach(b => this.world.removeBody(b));
    this._farWalls = [];

    const wx = Math.max(halfX - WALL_BUFFER, C.HW + 1);
    const wz = Math.max(halfZ - WALL_BUFFER, C.HH + 1);
    const THICK = 2, H = 8;

    const addWall = (hx, hz, px, pz) => {
      const body = new CANNON.Body({ mass: 0, material: this.matPiece });
      body.addShape(new CANNON.Box(new CANNON.Vec3(hx, H / 2, hz)));
      body.position.set(px, H / 2 - 2, pz);
      body.collisionFilterGroup = GROUP.FAR_WALL;
      body.collisionFilterMask = GROUP.PLAYER | GROUP.BALL;
      this.world.addBody(body);
      this._farWalls.push(body);
    };

    addWall(THICK / 2, wz + THICK, wx, 0);    // +X
    addWall(THICK / 2, wz + THICK, -wx, 0);   // -X
    addWall(wx + THICK, THICK / 2, 0, wz);    // +Z
    addWall(wx + THICK, THICK / 2, 0, -wz);   // -Z
  }

  // Places solid boards exactly at the field boundary lines (showbol mode).
  // The byline boards have a gap at the goal mouth so the ball can enter the net.
  // Must be called BEFORE addPlayerBody/addBallBody so masks pick up SHOWBOL_WALL.
  buildShowbolWalls() {
    this.hasShowbolWalls = true;
    const THICK = 2, H = 50;
    const gHalf = C.GW / 2;
    const segHz = (C.HH - gHalf) / 2;   // half-extent of each byline board segment beside goal
    const segCZ = gHalf + segHz;          // centre Z of each byline board segment

    // Above-crossbar cap: covers goal mouth (|z| < GW/2) above goal height
    const capHY = (H - C.GH) / 2;        // half-height of the cap segment
    const capCY = C.GH + capHY;           // centre Y of the cap segment

    const addWall = (hx, hy, hz, px, py, pz) => {
      const body = new CANNON.Body({ mass: 0, material: this.matWall });
      body.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz)));
      body.position.set(px, py, pz);
      body.collisionFilterGroup = GROUP.SHOWBOL_WALL;
      body.collisionFilterMask = GROUP.PLAYER | GROUP.BALL;
      this.world.addBody(body);
      this._showbolWalls.push(body);
    };

    // Byline boards — two segments each side, leaving a gap at the goal mouth (ground level only)
    addWall(THICK / 2, H / 2, segHz,  C.HW + THICK / 2, H / 2 - 2,  segCZ);   // +X top
    addWall(THICK / 2, H / 2, segHz,  C.HW + THICK / 2, H / 2 - 2, -segCZ);   // +X bottom
    addWall(THICK / 2, H / 2, segHz, -C.HW - THICK / 2, H / 2 - 2,  segCZ);   // -X top
    addWall(THICK / 2, H / 2, segHz, -C.HW - THICK / 2, H / 2 - 2, -segCZ);   // -X bottom
    // Cap above the crossbar — closes the goal mouth zone above GH
    addWall(THICK / 2, capHY, gHalf,  C.HW + THICK / 2, capCY, 0);   // +X cap
    addWall(THICK / 2, capHY, gHalf, -C.HW - THICK / 2, capCY, 0);   // -X cap
    // Lateral boards — full width
    addWall(C.HW + THICK, H / 2, THICK / 2, 0,  H / 2 - 2,  C.HH + THICK / 2);   // +Z
    addWall(C.HW + THICK, H / 2, THICK / 2, 0,  H / 2 - 2, -C.HH - THICK / 2);   // -Z
  }

  addPlayerBody(player) {
    let shape, mass, restY, shapeQuat = null;
    // Both colliders are built much taller (in Y) than the visible piece.
    // The ball's radius (0.496) is large relative to a piece's real height
    // (0.48) — with a collider that only matches the visual height, the
    // ball's sphere can reach over the top edge and contact the flat
    // cap/top face instead of the round side wall, handing back a near-
    // vertical contact normal (confirmed via a direct contact-normal probe:
    // ni = (0,-1,0) on a purely horizontal approach) and launching the ball
    // straight up. Stretching the invisible collider tall — while leaving
    // body.position.y at the real visual rest height — guarantees the ball
    // always hits the side wall first, so the normal stays horizontal.
    const COL_H = 6;
    if (player.isKeeper) {
      // Collider matches the outer rim mesh, not the inner body — so the
      // ball reacts at the visual edge of the piece rather than sinking into it.
      shape = new CANNON.Box(new CANNON.Vec3((C.KEEP_D+C.KEEP_RIM)/2, COL_H/2, (C.KEEP_W+C.KEEP_RIM)/2));
      mass = PHYS.KEEPER_MASS;
      restY = C.KEEP_H/2;
    } else {
      // Radius matches the outer rim mesh (see Player._buildFieldPlayer).
      // Cannon approximates the circle as an N-sided polygon, whose flat
      // faces sit slightly *inside* the true circle (inscribed radius <
      // circumscribed radius). Inflate the circumradius so the polygon's
      // inscribed radius is never smaller than the visual rim — collisions
      // then trigger at/just outside the visible edge, never inside it.
      const rimR = C.PLAYER_R + C.PLAYER_RIM;
      const N = 20;
      const circumR = rimR / Math.cos(Math.PI / N);
      shape = new CANNON.Cylinder(circumR, circumR, COL_H, N);
      mass = PHYS.PLAYER_MASS;
      restY = C.PLAYER_H/2;
      // This build of Cannon.js constructs Cylinder with its symmetry axis
      // along local Z, not Y (verified by inspecting shape.vertices — the
      // height range sits on Z, the circular ±circumR range spans X *and* Y).
      // Left unrotated, the collider stands the disc up on its edge instead
      // of lying it flat — round face toward the camera instead of toward
      // the sky. Rotate -90° about X so local Z maps to world Y, matching
      // the flat-puck shape the Three.js mesh shows.
      shapeQuat = new CANNON.Quaternion();
      // NOTE: setFromAxisAngle mutates in place and returns undefined in this
      // Cannon.js build — must NOT be chained off `new CANNON.Quaternion()`.
      shapeQuat.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    }

    const body = new CANNON.Body({ mass, material: this.matPiece });
    if (shapeQuat) body.addShape(shape, new CANNON.Vec3(), shapeQuat);
    else body.addShape(shape);
    body.position.set(player.initPos.x, restY, player.initPos.z);
    body.fixedRotation = true;     // buttons translate only — no tipping/tumbling
    body.updateMassProperties();
    body.linearDamping = PHYS.LIN_DAMPING;
    body.collisionFilterGroup = GROUP.PLAYER;
    body.collisionFilterMask = GROUP.PLAYER | GROUP.BALL | GROUP.FAR_WALL | (this.hasShowbolWalls ? GROUP.SHOWBOL_WALL : 0);

    body.addEventListener('collide', (e) => {
      if (e.body.collisionFilterGroup !== GROUP.PLAYER) return;
      if (!this.onPlayerHitPlayer) return;
      // Contact point: midpoint between the two body centres (simple, reliable)
      const cx = (body.position.x + e.body.position.x) / 2;
      const cz = (body.position.z + e.body.position.z) / 2;
      this.onPlayerHitPlayer(body, e.body, cx, cz);
    });

    this.world.addBody(body);
    this.dynamicBodies.push(body);
    player.physBody = body;
    player.restY = restY;
    return body;
  }

  addBallBody(ball) {
    const ballMass = ball.ballType === 'cube' ? PHYS.CUBE_MASS : PHYS.SPHERE_MASS;
    const body = new CANNON.Body({ mass: ballMass, material: this.matPiece });

    let ballRadius;
    if (ball.ballType === 'cube') {
      const halfSize = C.BALL_CUBE_SIZE / 2;
      body.addShape(new CANNON.Box(new CANNON.Vec3(halfSize, halfSize, halfSize)));
      ballRadius = halfSize;
    } else {
      // sphere (default)
      ballRadius = C.BALL_R;
      body.addShape(new CANNON.Sphere(ballRadius));
    }

    body.position.set(ball.initPos.x, ballRadius, ball.initPos.z);
    body.linearDamping = PHYS.BALL_LIN_DAMPING;
    body.angularDamping = ball.ballType === 'cube' ? PHYS.CUBE_ANG_DAMPING : PHYS.BALL_ANG_DAMPING;
    body.collisionFilterGroup = GROUP.BALL;
    body.collisionFilterMask = GROUP.PLAYER | GROUP.BALL_WALL | GROUP.FAR_WALL | GROUP.NET | (this.hasShowbolWalls ? GROUP.SHOWBOL_WALL : 0);
    body.isBall = true;   // flags it for the per-step gravity nudge in Physics.step()
    body.isCube = ball.ballType === 'cube';  // flag to apply extra gravity to cube
    body.ballRadius = ballRadius;  // store for later use in step()

    // This Cannon.js build's sphere narrowphase never generates a friction
    // torque (verified directly: a sphere-sphere graze leaves angularVelocity
    // at exactly 0 indefinitely), so a hit alone won't make the ball spin and
    // the contact normal from a piece is almost always horizontal, so it
    // won't pop up on its own either. Both are added explicitly here:
    // a piece hit nudges it upward (proportional to impact speed, so a light
    // touch barely lifts it and a hard strike gives it a little hop), and
    // gravity/the floor (see step() and the ball-only floor body) bring it
    // back down.
    body.addEventListener('collide', (e) => {
      if (e.body.collisionFilterGroup !== GROUP.PLAYER) return;
      const impact = Math.abs(e.contact.getImpactVelocityAlongNormal());
      body.velocity.y += Math.min(impact, 25) * 0.55;
      if (this.onPlayerHitBall) this.onPlayerHitBall(e.body);
    });

    this.world.addBody(body);
    this.dynamicBodies.push(body);
    ball.physBody = body;
    ball.restY = ballRadius;
    return body;
  }

  step() {
    this.dynamicBodies.forEach(b => {
      if (b.isBall) {
        const gravity = b.isCube ? PHYS.CUBE_GRAVITY : PHYS.SPHERE_GRAVITY;
        b.force.y += b.mass * gravity;
        // Switch damping based on whether the ball is rolling on the ground or airborne.
        // ContactMaterial friction only fires during brief bounce contacts, so it doesn't
        // slow a rolling ball — this dynamic linearDamping is what actually does it.
        const onGround = b.position.y <= b.ballRadius * 1.15;
        const groundDamping = b.isCube ? PHYS.CUBE_GROUND_DAMPING : PHYS.BALL_GROUND_DAMPING;
        b.linearDamping = onGround ? groundDamping : PHYS.BALL_LIN_DAMPING;
        b.angularDamping = b.isCube ? PHYS.CUBE_ANG_DAMPING : PHYS.BALL_ANG_DAMPING;
        // Rolling-without-slipping spin (ω = (up × v) / r) — same reason as
        // the collide listener above: this Cannon.js build won't derive spin
        // from contacts on its own, so it's driven from velocity directly.
        const speed = Math.hypot(b.velocity.x, b.velocity.z);
        if (speed > 0.05) {
          const r = b.ballRadius;
          const spin = b.isCube ? PHYS.CUBE_SPIN_FACTOR : 1;
          b.angularVelocity.set((b.velocity.z / r) * spin, 0, (-b.velocity.x / r) * spin);
        }
      }
    });
    this.world.step(PHYS.FIXED_DT);
  }

  allAtRest() {
    return this.dynamicBodies.every(b => b.velocity.length() < PHYS.REST_VEL);
  }
}

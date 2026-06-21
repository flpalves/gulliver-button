import { C, GAME_MODES } from './constants.js';
import { scene } from './scene.js';
import { Goal } from './goal.js';

// ─────────────────────────────────────────────
// FIELD
// ─────────────────────────────────────────────
export class Field {
  constructor(physics, gameMode = GAME_MODES.STANDARD) {
    this.group = new THREE.Group();
    this.goals = [];
    this._surface();
    this._markings();
    this._buildGoals(physics);
    if (gameMode === GAME_MODES.SHOWBOL) this._buildShowbolBoards();
    scene.add(this.group);
  }

  // ── Surface ──────────────────────────────────
  _surface() {
    const mat  = new THREE.MeshLambertMaterial({ color: C.COL_FIELD });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(C.FW, C.FH), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    this.group.add(mesh);

    // Alternating stripes (14 bands along X)
    const n = 14, sw = C.FW / n;
    const dkMat = new THREE.MeshLambertMaterial({ color: 0x267026, transparent: true, opacity: 0.45 });
    for (let i = 0; i < n; i += 2) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(sw, C.FH), dkMat);
      s.rotation.x = -Math.PI / 2;
      s.position.set(-C.HW + sw * i + sw / 2, 0.006, 0);
      s.receiveShadow = true;
      this.group.add(s);
    }

    // Wide border (outside field)
    const bMat = new THREE.MeshLambertMaterial({ color: 0x1f5e1f });
    const bMesh = new THREE.Mesh(new THREE.PlaneGeometry(C.FW + 30, C.FH + 30), bMat);
    bMesh.rotation.x = -Math.PI / 2;
    bMesh.position.y = -0.01;
    bMesh.receiveShadow = true;
    this.group.add(bMesh);
  }

  // ── Line helpers ─────────────────────────────
  _line(pts) {                                      // pts: [[x,z], ...]
    const verts = pts.map(([x, z]) => new THREE.Vector3(x, 0.07, z));
    const geo = new THREE.BufferGeometry().setFromPoints(verts);
    return new THREE.Line(geo, new THREE.LineBasicMaterial({ color: C.COL_WHITE }));
  }

  _arc(cx, cz, r, a0, a1, segs = 72) {
    const pts = [];
    for (let i = 0; i <= segs; i++) {
      const a = a0 + (a1 - a0) * (i / segs);
      pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
    return this._line(pts);
  }

  _spot(x, z, r = 0.5) {
    const m = new THREE.Mesh(
      new THREE.CircleGeometry(r, 16),
      new THREE.MeshBasicMaterial({ color: C.COL_WHITE })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.07, z);
    return m;
  }

  // ── All white markings ────────────────────────
  _markings() {
    const g = this.group;
    const HW = C.HW, HH = C.HH;

    // Outer boundary
    g.add(this._line([[-HW,-HH],[HW,-HH],[HW,HH],[-HW,HH],[-HW,-HH]]));
    // Half-way line
    g.add(this._line([[0,-HH],[0,HH]]));
    // Centre circle & spot
    g.add(this._arc(0, 0, C.CR, 0, Math.PI * 2));
    g.add(this._spot(0, 0, 0.5));

    // Both ends
    this._endMarkings(g, -HW, +1);   // left goal  → areas go rightward
    this._endMarkings(g,  HW, -1);   // right goal → areas go leftward

    // Corner arcs (radius 1, curving inward)
    const p = Math.PI;
    g.add(this._arc(-HW, -HH, C.COR,         0,   p/2));
    g.add(this._arc( HW, -HH, C.COR,        p/2,   p));
    g.add(this._arc( HW,  HH, C.COR,         p, 3*p/2));
    g.add(this._arc(-HW,  HH, C.COR,      3*p/2, 2*p));
  }

  _endMarkings(g, gx, dir) {
    // gx = X of goal line;  dir = +1 or -1 (into field)
    const sAH = C.SAW / 2, bAH = C.BAW / 2;
    const sEnd = gx + dir * C.SAD;
    const bEnd = gx + dir * C.BAD;

    // Small area (3 sides — 4th is the goal line itself)
    g.add(this._line([[gx,-sAH],[sEnd,-sAH],[sEnd,sAH],[gx,sAH]]));
    // Big area
    g.add(this._line([[gx,-bAH],[bEnd,-bAH],[bEnd,bAH],[gx,bAH]]));

    // Penalty spot
    const penX = gx + dir * C.PEN;
    g.add(this._spot(penX, 0, 0.5));

    // D-arc (arc outside big area, centred on penalty spot)
    const dA = Math.acos((C.BAD - C.PEN) / C.DAR);  // half-angle ≈ 0.93 rad
    if (dir > 0) {
      g.add(this._arc(penX, 0, C.DAR, -dA, dA));
    } else {
      g.add(this._arc(penX, 0, C.DAR, Math.PI - dA, Math.PI + dA));
    }

    // Goal-mouth line segment (between posts, on the goal line)
    g.add(this._line([[gx, -C.GW/2], [gx, C.GW/2]]));
  }

  // ── Showbol boards (perimeter walls with goal openings) ─────
  _buildShowbolBoards() {
    const H = 50;
    const BOARD_T = 0.5;
    const mat = new THREE.MeshBasicMaterial({ color: 0xaaccff, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false });

    const gHalf = C.GW / 2;
    const segHz = (C.HH - gHalf) / 2;
    const segCZ = gHalf + segHz;
    const capHY = (H - C.GH) / 2;
    const capCY = C.GH + capHY;

    const addBoard = (wx, wy, wz, px, py, pz) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(wx * 2, wy * 2, wz * 2), mat);
      mesh.position.set(px, py, pz);
      this.group.add(mesh);
    };

    // Byline boards — gap at goal mouth ground level
    addBoard(BOARD_T / 2, H / 2, segHz,  C.HW + BOARD_T / 2, H / 2 - 2,  segCZ);
    addBoard(BOARD_T / 2, H / 2, segHz,  C.HW + BOARD_T / 2, H / 2 - 2, -segCZ);
    addBoard(BOARD_T / 2, H / 2, segHz, -C.HW - BOARD_T / 2, H / 2 - 2,  segCZ);
    addBoard(BOARD_T / 2, H / 2, segHz, -C.HW - BOARD_T / 2, H / 2 - 2, -segCZ);
    // Cap above crossbar — closes goal mouth zone above GH
    addBoard(BOARD_T / 2, capHY, gHalf,  C.HW + BOARD_T / 2, capCY, 0);
    addBoard(BOARD_T / 2, capHY, gHalf, -C.HW - BOARD_T / 2, capCY, 0);
    // Lateral boards
    addBoard(C.HW + BOARD_T, H / 2, BOARD_T / 2, 0,  H / 2 - 2,  C.HH + BOARD_T / 2);
    addBoard(C.HW + BOARD_T, H / 2, BOARD_T / 2, 0,  H / 2 - 2, -C.HH - BOARD_T / 2);
  }

  // ── Goals ────────────────────────────────────
  _buildGoals(physics) {
    this.goals.push(new Goal(physics, -C.HW, false));   // left (opens →)
    this.goals.push(new Goal(physics, C.HW, true));     // right (opens ←)
  }

  // Get goal by position (for left/right goal)
  getGoalByX(x) {
    return x > 0 ? this.goals[1] : this.goals[0];
  }
}

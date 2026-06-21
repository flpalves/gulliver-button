import { C } from './constants.js';
import { scene } from './scene.js';
import { makeBallTexture, makeCubeTextures } from './textures.js';

// ─────────────────────────────────────────────
// BALL  (sphere or cube)
// ─────────────────────────────────────────────
export class Ball {
  constructor(ballType = 'sphere') {
    this.initPos = { x: 0, z: 0 };
    this.physBody = null;        // CANNON.Body — set by Physics.addBallBody()
    this.restY = 0;
    this.ballType = ballType;

    this.group = new THREE.Group();

    if (ballType === 'cube') {
      // Cube/dadinho — +x, -x, +y, -y, +z, -z faces → dice faces 2,5,1,6,3,4
      const size = C.BALL_CUBE_SIZE;
      const faceOrder = [1, 4, 0, 5, 2, 3]; // maps BoxGeometry face index → pip layout index
      const cubeTex = makeCubeTextures();
      const materials = faceOrder.map(i =>
        new THREE.MeshPhongMaterial({ map: cubeTex[i], shininess: 70 })
      );
      this.mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), materials);
      this.restY = size / 2;
    } else {
      // Sphere (default)
      const r = C.BALL_R;
      const ballTex = makeBallTexture();
      this.mesh = new THREE.Mesh(
        new THREE.SphereGeometry(r, 24, 16),
        new THREE.MeshPhongMaterial({ map: ballTex, shininess: 70 })
      );
      this.restY = r;
    }

    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.userData.isBall = true;
    this.group.add(this.mesh);

    this.group.position.set(0, this.restY, 0);
    scene.add(this.group);
  }

  reset() {
    this.group.position.set(this.initPos.x, this.restY, this.initPos.z);
    this.group.rotation.set(0, 0, 0);
    this.mesh.quaternion.set(0, 0, 0, 1);
    if (this.physBody) {
      this.physBody.position.set(this.initPos.x, this.restY, this.initPos.z);
      this.physBody.velocity.set(0, 0, 0);
      this.physBody.angularVelocity.set(0, 0, 0);
      this.physBody.quaternion.set(0, 0, 0, 1);
    }
  }
}

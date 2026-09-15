import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RaycastSensors, NavCommand } from '../types/index';
import { CONSTANTS } from '../types/constants';

export class RobotController {
  public mesh: THREE.Group = new THREE.Group();
  private mixer: THREE.AnimationMixer | null = null;
  private walkAction: THREE.AnimationAction | null = null;
  private idleAction: THREE.AnimationAction | null = null;

  private raycasterFront: THREE.Raycaster;
  private raycasterLeft: THREE.Raycaster;
  private raycasterRight: THREE.Raycaster;

  // Directions
  private forward = new THREE.Vector3(0, 0, 1);
  private dirFront = new THREE.Vector3(0, 0, 1);
  private dirLeft = new THREE.Vector3();
  private dirRight = new THREE.Vector3();

  constructor() {
    this.raycasterFront = new THREE.Raycaster();
    this.raycasterLeft = new THREE.Raycaster();
    this.raycasterRight = new THREE.Raycaster();
    this.raycasterFront.far = CONSTANTS.RAY_MAX_RANGE;
    this.raycasterLeft.far = CONSTANTS.RAY_MAX_RANGE;
    this.raycasterRight.far = CONSTANTS.RAY_MAX_RANGE;

    // Create a fallback visual if no robot model is provided/loaded
    const geo = new THREE.BoxGeometry(0.4, 0.4, 0.8);
    const mat = new THREE.MeshStandardMaterial({ color: 0x0055ff });
    const box = new THREE.Mesh(geo, mat);
    box.position.y = 0.2; // raise half height
    this.mesh.add(box);
  }

  public async loadRobot(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const loader = new GLTFLoader();
      loader.load(url, (gltf) => {
        // Clear fallback
        this.mesh.clear();

        const model = gltf.scene;

        // Disable root motion if any by scaling down position tracks or just removing them.
        // We will just manage position ourselves.

        this.mesh.add(model);

        if (gltf.animations && gltf.animations.length > 0) {
          this.mixer = new THREE.AnimationMixer(model);

          // Try to find idle and walk by name
          const idleAnim = gltf.animations.find(a => a.name.toLowerCase().includes('idle')) || gltf.animations[0];
          const walkAnim = gltf.animations.find(a => a.name.toLowerCase().includes('walk')) || gltf.animations[1] || gltf.animations[0];

          if (idleAnim) this.idleAction = this.mixer.clipAction(idleAnim);
          if (walkAnim) this.walkAction = this.mixer.clipAction(walkAnim);

          this.setAnimation('Idle');
        }

        resolve();
      }, undefined, reject);
    });
  }

  public setAnimation(state: 'Idle' | 'Walk'): void {
    if (!this.mixer) return;

    if (state === 'Idle' && this.idleAction) {
      if (this.walkAction) this.walkAction.fadeOut(0.2);
      this.idleAction.reset().fadeIn(0.2).play();
    } else if (state === 'Walk' && this.walkAction) {
      if (this.idleAction) this.idleAction.fadeOut(0.2);
      this.walkAction.reset().fadeIn(0.2).play();
    }
  }

  public updateAnimation(dt: number, speed: number) {
    if (this.mixer) {
      this.mixer.update(dt);
      if (this.walkAction && this.walkAction.isRunning()) {
        this.walkAction.timeScale = speed / CONSTANTS.ROBOT_BASE_SPEED;
      }
    }
  }

  public castSensors(obstacles: THREE.Object3D[]): RaycastSensors {
    // Current position and forward vector
    const pos = this.mesh.position.clone();
    pos.y += 0.2; // Cast from slightly above ground

    // Get current global forward direction
    const currentRot = this.mesh.quaternion;
    this.dirFront.copy(this.forward).applyQuaternion(currentRot).normalize();

    // Left 30 deg
    this.dirLeft.copy(this.dirFront).applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 6).normalize();
    // Right 30 deg
    this.dirRight.copy(this.dirFront).applyAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 6).normalize();

    this.raycasterFront.set(pos, this.dirFront);
    this.raycasterLeft.set(pos, this.dirLeft);
    this.raycasterRight.set(pos, this.dirRight);

    const getDist = (ray: THREE.Raycaster) => {
      if (obstacles.length === 0) return 1.0;
      const intersects = ray.intersectObjects(obstacles, true);
      // Filter out non-obstacles
      const obsIntersects = intersects.filter(hit => hit.object.userData.isObstacle);

      if (obsIntersects.length > 0) {
        return Math.min(1.0, obsIntersects[0].distance / CONSTANTS.RAY_MAX_RANGE);
      }
      return 1.0;
    };

    return {
      front: getDist(this.raycasterFront),
      left: getDist(this.raycasterLeft),
      right: getDist(this.raycasterRight)
    };
  }

  public applyCommand(cmd: NavCommand, dt: number): void {
    // Rotation (kinematic, apply directly to mesh)
    if (cmd.angularVelocity !== 0) {
      this.mesh.rotateY(cmd.angularVelocity * dt);
    }

    // Translation (kinematic forward)
    if (cmd.linearVelocity > 0) {
      this.mesh.translateZ(cmd.linearVelocity * dt);
    }

    // Animation Sync
    if (cmd.linearVelocity > 0.05) {
        if (!this.walkAction?.isRunning()) this.setAnimation('Walk');
        this.updateAnimation(dt, cmd.linearVelocity);
    } else {
        if (!this.idleAction?.isRunning()) this.setAnimation('Idle');
        this.updateAnimation(dt, 0);
    }
  }

  public resetTransform(pos: THREE.Vector3): void {
    this.mesh.position.copy(pos);
    this.mesh.rotation.set(0, 0, 0); // Reset orientation
    this.setAnimation('Idle');
  }

  public getPosition(): THREE.Vector3 {
    return this.mesh.position;
  }

  public getForwardVector(): THREE.Vector3 {
    const dir = new THREE.Vector3(0, 0, 1);
    dir.applyQuaternion(this.mesh.quaternion);
    return dir;
  }
}

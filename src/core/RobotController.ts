import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RaycastSensors, NavCommand } from '../types/index';
import { CONSTANTS } from '../types/constants';
import { QuadrupedRobotFactory } from './QuadrupedRobotFactory';
import { RobotGaitAnimator } from './RobotGaitAnimator';

export class RobotController {
  public mesh: THREE.Group = new THREE.Group();
  private mixer: THREE.AnimationMixer | null = null;
  private walkAction: THREE.AnimationAction | null = null;
  private idleAction: THREE.AnimationAction | null = null;
  private gaitAnimator: RobotGaitAnimator;

  private raycasterFront: THREE.Raycaster;
  private raycasterLeft: THREE.Raycaster;
  private raycasterRight: THREE.Raycaster;

  // Directions
  private forward = new THREE.Vector3(0, 0, 1);
  private dirFront = new THREE.Vector3(0, 0, 1);
  private dirLeft = new THREE.Vector3();
  private dirRight = new THREE.Vector3();

  // Cached state for applyCommand
  private cachedObstacles: THREE.Object3D[] = [];
  private cachedSensors: RaycastSensors = { front: 1.0, left: 1.0, right: 1.0 };
  private tempVec3 = new THREE.Vector3();
  private tempRepulsionDir = new THREE.Vector3();

  private smoothedLinearVelocity: number = 0;
  private smoothedAngularVelocity: number = 0;

  constructor() {
    this.raycasterFront = new THREE.Raycaster();
    this.raycasterLeft = new THREE.Raycaster();
    this.raycasterRight = new THREE.Raycaster();
    this.raycasterFront.far = CONSTANTS.RAY_MAX_RANGE;
    this.raycasterLeft.far = CONSTANTS.RAY_MAX_RANGE;
    this.raycasterRight.far = CONSTANTS.RAY_MAX_RANGE;

    // Use actual Quadruped Robot Mesh
    const robotInstance = QuadrupedRobotFactory.createQuadrupedRobot();
    this.mesh.add(robotInstance.group);

    // Setup Gait Animator
    this.gaitAnimator = new RobotGaitAnimator();
    this.gaitAnimator.setLegs(robotInstance.legs);
  }

  public async loadRobot(url: string): Promise<void> {
    if (url === '/models/default_robot.glb' || url.includes('default_robot.glb')) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
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
      }, undefined, (error) => {
        console.warn(`[RobotController] GLTFLoader failed to load ${url}, keeping procedural mesh fallback.`, error);
        resolve(); // resolve safely to avoid app crash
      });
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

  public castSensors(obstacles: THREE.Object3D[] = []): RaycastSensors {
    this.cachedObstacles = obstacles;

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

    this.cachedSensors = {
      front: getDist(this.raycasterFront),
      left: getDist(this.raycasterLeft),
      right: getDist(this.raycasterRight)
    };

    return this.cachedSensors;
  }

  public applyCommand(cmd: NavCommand, dt: number): void {
    const MAX_RAY_DISTANCE = CONSTANTS.RAY_MAX_RANGE; // Use constant

    // Bounding Sphere Proximity Guard for dynamic obstacles
    const collisionDist = CONSTANTS.PROXIMITY_GUARD_RADIUS;
    const robotPos = this.mesh.position;

    for (const obs of this.cachedObstacles) {
        if (obs.userData.isDynamic) {
            // Calculate distance between robot center and obstacle center
            // Get world position of obstacle in case it's nested (though testbed puts it at root)
            obs.getWorldPosition(this.tempVec3);
            const d = robotPos.distanceTo(this.tempVec3);

            if (d <= collisionDist) {
                // Proximity Guard triggered
                cmd.linearVelocity = 0.0;

                // Calculate repulsion vector from obstacle to robot
                this.tempRepulsionDir.subVectors(robotPos, this.tempVec3);
                this.tempRepulsionDir.y = 0; // Keep horizontal

                if (this.tempRepulsionDir.lengthSq() > 0.001) {
                    this.tempRepulsionDir.normalize();
                    // Determine rotation direction
                    const forwardVec = this.getForwardVector();
                    forwardVec.y = 0;
                    forwardVec.normalize();

                    const crossY = forwardVec.z * this.tempRepulsionDir.x - forwardVec.x * this.tempRepulsionDir.z;
                    // Apply a rotation to escape
                    cmd.angularVelocity = crossY > 0 ? CONSTANTS.ROBOT_MAX_ROTATION_SPEED : -CONSTANTS.ROBOT_MAX_ROTATION_SPEED;
                }
                break; // Handle closest/first one and break
            }
        }
    }

    // Kinematic Safety Clamp based on front ray
    const actualFrontDistance = this.cachedSensors.front * MAX_RAY_DISTANCE;

    // Continuous Deceleration (Soft Buffer Zone)
    let speedFactor = 1.0;
    if (actualFrontDistance <= CONSTANTS.DECEL_ZONE_STOP) {
      speedFactor = 0.0;
    } else if (actualFrontDistance < CONSTANTS.DECEL_ZONE_START) {
      speedFactor = (actualFrontDistance - CONSTANTS.DECEL_ZONE_STOP) /
                    (CONSTANTS.DECEL_ZONE_START - CONSTANTS.DECEL_ZONE_STOP);
    }
    const targetLinearVel = cmd.linearVelocity * Math.max(0.0, Math.min(1.0, speedFactor));

    // Velocity Exponential Moving Average (EMA)
    const alpha = CONSTANTS.VELOCITY_EMA_ALPHA;
    this.smoothedLinearVelocity = (alpha * targetLinearVel) + ((1 - alpha) * this.smoothedLinearVelocity);
    this.smoothedAngularVelocity = (alpha * cmd.angularVelocity) + ((1 - alpha) * this.smoothedAngularVelocity);

    // Rotation (kinematic, apply directly to mesh)
    // NOTE: Angular velocity is intentionally NOT blocked here to allow rotation and escaping!
    if (this.smoothedAngularVelocity !== 0) {
      this.mesh.rotateY(this.smoothedAngularVelocity * dt);
    }

    // Translation (kinematic forward)
    if (this.smoothedLinearVelocity > 0) {
      this.mesh.translateZ(this.smoothedLinearVelocity * dt);
    }

    // Animation Sync
    const isMoving = Math.abs(this.smoothedLinearVelocity) > 0.05;
    this.gaitAnimator.setWalking(isMoving);

    if (isMoving) {
        if (!this.walkAction?.isRunning()) this.setAnimation('Walk');
        this.updateAnimation(dt, this.smoothedLinearVelocity);
    } else {
        if (!this.idleAction?.isRunning()) this.setAnimation('Idle');
        this.updateAnimation(dt, 0);
    }

    // Update procedural leg animation based on speed
    this.gaitAnimator.update(dt, this.smoothedLinearVelocity);
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

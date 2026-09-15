import * as THREE from 'three';
import { NavigationMode, SimState } from '../types/index';
import { CONSTANTS } from '../types/constants';
import { Viewer3D } from './Viewer3D';
import { RobotController } from './RobotController';
import { AStarPlanner } from '../algorithms/AStarPlanner';
import { FlyNeuralNetwork } from '../algorithms/FlyNeuralNetwork';
import { HybridNavigator } from '../algorithms/HybridNavigator';
import { TestbedGenerator, DynamicObstacle } from './TestbedGenerator';

export class SimulationManager {
  private mode: NavigationMode = NavigationMode.HYBRID;
  public state: SimState = SimState.IDLE;

  private viewer: Viewer3D;
  private robot: RobotController;

  // Algorithms
  private aStar: AStarPlanner;
  private flyNet: FlyNeuralNetwork;
  private hybridNav: HybridNavigator;

  // State vars
  private startPoint: THREE.Vector3 | null = null;
  private endPoint: THREE.Vector3 | null = null;
  private currentPath: THREE.Vector3[] = [];
  private currentWaypointIndex = 0;

  private simulationTime = 0;

  // Stall checking
  private lastStallCheckTime = 0;
  private lastStallCheckPos = new THREE.Vector3();

  // Callbacks
  public onStateChange?: (state: SimState) => void;

  private dynamicObstacles: DynamicObstacle[] = [];

  private resolveDynamicCollisions(dt: number): void {
    const robotPos = this.robot.getPosition();
    const robotRadius = 0.35;
    const obstacleRadius = 0.30;
    const minDist = robotRadius + obstacleRadius; // 0.65m

    for (const obs of this.dynamicObstacles) {
      const obsPos = obs.mesh.position;
      const dx = robotPos.x - obsPos.x;
      const dz = robotPos.z - obsPos.z;
      const dist2D = Math.sqrt(dx * dx + dz * dz);

      if (dist2D < minDist && dist2D > 0.0001) {
        const overlap = minDist - dist2D;
        const nx = dx / dist2D;
        const nz = dz / dist2D;

        // 겹친 깊이만큼 로봇을 장애물 반대 방향으로 즉각 밀어내어 관통 원천 차단
        this.robot.mesh.position.x += nx * overlap;
        this.robot.mesh.position.z += nz * overlap;

        // 동적 장애물에 상호작용 반전/일시정지 신호 부여 가능 시 트리거
        if (typeof (obs as any).onCollision === 'function') {
          (obs as any).onCollision();
        }
      }

      // 동적 장애물 상호작용: 거리 <= 0.7m 이내라면 강제 이동 일시 대기 또는 반전
      if (dist2D <= 0.7) {
        obs.elapsedTime -= dt * 2;
      }
    }
  }

  constructor(viewer: Viewer3D, robot: RobotController) {
    this.viewer = viewer;
    this.robot = robot;

    this.aStar = new AStarPlanner();
    this.flyNet = new FlyNeuralNetwork();
    this.hybridNav = new HybridNavigator();

    // Create default testbed
    const testbed = TestbedGenerator.createMazeWithDynamicObstacles();
    this.dynamicObstacles = testbed.dynamicObstacles;
    this.viewer.addTestbedObject(testbed.testbedGroup);
    this.prepareEnvironment(testbed.walkableGround, this.viewer.getTestbedObjects());
  }

  public setMode(mode: NavigationMode): void {
    this.mode = mode;
    this.viewer.clearPath();
  }

  public setStartPoint(pos: THREE.Vector3): void {
    this.startPoint = pos.clone();
    this.viewer.setStartMarker(this.startPoint);
    this.robot.resetTransform(this.startPoint);
    if (this.state !== SimState.RUNNING) {
      this.checkReadyState();
    }
  }

  public setEndPoint(pos: THREE.Vector3): void {
    this.endPoint = pos.clone();
    this.viewer.setEndMarker(this.endPoint);
    if (this.state !== SimState.RUNNING) {
      this.checkReadyState();
    }
  }

  public getStartPoint() { return this.startPoint; }
  public getEndPoint() { return this.endPoint; }

  public getIsReady(): boolean {
    return this.state === SimState.READY;
  }

  private checkReadyState(): void {
    if (this.startPoint && this.endPoint) {
      const dist = this.startPoint.distanceTo(this.endPoint);
      if (dist >= 0.5) {
        this.changeState(SimState.READY);
        return;
      }
    }
    this.changeState(SimState.IDLE);
  }

  private changeState(newState: SimState): void {
    this.state = newState;
    if (this.onStateChange) {
      this.onStateChange(this.state);
    }
  }

  public prepareEnvironment(walkableMesh: THREE.Mesh, obstacles: THREE.Object3D[]): void {
    this.aStar.buildGridFromScene(walkableMesh, obstacles);
  }

  public start(): void {
    if (this.state !== SimState.READY) return;

    if (!this.startPoint || !this.endPoint) return;

    // Build path if using A* or Hybrid
    if (this.mode === NavigationMode.ASTAR || this.mode === NavigationMode.HYBRID) {
      this.currentPath = this.aStar.findPath(this.startPoint, this.endPoint);
      if (this.currentPath.length === 0) {
        console.warn("A* Path not found");
        // E-3: No valid path
        alert("목적지까지 유효한 경로가 없습니다 (No valid path found)");
        return;
      }
      this.currentWaypointIndex = 0;
      this.viewer.drawPath(this.currentPath);
    }

    this.simulationTime = 0;
    this.lastStallCheckTime = 0;
    this.lastStallCheckPos.copy(this.robot.getPosition());

    this.robot.resetTransform(this.startPoint);
    this.changeState(SimState.RUNNING);
  }

  public reset(): void {
    this.changeState(this.startPoint && this.endPoint ? SimState.READY : SimState.IDLE);
    if (this.startPoint) {
      this.robot.resetTransform(this.startPoint);
    }
    this.viewer.clearPath();
  }

  public update(dt: number): void {
    if (this.state !== SimState.RUNNING) return;

    // E-5: Clamp dt to prevent tunneling
    const clampedDt = Math.min(dt, 0.05);

    this.simulationTime += clampedDt;

    const currentPos = this.robot.getPosition();
    const currentDir = this.robot.getForwardVector();

    // 1. Update dynamic objects
    for (const obs of this.dynamicObstacles) {
      obs.update(clampedDt);
    }

    // 2. Update Sensors
    const staticObstacles = this.viewer.getTestbedObjects();

    // Merge static and dynamic obstacles into a single array
    const currentObstacles: THREE.Object3D[] = [...staticObstacles];
    for (const obs of this.dynamicObstacles) {
        if (!obs.mesh.userData.isObstacle) {
            obs.mesh.userData.isObstacle = true;
        }
        if (!obs.mesh.userData.isDynamic) {
            obs.mesh.userData.isDynamic = true;
        }
        // Ensure dynamic obstacles are included (avoiding duplicates if they are already in the testbed group)
        if (!currentObstacles.includes(obs.mesh)) {
            currentObstacles.push(obs.mesh);
        }
    }

    const sensors = this.robot.castSensors(currentObstacles);

    // 3. Compute Navigation Command
    let cmd = { linearVelocity: 0, angularVelocity: 0 };

    if (this.mode === NavigationMode.ASTAR) {
      // Find next waypoint
      let targetWp = this.currentPath[this.currentWaypointIndex];
      // If close to current waypoint, go to next
      while (targetWp && currentPos.distanceTo(targetWp) < 0.5 && this.currentWaypointIndex < this.currentPath.length - 1) {
        this.currentWaypointIndex++;
        targetWp = this.currentPath[this.currentWaypointIndex];
      }

      if (targetWp) {
        const targetDir = new THREE.Vector3().subVectors(targetWp, currentPos);
        targetDir.y = 0; // flatten
        if (targetDir.lengthSq() > 0) targetDir.normalize();

        const crossY = currentDir.z * targetDir.x - currentDir.x * targetDir.z;
        const dot = currentDir.x * targetDir.x + currentDir.z * targetDir.z;
        const angleDiff = Math.atan2(crossY, dot);

        cmd.angularVelocity = THREE.MathUtils.clamp(angleDiff / clampedDt, -CONSTANTS.ROBOT_MAX_ROTATION_SPEED, CONSTANTS.ROBOT_MAX_ROTATION_SPEED);
        cmd.linearVelocity = CONSTANTS.ROBOT_BASE_SPEED * Math.max(0, dot); // Slow down if turning
      }

    } else if (this.mode === NavigationMode.FLY_CX) {
      cmd = this.flyNet.step(sensors, clampedDt);

    } else if (this.mode === NavigationMode.HYBRID) {
      let targetWp = this.currentPath[this.currentWaypointIndex];
      while (targetWp && currentPos.distanceTo(targetWp) < 0.5 && this.currentWaypointIndex < this.currentPath.length - 1) {
        this.currentWaypointIndex++;
        targetWp = this.currentPath[this.currentWaypointIndex];
      }

      if (!targetWp && this.endPoint) {
         targetWp = this.endPoint; // Fallback to end point if path ends but not at goal
      }

      cmd = this.hybridNav.computeCommand(currentPos, currentDir, targetWp, sensors, clampedDt);
    }

    // 4. Apply Command
    this.robot.applyCommand(cmd, clampedDt);

    // Resolve Dynamic Collisions & Ghosting geometrically
    this.resolveDynamicCollisions(clampedDt);

    // 5. Check Success and Failures (Goal, Stall, Timeout, OOB)
    if (this.endPoint && currentPos.distanceTo(this.endPoint) <= CONSTANTS.GOAL_THRESHOLD) {
      this.robot.setAnimation('Idle');
      this.changeState(SimState.SUCCESS);
      return;
    }

    if (this.simulationTime > CONSTANTS.SIM_TIMEOUT_SEC) {
      this.robot.setAnimation('Idle');
      this.changeState(SimState.FAILED_TIMEOUT);
      return;
    }

    if (currentPos.y < -2.0) {
      this.changeState(SimState.FAILED_OOB);
      return;
    }

    if (this.simulationTime - this.lastStallCheckTime > CONSTANTS.STALL_CHECK_WINDOW) {
      const distMoved = currentPos.distanceTo(this.lastStallCheckPos);
      if (distMoved < CONSTANTS.STALL_DISTANCE_MIN) {
        this.robot.setAnimation('Idle');
        this.changeState(SimState.FAILED_STALLED);
        return;
      }
      this.lastStallCheckTime = this.simulationTime;
      this.lastStallCheckPos.copy(currentPos);
    }
  }
}

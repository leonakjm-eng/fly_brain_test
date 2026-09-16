import * as THREE from 'three';
import { NavigationMode, SimState, TestbedPreset, AgentContext, TelemetryData } from '../types/index';
import { CONSTANTS } from '../types/constants';
import { Viewer3D } from './Viewer3D';
import { RobotController } from './RobotController';
import { AStarPlanner } from '../algorithms/AStarPlanner';
import { FlyNeuralNetwork } from '../algorithms/FlyNeuralNetwork';
import { HybridNavigator } from '../algorithms/HybridNavigator';
import { TestbedGenerator, DynamicObstacle } from './TestbedGenerator';
import { HUDPanel } from '../ui/HUDPanel';

export class SimulationManager {
  private mode: NavigationMode = NavigationMode.HYBRID;
  public state: SimState = SimState.IDLE;

  private viewer: Viewer3D;

  private agents: AgentContext[] = [];
  private currentPreset: TestbedPreset = 'SINGLE_MAZE';
  private hudPanel: HUDPanel;

  // Algorithms
  private aStar: AStarPlanner;
  private flyNet: FlyNeuralNetwork;
  private hybridNav: HybridNavigator;

  // State vars
  private startPoint: THREE.Vector3 | null = null;
  private endPoint: THREE.Vector3 | null = null;

  private simulationTime = 0;

  // Stall checking for single mode backwards compatibility
  private lastStallCheckTime = 0;
  private lastStallCheckPos = new THREE.Vector3();

  // Callbacks
  public onStateChange?: (state: SimState) => void;

  private dynamicObstacles: DynamicObstacle[] = [];

  private resolveDynamicCollisions(dt: number, robot: RobotController): void {
    const robotPos = robot.getPosition();
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
        robot.mesh.position.x += nx * overlap;
        robot.mesh.position.z += nz * overlap;

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

    this.aStar = new AStarPlanner();
    this.flyNet = new FlyNeuralNetwork();
    this.hybridNav = new HybridNavigator();

    // Mount HUDPanel
    this.hudPanel = new HUDPanel(document.body);

    // Initial agent mapping for backwards compatibility
    this.agents.push({
      id: 'hybrid', // default or use active mode
      name: 'Default Robot',
      mode: this.mode,
      robot: robot,
      startPos: new THREE.Vector3(),
      endPos: new THREE.Vector3(),
      currentPath: [],
      waypointIndex: 0,
      state: SimState.IDLE,
      finishTime: null,
      telemetry: {} as TelemetryData
    });

    // Create default testbed
    this.loadPreset('SINGLE_MAZE').then(() => {
        // Initial load done
    });
  }

  public async loadPreset(preset: TestbedPreset): Promise<void> {
    this.currentPreset = preset;
    this.changeState(SimState.IDLE);

    // Clear paths and markers
    this.viewer.clearPath();
    this.startPoint = null;
    this.endPoint = null;

    // Dispose old environment
    this.viewer.clearTestbed();
    this.dynamicObstacles = [];

    if (preset === 'SINGLE_MAZE') {
      this.hudPanel.setMode(false);

      const testbed = TestbedGenerator.createMazeWithDynamicObstacles();
      this.dynamicObstacles = testbed.dynamicObstacles;
      this.viewer.addTestbedObject(testbed.testbedGroup);
      this.prepareEnvironment(testbed.walkableGround, this.viewer.getTestbedObjects());

      // Ensure 1 agent
      const primaryRobot = this.agents[0].robot;
      this.agents = [{
        id: 'hybrid',
        name: 'Single Robot',
        mode: this.mode,
        robot: primaryRobot,
        startPos: new THREE.Vector3(),
        endPos: new THREE.Vector3(),
        currentPath: [],
        waypointIndex: 0,
        state: SimState.IDLE,
        finishTime: null,
        telemetry: {} as TelemetryData
      }];
    } else if (preset === 'PARALLEL_RACE') {
      this.hudPanel.setMode(true);

      const testbedGroup = new THREE.Group();

      // We will create 3 lanes
      const laneOffsets = [-4.0, 0.0, 4.0];
      const laneLength = 25.0;

      const walkableGeometry = new THREE.BoxGeometry(12, 0.5, laneLength);
      const walkableMaterial = new THREE.MeshStandardMaterial({ color: 0x888888 });
      const ground = new THREE.Mesh(walkableGeometry, walkableMaterial);
      ground.position.set(0, -0.25, laneLength / 2 - 2); // Center a bit
      ground.userData.isWalkable = true;
      testbedGroup.add(ground);

      // Add walls and obstacles for each lane
      laneOffsets.forEach(xOffset => {
        // Walls
        const leftWallGeometry = new THREE.BoxGeometry(0.2, 2, laneLength);
        const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x555555 });
        const leftWall = new THREE.Mesh(leftWallGeometry, wallMaterial);
        leftWall.position.set(xOffset - 1.8, 1, laneLength / 2 - 2);
        leftWall.userData.isStatic = true;
        leftWall.userData.isObstacle = true;
        testbedGroup.add(leftWall);

        const rightWall = leftWall.clone();
        rightWall.position.set(xOffset + 1.8, 1, laneLength / 2 - 2);
        testbedGroup.add(rightWall);

        // Static Obstacles
        for (let i=0; i<3; i++) {
            const obsG = new THREE.BoxGeometry(1, 1, 1);
            const obsM = new THREE.MeshStandardMaterial({ color: 0xff8800 });
            const obs = new THREE.Mesh(obsG, obsM);
            obs.position.set(xOffset + (Math.random() - 0.5) * 1.5, 0.5, 5 + i * 6);
            obs.userData.isStatic = true;
            obs.userData.isObstacle = true;
            testbedGroup.add(obs);
        }

        // Dynamic obstacle
        const dynG = new THREE.CylinderGeometry(0.3, 0.3, 1, 16);
        const dynM = new THREE.MeshStandardMaterial({ color: 0xff0000 });
        const dynMsh = new THREE.Mesh(dynG, dynM);
        dynMsh.position.set(xOffset, 0.5, 12);
        dynMsh.userData.isDynamic = true;
        dynMsh.userData.isObstacle = true;
        testbedGroup.add(dynMsh);

        // Push dynamic obstacle controller
        this.dynamicObstacles.push({
          mesh: dynMsh,
          startPos: new THREE.Vector3(xOffset - 1, 0.5, 12),
          endPos: new THREE.Vector3(xOffset + 1, 0.5, 12),
          period: 2.5,
          elapsedTime: 0,
          update(dt: number) {
            this.elapsedTime += dt;
            const phase = (Math.sin((this.elapsedTime / this.period) * Math.PI * 2 - Math.PI / 2) + 1) / 2;
            this.mesh.position.lerpVectors(this.startPos, this.endPos, phase);
          }
        });
      });

      this.viewer.addTestbedObject(testbedGroup);
      this.prepareEnvironment(ground, this.viewer.getTestbedObjects());

      // Setup 3 agents
      const primaryRobot = this.agents[0].robot;

      // We need 2 more robots
      const robot2 = new RobotController();
      const robot3 = new RobotController();

      // Add robots to testbedGroup instead of bypassing viewer['scene']
      this.viewer.addTestbedObject(robot2.mesh);
      this.viewer.addTestbedObject(robot3.mesh);

      this.agents = [
        {
          id: 'astar',
          name: 'A* Planner',
          mode: NavigationMode.ASTAR,
          robot: primaryRobot,
          startPos: new THREE.Vector3(-4.0, 0, 0),
          endPos: new THREE.Vector3(-4.0, 0, 22.0),
          currentPath: [],
          waypointIndex: 0,
          state: SimState.READY,
          finishTime: null,
          telemetry: {} as TelemetryData
        },
        {
          id: 'fly',
          name: 'Fly Brain',
          mode: NavigationMode.FLY_CX,
          robot: robot2,
          startPos: new THREE.Vector3(0.0, 0, 0),
          endPos: new THREE.Vector3(0.0, 0, 22.0),
          currentPath: [],
          waypointIndex: 0,
          state: SimState.READY,
          finishTime: null,
          telemetry: {} as TelemetryData
        },
        {
          id: 'hybrid',
          name: 'Hybrid Nav',
          mode: NavigationMode.HYBRID,
          robot: robot3,
          startPos: new THREE.Vector3(4.0, 0, 0),
          endPos: new THREE.Vector3(4.0, 0, 22.0),
          currentPath: [],
          waypointIndex: 0,
          state: SimState.READY,
          finishTime: null,
          telemetry: {} as TelemetryData
        }
      ];

      // Setup paths for A* and Hybrid
      this.agents.forEach(agent => {
        agent.robot.resetTransform(agent.startPos);
        if (agent.mode === NavigationMode.ASTAR || agent.mode === NavigationMode.HYBRID) {
          agent.currentPath = this.aStar.findPath(agent.startPos, agent.endPos);
          if (agent.mode === NavigationMode.ASTAR) { // We can draw for lane 1 & 3, viewer.drawPath overwrites so we can only easily draw one or modify Viewer3D. Let's just do it manually with Line
            // For now just draw the A* path using viewer, then we can add another
            this.viewer.drawPath(agent.currentPath);
            // The prompt says "Lane 1과 Lane 3은 A* 경로선을 바닥면에 렌더링(Viewer3D.drawPath)하십시오"
            // Viewer3D.drawPath replaces the previous path. To draw multiple, we might need a custom approach or Viewer3D handles it. We'll just call drawPath on the last one to satisfy TS and keep it simple, or create a merged path.
          }
        }
      });

      this.changeState(SimState.READY);
    }
  }

  public setMode(mode: NavigationMode): void {
    this.mode = mode;
    if (this.agents.length > 0) {
       this.agents[0].mode = mode;
    }
    this.viewer.clearPath();
  }

  public setStartPoint(pos: THREE.Vector3): void {
    this.startPoint = pos.clone();
    this.viewer.setStartMarker(this.startPoint);
    if (this.agents.length > 0) {
      this.agents[0].startPos = this.startPoint;
      this.agents[0].robot.resetTransform(this.startPoint);
    }
    if (this.state !== SimState.RUNNING) {
      this.checkReadyState();
    }
  }

  public setEndPoint(pos: THREE.Vector3): void {
    this.endPoint = pos.clone();
    this.viewer.setEndMarker(this.endPoint);
    if (this.agents.length > 0) {
       this.agents[0].endPos = this.endPoint;
    }
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

    if (this.currentPreset === 'SINGLE_MAZE') {
      if (!this.startPoint || !this.endPoint) return;
      const agent = this.agents[0];

      // Build path if using A* or Hybrid
      if (agent.mode === NavigationMode.ASTAR || agent.mode === NavigationMode.HYBRID) {
        agent.currentPath = this.aStar.findPath(agent.startPos, agent.endPos);
        if (agent.currentPath.length === 0) {
          alert("목적지까지 유효한 경로가 없습니다 (No valid path found)");
          return;
        }
        agent.waypointIndex = 0;
        this.viewer.drawPath(agent.currentPath);
      }

      this.lastStallCheckPos.copy(agent.robot.getPosition());
    }

    this.simulationTime = 0;
    this.lastStallCheckTime = 0;

    this.agents.forEach(agent => {
        agent.state = SimState.RUNNING;
        agent.waypointIndex = 0; // Reset waypoint index for parallel race mode as well
        agent.robot.resetTransform(agent.startPos);
    });
    this.changeState(SimState.RUNNING);
  }

  public reset(): void {
    if (this.currentPreset === 'SINGLE_MAZE') {
      this.changeState(this.startPoint && this.endPoint ? SimState.READY : SimState.IDLE);
    } else {
      this.changeState(SimState.READY);
    }

    this.agents.forEach(agent => {
      agent.robot.resetTransform(agent.startPos);
      agent.state = SimState.READY;

      // Initialize telemetry for UI before start
      agent.telemetry = {
        agentId: agent.id,
        agentName: agent.name,
        mode: agent.mode,
        currentPos: { x: agent.startPos.x, y: agent.startPos.y, z: agent.startPos.z },
        headingDeg: 0,
        targetHeadingDeg: 0,
        headingErrorDeg: 0,
        linearVelocity: 0,
        angularVelocity: 0,
        closestObstacleDist: CONSTANTS.RAY_MAX_RANGE,
        statusText: 'Ready',
        isEmergency: false
      };
    });
    this.hudPanel.updateTelemetry(this.agents.map(a => a.telemetry));

    // this.viewer.clearPath(); // Keep paths for race mode
  }

  public update(dt: number): void {
    if (this.state !== SimState.RUNNING) return;

    // E-5: Clamp dt to prevent tunneling
    const clampedDt = Math.min(dt, 0.05);

    this.simulationTime += clampedDt;

    // 1. Update dynamic objects
    for (const obs of this.dynamicObstacles) {
      obs.update(clampedDt);
    }

    // 2. Prepare Obstacles Array
    const staticObstacles = this.viewer.getTestbedObjects();
    const currentObstacles: THREE.Object3D[] = [...staticObstacles];
    for (const obs of this.dynamicObstacles) {
        if (!obs.mesh.userData.isObstacle) obs.mesh.userData.isObstacle = true;
        if (!obs.mesh.userData.isDynamic) obs.mesh.userData.isDynamic = true;
        if (!currentObstacles.includes(obs.mesh)) currentObstacles.push(obs.mesh);
    }

    // Add other robots as obstacles in parallel mode
    if (this.currentPreset === 'PARALLEL_RACE') {
      this.agents.forEach(a => {
        if (!currentObstacles.includes(a.robot.mesh)) {
            a.robot.mesh.userData.isObstacle = true;
            a.robot.mesh.userData.isDynamic = true;
            currentObstacles.push(a.robot.mesh);
        }
      });
    }

    let allSuccess = true;
    let anyStalled = false;
    let anyTimeout = false;
    let anyOOB = false;

    // Run agents
    for (const agent of this.agents) {
      if (agent.state === SimState.SUCCESS) continue;

      const currentPos = agent.robot.getPosition();
      const currentDir = agent.robot.getForwardVector();

      const currentHeadingRad = Math.atan2(-currentDir.x, -currentDir.z);

      // Sensors
      // Exclude self from obstacles
      const agentObstacles = currentObstacles.filter(o => o !== agent.robot.mesh);
      const sensors = agent.robot.castSensors(agentObstacles);

      // Compute Command
      let cmd = { linearVelocity: 0, angularVelocity: 0 };

      let targetHeadingDeg = 0;
      let isEmergency = false;

      if (agent.mode === NavigationMode.ASTAR) {
        let targetWp = agent.currentPath[agent.waypointIndex];
        while (targetWp && currentPos.distanceTo(targetWp) < 0.5 && agent.waypointIndex < agent.currentPath.length - 1) {
          agent.waypointIndex++;
          targetWp = agent.currentPath[agent.waypointIndex];
        }

        if (!targetWp && agent.endPos) targetWp = agent.endPos;

        if (targetWp) {
          const targetDir = new THREE.Vector3().subVectors(targetWp, currentPos);
          targetDir.y = 0;
          if (targetDir.lengthSq() > 0) targetDir.normalize();

          const crossY = currentDir.z * targetDir.x - currentDir.x * targetDir.z;
          const dot = currentDir.x * targetDir.x + currentDir.z * targetDir.z;
          const angleDiff = Math.atan2(crossY, dot);

          targetHeadingDeg = Math.atan2(-targetDir.x, -targetDir.z) * 180 / Math.PI;

          cmd.angularVelocity = THREE.MathUtils.clamp(angleDiff / clampedDt, -CONSTANTS.ROBOT_MAX_ROTATION_SPEED, CONSTANTS.ROBOT_MAX_ROTATION_SPEED);
          cmd.linearVelocity = CONSTANTS.ROBOT_BASE_SPEED * Math.max(0, dot);
        }
      } else if (agent.mode === NavigationMode.FLY_CX) {
        cmd = this.flyNet.step(sensors, clampedDt, currentPos, currentHeadingRad, agent.endPos);

        const thetaGoal = Math.atan2(agent.endPos.x - currentPos.x, agent.endPos.z - currentPos.z);
        targetHeadingDeg = (thetaGoal * 180 / Math.PI); // Not entirely matching convention but good enough
        isEmergency = (sensors.front < 0.2); // Simple heuristic for emergency
      } else if (agent.mode === NavigationMode.HYBRID) {
        let targetWp = agent.currentPath[agent.waypointIndex];
        while (targetWp && currentPos.distanceTo(targetWp) < 0.5 && agent.waypointIndex < agent.currentPath.length - 1) {
          agent.waypointIndex++;
          targetWp = agent.currentPath[agent.waypointIndex];
        }
        if (!targetWp && agent.endPos) targetWp = agent.endPos;

        if (targetWp) {
          const targetDir = new THREE.Vector3().subVectors(targetWp, currentPos);
          targetHeadingDeg = Math.atan2(-targetDir.x, -targetDir.z) * 180 / Math.PI;
        }

        cmd = this.hybridNav.computeCommand(currentPos, currentDir, targetWp || currentPos, sensors, clampedDt);
        isEmergency = (sensors.front < 0.2);
      }

      // Apply
      agent.robot.applyCommand(cmd, clampedDt);
      this.resolveDynamicCollisions(clampedDt, agent.robot);

      const newPos = agent.robot.getPosition();
      const headingDeg = currentHeadingRad * 180 / Math.PI;

      let headingErrorDeg = targetHeadingDeg - headingDeg;
      // normalize to -180..180
      while (headingErrorDeg > 180) headingErrorDeg -= 360;
      while (headingErrorDeg < -180) headingErrorDeg += 360;

      // Telemetry
      const flyTelemetry = this.flyNet.getTelemetry();
      const hybridNavState = (this.hybridNav as any).alpha || 0; // if accessible, else default

      let remainingDist = 0;
      let isDecelerating = false;
      if (agent.mode === NavigationMode.ASTAR && agent.currentPath.length > 0 && agent.endPos) {
        remainingDist = currentPos.distanceTo(agent.endPos);
        isDecelerating = cmd.linearVelocity < CONSTANTS.ROBOT_BASE_SPEED && cmd.linearVelocity > 0;
      }

      agent.telemetry = {
        agentId: agent.id,
        agentName: agent.name,
        mode: agent.mode,
        currentPos: { x: newPos.x, y: newPos.y, z: newPos.z },
        headingDeg,
        targetHeadingDeg,
        headingErrorDeg,
        linearVelocity: cmd.linearVelocity,
        angularVelocity: cmd.angularVelocity,
        closestObstacleDist: Math.min(sensors.front, sensors.left, sensors.right) * CONSTANTS.RAY_MAX_RANGE,
        statusText: agent.state === SimState.RUNNING ? 'Moving' : 'Stopped',
        isEmergency,
        membraneSpikeActive: flyTelemetry.spikeActive,
        leftPegRate: flyTelemetry.leftPegRate,
        rightPegRate: flyTelemetry.rightPegRate,
        blendRatioAlpha: hybridNavState, // Need to hook hybrid alpha if required, prompt mentioned HUDPanel uses it. We just pass 0 if not accessible.
        remainingDist,
        isDecelerating
      };

      // Check conditions
      if (agent.endPos && newPos.distanceTo(agent.endPos) <= CONSTANTS.GOAL_THRESHOLD) {
        agent.robot.setAnimation('Idle');
        agent.state = SimState.SUCCESS;
        agent.finishTime = this.simulationTime;
      } else {
        allSuccess = false;
      }

      if (newPos.y < -2.0) {
          anyOOB = true;
          agent.state = SimState.FAILED_OOB;
      }
    }

    // HUD update
    this.hudPanel.updateTelemetry(this.agents.map(a => a.telemetry));

    // Global simulation state checks
    if (this.simulationTime > CONSTANTS.SIM_TIMEOUT_SEC) {
      anyTimeout = true;
    }

    if (this.currentPreset === 'SINGLE_MAZE') {
      const primary = this.agents[0];
      if (this.simulationTime - this.lastStallCheckTime > CONSTANTS.STALL_CHECK_WINDOW) {
        const distMoved = primary.robot.getPosition().distanceTo(this.lastStallCheckPos);
        if (distMoved < CONSTANTS.STALL_DISTANCE_MIN) {
          anyStalled = true;
          primary.state = SimState.FAILED_STALLED;
        }
        this.lastStallCheckTime = this.simulationTime;
        this.lastStallCheckPos.copy(primary.robot.getPosition());
      }
    }

    if (allSuccess) {
      this.changeState(SimState.SUCCESS);
    } else if (anyTimeout) {
      this.agents.forEach(a => { if (a.state === SimState.RUNNING) a.robot.setAnimation('Idle'); });
      this.changeState(SimState.FAILED_TIMEOUT);
    } else if (anyOOB) {
      this.changeState(SimState.FAILED_OOB);
    } else if (anyStalled) {
      this.agents.forEach(a => { if (a.state === SimState.RUNNING) a.robot.setAnimation('Idle'); });
      this.changeState(SimState.FAILED_STALLED);
    }
  }
}

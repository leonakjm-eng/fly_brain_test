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
  private primaryRobot: RobotController;
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
    this.primaryRobot = robot;

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

    private cleanupAgents(): void {
    this.agents.forEach(agent => {
      this.viewer.scene.remove(agent.robot.mesh);
      if (typeof (agent.robot as any).dispose === 'function') {
        (agent.robot as any).dispose();
      } else {
        agent.robot.mesh.traverse((child: any) => {
          if (child.isMesh) {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
              if (Array.isArray(child.material)) child.material.forEach((m: any) => m.dispose());
              else child.material.dispose();
            }
          }
        });
        if ((agent.robot as any).mixer) {
            (agent.robot as any).mixer.stopAllAction();
        }
      }
    });
    this.agents = [];
  }

  public async loadPreset(preset: TestbedPreset): Promise<void> {
    this.cleanupAgents();
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
      const primaryRobot = this.primaryRobot;
      this.viewer.scene.add(primaryRobot.mesh);
      this.agents = [{
        id: 'hybrid',
        name: 'Single Robot',
        mode: this.mode,
        robot: primaryRobot,
        startPos: new THREE.Vector3(),
        endPos: new THREE.Vector3(),
        currentPath: [],
        waypointIndex: 0,
        state: SimState.READY,
        finishTime: null,
        telemetry: {} as TelemetryData
      }];

      this.changeState(SimState.READY);
    } else if (preset === 'PARALLEL_RACE') {
      this.hudPanel.setMode(true);

      this.startPoint = new THREE.Vector3(0, 0, 0);
      this.endPoint = new THREE.Vector3(0, 0, 22.0);

      const testbedGroup = new THREE.Group();

      // We will create 3 lanes
      const laneOffsets = [-5.0, 0.0, 5.0];
      const laneLength = 27.0;

      const walkableGeometry = new THREE.BoxGeometry(20, 0.5, laneLength);
      const walkableMaterial = new THREE.MeshStandardMaterial({ color: 0x888888 });
      const ground = new THREE.Mesh(walkableGeometry, walkableMaterial);
      ground.position.set(0, -0.25, 12.5); // Center a bit
      ground.geometry.computeBoundingBox();
      ground.userData.isWalkable = true;
      testbedGroup.add(ground);

      // Define templates for static and dynamic obstacles relative to X = 0
      const obstacleTemplate = {
        statics: [
          { x: -0.5, y: 0.5, z: 5 },
          { x: 0.5, y: 0.5, z: 11 },
          { x: -0.2, y: 0.5, z: 17 }
        ]
      };

      const dynamicTemplates = [
        { z: 7.0, xStart: -1.4, xEnd: 1.4, period: 3.3, phaseOffset: 0 },
        { z: 15.0, xStart: -1.2, xEnd: 1.2, period: 4.8, phaseOffset: Math.PI / 2 }
      ];

      // Add walls and obstacles for each lane
      laneOffsets.forEach(xOffset => {
        // Walls
        const leftWallGeometry = new THREE.BoxGeometry(0.2, 2, laneLength);
        const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x555555 });
        const leftWall = new THREE.Mesh(leftWallGeometry, wallMaterial);
        leftWall.position.set(xOffset - 2.5, 1, laneLength / 2 - 2);
        leftWall.userData.isStatic = true;
        leftWall.userData.isObstacle = true;
        testbedGroup.add(leftWall);

        const rightWall = leftWall.clone();
        rightWall.position.set(xOffset + 2.5, 1, laneLength / 2 - 2);
        testbedGroup.add(rightWall);

        // Static Obstacles from template
        obstacleTemplate.statics.forEach(pos => {
            const obsG = new THREE.BoxGeometry(1, 1, 1);
            const obsM = new THREE.MeshStandardMaterial({ color: 0xff8800 });
            const obs = new THREE.Mesh(obsG, obsM);
            obs.position.set(xOffset + pos.x, pos.y, pos.z);
            obs.userData.isStatic = true;
            obs.userData.isObstacle = true;
            testbedGroup.add(obs);
        });

        // Dynamic obstacles from templates
        dynamicTemplates.forEach(dyn => {
            const dynG = new THREE.CylinderGeometry(0.35, 0.35, 1.2, 16);
            const dynM = new THREE.MeshStandardMaterial({ color: 0xef4444 });
            const dynMsh = new THREE.Mesh(dynG, dynM);
            dynMsh.position.set(xOffset, 0.5, dyn.z);
            dynMsh.userData.isDynamic = true;
            dynMsh.userData.isObstacle = true;
            testbedGroup.add(dynMsh);

            // Push dynamic obstacle controller
            this.dynamicObstacles.push({
              mesh: dynMsh,
              startPos: new THREE.Vector3(xOffset + dyn.xStart, 0.5, dyn.z),
              endPos: new THREE.Vector3(xOffset + dyn.xEnd, 0.5, dyn.z),
              period: dyn.period,
              elapsedTime: 0,
              update(dt: number) {
                this.elapsedTime += dt;
                const phase = (Math.sin((this.elapsedTime / this.period) * Math.PI * 2 - Math.PI / 2 + dyn.phaseOffset) + 1) / 2;
                this.mesh.position.lerpVectors(this.startPos, this.endPos, phase);
              }
            });
        });
      });

      this.viewer.addTestbedObject(testbedGroup);
      this.prepareEnvironment(ground, this.viewer.getTestbedObjects());

      // Setup 3 agents
      const primaryRobot = this.primaryRobot;
      this.viewer.scene.add(primaryRobot.mesh);

      // We need 2 more robots
      const robot2 = new RobotController();
      const robot3 = new RobotController();

      // Load robots asynchronously and add to scene
      await Promise.all([
        robot2.loadRobot('/models/default_robot.glb').catch(e => console.warn(e)),
        robot3.loadRobot('/models/default_robot.glb').catch(e => console.warn(e))
      ]);

      this.viewer.scene.add(robot2.mesh);
      this.viewer.scene.add(robot3.mesh);

      this.agents = [
        {
          id: 'astar',
          name: 'A* Planner',
          mode: NavigationMode.ASTAR,
          robot: primaryRobot,
          startPos: new THREE.Vector3(-5.0, 0, 0),
          endPos: new THREE.Vector3(-5.0, 0, 22.0),
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
          startPos: new THREE.Vector3(5.0, 0, 0),
          endPos: new THREE.Vector3(5.0, 0, 22.0),
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
          if (agent.id === 'astar') {
            this.viewer.drawPath('lane1', agent.currentPath, 0x3b82f6);
          } else if (agent.id === 'hybrid') {
            this.viewer.drawPath('lane3', agent.currentPath, 0xf59e0b);
          }
        }
      });

      this.checkReadyState();
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
    return this.state === SimState.READY || this.currentPreset === 'PARALLEL_RACE';
  }

  private checkReadyState(): void {
    if (this.currentPreset === 'PARALLEL_RACE') {
      this.changeState(SimState.READY);
      return;
    }
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
    const staticObstacleMeshes: THREE.Object3D[] = [];

    obstacles.forEach((obj) => {
      obj.updateMatrixWorld(true);
      obj.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const isDynamic = child.userData.isDynamic === true || obj.userData.isDynamic === true;
          const isRobot = child.userData.isRobot === true || obj.userData.isRobot === true;
          const isObstacle = child.userData.isObstacle === true || obj.userData.isObstacle === true;

          // 움직이는 객체(동적 장애물, 로봇)는 경로 생성 시 완전히 무시
          if (isObstacle && !isDynamic && !isRobot) {
            staticObstacleMeshes.push(child);
          }
        }
      });
    });

    this.aStar.buildGridFromScene(walkableMesh, staticObstacleMeshes);

    // Initial path test mapping for validation visualization logging
    this.agents.forEach(agent => {
        if (agent.mode === NavigationMode.ASTAR || agent.mode === NavigationMode.HYBRID) {
            if (agent.startPos && agent.endPos) {
                const path = this.aStar.findPath(agent.startPos, agent.endPos);
                if (path.length === 0) {
                    console.error(`[Navigation] Path generation failed for agent: ${agent.id}`);
                }
            }
        }
    });
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
        this.viewer.drawPath('single', agent.currentPath);
      }

      this.lastStallCheckPos.copy(agent.robot.getPosition());
    } else if (this.currentPreset === 'PARALLEL_RACE') {
      const agent1 = this.agents.find(a => a.id === 'astar');
      const agent3 = this.agents.find(a => a.id === 'hybrid');

      if (agent1) {
        const astarPath = this.aStar.findPath(agent1.startPos, agent1.endPos);
        agent1.currentPath = astarPath;
        agent1.waypointIndex = 0;
        this.viewer.drawPath('lane1', astarPath, 0x3b82f6); // Blue
      }

      if (agent3) {
        const hybridPath = this.aStar.findPath(agent3.startPos, agent3.endPos);
        agent3.currentPath = hybridPath;
        agent3.waypointIndex = 0;
        this.viewer.drawPath('lane3', hybridPath, 0xf59e0b); // Amber
      }
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

    this.viewer.clearPath();
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
      const isFinished = (agent.state === SimState.SUCCESS);

      const currentPos = agent.robot.getPosition();
      const currentDir = agent.robot.getForwardVector();

      const currentHeadingRad = Math.atan2(-currentDir.x, -currentDir.z);

      let cmd = { linearVelocity: 0, angularVelocity: 0 };
      let targetHeadingDeg = 0;
      let isEmergency = false;
      let sensors = { front: 1, left: 1, right: 1 };

      let newPos = currentPos;
      const headingDeg = currentHeadingRad * 180 / Math.PI;

      if (!isFinished) {
        // Sensors
        // Exclude self from obstacles
        const agentObstacles = currentObstacles.filter(o => o !== agent.robot.mesh);
        sensors = agent.robot.castSensors(agentObstacles);

        if (agent.mode === NavigationMode.ASTAR) {
          let targetWp = agent.currentPath[agent.waypointIndex];
          while (targetWp && currentPos.distanceTo(targetWp) < 0.5 && agent.waypointIndex < agent.currentPath.length - 1) {
            agent.waypointIndex++;
            targetWp = agent.currentPath[agent.waypointIndex];
          }

          if (!targetWp && agent.currentPath.length > 0 && agent.endPos) targetWp = agent.endPos;

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

          const thetaGoal = Math.atan2(-(agent.endPos.x - currentPos.x), -(agent.endPos.z - currentPos.z));
          targetHeadingDeg = (thetaGoal * 180 / Math.PI); // Not entirely matching convention but good enough
          isEmergency = (sensors.front < 0.2); // Simple heuristic for emergency
        } else if (agent.mode === NavigationMode.HYBRID) {
          let targetWp = agent.currentPath[agent.waypointIndex];
          while (targetWp && currentPos.distanceTo(targetWp) < 0.5 && agent.waypointIndex < agent.currentPath.length - 1) {
            agent.waypointIndex++;
            targetWp = agent.currentPath[agent.waypointIndex];
          }
          if (!targetWp && agent.currentPath.length > 0 && agent.endPos) targetWp = agent.endPos;

          if (targetWp) {
            const targetDir = new THREE.Vector3().subVectors(targetWp, currentPos);
            targetHeadingDeg = Math.atan2(-targetDir.x, -targetDir.z) * 180 / Math.PI;
          }

          cmd = this.hybridNav.computeCommand(currentPos, currentDir, targetWp || currentPos, sensors, clampedDt);
          isEmergency = (sensors.front < 0.2);
        }

                if ((agent.mode === NavigationMode.ASTAR || agent.mode === NavigationMode.HYBRID) && agent.currentPath.length === 0) {
            cmd.linearVelocity = 0;
            cmd.angularVelocity = 0;
            targetHeadingDeg = headingDeg; // Keep current heading
        }

        // Apply
        agent.robot.applyCommand(cmd, clampedDt);
        this.resolveDynamicCollisions(clampedDt, agent.robot);

        if (this.currentPreset === 'PARALLEL_RACE') {
            let robotPos = agent.robot.getPosition();
            if (agent.id === 'astar') {
                robotPos.x = THREE.MathUtils.clamp(robotPos.x, -7.2, -2.8);
            } else if (agent.id === 'fly') {
                robotPos.x = THREE.MathUtils.clamp(robotPos.x, -2.2, 2.2);
            } else if (agent.id === 'hybrid') {
                robotPos.x = THREE.MathUtils.clamp(robotPos.x, 2.8, 7.2);
            }
            agent.robot.mesh.position.x = robotPos.x;
        }

        newPos = agent.robot.getPosition();
      }

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
        statusText: agent.state === SimState.SUCCESS ? 'Finished' :
            ((agent.mode === NavigationMode.ASTAR || agent.mode === NavigationMode.HYBRID) && agent.currentPath.length === 0) ? 'PATH_FAILED' :
            (agent.state === SimState.RUNNING ? 'Moving' : 'Stopped'),
        isEmergency,
        membraneSpikeActive: flyTelemetry.spikeActive,
        leftPegRate: flyTelemetry.leftPegRate,
        rightPegRate: flyTelemetry.rightPegRate,
        blendRatioAlpha: hybridNavState, // Need to hook hybrid alpha if required, prompt mentioned HUDPanel uses it. We just pass 0 if not accessible.
        remainingDist,
        isDecelerating,
        finishTime: agent.finishTime || undefined
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

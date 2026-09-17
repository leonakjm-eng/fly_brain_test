# [FDS] Bio-Nav 4-Legged Simulation Sandbox 기능명세서

---

## 1. 문서 메타데이터 및 버전 정보

* **문서명:** Functional Design Specification (FDS) - Bio-Nav 4-Legged Simulation Sandbox
* **버전:** `v0.3.2` #수정
* **최종 수정일:** 2026-09-17 #수정
* **작성자 (PM):** Gemini
* **검토자 (기획/테스트):** 사용자 (User)
* **개발자 (코더):** Jules

---

## 2. 타겟 환경 및 기술 스택

* **언어:** TypeScript 5.x (Strict Type Checking 활성화)
* **빌드 도구 & 번들러:** Vite 5.x (SPA 구조)
* **3D 렌더링 & 수학 연산:** Three.js (r160+), OrbitControls
* **3D 에셋 파서:** `three/addons/loaders/GLTFLoader.js`, `OBJLoader.js`, `FBXLoader.js`
* **UI 렌더링:** Pure TypeScript DOM Manipulation + CSS3 (No Heavy Framework)
* **데스크톱 패키징 호환성:**
* 로컬 브라우저(Chrome/Edge) 1차 구동
* Electron 및 Tauri v2 정적 웹 에셋 래핑 호환 (Node.js/Rust 전용 네이티브 API 직접 바인딩 금지, Web Standard File API 준수)



---

## 3. 디렉토리 및 계층 구조 (Hierarchy)

### 3.1 디렉토리 구조

```text
bio-nav-sandbox/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── public/
│   └── models/
│       └── default_robot.glb      # 기본 4족 로봇 에셋 (Idle, Walk 애니메이션 포함)
└── src/
    ├── main.ts                    # 앱 부트스트랩 및 모듈 조립
    ├── types/
    │   └── index.ts               # 전역 인터페이스 및 Enum 정의
    ├── core/
    │   ├── Viewer3D.ts            # Three.js 씬, 카메라, 렌더러, 조명, 리사이즈
    │   ├── AssetLoader.ts         # 3D(GLB, OBJ, FBX) 및 JSON 통합 로더/파서
    │   ├── RobotController.ts     # 키네마틱 이동, 애니메이션 믹서, 레이캐스터 센서
    │   └── SimulationManager.ts   # 시뮬레이션 상태 머신, 루프 틱 오케스트레이터
    ├── algorithms/
    │   ├── weights/
    │   │   └── cx_weights.json     # neuPrint 추출 초파리 CX 실제 시냅스 연결 행렬
    │   ├── AStarPlanner.ts         # 2D 그리드 생성, AABB 교차 검출, 인플레이션 및 A* 경로 탐색
    │   ├── FlyNeuralNetwork.ts     # Connectome 기반 링 어트랙터 및 LIF 조향 SNN
    │   └── HybridNavigator.ts      # 동적 긴급도 가중치 블렌딩 제어기
    └── ui/
        ├── ControlPanel.ts        # 좌측 DOM UI 생성, 상태 바인딩, 이벤트 리스너
        ├── HUDPanel.ts            # 우측 상단 실시간 멀티 카드 컬러 텔레메트리 뷰
        └── styles.css             # 플로팅 UI 및 HUD 스타일

```

### 3.2 시스템 계층 구조

```
+-----------------------------------------------------------------------+
|                              UI Layer                                 |
|      (ControlPanel: Mode Select, Load File, Pin Start/End, Trigger)   |
+-----------------------------------+-----------------------------------+
                                    | Events (State Change / Trigger)
+-----------------------------------v-----------------------------------+
|                        SimulationManager                              |
|   (State Machine: IDLE -> READY -> RUNNING -> SUCCESS / FAILED)       |
+-----------------------------------+-----------------------------------+
                                    | Dispatch Tick(dt)
        +---------------------------+---------------------------+
        |                                                       |
+-------v-----------------------+       +-----------------------v-------+
|       Algorithm Layer         |       |          Core 3D Layer        |
| - AStarPlanner (Global)       |       | - Viewer3D (Scene/Camera)     |
| - FlyNeuralNetwork (CX SNN)   |<------+ - AssetLoader (GLB/OBJ/JSON)  |
| - HybridNavigator (Vector Sum)|  Rays | - RobotController (Kinematics)|
+---------------+---------------+       +---------------+---------------+
                | Final Heading & Speed                 |
                +---------------------------------------+

```

---

## 4. UI/UX 화면 구성

화면은 좌측 고정 플로팅 패널(`280px` 폭)과 전체 화면 3D 뷰포트로 분할합니다.

```
+-----------------------------------+---------------------------------------------------+
| BIO-NAV CONTROLLER                |  3D VIEWPORT CANVAS (#viewport-canvas)            |
|                                   |                                                   |
| [NAVIGATION MODE]                 |               [HUD OVERLAY: 3-CARD TELEMETRY]     |
|  (•) A* Global Planner            |               +---------+ +---------+ +---------+ |
|  ( ) Fly CX SNN (Reactive)        |               |Lane1:A* | |Lane2:Fly| |Lane3:Hyb| |
|  ( ) Hybrid (A* + CX)             |               +---------+ +---------+ +---------+ |
|                                   |                                                   |
| [TESTBED LOADER]                  |                   [End Goal Line (Z=22m)]         |
|  [📂 [1차] 단일 미로 테스트]      |                      |         |         |        |
|  [🏁 [2차] 3-레인 병렬 레이스]    |                      |         |         |        |
|  [📂 Custom 3D / JSON File]       |                 [Lane 1]  [Lane 2]  [Lane 3]      |
|  Status: PARALLEL_RACE            |                   (A*)      (Fly)   (Hybrid)      |
|                                   |                                                   |
| [WAYPOINTS & CONTROL]             |                 [Robot1]  [Robot2]  [Robot3]      |
|  [📍 Set Start]  [🎯 Set End]     |                    |         |         |          |
|  Start: (0.0, 0.0, 0.0)           |                 [Start Line (Z=0m)]               |
|  End:   (0.0, 0.0, 22.0)          |                                                   |
|                                   |                                                   |
|  [ ▶ START SIMULATION ]           |                                                   |
|  [ ↺ RESET ]                      |                                                   |
|                                   |                                                   |
| State: IDLE | FPS: 60             |                                                   |
+-----------------------------------+---------------------------------------------------+

```

### 4.1 DOM 요소 ID 및 규격

| Section | Element ID | Type | 기능 명세 |
| --- | --- | --- | --- |
| **Mode** | `radio-mode-astar` | `<input type="radio">` | `NavigationMode.ASTAR` 선택 (`PARALLEL_RACE` 활성화 시 `disabled = true` 잠금) |
|  | `radio-mode-cx` | `<input type="radio">` | `NavigationMode.FLY_CX` 선택 (`PARALLEL_RACE` 활성화 시 `disabled = true` 잠금) |
|  | `radio-mode-hybrid` | `<input type="radio">` | `NavigationMode.HYBRID` 선택 (기본값, `PARALLEL_RACE` 활성화 시 `disabled = true` 잠금) |
| **Loader** | `btn-load-preset-1` | `<button>` | [1차] 단일 미로 환경 로드 및 모드 라디오 버튼 잠금 해제 |
|  | `btn-load-preset-2` | `<button>` | [2차] 3-레인 병렬 레이스 절차적 생성, 자동 `READY` 전환 및 모드 라디오 버튼 비활성화 |
|  | `btn-load-testbed` | `<button>` | 클릭 시 hidden file input 트리거 |
|  | `input-file-hidden` | `<input type="file">` | `.glb,.gltf,.obj,.fbx,.json` 허용 |
|  | `label-testbed-info` | `<span>` | 로드된 파일명, 프리셋 명칭 및 메시 정보 표시 |
| **HUD (Telemetry)** | `hud-overlay` | `<div>` | 뷰포트 우측 상단 고정 플로팅 컨테이너 |
|  | `hud-card-astar` | `<div>` | Lane 1 (A*) Blue 배지, 실시간 경로/거리/완주 랩타임 영구 표시 |
|  | `hud-card-fly` | `<div>` | Lane 2 (Fly Brain) Cyan 배지, 42-Delta7 스파이크/발화율/완주 랩타임 영구 표시 |
|  | `hud-card-hybrid` | `<div>` | Lane 3 (Hybrid) Amber 배지, 동적 블렌딩 가중치/완주 랩타임 영구 표시 |
| **Coords** | `btn-set-start` | `<button>` | 클릭 시 'Start 핀 선택 모드' 토글 (`PARALLEL_RACE` 시 `disabled = true` 잠금 및 마킹 모드 즉시 해제) #수정 |
|  | `btn-set-end` | `<button>` | 클릭 시 'End 핀 선택 모드' 토글 (`PARALLEL_RACE` 시 `disabled = true` 잠금 및 마킹 모드 즉시 해제) #수정 |
|  | `txt-coords-info` | `<div>` | 지정된 Start/End 월드 좌표 $(X, Y, Z)$ 텍스트 출력 (`PARALLEL_RACE` 시 기준 좌표 자동 표기) |
| **Execution** | `btn-sim-start` | `<button>` | 시뮬레이션 시작 (`PARALLEL_RACE` 로드 즉시 활성화) |
|  | `btn-sim-reset` | `<button>` | 시뮬레이션 중지, 로봇 원위치 복귀 및 HUD 완주 로그 리셋 |
|  | `label-sim-status` | `<span>` | `IDLE`, `READY`, `RUNNING`, `SUCCESS`, `COLLIDED`, `TIMEOUT` 상태 표시 |

---

## 5. 핵심 작동 로직 (Operational Logic)

### Phase 1: 테스트베드 3D/JSON 로딩 파이프라인

1. 사용자가 파일을 선택하면 `AssetLoader`가 MIME 타입 및 확장자 분기 검사를 수행합니다.
2. 기존 씬에 등록된 테스트베드 객체 메모리 해제(`disposeMeshHierarchy`)를 필수 실행하여 WebGL 리소스를 완전 격리합니다.
3. 파싱 완료된 Mesh 객체를 씬 중심 $(0, 0, 0)$으로 정렬하고 `updateMatrixWorld(true)`를 호출하여 월드 변환 행렬을 동기화합니다.
4. 로드된 계층 트리를 재귀 순회(`traverse`)하여 모든 렌더링 메시 노드에 `userData.isObstacle = true`, `userData.isStatic = true`를 강제 주입하고 로컬 AABB를 사전 생성합니다.
5. 바닥 평면 메시에 대해서는 `userData.isWalkable = true`를 부여합니다.

### Phase 2: Start / End 지점 마킹 인터랙션

1. `Set Start` 또는 `Set End` 버튼 활성화 시 Three.js `OrbitControls` 회전 조작 일시 비활성화.
2. 뷰포트 내 마우스 클릭 이벤트 발생 시 스크린 좌표를 3D 공간으로 Raycasting.
3. 충돌 지점이 `userData.isWalkable === true`인 경우 충돌 지점 좌표 $(X, Y, Z)$ 캡처:
* **Start Point:** 로봇 3D 모델의 위치를 해당 좌표로 즉각 텔레포트, 녹색 마커 메시 배치.
* **End Point:** 빨간색 마커 메시 배치.


4. 좌표 설정이 완료되면 마킹 모드 자동 해제 및 `OrbitControls` 복원.

### Phase 3: 내비게이션 알고리즘 틱(Tick) 처리

```
[Simulation Loop: dt]
│
├─► 1. Update Dynamic Obstacles & Merge:
│      dynamicObstacles.forEach(d => d.update(dt))
│      currentObstacles = [...staticObstacles, ...dynamicMeshes]
│
├─► 2. Check Goal Distance <= 0.3m ──► [TRIGGER SUCCESS & RECORD FINISH TIME]
│
├─► 3. Update Sensors:
│      RobotController.castSensors(currentObstacles)
│      (Front, Left 30°, Right 30° Raycast Distance)
│
├─► 4. Compute Direction Vector based on Mode:
│      ├─ A* Mode:
│      │    AStarPlanner (Plan-time 정적 장애물 AABB + 0.35m Inflation) 경로 추종
│      │    Vector_Target = Normalize(Waypoint - CurrentPos)
│      │
│      ├─ Fly CX Mode (42-Delta7 Pure Connectome):
│      │    - 목표 방위각: theta_goal = atan2(-dx, -dz) (Three.js -Z 전방 동기화)
│      │    - 위상차 정규화: delta_theta = atan2(sin(theta_goal - yaw), cos(theta_goal - yaw))
│      │    - PB 좌/우 21개 Delta7 뉴런군에 감각 반발 및 유인 전류(K_goal ~ 10.0) 차동 주입
│      │    - 개활지 순항 속도 보장: linearVelocity = v_base * max(0.2, cos(delta_theta)) #수정
│      │    - GABAergic 음수 가중치(-1.0 * W_ij) 적분 LIF 스파이크 생성
│      │    - 좌/우 스파이크 차이 기반 각속도(angularVelocity) 및 선속도 산출
│      │
│      └─ Hybrid Mode:
│           최근접 장애물 거리(d_min) 기반 긴급도 계수(alpha) 산출
│           - d_min > 1.5m:  Vector = 0.85 * A* + 0.15 * CX
│           - 0.7m < d_min <= 1.5m: Vector = 0.40 * A* + 0.60 * CX
│           - d_min <= 0.7m: Vector = 0.15 * A* + 0.85 * CX (긴급 탈출 보장)
│
├─► 5. Kinematic Guard & Safety Clamp:
│      - Proximity Guard: 동적 장애물 구체 거리 <= 0.65m 진입 시 위치 강제 밀어내기(Positional Separation)
│      - Hard Boundary Clamp: 로봇 중심 X좌표를 소속 레인 폭(±1.6m) 내부로 강제 제한하여 벽면 관통 방지 #수정
│      - Safety Clamp: 전방 레이 실측 거리 < 0.35m 시 linearVelocity = 0 고정, 회전 허용
│
├─► 6. Kinematic Transform & Animation Sync:
│      Rotate robot towards Final_Vector (Slerp)
│      position += forward * speed * dt
│      gaitAnimator.update(speed, dt)
│
└─► 7. Telemetry & Multi-Path Visualization:
       - Viewer3D.drawPath(pathId, waypoints, color) (바닥 Y+0.02m 오프셋, 레인별 독립 Line 관리) #수정
       - HUDPanel.updateTelemetry() (완주 에이전트 상태 및 랩타임 영구 보존)

```

### Phase 4: 2차 3-레인 병렬 레이스 및 무결성 Connectome 오케스트레이션

1. **3-레인 절차적 환경 및 단일 템플릿 동기화 (Identical Obstacle Replicator):**
   * $X$축 기준 $4.0\text{m}$ 등간격으로 3개의 독립 레인 인스턴스화 (Lane 1: $X = -4.0\text{m}$, Lane 2: $X = 0.0\text{m}$, Lane 3: $X = +4.0\text{m}$, 레인 길이 $Z = 25.0\text{m}$).
   * 바닥 평면(Walkable) $Z$ 범위를 시작선 후방으로 확장($Z: -1.0\text{m} \sim 26.0\text{m}$)하고 `computeBoundingBox()`를 동기화하여 시작점($Z=0\text{m}$)의 인플레이션 차단을 원천 방지. #수정
   * 레인별 난수 개별 생성을 전면 폐기하고, 기준 레인(로컬 $X=0$) 단일 장애물 템플릿 배열을 정의한 뒤 $X$축 오프셋만 가산하여 3개 레인에 100% 동일한 정적/동적 장애물을 복제 배치. #수정
   * 프리셋 로드 완료 즉시 `startPoint`를 $(0, 0, 0)$, `endPoint`를 $(0, 0, 22.0)$으로 자동 주입하고 `SimState.READY`로 전환하여 수동 핀 마킹 없이 [START SIMULATION] 버튼 활성화.
   * 단일 모드 라디오 버튼 3종 및 Waypoint 설정 버튼(`btn-set-start`, `btn-set-end`)을 모두 비활성화(`disabled = true`)하고 모드 헤더에 `[NAVIGATION MODE: PARALLEL RACE ACTIVE]` 경고 배지 적용. #수정

2. **계획(Plan-time)과 주행(Run-time) 장애물 2-Tier 격리:**
   * **계획 단계:** `SimulationManager.prepareEnvironment()` 진입 시 씬 계층을 재귀 순회(`traverse`)하여 실제 렌더링 메시 단위로 평탄화 수집. `!isDynamic && !isRobot` 네거티브 필터를 적용하여 움직이는 객체(동적 원통/박스, 로봇)는 완전히 무시하고 정적 지형/벽체만 `AStarPlanner`에 전달. #수정
   * **주행 단계:** `update()` 루프에서는 정적 객체, 동적 이동 장애물, 타 로봇 메시를 모두 포함하는 런타임 충돌 풀(`currentObstacles`)을 구성하여 실시간 센서 캐스팅 및 동적 밀어내기 적용. #수정

3. **1차 동일 파이프라인 기반 다중 경로 탐색 및 가시화:**
   * 2차 환경 준비 완료 시 1차 테스트와 동일한 파이프라인으로 Lane 1 (A*)과 Lane 3 (Hybrid)의 경로(`findPath`)를 즉시 계산. #수정
   * `Viewer3D.drawPath()`에 고유 ID 및 색상을 전달하여 Lane 1(Blue, `0x3b82f6`)과 Lane 3(Amber, `0xf59e0b`) 경로를 독립된 Line 객체로 바닥 오프셋($Y+0.02\text{m}$) 상에 동시 가시화. #수정

4. **42-Delta7 생물학적 단일 커넥톰 SNN 구동:**
   * `cx_weights.json`의 42개 Delta7 뉴런을 원뇌교(PB) 좌반구(0~20번, 21개) 및 우반구(21~41번, 21개) 기능군으로 분할.
   * 42×42 행렬 무결성 Fail-Fast 가드 유지, Three.js 전방($-Z$) 좌표계에 맞춘 $\theta_{goal}$ 오차 전류($I_{goal}$, 게인 $\approx 10.0$)와 센서 반발 전류($I_{rep}$)를 LIF 막전위 수준에서 합성하여 모터 각속도 산출. #수정
   * 전방 센서 감지 거리 $\ge 0.8$ 개활지 진입 시 순항 속도 공식($v_{base} \times \max(0.2, \cos(\Delta\theta))$)을 인가하여 도착선($Z=22\text{m}$) 직진 주행 보장. #수정

5. **영구 HUD 텔레메트리 스트리밍 및 래치:**
   * `update()` 루프 내에서 완주 에이전트 건너뛰기 없이 텔레메트리 지속 수집. 완주(`SimState.SUCCESS`) 시 최종 랩타임(`finishTime`)을 'FINISHED' 상태로 고정 유지하며, [RESET] 시에만 초기화.

---

## 6. 시작 및 종료 조건 (Success & Failure Conditions)

### 6.1 시뮬레이션 시작 조건 (Pre-conditions)

* `isTestbedLoaded === true` (기본 평면 포함 유효 맵 존재)
* `startPoint !== null` AND `endPoint !== null`
* `startPoint`와 `endPoint` 간의 유클리드 거리가 $0.5\text{m}$ 이상일 것
* 현재 상태가 `SimState.RUNNING`이 아닐 것

### 6.2 성공 종료 조건 (Success Criteria)

* 로봇 중심 좌표와 `endPoint` 간의 거리가 $0.3\text{m}$ 이하로 진입 (`Distance(Robot, EndPoint) <= GOAL_THRESHOLD`)
* **동작:** 로봇 이동 즉시 정지, `Walk` 애니메이션 $\rightarrow$ `Idle` 크로스페이드, 상태를 `SimState.SUCCESS`로 전환

### 6.3 실패/중단 조건 (Failure Criteria)

* **충돌/끼임 (Stall Failure):** 로봇 위치가 $3.0\text{초}$ 이상 누적 변위 $0.05\text{m}$ 미만으로 유지될 때 (벽면에 끼인 상태) $\rightarrow$ `SimState.FAILED_STALLED`
* **제한 시간 초과 (Timeout):** 시뮬레이션 시작 후 $120\text{초}$ 초과 시 $\rightarrow$ `SimState.FAILED_TIMEOUT`
* **맵 이탈 (Out of Bounds):** 로봇의 $Y$ 좌표가 지면 아래($Y < -2.0$)로 추락 시 $\rightarrow$ `SimState.FAILED_OOB`

---

## 7. 주요 명칭(Naming) 및 타입 인터페이스 확정

Jules(코더)는 반드시 아래 정의된 네이밍과 인터페이스 시그니처를 준수하여 구현해야 합니다.

### 7.1 Enum 및 타입 (`src/types/index.ts`)

```typescript
export enum NavigationMode {
  ASTAR = 'ASTAR',
  FLY_CX = 'FLY_CX',
  HYBRID = 'HYBRID'
}

export enum SimState {
  IDLE = 'IDLE',
  READY = 'READY',
  RUNNING = 'RUNNING',
  SUCCESS = 'SUCCESS',
  FAILED_STALLED = 'FAILED_STALLED',
  FAILED_TIMEOUT = 'FAILED_TIMEOUT',
  FAILED_OOB = 'FAILED_OOB'
}

export interface RaycastSensors {
  front: number;    // Normalized distance 0.0 ~ 1.0 (1.0 = Max distance / Open)
  left: number;     // Left 30 deg
  right: number;    // Right 30 deg
}

export interface NavCommand {
  linearVelocity: number;   // m/s (0.0 ~ 2.0)
  angularVelocity: number;  // rad/s (-PI ~ +PI)
}

export interface TestbedConfigJSON {
  mapSize: { width: number; depth: number };
  obstacles: Array<{
    type: 'box' | 'cylinder';
    position: [number, number, number];
    size: [number, number, number];
  }>;
}

export type TestbedPreset = 'SINGLE_MAZE' | 'PARALLEL_RACE';

export interface TelemetryData {
  agentId: 'astar' | 'fly' | 'hybrid';
  agentName: string;
  mode: NavigationMode;
  currentPos: { x: number; y: number; z: number };
  headingDeg: number;
  targetHeadingDeg: number;
  headingErrorDeg: number;
  linearVelocity: number;
  angularVelocity: number;
  closestObstacleDist: number;
  statusText: string;
  isEmergency: boolean;
  membraneSpikeActive?: boolean;
  leftPegRate?: number;
  rightPegRate?: number;
  blendRatioAlpha?: number;
}

export interface AgentContext {
  id: 'astar' | 'fly' | 'hybrid';
  name: string;
  mode: NavigationMode;
  robot: RobotController;
  startPos: THREE.Vector3;
  endPos: THREE.Vector3;
  currentPath: THREE.Vector3[];
  waypointIndex: number;
  state: SimState;
  finishTime: number | null;
  telemetry: TelemetryData;
}

```

### 7.2 핵심 상수 (`src/types/constants.ts`)

```typescript
export const CONSTANTS = {
  GOAL_THRESHOLD: 0.3,          // 도착 판정 거리 (m)
  ROBOT_BASE_SPEED: 1.2,        // 기본 이동 속도 (m/s)
  ROBOT_MAX_ROTATION_SPEED: 3.5,// 회전 속도 (rad/s)
  RAY_MAX_RANGE: 3.0,           // 레이캐스트 유효 감지 거리 (m)
  GRID_RESOLUTION: 0.5,         // A* 그리드 셀 크기 (m)
  OBSTACLE_INFLATION_RADIUS: 0.35, // A* 그리드 장애물 인플레이션 반경 (m)
  SAFETY_STOP_DISTANCE: 0.35,   // 전방 장애물 키네마틱 정지 임계거리 (m)
  PROXIMITY_GUARD_RADIUS: 0.65, // 동적 장애물 구체 충돌 방지 반경 (로봇 0.35m + 장애물 0.3m)
  PATH_Y_OFFSET: 0.02,          // A* 경로 시각화 Z-Fighting 방지 Y축 오프셋 (m)
  SIM_TIMEOUT_SEC: 120,         // 최대 주행 제한 시간 (초)
  STALL_CHECK_WINDOW: 3.0,      // 끼임 판정 대기 시간 (초)
  STALL_DISTANCE_MIN: 0.05      // 끼임 판정 이동 임계치 (m)
} as const;

```

### 7.3 클래스 및 핵심 메서드 네이밍

* **`Viewer3D`**
  * `init(canvasElement: HTMLCanvasElement): void`
  * `render(): void`
  * `getIntersection(screenPos: { x: number, y: number }): THREE.Intersection | null`
  * `clearTestbed(): void`
  * `drawPath(pathId: string, waypoints: THREE.Vector3[], colorHex?: number): void` #수정
  * `clearPath(pathId?: string): void` #수정

* **`AssetLoader`**
* `loadModelFromFile(file: File): Promise<THREE.Group THREE.Mesh |>`
* `parseCustomJSON(jsonContent: string): THREE.Group`
* `disposeObject(obj: THREE.Object3D): void`


* **`RobotController`**
* `loadRobot(url: string): Promise<void>`
* `setAnimation(state: 'Idle' | 'Walk'): void`
* `castSensors(obstacles: THREE.Object3D[]): RaycastSensors`
* `applyCommand(cmd: NavCommand, dt: number): void`
* `resetTransform(pos: THREE.Vector3): void`


* **`ControlPanel`**
  * `setParallelMode(active: boolean): void` (모드 라디오 및 Waypoint 버튼 동시 잠금/해제) #수정
  * `updateStatus(now: number, state: SimState, fps: number, startPos: any, endPos: any, canStart: boolean): void`
  * `disablePlacementModes(): void`

* **`FlyNeuralNetwork`**
  * `initWeights(matrixJSON?: object): void`
  * `step(sensors: RaycastSensors, dt: number, currentPos?: THREE.Vector3, currentHeadingRad?: number, targetPos?: THREE.Vector3): NavCommand`
  * `computeRepulsion(sensors: RaycastSensors): THREE.Vector3`
  * `getTelemetry(): { spikeActive: boolean; leftPegRate: number; rightPegRate: number; angularVelocity: number }`


* **`AStarPlanner`**
* `buildGridFromScene(walkableMesh: THREE.Mesh, obstacles: THREE.Object3D[]): void`
* `findPath(start: THREE.Vector3, end: THREE.Vector3): THREE.Vector3[]`


* **`SimulationManager`**
  * `loadPreset(preset: TestbedPreset): Promise<void>`
  * `prepareEnvironment(walkableMesh: THREE.Mesh, obstacles: THREE.Object3D[]): void` (장애물 평탄화 및 네거티브 필터링) #수정
  * `setMode(mode: NavigationMode): void`
  * `setStartPoint(pos: THREE.Vector3): void`
  * `setEndPoint(pos: THREE.Vector3): void`
  * `start(): void`
  * `reset(): void`
  * `update(dt: number): void`


* **`HUDPanel`**
* `setMode(isParallel: boolean): void`
* `updateTelemetry(telemetries: TelemetryData[]): void`
* `clear(): void`



---

## 8. 예외 처리 및 엣지 케이스 (Edge Cases)

| 번호 | 발생 시나리오 | 검출 방법 | 예외 처리 및 복구 정책 |
| --- | --- | --- | --- |
| **E-1** | 비정상 3D 파일 로딩 (손상된 바이너리, 지원 외 포맷) | Loader `catch` 블록 포착 | 로딩 중단, UI 경고창 출력 (`"유효한 3D 파일이 아닙니다."`), 기존 씬 상태 유지. |
| **E-2** | 에셋 스케일 불균형 (모델 크기가 지나치게 크거나 작음) | 로드 직후 BoundingBox 대각선 길이 계측 | 모델 대각 길이가 $500\text{m}$ 초과 시 스케일 자동 축소, $0.1\text{m}$ 미만 시 자동 확대 노멀라이즈. |
| **E-3** | A* 도달 불가 경로 (미로가 완전히 차단된 경우) | `AStarPlanner.findPath()` 반환 배열이 빈 배열임 | UI 상태창에 `"목적지까지 유효한 경로가 없습니다"` 경고 표시, 시뮬레이션 시작 차단. |
| **E-4** | Fly CX 전방 대칭 장애물 교착 (U자형 정면 진입) | 좌/우 레이 거리 차이가 $0.05\text{m}$ 미만이고 전방이 막힘 | 각속도 명령에 난수 노이즈(`+0.5 rad/s` 우측 편향)를 강제 주입하여 대칭 회로 락 해제. |
| **E-5** | 백그라운드 탭 렌더링 프레임 드롭 (dt 폭증 현상) | `clock.getDelta()` 값이 $0.1\text{초}$ 초과 | `dt = Math.min(dt, 0.05)`로 강제 클램핑하여 로봇이 벽을 뚫고 지나가는 터널링 방지. |
| **E-6** | 동적 장애물이 로봇의 측·후방 사각지대에서 돌진 | 레이캐스터 미감지 및 Bounding Sphere 거리 $\le 0.65\text{m}$ 검출 | `linearVelocity = 0` 강제 클램프 및 장애물 역방향 탈출 각속도 즉시 인가. |
| **E-7** | `cx_weights.json`의 단일 Delta7 뉴런 데이터셋 구조 | `numNeurons !== 42` 또는 가중치 행렬이 42x42가 아님 | 임의 Mock 인덱스 분배를 엄격히 차단하고 즉각 `Connectome matrix corrupted` 예외를 던져 무결성 보장. 정상 적재 시 좌/우 21개 반구로 분할하여 GABAergic 음수 가중치 적용. |
| **E-8** | 기본 3D 로봇 에셋(`/models/default_robot.glb`) 파일 404 누락 | `loadRobot()` 호출 시 파일 미존재 감지 | Vite SPA의 기본 HTML 반환 파싱 에러를 방지하기 위해 네트워크 fetch를 생략하고, `QuadrupedRobotFactory`의 절차적 4족 보행 지오메트리를 기본 메시로 즉시 바인딩하여 씬 중단 방지. |
| **E-9** | 최상위 컨테이너(Group)와 하위 렌더링 메시(Mesh) 계층 불일치로 정적 벽체 누락 | 최상위 노드에 `userData` 플래그 미부여 | `prepareEnvironment()`에서 `traverse`로 렌더링 메시를 전수 평탄화 수집하고, `!isDynamic && !isRobot` 네거티브 필터를 적용하여 정적 벽체가 A* 그리드에서 탈락하는 현상을 원천 방지. #수정 |
| **E-10** | 2차 병렬 레이스 절차적 생성 시 레인 간 장애물 위치 불일치 | 레인 생성 시 `Math.random()` 개별 호출 | 단일 장애물 템플릿 배열을 사전에 정의하고 $X$ 오프셋만 가산하여 복제함으로써 3개 레인에 100% 동일한 장애물 형상 및 좌표를 확정 주입. #수정 |

---

## 9. Jules(코더) 구현 주의사항 및 제약 조건

1. **Three.js 메모리 누수 방지 의무 (`dispose` 패턴 필수):**
* 테스트베드를 새로 로드할 때 반드시 이전 메시의 `geometry.dispose()`, `material.dispose()`, `texture.dispose()`를 순회 호출해야 합니다. 단순히 `scene.remove(mesh)`만 하면 브라우저 탭 메모리가 지속 누적되어 강제 종료됩니다.


2. **동역학 물리 엔진 사용 금지:**
* Cannon.js, Rapier.js, Ammo.js 등을 설치하지 마십시오. 모든 움직임은 오직 `Raycaster` 충돌 검출 및 Three.js 트랜스폼(`translateOnAxis`, `lookAt`, `slerp`)으로 구현해야 브라우저 연산 오버헤드를 막을 수 있습니다.


3. **Electron/Tauri 의존성 분리:**
* 코드 내에서 `window.__TAURI__`나 `require('electron')`을 직접 호출하지 마십시오. 모든 파일 접근은 브라우저 표준 `FileReader`와 `URL.createObjectURL`을 이용해 처리해야 패키징 환경에 구애받지 않고 동작합니다.


4. **애니메이션과 위치 이동 분리:**
* 3D 로봇 에셋에 루트 모션(Root Motion)이 포함되어 있다면 비활성화(애니메이션 내 위치 이동 무시)하고, 코드(`RobotController`)의 위치 변위 값으로만 로봇을 전진시키십시오.


5. **Tick 분리 원칙:**
* UI DOM 렌더링 갱신(텍스트, 좌표 표기)은 `requestAnimationFrame` 매 프레임(60Hz)마다 하지 말고, `0.1초`(10Hz) 주기로 쓰로틀링(Throttling)하여 불필요한 브라우저 렌더링 부하를 줄이십시오.



---

### 기획/테스트 검토 포인트

* 본 FDS에 명시된 레이캐스트 3가닥(정면, 좌 30°, 우 30°) 감지 방식과 A* 그리드 해상도($0.5\text{m}$) 규격이 기획 의도와 일치하는지 확인해 주십시오.
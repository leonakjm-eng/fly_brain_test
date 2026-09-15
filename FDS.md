# [FDS] Bio-Nav 4-Legged Simulation Sandbox 기능명세서

---

## 1. 문서 메타데이터 및 버전 정보

* **문서명:** Functional Design Specification (FDS) - Bio-Nav 4-Legged Simulation Sandbox
* **버전:** `v0.1.0-draft`
* **최종 수정일:** 2026-09-15
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
    │   ├── AStarPlanner.ts        # 2D 그리드 생성 및 A* 최단 경로 탐색
    │   ├── FlyNeuralNetwork.ts    # 중심복합체(CX) LIF 기반 조향 SNN
    │   └── HybridNavigator.ts     # A* 타깃 벡터와 SNN 회피 벡터 결합 제어
    └── ui/
        ├── ControlPanel.ts        # 좌측 DOM UI 생성, 상태 바인딩, 이벤트 리스너
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
| [NAVIGATION MODE]                 |                                                   |
|  (•) A* Global Planner            |                                                   |
|  ( ) Fly CX SNN (Reactive)        |                       [End Marker (Red)]          |
|  ( ) Hybrid (A* + CX)             |                                                   |
|                                   |                                                   |
| [TESTBED LOADER]                  |            [Testbed 3D Mesh / Maze]               |
|  [📂 Load 3D / JSON File]         |                                                   |
|  Status: default_plane.json       |                                                   |
|                                   |                     [4-Legged Robot]              |
| [WAYPOINTS & CONTROL]             |                    /                              |
|  [📍 Set Start]  [🎯 Set End]     |          [Start Marker (Green)]                   |
|  Start: (0.0, 0.0, 0.0)           |                                                   |
|  End:   (12.5, 0.0, -8.0)         |                                                   |
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
| **Mode** | `radio-mode-astar` | `<input type="radio">` | `NavigationMode.ASTAR` 선택 |
|  | `radio-mode-cx` | `<input type="radio">` | `NavigationMode.FLY_CX` 선택 |
|  | `radio-mode-hybrid` | `<input type="radio">` | `NavigationMode.HYBRID` 선택 (기본값) |
| **Loader** | `btn-load-testbed` | `<button>` | 클릭 시 hidden file input 트리거 |
|  | `input-file-hidden` | `<input type="file">` | `.glb,.gltf,.obj,.fbx,.json` 허용 |
|  | `label-testbed-info` | `<span>` | 로드된 파일명 및 버텍스/메시 정보 표시 |
| **Coords** | `btn-set-start` | `<button>` | 클릭 시 'Start 핀 선택 모드' 토글 (버튼 활성화 하이라이트) |
|  | `btn-set-end` | `<button>` | 클릭 시 'End 핀 선택 모드' 토글 |
|  | `txt-coords-info` | `<div>` | 지정된 Start/End 월드 좌표 $(X, Y, Z)$ 텍스트 출력 |
| **Execution** | `btn-sim-start` | `<button>` | 시뮬레이션 시작 (조건 충족 시 활성화) |
|  | `btn-sim-reset` | `<button>` | 시뮬레이션 중지 및 로봇 위치 초기화 |
|  | `label-sim-status` | `<span>` | `IDLE`, `RUNNING`, `SUCCESS`, `COLLIDED`, `TIMEOUT` 상태 표시 |

---

## 5. 핵심 작동 로직 (Operational Logic)

### Phase 1: 테스트베드 3D/JSON 로딩 파이프라인

1. 사용자가 파일을 선택하면 `AssetLoader`가 MIME 타입 및 확장자 분기 검사.
2. 기존 씬에 등록된 테스트베드 객체 메모리 해제(`disposeMeshHierarchy`).
3. 파싱 완료된 Mesh 객체를 씬 중심 $(0, 0, 0)$으로 정렬(Normalize Bounding Box).
4. 로드된 지면/벽체 Mesh에 `userData.isObstacle = true`, 바닥 평면 Mesh에 `userData.isWalkable = true` 태그 주입.

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
       ├─► Check Goal Distance <= 0.3m ──► [TRIGGER SUCCESS]
       │
       ├─► Update Sensors: Cast 3 Rays (Front, Left 30°, Right 30°)
       │
       ├─► Compute Direction Vector based on Mode:
       │     ├─ A* Mode:
       │     │    Look up next waypoint from AStarPlanner
       │     │    Vector_Target = Normalize(Waypoint - CurrentPos)
       │     │
       │     ├─ Fly CX Mode:
       │     │    Feed ray distances into FlyNeuralNetwork LIF matrix
       │     │    Output: delta_yaw, forward_speed
       │     │    Apply rotation & forward translation
       │     │
       │     └─ Hybrid Mode:
       │          Vector_A* = Normalize(Waypoint - CurrentPos)
       │          Vector_Repulsion = FlyNeuralNetwork.computeRepulsion(rays)
       │          Vector_Final = Normalize(0.6 * Vector_A* + 0.4 * Vector_Repulsion)
       │
       ├─► Kinematic Transform:
       │     Rotate robot towards Vector_Final (Slerp)
       │     Translate forward: position += forward * speed * dt
       │
       └─► Animation Sync:
             mixer.update(dt)
             walkAction.timeScale = speed / BASE_SPEED

```

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

```

### 7.2 핵심 상수 (`src/types/constants.ts`)

```typescript
export const CONSTANTS = {
  GOAL_THRESHOLD: 0.3,          // 도착 판정 거리 (m)
  ROBOT_BASE_SPEED: 1.2,        // 기본 이동 속도 (m/s)
  ROBOT_MAX_ROTATION_SPEED: 3.5,// 회전 속도 (rad/s)
  RAY_MAX_RANGE: 3.0,           // 레이캐스트 유효 감지 거리 (m)
  GRID_RESOLUTION: 0.5,         // A* 그리드 셀 크기 (m)
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


* **`FlyNeuralNetwork`**
* `initWeights(matrixJSON?: object): void`
* `step(sensors: RaycastSensors, dt: number): NavCommand`


* **`AStarPlanner`**
* `buildGridFromScene(walkableMesh: THREE.Mesh, obstacles: THREE.Object3D[]): void`
* `findPath(start: THREE.Vector3, end: THREE.Vector3): THREE.Vector3[]`


* **`SimulationManager`**
* `setMode(mode: NavigationMode): void`
* `setStartPoint(pos: THREE.Vector3): void`
* `setEndPoint(pos: THREE.Vector3): void`
* `start(): void`
* `reset(): void`
* `update(dt: number): void`



---

## 8. 예외 처리 및 엣지 케이스 (Edge Cases)

| 번호 | 발생 시나리오 | 검출 방법 | 예외 처리 및 복구 정책 |
| --- | --- | --- | --- |
| **E-1** | 비정상 3D 파일 로딩 (손상된 바이너리, 지원 외 포맷) | Loader `catch` 블록 포착 | 로딩 중단, UI 경고창 출력 (`"유효한 3D 파일이 아닙니다."`), 기존 씬 상태 유지. |
| **E-2** | 에셋 스케일 불균형 (모델 크기가 지나치게 크거나 작음) | 로드 직후 BoundingBox 대각선 길이 계측 | 모델 대각 길이가 $500\text{m}$ 초과 시 스케일 자동 축소, $0.1\text{m}$ 미만 시 자동 확대 노멀라이즈. |
| **E-3** | A* 도달 불가 경로 (미로가 완전히 차단된 경우) | `AStarPlanner.findPath()` 반환 배열이 빈 배열임 | UI 상태창에 `"목적지까지 유효한 경로가 없습니다"` 경고 표시, 시뮬레이션 시작 차단. |
| **E-4** | Fly CX 전방 대칭 장애물 교착 (U자형 정면 진입) | 좌/우 레이 거리 차이가 $0.05\text{m}$ 미만이고 전방이 막힘 | 각속도 명령에 난수 노이즈(`+0.5 rad/s` 우측 편향)를 강제 주입하여 대칭 회로 락 해제. |
| **E-5** | 백그라운드 탭 렌더링 프레임 드롭 (dt 폭증 현상) | `clock.getDelta()` 값이 $0.1\text{초}$ 초과 | `dt = Math.min(dt, 0.05)`로 강제 클램핑하여 로봇이 벽을 뚫고 지나가는 터널링 방지. |

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
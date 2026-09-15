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

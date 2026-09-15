export const CONSTANTS = {
  GOAL_THRESHOLD: 0.3,          // 도착 판정 거리 (m)
  ROBOT_BASE_SPEED: 2.0,        // 기본 이동 속도 (m/s)
  ROBOT_MAX_ROTATION_SPEED: 4.8,// 회전 속도 (rad/s)
  RAY_MAX_RANGE: 4.5,           // 레이캐스트 유효 감지 거리 (m)
  PROXIMITY_GUARD_RADIUS: 0.80, // 동적 장애물 접근 경계 거리 (m)
  DECEL_ZONE_START: 1.2,        // 선형 감속 시작 거리 (m)
  DECEL_ZONE_STOP: 0.35,        // 완전 정지 최소 안전 거리 (m)
  VELOCITY_EMA_ALPHA: 0.2,      // 속도 평활화 이동평균 계수
  GRID_RESOLUTION: 0.5,         // A* 그리드 셀 크기 (m)
  SIM_TIMEOUT_SEC: 120,         // 최대 주행 제한 시간 (초)
  STALL_CHECK_WINDOW: 3.0,      // 끼임 판정 대기 시간 (초)
  STALL_DISTANCE_MIN: 0.05      // 끼임 판정 이동 임계치 (m)
} as const;

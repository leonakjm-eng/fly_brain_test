import * as THREE from 'three';
import { RobotController } from '../core/RobotController';

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
export interface RobotConfig { bodyColor?: string; cameraColor?: string; rtkAntennaColor?: string; legColor?: string; }
export type MotionSpeedMultiplier = any;
export type RobotMotionStatus = any;

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
  // Fly Brain 전용 필드
  membraneSpikeActive?: boolean;
  leftPegRate?: number;
  rightPegRate?: number;
  // Hybrid 전용 필드
  blendRatioAlpha?: number;
  // AStar 전용 필드
  remainingDist?: number;
  isDecelerating?: boolean;
  finishTime?: number;
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

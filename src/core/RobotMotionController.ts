import * as THREE from 'three';
import { MotionSpeedMultiplier, RobotMotionStatus } from '../types';
import { RobotGaitAnimator } from './RobotGaitAnimator';
import { MONITORING_HOLD_MS } from '../utils/constants';

export type MotionArrivalPolicy = 'NONE' | 'MONITORING';

export interface MotionCallbacks {
  onStatusChange: (status: RobotMotionStatus) => void;
  onMonitoringProgress: (progress: number) => void;
  onArrived: () => void;
  onCompleted: () => void;
}

export class RobotMotionController {
  private robotGroup: THREE.Group | null = null;
  private cameraHead: THREE.Group | null = null;
  private gaitAnimator: RobotGaitAnimator;
  private waypoints: THREE.Vector3[] = [];
  private currentWaypointIndex = 0;
  private status: RobotMotionStatus = 'IDLE';
  private speedMultiplier: MotionSpeedMultiplier = 1.0;
  private baseSpeed = 2.0; // units per second
  private callbacks: MotionCallbacks | null = null;
  private runToken = 0;
  private monitoringTimer: number | null = null;
  private isMonitoring = false;
  private monitoringStartTime = 0;
  private currentArrivalPolicy: MotionArrivalPolicy = 'MONITORING';

  constructor(gaitAnimator: RobotGaitAnimator) {
    this.gaitAnimator = gaitAnimator;
  }

  public setRobotGroup(group: THREE.Group, cameraHead?: THREE.Group): void {
    this.robotGroup = group;
    if (cameraHead) {
      this.cameraHead = cameraHead;
    }
  }

  public setCallbacks(callbacks: MotionCallbacks): void {
    this.callbacks = callbacks;
  }

  public setWaypoints(waypoints: THREE.Vector3[]): void {
    this.clearMonitoringState();
    this.waypoints = waypoints;
    this.currentWaypointIndex = 0;
    this.status = 'IDLE';
    if (this.callbacks) {
      this.callbacks.onStatusChange('IDLE');
    }
    // Place robot at first waypoint if available
    if (this.robotGroup && waypoints.length > 0) {
      this.robotGroup.position.copy(waypoints[0]);
      if (waypoints.length > 1) {
        this.orientTowards(waypoints[1], 1.0);
      }
    }
  }

  public setSpeedMultiplier(multiplier: MotionSpeedMultiplier): void {
    this.speedMultiplier = multiplier;
  }

  public startMotion(arrivalPolicy: MotionArrivalPolicy = 'MONITORING'): void {
    if (!this.robotGroup || this.waypoints.length === 0) return;

    this.clearMonitoringState();
    this.currentArrivalPolicy = arrivalPolicy;

    if (this.status === 'ARRIVED') {
      // If already arrived, restart from beginning
      this.currentWaypointIndex = 0;
      this.robotGroup.position.copy(this.waypoints[0]);
    }

    this.runToken++;
    this.status = 'MOVING';
    this.gaitAnimator.setWalking(true);
    if (this.callbacks) {
      this.callbacks.onStatusChange('MOVING');
    }
  }

  public pauseMotion(): void {
    if (this.status === 'MOVING') {
      this.status = 'PAUSED';
      this.gaitAnimator.setWalking(false);
      if (this.callbacks) {
        this.callbacks.onStatusChange('PAUSED');
      }
    }
  }

  public resumeMotion(): void {
    if (this.status === 'PAUSED') {
      this.status = 'MOVING';
      this.gaitAnimator.setWalking(true);
      if (this.callbacks) {
        this.callbacks.onStatusChange('MOVING');
      }
    }
  }

  public reset(initialPosition?: THREE.Vector3): void {
    this.runToken++;
    this.status = 'IDLE';
    this.clearMonitoringState();
    this.currentWaypointIndex = 0;
    this.gaitAnimator.reset();

    if (this.robotGroup) {
      if (initialPosition) {
        this.robotGroup.position.copy(initialPosition);
      } else if (this.waypoints.length > 0) {
        this.robotGroup.position.copy(this.waypoints[0]);
      }
      this.robotGroup.rotation.y = 0;
    }

    if (this.callbacks) {
      this.callbacks.onStatusChange('IDLE');
      this.callbacks.onMonitoringProgress(0);
    }
  }

  /**
   * Cleans up any active monitoring timers, flags, and resets camera head
   */
  private clearMonitoringState(): void {
    if (this.monitoringTimer !== null) {
      window.clearTimeout(this.monitoringTimer);
      this.monitoringTimer = null;
    }
    this.isMonitoring = false;
    this.monitoringStartTime = 0;
    if (this.cameraHead) {
      this.cameraHead.rotation.y = 0;
    }
  }

  /**
   * Main motion update tick called by SceneManager's requestAnimationFrame
   */
  public update(rawDeltaTime: number): void {
    // EC-17: Limit deltaTime to prevent teleportation on tab switch
    const deltaTime = Math.min(rawDeltaTime, 0.1);

    if (this.isMonitoring) {
      this.updateMonitoring(deltaTime);
      return;
    }

    if (this.status !== 'MOVING' || !this.robotGroup || this.waypoints.length === 0) {
      this.gaitAnimator.update(deltaTime, 0);
      return;
    }

    // Single waypoint edge case (EC-12)
    if (this.waypoints.length === 1) {
      this.robotGroup.position.copy(this.waypoints[0]);
      this.handleArrival();
      return;
    }

    const currentPos = this.robotGroup.position;
    // Target is the next waypoint
    let targetWaypoint = this.waypoints[this.currentWaypointIndex];

    // If already very close to current target, advance to next
    const distToTarget = currentPos.distanceTo(targetWaypoint);
    if (distToTarget < 0.1) {
      if (this.currentWaypointIndex >= this.waypoints.length - 1) {
        // Reached final waypoint
        this.handleArrival();
        return;
      }
      this.currentWaypointIndex++;
      targetWaypoint = this.waypoints[this.currentWaypointIndex];
    }

    // Move toward target waypoint
    const moveDist = this.baseSpeed * this.speedMultiplier * deltaTime;
    const dir = new THREE.Vector3().subVectors(targetWaypoint, currentPos);
    const stepLength = Math.min(moveDist, dir.length());

    dir.normalize();
    currentPos.addScaledVector(dir, stepLength);

    // Smoothly turn heading towards target
    this.orientTowards(targetWaypoint, deltaTime * 8.0);

    // Update leg swinging animation
    this.gaitAnimator.update(deltaTime, this.speedMultiplier);
  }

  private orientTowards(target: THREE.Vector3, turnRate: number): void {
    if (!this.robotGroup) return;
    const current = this.robotGroup.position;
    const dx = target.x - current.x;
    const dz = target.z - current.z;

    if (Math.hypot(dx, dz) > 0.001) {
      // In Three.js: front is +Z, so target angle is atan2(dx, dz)
      const targetAngle = Math.atan2(dx, dz);
      // Interpolate rotation
      let diff = targetAngle - this.robotGroup.rotation.y;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      this.robotGroup.rotation.y += diff * Math.min(1.0, turnRate);
    }
  }

  private handleArrival(): void {
    if (this.status !== 'MOVING') return;

    this.status = 'ARRIVED';
    this.gaitAnimator.setWalking(false);

    if (this.callbacks) {
      this.callbacks.onStatusChange('ARRIVED');
      this.callbacks.onArrived();
    }

    // 정합 마커 이동 등 비모니터링 정책: 3초 설비 계측 생략
    if (this.currentArrivalPolicy === 'NONE') {
      this.clearMonitoringState();
      return;
    }

    // 워크패키지 목표 이동 등 점검 모니터링 정책: 3초 설비 계측 실행
    this.isMonitoring = true;
    this.monitoringStartTime = performance.now();
    const currentToken = this.runToken;

    this.monitoringTimer = window.setTimeout(() => {
      // EC-20: Check token to avoid stale callbacks
      if (this.runToken !== currentToken) return;

      this.clearMonitoringState();
      if (this.callbacks) {
        this.callbacks.onMonitoringProgress(100);
        this.callbacks.onCompleted();
      }
    }, MONITORING_HOLD_MS);
  }

  private updateMonitoring(deltaTime: number): void {
    const elapsed = performance.now() - this.monitoringStartTime;
    const progress = Math.min(100, Math.round((elapsed / MONITORING_HOLD_MS) * 100));

    if (this.callbacks) {
      this.callbacks.onMonitoringProgress(progress);
    }

    // Camera head pan scan animation during inspection
    if (this.cameraHead) {
      this.cameraHead.rotation.y = Math.sin(elapsed * 0.005) * 0.5;
    }

    this.gaitAnimator.update(deltaTime, 0);
  }

  public getStatus(): RobotMotionStatus {
    return this.status;
  }
}

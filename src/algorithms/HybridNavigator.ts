import * as THREE from 'three';
import { FlyNeuralNetwork } from './FlyNeuralNetwork';
import { RaycastSensors, NavCommand } from '../types/index';
import { CONSTANTS } from '../types/constants';

export class HybridNavigator {
  private cxNetwork: FlyNeuralNetwork;

  constructor() {
    this.cxNetwork = new FlyNeuralNetwork();
  }

  public computeCommand(
    currentPos: THREE.Vector3,
    currentDir: THREE.Vector3,
    targetWaypoint: THREE.Vector3 | null,
    sensors: RaycastSensors,
    dt: number
  ): NavCommand {
    if (!targetWaypoint) {
      return { linearVelocity: 0, angularVelocity: 0 };
    }

    // A* Vector
    const vectorAStar = new THREE.Vector3().subVectors(targetWaypoint, currentPos);
    vectorAStar.y = 0; // Ignore vertical difference
    if (vectorAStar.lengthSq() > 0) {
      vectorAStar.normalize();
    } else {
      // Reached waypoint
      return { linearVelocity: 0, angularVelocity: 0 };
    }

    // Get Fly SNN command
    const currentHeadingRad = Math.atan2(-currentDir.x, -currentDir.z);
    const cxCommand = this.cxNetwork.step(sensors, dt, currentPos, currentHeadingRad, targetWaypoint);

    // A* target angular velocity
    const crossY = currentDir.z * vectorAStar.x - currentDir.x * vectorAStar.z;
    const dot = currentDir.x * vectorAStar.x + currentDir.z * vectorAStar.z;
    const angleDiff = Math.atan2(crossY, dot);
    const omegaAStar = THREE.MathUtils.clamp(angleDiff / dt, -Math.PI, Math.PI);

    // Calculate minimum distance based on sensors
    const dMin = Math.min(sensors.front, sensors.left, sensors.right) * CONSTANTS.RAY_MAX_RANGE;

    // Dynamic Urgency Blending (Direct Steering Blending)
    let alpha = 0.0;
    if (dMin > 1.8) {
      alpha = 0.15;
    } else if (dMin <= 0.8) {
      alpha = 0.85;
    } else {
      alpha = 0.50;
    }

    const omegaFinal = (1 - alpha) * omegaAStar + alpha * cxCommand.angularVelocity;

    // Linear Velocity computation
    const p_f = 1.0 - sensors.front;
    let speed = CONSTANTS.ROBOT_BASE_SPEED * Math.max(0, dot);
    speed -= p_f * 0.5;
    speed = Math.max(0, speed);

    if (dMin <= 0.8) {
      speed = CONSTANTS.ROBOT_BASE_SPEED * 0.4;
    }

    return {
      linearVelocity: speed,
      angularVelocity: omegaFinal
    };
  }
}

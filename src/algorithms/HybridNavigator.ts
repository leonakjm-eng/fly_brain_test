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

    // Fly CX Vector (Repulsion)
    // The cxNetwork.computeRepulsion returns a vector relative to local forward (Z).
    // We need to transform it to world space based on currentDir.
    const localRepulsion = this.cxNetwork.computeRepulsion(sensors);

    // Create a rotation matrix from currentDir (assuming currentDir is normalized and flat)
    const angle = Math.atan2(currentDir.x, currentDir.z);
    const worldRepulsion = localRepulsion.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);

    // Vector_Final = Normalize(0.6 * Vector_A* + 0.4 * Vector_Repulsion)
    const vectorFinal = new THREE.Vector3()
      .addScaledVector(vectorAStar, 0.6)
      .addScaledVector(worldRepulsion, 0.4);

    if (vectorFinal.lengthSq() > 0) {
      vectorFinal.normalize();
    }

    // Determine Turn Command based on vectorFinal vs currentDir
    // cross product Y gives the sign of the angle
    const crossY = currentDir.z * vectorFinal.x - currentDir.x * vectorFinal.z;
    const dot = currentDir.x * vectorFinal.x + currentDir.z * vectorFinal.z;
    let angleDiff = Math.atan2(crossY, dot);

    // Cap rotation speed
    const angularVelocity = THREE.MathUtils.clamp(angleDiff / dt, -CONSTANTS.ROBOT_MAX_ROTATION_SPEED, CONSTANTS.ROBOT_MAX_ROTATION_SPEED);

    // Speed computation
    // Slower if turning sharply or if front is blocked
    const p_f = 1.0 - sensors.front;
    let speed = CONSTANTS.ROBOT_BASE_SPEED * Math.max(0, dot); // Slower when turning
    speed -= p_f * 0.5; // Slow down for obstacles
    speed = Math.max(0, speed);

    return {
      linearVelocity: speed,
      angularVelocity: angularVelocity
    };
  }
}

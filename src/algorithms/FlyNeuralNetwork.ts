import { RaycastSensors, NavCommand } from '../types/index';
import { CONSTANTS } from '../types/constants';
import * as THREE from 'three';

export class FlyNeuralNetwork {
  private weights = {
    w_ll: 0.8, w_lr: -0.5,
    w_rr: 0.8, w_rl: -0.5,
    w_fl: 0.5, w_fr: 0.5,
    w_f_speed: 1.0,
    bias_speed: CONSTANTS.ROBOT_BASE_SPEED
  };

  public initWeights(matrixJSON?: object): void {
    if (matrixJSON) {
      Object.assign(this.weights, matrixJSON);
    }
  }

  public step(sensors: RaycastSensors, _dt: number): NavCommand {
    // Sensors are normalized distance 0.0 ~ 1.0 (1.0 = Max distance / Open)
    // We want to avoid obstacles, so we convert distance to proximity (1.0 = close, 0.0 = far)
    const p_l = 1.0 - sensors.left;
    const p_r = 1.0 - sensors.right;
    const p_f = 1.0 - sensors.front;

    // Compute turn (angular velocity). Positive = turn left, Negative = turn right.
    // If obstacle is on the left (p_l is high), we want to turn right (negative angular velocity).
    let turn = (p_r * this.weights.w_rr + p_l * this.weights.w_rl) -
               (p_l * this.weights.w_ll + p_r * this.weights.w_lr);

    // Front obstacle avoidance: if blocked symmetrically, add noise to break deadlock
    if (p_f > 0.8 && Math.abs(p_l - p_r) < 0.05) {
      turn += 0.5; // E-4: Force right bias to break U-shape deadlock
    }

    // Cap rotation speed
    turn = THREE.MathUtils.clamp(turn, -CONSTANTS.ROBOT_MAX_ROTATION_SPEED, CONSTANTS.ROBOT_MAX_ROTATION_SPEED);

    // Compute speed (linear velocity)
    // Slower if front is blocked
    let speed = this.weights.bias_speed - (p_f * this.weights.w_f_speed);
    speed = Math.max(0, speed); // Don't go backwards

    return {
      linearVelocity: speed,
      angularVelocity: turn
    };
  }

  // Used for Hybrid mode to get a repulsion vector
  public computeRepulsion(sensors: RaycastSensors): THREE.Vector3 {
    const cmd = this.step(sensors, 0);
    // Create a forward vector and rotate it by the computed angular velocity (as a proxy for repulsion direction)
    const vec = new THREE.Vector3(0, 0, 1);
    vec.applyAxisAngle(new THREE.Vector3(0, 1, 0), cmd.angularVelocity * 0.5); // 0.5 is an arbitrary weight to map rad/s to a localized vector
    return vec.normalize();
  }
}

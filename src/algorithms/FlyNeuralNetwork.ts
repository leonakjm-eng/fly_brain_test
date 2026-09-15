import { RaycastSensors, NavCommand } from '../types/index';
import { CONSTANTS } from '../types/constants';
import * as THREE from 'three';

export class FlyNeuralNetwork {
  // 8 Azimuthal columns: -135, -90, -45, 0, 45, 90, 135, 180 degrees
  private numColumns = 8;
  private headingBump: number[] = new Array(8).fill(0.1);

  // Weights (kept for interface compatibility but adapted for Ring Attractor if needed)
  private weights = {
    inhibition_strength: 0.5,
    excitation_width: 1.0,
    bias_speed: CONSTANTS.ROBOT_BASE_SPEED
  };

  public initWeights(matrixJSON?: object): void {
    if (matrixJSON) {
      Object.assign(this.weights, matrixJSON);
    }
  }

  // Reusable scratch variables to avoid GC allocations every frame
  private sensoryLayer: number[] = new Array(8).fill(0);
  private nextBump: number[] = new Array(8).fill(0);
  private columnAngles: number[] = [
    -3 * Math.PI / 4, // -135
    -Math.PI / 2,     // -90
    -Math.PI / 4,     // -45
    0,                // 0
    Math.PI / 4,      // 45
    Math.PI / 2,      // 90
    3 * Math.PI / 4,  // 135
    Math.PI           // 180
  ];
  private sensorAngles: number[] = [Math.PI/6, -Math.PI/6, 0]; // Left(30), Right(-30), Front(0)

  public step(sensors: RaycastSensors, _dt: number): NavCommand {
    // 1. Sensory Layer (Sensory to 8-column Mapping)
    // Map normalized distances (1.0 = far, 0.0 = close) to obstacle proximities (0.0 = far, 1.0 = close)
    const p_f = 1.0 - sensors.front;
    const p_l = 1.0 - sensors.left;
    const p_r = 1.0 - sensors.right;

    const sensorProximities = [p_l, p_r, p_f];
    const sigma = Math.PI / 4; // Gaussian width for receptive fields

    for (let i = 0; i < this.numColumns; i++) {
      let activation = 0;
      for (let j = 0; j < 3; j++) {
        // Shortest angular distance
        let diff = this.columnAngles[i] - this.sensorAngles[j];
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        activation += sensorProximities[j] * Math.exp(-(diff * diff) / (2 * sigma * sigma));
      }
      this.sensoryLayer[i] = activation;
    }

    // 2. EB-PB Compass Ring Attractor Update
    // A simplified continuous attractor dynamics:
    // τ * dx/dt = -x + f(W*x + Input)
    // We update headingBump to form a stable bump away from obstacles
    let globalInhibition = 0;

    // Compute total activity for Delta7 global inhibition
    for (let i = 0; i < this.numColumns; i++) {
      globalInhibition += this.headingBump[i];
    }
    globalInhibition = (globalInhibition / this.numColumns) * this.weights.inhibition_strength;

    for (let i = 0; i < this.numColumns; i++) {
      let localExcitation = 0;
      // Excite neighbors
      for (let j = -1; j <= 1; j++) {
        const neighborIdx = (i + j + this.numColumns) % this.numColumns;
        // Weight matrix simplified: self=1.0, neighbors=0.5
        const weight = (j === 0) ? 1.0 : 0.5;
        localExcitation += this.headingBump[neighborIdx] * weight;
      }

      // Input from sensory layer (obstacles *inhibit* the bump at that angle)
      const sensoryInput = -this.sensoryLayer[i] * 2.0;

      // Goal bias: prefer forward (angle 0, idx 3) when open
      const goalBias = (i === 3) ? 0.2 : 0.0;

      // Update rule (Euler integration step approximation)
      const input = localExcitation - globalInhibition + sensoryInput + goalBias;

      // ReLU activation
      this.nextBump[i] = Math.max(0, input);
    }

    // Normalize bump to prevent explosion
    let maxBump = 0;
    for (let i = 0; i < this.numColumns; i++) {
      if (this.nextBump[i] > maxBump) maxBump = this.nextBump[i];
    }
    if (maxBump > 0) {
      for (let i = 0; i < this.numColumns; i++) {
        this.headingBump[i] = this.nextBump[i] / maxBump;
      }
    }

    // Add noise if deadlocked (all bump values very low or identical front/left/right block)
    if (p_f > 0.8 && Math.abs(p_l - p_r) < 0.05) {
       // E-4: Force right bias to break U-shape deadlock
       this.headingBump[1] += 0.5; // Excite -90 deg column
       this.headingBump[2] += 0.5; // Excite -45 deg column
    }

    // 3. FB Vector Subtraction & 4. P-EG Motor Neurons
    // Calculate Population Vector (center of mass of the bump)
    let popVectorX = 0;
    let popVectorY = 0;
    for (let i = 0; i < this.numColumns; i++) {
      popVectorX += this.headingBump[i] * Math.cos(this.columnAngles[i]);
      popVectorY += this.headingBump[i] * Math.sin(this.columnAngles[i]);
    }

    // Desired turn angle relative to current heading (0)
    let desiredHeading = Math.atan2(popVectorY, popVectorX);

    // Left vs Right hemisphere activation difference proportional to desired turning
    // Positive angle -> turn left -> positive angular velocity
    let turn = desiredHeading * 2.0; // P-gain
    turn = THREE.MathUtils.clamp(turn, -CONSTANTS.ROBOT_MAX_ROTATION_SPEED, CONSTANTS.ROBOT_MAX_ROTATION_SPEED);

    // Forward speed modulated by front obstacle inhibition and bump strength
    // Slower if front is blocked or if bump is very weak (uncertainty)
    const bumpStrength = Math.hypot(popVectorX, popVectorY);
    let speed = this.weights.bias_speed * bumpStrength - (p_f * 1.0);
    speed = Math.max(0, speed); // Don't go backwards
    speed = Math.min(speed, CONSTANTS.ROBOT_BASE_SPEED); // Cap at base speed

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

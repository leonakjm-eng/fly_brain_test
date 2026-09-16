import { RaycastSensors, NavCommand } from '../types/index';
import { CONSTANTS } from '../types/constants';
import * as THREE from 'three';
import cxWeightsData from './weights/cx_weights.json';

export class FlyNeuralNetwork {
  private numNeurons: number = 0;
  private weightsMatrix: number[][] = [];

  // Neuron indices for groups
  private leftDelta7: number[] = [];
  private rightDelta7: number[] = [];

  // LIF state
  private membranePotentials: Float32Array;
  private spikes: Float32Array;

  // Scratch variables
  private nextPotentials: Float32Array;
  private tempRepulsionVec = new THREE.Vector3();
  private delta7Input: Float32Array;

  constructor() {
    // Initializer to satisfy TypeScript, sizes are adjusted in initWeights
    this.membranePotentials = new Float32Array(0);
    this.spikes = new Float32Array(0);
    this.nextPotentials = new Float32Array(0);
    this.delta7Input = new Float32Array(0);
    this.initWeights();
  }

  public initWeights(matrixJSON?: any): void {
    const data = matrixJSON || cxWeightsData;

    this.numNeurons = data.metadata.neuron_count || 42;

    // Group neurons into left and right Delta7 hemispheres
    this.leftDelta7 = [];
    this.rightDelta7 = [];
    for (let i = 0; i < this.numNeurons; i++) {
        if (i <= 20) {
            this.leftDelta7.push(i);
        } else {
            this.rightDelta7.push(i);
        }
    }

    this.weightsMatrix = [];
    for (let i = 0; i < this.numNeurons; i++) {
      const row = [...(data.weights[i] || new Array(this.numNeurons).fill(0))];
      // Synaptic polarity correction: Delta7 are inhibitory
      for (let j = 0; j < this.numNeurons; j++) {
          row[j] = -1.0 * row[j];
      }
      this.weightsMatrix.push(row);
    }

    if (this.numNeurons !== 42 || this.weightsMatrix.length !== 42) {
      throw new Error("[FlyNeuralNetwork] Connectome matrix corrupted: 42x42 Delta7 matrix required.");
    }

    this.membranePotentials = new Float32Array(this.numNeurons);
    this.spikes = new Float32Array(this.numNeurons);
    this.nextPotentials = new Float32Array(this.numNeurons);
    this.delta7Input = new Float32Array(this.numNeurons);

    console.log(`Loaded cx_weights.json: ${this.numNeurons} neurons.`);
    console.log(`Left Delta7: ${this.leftDelta7.length}, Right Delta7: ${this.rightDelta7.length}`);
  }

  // Optional telemetry states
  private telemetryState = {
    spikeActive: false,
    leftDelta7Rate: 0,
    rightDelta7Rate: 0,
    angularVelocity: 0
  };

  public getTelemetry() {
    return {
      spikeActive: this.telemetryState.spikeActive,
      leftPegRate: this.telemetryState.leftDelta7Rate,
      rightPegRate: this.telemetryState.rightDelta7Rate,
      angularVelocity: this.telemetryState.angularVelocity
    };
  }

  public step(
    sensors: RaycastSensors,
    _dt: number,
    currentPos?: THREE.Vector3,
    currentHeadingRad?: number,
    targetPos?: THREE.Vector3
  ): NavCommand {
    const lambda = 0.85;
    const vTh = 1.0;

    // 1. Sensory Input (Obstacle Repulsion Current)
    const p_f = 1.0 - sensors.front;
    const p_l = 1.0 - sensors.left;
    const p_r = 1.0 - sensors.right;

    this.delta7Input.fill(0);

    // Calculate goal-directed phase difference if valid params are provided
    let deltaTheta = 0;
    if (currentPos && currentHeadingRad !== undefined && targetPos) {
        const dx = targetPos.x - currentPos.x;
        const dz = targetPos.z - currentPos.z;
        const thetaGoal = Math.atan2(-dx, -dz);
        deltaTheta = Math.atan2(Math.sin(thetaGoal - currentHeadingRad), Math.cos(thetaGoal - currentHeadingRad));
    }

    // Inject current into Delta7 neurons
    for (const idx of this.leftDelta7) {
        // Left input: left obstacle repulsion + right turning goal current (deltaTheta > 0)
        let I_goal = deltaTheta > 0 ? Math.abs(deltaTheta) * 10.0 : 0.0;
        this.delta7Input[idx] = p_l * 5.0 + I_goal;
    }

    for (const idx of this.rightDelta7) {
        // Right input: right obstacle repulsion + left turning goal current (deltaTheta < 0)
        let I_goal = deltaTheta < 0 ? Math.abs(deltaTheta) * 10.0 : 0.0;
        this.delta7Input[idx] = p_r * 5.0 + I_goal;
    }

    // Front obstacle deceleration inhibition: inject into some central neurons
    // We'll apply it to the middle neurons of both hemispheres
    const midLeft = this.leftDelta7[Math.floor(this.leftDelta7.length / 2)];
    const midRight = this.rightDelta7[Math.floor(this.rightDelta7.length / 2)];
    this.delta7Input[midLeft] += p_f * 5.0;
    this.delta7Input[midRight] += p_f * 5.0;

    // 2. LIF Membrane Potential Update
    for (let i = 0; i < this.numNeurons; i++) {
        let w_s = 0;
        for (let j = 0; j < this.numNeurons; j++) {
            w_s += this.weightsMatrix[j][i] * this.spikes[j];
        }
        this.nextPotentials[i] = lambda * this.membranePotentials[i] + w_s + this.delta7Input[i];
    }

    // 3. Spike Generation
    let spikeActive = false;
    for (let i = 0; i < this.numNeurons; i++) {
        this.membranePotentials[i] = this.nextPotentials[i];
        if (this.membranePotentials[i] > vTh) {
            this.spikes[i] = 1.0;
            this.membranePotentials[i] -= vTh; // Reset
            spikeActive = true;
        } else {
            this.spikes[i] = 0.0;
        }
    }

    // 4. Output
    let leftSpikeSum = 0;
    for (const idx of this.leftDelta7) {
        leftSpikeSum += this.spikes[idx];
    }

    let rightSpikeSum = 0;
    for (const idx of this.rightDelta7) {
        rightSpikeSum += this.spikes[idx];
    }

    // Average firing rate over the step for telemetry
    const leftDelta7Rate = leftSpikeSum / (this.leftDelta7.length || 1);
    const rightDelta7Rate = rightSpikeSum / (this.rightDelta7.length || 1);

    const diff = leftSpikeSum - rightSpikeSum;

    // Angular velocity proportional to difference
    let angularVelocity = diff * 0.5; // Gain factor
    angularVelocity = THREE.MathUtils.clamp(angularVelocity, -Math.PI, Math.PI);

    this.telemetryState = {
        spikeActive,
        leftDelta7Rate,
        rightDelta7Rate,
        angularVelocity
    };

    // Default forward speed, slowed down by front obstacle
    // p_f is between 0 and 1, we map speed to 0.0 ~ 2.0 based on instruction but using base speed
    let linearVelocity = CONSTANTS.ROBOT_BASE_SPEED - (p_f * 1.5); // adjusted for 0~2.0 range roughly

    if (sensors.front >= 0.8) {
        linearVelocity = CONSTANTS.ROBOT_BASE_SPEED * Math.max(0.2, Math.cos(deltaTheta));
    }

    linearVelocity = Math.max(0, linearVelocity);
    linearVelocity = Math.min(linearVelocity, 2.0);

    return { linearVelocity, angularVelocity };
  }

  public computeRepulsion(sensors: RaycastSensors): THREE.Vector3 {
    const cmd = this.step(sensors, 0);
    this.tempRepulsionVec.set(0, 0, 1);
    // Rotate relative to Z-forward
    this.tempRepulsionVec.applyAxisAngle(new THREE.Vector3(0, 1, 0), cmd.angularVelocity);
    return this.tempRepulsionVec.normalize();
  }
}

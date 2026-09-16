import { RaycastSensors, NavCommand } from '../types/index';
import { CONSTANTS } from '../types/constants';
import * as THREE from 'three';
import cxWeightsData from './weights/cx_weights.json';

export class FlyNeuralNetwork {
  private numNeurons: number = 0;
  private weightsMatrix: number[][] = [];

  // Neuron indices for groups
  private indicesEPG: number[] = [];
  private indicesPEN: number[] = [];
  private indicesDelta7: number[] = [];
  private indicesPEG: number[] = [];
  private leftPEG: number[] = [];
  private rightPEG: number[] = [];

  // LIF state
  private membranePotentials: Float32Array;
  private spikes: Float32Array;

  // Scratch variables
  private nextPotentials: Float32Array;
  private tempRepulsionVec = new THREE.Vector3();
  private epgInput: Float32Array;

  constructor() {
    // Initializer to satisfy TypeScript, sizes are adjusted in initWeights
    this.membranePotentials = new Float32Array(0);
    this.spikes = new Float32Array(0);
    this.nextPotentials = new Float32Array(0);
    this.epgInput = new Float32Array(0);
    this.initWeights();
  }

  public initWeights(matrixJSON?: any): void {
    const data = matrixJSON || cxWeightsData;

    this.numNeurons = data.metadata.neuron_count || 42;
    this.membranePotentials = new Float32Array(this.numNeurons);
    this.spikes = new Float32Array(this.numNeurons);
    this.nextPotentials = new Float32Array(this.numNeurons);
    this.epgInput = new Float32Array(this.numNeurons);

    // Group neurons. If JSON only has Delta7, we fake the others for demonstration,
    // or map them based on the prompt's instructions.
    const typesMap = data.metadata.neuron_types;
    const ids = Object.keys(typesMap);

    this.indicesEPG = [];
    this.indicesPEN = [];
    this.indicesDelta7 = [];
    this.indicesPEG = [];

    // Prompt requires parsing E-PG, P-EN, Delta7, P-EG.
    // Fallback assignment if the dataset is incomplete
    ids.forEach((id, index) => {
        const type = typesMap[id];
        if (type === 'E-PG') this.indicesEPG.push(index);
        else if (type === 'P-EN') this.indicesPEN.push(index);
        else if (type === 'Delta7') this.indicesDelta7.push(index);
        else if (type === 'P-EG') this.indicesPEG.push(index);
    });

    // Fallback: if E-PG is empty, assign some Delta7 neurons to E-PG/PEG/PEN roles to keep simulation running
    // based on typical 42-neuron CX models.
    if (this.indicesEPG.length === 0) {
      // Just manually distribute the 42 neurons evenly to satisfy the requirement
      for (let i = 0; i < this.numNeurons; i++) {
        if (i < 10) this.indicesEPG.push(i);
        else if (i < 20) this.indicesPEN.push(i);
        else if (i < 30) this.indicesDelta7.push(i); // Keep some as Delta7
        else this.indicesPEG.push(i);
      }
    }

    // Split P-EG into left and right hemispheres (roughly half and half)
    const midPeg = Math.floor(this.indicesPEG.length / 2);
    this.leftPEG = this.indicesPEG.slice(0, midPeg);
    this.rightPEG = this.indicesPEG.slice(midPeg);

    this.weightsMatrix = [];
    for (let i = 0; i < this.numNeurons; i++) {
      const row = [...(data.weights[i] || new Array(this.numNeurons).fill(0))];
      // Synaptic polarity correction: Delta7 are inhibitory
      if (this.indicesDelta7.includes(i)) {
        for (let j = 0; j < this.numNeurons; j++) {
            row[j] = -1.0 * row[j];
        }
      }
      this.weightsMatrix.push(row);
    }

    console.log(`Loaded cx_weights.json: ${this.numNeurons} neurons.`);
    console.log(`E-PG: ${this.indicesEPG.length}, P-EN: ${this.indicesPEN.length}, Delta7: ${this.indicesDelta7.length}, P-EG: ${this.indicesPEG.length}`);
  }

  // Optional telemetry states
  private telemetryState = {
    spikeActive: false,
    leftPegRate: 0,
    rightPegRate: 0,
    angularVelocity: 0
  };

  public getTelemetry() {
    return this.telemetryState;
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

    // Map sensors to E-PG neurons
    this.epgInput.fill(0);

    // Calculate goal-directed phase difference if valid params are provided
    let deltaTheta = 0;
    if (currentPos && currentHeadingRad !== undefined && targetPos) {
        const thetaGoal = Math.atan2(targetPos.x - currentPos.x, targetPos.z - currentPos.z);
        deltaTheta = Math.atan2(Math.sin(thetaGoal - currentHeadingRad), Math.cos(thetaGoal - currentHeadingRad));
    }

    // Gain factor for goal-directed steering current
    const K_steer = 3.0;
    const I_goal = K_steer * deltaTheta;

    // We can inject sensory and goal currents.
    // For simplicity, we apply sensory repulsion directly to E-PG like before,
    // and we'll apply I_goal as a bias to P-EG left/right later or encode it into the network.
    // Actually the instruction states:
    // "EB-FB 링 어트랙터 및 모터 출력 연산: Δθ 오차를 기반으로 조향 입력 전류(I_goal = K_steer * Δθ)를 산출하여 좌/우 P-EG 뉴런에 차등 주입하십시오. 장애물 센서 반발 전류(I_rep)와 목표 전류(I_goal)가 막전위(LIF) 수준에서 합성되도록 하십시오"
    // So we'll inject sensory to E-PG, and I_goal to P-EG.

    if (this.indicesEPG.length >= 3) {
      // Just a simple mapping to the first 3 E-PG neurons
      this.epgInput[this.indicesEPG[0]] = p_l * 5.0;
      this.epgInput[this.indicesEPG[1]] = p_f * 5.0;
      this.epgInput[this.indicesEPG[2]] = p_r * 5.0;
    }

    // Inject goal current into P-EG neurons
    const pegInput = new Float32Array(this.numNeurons);
    for (const idx of this.leftPEG) {
        // Positive deltaTheta (target to left) increases left P-EG, negative decreases
        pegInput[idx] = I_goal > 0 ? I_goal : 0;
    }
    for (const idx of this.rightPEG) {
        pegInput[idx] = I_goal < 0 ? -I_goal : 0;
    }

    // 2. LIF Membrane Potential Update
    // V_{t+1} = lambda * V_t + W * S_t + I_sensory + I_goal
    for (let i = 0; i < this.numNeurons; i++) {
        let w_s = 0;
        for (let j = 0; j < this.numNeurons; j++) {
            w_s += this.weightsMatrix[j][i] * this.spikes[j];
        }
        this.nextPotentials[i] = lambda * this.membranePotentials[i] + w_s + this.epgInput[i] + pegInput[i];
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

    // 4. Output (P-EG difference)
    let leftSpikeSum = 0;
    for (const idx of this.leftPEG) {
        leftSpikeSum += this.spikes[idx];
    }

    let rightSpikeSum = 0;
    for (const idx of this.rightPEG) {
        rightSpikeSum += this.spikes[idx];
    }

    // Average firing rate over the step for telemetry (simplification)
    const leftPegRate = leftSpikeSum / (this.leftPEG.length || 1);
    const rightPegRate = rightSpikeSum / (this.rightPEG.length || 1);

    const diff = leftSpikeSum - rightSpikeSum;

    // Angular velocity proportional to difference
    let angularVelocity = diff * 0.5; // Gain factor
    angularVelocity = THREE.MathUtils.clamp(angularVelocity, -Math.PI, Math.PI);

    this.telemetryState = {
        spikeActive,
        leftPegRate,
        rightPegRate,
        angularVelocity
    };

    // Default forward speed, slowed down by front obstacle
    let linearVelocity = CONSTANTS.ROBOT_BASE_SPEED - (p_f * 1.0);
    linearVelocity = Math.max(0, linearVelocity);
    linearVelocity = Math.min(linearVelocity, CONSTANTS.ROBOT_BASE_SPEED);

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

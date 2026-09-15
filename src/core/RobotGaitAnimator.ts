import * as THREE from 'three';

export interface LegPivots {
  hip: THREE.Group;
  knee: THREE.Group;
}

export interface RobotLegs {
  fl: LegPivots; // Front Left
  fr: LegPivots; // Front Right
  rl: LegPivots; // Rear Left
  rr: LegPivots; // Rear Right
}

export class RobotGaitAnimator {
  private phase = 0;
  private legs: RobotLegs | null = null;
  private isWalking = false;

  public setLegs(legs: RobotLegs): void {
    this.legs = legs;
  }

  public setWalking(walking: boolean): void {
    this.isWalking = walking;
  }

  /**
   * Updates leg angles based on time and walking state
   * Section 5.5: "이동 중 다리는 sin 기반 단순 위상 애니메이션을 적용한다."
   */
  public update(deltaTime: number, speedFactor = 1.0): void {
    if (!this.legs) return;

    if (this.isWalking) {
      // Advance phase proportional to speed
      const gaitFrequency = 6.0 * speedFactor;
      this.phase += deltaTime * gaitFrequency;

      // Diagonal pairs: (FL, RR) in phase, (FR, RL) in opposite phase
      const maxHipSwing = 0.45; // radians
      const maxKneeFlex = 0.35; // radians

      const swing1 = Math.sin(this.phase) * maxHipSwing;
      const flex1 = Math.max(0, -Math.sin(this.phase)) * maxKneeFlex;

      const swing2 = Math.sin(this.phase + Math.PI) * maxHipSwing;
      const flex2 = Math.max(0, -Math.sin(this.phase + Math.PI)) * maxKneeFlex;

      // Pair 1: FL & RR
      this.legs.fl.hip.rotation.x = swing1;
      this.legs.fl.knee.rotation.x = flex1;

      this.legs.rr.hip.rotation.x = swing1;
      this.legs.rr.knee.rotation.x = flex1;

      // Pair 2: FR & RL
      this.legs.fr.hip.rotation.x = swing2;
      this.legs.fr.knee.rotation.x = flex2;

      this.legs.rl.hip.rotation.x = swing2;
      this.legs.rl.knee.rotation.x = flex2;
    } else {
      // Smoothly return to standing neutral stance
      const damping = Math.min(1.0, deltaTime * 8.0);
      const lerpRotation = (group: THREE.Group) => {
        group.rotation.x = THREE.MathUtils.lerp(group.rotation.x, 0, damping);
      };

      lerpRotation(this.legs.fl.hip);
      lerpRotation(this.legs.fl.knee);
      lerpRotation(this.legs.fr.hip);
      lerpRotation(this.legs.fr.knee);
      lerpRotation(this.legs.rl.hip);
      lerpRotation(this.legs.rl.knee);
      lerpRotation(this.legs.rr.hip);
      lerpRotation(this.legs.rr.knee);
    }
  }

  public reset(): void {
    this.phase = 0;
    this.isWalking = false;
    if (this.legs) {
      this.legs.fl.hip.rotation.x = 0;
      this.legs.fl.knee.rotation.x = 0;
      this.legs.fr.hip.rotation.x = 0;
      this.legs.fr.knee.rotation.x = 0;
      this.legs.rl.hip.rotation.x = 0;
      this.legs.rl.knee.rotation.x = 0;
      this.legs.rr.hip.rotation.x = 0;
      this.legs.rr.knee.rotation.x = 0;
    }
  }
}

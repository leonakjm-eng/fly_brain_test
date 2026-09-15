import * as THREE from 'three';
import { RobotConfig } from '../types';
import { RobotLegs, LegPivots } from './RobotGaitAnimator';

export interface QuadrupedRobotInstance {
  group: THREE.Group;
  legs: RobotLegs;
  cameraHead: THREE.Group;
  antenna: THREE.Group;
  camera: THREE.PerspectiveCamera;
}

export class QuadrupedRobotFactory {
  public static createQuadrupedRobot(config?: Partial<RobotConfig>): QuadrupedRobotInstance {
    const robotGroup = new THREE.Group();
    robotGroup.name = 'QuadrupedRobot';

    const bodyWidth = 0.55;
    const bodyHeight = 0.35;
    const bodyLength = 0.95;

    // Body chassis (yellow/industrial gold)
    const bodyGeo = new THREE.BoxGeometry(bodyWidth, bodyHeight, bodyLength);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(config?.bodyColor || '#eab308'),
      metalness: 0.3,
      roughness: 0.35,
    });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.position.y = 0.65; // height above ground
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    robotGroup.add(bodyMesh);

    // Dark accent top plate
    const topPlateGeo = new THREE.BoxGeometry(bodyWidth * 0.9, 0.04, bodyLength * 0.85);
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.5,
      roughness: 0.4,
    });
    const topPlate = new THREE.Mesh(topPlateGeo, darkMat);
    topPlate.position.set(0, bodyHeight / 2 + 0.02, 0);
    bodyMesh.add(topPlate);

    // Front Camera / Sensor Head (front top: Z = +bodyLength/2)
    const cameraHead = new THREE.Group();
    cameraHead.position.set(0, bodyHeight / 2 + 0.08, bodyLength * 0.38);

    const camDomeGeo = new THREE.CylinderGeometry(0.09, 0.11, 0.12, 16);
    const camDomeMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(config?.cameraColor || '#0284c7'),
      metalness: 0.8,
      roughness: 0.2,
    });
    const camDome = new THREE.Mesh(camDomeGeo, camDomeMat);
    camDome.rotation.x = Math.PI / 2;
    cameraHead.add(camDome);

    // Camera optical lens
    const lensGeo = new THREE.SphereGeometry(0.06, 16, 16);
    const lensMat = new THREE.MeshStandardMaterial({
      color: 0x06b6d4,
      metalness: 0.9,
      roughness: 0.1,
      emissive: 0x0284c7,
      emissiveIntensity: 0.3,
    });
    const lens = new THREE.Mesh(lensGeo, lensMat);
    lens.position.set(0, 0, 0.07);
    cameraHead.add(lens);

    // Robot Camera Mount & PerspectiveCamera (Section 3.1)
    const robotCameraMount = new THREE.Group();
    robotCameraMount.name = 'RobotCameraMount';
    // Position slightly in front of lens surface (lens center at z=0.07, radius=0.06 -> surface tip at z=0.13)
    robotCameraMount.position.set(0, 0, 0.14);
    // Robot forward axis is +Z while Three.js camera looks at -Z -> rotate 180 deg around Y
    robotCameraMount.rotation.y = Math.PI;

    const robotCamera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 300);
    robotCamera.name = 'RobotCamera';
    robotCameraMount.add(robotCamera);
    cameraHead.add(robotCameraMount);

    bodyMesh.add(cameraHead);

    // RTK GNSS Antenna (rear top: Z = -bodyLength/2)
    // Section 4.3 & 5.4: RTK Antenna
    const antenna = new THREE.Group();
    antenna.position.set(0, bodyHeight / 2, -bodyLength * 0.35);

    // Mast
    const mastHeight = 0.45;
    const mastGeo = new THREE.CylinderGeometry(0.015, 0.015, mastHeight, 12);
    const mastMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.8,
      roughness: 0.2,
    });
    const mast = new THREE.Mesh(mastGeo, mastMat);
    mast.position.y = mastHeight / 2;
    antenna.add(mast);

    // Disc antenna on top
    const discGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.035, 16);
    const discMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(config?.rtkAntennaColor || '#f8fafc'),
      metalness: 0.4,
      roughness: 0.3,
    });
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.position.y = mastHeight + 0.018;
    antenna.add(disc);

    // Antenna status LED
    const ledGeo = new THREE.SphereGeometry(0.015, 8, 8);
    const ledMat = new THREE.MeshBasicMaterial({ color: 0x22c55e }); // green RTK FIXED indicator
    const led = new THREE.Mesh(ledGeo, ledMat);
    led.position.y = mastHeight + 0.04;
    antenna.add(led);

    bodyMesh.add(antenna);

    // Status beacon on center
    const beaconGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.05, 12);
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0x3b82f6 });
    const beacon = new THREE.Mesh(beaconGeo, beaconMat);
    beacon.position.set(0, bodyHeight / 2 + 0.03, 0);
    bodyMesh.add(beacon);

    // Helper to create an articulated leg
    const createLeg = (xOffset: number, zOffset: number): LegPivots => {
      const hipGroup = new THREE.Group();
      hipGroup.position.set(xOffset, bodyMesh.position.y - 0.05, zOffset);

      const legMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(config?.legColor || '#1e293b'),
        metalness: 0.5,
        roughness: 0.4,
      });

      // Hip joint sphere
      const hipJointGeo = new THREE.SphereGeometry(0.065, 12, 12);
      const hipJoint = new THREE.Mesh(hipJointGeo, darkMat);
      hipGroup.add(hipJoint);

      // Thigh (upper leg)
      const thighLength = 0.32;
      const thighGeo = new THREE.BoxGeometry(0.06, thighLength, 0.07);
      const thighMesh = new THREE.Mesh(thighGeo, legMat);
      thighMesh.position.y = -thighLength / 2;
      thighMesh.castShadow = true;
      hipGroup.add(thighMesh);

      // Knee joint
      const kneeGroup = new THREE.Group();
      kneeGroup.position.set(0, -thighLength, 0);

      const kneeJointGeo = new THREE.SphereGeometry(0.055, 12, 12);
      const kneeJoint = new THREE.Mesh(kneeJointGeo, darkMat);
      kneeGroup.add(kneeJoint);

      // Shank (lower leg)
      const shankLength = 0.32;
      const shankGeo = new THREE.BoxGeometry(0.05, shankLength, 0.05);
      const shankMesh = new THREE.Mesh(shankGeo, legMat);
      shankMesh.position.y = -shankLength / 2;
      shankMesh.castShadow = true;
      kneeGroup.add(shankMesh);

      // Foot rubber sphere
      const footGeo = new THREE.SphereGeometry(0.05, 12, 12);
      const footMat = new THREE.MeshStandardMaterial({
        color: 0x0f172a,
        roughness: 0.9,
      });
      const footMesh = new THREE.Mesh(footGeo, footMat);
      footMesh.position.y = -shankLength;
      kneeGroup.add(footMesh);

      hipGroup.add(kneeGroup);
      robotGroup.add(hipGroup);

      return { hip: hipGroup, knee: kneeGroup };
    };

    const xDist = bodyWidth / 2 + 0.06;
    const zDist = bodyLength * 0.35;

    // In Three.js coordinates: front is +Z, right is +X
    const fl = createLeg(xDist, zDist);    // Front-Left (positive X, positive Z)
    const fr = createLeg(-xDist, zDist);   // Front-Right (negative X, positive Z)
    const rl = createLeg(xDist, -zDist);   // Rear-Left (positive X, negative Z)
    const rr = createLeg(-xDist, -zDist);  // Rear-Right (negative X, negative Z)

    const legs: RobotLegs = { fl, fr, rl, rr };

    return {
      group: robotGroup,
      legs,
      cameraHead,
      antenna,
      camera: robotCamera,
    };
  }
}

export function createQuadrupedRobot(config?: Partial<RobotConfig>): QuadrupedRobotInstance {
  return QuadrupedRobotFactory.createQuadrupedRobot(config);
}

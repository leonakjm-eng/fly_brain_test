import * as THREE from 'three';

export interface DynamicObstacle {
  mesh: THREE.Mesh;
  startPos: THREE.Vector3;
  endPos: THREE.Vector3;
  period: number; // 왕복 주기 (초 단위, 기본 2.5초)
  elapsedTime: number;
  update(dt: number): void;
}

export class TestbedGenerator {
  public static createMazeWithDynamicObstacles(): {
    testbedGroup: THREE.Group;
    walkableGround: THREE.Mesh;
    dynamicObstacles: DynamicObstacle[];
  } {
    const testbedGroup = new THREE.Group();
    const dynamicObstacles: DynamicObstacle[] = [];

    // Walkable Ground
    const groundGeo = new THREE.PlaneGeometry(20, 20);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x555555 });
    const walkableGround = new THREE.Mesh(groundGeo, groundMat);
    walkableGround.rotation.x = -Math.PI / 2;
    walkableGround.userData.isWalkable = true;
    walkableGround.receiveShadow = true;
    testbedGroup.add(walkableGround);

    // Helper to create static walls
    const createWall = (x: number, z: number, width: number, depth: number) => {
      const geo = new THREE.BoxGeometry(width, 2, depth);
      const mat = new THREE.MeshStandardMaterial({ color: 0x888888 });
      const wall = new THREE.Mesh(geo, mat);
      wall.position.set(x, 1, z);
      wall.userData.isStatic = true;
      wall.userData.isObstacle = true;
      wall.castShadow = true;
      wall.receiveShadow = true;
      testbedGroup.add(wall);
      return wall;
    };

    // Create a simple maze layout
    createWall(0, -5, 10, 1);
    createWall(-5, 0, 1, 10);
    createWall(5, 0, 1, 10);
    createWall(0, 5, 4, 1);

    // Helper to create dynamic obstacles
    const createDynamicObstacle = (start: THREE.Vector3, end: THREE.Vector3): DynamicObstacle => {
      const geo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
      const mat = new THREE.MeshStandardMaterial({ color: 0xff4400 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(start);
      mesh.userData.isDynamic = true;
      mesh.userData.isObstacle = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      testbedGroup.add(mesh);

      return {
        mesh,
        startPos: start.clone(),
        endPos: end.clone(),
        period: 2.5,
        elapsedTime: 0,
        update(dt: number) {
          this.elapsedTime += dt;
          // Calculate phase from 0 to 1
          const phase = (Math.sin((this.elapsedTime / this.period) * Math.PI * 2 - Math.PI / 2) + 1) / 2;
          this.mesh.position.lerpVectors(this.startPos, this.endPos, phase);
        }
      };
    };

    // Add a couple of dynamic obstacles
    dynamicObstacles.push(createDynamicObstacle(new THREE.Vector3(-2, 0.75, 2), new THREE.Vector3(2, 0.75, 2)));
    dynamicObstacles.push(createDynamicObstacle(new THREE.Vector3(2, 0.75, -2), new THREE.Vector3(-2, 0.75, -2)));

    return {
      testbedGroup,
      walkableGround,
      dynamicObstacles
    };
  }
}

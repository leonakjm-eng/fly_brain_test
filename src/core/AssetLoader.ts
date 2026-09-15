import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { TestbedConfigJSON } from '../types/index';

export class AssetLoader {

  public async loadModelFromFile(file: File): Promise<THREE.Group | THREE.Mesh> {
    const ext = file.name.split('.').pop()?.toLowerCase();
    const url = URL.createObjectURL(file); // Electron/Tauri safe file reading

    try {
      let result: THREE.Group | THREE.Mesh;

      if (ext === 'glb' || ext === 'gltf') {
        result = await this.loadGLTF(url);
      } else if (ext === 'obj') {
        result = await this.loadOBJ(url);
      } else if (ext === 'fbx') {
        result = await this.loadFBX(url);
      } else if (ext === 'json') {
        const text = await file.text();
        result = this.parseCustomJSON(text);
      } else {
        throw new Error("Unsupported file format");
      }

      this.normalizeModel(result);

      // Inject tags to all children
      result.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.userData.isObstacle = true;
          mesh.userData.isStatic = true;
          if (mesh.geometry) {
            mesh.geometry.computeBoundingBox();
          }
          mesh.updateMatrixWorld(true);
        }
      });

      this.tagWalkableSurfaces(result);

      return result;
    } finally {
      URL.revokeObjectURL(url); // Clean up
    }
  }

  private loadGLTF(url: string): Promise<THREE.Group> {
    return new Promise((resolve, reject) => {
      const loader = new GLTFLoader();
      loader.load(url, (gltf) => resolve(gltf.scene), undefined, reject);
    });
  }

  private loadOBJ(url: string): Promise<THREE.Group> {
    return new Promise((resolve, reject) => {
      const loader = new OBJLoader();
      loader.load(url, resolve, undefined, reject);
    });
  }

  private loadFBX(url: string): Promise<THREE.Group> {
    return new Promise((resolve, reject) => {
      const loader = new FBXLoader();
      loader.load(url, resolve, undefined, reject);
    });
  }

  public parseCustomJSON(jsonContent: string): THREE.Group {
    const config: TestbedConfigJSON = JSON.parse(jsonContent);
    const group = new THREE.Group();

    // Create Floor (Walkable)
    const floorGeo = new THREE.PlaneGeometry(config.mapSize.width, config.mapSize.depth);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x888888 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.userData.isWalkable = true;
    group.add(floor);

    // Create Obstacles
    if (config.obstacles) {
      config.obstacles.forEach(obs => {
        let geo: THREE.BufferGeometry;
        if (obs.type === 'box') {
          geo = new THREE.BoxGeometry(obs.size[0], obs.size[1], obs.size[2]);
        } else if (obs.type === 'cylinder') {
          geo = new THREE.CylinderGeometry(obs.size[0], obs.size[0], obs.size[1], 16);
        } else {
          return;
        }

        const mat = new THREE.MeshStandardMaterial({ color: 0xaa3333 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(obs.position[0], obs.position[1], obs.position[2]);
        mesh.userData.isObstacle = true;
        group.add(mesh);
      });
    }

    return group;
  }

  private normalizeModel(model: THREE.Object3D) {
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);

    const maxDim = Math.max(size.x, size.y, size.z);

    // E-2: Scale normalization
    if (maxDim > 500) {
      const scale = 100 / maxDim; // Arbitrary safe size
      model.scale.set(scale, scale, scale);
    } else if (maxDim < 0.1 && maxDim > 0) {
      const scale = 10 / maxDim;
      model.scale.set(scale, scale, scale);
    }

    // Recompute after scaling
    box.setFromObject(model);
    box.getCenter(center);

    // Align to center (0,0,0) and bottom of bounding box to y=0
    model.position.x -= center.x;
    model.position.y -= box.min.y;
    model.position.z -= center.z;
  }

  private tagWalkableSurfaces(model: THREE.Object3D) {
    // If it's loaded from GLTF/OBJ/FBX without custom data, try to infer walkability
    // Simple heuristic: if face normal is pointing up, it's walkable, else obstacle.
    // For simplicity, we just mark all meshes as obstacle, and find horizontal flat ones as walkable.
    model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        // Very basic naive tagging: if bounding box is very thin in Y and wide in X/Z, it's a floor.
        child.geometry.computeBoundingBox();
        const b = child.geometry.boundingBox;
        if (b) {
          const size = new THREE.Vector3();
          b.getSize(size);
          // Adjust based on mesh scale
          size.multiply(child.scale);

          if (size.y < 0.5 && size.x > 2 && size.z > 2) {
            child.userData.isWalkable = true;
          } else {
            child.userData.isObstacle = true;
          }
        }
      }
    });
  }

  public static disposeObject(obj: THREE.Object3D): void {
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          const disposeMaterial = (mat: THREE.Material) => {
            mat.dispose();
            // Need to typecast or check properties dynamically as base Material doesn't define maps explicitly
            for (const key in mat) {
              const value = (mat as any)[key];
              if (value && typeof value === 'object' && 'minFilter' in value && typeof value.dispose === 'function') {
                value.dispose();
              }
            }
          };

          if (Array.isArray(child.material)) {
            child.material.forEach(m => disposeMaterial(m));
          } else {
            disposeMaterial(child.material);
          }
        }
      }
    });
  }
}

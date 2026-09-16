import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { AssetLoader } from './AssetLoader';

export class Viewer3D {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  public controls: OrbitControls;
  private raycaster: THREE.Raycaster;

  // Markers
  private startMarker: THREE.Mesh | null = null;
  private endMarker: THREE.Mesh | null = null;

  // Testbed elements tracking
  private testbedGroup: THREE.Group = new THREE.Group();

  private pathLines: Map<string, THREE.Line> = new Map();

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x333333);

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.set(0, 20, 20);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });

    // Controls will be initialized in init()
    this.controls = {} as OrbitControls;
    this.raycaster = new THREE.Raycaster();

    this.setupLights();
    this.scene.add(this.testbedGroup);
  }

  public init(canvasElement: HTMLCanvasElement): void {
    this.renderer = new THREE.WebGLRenderer({ canvas: canvasElement, antialias: true });
    this.renderer.setSize(canvasElement.clientWidth, canvasElement.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);

    // Fix aspect ratio based on canvas actual size
    this.camera.aspect = canvasElement.clientWidth / canvasElement.clientHeight;
    this.camera.updateProjectionMatrix();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;

    window.addEventListener('resize', this.onWindowResize.bind(this));
  }

  private setupLights() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(10, 20, 10);
    this.scene.add(dirLight);
  }

  private onWindowResize() {
    const canvas = this.renderer.domElement;
    if (!canvas) return;

    const width = canvas.parentElement?.clientWidth || window.innerWidth;
    const height = canvas.parentElement?.clientHeight || window.innerHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  public render(): void {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  public getIntersection(screenPos: { x: number, y: number }, canvasWidth: number, canvasHeight: number): THREE.Intersection | null {
    // Normalize screen coordinates (-1 to +1)
    const mouse = new THREE.Vector2(
      (screenPos.x / canvasWidth) * 2 - 1,
      -(screenPos.y / canvasHeight) * 2 + 1
    );

    this.raycaster.setFromCamera(mouse, this.camera);

    // Intersect only with objects that are walkable
    const intersects = this.raycaster.intersectObject(this.testbedGroup, true);
    for (const intersect of intersects) {
      if (intersect.object.userData.isWalkable) {
        return intersect;
      }
    }
    return null;
  }

  public drawPath(pathId: string, waypoints: THREE.Vector3[], colorHex: number = 0x3b82f6): void {
    this.clearPath(pathId);

    if (!waypoints || waypoints.length < 2) return;

    // +0.02 offset to prevent Z-fighting
    const points = waypoints.map(p => new THREE.Vector3(p.x, p.y + 0.02, p.z));

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: colorHex,
      linewidth: 2,
      depthTest: true
    });

    const pathLine = new THREE.Line(geometry, material);
    this.scene.add(pathLine);
    this.pathLines.set(pathId, pathLine);
  }

  public clearPath(pathId?: string): void {
    if (pathId) {
      const line = this.pathLines.get(pathId);
      if (line) {
        this.scene.remove(line);
        line.geometry.dispose();
        if (Array.isArray(line.material)) {
          line.material.forEach(m => m.dispose());
        } else {
          line.material.dispose();
        }
        this.pathLines.delete(pathId);
      }
    } else {
      this.pathLines.forEach(line => {
        this.scene.remove(line);
        line.geometry.dispose();
        if (Array.isArray(line.material)) {
          line.material.forEach(m => m.dispose());
        } else {
          line.material.dispose();
        }
      });
      this.pathLines.clear();
    }
  }

  public clearTestbed(): void {
    this.clearPath();

    // Traverse and dispose to prevent memory leaks (Rule 1)
    this.testbedGroup.children.forEach(child => {
      AssetLoader.disposeObject(child);
    });
    this.testbedGroup.clear();

    // Markers are separate, just remove them if needed, but not cleared on testbed clear unless desired.
    // For now, let's remove markers when testbed is cleared.
    if (this.startMarker) {
      this.scene.remove(this.startMarker);
      AssetLoader.disposeObject(this.startMarker);
      this.startMarker = null;
    }
    if (this.endMarker) {
      this.scene.remove(this.endMarker);
      AssetLoader.disposeObject(this.endMarker);
      this.endMarker = null;
    }
  }

  public addTestbedObject(obj: THREE.Object3D) {
    this.testbedGroup.add(obj);
  }

  public getTestbedObjects(): THREE.Object3D[] {
      return this.testbedGroup.children;
  }

  public setStartMarker(pos: THREE.Vector3) {
    if (!this.startMarker) {
      const geo = new THREE.SphereGeometry(0.3);
      const mat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
      this.startMarker = new THREE.Mesh(geo, mat);
      this.scene.add(this.startMarker);
    }
    this.startMarker.position.copy(pos);
  }

  public setEndMarker(pos: THREE.Vector3) {
    if (!this.endMarker) {
      const geo = new THREE.SphereGeometry(0.3);
      const mat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
      this.endMarker = new THREE.Mesh(geo, mat);
      this.scene.add(this.endMarker);
    }
    this.endMarker.position.copy(pos);
  }

  public getStartMarker(): THREE.Mesh | null {
      return this.startMarker;
  }

  public getEndMarker(): THREE.Mesh | null {
      return this.endMarker;
  }
}

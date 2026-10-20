import * as THREE from 'three';

export class DragDropController {
  private domElement: HTMLElement;
  private camera: THREE.Camera;
  private scene: THREE.Scene;
  private controls: any; // OrbitControls
  private walkablePlane: THREE.Mesh;

  private raycaster: THREE.Raycaster = new THREE.Raycaster();
  private mouse: THREE.Vector2 = new THREE.Vector2();

  private isEnabled: boolean = true;
  private isDragging: boolean = false;
  private dragTarget: THREE.Object3D | null = null;
  private originalColor: number | null = null;

  public onDragEnd?: (obj: THREE.Object3D) => void;

  constructor(domElement: HTMLElement, camera: THREE.Camera, scene: THREE.Scene, controls: any, walkablePlane: THREE.Mesh) {
    this.domElement = domElement;
    this.camera = camera;
    this.scene = scene;
    this.controls = controls;
    this.walkablePlane = walkablePlane;
  }

  public init(): void {
    this.domElement.addEventListener('pointerdown', this.onPointerDown.bind(this));
    this.domElement.addEventListener('pointermove', this.onPointerMove.bind(this));
    this.domElement.addEventListener('pointerup', this.onPointerUp.bind(this));
    this.domElement.addEventListener('pointercancel', this.onPointerCancel.bind(this));
  }

  public updateWalkablePlane(walkablePlane: THREE.Mesh): void {
    this.walkablePlane = walkablePlane;
  }

  public setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    if (!enabled && this.isDragging) {
      this.cancelDrag();
    }
  }

  public getIsDragging(): boolean {
    return this.isDragging;
  }

  private updateMouse(event: PointerEvent): void {
    const rect = this.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private onPointerDown(event: PointerEvent): void {
    if (!this.isEnabled) return;
    this.updateMouse(event);

    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Check intersection with all objects in scene
    const intersects = this.raycaster.intersectObjects(this.scene.children, true);

    for (const intersect of intersects) {
      if (intersect.object.userData.isDraggable) {
        this.dragTarget = intersect.object;
        this.isDragging = true;
        this.controls.enabled = false;

        // Visual feedback
        if (this.dragTarget instanceof THREE.Mesh && this.dragTarget.userData.isStatic) {
          if (this.dragTarget.material instanceof THREE.MeshBasicMaterial ||
              this.dragTarget.material instanceof THREE.MeshStandardMaterial ||
              this.dragTarget.material instanceof THREE.MeshLambertMaterial ||
              this.dragTarget.material instanceof THREE.MeshPhongMaterial) {
            this.originalColor = this.dragTarget.material.color.getHex();
            this.dragTarget.material.color.setHex(0x3b82f6); // blue
          }
        }

        event.stopPropagation();
        return;
      }
    }
  }

  private onPointerMove(event: PointerEvent): void {
    if (!this.isEnabled || !this.isDragging || !this.dragTarget) return;

    this.updateMouse(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const intersects = this.raycaster.intersectObject(this.walkablePlane);

    if (intersects.length > 0) {
      const point = intersects[0].point;

      // Clamp coordinates
      const clampedX = THREE.MathUtils.clamp(point.x, -9.5, 9.5);
      const clampedZ = THREE.MathUtils.clamp(point.z, -9.5, 9.5);

      // Y is half of height
      let yOffset = 0.5; // default for 1.0 height

      this.dragTarget.position.set(clampedX, yOffset, clampedZ);
    }
  }

  private onPointerUp(_event: PointerEvent): void {
    this.endDrag();
  }

  private onPointerCancel(_event: PointerEvent): void {
    this.cancelDrag();
  }

  private endDrag(): void {
    if (!this.isDragging || !this.dragTarget) return;

    if (this.dragTarget instanceof THREE.Mesh && this.dragTarget.userData.isStatic && this.originalColor !== null) {
      if (this.dragTarget.material instanceof THREE.MeshBasicMaterial ||
          this.dragTarget.material instanceof THREE.MeshStandardMaterial ||
          this.dragTarget.material instanceof THREE.MeshLambertMaterial ||
          this.dragTarget.material instanceof THREE.MeshPhongMaterial) {
        this.dragTarget.material.color.setHex(this.originalColor);
      }
    }

    this.dragTarget.updateMatrixWorld(true);

    if (this.dragTarget.userData.isDynamic && this.onDragEnd) {
      this.onDragEnd(this.dragTarget);
    }

    this.dragTarget = null;
    this.isDragging = false;
    this.originalColor = null;

    // Enable controls only if not explicitly disabled by external factors
    if (this.isEnabled) {
      this.controls.enabled = true;
    }
  }

  private cancelDrag(): void {
    this.endDrag();
  }
}

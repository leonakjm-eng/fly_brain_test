import * as THREE from 'three';
import { Viewer3D } from './core/Viewer3D';
import { AssetLoader } from './core/AssetLoader';
import { RobotController } from './core/RobotController';
import { SimulationManager } from './core/SimulationManager';
import { ControlPanel } from './ui/ControlPanel';

let viewer: Viewer3D;
let assetLoader: AssetLoader;
let robot: RobotController;
let simManager: SimulationManager;
let ui: ControlPanel;

let isSettingStart = false;
let isSettingEnd = false;
let walkableMeshCache: THREE.Mesh | null = null;
const clock = new THREE.Clock();

function init() {
  // Initialize UI
  ui = new ControlPanel('ui-container');

  // Initialize Viewer
  const canvas = document.getElementById('viewport-canvas') as HTMLCanvasElement;
  viewer = new Viewer3D();
  viewer.init(canvas);

  // Initialize Loaders and Robot
  assetLoader = new AssetLoader();
  robot = new RobotController();

  viewer.scene.add(robot.mesh); // Add robot to scene

  // Load default robot asynchronously
  robot.loadRobot('/models/default_robot.glb').catch(e => {
    console.warn("Failed to load default robot model, using fallback.", e);
  });

  // Initialize Simulation Manager
  simManager = new SimulationManager(viewer, robot);

  bindEvents();

  // Start loop
  clock.start();
  requestAnimationFrame(animate);
}

function bindEvents() {
  // UI -> Simulation Manager / Viewer
  ui.onModeChange = (mode) => {
    simManager.setMode(mode);
  };

  ui.onFileSelect = async (file) => {
    try {
      ui.setTestbedInfo(`Loading ${file.name}...`);
      const model = await assetLoader.loadModelFromFile(file);

      viewer.clearTestbed();
      viewer.addTestbedObject(model);

      // Find walkable mesh for A*
      walkableMeshCache = null;
      model.traverse((child) => {
        if (child instanceof THREE.Mesh && child.userData.isWalkable && !walkableMeshCache) {
          walkableMeshCache = child;
        }
      });

      if (walkableMeshCache) {
        simManager.prepareEnvironment(walkableMeshCache, viewer.getTestbedObjects());
        let info = `Loaded: ${file.name}`;
        if (model instanceof THREE.Group) {
          let meshCount = 0;
          model.traverse(c => { if (c instanceof THREE.Mesh) meshCount++; });
          info += ` (${meshCount} meshes)`;
        }
        ui.setTestbedInfo(info);
      } else {
        ui.setTestbedInfo("Warning: No walkable surface found.");
      }

    } catch (e) {
      console.error(e);
      alert("유효한 3D 파일이 아닙니다. (E-1: Invalid 3D file)");
      ui.setTestbedInfo("Load failed.");
    }
  };

  ui.onSetStartToggle = (active) => {
    isSettingStart = active;
    viewer.controls.enabled = !active && !isSettingEnd;
  };

  ui.onSetEndToggle = (active) => {
    isSettingEnd = active;
    viewer.controls.enabled = !active && !isSettingStart;
  };

  ui.onSimStart = () => {
    simManager.start();
  };

  ui.onSimReset = () => {
    simManager.reset();
  };

  // Viewer Interaction (Raycasting for Start/End)
  const canvas = document.getElementById('viewport-canvas') as HTMLCanvasElement;
  canvas.addEventListener('click', (event) => {
    if (!isSettingStart && !isSettingEnd) return;

    // Calculate mouse position relative to canvas
    const rect = canvas.getBoundingClientRect();
    const pos = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };

    const intersect = viewer.getIntersection(pos, canvas.clientWidth, canvas.clientHeight);

    if (intersect && intersect.object.userData.isWalkable) {
      if (isSettingStart) {
        simManager.setStartPoint(intersect.point);
      } else if (isSettingEnd) {
        simManager.setEndPoint(intersect.point);
      }
      // Auto disable mode
      ui.disablePlacementModes();
      isSettingStart = false;
      isSettingEnd = false;
      viewer.controls.enabled = true;
    }
  });
}

function animate() {
  requestAnimationFrame(animate);

  const dt = clock.getDelta();

  // Update simulation
  simManager.update(dt);

  // Render scene
  viewer.render();

  // Update UI (throttled inside UI class)
  const now = performance.now();
  const fps = 1 / dt;
  ui.updateStatus(now, simManager.state, fps, simManager.getStartPoint(), simManager.getEndPoint(), simManager.getIsReady());
}

// Bootstrap
init();

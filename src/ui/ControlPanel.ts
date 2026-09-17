import { NavigationMode, SimState } from '../types/index';

export class ControlPanel {
  private container: HTMLElement;

  // Elements
  private modeRadios: HTMLInputElement[] = [];
  private navModeHeader!: HTMLHeadingElement;
  private btnLoadTestbed!: HTMLButtonElement;
  private inputFileHidden!: HTMLInputElement;
  private labelTestbedInfo!: HTMLSpanElement;

  private btnSetStart!: HTMLButtonElement;
  private btnSetEnd!: HTMLButtonElement;
  private txtCoordsInfo!: HTMLDivElement;

  private btnSimStart!: HTMLButtonElement;
  private btnSimReset!: HTMLButtonElement;
  private labelSimStatus!: HTMLSpanElement;

  // Callbacks
  public onModeChange?: (mode: NavigationMode) => void;
  public onFileSelect?: (file: File) => void;
  public onPresetSelect?: (preset: 'SINGLE_MAZE' | 'PARALLEL_RACE') => void;
  public onSetStartToggle?: (active: boolean) => void;
  public onSetEndToggle?: (active: boolean) => void;
  public onSimStart?: () => void;
  public onSimReset?: () => void;

  // State
  private lastUpdateTime = 0;
  private isStartModeActive = false;
  private isEndModeActive = false;

  constructor(containerId: string) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error(`Container ${containerId} not found`);
    this.container = el;

    this.buildUI();
    this.bindEvents();
  }

  private buildUI() {
    this.container.innerHTML = `
      <h1>BIO-NAV CONTROLLER</h1>

      <div class="section">
        <h2 id="nav-mode-header">[NAVIGATION MODE]</h2>
        <div class="radio-group">
          <label><input type="radio" name="nav-mode" id="radio-mode-astar" value="${NavigationMode.ASTAR}"> A* Global Planner</label>
          <label><input type="radio" name="nav-mode" id="radio-mode-cx" value="${NavigationMode.FLY_CX}"> Fly CX SNN (Reactive)</label>
          <label><input type="radio" name="nav-mode" id="radio-mode-hybrid" value="${NavigationMode.HYBRID}" checked> Hybrid (A* + CX)</label>
        </div>
      </div>

      <div class="section">
        <h2>[TESTBED LOADER]</h2>
        <button id="btn-load-preset1">📂 [1차] 단일 미로 테스트</button>
        <button id="btn-load-preset2">🏁 [2차] 3-레인 병렬 레이스</button>
        <button id="btn-load-testbed">📂 Load 3D / JSON File</button>
        <input type="file" id="input-file-hidden" style="display: none;" accept=".glb,.gltf,.obj,.fbx,.json">
        <span id="label-testbed-info">Status: Waiting for file...</span>
      </div>

      <div class="section">
        <h2>[WAYPOINTS & CONTROL]</h2>
        <button id="btn-set-start">📍 Set Start</button>
        <button id="btn-set-end">🎯 Set End</button>
        <div id="txt-coords-info">
          Start: Not set<br>
          End: Not set
        </div>
      </div>

      <div class="section">
        <button id="btn-sim-start" disabled>▶ START SIMULATION</button>
        <button id="btn-sim-reset">↺ RESET</button>
        <span id="label-sim-status">State: ${SimState.IDLE} | FPS: 0</span>
      </div>
    `;

    this.modeRadios = [
      document.getElementById('radio-mode-astar') as HTMLInputElement,
      document.getElementById('radio-mode-cx') as HTMLInputElement,
      document.getElementById('radio-mode-hybrid') as HTMLInputElement,
    ];
    this.navModeHeader = document.getElementById('nav-mode-header') as HTMLHeadingElement;
    this.btnLoadTestbed = document.getElementById('btn-load-testbed') as HTMLButtonElement;
    this.inputFileHidden = document.getElementById('input-file-hidden') as HTMLInputElement;
    this.labelTestbedInfo = document.getElementById('label-testbed-info') as HTMLSpanElement;
    const btnLoadPreset1 = document.getElementById('btn-load-preset1') as HTMLButtonElement;
    const btnLoadPreset2 = document.getElementById('btn-load-preset2') as HTMLButtonElement;

    btnLoadPreset1.addEventListener('click', () => {
      if (this.onPresetSelect) this.onPresetSelect('SINGLE_MAZE');
      this.labelTestbedInfo.textContent = 'Current: [1차] 단일 미로';
      this.setParallelMode(false);
    });

    btnLoadPreset2.addEventListener('click', () => {
      if (this.onPresetSelect) this.onPresetSelect('PARALLEL_RACE');
      this.labelTestbedInfo.textContent = 'Current: [2차] 3-레인 병렬 레이스';
      this.setParallelMode(true);
    });

    this.btnSetStart = document.getElementById('btn-set-start') as HTMLButtonElement;
    this.btnSetEnd = document.getElementById('btn-set-end') as HTMLButtonElement;
    this.txtCoordsInfo = document.getElementById('txt-coords-info') as HTMLDivElement;

    this.btnSimStart = document.getElementById('btn-sim-start') as HTMLButtonElement;
    this.btnSimReset = document.getElementById('btn-sim-reset') as HTMLButtonElement;
    this.labelSimStatus = document.getElementById('label-sim-status') as HTMLSpanElement;
  }

  private bindEvents() {
    this.modeRadios.forEach(radio => {
      radio.addEventListener('change', (e) => {
        if ((e.target as HTMLInputElement).checked && this.onModeChange) {
          this.onModeChange((e.target as HTMLInputElement).value as NavigationMode);
        }
      });
    });

    this.btnLoadTestbed.addEventListener('click', () => {
      this.inputFileHidden.click();
    });

    this.inputFileHidden.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      if (target.files && target.files.length > 0) {
        if (this.onFileSelect) {
          this.onFileSelect(target.files[0]);
        }
        // Reset input so the same file can be loaded again if needed
        target.value = '';
      }
    });

    this.btnSetStart.addEventListener('click', () => {
      this.isStartModeActive = !this.isStartModeActive;
      this.isEndModeActive = false;
      this.updateButtonStates();
      if (this.onSetStartToggle) this.onSetStartToggle(this.isStartModeActive);
      if (this.onSetEndToggle) this.onSetEndToggle(false);
    });

    this.btnSetEnd.addEventListener('click', () => {
      this.isEndModeActive = !this.isEndModeActive;
      this.isStartModeActive = false;
      this.updateButtonStates();
      if (this.onSetEndToggle) this.onSetEndToggle(this.isEndModeActive);
      if (this.onSetStartToggle) this.onSetStartToggle(false);
    });

    this.btnSimStart.addEventListener('click', () => {
      if (this.onSimStart) this.onSimStart();
    });

    this.btnSimReset.addEventListener('click', () => {
      if (this.onSimReset) this.onSimReset();
    });
  }

  private updateButtonStates() {
    this.btnSetStart.classList.toggle('active', this.isStartModeActive);
    this.btnSetEnd.classList.toggle('active', this.isEndModeActive);
  }

  public setParallelMode(active: boolean): void {
    if (active) {
      this.disablePlacementModes();
      this.modeRadios.forEach(radio => radio.disabled = true);
      this.btnSetStart.disabled = true;
      this.btnSetEnd.disabled = true;
      this.navModeHeader.textContent = '[NAVIGATION MODE: PARALLEL RACE ACTIVE]';
    } else {
      this.modeRadios.forEach(radio => radio.disabled = false);
      this.btnSetStart.disabled = false;
      this.btnSetEnd.disabled = false;
      this.navModeHeader.textContent = '[NAVIGATION MODE]';
    }
  }

  // Called by external systems to cancel modes (e.g. after successful placement)
  public disablePlacementModes() {
    if (this.isStartModeActive) {
      this.isStartModeActive = false;
      this.updateButtonStates();
      if (this.onSetStartToggle) this.onSetStartToggle(false);
    }
    if (this.isEndModeActive) {
      this.isEndModeActive = false;
      this.updateButtonStates();
      if (this.onSetEndToggle) this.onSetEndToggle(false);
    }
  }

  // 10Hz throttling update
  public updateStatus(
    now: number,
    state: SimState,
    fps: number,
    startPos: {x: number, y: number, z: number} | null,
    endPos: {x: number, y: number, z: number} | null,
    canStart: boolean
  ) {
    if (now - this.lastUpdateTime < 100) return; // 100ms = 10Hz
    this.lastUpdateTime = now;

    this.labelSimStatus.textContent = `State: ${state} | FPS: ${Math.round(fps)}`;

    const startStr = startPos ? `(${startPos.x.toFixed(2)}, ${startPos.y.toFixed(2)}, ${startPos.z.toFixed(2)})` : 'Not set';
    const endStr = endPos ? `(${endPos.x.toFixed(2)}, ${endPos.y.toFixed(2)}, ${endPos.z.toFixed(2)})` : 'Not set';

    this.txtCoordsInfo.innerHTML = `Start: ${startStr}<br>End: ${endStr}`;

    this.btnSimStart.disabled = !canStart || state === SimState.RUNNING;
  }

  public setTestbedInfo(info: string) {
    this.labelTestbedInfo.textContent = info;
  }
}

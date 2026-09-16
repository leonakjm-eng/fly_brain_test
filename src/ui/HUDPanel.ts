import { TelemetryData } from '../types/index';

export class HUDPanel {
  private container: HTMLElement;
  private isParallelMode: boolean = false;
  private cards: Record<string, HTMLElement> = {};
  private lastUpdateTime: number = 0;

  constructor(parentContainer: HTMLElement) {
    this.container = document.createElement('div');
    this.container.id = 'hud-overlay';
    parentContainer.appendChild(this.container);

    // Default to single mode on creation
    this.setMode(false);
  }

  public setMode(isParallel: boolean): void {
    this.isParallelMode = isParallel;
    this.clear();

    if (this.isParallelMode) {
      this.cards['astar'] = this.createCard('hud-card-astar', 'A* Planner');
      this.cards['fly'] = this.createCard('hud-card-fly', 'Fly Brain (CX)');
      this.cards['hybrid'] = this.createCard('hud-card-hybrid', 'Hybrid Nav');

      this.container.appendChild(this.cards['astar']);
      this.container.appendChild(this.cards['fly']);
      this.container.appendChild(this.cards['hybrid']);
    } else {
      this.cards['single'] = this.createCard('hud-card-single', 'Telemetry');
      this.container.appendChild(this.cards['single']);
    }
  }

  private createCard(id: string, title: string): HTMLElement {
    const card = document.createElement('div');
    card.id = id;
    card.className = 'hud-card';

    const titleEl = document.createElement('div');
    titleEl.className = 'hud-title';
    titleEl.textContent = title;

    const contentEl = document.createElement('div');
    contentEl.className = 'hud-content';

    card.appendChild(titleEl);
    card.appendChild(contentEl);

    return card;
  }

  public updateTelemetry(telemetries: TelemetryData[]): void {
    const now = performance.now();
    // 10Hz throttling (100ms)
    if (now - this.lastUpdateTime < 100) {
      return;
    }
    this.lastUpdateTime = now;

    if (this.isParallelMode) {
      telemetries.forEach(t => {
        const card = this.cards[t.agentId];
        if (card) {
          this.updateCardContent(card, t);
        }
      });
    } else if (telemetries.length > 0) {
      // In single mode, just show the first agent's telemetry
      const card = this.cards['single'];
      if (card) {
        this.updateCardContent(card, telemetries[0]);
      }
    }
  }

  private updateCardContent(card: HTMLElement, t: TelemetryData): void {
    const contentEl = card.querySelector('.hud-content') as HTMLElement;
    if (!contentEl) return;

    // Formatting helper
    const f = (n: number | undefined, dec = 2) => n !== undefined ? n.toFixed(dec) : '0.00';

    let html = '';

    if (t.mode === 'FLY_CX') {
      const headingDiff = t.headingErrorDeg > 0 ? `+${f(t.headingErrorDeg, 0)}` : f(t.headingErrorDeg, 0);
      const spikeStatus = t.membraneSpikeActive ? 'ACTIVE' : 'IDLE';
      const steerVal = t.angularVelocity > 0 ? `+${f(t.angularVelocity)}` : f(t.angularVelocity);

      html += `<div class="hud-cyan"><span class="badge badge-fly">FLY CX SNN</span></div>`;
      html += `<div class="hud-cyan">Heading: ${f(t.headingDeg, 0)}° | Goal: ${f(t.targetHeadingDeg, 0)}° (Err: ${headingDiff}°)</div>`;
      html += `<div class="hud-yellow">Sensor: Front ${f(t.closestObstacleDist)}m | Spike: ${spikeStatus}</div>`;
      html += `<div class="hud-green">Steer: ${steerVal} rad/s | Speed: ${f(t.linearVelocity)} m/s</div>`;

      if (t.isEmergency) {
        html += `<div class="hud-red">EMERGENCY AVOIDANCE ACTIVE</div>`;
      }
    } else if (t.mode === 'ASTAR') {
      html += `<div class="hud-blue"><span class="badge badge-astar">A* GLOBAL PLANNER</span></div>`;
      html += `<div class="hud-gray">Speed: ${f(t.linearVelocity)} m/s</div>`;
      html += `<div class="hud-gray">Heading: ${f(t.headingDeg, 0)}°</div>`;
      html += `<div class="hud-gray">Remaining Dist: ${f(t.remainingDist)} m</div>`;
      if (t.isDecelerating) {
         html += `<div class="hud-yellow">Decelerating</div>`;
      }
      if (t.isEmergency) {
         html += `<div class="hud-red">STALLED / EMERGENCY</div>`;
      } else {
         html += `<div class="hud-green">Status: ${t.statusText}</div>`;
      }
    } else if (t.mode === 'HYBRID') {
      html += `<div class="hud-amber"><span class="badge badge-hybrid">DYNAMIC HYBRID</span></div>`;
      html += `<div class="hud-yellow">Sensor: Front ${f(t.closestObstacleDist)}m</div>`;
      html += `<div class="hud-cyan">Blend Alpha (Avoidance): ${f(t.blendRatioAlpha)}</div>`;
      html += `<div class="hud-green">Speed: ${f(t.linearVelocity)} m/s</div>`;
      if (t.isEmergency) {
         html += `<div class="hud-red">EMERGENCY ACTIVE</div>`;
      }
    }

    if (t.statusText === 'Finished' && t.finishTime) {
       html += `<div class="hud-green">Finished in ${f(t.finishTime)}s</div>`;
    }

    contentEl.innerHTML = html;
  }

  public clear(): void {
    this.container.innerHTML = '';
    this.cards = {};
  }
}

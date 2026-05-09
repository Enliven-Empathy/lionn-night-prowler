import Phaser from 'phaser';
import { SPIKES } from '../core/constants';

export type SpikePhase = 'closed' | 'opening' | 'open' | 'closing';

const PHASE_DURATIONS_MS: Record<SpikePhase, number> = {
  closed: 1200,
  opening: 280,
  open: 1400,
  closing: 280,
};

const COLOR_BASE = 0x4a3a64;
const COLOR_SPIKE = 0xff6b8a;
const COLOR_SPIKE_TIP = 0xffd4dc;
const SPIKE_PITCH = 18; // px between adjacent spike tips

/**
 * Cyclic ground hazard. Spikes hide flush with the ground (closed),
 * extend over ~280ms (opening), stay extended (open), retract over
 * ~280ms (closing), then loop. The player only takes damage while
 * spikes are open or near-open.
 *
 * Each instance can be spawned with a `phaseOffset` (ms) so multiple
 * spike rows in the same chunk don't all open in lockstep — looks more
 * organic and makes timing more interesting.
 */
export class Spikes {
  readonly container: Phaser.GameObjects.Container;
  readonly worldX: number;
  readonly worldY: number;
  readonly widthPx: number;

  private spikes: Phaser.GameObjects.Triangle[] = [];
  private phase: SpikePhase = 'closed';
  private phaseElapsed = 0;
  private bounds = new Phaser.Geom.Rectangle();

  constructor(scene: Phaser.Scene, x: number, y: number, widthPx: number, phaseOffsetMs = 0) {
    this.worldX = x;
    this.worldY = y;
    this.widthPx = widthPx;

    const c = scene.add.container(x, y);

    // Stone slot the spikes emerge from — sits flush at the ground line.
    const base = scene.add.rectangle(0, 0, widthPx, 8, COLOR_BASE, 1);
    base.setStrokeStyle(2, 0x14091f, 0.95).setOrigin(0.5, 0);
    c.add(base);

    // Build the spike triangles.
    const spikeCount = Math.max(3, Math.floor(widthPx / SPIKE_PITCH));
    const spacing = widthPx / spikeCount;
    const spikeBaseW = spacing * 0.78;
    const spikeH = SPIKES.spikeHeight;

    for (let i = 0; i < spikeCount; i++) {
      const sx = -widthPx / 2 + spacing * (i + 0.5);
      // Triangle: base on ground line (y=0), tip pointing up.
      // Phaser Triangle constructor: scene, x, y, x1, y1, x2, y2, x3, y3, fillColor.
      const t = scene.add.triangle(
        sx, 0,
        -spikeBaseW / 2, 0,
        spikeBaseW / 2, 0,
        0, -spikeH,
        COLOR_SPIKE,
      );
      t.setStrokeStyle(1, COLOR_SPIKE_TIP, 1);
      // Origin at bottom-center so scaleY animates from base — tips grow up.
      t.setOrigin(0.5, 1);
      t.scaleY = 0; // start hidden
      c.add(t);
      this.spikes.push(t);
    }

    c.setDepth(450);
    this.container = c;
    // Start at random spot in the cycle if phaseOffset is given.
    this.advancePhase(phaseOffsetMs);
  }

  /** Advance the cycle by `dtMs`, return true if currently dangerous. */
  update(dtMs: number): boolean {
    this.advancePhase(dtMs);
    return this.isDangerous();
  }

  private advancePhase(dtMs: number): void {
    let remaining = dtMs;
    while (remaining > 0) {
      const phaseDur = PHASE_DURATIONS_MS[this.phase];
      const left = phaseDur - this.phaseElapsed;
      if (remaining < left) {
        this.phaseElapsed += remaining;
        remaining = 0;
      } else {
        remaining -= left;
        this.phaseElapsed = 0;
        this.phase = nextPhase(this.phase);
      }
    }

    const phaseDur = PHASE_DURATIONS_MS[this.phase];
    const t = this.phaseElapsed / phaseDur;
    let scaleY = 0;
    switch (this.phase) {
      case 'closed':  scaleY = 0; break;
      case 'opening': scaleY = t; break;
      case 'open':    scaleY = 1; break;
      case 'closing': scaleY = 1 - t; break;
    }
    for (const s of this.spikes) s.scaleY = scaleY;
  }

  /**
   * True for the bulk of the open phase plus the back half of opening —
   * gives the player a tiny grace period at the very start of opening.
   */
  isDangerous(): boolean {
    if (this.phase === 'open') return true;
    if (this.phase === 'opening' && this.phaseElapsed > PHASE_DURATIONS_MS.opening * 0.4) return true;
    return false;
  }

  /** AABB hit-rect for player overlap test. */
  hitRect(): Phaser.Geom.Rectangle {
    const halfW = this.widthPx / 2;
    const h = SPIKES.spikeHeight + 4;
    this.bounds.setTo(this.worldX - halfW, this.worldY - h, this.widthPx, h);
    return this.bounds;
  }

  destroy(): void {
    this.container.destroy();
  }
}

function nextPhase(p: SpikePhase): SpikePhase {
  switch (p) {
    case 'closed':  return 'opening';
    case 'opening': return 'open';
    case 'open':    return 'closing';
    case 'closing': return 'closed';
  }
}

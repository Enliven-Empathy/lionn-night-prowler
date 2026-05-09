import Phaser from 'phaser';
import { OVERHANG } from '../core/constants';

const COLOR_BASE = 0x4a3a64;
const COLOR_SPIKE = 0xff8caf;
const COLOR_SPIKE_TIP = 0xffd4dc;
const SPIKE_PITCH = 18;

/**
 * Static overhead obstacle: a stone bar with downward spikes that hangs
 * just above standing height. Standing players get hit on contact; a
 * crouched player (smaller body) clears it cleanly.
 *
 * Doesn't move, doesn't cycle — pure positional puzzle. AABB damage check
 * runs in GameScene.update.
 */
export class Overhang {
  readonly container: Phaser.GameObjects.Container;
  readonly worldX: number;
  /** Y of the BOTTOM edge — what the standing-vs-crouching test compares against. */
  readonly bottomY: number;
  readonly widthPx: number;

  private bounds = new Phaser.Geom.Rectangle();
  private heightPx: number;

  constructor(scene: Phaser.Scene, x: number, bottomY: number, widthPx: number) {
    this.worldX = x;
    this.bottomY = bottomY;
    this.widthPx = widthPx;
    this.heightPx = OVERHANG.height;

    const c = scene.add.container(x, bottomY);

    // Stone bar at the top — visual ceiling.
    const barH = 10;
    const bar = scene.add.rectangle(0, -this.heightPx + barH / 2, widthPx, barH, COLOR_BASE);
    bar.setStrokeStyle(2, 0x14091f, 0.95);
    c.add(bar);

    // Downward spikes hanging from the bar.
    const spikeCount = Math.max(3, Math.floor(widthPx / SPIKE_PITCH));
    const spacing = widthPx / spikeCount;
    const spikeBaseW = spacing * 0.78;
    const spikeH = this.heightPx - barH;
    for (let i = 0; i < spikeCount; i++) {
      const sx = -widthPx / 2 + spacing * (i + 0.5);
      // Triangle: base at top (just below the stone bar), tip pointing DOWN.
      const t = scene.add.triangle(
        sx, -spikeH / 2 + barH / 2,
        -spikeBaseW / 2, -spikeH / 2,
        spikeBaseW / 2, -spikeH / 2,
        0, spikeH / 2,
        COLOR_SPIKE,
      );
      t.setStrokeStyle(1, COLOR_SPIKE_TIP, 1);
      c.add(t);
    }

    c.setDepth(450);
    this.container = c;
  }

  /** AABB hit-rect spanning the spike row. Player overlap test compares
   *  against this. Crouched players whose body top is below `bottomY` will
   *  not overlap. */
  hitRect(): Phaser.Geom.Rectangle {
    const halfW = this.widthPx / 2;
    this.bounds.setTo(
      this.worldX - halfW,
      this.bottomY - this.heightPx,
      this.widthPx,
      this.heightPx,
    );
    return this.bounds;
  }

  destroy(): void {
    this.container.destroy();
  }
}

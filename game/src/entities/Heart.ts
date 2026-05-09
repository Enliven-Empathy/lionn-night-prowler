import Phaser from 'phaser';

/**
 * Heart pickup. Restores HP when collected. Visually a red ♥ glyph with
 * a soft pulsing halo behind it (uses Phaser Text — far less code than
 * composing a heart out of circles + triangles, and renders crisply at
 * any scale because it's vector text).
 *
 * Uncollected hearts bob gently and pulse in scale to draw the eye even
 * at the periphery while the player is running.
 */
export class Heart {
  readonly container: Phaser.GameObjects.Container;
  readonly healAmount: number;
  collected = false;

  private baseY: number;
  private bounds = new Phaser.Geom.Rectangle();
  private halo: Phaser.GameObjects.Arc;
  private glyph: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, x: number, y: number, healAmount = 2) {
    this.healAmount = healAmount;
    this.baseY = y;

    const c = scene.add.container(x, y);

    this.halo = scene.add.circle(0, 0, 20, 0xff5b8a, 0.22);
    this.halo.setBlendMode(Phaser.BlendModes.ADD);

    this.glyph = scene.add.text(0, 0, '♥', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '30px',
      color: '#ff5b8a',
      stroke: '#ffe5ee',
      strokeThickness: 2,
    });
    this.glyph.setOrigin(0.5, 0.5);
    this.glyph.setShadow(0, 2, '#7a1f33', 4, true, true);

    c.add([this.halo, this.glyph]);
    c.setDepth(500);

    this.container = c;
  }

  update(timeMs: number): void {
    if (this.collected) return;
    const t = timeMs / 1000;
    this.container.y = this.baseY + Math.sin(t * 1.6) * 4;
    const pulse = 1 + 0.08 * Math.sin(t * 3.2);
    this.glyph.setScale(pulse);
    this.halo.setScale(1 + 0.18 * Math.sin(t * 2.4));
  }

  hitRect(): Phaser.Geom.Rectangle {
    const halfW = 20;
    const halfH = 20;
    this.bounds.setTo(this.container.x - halfW, this.container.y - halfH, halfW * 2, halfH * 2);
    return this.bounds;
  }

  collect(): void {
    if (this.collected) return;
    this.collected = true;
    const scene = this.container.scene;
    scene.tweens.add({
      targets: this.container,
      scale: 2.2,
      alpha: 0,
      duration: 260,
      ease: 'Quad.easeOut',
      onComplete: () => this.container.destroy(),
    });
  }

  destroy(): void {
    this.container.destroy();
  }
}

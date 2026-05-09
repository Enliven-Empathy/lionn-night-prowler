import Phaser from 'phaser';

export type CollectibleTier = 1 | 2 | 3;

export const TIER_VALUES: Record<CollectibleTier, number> = { 1: 1, 2: 3, 3: 8 };

interface TierStyle {
  color: number;
  innerColor: number;
  size: number;
  shape: 'circle' | 'diamond' | 'orb';
  bobAmplitude: number;
  bobSpeed: number;
  pulseSpeed: number;
}

const STYLES: Record<CollectibleTier, TierStyle> = {
  1: { color: 0xd4af37, innerColor: 0xfff0a8, size: 8,  shape: 'circle',  bobAmplitude: 3, bobSpeed: 2.4, pulseSpeed: 0 },
  2: { color: 0x9b59ff, innerColor: 0xd4baff, size: 13, shape: 'diamond', bobAmplitude: 6, bobSpeed: 1.8, pulseSpeed: 3 },
  3: { color: 0x4dd0ff, innerColor: 0xffffff, size: 14, shape: 'orb',     bobAmplitude: 8, bobSpeed: 1.4, pulseSpeed: 4 },
};

/**
 * A pickup. Three tiers map to skill thresholds:
 *   tier 1 (gold) — on the path, just run through
 *   tier 2 (violet) — single/double jump required
 *   tier 3 (cyan) — wall-cling + wall-jump required
 *
 * Visuals are pure primitives: a stroked shape with a brighter inner core,
 * gentle bobbing, and a pulse halo on higher tiers. No physics body — pickup
 * is detected by rectangle-rectangle overlap against the player body.
 */
export class Collectible {
  readonly tier: CollectibleTier;
  readonly value: number;
  readonly container: Phaser.GameObjects.Container;
  collected = false;

  private baseY: number;
  private style: TierStyle;
  private bounds = new Phaser.Geom.Rectangle();
  private halo: Phaser.GameObjects.Arc | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number, tier: CollectibleTier) {
    this.tier = tier;
    this.value = TIER_VALUES[tier];
    this.style = STYLES[tier];
    this.baseY = y;

    const c = scene.add.container(x, y);

    if (this.style.pulseSpeed > 0) {
      this.halo = scene.add.circle(0, 0, this.style.size * 1.6, this.style.color, 0.18);
      this.halo.setBlendMode(Phaser.BlendModes.ADD);
      c.add(this.halo);
    }

    const outerColor = this.style.color;
    const innerColor = this.style.innerColor;
    const s = this.style.size;

    if (this.style.shape === 'circle') {
      const ring = scene.add.circle(0, 0, s, outerColor, 1);
      ring.setStrokeStyle(2, 0xffe999, 0.9);
      const core = scene.add.circle(0, 0, s * 0.5, innerColor, 1);
      core.setBlendMode(Phaser.BlendModes.ADD);
      c.add(ring); c.add(core);
    } else if (this.style.shape === 'diamond') {
      const r = scene.add.rectangle(0, 0, s, s, outerColor, 1);
      r.setStrokeStyle(2, 0xefd3ff, 0.95);
      r.setRotation(Math.PI / 4);
      const core = scene.add.rectangle(0, 0, s * 0.5, s * 0.5, innerColor, 1);
      core.setRotation(Math.PI / 4).setBlendMode(Phaser.BlendModes.ADD);
      c.add(r); c.add(core);
    } else {
      // orb: outer ring + inner core + cross-glow
      const ring = scene.add.circle(0, 0, s, outerColor, 1);
      ring.setStrokeStyle(2, 0xc0ecff, 0.95);
      const core = scene.add.circle(0, 0, s * 0.45, innerColor, 1);
      core.setBlendMode(Phaser.BlendModes.ADD);
      const v = scene.add.rectangle(0, 0, 3, s * 1.4, innerColor, 0.8);
      const h = scene.add.rectangle(0, 0, s * 1.4, 3, innerColor, 0.8);
      v.setBlendMode(Phaser.BlendModes.ADD);
      h.setBlendMode(Phaser.BlendModes.ADD);
      c.add(ring); c.add(core); c.add(v); c.add(h);
    }

    c.setDepth(500);
    this.container = c;
  }

  update(timeMs: number): void {
    if (this.collected) return;
    const t = timeMs / 1000;
    this.container.y = this.baseY + Math.sin(t * this.style.bobSpeed) * this.style.bobAmplitude;
    if (this.halo) {
      const pulse = 1 + 0.25 * Math.sin(t * this.style.pulseSpeed);
      this.halo.setScale(pulse);
    }
  }

  /** AABB hit-rect in world space, centered on the container. */
  hitRect(): Phaser.Geom.Rectangle {
    const halfW = this.style.size * 1.4;
    const halfH = this.style.size * 1.4;
    this.bounds.setTo(
      this.container.x - halfW,
      this.container.y - halfH,
      halfW * 2,
      halfH * 2,
    );
    return this.bounds;
  }

  /** Play pickup animation, then destroy. Caller is responsible for score side-effects. */
  collect(): void {
    if (this.collected) return;
    this.collected = true;
    const scene = this.container.scene;
    scene.tweens.add({
      targets: this.container,
      scale: 1.8,
      alpha: 0,
      duration: 220,
      ease: 'Quad.easeOut',
      onComplete: () => this.container.destroy(),
    });
  }

  destroy(): void {
    this.container.destroy();
  }
}

import Phaser from 'phaser';

/**
 * Player HP bar rendered to the HUD. Color states:
 *   > 50%  — green
 *   > 25%  — gold
 *   ≤ 25%  — red, with a slow scale pulse for "danger"
 *
 * Implementation notes:
 *   - The fill rect is a fixed-width rectangle scaled along X (origin 0,0.5).
 *     Animating `scaleX` is more reliable than animating `width` on Phaser
 *     shape objects, which sometimes don't re-render width changes mid-tween.
 *   - On HP drop, we flash a white overlay rect over the fill so the player
 *     gets unmistakable damage feedback even if the green/gold tween itself
 *     is subtle (e.g., 1 HP loss out of 10).
 */
const BAR_W = 220;
const BAR_H = 18;
const FILL_W = BAR_W - 4;
const FILL_H = BAR_H - 4;
const BORDER = 0x9b80d9;
const BG = 0x1a1228;

const COLOR_FULL = 0x6dffa3;
const COLOR_MID = 0xd4af37;
const COLOR_LOW = 0xff5b8a;

export class HealthBar {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Rectangle;
  private fill: Phaser.GameObjects.Rectangle;
  private flash: Phaser.GameObjects.Rectangle;
  private label: Phaser.GameObjects.Text;
  private pulseTween: Phaser.Tweens.Tween | null = null;
  private scaleTween: Phaser.Tweens.Tween | null = null;
  private flashTween: Phaser.Tweens.Tween | null = null;
  private lastRatio = 1;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.scene = scene;
    this.container = scene.add.container(x, y);
    this.container.setScrollFactor(0).setDepth(1100);

    this.bg = scene.add.rectangle(0, 0, BAR_W, BAR_H, BG, 0.92);
    this.bg.setStrokeStyle(2, BORDER, 0.95).setOrigin(0, 0.5);

    this.fill = scene.add.rectangle(2, 0, FILL_W, FILL_H, COLOR_FULL, 1);
    this.fill.setOrigin(0, 0.5);
    this.fill.scaleX = 1; // ratio carrier; geom width stays FILL_W

    this.flash = scene.add.rectangle(2, 0, FILL_W, FILL_H, 0xffffff, 0);
    this.flash.setOrigin(0, 0.5).setBlendMode(Phaser.BlendModes.ADD);

    this.label = scene.add.text(BAR_W + 10, 0, 'HP', {
      fontFamily: 'Cinzel, Georgia, serif',
      fontSize: '14px',
      color: '#c4b8e8',
      stroke: '#0b0816',
      strokeThickness: 3,
    });
    this.label.setOrigin(0, 0.5);

    this.container.add([this.bg, this.fill, this.flash, this.label]);
  }

  set(current: number, max: number): void {
    const ratio = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
    // Bail if nothing meaningful changed — set() is called every frame from
    // the scene loop, and re-spawning a tween every frame freezes it at the
    // start. We only animate on genuine HP changes.
    if (Math.abs(ratio - this.lastRatio) < 0.001) return;

    const took = ratio < this.lastRatio;
    const targetColor = ratio > 0.5 ? COLOR_FULL : ratio > 0.25 ? COLOR_MID : COLOR_LOW;

    this.scaleTween?.stop();
    this.scaleTween = this.scene.tweens.add({
      targets: this.fill,
      scaleX: ratio,
      duration: 180,
      ease: 'Quad.easeOut',
    });
    this.fill.setFillStyle(targetColor);
    this.label.setText(`HP  ${current} / ${max}`);

    if (took) this.flashHit();

    if (ratio > 0 && ratio <= 0.25) this.startDangerPulse();
    else this.stopDangerPulse();

    this.lastRatio = ratio;
  }

  private flashHit(): void {
    this.flashTween?.stop();
    this.flash.alpha = 0.85;
    // Match the flash to the *current* fill ratio so it doesn't extend past it.
    this.flash.scaleX = Math.max(0.05, this.fill.scaleX);
    this.flashTween = this.scene.tweens.add({
      targets: this.flash,
      alpha: 0,
      duration: 260,
      ease: 'Quad.easeOut',
    });
  }

  private startDangerPulse(): void {
    if (this.pulseTween) return;
    this.pulseTween = this.scene.tweens.add({
      targets: this.container,
      scaleX: 1.04,
      scaleY: 1.04,
      yoyo: true,
      repeat: -1,
      duration: 380,
      ease: 'Sine.easeInOut',
    });
  }

  private stopDangerPulse(): void {
    if (!this.pulseTween) return;
    this.pulseTween.stop();
    this.pulseTween = null;
    this.container.setScale(1);
  }

  destroy(): void {
    this.scaleTween?.stop();
    this.flashTween?.stop();
    this.pulseTween?.stop();
    this.container.destroy();
  }
}

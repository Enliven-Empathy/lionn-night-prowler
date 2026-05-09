import Phaser from 'phaser';

/**
 * Player health bar rendered to the HUD. Color states:
 *   > 50%  — green
 *   > 25%  — gold
 *   ≤ 25%  — red, with a slow pulse to read as "danger"
 *
 * Bar fill smoothly tweens to its new value when HP changes; the bar's
 * width tween is killed and restarted to avoid lag-stacking on rapid hits.
 */
const BAR_W = 220;
const BAR_H = 18;
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
  private label: Phaser.GameObjects.Text;
  private pulseTween: Phaser.Tweens.Tween | null = null;
  private fillTween: Phaser.Tweens.Tween | null = null;
  private lastRatio = 1;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.scene = scene;
    this.container = scene.add.container(x, y);
    this.container.setScrollFactor(0).setDepth(1100);

    this.bg = scene.add.rectangle(0, 0, BAR_W, BAR_H, BG, 0.92);
    this.bg.setStrokeStyle(2, BORDER, 0.95).setOrigin(0, 0.5);
    this.fill = scene.add.rectangle(2, 0, BAR_W - 4, BAR_H - 4, COLOR_FULL, 1);
    this.fill.setOrigin(0, 0.5);
    this.label = scene.add.text(BAR_W + 10, 0, 'HP', {
      fontFamily: 'Cinzel, Georgia, serif',
      fontSize: '14px',
      color: '#c4b8e8',
      stroke: '#0b0816',
      strokeThickness: 3,
    });
    this.label.setOrigin(0, 0.5);

    this.container.add([this.bg, this.fill, this.label]);
  }

  set(current: number, max: number): void {
    const ratio = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
    const targetW = (BAR_W - 4) * ratio;
    const targetColor = ratio > 0.5 ? COLOR_FULL : ratio > 0.25 ? COLOR_MID : COLOR_LOW;

    // Width tween — restart per change so rapid hits don't queue up.
    this.fillTween?.stop();
    this.fillTween = this.scene.tweens.add({
      targets: this.fill,
      width: targetW,
      duration: 220,
      ease: 'Quad.easeOut',
    });
    this.fill.setFillStyle(targetColor);
    this.label.setText(`HP  ${current} / ${max}`);

    // Danger pulse engages at low HP, releases when not.
    if (ratio > 0 && ratio <= 0.25) {
      this.startDangerPulse();
    } else {
      this.stopDangerPulse();
    }

    this.lastRatio = ratio;
  }

  private startDangerPulse(): void {
    if (this.pulseTween) return;
    this.pulseTween = this.scene.tweens.add({
      targets: this.bg,
      strokeAlpha: 0.4,
      yoyo: true,
      repeat: -1,
      duration: 380,
      ease: 'Sine.easeInOut',
    });
    // Phaser doesn't expose strokeAlpha as a tweenable, so animate scale instead.
    this.pulseTween.stop();
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
    this.fillTween?.stop();
    this.pulseTween?.stop();
    this.container.destroy();
    void this.lastRatio;
  }
}

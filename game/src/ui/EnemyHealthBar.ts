import Phaser from 'phaser';

/**
 * Compact health bar that floats above an enemy. Hidden when at full HP;
 * shown the instant the enemy is damaged, and stays visible for as long
 * as the enemy is alive and damaged. Auto-shifts color from pink to red.
 */
const BAR_W = 44;
const BAR_H = 5;
const OFFSET_Y = -10; // distance above the body's TOP edge
const BG = 0x14091f;
const BORDER = 0x9b80d9;

const COLOR_HIGH = 0xff8caf;
const COLOR_LOW = 0xff3a55;

export class EnemyHealthBar {
  private container: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Rectangle;
  private fill: Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene) {
    this.container = scene.add.container(0, 0);
    this.container.setDepth(910).setVisible(false);

    this.bg = scene.add.rectangle(0, 0, BAR_W, BAR_H, BG, 0.95);
    this.bg.setStrokeStyle(1, BORDER, 0.85).setOrigin(0.5, 0.5);
    this.fill = scene.add.rectangle(-(BAR_W / 2) + 1, 0, BAR_W - 2, BAR_H - 2, COLOR_HIGH, 1);
    this.fill.setOrigin(0, 0.5);

    this.container.add([this.bg, this.fill]);
  }

  /**
   * Update the bar to reflect an entity's current HP and follow its sprite.
   * Bar is positioned `OFFSET_Y` px above the sprite's top edge.
   */
  update(sprite: Phaser.GameObjects.Rectangle, current: number, max: number): void {
    if (current >= max || current <= 0) {
      this.container.setVisible(false);
      return;
    }
    this.container.setVisible(true);
    this.container.x = sprite.x;
    this.container.y = sprite.y - sprite.height / 2 + OFFSET_Y;

    const ratio = Math.max(0, Math.min(1, current / max));
    this.fill.width = (BAR_W - 2) * ratio;
    this.fill.setFillStyle(ratio > 0.4 ? COLOR_HIGH : COLOR_LOW);
  }

  destroy(): void {
    this.container.destroy();
  }
}

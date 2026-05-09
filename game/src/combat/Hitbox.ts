import Phaser from 'phaser';
import { AttackData, Team } from './types';

export class Hitbox {
  team: Team;
  active = false;
  data: AttackData | null = null;
  /** Hurtbox owner ids already hit by the *current* activation. */
  hitTargets = new Set<number>();

  ownerX = 0;
  ownerY = 0;
  facing: 1 | -1 = 1;

  private rect = new Phaser.Geom.Rectangle();
  private debugRect?: Phaser.GameObjects.Rectangle;
  private scene: Phaser.Scene;

  constructor(scene: Phaser.Scene, team: Team) {
    this.team = team;
    this.scene = scene;
  }

  activate(data: AttackData): void {
    this.data = data;
    this.active = true;
    this.hitTargets.clear();
  }

  deactivate(): void {
    this.active = false;
    this.data = null;
    this.hitTargets.clear();
    this.hideDebug();
  }

  setOrigin(x: number, y: number, facing: 1 | -1): void {
    this.ownerX = x;
    this.ownerY = y;
    this.facing = facing;
  }

  worldRect(): Phaser.Geom.Rectangle {
    if (!this.data) {
      this.rect.setTo(0, 0, 0, 0);
      return this.rect;
    }
    const { offsetX, offsetY, w, h } = this.data.hitbox;
    const cx = this.ownerX + offsetX * this.facing;
    const cy = this.ownerY + offsetY;
    this.rect.setTo(cx - w / 2, cy - h / 2, w, h);
    return this.rect;
  }

  alreadyHit(targetId: number): boolean {
    return this.hitTargets.has(targetId);
  }

  markHit(targetId: number): void {
    this.hitTargets.add(targetId);
  }

  setDebugVisible(visible: boolean): void {
    if (visible && !this.debugRect) {
      this.debugRect = this.scene.add.rectangle(0, 0, 1, 1, this.team === 'player' ? 0xff4488 : 0x44aaff, 0.32);
      this.debugRect.setStrokeStyle(1, this.team === 'player' ? 0xff77aa : 0x77c0ff, 0.85);
      this.debugRect.setDepth(950);
    }
    if (!visible && this.debugRect) {
      this.debugRect.destroy();
      this.debugRect = undefined;
    }
  }

  drawDebug(): void {
    if (!this.debugRect) return;
    if (!this.active) {
      this.debugRect.setVisible(false);
      return;
    }
    const r = this.worldRect();
    this.debugRect.setVisible(true);
    this.debugRect.setPosition(r.x + r.width / 2, r.y + r.height / 2);
    this.debugRect.setSize(r.width, r.height);
  }

  private hideDebug(): void {
    this.debugRect?.setVisible(false);
  }
}

import Phaser from 'phaser';
import { AttackData, Team } from './types';
import { HITBOX_SIZE_SCALE_DAMPING } from '../core/constants';

export class Hitbox {
  team: Team;
  active = false;
  data: AttackData | null = null;
  /** Hurtbox owner ids already hit by the *current* activation. */
  hitTargets = new Set<number>();

  ownerX = 0;
  ownerY = 0;
  facing: 1 | -1 = 1;
  /**
   * Uniform multiplier applied to the attack's authored hitbox offsets
   * and dimensions. Defaults to 1 (every attack is authored against the
   * base 46×70 body).
   *
   * Bosses render at 1.5×–2.0× but were swinging their authored 1.0×
   * boxes, so the Night Sovereign's 104×80 reach looked far shorter than
   * its 92×140 silhouette implied and swings appeared to pass straight
   * through the player. Patrol sets this from `bossDef.scale`.
   */
  scale = 1;

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
    // Offset scales fully — on a bigger body the swing genuinely starts
    // further from centre. SIZE is damped, because scaling the sweep by
    // the full body scale makes a large boss's danger zone absurd: the
    // Night Sovereign at 2.0× reached 192 px, while a running player who
    // also dashes can only clear 187 px inside its wind-up. That is an
    // unavoidable hit — the attack could not be escaped at all.
    // Damping to 0.6 keeps big bosses feeling weighty and long-reaching
    // while leaving every attack physically evadable.
    const s = this.scale;
    const sizeScale = 1 + (s - 1) * HITBOX_SIZE_SCALE_DAMPING;
    const cx = this.ownerX + offsetX * s * this.facing;
    const cy = this.ownerY + offsetY * s;
    const sw = w * sizeScale;
    const sh = h * sizeScale;
    this.rect.setTo(cx - sw / 2, cy - sh / 2, sw, sh);
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

import Phaser from 'phaser';
import { DamageSystem } from '../combat/DamageSystem';
import { Combatant, DamageEvent } from '../combat/types';
import { HitFx } from '../fx/HitFx';

const FILL = 0x4a3d6a;
const FILL_HURT = 0xff8caf;
const FILL_DEAD = 0x1e1729;
const SIZE = { w: 50, h: 78 };

export class Dummy {
  readonly sprite: Phaser.GameObjects.Rectangle;
  readonly body: Phaser.Physics.Arcade.Body;
  hp = 4;
  maxHp = 4;

  combatant!: Combatant;
  private flashUntil = 0;
  private hurtRect = new Phaser.Geom.Rectangle();
  private fx: HitFx;
  private damage: DamageSystem;

  constructor(scene: Phaser.Scene, x: number, y: number, damage: DamageSystem, fx: HitFx) {
    this.sprite = scene.add.rectangle(x, y, SIZE.w, SIZE.h, FILL);
    this.sprite.setStrokeStyle(2, 0x6b3fb8, 0.9);
    scene.physics.add.existing(this.sprite);
    this.body = this.sprite.body as Phaser.Physics.Arcade.Body;
    this.body.setSize(SIZE.w, SIZE.h);
    this.body.setCollideWorldBounds(true);
    this.body.setMaxVelocity(700, 1400);

    this.fx = fx;
    this.damage = damage;
    this.combatant = damage.register({
      team: 'enemy',
      hurtbox: () => (this.hp > 0 ? this.computeHurtbox() : null),
      takeDamage: (e, t) => this.takeDamage(e, t),
      isAlive: () => this.hp > 0,
    });
  }

  private computeHurtbox(): Phaser.Geom.Rectangle {
    this.hurtRect.setTo(this.body.x, this.body.y, this.body.width, this.body.height);
    return this.hurtRect;
  }

  takeDamage(event: DamageEvent, timeMs: number): void {
    if (this.hp <= 0) return;
    this.hp = Math.max(0, this.hp - event.damage);
    this.flashUntil = timeMs + 120;

    const dir = this.body.center.x < event.fromX ? -1 : 1;
    this.body.setVelocityX(event.knockbackX * dir);
    this.body.setVelocityY(event.knockbackY);

    this.fx.hitPause(event.hitstopMs, timeMs);
    this.fx.shake(80, 0.006);

    if (this.hp === 0) {
      this.body.setAllowGravity(true);
      this.body.setVelocityX(event.knockbackX * dir * 0.4);
      this.body.setVelocityY(-260);
      this.sprite.fillColor = FILL_DEAD;
      this.sprite.alpha = 0.7;
      this.sprite.scene.tweens.add({
        targets: this.sprite,
        angle: dir * 70,
        duration: 600,
        ease: 'Quad.easeOut',
      });
    }
  }

  update(timeMs: number): void {
    if (this.hp > 0) {
      this.sprite.fillColor = timeMs < this.flashUntil ? FILL_HURT : FILL;
    }
    // Settle vx friction when grounded
    if ((this.body.blocked.down || this.body.touching.down) && this.hp > 0) {
      this.body.setVelocityX(this.body.velocity.x * 0.85);
    }
  }

  destroy(): void {
    this.damage.unregister(this.combatant.id);
    this.sprite.destroy();
  }

  hpRatio(): number {
    return this.hp / this.maxHp;
  }
}

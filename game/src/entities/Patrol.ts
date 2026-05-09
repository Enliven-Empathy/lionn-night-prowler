import Phaser from 'phaser';
import { DamageSystem } from '../combat/DamageSystem';
import { Combatant, DamageEvent } from '../combat/types';
import { ATTACKS } from '../combat/attacks';
import { AttackState } from '../combat/AttackState';
import { Hitbox } from '../combat/Hitbox';
import { HitFx } from '../fx/HitFx';
import { AttackFx } from '../fx/AttackFx';
import { EnemyHealthBar } from '../ui/EnemyHealthBar';

const SIZE = { w: 46, h: 70 };
const FILL_PATROL = 0x3a2a55;
const FILL_CHASE = 0x5a3a85;
const FILL_HURT = 0xff8caf;
const FILL_DEAD = 0x140a1f;
const STROKE = 0x9b59ff;

const DETECT_X = 280;
const DETECT_Y = 120;
const ATTACK_X = 56;
const ATTACK_Y = 44;
const PATROL_SPEED = 90;
const CHASE_SPEED = 170;
const KNOCKBACK_RESIST = 0.55;

type AIState = 'patrol' | 'chase' | 'attack' | 'hurt' | 'dead';

/**
 * Basic patrol enemy. Walks back and forth across a fixed x-range until
 * it sees the player; then it chases. When close enough it lunges using a
 * crescent slash. Takes damage, knocks back, and dies on hp=0.
 *
 * Designed to be cheap (no nav graph, no pathfinding) and readable
 * (telegraphed attacks, predictable patrol).
 */
export class Patrol {
  readonly sprite: Phaser.GameObjects.Rectangle;
  readonly body: Phaser.Physics.Arcade.Body;
  readonly attack: AttackState;
  readonly hitbox: Hitbox;
  combatant!: Combatant;

  hp = 3;
  maxHp = 3;
  facing: 1 | -1 = -1;

  private aiState: AIState = 'patrol';
  private xMin: number;
  private xMax: number;
  private flashUntil = 0;
  private hurtUntil = 0;
  private nextThinkAt = 0;

  private damage: DamageSystem;
  private fx: HitFx;
  private attackFx: AttackFx;
  private healthBar: EnemyHealthBar;
  private cancelLunge: (() => void) | null = null;
  private hurtRect = new Phaser.Geom.Rectangle();

  /**
   * @param xMin / xMax — patrol bounds (world coords). Should sit on a single
   * walkable ground segment. The patrol clamps its body to this range so it
   * never walks off a ledge.
   */
  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    xMin: number,
    xMax: number,
    damage: DamageSystem,
    fx: HitFx,
  ) {
    this.sprite = scene.add.rectangle(x, y, SIZE.w, SIZE.h, FILL_PATROL);
    this.sprite.setStrokeStyle(2, STROKE, 0.85);
    scene.physics.add.existing(this.sprite);
    this.body = this.sprite.body as Phaser.Physics.Arcade.Body;
    this.body.setSize(SIZE.w, SIZE.h);
    this.body.setMaxVelocity(560, 1400);
    this.body.setCollideWorldBounds(false);

    this.attack = new AttackState();
    this.hitbox = new Hitbox(scene, 'enemy');

    this.xMin = xMin;
    this.xMax = xMax;
    this.damage = damage;
    this.fx = fx;
    this.attackFx = new AttackFx(scene);
    this.healthBar = new EnemyHealthBar(scene);

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

  update(timeMs: number, dtSec: number, target: { x: number; y: number; alive: boolean }): void {
    void dtSec;
    // Update overhead health bar regardless of state — auto-hides at full HP.
    this.healthBar.update(this.sprite, this.hp, this.maxHp);

    if (this.hp <= 0) {
      // Settle: fall + horizontal friction. World takes care of the body.
      this.sprite.fillColor = FILL_DEAD;
      return;
    }

    if (timeMs < this.hurtUntil) {
      // Stunned by recent hit; physics carries the knockback.
      this.aiState = 'hurt';
      this.sprite.fillColor = timeMs < this.flashUntil ? FILL_HURT : FILL_PATROL;
      this.maybeUpdateAttack(timeMs);
      return;
    }

    // Color tint reflects state.
    const isChasing = this.aiState === 'chase' || this.aiState === 'attack';
    this.sprite.fillColor =
      timeMs < this.flashUntil ? FILL_HURT :
      isChasing ? FILL_CHASE :
      FILL_PATROL;

    const seesPlayer =
      target.alive &&
      Math.abs(target.x - this.sprite.x) < DETECT_X &&
      Math.abs(target.y - this.sprite.y) < DETECT_Y;

    const inAttackRange =
      target.alive &&
      Math.abs(target.x - this.sprite.x) < ATTACK_X &&
      Math.abs(target.y - this.sprite.y) < ATTACK_Y;

    // Mid-attack: do nothing else this tick — let the attack timeline play.
    if (this.attack.isAttacking()) {
      this.body.setVelocityX(this.body.velocity.x * 0.85);
      this.maybeUpdateAttack(timeMs);
      this.aiState = 'attack';
      return;
    }

    if (seesPlayer) {
      this.aiState = 'chase';
      // Face the player.
      this.facing = target.x < this.sprite.x ? -1 : 1;

      if (inAttackRange) {
        // Lunge. Use the player's claw_2 stats — feels like a real combat exchange.
        const a = ATTACKS.claw_2;
        this.attack.start(a, timeMs);
        this.cancelLunge?.();
        this.attackFx.telegraph(this.sprite, a.startupMs, 'enemy');
        this.cancelLunge = this.attackFx.lunge(this.sprite, a, this.facing);
        this.aiState = 'attack';
        this.body.setVelocityX(this.facing * 60); // slight forward drift
      } else {
        // Chase but stay within patrol bounds (don't walk off ledge).
        const targetVx =
          this.facing === 1 && this.sprite.x < this.xMax - 10 ? CHASE_SPEED :
          this.facing === -1 && this.sprite.x > this.xMin + 10 ? -CHASE_SPEED :
          0;
        this.body.setVelocityX(targetVx);
      }
    } else {
      // Patrol back and forth between bounds.
      this.aiState = 'patrol';
      if (this.sprite.x >= this.xMax - 6) this.facing = -1;
      else if (this.sprite.x <= this.xMin + 6) this.facing = 1;
      this.body.setVelocityX(this.facing * PATROL_SPEED);
    }

    this.maybeUpdateAttack(timeMs);
    void this.nextThinkAt; // reserved for future stateful AI work
  }

  private maybeUpdateAttack(timeMs: number): void {
    const events = this.attack.update(timeMs);
    for (const e of events) {
      if (e.kind === 'activeStart') {
        this.hitbox.activate(e.attack);
        this.attackFx.slash(this.sprite.x, this.sprite.y, this.facing, e.attack, 'enemy');
      } else if (e.kind === 'activeEnd') {
        this.hitbox.deactivate();
      }
    }
    if (this.hitbox.active) {
      this.hitbox.setOrigin(this.sprite.x, this.sprite.y, this.facing);
      this.damage.testHitbox(this.hitbox, timeMs);
    }
    this.hitbox.drawDebug();
  }

  takeDamage(event: DamageEvent, timeMs: number): void {
    if (this.hp <= 0) return;
    this.hp = Math.max(0, this.hp - event.damage);
    this.flashUntil = timeMs + 110;
    this.hurtUntil = timeMs + 220;
    this.attack.cancel();
    this.hitbox.deactivate();
    this.cancelLunge?.();
    this.cancelLunge = null;

    const dir = this.body.center.x < event.fromX ? -1 : 1;
    this.body.setVelocityX(event.knockbackX * dir * KNOCKBACK_RESIST);
    this.body.setVelocityY(event.knockbackY * KNOCKBACK_RESIST);

    this.fx.hitPause(event.hitstopMs, timeMs);
    this.fx.shake(80, 0.006);

    if (this.hp === 0) {
      this.aiState = 'dead';
      this.body.setAllowGravity(true);
      this.body.setVelocityY(-220);
      this.sprite.alpha = 0.7;
      this.sprite.scene.tweens.add({
        targets: this.sprite,
        angle: dir * 80,
        duration: 600,
        ease: 'Quad.easeOut',
      });
    }
  }

  setDebugHitboxes(visible: boolean): void {
    this.hitbox.setDebugVisible(visible);
  }

  destroy(): void {
    this.damage.unregister(this.combatant.id);
    this.healthBar.destroy();
    this.sprite.destroy();
  }
}

import Phaser from 'phaser';
import { DamageSystem } from '../combat/DamageSystem';
import { Combatant, DamageEvent } from '../combat/types';
import { ATTACKS } from '../combat/attacks';
import { GRAVITY } from '../core/constants';
import { AttackState } from '../combat/AttackState';
import { Hitbox } from '../combat/Hitbox';
import { HitFx } from '../fx/HitFx';
import { AttackFx } from '../fx/AttackFx';
import { EnemyHealthBar } from '../ui/EnemyHealthBar';
import { AudioManager } from '../audio/AudioManager';
import { SFX } from '../audio/Sfx';

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

type AIState = 'patrol' | 'chase' | 'attack' | 'hurt' | 'dead' | 'grabbed' | 'thrown';

const THROW_DURATION_MS = 800;
const THROW_DAMAGE = 2;

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
  private thrownUntilMs = 0;
  /** Per-throw set of patrol IDs already damaged by this projectile, so a
   *  thrown body can't multi-hit the same target while passing through. */
  private thrownAlreadyHit = new Set<number>();
  private xMin: number;
  private xMax: number;
  private flashUntil = 0;
  private hurtUntil = 0;
  private nextThinkAt = 0;

  private damage: DamageSystem;
  private fx: HitFx;
  private attackFx: AttackFx;
  private healthBar: EnemyHealthBar;
  private audio: AudioManager;
  private cancelLunge: (() => void) | null = null;
  private hurtRect = new Phaser.Geom.Rectangle();
  private prevAiState: AIState = 'patrol';

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
    audio: AudioManager,
  ) {
    this.sprite = scene.add.rectangle(x, y, SIZE.w, SIZE.h, FILL_PATROL);
    this.sprite.setStrokeStyle(2, STROKE, 0.85);
    scene.physics.add.existing(this.sprite);
    this.body = this.sprite.body as Phaser.Physics.Arcade.Body;
    this.body.setSize(SIZE.w, SIZE.h);
    this.body.setMaxVelocity(560, 1400);
    this.body.setCollideWorldBounds(false);
    // Gravity must be enabled from spawn — without it, knockback's
    // upward vy never gets pulled back down and the patrol floats up
    // forever after the first hit. Same gravity value as the player so
    // hits feel consistent.
    this.body.setGravityY(GRAVITY);

    this.attack = new AttackState();
    this.hitbox = new Hitbox(scene, 'enemy');

    this.xMin = xMin;
    this.xMax = xMax;
    this.damage = damage;
    this.fx = fx;
    this.attackFx = new AttackFx(scene);
    this.healthBar = new EnemyHealthBar(scene);
    this.audio = audio;

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

    // Grabbed: AI fully paused. GameScene drives sprite position each frame
    // via setGrabbedPosition().
    if (this.aiState === 'grabbed') {
      this.sprite.fillColor = FILL_HURT;
      return;
    }

    // Thrown: physics carries us, no AI. Once duration elapses or we've
    // settled on the ground, return to normal patrol.
    if (this.aiState === 'thrown') {
      this.sprite.fillColor = FILL_HURT;
      const grounded = this.body.blocked.down || this.body.touching.down;
      if (timeMs >= this.thrownUntilMs || grounded) {
        this.endThrow();
      }
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
      // Alert sound on patrol → chase transition.
      if (this.prevAiState !== 'chase' && this.prevAiState !== 'attack') {
        this.audio.play(SFX.ENEMY_ALERT);
      }
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
        this.audio.play(SFX.ENEMY_ATTACK_SWING);
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
    this.prevAiState = this.aiState;
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
    this.audio.play(this.hp === 0 ? SFX.ENEMY_DEATH : SFX.ENEMY_HURT);

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

  // ─── Grab / throw API ──────────────────────────────────────────────

  isGrabbed(): boolean { return this.aiState === 'grabbed'; }
  isThrown(): boolean { return this.aiState === 'thrown'; }
  isAlive(): boolean { return this.hp > 0; }

  /** Lock into the player's grab. Cancels any active attack, freezes
   *  physics, disables collisions so the patrol is purely a HUD prop
   *  while grabbed. */
  setGrabbed(): void {
    if (this.hp <= 0) return;
    this.aiState = 'grabbed';
    this.attack.cancel();
    this.hitbox.deactivate();
    this.cancelLunge?.();
    this.cancelLunge = null;
    this.body.setAllowGravity(false);
    this.body.setVelocity(0, 0);
    // Prevent interactions while held — patrol shouldn't get hit by
    // attacks, can't bonk into terrain, etc.
    this.body.checkCollision.none = true;
    this.body.enable = true; // keep enabled so position can still be updated
  }

  /** Move the grabbed sprite + body to a target position (driven by
   *  GameScene to track the player's head). */
  setGrabbedPosition(x: number, y: number): void {
    if (this.aiState !== 'grabbed') return;
    this.sprite.setPosition(x, y);
    this.body.reset(x, y);
  }

  /** Auto-break: gentle release. Resumes patrol AI without throwing. */
  releaseGrab(): void {
    if (this.aiState !== 'grabbed') return;
    this.body.setAllowGravity(true);
    this.body.checkCollision.none = false;
    this.aiState = 'patrol';
    this.body.setVelocity(0, 0);
  }

  /** Throw with a velocity. Patrol becomes a projectile that damages
   *  other patrols on overlap until lands or duration elapses. */
  throwMe(vx: number, vy: number, timeMs: number): void {
    if (this.aiState !== 'grabbed') return;
    this.body.setAllowGravity(true);
    this.body.checkCollision.none = false;
    this.body.setVelocity(vx, vy);
    this.aiState = 'thrown';
    this.thrownUntilMs = timeMs + THROW_DURATION_MS;
    this.thrownAlreadyHit.clear();
    this.facing = vx >= 0 ? 1 : -1;
  }

  /**
   * Called by GameScene each frame for any thrown patrol against every
   * other live patrol. If they overlap and haven't been hit by THIS
   * throw already, deal damage to the target.
   */
  damageIfThrownInto(other: Patrol, timeMs: number): boolean {
    if (this.aiState !== 'thrown') return false;
    if (other === this || !other.isAlive() || other.isGrabbed()) return false;
    if (this.thrownAlreadyHit.has(other.combatant.id)) return false;

    const a = this.body;
    const b = other.body;
    if (
      a.x < b.x + b.width && a.x + a.width > b.x &&
      a.y < b.y + b.height && a.y + a.height > b.y
    ) {
      this.thrownAlreadyHit.add(other.combatant.id);
      other.takeDamage(
        {
          damage: THROW_DAMAGE,
          fromX: this.sprite.x,
          fromY: this.sprite.y,
          knockbackX: 240 * this.facing,
          knockbackY: -120,
          hitstopMs: 90,
          attackName: 'thrown-patrol',
          team: 'player', // attribute kill to the player
        },
        timeMs,
      );
      return true;
    }
    return false;
  }

  private endThrow(): void {
    this.aiState = 'patrol';
    this.thrownAlreadyHit.clear();
  }

  destroy(): void {
    this.damage.unregister(this.combatant.id);
    this.healthBar.destroy();
    this.sprite.destroy();
  }
}

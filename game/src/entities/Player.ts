import Phaser from 'phaser';
import { PLAYER, COLORS } from '../core/constants';
import { InputController } from '../core/input';
import { MovementSnapshot, PlayerMovement } from '../movement/PlayerMovement';
import { AttackState } from '../combat/AttackState';
import { Hitbox } from '../combat/Hitbox';
import { DamageSystem } from '../combat/DamageSystem';
import { Combatant, DamageEvent } from '../combat/types';
import { ATTACKS, getAttack } from '../combat/attacks';
import { HitFx } from '../fx/HitFx';
import { AttackFx } from '../fx/AttackFx';

export class Player {
  readonly sprite: Phaser.GameObjects.Rectangle;
  readonly body: Phaser.Physics.Arcade.Body;
  readonly movement: PlayerMovement;
  readonly attack: AttackState;
  readonly hitbox: Hitbox;
  combatant!: Combatant;

  hp: number;
  readonly maxHp = PLAYER.maxHp;

  private trail: Phaser.GameObjects.Rectangle[] = [];
  private trailEmitTimer = 0;

  private damage: DamageSystem;
  private fx: HitFx;
  private attackFx: AttackFx;
  private cancelLunge: (() => void) | null = null;
  private hurtRectCache = new Phaser.Geom.Rectangle();

  /** Most recent hit-point world coords from a hitbox we landed. Used to spawn slash FX. */
  lastHitPoint: { x: number; y: number } | null = null;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    input: InputController,
    damage: DamageSystem,
    fx: HitFx,
  ) {
    this.sprite = scene.add.rectangle(x, y, PLAYER.width, PLAYER.height, COLORS.player);
    scene.physics.add.existing(this.sprite);
    this.body = this.sprite.body as Phaser.Physics.Arcade.Body;
    this.body.setCollideWorldBounds(true);
    this.body.setDragX(0);
    this.body.setSize(PLAYER.width, PLAYER.height);

    this.movement = new PlayerMovement(this.body, input);
    this.attack = new AttackState();
    this.hitbox = new Hitbox(scene, 'player');
    this.damage = damage;
    this.fx = fx;
    this.attackFx = new AttackFx(scene);
    this.hp = PLAYER.maxHp;

    this.combatant = damage.register({
      team: 'player',
      hurtbox: () => this.hp > 0 && !this.movement.isInvulnerable(scene.time.now)
        ? this.hurtbox()
        : null,
      takeDamage: (event, time) => this.takeDamage(event, time),
      isAlive: () => this.hp > 0,
    });
  }

  hurtbox(): Phaser.Geom.Rectangle {
    this.hurtRectCache.setTo(
      this.body.x,
      this.body.y,
      this.body.width,
      this.body.height,
    );
    return this.hurtRectCache;
  }

  update(timeMs: number, dtSec: number, input: InputController): void {
    // Evolve attack state from time. Emit phase events.
    const events = this.attack.update(timeMs);
    const facing = this.movement.getFacing();
    for (const e of events) {
      if (e.kind === 'activeStart') {
        this.hitbox.activate(e.attack);
        this.attackFx.slash(this.sprite.x, this.sprite.y, facing, e.attack, 'player');
      } else if (e.kind === 'activeEnd') {
        this.hitbox.deactivate();
      } else if (e.kind === 'recoveryEnd') {
        this.cancelLunge = null; // tween chain has resolved on its own
      }
    }

    // Take buffered next attack if we just exited recovery.
    const buffered = this.attack.takeBuffered(timeMs);
    if (buffered) this.startAttack(buffered, timeMs);

    // Read attack input.
    if (input.justPressed('attack', 16)) {
      this.tryStartAttack(timeMs);
      input.consumePress('attack');
    }

    // Combo reset if too much time has passed since last chain step.
    if (!this.attack.isAttacking() && !this.attack.isWithinComboWindow(timeMs)) {
      this.attack.resetCombo();
    }

    // Lock movement input during attack startup/active on ground (lets recovery be interruptible by jump/dash).
    const grounded = this.body.blocked.down || this.body.touching.down;
    this.movement.setMovementLocked(this.attack.shouldLockMovement() && grounded);

    this.movement.update(timeMs, dtSec);
    const snap = this.movement.snapshot(timeMs);

    // Hitbox follows player while active.
    if (this.hitbox.active) {
      this.hitbox.setOrigin(this.sprite.x, this.sprite.y, snap.facing);
      this.damage.testHitbox(this.hitbox, timeMs);
    }
    this.hitbox.drawDebug();

    // Visuals
    this.sprite.fillColor = snap.hurt
      ? COLORS.playerHurt
      : snap.dashing
        ? COLORS.playerDash
        : this.attack.isAttacking()
          ? 0xc59a48
          : COLORS.player;

    if (snap.dashing) {
      this.trailEmitTimer += dtSec * 1000;
      if (this.trailEmitTimer > 24) {
        this.emitTrail();
        this.trailEmitTimer = 0;
      }
    }
    this.fadeTrail(dtSec);

    // Invuln blink
    if (this.movement.isInvulnerable(timeMs) && this.hp > 0) {
      this.sprite.alpha = (Math.floor(timeMs / 60) % 2 === 0) ? 0.45 : 1;
    } else {
      this.sprite.alpha = 1;
    }
  }

  private tryStartAttack(timeMs: number): void {
    const grounded = this.body.blocked.down || this.body.touching.down;

    // Down + attack while grounded → shadow_pounce (heavy ground stomp).
    // (Borrows a "down + attack" mapping common in metroidvanias.)
    // For air, plain attack is air_claw.
    if (this.attack.isAttacking()) {
      // Try to chain into next.
      if (this.attack.canChain()) {
        const cur = this.attack.currentAttack();
        const nextName = cur?.next;
        if (nextName && grounded) {
          const nextAtk = getAttack(nextName);
          if (nextAtk) this.attack.buffer(nextAtk);
        }
      }
      return;
    }

    if (!grounded) {
      this.startAttack(ATTACKS.air_claw, timeMs);
      return;
    }

    const lastChain = this.attack.comboName();
    const inWindow = this.attack.isWithinComboWindow(timeMs);
    let next: typeof ATTACKS[string] = ATTACKS.claw_1;
    if (inWindow && lastChain === 'claw_1') next = ATTACKS.claw_2;
    else if (inWindow && lastChain === 'claw_2') next = ATTACKS.claw_3;
    else if (inWindow && lastChain === 'claw_3') next = ATTACKS.claw_1;
    this.startAttack(next, timeMs);
  }

  private startAttack(attack: typeof ATTACKS[string], timeMs: number): void {
    this.attack.start(attack, timeMs);
    // Cancel any in-progress lunge (chained combo case) and start a fresh one.
    this.cancelLunge?.();
    const facing = this.movement.getFacing();
    this.attackFx.telegraph(this.sprite, attack.startupMs, 'player');
    this.cancelLunge = this.attackFx.lunge(this.sprite, attack, facing);
  }

  takeDamage(event: DamageEvent, timeMs: number): void {
    if (this.hp <= 0) return;
    this.hp = Math.max(0, this.hp - event.damage);
    this.movement.takeHurt(timeMs, event.fromX);
    this.attack.cancel();
    this.hitbox.deactivate();
    this.cancelLunge?.();
    this.cancelLunge = null;
    this.fx.hitPause(event.hitstopMs, timeMs);
    this.fx.shake(160, 0.012);
    if (this.hp === 0) {
      this.sprite.alpha = 0.4;
    }
  }

  private emitTrail(): void {
    const scene = this.sprite.scene;
    const r = scene.add.rectangle(this.sprite.x, this.sprite.y, PLAYER.width, PLAYER.height, COLORS.playerDash, 0.55);
    r.setDepth(this.sprite.depth - 1);
    this.trail.push(r);
  }

  private fadeTrail(dtSec: number): void {
    for (let i = this.trail.length - 1; i >= 0; i--) {
      const r = this.trail[i];
      r.alpha -= dtSec * 4.5;
      if (r.alpha <= 0) {
        r.destroy();
        this.trail.splice(i, 1);
      }
    }
  }

  setDebugHitboxes(visible: boolean): void {
    this.hitbox.setDebugVisible(visible);
  }

  hpRatio(): number {
    return this.hp / this.maxHp;
  }

  hpInfo(): { current: number; max: number } {
    return { current: this.hp, max: this.maxHp };
  }

  getMovementSnapshot(timeMs: number): MovementSnapshot {
    return this.movement.snapshot(timeMs);
  }

  /** Instant kill (pit, fall, finishing blow). */
  kill(): void {
    if (this.hp <= 0) return;
    this.hp = 0;
    this.attack.cancel();
    this.hitbox.deactivate();
    this.sprite.alpha = 0.4;
    this.body.setVelocity(0, 0);
  }

  isDead(): boolean {
    return this.hp <= 0;
  }
}

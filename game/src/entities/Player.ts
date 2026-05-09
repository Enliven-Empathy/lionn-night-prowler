import Phaser from 'phaser';
import { PLAYER, COLORS } from '../core/constants';
import { InputController } from '../core/input';
import { LedgeQuery, MovementSnapshot, PlayerMovement } from '../movement/PlayerMovement';
import { AttackState } from '../combat/AttackState';
import { Hitbox } from '../combat/Hitbox';
import { DamageSystem } from '../combat/DamageSystem';
import { Combatant, DamageEvent } from '../combat/types';
import { ATTACKS, getAttack } from '../combat/attacks';
import { HitFx } from '../fx/HitFx';
import { AttackFx } from '../fx/AttackFx';
import { AudioManager } from '../audio/AudioManager';
import { SFX, attackSwingSfx } from '../audio/Sfx';

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
  private audio: AudioManager;
  private cancelLunge: (() => void) | null = null;
  private hurtRectCache = new Phaser.Geom.Rectangle();
  private prevSnap: MovementSnapshot | null = null;
  /** Tracks the last frame's crouch state so we only resize the body on
   *  transitions (resizing every frame is wasteful and visually jittery). */
  private wasCrouching = false;

  /** Most recent hit-point world coords from a hitbox we landed. Used to spawn slash FX. */
  lastHitPoint: { x: number; y: number } | null = null;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    input: InputController,
    damage: DamageSystem,
    fx: HitFx,
    audio: AudioManager,
    findLedge?: LedgeQuery,
  ) {
    this.sprite = scene.add.rectangle(x, y, PLAYER.width, PLAYER.height, COLORS.player);
    scene.physics.add.existing(this.sprite);
    this.body = this.sprite.body as Phaser.Physics.Arcade.Body;
    this.body.setCollideWorldBounds(true);
    this.body.setDragX(0);
    this.body.setSize(PLAYER.width, PLAYER.height);

    this.movement = new PlayerMovement(this.body, input, findLedge);
    this.attack = new AttackState();
    this.hitbox = new Hitbox(scene, 'player');
    this.damage = damage;
    this.fx = fx;
    this.attackFx = new AttackFx(scene);
    this.audio = audio;
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

    // Crouch body-resize: shrinks the physics body so the player can fit
    // under low overhangs. Body bottom edge stays pinned to where it was
    // (feet on ground) — only the top edge drops. Visual squash matches.
    this.applyCrouchResize(snap.crouching);

    // SFX from movement-state transitions: detect edges by comparing to last frame.
    this.emitMovementSfx(snap);

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
    const swing = attackSwingSfx(attack.name);
    if (swing) this.audio.play(swing);
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
    this.audio.play(this.hp === 0 ? SFX.PLAYER_DEATH : SFX.PLAYER_HURT);
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

  /**
   * Resize the physics body when crouch state changes. Body BOTTOM stays
   * pinned (player's feet don't move on the ground) — only the body's
   * top drops. Visual sprite is scaled vertically to match.
   *
   * The body's offset is set so that body.bottom = sprite.y + height/2
   * regardless of crouch state, which keeps physics interactions natural
   * (collisions still resolve at the feet, jumps still launch from the
   * feet, etc).
   */
  private applyCrouchResize(crouching: boolean): void {
    if (crouching === this.wasCrouching) return;
    this.wasCrouching = crouching;

    if (crouching) {
      const h = PLAYER.crouchHeight;
      // Offset positions the body within the sprite's bounds. Sprite top-
      // left is at sprite.x - width/2, sprite.y - displayHeight/2. We want
      // the body's TOP edge to sit at (originalHeight - crouchHeight) px
      // below the sprite's top-left, so the body BOTTOM stays at the same
      // place it was uncrouched.
      this.body.setSize(PLAYER.width, h);
      this.body.setOffset(0, PLAYER.height - h);
      this.sprite.setScale(1, PLAYER.crouchScaleY);
    } else {
      this.body.setSize(PLAYER.width, PLAYER.height);
      this.body.setOffset(0, 0);
      this.sprite.setScale(1, 1);
    }
  }

  /**
   * Detect movement-state edges by comparing the previous frame's snapshot
   * to the current one, and play the matching SFX. This avoids having to
   * thread events out of PlayerMovement; everything we need is already in
   * the snapshot.
   */
  private emitMovementSfx(snap: MovementSnapshot): void {
    const prev = this.prevSnap;
    this.prevSnap = snap;
    if (!prev) return;

    // Dash start: not dashing → dashing.
    if (!prev.dashing && snap.dashing) {
      this.audio.play(SFX.PLAYER_DASH);
      return;
    }
    // Wall cling start: state transition into wallCling.
    if (prev.state !== 'wallCling' && snap.state === 'wallCling') {
      this.audio.play(SFX.PLAYER_WALL_CLING);
    }
    // Wall jump: was on a wall last frame, now in air with strong upward velocity.
    if (prev.wallSide !== 0 && snap.wallSide === 0 && snap.vy < -300) {
      this.audio.play(SFX.PLAYER_WALL_JUMP);
      return;
    }
    // Double jump: airJumpsRemaining decreased while airborne.
    if (!prev.grounded && !snap.grounded && snap.airJumpsRemaining < prev.airJumpsRemaining) {
      this.audio.play(SFX.PLAYER_DOUBLE_JUMP);
      return;
    }
    // Ground jump: was grounded, now in air going up.
    if (prev.grounded && !snap.grounded && snap.vy < -100) {
      this.audio.play(SFX.PLAYER_JUMP);
      return;
    }
    // Land: was airborne with downward velocity, now grounded.
    if (!prev.grounded && snap.grounded && prev.vy > 80) {
      this.audio.play(SFX.PLAYER_LAND);
    }
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
    this.audio.play(SFX.PLAYER_DEATH);
  }

  isDead(): boolean {
    return this.hp <= 0;
  }
}

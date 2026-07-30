import Phaser from 'phaser';
import { PLAYER, COLORS } from '../core/constants';
import { InputController } from '../core/input';
import { LedgeQuery, MovementSnapshot, PlayerMovement, SlidePoleQuery } from '../movement/PlayerMovement';
import { SkinDef, getSkin } from '../state/Skins';
import { UserStore } from '../state/UserStore';

/** Per-run movement stat counters. Captured by GameScene at endRun and
 *  passed into RunSummary for UserStore + the badge evaluator. */
export interface PlayerRunStats {
  wallJumps: number;
  ledgeClimbs: number;
}

/** Minimum gap between "deflected" cues while invulnerable. A hazard
 *  overlap can persist for many frames; without this the spark/SFX would
 *  fire on every one of them. */
const DEFLECT_CUE_COOLDOWN_MS = 120;
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
  /** Wall-clock ms of the last "deflected" cue, so a multi-frame hazard
   *  overlap during i-frames plays the effect once rather than every tick. */
  private lastDeflectAt = -Infinity;

  /** Most recent hit-point world coords from a hitbox we landed. Used to spawn slash FX. */
  lastHitPoint: { x: number; y: number } | null = null;

  /** Per-run stat counters bumped by movement-event callbacks from
   *  PlayerMovement. GameScene reads these in endRun for the badge
   *  evaluator. Reset to zero on construction (one Player instance per
   *  scene, recreated on every restart, so no manual reset needed). */
  runStats: PlayerRunStats = { wallJumps: 0, ledgeClimbs: 0 };

  /** Cosmetic skin colours — resolved once on construction from the
   *  current user's selectedSkinId. Determines body fill, dash flash,
   *  stroke, and dash trail. All hurt/attack tint logic still uses
   *  the shared COLORS.playerHurt so damage feedback stays consistent
   *  across skins. */
  private skin: SkinDef;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    input: InputController,
    damage: DamageSystem,
    fx: HitFx,
    audio: AudioManager,
    findLedge?: LedgeQuery,
    findSlidePole?: SlidePoleQuery,
  ) {
    // Resolve the cosmetic skin once at construction. The current user
    // is read from UserStore; falls back to default ('lionn') if nobody
    // is logged in (shouldn't happen post-NameEntry routing but
    // defensive).
    this.skin = getSkin(UserStore.getCurrentUser()?.selectedSkinId);

    this.sprite = scene.add.rectangle(x, y, PLAYER.width, PLAYER.height, this.skin.bodyFill);
    this.sprite.setStrokeStyle(2, this.skin.bodyStroke, 0.9);
    scene.physics.add.existing(this.sprite);
    this.body = this.sprite.body as Phaser.Physics.Arcade.Body;
    this.body.setCollideWorldBounds(true);
    this.body.setDragX(0);
    this.body.setSize(PLAYER.width, PLAYER.height);

    this.movement = new PlayerMovement(
      this.body,
      input,
      findLedge,
      findSlidePole,
      (kind) => {
        // Tally movement events into the per-run counters that feed
        // badge unlocks (Wall Walker on first wallJump, Climber on
        // first ledgeClimb, plus any future cumulative-style badges).
        if (kind === 'wallJump') this.runStats.wallJumps += 1;
        else if (kind === 'ledgeClimb') this.runStats.ledgeClimbs += 1;
      },
    );
    this.attack = new AttackState();
    this.hitbox = new Hitbox(scene, 'player');
    this.damage = damage;
    this.fx = fx;
    this.attackFx = new AttackFx(scene);
    this.audio = audio;
    this.hp = PLAYER.maxHp;

    // The hurtbox is now ALWAYS present while alive. Invulnerability used to
    // be enforced here by returning null, which had two bad consequences:
    //   1. It only covered damage arriving through DamageSystem. GameScene
    //      calls player.takeDamage() DIRECTLY for spikes and overhangs, so
    //      those bypassed i-frames entirely and dealt damage every frame of
    //      overlap (spikes: 4 dmg/frame → 40+ damage against 10 HP).
    //   2. A null hurtbox means DamageSystem never calls hitbox.markHit(), so
    //      an enemy swing still active when i-frames expire lands anyway.
    // The gate now lives in takeDamage() where every path must pass through.
    this.combatant = damage.register({
      team: 'player',
      hurtbox: () => (this.hp > 0 ? this.hurtbox() : null),
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
        // 3-hit combo payoff: claw_3 (the heavy finisher) gets extra VFX
        // and a beefier camera shake on top of the regular slash. The
        // damage/knockback boost lives in attacks.ts; this is just the
        // visual+haptic coat of paint.
        if (e.attack.name === 'claw_3') {
          this.attackFx.finisher(this.sprite.x, this.sprite.y, facing, e.attack, 'player');
          this.fx.shake(180, 0.018);
        }
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

    // Ground-pound landing impact: when the previous tick had pounding=true
    // and we've just become grounded this tick, fire AOE damage + FX +
    // shake/hitstop. Prev-snap nullity is handled implicitly (first frame
    // of the run can't satisfy "was pounding && was airborne" anyway).
    if (
      this.prevSnap?.pounding === true &&
      this.prevSnap.grounded === false &&
      snap.grounded === true
    ) {
      this.executePoundImpact(timeMs);
    }

    // SFX from movement-state transitions: detect edges by comparing to last frame.
    this.emitMovementSfx(snap);

    // Hitbox follows player while active.
    if (this.hitbox.active) {
      this.hitbox.setOrigin(this.sprite.x, this.sprite.y, snap.facing);
      this.damage.testHitbox(this.hitbox, timeMs);
    }
    this.hitbox.drawDebug();

    // Visuals — skin drives idle/dash colours; hurt + attack tints stay
    // consistent across skins so damage / attack feedback reads the
    // same regardless of cosmetic.
    this.sprite.fillColor = snap.hurt
      ? COLORS.playerHurt
      : snap.dashing
        ? this.skin.dashFill
        : this.attack.isAttacking()
          ? 0xc59a48
          : this.skin.bodyFill;

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

    // ─── Invulnerability gate — MUST stay above the `hp -=` line ───────
    // Every damage source funnels through here: DamageSystem hitboxes and
    // AOE rects, plus GameScene's direct calls for spikes and overhangs.
    // Previously only the DamageSystem path was gated (via a null hurtbox),
    // so a spike overlap applied 4 damage EVERY FRAME — a guaranteed kill
    // from a single touch, which read as random unfairness.
    //
    // A blocked hit still gets a small "deflected" cue so the player learns
    // they successfully dodged, but deliberately no hitstop and no shake —
    // those would make a good dodge feel like a hit. Rate-limited so a
    // multi-frame overlap doesn't machine-gun the effect.
    if (this.movement.isInvulnerable(timeMs)) {
      if (timeMs - this.lastDeflectAt > DEFLECT_CUE_COOLDOWN_MS) {
        this.lastDeflectAt = timeMs;
        try {
          this.fx.spark(this.sprite.x, this.sprite.y, 0xc4b8e8);
          this.audio.play(SFX.ENEMY_HURT, { volume: 0.4, rate: 1.4 });
        } catch {
          // Cue is cosmetic — never let it break damage handling.
        }
      }
      return;
    }

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
    const r = scene.add.rectangle(this.sprite.x, this.sprite.y, PLAYER.width, PLAYER.height, this.skin.trailFill, 0.55);
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
   * Ground-pound landing: AOE damage + heavy impact FX. Called from
   * Player.update when the snapshot transition is "was pounding +
   * airborne → now grounded".
   *
   * AOE rect: 160 px wide × 60 px tall, centered horizontally on the
   * body and vertically straddling the feet (extends 30 px above / 30 px
   * below body.bottom). Wide enough to catch enemies the player landed
   * NEXT to, not just directly under.
   *
   * Damage 3 — between claw_2 (1) and claw_3 (4). Knockback launches
   * straight up (-380) so chained impacts can be set up. Hitstop 180 ms
   * makes the impact land with weight.
   */
  private executePoundImpact(timeMs: number): void {
    const aoeW = 160;
    const aoeH = 60;
    const cx = this.body.x + this.body.width / 2;
    const feetY = this.body.y + this.body.height;
    const aoeRect = new Phaser.Geom.Rectangle(
      cx - aoeW / 2,
      feetY - aoeH / 2,
      aoeW,
      aoeH,
    );

    this.damage.testRect(
      aoeRect,
      'player',
      {
        damage: 3,
        fromX: cx,
        fromY: feetY,
        knockbackX: 0,
        knockbackY: -380,
        hitstopMs: 180,
        attackName: 'pound_impact',
      },
      timeMs,
    );

    this.attackFx.poundImpact(cx, feetY, 'player');
    this.fx.shake(220, 0.022);
    this.fx.hitPause(140, timeMs);
    this.audio.play(SFX.PLAYER_SHADOW_POUNCE);
  }

  /**
   * Resize for crouch by changing ONLY the sprite's scaleY. Phaser's
   * arcade body auto-syncs body.height each physics tick via
   *
   *     body.height = body.sourceHeight * abs(sprite.scaleY)
   *
   * (Body.preUpdate, arcade/Body.js ~line 1015). sourceHeight was set to
   * PLAYER.height (64) in the Player constructor and is never changed
   * after — so scaleY=0.5625 gives body.height=36, scaleY=1 gives 64,
   * automatically and atomically with the visual.
   *
   * Earlier attempts called body.setSize(38, 36) on crouch, which set
   * sourceHeight=36. The auto-sync then did 36 * 0.5625 = 20.25, so the
   * body collapsed to less than HALF its visual height. That left the
   * physics footprint floating 28 px above the platform after a
   * crouch→uncrouch cycle (uncrouch hit setSize again with sourceHeight=64
   * so the next sync did 64*1=64, but the resize had teleported the body
   * center mid-cycle and Phaser couldn't recover the foot anchor).
   *
   * sprite.y is anchored so visual bottom (and therefore body bottom,
   * since offset=0 and the auto-sync keeps scaled-height matched) sits
   * exactly on footY. Crouch only fires while grounded so writing
   * sprite.y mid-frame is safe — the body's at rest and pre/postUpdate
   * will re-sync to the same numbers next tick.
   */
  private applyCrouchResize(crouching: boolean): void {
    if (crouching === this.wasCrouching) return;
    this.wasCrouching = crouching;

    // Read foot Y from the SPRITE's display bounds (Phaser will sync the
    // body's position from the sprite, so the sprite is the source of
    // truth here — reading body.y + body.height instead can give a stale
    // answer if the body has already auto-synced for the new scaleY).
    const footY = this.sprite.y + this.sprite.displayHeight / 2;
    const targetScaleY = crouching ? PLAYER.crouchHeight / PLAYER.height : 1;

    this.sprite.setScale(1, targetScaleY);
    // displayHeight reflects the NEW scaleY immediately.
    this.sprite.y = footY - this.sprite.displayHeight / 2;
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

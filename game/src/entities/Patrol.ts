import Phaser from 'phaser';
import { BossDef } from '../state/Bosses';
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
const FILL_DIZZY = 0x8ad4e0;        // ice-blue overlay — reads as "stunned"
const STROKE = 0x9b59ff;
const DIZZY_DURATION_MS = 2000;     // base duration; A applies 0.5^count multiplier
const DIZZY_MIN_DURATION_MS = 200;  // floor so very-deep diminishing doesn't go invisible
const DIZZY_RESET_MS = 5000;        // no re-dizzy for 5s → count resets to 0
const DIZZY_IMMUNE_FLASH_MS = 80;   // brief flash when a blocked claw "no-effects"
const WAKE_UP_STARTUP_MS = 200;     // D: bosses fire a counter-attack with this startup
                                    // when their dizzy ends. Hyper-armour during this
                                    // window means the kid can't re-dash through it.

const DETECT_X = 280;
const DETECT_Y = 120;
const ATTACK_X = 56;
const ATTACK_Y = 44;
const PATROL_SPEED = 90;
const CHASE_SPEED = 170;
const KNOCKBACK_RESIST = 0.55;
/** Standard patrol HP. Tuned so the kid needs a full 3-hit combo
 *  (claw_1=1 + claw_2=1 + claw_3=4 = 6) to fell one — single-hit
 *  finishers don't work. Bumped from 3 (which let claw_3 one-shot
 *  every patrol and made the standard enemies trivial). */
const PATROL_HP = 6;

type AIState = 'patrol' | 'chase' | 'attack' | 'hurt' | 'dead' | 'grabbed' | 'thrown';

/** 'patrol' — full AI: walks bounds, detects player, chases, attacks.
 *  'dummy'  — stationary slam-target: walks back and forth in narrow
 *  bounds, doesn't aggro the player, doesn't attack. Used in parkour
 *  rooms where the kid focuses on traversal — the patrol exists only
 *  to be ground-pounded. Still takes damage, still has a hazard probe
 *  (won't walk off platform), still grabbable/throwable. */
export type PatrolVariant = 'patrol' | 'dummy';

/** Look-ahead probe used by the patrol AI to refuse stepping into a pit
 *  or onto an active spike row. The footX/footY point is where the
 *  patrol's foot WOULD be on the next step; the probe should answer
 *  "is that spot unsafe to walk onto" — true means abort the step. */
export type PatrolHazardProbe = (footX: number, footY: number) => boolean;

const THROW_DURATION_MS = 800;
const THROW_DAMAGE = 2;
/** Minimum descent vy at the moment of grounding for the impact to be
 *  fatal. Tuned so normal player attacks (knockbackY -50..-120 * 0.55
 *  resist) can't accidentally trigger fall-kill, but throws (vy=-350
 *  sideways, vy=-1000 up) and free-falls into pits do. */
const FALL_KILL_VY = 700;

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
  /** When non-null, this is a boss patrol. The BossDef carries id,
   *  display name, HP, scale, palette, and reward count. GameScene
   *  reads `bossDef` on hit-kill to award the Night Slayer + per-boss
   *  badges and to spawn the reward orbs. Public so the damage
   *  callback can inspect it. */
  readonly bossDef: BossDef | null;
  /** Convenience boolean — true iff bossDef is set. */
  get isBoss(): boolean { return this.bossDef !== null; }

  hp: number;
  maxHp: number;
  facing: 1 | -1 = -1;

  private aiState: AIState = 'patrol';
  private thrownUntilMs = 0;
  /** Per-throw set of patrol IDs already damaged by this projectile, so a
   *  thrown body can't multi-hit the same target while passing through. */
  private thrownAlreadyHit = new Set<number>();
  /** Tracks the previous frame's vy. Used by the fall-kill check on the
   *  grounded-transition: if you were falling fast and just landed, the
   *  impact is lethal. */
  private prevVy = 0;
  /** Tracks last frame's grounded state for transition detection. */
  private wasGrounded = true;
  private xMin: number;
  private xMax: number;
  private flashUntil = 0;
  private hurtUntil = 0;

  private damage: DamageSystem;
  private fx: HitFx;
  private attackFx: AttackFx;
  private healthBar: EnemyHealthBar;
  private audio: AudioManager;
  private cancelLunge: (() => void) | null = null;
  private hurtRect = new Phaser.Geom.Rectangle();
  private prevAiState: AIState = 'patrol';
  private hazardAhead?: PatrolHazardProbe;
  /** Wall-clock time until which the patrol stays put after refusing to
   *  step onto a hazard. Stops the AI from facing-flipping every frame
   *  in front of a danger zone (which looked twitchy on screen). */
  private hazardWaitUntilMs = 0;
  private variant: PatrolVariant = 'patrol';
  /** Scene-time ms until which the patrol is dizzy. While dizzy: AI
   *  freezes (vx → 0), no chase, no attack; takeDamage applies normal
   *  damage; visual tint shifts to ice-blue. Set by takeDamage when
   *  attackName === 'dash' | 'pound_impact'. */
  private dizzyUntilMs = 0;
  /** Diminishing-returns counter (mechanic A). Each consecutive
   *  applyDizzy call on this target adds 1; the resulting duration is
   *  DIZZY_DURATION_MS × 0.5^count (floored to DIZZY_MIN_DURATION_MS).
   *  Resets to 0 if no new dizzy has been applied in DIZZY_RESET_MS
   *  since the previous dizzy expired — fresh engagements get the
   *  full 2 s window back. */
  private recentDizzyCount = 0;
  /** Tracks the previous frame's dizzy state for the dizzy-end edge
   *  detection used by the boss wake-up counter (mechanic D). */
  private wasDizzyLastFrame = false;
  /** While timeMs < this value, takeDamage deflects ALL hits (dash,
   *  pound, claw) — no damage, no dizzy, no hurt-stun. Set by the
   *  boss wake-up counter during its attack startup so the kid can't
   *  re-dash through it. Brief flash on each deflected hit gives
   *  feedback. */
  private hyperArmorUntilMs = 0;

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
    hazardAhead?: PatrolHazardProbe,
    variant: PatrolVariant = 'patrol',
    bossDef: BossDef | null = null,
  ) {
    this.bossDef = bossDef;
    // Boss bodies use the def's scale + HP + palette. Regular patrols
    // fall back to the base patrol stats. The def-driven flow lets us
    // add new boss types (with different stats/colors) by editing data
    // in state/Bosses.ts — no Patrol changes needed.
    const w = bossDef ? Math.round(SIZE.w * bossDef.scale) : SIZE.w;
    const h = bossDef ? Math.round(SIZE.h * bossDef.scale) : SIZE.h;
    this.hp = bossDef ? bossDef.hp : PATROL_HP;
    this.maxHp = this.hp;

    this.sprite = scene.add.rectangle(x, y, w, h, bossDef ? bossDef.fill : FILL_PATROL);
    this.sprite.setStrokeStyle(bossDef ? 3 : 2, bossDef ? bossDef.stroke : STROKE, 0.92);
    scene.physics.add.existing(this.sprite);
    this.body = this.sprite.body as Phaser.Physics.Arcade.Body;
    this.body.setSize(w, h);
    this.body.setMaxVelocity(560, 1400);
    this.body.setCollideWorldBounds(false);
    // Gravity must be enabled from spawn — without it, knockback's
    // upward vy never gets pulled back down and the patrol floats up
    // forever after the first hit. Same gravity value as the player so
    // hits feel consistent.
    this.body.setGravityY(GRAVITY);

    this.attack = new AttackState();
    this.hitbox = new Hitbox(scene, 'enemy');
    // Scale the attack reach with the body. Attacks are authored against
    // the base 46×70 patrol, so without this a 2.0× boss swung a hitbox
    // sized for a body less than half its width — visually the swing
    // passed through the player without connecting.
    this.hitbox.scale = bossDef ? bossDef.scale : 1;

    this.xMin = xMin;
    this.xMax = xMax;
    this.hazardAhead = hazardAhead;
    this.variant = variant;
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

    // ─── Fall-kill detection ───────────────────────────────────────
    // Body weight: a patrol that just landed with high vy dies on impact.
    // Tracked via the grounded-transition edge (was airborne, now grounded)
    // against the *previous* frame's vy (the velocity AT the moment of
    // impact, before the collider zeroed it out this frame).
    const grounded = this.body.blocked.down || this.body.touching.down;
    if (
      this.aiState !== 'grabbed' &&
      grounded &&
      !this.wasGrounded &&
      this.prevVy > FALL_KILL_VY
    ) {
      this.fatalImpact(timeMs);
      this.prevVy = 0;
      this.wasGrounded = true;
      return;
    }
    this.prevVy = this.body.velocity.y;
    this.wasGrounded = grounded;

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

    const idleFill = this.bossDef ? this.bossDef.fill : FILL_PATROL;
    const chaseFill = this.bossDef ? this.bossDef.chaseFill : FILL_CHASE;
    const dizzy = this.isDizzy(timeMs);
    const dizzyJustEnded = this.wasDizzyLastFrame && !dizzy;
    this.wasDizzyLastFrame = dizzy;

    // Dizzy state: AI freezes, vx decays to 0, ice-blue tint shows
    // the kid this enemy is now vulnerable. Slash-immune bosses
    // (Night Sovereign) take normal claw damage during this window.
    if (dizzy) {
      this.aiState = 'hurt';
      this.sprite.fillColor = timeMs < this.flashUntil ? FILL_HURT : FILL_DIZZY;
      this.body.setVelocityX(this.body.velocity.x * 0.7);
      this.maybeUpdateAttack(timeMs);
      return;
    }

    // D — boss wake-up counter-attack. On the frame the boss's dizzy
    // ends, fire an attack with a shortened startup AND hyper-armour
    // for the duration of that startup. The kid can't interrupt the
    // counter with another dash; they have to dodge or eat the swing.
    // Together with A (diminishing returns), this stops the dash →
    // dizzy → claw → re-dash spam dead in its tracks.
    if (dizzyJustEnded && this.bossDef && !this.attack.isAttacking() && target.alive) {
      const attackKey = this.bossDef.attackName ?? 'claw_2';
      const baseAttack = ATTACKS[attackKey] ?? ATTACKS.claw_2;
      const wakeAttack = { ...baseAttack, startupMs: WAKE_UP_STARTUP_MS };
      this.facing = target.x < this.sprite.x ? -1 : 1;
      this.attack.start(wakeAttack, timeMs);
      this.cancelLunge?.();
      this.attackFx.telegraph(this.sprite, WAKE_UP_STARTUP_MS, 'enemy');
      this.cancelLunge = this.attackFx.lunge(this.sprite, wakeAttack, this.facing);
      this.audio.play(SFX.ENEMY_ATTACK_SWING);
      this.aiState = 'attack';
      this.hyperArmorUntilMs = timeMs + WAKE_UP_STARTUP_MS;
      // Tiny forward drift toward the kid so the swing connects if
      // the kid stays in melee range.
      this.body.setVelocityX(this.facing * 80);
      this.maybeUpdateAttack(timeMs);
      return;
    }

    if (timeMs < this.hurtUntil) {
      // Stunned by recent hit; physics carries the knockback.
      this.aiState = 'hurt';
      this.sprite.fillColor = timeMs < this.flashUntil ? FILL_HURT : idleFill;
      this.maybeUpdateAttack(timeMs);
      return;
    }

    // Color tint reflects state — boss palette swaps in when isBoss.
    const isChasing = this.aiState === 'chase' || this.aiState === 'attack';
    this.sprite.fillColor =
      timeMs < this.flashUntil ? FILL_HURT :
      isChasing ? chaseFill :
      idleFill;

    // Dummies don't aggro the player. They're slam targets that exist
    // only to be ground-pounded — keeps parkour rooms focused on
    // traversal rather than combat. Hazard probe still runs (so they
    // don't walk off platforms) and they still take damage normally.
    //
    // Bosses can override AI thresholds via bossDef. Per-boss tuning
    // gives each major encounter its own rhythm — Shadow Stalker has
    // wide vision + close-engage, Crimson Beast has slow long-reach
    // slam, Night Sovereign has the widest vision of all.
    const detectX = this.bossDef?.detectRangeX ?? DETECT_X;
    const attackX = this.bossDef?.attackRangeX ?? ATTACK_X;
    const seesPlayer =
      this.variant === 'patrol' &&
      target.alive &&
      Math.abs(target.x - this.sprite.x) < detectX &&
      Math.abs(target.y - this.sprite.y) < DETECT_Y;

    const inAttackRange =
      this.variant === 'patrol' &&
      target.alive &&
      Math.abs(target.x - this.sprite.x) < attackX &&
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
        // Boss-specific attack profile (shadow_dash / crimson_slam /
        // sovereign_strike) or default to claw_2 for regular patrols.
        const attackKey = this.bossDef?.attackName ?? 'claw_2';
        const a = ATTACKS[attackKey] ?? ATTACKS.claw_2;
        this.attack.start(a, timeMs);
        this.cancelLunge?.();
        this.attackFx.telegraph(this.sprite, a.startupMs, 'enemy');
        this.cancelLunge = this.attackFx.lunge(this.sprite, a, this.facing);
        this.audio.play(SFX.ENEMY_ATTACK_SWING);
        this.aiState = 'attack';
        this.body.setVelocityX(this.facing * 60); // slight forward drift
      } else {
        // Chase but stay within patrol bounds (don't walk off ledge).
        // Per-boss chase speed lets each major fight have a distinct
        // tempo (Crimson Beast is a slow brute; Shadow Stalker rushes).
        const chaseSpeed = this.bossDef?.chaseSpeed ?? CHASE_SPEED;
        let targetVx =
          this.facing === 1 && this.sprite.x < this.xMax - 10 ? chaseSpeed :
          this.facing === -1 && this.sprite.x > this.xMin + 10 ? -chaseSpeed :
          0;
        // Refuse to step into a pit or active spike row, even mid-chase.
        // Better to lose the player than to walk into spikes.
        if (targetVx !== 0 && this.isStepHazardous(this.facing)) {
          targetVx = 0;
          this.hazardWaitUntilMs = timeMs + 500;
        }
        this.body.setVelocityX(targetVx);
      }
    } else {
      // Patrol back and forth between bounds, with hazard awareness:
      // pits and active spikes ahead force a U-turn before the step lands.
      this.aiState = 'patrol';
      if (this.sprite.x >= this.xMax - 6) this.facing = -1;
      else if (this.sprite.x <= this.xMin + 6) this.facing = 1;

      if (this.isStepHazardous(this.facing)) {
        // Try the other way; if it's also unsafe (e.g. perched between
        // hazards), wait in place rather than twitch back and forth.
        if (!this.isStepHazardous(-this.facing as 1 | -1)) {
          this.facing = -this.facing as 1 | -1;
        } else {
          this.body.setVelocityX(0);
          this.hazardWaitUntilMs = timeMs + 500;
        }
      }

      if (timeMs < this.hazardWaitUntilMs) {
        this.body.setVelocityX(0);
      } else {
        this.body.setVelocityX(this.facing * PATROL_SPEED);
      }
    }

    this.maybeUpdateAttack(timeMs);
    this.prevAiState = this.aiState;
  }

  /**
   * Probe one step ahead of the patrol's foot in `dir` and ask the
   * external hazard probe whether that point is unsafe. We sample at
   * "next foot position" — slightly past the body's leading edge, at
   * ground level — so the patrol turns BEFORE its feet leave the
   * platform or land on a spike row. Returns false if no probe was
   * provided (back-compat).
   */
  private isStepHazardous(dir: 1 | -1): boolean {
    if (!this.hazardAhead) return false;
    const lookAhead = this.body.width / 2 + 14;
    const footX = this.sprite.x + dir * lookAhead;
    const footY = this.body.y + this.body.height; // body bottom = on the ground
    return this.hazardAhead(footX, footY);
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

  /** True iff this patrol is currently dizzy (stunned + vulnerable). */
  isDizzy(timeMs: number): boolean {
    return timeMs < this.dizzyUntilMs;
  }

  /** Apply (or extend) the dizzy state with diminishing returns.
   *
   *   - Each consecutive applyDizzy call adds 1 to recentDizzyCount.
   *   - Actual duration = baseDurationMs × 0.5^count, floored at
   *     DIZZY_MIN_DURATION_MS so deep diminishing isn't invisible.
   *   - After DIZZY_RESET_MS without re-dizzy (measured from when the
   *     previous dizzy expired), the count resets to 0 — a kid who
   *     disengages for 5 s gets the full 2 s window back.
   *
   * This breaks the dash → dizzy → claw → dash → dizzy spam loop that
   * made the dizzy mechanic feel exploitable: the kid still gets a
   * satisfying first stun (2 s) and a tight second window (1 s), but
   * by the third re-dizzy the window is only 0.5 s and they have to
   * choose a different play. */
  applyDizzy(baseDurationMs: number, timeMs: number): void {
    if (this.hp <= 0) return;
    // Reset the count when the previous dizzy expired more than the
    // reset window ago. We compare against dizzyUntilMs (== last
    // expiry timestamp once it's in the past).
    if (this.dizzyUntilMs > 0 && timeMs - this.dizzyUntilMs > DIZZY_RESET_MS) {
      this.recentDizzyCount = 0;
    }
    const multiplier = Math.pow(0.5, this.recentDizzyCount);
    const duration = Math.max(DIZZY_MIN_DURATION_MS, baseDurationMs * multiplier);
    this.dizzyUntilMs = Math.max(this.dizzyUntilMs, timeMs + duration);
    this.recentDizzyCount += 1;
  }

  takeDamage(event: DamageEvent, timeMs: number): void {
    if (this.hp <= 0) return;

    // D — hyper-armour during a boss wake-up counter. The boss has
    // committed to an attack and is uninterruptible for the duration
    // of the startup; any hit (dash, pound, claw) bounces off without
    // damage, dizzy, or hurt-stun. Brief flash gives the kid the
    // "deflected" feedback so they know to back off and dodge.
    if (timeMs < this.hyperArmorUntilMs) {
      this.flashUntil = timeMs + DIZZY_IMMUNE_FLASH_MS;
      try { this.audio.play(SFX.ENEMY_HURT); } catch { /* swallow */ }
      return;
    }

    // Dash and ground-pound impacts always apply dizzy on hit. This is
    // the new universal mechanic — works on every enemy, opens the
    // damage window required by slash-immune bosses (Night Sovereign).
    const isDashOrPound =
      event.attackName === 'dash' || event.attackName === 'pound_impact';
    if (isDashOrPound) {
      this.applyDizzy(DIZZY_DURATION_MS, timeMs);
    }

    // Slash-immune-when-alert gate (final boss). Claw / regular attacks
    // bounce off unless the boss is currently dizzy. Dash and pound
    // bypass — they're how the kid OPENS the dizzy window. Blocked
    // hits still play a brief flash so the kid sees the "no effect"
    // feedback without an HP change.
    if (
      this.bossDef?.slashImmuneWhenAlert &&
      !this.isDizzy(timeMs) &&
      !isDashOrPound
    ) {
      this.flashUntil = timeMs + DIZZY_IMMUNE_FLASH_MS;
      try { this.audio.play(SFX.ENEMY_HURT); } catch { /* swallow */ }
      // Don't apply damage / knockback / hurt-stun. Hit was deflected.
      return;
    }

    this.hp = Math.max(0, this.hp - event.damage);
    this.flashUntil = timeMs + 110;

    // ─── Poise ────────────────────────────────────────────────────────
    // A hit only interrupts an in-progress attack if it beats this
    // enemy's poise. Regular patrols have no poise (undefined → 0), so
    // any hit still staggers them exactly as before.
    //
    // Bosses set poise 2-3, so 1-damage chip (claw_1, claw_2, dash) no
    // longer cancels a wind-up — which is what let a mashing child stop
    // every boss attack before its active frames and made bosses feel
    // like harmless big patrols. claw_3 (4) and the pound (3) still cut
    // through, and dizzy (from dash/pound) still shuts the boss down
    // outright, so the counter-play stays intact and readable.
    const poise = this.bossDef?.poise ?? 0;
    const interrupts = event.damage >= poise;
    if (interrupts) {
      this.hurtUntil = timeMs + 220;
      this.attack.cancel();
      this.hitbox.deactivate();
      this.cancelLunge?.();
      this.cancelLunge = null;
    } else {
      // Poised through it: the attack continues. Still give a short
      // hurt-flash so the hit visibly registers, but no stagger and no
      // attack cancel.
      this.flashUntil = timeMs + 90;
    }
    this.audio.play(this.hp === 0 ? SFX.ENEMY_DEATH : SFX.ENEMY_HURT);

    // Knockback is skipped when the enemy poised through the hit and is
    // still alive — shoving a boss backwards mid-swing would visually
    // detach it from the attack it's committed to, and would let chip
    // damage push it out of its own hitbox's reach. A killing blow always
    // knocks back, so the death pop still reads.
    const dir = this.body.center.x < event.fromX ? -1 : 1;
    if (interrupts || this.hp === 0) {
      this.body.setVelocityX(event.knockbackX * dir * KNOCKBACK_RESIST);
      this.body.setVelocityY(event.knockbackY * KNOCKBACK_RESIST);
    }

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
      // applyDirect, not other.takeDamage — the kill is credited to the
      // player, so it has to reach the onHit listener for kill count,
      // boss reward orbs and boss badges.
      this.damage.applyDirect(
        other.combatant,
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

  /**
   * Lethal landing — credit the kill to the player so it counts toward
   * their score. Called from update() on a high-vy grounded transition.
   */
  private fatalImpact(timeMs: number): void {
    // Credited to the player (team: 'player') — an up-throw that ends in a
    // lethal landing is a player kill. Routed through DamageSystem so the
    // onHit listener fires; calling this.takeDamage directly meant a boss
    // killed by up-throwing it awarded no orbs, no badge and no kill count.
    this.damage.applyDirect(
      this.combatant,
      {
        damage: 99,
        fromX: this.sprite.x,
        fromY: this.sprite.y,
        knockbackX: 0,
        knockbackY: 0,
        hitstopMs: 100,
        attackName: 'fall-impact',
        team: 'player',
      },
      timeMs,
    );
  }

  destroy(): void {
    this.damage.unregister(this.combatant.id);
    this.healthBar.destroy();
    this.sprite.destroy();
  }
}

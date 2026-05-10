import Phaser from 'phaser';
import { PLAYER, GRAVITY } from '../core/constants';
import { InputController } from '../core/input';

export type MovementState =
  | 'idle'
  | 'run'
  | 'crouch'
  | 'jumpRise'
  | 'fall'
  | 'dash'
  | 'wallCling'
  | 'wallJump'
  | 'ledgeGrab'
  | 'land'
  | 'hurt';

/** World query the movement system uses to detect ledge-grabbable static
 *  rectangles. Returns world-space coords of the rect's top edge and X
 *  bounds, or null if no ledge is in range. Implemented by the level so
 *  the movement code stays world-agnostic. */
export type LedgeQuery = (
  bodyLeft: number,
  bodyRight: number,
  bodyTop: number,
  side: -1 | 1,
) => { topY: number; leftX: number; width: number } | null;

/** World query: returns slide-pole bounds if the player is currently in
 *  side-contact with one. Used to override wall-cling behavior with the
 *  slide-pole's controlled descent. Implemented by GameScene (it walks
 *  the slidePoles list it built from drainSlidePoleSpawns). */
export type SlidePoleQuery = (
  bodyLeft: number,
  bodyRight: number,
  bodyCenterY: number,
  side: -1 | 1,
) => { topY: number; bottomY: number } | null;

/** One-shot movement events the consumer (Player → GameScene) tallies
 *  for per-run counters that feed badge unlocks. Fired exactly once per
 *  successful action: 'wallJump' on a wall-jump push-off, 'ledgeClimb'
 *  on a successful ledge-grab climb. */
export type MovementEventKind = 'wallJump' | 'ledgeClimb';
export type MovementEventListener = (kind: MovementEventKind) => void;

export interface MovementSnapshot {
  state: MovementState;
  facing: 1 | -1;
  vx: number;
  vy: number;
  grounded: boolean;
  wallSide: -1 | 0 | 1;
  coyoteRemainingMs: number;
  jumpBufferRemainingMs: number;
  dashCooldownRemainingMs: number;
  dashing: boolean;
  crouching: boolean;
  hurt: boolean;
  airJumpsRemaining: number;
  /** True iff the player is mid-air and crouch is held — Mario-style
   *  ground pound. The movement system clamps vy to PLAYER.poundSpeed
   *  while this is true; consumers (Player) use it to fire impact FX
   *  + AOE damage on the landing frame. */
  pounding: boolean;
}

export class PlayerMovement {
  private body: Phaser.Physics.Arcade.Body;
  private input: InputController;

  private facing: 1 | -1 = 1;
  private grounded = false;
  private wallSide: -1 | 0 | 1 = 0;
  private state: MovementState = 'idle';

  private lastGroundedAt = -Infinity;
  private lastJumpPressAt = -Infinity;
  private jumpHeldThisJump = false;

  private dashEndsAt = -Infinity;
  private dashCooldownUntil = -Infinity;
  private dashDir: 1 | -1 = 1;

  private airJumpsRemaining = PLAYER.airJumps;

  private wallJumpLockoutUntil = -Infinity;
  /** When the current wall cling began. Reset every time cling re-engages
   *  (touch new wall, wall-jump and re-touch, etc). */
  private wallClingStartedAt = -Infinity;
  private wasClingLastFrame = false;
  private hurtUntil = -Infinity;
  private invulnUntil = -Infinity;
  private knockbackUntil = -Infinity;

  private crouching = false;
  private pounding = false;
  private movementLocked = false;

  private findLedge?: LedgeQuery;
  private findSlidePole?: SlidePoleQuery;
  private onMovementEvent?: MovementEventListener;
  /** When non-null, the player is hanging on a ledge — physics is frozen,
   *  position is pinned to the ledge edge, and only jump/down/away inputs
   *  are interpreted. */
  private ledgeGrab: { topY: number; leftX: number; width: number; side: -1 | 1 } | null = null;

  constructor(
    body: Phaser.Physics.Arcade.Body,
    input: InputController,
    findLedge?: LedgeQuery,
    findSlidePole?: SlidePoleQuery,
    onMovementEvent?: MovementEventListener,
  ) {
    this.body = body;
    this.input = input;
    this.findLedge = findLedge;
    this.findSlidePole = findSlidePole;
    this.onMovementEvent = onMovementEvent;
    this.body.setMaxVelocity(10000, PLAYER.maxFallSpeed);
    this.body.setGravityY(GRAVITY);
  }

  private emit(kind: MovementEventKind): void {
    if (!this.onMovementEvent) return;
    try {
      this.onMovementEvent(kind);
    } catch (e) {
      // Listener bug shouldn't kill movement — log and continue.
      // eslint-disable-next-line no-console
      console.warn('[PlayerMovement] movement-event listener threw:', e);
    }
  }

  setMovementLocked(locked: boolean): void {
    this.movementLocked = locked;
  }

  isInvulnerable(timeMs: number): boolean {
    return timeMs < this.invulnUntil;
  }

  takeHurt(timeMs: number, fromX: number): void {
    if (this.isInvulnerable(timeMs)) return;
    const dir = this.body.center.x < fromX ? -1 : 1;
    this.body.setVelocityX(PLAYER.hurtKnockback.x * dir);
    this.body.setVelocityY(PLAYER.hurtKnockback.y);
    this.hurtUntil = timeMs + 280;
    this.invulnUntil = timeMs + PLAYER.hurtInvulnMs;
    this.knockbackUntil = timeMs + 220;
    this.dashEndsAt = -Infinity;
  }

  update(timeMs: number, dtSec: number): void {
    this.grounded = this.body.blocked.down || this.body.touching.down;

    const blockedLeft = this.body.blocked.left || this.body.touching.left;
    const blockedRight = this.body.blocked.right || this.body.touching.right;
    if (this.grounded) this.wallSide = 0;
    else if (blockedLeft) this.wallSide = -1;
    else if (blockedRight) this.wallSide = 1;
    else this.wallSide = 0;

    if (this.grounded) {
      this.lastGroundedAt = timeMs;
      this.jumpHeldThisJump = false;
      this.airJumpsRemaining = PLAYER.airJumps;
    }

    if (this.input.justPressed('jump', 16)) {
      this.lastJumpPressAt = timeMs;
    }

    const dashing = timeMs < this.dashEndsAt;
    const hurt = timeMs < this.hurtUntil;
    const knockedBack = timeMs < this.knockbackUntil;

    // ─── Ledge grab takes precedence over everything else ────────────
    // If the player is hanging on a ledge, physics is frozen and we only
    // listen for: JUMP (climb up), DOWN (drop off), or AWAY-press
    // (release to the side). Hurt also breaks the grab.
    if (this.ledgeGrab && !hurt) {
      this.handleLedgeGrab(timeMs);
      this.updateFacing();
      // Don't propagate cling state — ledge is a distinct state, and we
      // don't want shouldWallCling's first-engage logic to fire on exit.
      this.wasClingLastFrame = false;
      return;
    }
    if (this.ledgeGrab && hurt) {
      this.releaseLedge();
    }

    if (this.movementLocked || hurt) {
      this.body.setGravityY(GRAVITY);
      this.applyVariableJumpCutoff();
      this.updateState(timeMs, dashing, hurt);
      this.updateFacing();
      // Force any cling state to break — when control returns the next
      // contact counts as a fresh stick.
      this.wasClingLastFrame = false;
      return;
    }

    if (!dashing && this.canDash(timeMs) && this.input.justPressed('dash', 16)) {
      this.startDash(timeMs);
      this.input.consumePress('dash');
    }

    // ─── Try to engage ledge grab ────────────────────────────────────
    // Conditions: airborne, side-touching a wall, and a static rect's
    // top edge sits within the player's grab window. Engages from a
    // jump-up-into-ledge OR a fall-past-ledge — both feel natural.
    if (
      !this.grounded &&
      this.wallSide !== 0 &&
      !dashing &&
      !knockedBack &&
      this.findLedge
    ) {
      const info = this.findLedge(
        this.body.x,
        this.body.x + this.body.width,
        this.body.y,
        this.wallSide as -1 | 1,
      );
      if (info) {
        this.enterLedgeGrab(info, this.wallSide as -1 | 1);
        this.updateFacing();
        this.wasClingLastFrame = false;
        return;
      }
    }

    // ─── Slide pole takes precedence over wall cling ─────────────────
    // When side-touching a slide pole and not pressing crouch/away, the
    // player rides the pole at PLAYER.slidePoleSpeed. Press JUMP to push
    // off horizontally + small upward kick. Press CROUCH or push AWAY
    // to release (free-fall through the regular path; if crouch is held
    // while airborne, the ground-pound block below will then take over —
    // makes "ride pole down, press crouch, slam" a natural chain).
    //
    // Only fires while descending: rising past a pole keeps the kid's
    // upward momentum intact (no surprise vy-clamp).
    let onSlidePole = false;
    const axisX = this.input.axisX();
    const sideForCheck = this.wallSide as -1 | 1;
    const pushingAwayFromPole =
      (this.wallSide === 1 && axisX < -0.2) ||
      (this.wallSide === -1 && axisX > 0.2);
    if (
      !this.grounded &&
      this.wallSide !== 0 &&
      !dashing &&
      !knockedBack &&
      !this.ledgeGrab &&
      this.findSlidePole &&
      this.body.velocity.y >= 0 &&
      !this.input.held('crouch') &&
      !pushingAwayFromPole
    ) {
      const info = this.findSlidePole(
        this.body.x,
        this.body.x + this.body.width,
        this.body.y + this.body.height / 2,
        sideForCheck,
      );
      if (info) onSlidePole = true;
    }

    const clinging = !onSlidePole && this.shouldWallCling(timeMs);

    if (dashing) {
      this.body.setVelocityX(PLAYER.dashSpeed * this.dashDir);
      this.body.setGravityY(0);
      this.body.setVelocityY(0);
    } else if (onSlidePole) {
      this.applySlidePole(timeMs);
    } else if (clinging) {
      this.applyWallCling(timeMs);
    } else if (knockedBack) {
      this.body.setGravityY(GRAVITY);
    } else {
      this.body.setGravityY(GRAVITY);
      this.applyHorizontal(dtSec, timeMs);
      this.applyJump(timeMs);
    }

    // Mario-style ground pound — fires regardless of which branch above
    // ran (skipped only for dashing, knockedBack, ledgeGrab — handled
    // by their own early-returns or velocity overrides). Latches the
    // `pounding` flag so Player.update can detect "just landed from
    // pound" and fire AOE impact damage + FX on the grounded transition.
    this.pounding = false;
    if (
      !this.grounded &&
      !knockedBack &&
      !dashing &&
      !clinging &&
      this.input.held('crouch')
    ) {
      if (this.body.velocity.y < PLAYER.poundSpeed) {
        this.body.setVelocityY(PLAYER.poundSpeed);
      }
      this.pounding = true;
    }

    this.applyVariableJumpCutoff();
    this.updateCrouch();
    this.updateState(timeMs, dashing, hurt, clinging);
    this.updateFacing();
    this.wasClingLastFrame = clinging;
  }

  // ─── Ledge grab ────────────────────────────────────────────────────

  private enterLedgeGrab(info: { topY: number; leftX: number; width: number }, side: -1 | 1): void {
    this.ledgeGrab = { topY: info.topY, leftX: info.leftX, width: info.width, side };
    // Snap body so its TOP aligns with the ledge top — player visually
    // hangs by their hands, body below the ledge.
    this.body.setVelocity(0, 0);
    this.body.setGravityY(0);
    this.body.y = info.topY;
    // Pin X to the ledge edge so we don't penetrate the wall.
    if (side === 1) {
      this.body.x = info.leftX - this.body.width;
    } else {
      this.body.x = info.leftX + info.width;
    }
    // Refill air jump on grab (treat ledge like ground for jump count).
    this.airJumpsRemaining = PLAYER.airJumps;
    this.jumpHeldThisJump = false;
    this.crouching = false; // standing pose while hanging
  }

  private releaseLedge(): void {
    this.ledgeGrab = null;
    this.body.setGravityY(GRAVITY);
  }

  /** Handle inputs while hanging. Returns having decided this tick. */
  private handleLedgeGrab(_timeMs: number): void {
    const lg = this.ledgeGrab!;

    // Re-pin position every frame so any sub-pixel physics drift can't
    // walk the body off the ledge.
    this.body.setVelocity(0, 0);
    this.body.setGravityY(0);
    this.body.y = lg.topY;
    if (lg.side === 1) {
      this.body.x = lg.leftX - this.body.width;
    } else {
      this.body.x = lg.leftX + lg.width;
    }

    // JUMP → climb up onto the platform.
    if (this.input.justPressed('jump', 16)) {
      this.input.consumePress('jump');
      this.climbLedge();
      return;
    }

    // DOWN → drop off cleanly.
    if (this.input.held('down')) {
      this.releaseLedge();
      this.body.setVelocityY(60); // small downward kick so we leave the edge
      return;
    }

    // AWAY → release and push off in the away direction.
    const axisX = this.input.axisX();
    const pushAway =
      (lg.side === 1 && axisX < -0.2) || (lg.side === -1 && axisX > 0.2);
    if (pushAway) {
      this.releaseLedge();
      this.body.setVelocityX(-lg.side * 220);
      this.body.setVelocityY(-180);
      return;
    }

    this.state = 'ledgeGrab';
  }

  private climbLedge(): void {
    const lg = this.ledgeGrab!;
    const inset = 6;
    let targetX: number;
    if (lg.width < this.body.width) {
      // Narrow rect (e.g. wall-tower wall): center the player on it
      // — they'll straddle the top with mild overhang on both sides.
      targetX = lg.leftX + (lg.width - this.body.width) / 2;
    } else if (lg.side === 1) {
      targetX = lg.leftX + inset;
    } else {
      targetX = lg.leftX + lg.width - this.body.width - inset;
    }
    this.body.x = targetX;
    this.body.y = lg.topY - this.body.height - 1;
    this.body.setVelocityX(0);
    this.body.setVelocityY(-160); // small bump up so we don't immediately collide back into the platform
    this.body.setGravityY(GRAVITY);
    this.airJumpsRemaining = PLAYER.airJumps;
    this.jumpHeldThisJump = true;
    this.state = 'jumpRise';
    this.ledgeGrab = null;
    this.emit('ledgeClimb');
  }

  snapshot(timeMs: number): MovementSnapshot {
    const dashing = timeMs < this.dashEndsAt;
    const hurt = timeMs < this.hurtUntil;
    return {
      state: this.state,
      facing: this.facing,
      vx: this.body.velocity.x,
      vy: this.body.velocity.y,
      grounded: this.grounded,
      wallSide: this.wallSide,
      coyoteRemainingMs: Math.max(0, PLAYER.coyoteMs - (timeMs - this.lastGroundedAt)),
      jumpBufferRemainingMs: Math.max(0, PLAYER.jumpBufferMs - (timeMs - this.lastJumpPressAt)),
      dashCooldownRemainingMs: Math.max(0, this.dashCooldownUntil - timeMs),
      dashing,
      crouching: this.crouching,
      hurt,
      airJumpsRemaining: this.airJumpsRemaining,
      pounding: this.pounding,
    };
  }

  getFacing(): 1 | -1 {
    return this.facing;
  }

  forceCancelDash(timeMs: number): void {
    this.dashEndsAt = Math.min(this.dashEndsAt, timeMs);
  }

  private applyHorizontal(dtSec: number, timeMs: number): void {
    if (timeMs < this.wallJumpLockoutUntil) return;
    const axisX = this.input.axisX();
    const target = axisX * PLAYER.runSpeed * (this.crouching && this.grounded ? 0.45 : 1);
    const accelMag = axisX !== 0 ? PLAYER.acceleration : PLAYER.deceleration;
    const accel = this.grounded ? accelMag : accelMag * PLAYER.airControl;
    const v = this.body.velocity.x;

    if (target > v) {
      this.body.setVelocityX(Math.min(target, v + accel * dtSec));
    } else if (target < v) {
      this.body.setVelocityX(Math.max(target, v - accel * dtSec));
    }
  }

  private applyJump(timeMs: number): void {
    const withinBuffer = timeMs - this.lastJumpPressAt <= PLAYER.jumpBufferMs;
    const withinCoyote = timeMs - this.lastGroundedAt <= PLAYER.coyoteMs;

    if (withinBuffer && withinCoyote && this.body.velocity.y >= -10) {
      this.body.setVelocityY(PLAYER.jumpVelocity);
      this.lastJumpPressAt = -Infinity;
      this.lastGroundedAt = -Infinity;
      this.jumpHeldThisJump = true;
      // Critical: consume the input press too, otherwise a held jump
      // button refreshes lastJumpPressAt next frame and the air-jump
      // branch silently spends the double-jump from the same press.
      this.input.consumePress('jump');
      return;
    }

    // Air (double) jump. Uses the same 120 ms jumpBuffer as the ground
    // jump (was a tight 16 ms single-frame window that sometimes missed
    // presses, especially under variable frame timing — that was the
    // "double jump didn't work" symptom). The wall-side gate is dropped
    // because applyJump only runs when NOT clinging, so the wall-jump
    // path can't conflict; brushing a wall mid-air no longer eats the
    // double jump.
    if (
      withinBuffer &&
      !this.grounded &&
      !withinCoyote &&
      this.airJumpsRemaining > 0
    ) {
      this.body.setVelocityY(PLAYER.doubleJumpVelocity);
      this.airJumpsRemaining--;
      this.lastJumpPressAt = -Infinity;
      this.jumpHeldThisJump = true;
      this.input.consumePress('jump');
    }
  }

  private applyVariableJumpCutoff(): void {
    if (!this.jumpHeldThisJump) return;
    if (!this.input.held('jump') && this.body.velocity.y < 0) {
      this.body.setVelocityY(this.body.velocity.y * PLAYER.variableJumpCutoff);
      this.jumpHeldThisJump = false;
    }
  }

  private canDash(timeMs: number): boolean {
    return timeMs >= this.dashCooldownUntil;
  }

  private startDash(timeMs: number): void {
    const axisX = this.input.axisX();
    this.dashDir = axisX !== 0 ? (axisX > 0 ? 1 : -1) : this.facing;
    this.dashEndsAt = timeMs + PLAYER.dashDurationMs;
    this.dashCooldownUntil = this.dashEndsAt + PLAYER.dashCooldownMs;
  }

  private shouldWallCling(timeMs: number): boolean {
    if (this.grounded) return false;
    if (this.wallSide === 0) return false;

    const axisX = this.input.axisX();
    const pushingToward =
      (this.wallSide === -1 && axisX < -0.2) || (this.wallSide === 1 && axisX > 0.2);
    const pushingAway =
      (this.wallSide === -1 && axisX > 0.2) || (this.wallSide === 1 && axisX < -0.2);

    // Initial engage requires (a) not actively rising — feels wrong to
    // mid-jump-snap onto a wall — and (b) pressing TOWARD the wall to
    // commit. Once committed, the cling latches (next branch).
    if (!this.wasClingLastFrame) {
      return this.body.velocity.y >= 0 && pushingToward;
    }

    // LATCH: once stuck, you stay stuck even on neutral input. Lets the
    // player release the stick, read the situation, then either jump or
    // press AWAY to drop. Pressing AWAY releases — UNLESS a jump press is
    // buffered the same frame, so press-AWAY+JUMP still resolves through
    // the wall-jump path (which fires in the away direction automatically).
    const jumpBuffered = timeMs - this.lastJumpPressAt <= PLAYER.jumpBufferMs;
    if (pushingAway && !jumpBuffered) return false;

    return true;
  }

  private applyWallCling(timeMs: number): void {
    // First frame of a fresh cling — capture start time and snap vy to 0
    // so the player visibly STICKS to the wall (no carry-over downward
    // momentum from the entry-jump descent). This gives a clean beat to
    // read the next move.
    if (!this.wasClingLastFrame) {
      this.wallClingStartedAt = timeMs;
      this.body.setVelocityY(0);
    }

    // Sticky window: vy clamped to 0. After the window, vy can drift down
    // to wallSlideSpeed (slow gentle descent — gives the player time to
    // climb up by repeated wall-jumping or to drop intentionally without
    // panic).
    const stickElapsed = timeMs - this.wallClingStartedAt;
    const sticky = stickElapsed < PLAYER.wallStickyMs;
    const targetMaxVy = sticky ? 0 : PLAYER.wallSlideSpeed;

    this.body.setGravityY(GRAVITY * 0.3);
    this.body.setVelocityY(Math.min(this.body.velocity.y, targetMaxVy));

    const withinBuffer = timeMs - this.lastJumpPressAt <= PLAYER.jumpBufferMs;
    if (withinBuffer) {
      this.body.setVelocityX(-this.wallSide * PLAYER.wallJumpVelocityX);
      this.body.setVelocityY(PLAYER.wallJumpVelocityY);
      this.wallJumpLockoutUntil = timeMs + PLAYER.wallJumpLockoutMs;
      this.lastJumpPressAt = -Infinity;
      this.jumpHeldThisJump = true;
      this.airJumpsRemaining = PLAYER.airJumps; // wall jump refills the air jump
      this.facing = -this.wallSide as 1 | -1;
      // Consume the input press so a held jump button doesn't refresh
      // lastJumpPressAt next frame and trigger an instant air-jump
      // during the wall-jump-lockout window.
      this.input.consumePress('jump');
      this.emit('wallJump');
    }
  }

  /**
   * Slide pole — controlled descent. Different shape from wall cling:
   *   - No sticky window (descent starts at slidePoleSpeed immediately).
   *   - Press JUMP → push off horizontally with small upward kick.
   *   - Press CROUCH (or DOWN axis) → release: gravity + free fall.
   *   - Push AWAY → release with a tiny lateral push.
   *
   * The dispatcher in update() doesn't call this if crouch is held or
   * if the player is pushing away — those release the slide and the
   * normal physics branch runs instead. So inside applySlidePole we
   * know the player intends to ride.
   */
  private applySlidePole(timeMs: number): void {
    // Constant slow descent.
    this.body.setGravityY(0);
    this.body.setVelocityY(PLAYER.slidePoleSpeed);
    this.body.setVelocityX(0);

    // Buffered jump → push off in the AWAY direction.
    const withinBuffer = timeMs - this.lastJumpPressAt <= PLAYER.jumpBufferMs;
    if (withinBuffer) {
      this.body.setVelocityX(-this.wallSide * PLAYER.slidePolePushX);
      this.body.setVelocityY(PLAYER.slidePolePushY);
      this.wallJumpLockoutUntil = timeMs + PLAYER.wallJumpLockoutMs;
      this.lastJumpPressAt = -Infinity;
      this.jumpHeldThisJump = true;
      this.airJumpsRemaining = PLAYER.airJumps;
      this.facing = -this.wallSide as 1 | -1;
      this.input.consumePress('jump');
      this.body.setGravityY(GRAVITY);
    }
  }

  private updateCrouch(): void {
    // Crouch fires while grounded AND the dedicated crouch action is held
    // (R2/L2 triggers, or DOWN/S as the keyboard fallback). Note: the
    // ledge-grab handler also reads `held('down')` to mean "drop", which
    // is fine — grounded vs ledge states are mutually exclusive, so the
    // same physical key can mean different things in different contexts.
    this.crouching = this.grounded && this.input.held('crouch');
  }

  private updateState(timeMs: number, dashing: boolean, hurt: boolean, clinging = false): void {
    if (hurt) {
      this.state = 'hurt';
      return;
    }
    if (dashing) {
      this.state = 'dash';
      return;
    }
    if (clinging) {
      this.state = 'wallCling';
      return;
    }
    if (timeMs < this.wallJumpLockoutUntil) {
      this.state = 'wallJump';
      return;
    }
    if (!this.grounded) {
      this.state = this.body.velocity.y < 0 ? 'jumpRise' : 'fall';
      return;
    }
    if (this.crouching) {
      this.state = 'crouch';
      return;
    }
    if (Math.abs(this.body.velocity.x) > 12) {
      this.state = 'run';
    } else {
      this.state = 'idle';
    }
  }

  private updateFacing(): void {
    const axisX = this.input.axisX();
    if (axisX > 0.1) this.facing = 1;
    else if (axisX < -0.1) this.facing = -1;
  }
}

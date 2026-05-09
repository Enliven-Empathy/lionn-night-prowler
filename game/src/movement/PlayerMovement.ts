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
  | 'land'
  | 'hurt';

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
  private movementLocked = false;

  constructor(body: Phaser.Physics.Arcade.Body, input: InputController) {
    this.body = body;
    this.input = input;
    this.body.setMaxVelocity(10000, PLAYER.maxFallSpeed);
    this.body.setGravityY(GRAVITY);
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

    const clinging = this.shouldWallCling(timeMs);

    if (dashing) {
      this.body.setVelocityX(PLAYER.dashSpeed * this.dashDir);
      this.body.setGravityY(0);
      this.body.setVelocityY(0);
    } else if (clinging) {
      this.applyWallCling(timeMs);
    } else if (knockedBack) {
      this.body.setGravityY(GRAVITY);
    } else {
      this.body.setGravityY(GRAVITY);
      this.applyHorizontal(dtSec, timeMs);
      this.applyJump(timeMs);
    }

    this.applyVariableJumpCutoff();
    this.updateCrouch();
    this.updateState(timeMs, dashing, hurt, clinging);
    this.updateFacing();
    this.wasClingLastFrame = clinging;
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
    }
  }

  private updateCrouch(): void {
    this.crouching = this.grounded && this.input.held('down');
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

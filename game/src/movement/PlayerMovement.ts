import Phaser from 'phaser';
import { PLAYER, GRAVITY } from '../core/constants';
import { InputController } from '../core/input';

export type MovementState = 'idle' | 'run' | 'jumpRise' | 'fall' | 'dash' | 'land';

export interface MovementSnapshot {
  state: MovementState;
  facing: 1 | -1;
  vx: number;
  vy: number;
  grounded: boolean;
  coyoteRemainingMs: number;
  jumpBufferRemainingMs: number;
  dashCooldownRemainingMs: number;
  dashing: boolean;
}

export class PlayerMovement {
  private body: Phaser.Physics.Arcade.Body;
  private input: InputController;

  private facing: 1 | -1 = 1;
  private grounded = false;
  private state: MovementState = 'idle';

  private lastGroundedAt = -Infinity;
  private lastJumpPressAt = -Infinity;
  private jumpHeldThisJump = false;

  private dashEndsAt = -Infinity;
  private dashCooldownUntil = -Infinity;
  private dashDir: 1 | -1 = 1;

  constructor(body: Phaser.Physics.Arcade.Body, input: InputController) {
    this.body = body;
    this.input = input;
    this.body.setMaxVelocity(10000, PLAYER.maxFallSpeed);
    this.body.setGravityY(GRAVITY);
  }

  update(timeMs: number, dtSec: number): void {
    this.grounded = this.body.blocked.down || this.body.touching.down;
    if (this.grounded) {
      this.lastGroundedAt = timeMs;
      this.jumpHeldThisJump = false;
    }

    if (this.input.justPressed('jump', 16)) {
      this.lastJumpPressAt = timeMs;
    }

    const dashing = timeMs < this.dashEndsAt;

    if (!dashing && this.canDash(timeMs) && this.input.justPressed('dash', 16)) {
      this.startDash(timeMs);
      this.input.consumePress('dash');
    }

    if (dashing) {
      this.body.setVelocityX(PLAYER.dashSpeed * this.dashDir);
      this.body.setGravityY(0);
      this.body.setVelocityY(0);
    } else {
      this.body.setGravityY(GRAVITY);
      this.applyHorizontal(dtSec);
      this.applyJump(timeMs);
    }

    this.applyVariableJumpCutoff();
    this.updateState(timeMs, dashing);
    this.updateFacing();
  }

  snapshot(timeMs: number): MovementSnapshot {
    const dashing = timeMs < this.dashEndsAt;
    return {
      state: this.state,
      facing: this.facing,
      vx: this.body.velocity.x,
      vy: this.body.velocity.y,
      grounded: this.grounded,
      coyoteRemainingMs: Math.max(0, PLAYER.coyoteMs - (timeMs - this.lastGroundedAt)),
      jumpBufferRemainingMs: Math.max(0, PLAYER.jumpBufferMs - (timeMs - this.lastJumpPressAt)),
      dashCooldownRemainingMs: Math.max(0, this.dashCooldownUntil - timeMs),
      dashing,
    };
  }

  private applyHorizontal(dtSec: number): void {
    const axisX = this.input.axisX();
    const target = axisX * PLAYER.runSpeed;
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

  private updateState(timeMs: number, dashing: boolean): void {
    if (dashing) {
      this.state = 'dash';
      return;
    }
    if (!this.grounded) {
      this.state = this.body.velocity.y < 0 ? 'jumpRise' : 'fall';
      return;
    }
    if (Math.abs(this.body.velocity.x) > 12) {
      this.state = 'run';
    } else {
      this.state = 'idle';
    }
    void timeMs;
  }

  private updateFacing(): void {
    const axisX = this.input.axisX();
    if (axisX > 0.1) this.facing = 1;
    else if (axisX < -0.1) this.facing = -1;
  }
}

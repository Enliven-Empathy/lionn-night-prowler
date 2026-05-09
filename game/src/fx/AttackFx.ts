import Phaser from 'phaser';
import { AttackData } from '../combat/types';

/**
 * Primitive-only attack visualization. Three pieces:
 *
 *   1. telegraph — pulsing outline ring around the attacker during startup;
 *      tells the player an attack is winding up so they can react.
 *
 *   2. slash — a bright rectangular flash at the hitbox location during the
 *      active phase, scaled outward and fading. Distinct color per team
 *      (violet for player, pink/red for enemy) so combat reads at a glance.
 *
 *   3. lunge — temporarily stretches the attacker's body in the facing
 *      direction (squash on startup, stretch on active) for an unmistakable
 *      "throwing a punch" silhouette without sprite art.
 *
 * All three are stateless helpers — they spawn ephemeral objects that
 * destroy themselves on tween completion. No update loop, no manual cleanup.
 */
export type AttackTeam = 'player' | 'enemy';

const COLORS = {
  player: { slash: 0xb47bff, glow: 0x9b59ff, core: 0xffffff },
  enemy:  { slash: 0xff6b8a, glow: 0xff5b8a, core: 0xffffff },
};

export class AttackFx {
  private scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** Pulsing outline ring on the attacker. Length should match startup frames. */
  telegraph(target: Phaser.GameObjects.Rectangle, durationMs: number, team: AttackTeam): void {
    const c = COLORS[team];
    const ring = this.scene.add.rectangle(
      target.x,
      target.y,
      target.width + 6,
      target.height + 6,
      0,
      0,
    );
    ring.setStrokeStyle(3, c.glow, 0.9);
    ring.setDepth(target.depth + 1);
    ring.setBlendMode(Phaser.BlendModes.ADD);

    // Follow the attacker through the telegraph.
    const followEvent = this.scene.time.addEvent({
      delay: 16,
      loop: true,
      callback: () => {
        ring.x = target.x;
        ring.y = target.y;
      },
    });

    this.scene.tweens.add({
      targets: ring,
      scaleX: 1.25,
      scaleY: 1.25,
      alpha: 0,
      duration: durationMs,
      ease: 'Quad.easeOut',
      onComplete: () => {
        followEvent.destroy();
        ring.destroy();
      },
    });
  }

  /** Bright flash at the hitbox for the duration of the active phase. */
  slash(originX: number, originY: number, facing: 1 | -1, attack: AttackData, team: AttackTeam): void {
    const c = COLORS[team];
    const hb = attack.hitbox;
    const cx = originX + hb.offsetX * facing;
    const cy = originY + hb.offsetY;

    // Wide slash arc — slightly tilted blade trail. ADD blend keeps it punchy.
    const slash = this.scene.add.rectangle(cx, cy, hb.w * 1.05, hb.h * 0.55, c.slash, 0.85);
    slash.setRotation((facing === 1 ? -1 : 1) * (Math.PI / 14));
    slash.setBlendMode(Phaser.BlendModes.ADD);
    slash.setDepth(900);

    this.scene.tweens.add({
      targets: slash,
      scaleX: 1.5,
      scaleY: 0.4,
      alpha: 0,
      duration: Math.max(140, attack.activeMs * 1.3),
      ease: 'Quad.easeOut',
      onComplete: () => slash.destroy(),
    });

    // Hot core line through the middle for extra contrast.
    const core = this.scene.add.rectangle(cx, cy, hb.w * 0.9, 4, c.core, 1);
    core.setRotation((facing === 1 ? 1 : -1) * (Math.PI / 9));
    core.setBlendMode(Phaser.BlendModes.ADD);
    core.setDepth(901);

    this.scene.tweens.add({
      targets: core,
      scaleX: 1.4,
      alpha: 0,
      duration: Math.max(110, attack.activeMs * 1.0),
      ease: 'Quad.easeOut',
      onComplete: () => core.destroy(),
    });
  }

  /**
   * Combo-finisher overlay — fires on top of the regular slash when the
   * third hit of claw_1 → claw_2 → claw_3 connects. Stack of effects:
   *
   *   1. Outward ring shockwave (centered on the impact point) that
   *      expands and fades — reads as a heavy concussive blow.
   *   2. Twin counter-rotated slash bars on top of the standard slash for
   *      a "two-hits-in-one" silhouette.
   *   3. Brief screen-fill flash sliver (low alpha) for "snap" of impact.
   *
   * Stateless, ephemeral — same lifecycle pattern as slash().
   */
  finisher(originX: number, originY: number, facing: 1 | -1, attack: AttackData, team: AttackTeam): void {
    const c = COLORS[team];
    const hb = attack.hitbox;
    const cx = originX + hb.offsetX * facing;
    const cy = originY + hb.offsetY;

    // Shockwave ring — empty fill, thick stroke, expands outward.
    const ring = this.scene.add.circle(cx, cy, 18, 0, 0);
    ring.setStrokeStyle(5, c.glow, 0.9);
    ring.setBlendMode(Phaser.BlendModes.ADD);
    ring.setDepth(905);
    this.scene.tweens.add({
      targets: ring,
      scaleX: 4.0,
      scaleY: 4.0,
      alpha: 0,
      duration: 360,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });

    // Twin slashes — counter-rotated for a chiasm/X look.
    for (const angle of [-Math.PI / 4, Math.PI / 4]) {
      const blade = this.scene.add.rectangle(cx, cy, hb.w * 1.2, hb.h * 0.35, c.core, 0.95);
      blade.setRotation(angle * (facing === 1 ? 1 : -1));
      blade.setBlendMode(Phaser.BlendModes.ADD);
      blade.setDepth(906);
      this.scene.tweens.add({
        targets: blade,
        scaleX: 1.7,
        scaleY: 0.25,
        alpha: 0,
        duration: 220,
        ease: 'Quad.easeOut',
        onComplete: () => blade.destroy(),
      });
    }

    // Brief screen flash — full-canvas tint, low alpha, scrolls with
    // camera so it reads as full-screen even while the camera moves.
    const cam = this.scene.cameras.main;
    const flash = this.scene.add.rectangle(
      cam.scrollX + cam.width / 2,
      cam.scrollY + cam.height / 2,
      cam.width + 200,
      cam.height + 200,
      c.slash,
      0.18,
    );
    flash.setBlendMode(Phaser.BlendModes.ADD);
    flash.setDepth(902);
    flash.setScrollFactor(0);
    this.scene.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 140,
      ease: 'Quad.easeOut',
      onComplete: () => flash.destroy(),
    });
  }

  /**
   * Ground-pound landing impact. Different from the slash/finisher pair
   * because the affordance is "I just slammed into the floor", not "I
   * swung a blade". Stack:
   *
   *   1. Wide low ring shockwave (centered at the player's feet),
   *      expanding outward — bigger and flatter than a finisher ring so
   *      it reads as a horizontal blast wave.
   *   2. Twin horizontal dust streaks shooting LEFT and RIGHT from feet
   *      — gives the impact a tangible "out from under me" radial
   *      direction without having to spawn particles.
   *   3. Brief screen flash, same alpha as the finisher's, so the kid
   *      gets the same "snap" cue as a heavy-hit landing.
   *
   * `feetY` is world-Y of the impact line (player.body.bottom). Stateless
   * and ephemeral, same lifecycle as slash() / finisher().
   */
  poundImpact(originX: number, feetY: number, team: AttackTeam): void {
    const c = COLORS[team];

    // Wide low ring — squashed vertically so it reads as a ground-level
    // shockwave instead of a sphere blast.
    const ring = this.scene.add.ellipse(originX, feetY, 60, 22, 0, 0);
    ring.setStrokeStyle(5, c.glow, 0.95);
    ring.setBlendMode(Phaser.BlendModes.ADD);
    ring.setDepth(905);
    this.scene.tweens.add({
      targets: ring,
      scaleX: 5.0,
      scaleY: 3.5,
      alpha: 0,
      duration: 380,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });

    // Horizontal dust streaks — left + right.
    for (const dir of [-1, 1] as const) {
      const streak = this.scene.add.rectangle(
        originX + dir * 36,
        feetY - 6,
        70,
        12,
        c.core,
        0.85,
      );
      streak.setBlendMode(Phaser.BlendModes.ADD);
      streak.setDepth(906);
      this.scene.tweens.add({
        targets: streak,
        x: originX + dir * 130,
        scaleX: 2.4,
        scaleY: 0.4,
        alpha: 0,
        duration: 260,
        ease: 'Quad.easeOut',
        onComplete: () => streak.destroy(),
      });
    }

    // Screen flash — same code path as finisher, less alpha.
    const cam = this.scene.cameras.main;
    const flash = this.scene.add.rectangle(
      cam.scrollX + cam.width / 2,
      cam.scrollY + cam.height / 2,
      cam.width + 200,
      cam.height + 200,
      c.slash,
      0.16,
    );
    flash.setBlendMode(Phaser.BlendModes.ADD);
    flash.setDepth(902);
    flash.setScrollFactor(0);
    this.scene.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 160,
      ease: 'Quad.easeOut',
      onComplete: () => flash.destroy(),
    });
  }

  /**
   * Squash-then-stretch the attacker's body to read as a swing.
   * Returns a cleanup function to call when the attack ends, in case the
   * tween outlives the attack (interrupted by hurt, etc).
   */
  lunge(target: Phaser.GameObjects.Rectangle, attack: AttackData, facing: 1 | -1): () => void {
    const baseScaleX = target.scaleX;
    const baseScaleY = target.scaleY;

    // Wind-up: squat (compress vertically, slight horizontal squish).
    this.scene.tweens.add({
      targets: target,
      scaleX: baseScaleX * 0.94,
      scaleY: baseScaleY * 1.05,
      duration: attack.startupMs * 0.9,
      ease: 'Quad.easeOut',
    });
    // Strike: stretch in facing direction, slim vertically.
    this.scene.tweens.add({
      targets: target,
      scaleX: baseScaleX * (1 + 0.18 * facing) * facing,
      scaleY: baseScaleY * 0.92,
      duration: attack.activeMs,
      delay: attack.startupMs,
      ease: 'Quad.easeOut',
    });
    // Settle: ease back to base.
    this.scene.tweens.add({
      targets: target,
      scaleX: baseScaleX,
      scaleY: baseScaleY,
      duration: attack.recoveryMs,
      delay: attack.startupMs + attack.activeMs,
      ease: 'Quad.easeOut',
    });

    return () => {
      this.scene.tweens.killTweensOf(target);
      target.scaleX = baseScaleX;
      target.scaleY = baseScaleY;
    };
  }
}

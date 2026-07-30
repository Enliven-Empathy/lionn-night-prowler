import Phaser from 'phaser';
import { AttackData } from '../combat/types';

/**
 * Enemy attack readability layer.
 *
 * The contract this exists to deliver, stated the way a six-year-old can
 * hold it: **the bar fills up, then it hits.** Every damaging enemy
 * attack paints a marker on the ground covering exactly the area its
 * hitbox will occupy, with a fill bar that reaches 100% on the precise
 * frame the hitbox goes live.
 *
 * ── Two hard constraints, both learned from existing bugs ────────────
 *
 * 1. NOTHING here may tween the enemy's body sprite. `AttackFx.lunge`'s
 *    cleanup calls `scene.tweens.killTweensOf(target)`, which destroys
 *    EVERY tween on that object — so a body-scale telegraph would be
 *    silently cancelled the next time an attack ended. All FX live on
 *    their own game objects.
 *
 * 2. Every effect returns a `TelegraphHandle` with `cancel()`. The
 *    pre-existing `AttackFx.telegraph()` has no cancel path: an
 *    interrupted attack leaves its ring animating, and its 16 ms follow
 *    timer keeps ticking against a sprite that may already have been
 *    destroyed. Interruption is the common case here (poise, dizzy,
 *    death, grab), so cancellation is part of the API, not an
 *    afterthought.
 *
 * Depths are chosen to actually be visible. For reference, the existing
 * `AttackFx.telegraph()` ring renders at `target.depth + 1` — and since
 * `Patrol` never sets a depth, that resolves to 1, i.e. *behind* the
 * terrain decorations, the slash FX (900) and the enemy health bar
 * (910). It has effectively never been visible in play.
 */

/** Ground markers sit above terrain but below slash FX (900). */
const DEPTH_MARKER = 880;
/** Overhead pips sit above the enemy health bar container (910). */
const DEPTH_PIP = 915;

/** Amber → red as the wind-up completes. Deliberately the same danger
 *  family as the spike hazard the kid already knows. */
const COL_WARN_EARLY = 0xff8c1a;
const COL_WARN_LATE = 0xff2d2d;
const COL_ALERT_PIP = 0xffd86a;
const COL_RECOVERY_PIP = 0xffffff;

export interface TelegraphHandle {
  /** Tear down immediately. Safe to call twice. */
  cancel(): void;
}

const NOOP_HANDLE: TelegraphHandle = { cancel: () => {} };

/**
 * Resolve where an attack's hitbox will land in world space, using the
 * same maths as `Hitbox.worldRect()` so the marker and the real hitbox
 * can never disagree.
 */
export function projectHitboxRect(
  attack: AttackData,
  ownerX: number,
  ownerY: number,
  facing: 1 | -1,
  scale: number,
): { x: number; y: number; w: number; h: number } {
  const { offsetX, offsetY, w, h } = attack.hitbox;
  const cx = ownerX + offsetX * scale * facing;
  const cy = ownerY + offsetY * scale;
  const sw = w * scale;
  const sh = h * scale;
  return { x: cx - sw / 2, y: cy - sh / 2, w: sw, h: sh };
}

export class TelegraphFx {
  private scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /**
   * Ground danger marker. An outlined footprint of the incoming hitbox
   * plus a fill bar that sweeps 0 → 1 over `durationMs`, timed so it
   * completes exactly as the attack's active frames begin.
   *
   * `durationMs` should be the attack's startupMs (already scaled by
   * any difficulty modifier), NOT the raw table value — the boss
   * wake-up counter shortens startup on a clone.
   */
  dangerMarker(
    rect: { x: number; y: number; w: number; h: number },
    durationMs: number,
  ): TelegraphHandle {
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;

    const outline = this.scene.add.rectangle(cx, cy, rect.w, rect.h, COL_WARN_LATE, 0.14);
    outline.setStrokeStyle(2, COL_WARN_EARLY, 0.85);
    outline.setDepth(DEPTH_MARKER);

    // Fill bar grows from the left edge. Origin 0 on x so scaleX maps
    // directly to "fraction of the wind-up elapsed".
    const fill = this.scene.add.rectangle(rect.x, cy, rect.w, rect.h, COL_WARN_LATE, 0.30);
    fill.setOrigin(0, 0.5);
    fill.setDepth(DEPTH_MARKER);
    fill.setScale(0, 1);

    const tweens: Phaser.Tweens.Tween[] = [];
    tweens.push(this.scene.tweens.add({
      targets: fill,
      scaleX: 1,
      duration: Math.max(1, durationMs),
      ease: 'Linear',
    }));
    // Outline pulses so the marker reads even against a busy backdrop.
    tweens.push(this.scene.tweens.add({
      targets: outline,
      alpha: { from: 0.10, to: 0.26 },
      duration: 180,
      yoyo: true,
      repeat: -1,
    }));

    let done = false;
    return {
      cancel: () => {
        if (done) return;
        done = true;
        for (const t of tweens) t.remove();
        outline.destroy();
        fill.destroy();
      },
    };
  }

  /**
   * "It connected" pop — the marker snapping to full at the impact
   * frame. Fire-and-forget; self-destroys.
   */
  markerImpact(rect: { x: number; y: number; w: number; h: number }): void {
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    const pop = this.scene.add.rectangle(cx, cy, rect.w, rect.h, 0xffffff, 0.55);
    pop.setDepth(DEPTH_MARKER + 1);
    pop.setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({
      targets: pop,
      alpha: 0,
      scaleX: 1.12,
      scaleY: 1.12,
      duration: 140,
      ease: 'Quad.easeOut',
      onComplete: () => pop.destroy(),
    });
  }

  /**
   * Overhead state pip. Follows the sprite each frame via an explicit
   * `follow()` call from the owner's update rather than an internal
   * timer — the pre-existing ring's 16 ms `loop: true` timer outlives
   * its target and is exactly the leak we're avoiding.
   */
  pip(x: number, y: number, kind: 'alert' | 'windup' | 'recovery'): PipHandle {
    const color =
      kind === 'alert' ? COL_ALERT_PIP :
      kind === 'windup' ? COL_WARN_LATE :
      COL_RECOVERY_PIP;

    // '!' for alert/wind-up: a tall bar plus a dot. A chevron for
    // recovery, which reads as "now — hit me".
    const parts: Phaser.GameObjects.Rectangle[] = [];
    if (kind === 'recovery') {
      const bar = this.scene.add.rectangle(x, y, 14, 4, color, 0.95);
      bar.setDepth(DEPTH_PIP);
      parts.push(bar);
    } else {
      const stem = this.scene.add.rectangle(x, y - 3, 4, 12, color, 0.95);
      const dot = this.scene.add.rectangle(x, y + 7, 4, 4, color, 0.95);
      stem.setDepth(DEPTH_PIP);
      dot.setDepth(DEPTH_PIP);
      parts.push(stem, dot);
    }

    let pulse: Phaser.Tweens.Tween | null = null;
    if (kind === 'windup') {
      pulse = this.scene.tweens.add({
        targets: parts,
        alpha: { from: 0.45, to: 1 },
        duration: 120,
        yoyo: true,
        repeat: -1,
      });
    }

    let done = false;
    return {
      follow: (nx: number, ny: number) => {
        if (done) return;
        for (const p of parts) {
          p.x = nx;
          // Preserve each part's original vertical offset.
          p.y = ny + (p === parts[1] ? 7 : kind === 'recovery' ? 0 : -3);
        }
      },
      cancel: () => {
        if (done) return;
        done = true;
        pulse?.remove();
        for (const p of parts) p.destroy();
      },
    };
  }

  /**
   * Body tint for the wind-up ramp. Returns the interpolated colour so
   * the caller can assign it to `sprite.fillColor` directly — assignment,
   * not a tween, precisely because `killTweensOf` would eat a tween.
   */
  static rampColor(from: number, to: number, t: number): number {
    const c = Phaser.Display.Color.Interpolate.ColorWithColor(
      Phaser.Display.Color.ValueToColor(from),
      Phaser.Display.Color.ValueToColor(to),
      100,
      Math.round(Phaser.Math.Clamp(t, 0, 1) * 100),
    );
    return (c.r << 16) | (c.g << 8) | c.b;
  }
}

export interface PipHandle extends TelegraphHandle {
  follow(x: number, y: number): void;
}

export const NO_TELEGRAPH = NOOP_HANDLE;

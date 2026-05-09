import Phaser from 'phaser';

/**
 * Slide pole — a thin vertical bar the player descends at a controlled
 * slow speed when in side-contact while airborne. Distinct from a regular
 * wall because:
 *
 *   - Contact is automatic (no need to hold direction toward the pole).
 *   - No sticky-cling window — descent starts immediately at the slow speed.
 *   - Press JUMP → push off horizontally + small upward kick.
 *   - Press DOWN/CROUCH → release the slide; the player free-falls.
 *   - Press AWAY → release with a tiny lateral push.
 *
 * Visually distinguished from regular poles (purple) by a cyan stripe
 * pattern so the kid can read the affordance at a glance.
 *
 * The pole's static body is added to the level's staticGroup so the
 * player's normal collider resolves contact. The slide-pole BEHAVIOR
 * is keyed by the SlidePoleQuery callback in PlayerMovement, which
 * walks GameScene's slidePoles list.
 */

const COL_SHAFT = 0x1a4a6a;
const COL_GLOW = 0x6ad4ff;

export class SlidePole {
  readonly sprite: Phaser.GameObjects.Rectangle;
  readonly worldX: number;
  readonly topY: number;
  readonly heightPx: number;
  readonly widthPx = 16;

  private bounds = new Phaser.Geom.Rectangle();

  constructor(
    scene: Phaser.Scene,
    x: number,
    topY: number,
    heightPx: number,
    staticGroup: Phaser.Physics.Arcade.StaticGroup,
  ) {
    this.worldX = x;
    this.topY = topY;
    this.heightPx = heightPx;

    const cx = x + this.widthPx / 2;
    const cy = topY + heightPx / 2;
    this.sprite = scene.add.rectangle(cx, cy, this.widthPx, heightPx, COL_SHAFT);
    this.sprite.setStrokeStyle(2, COL_GLOW, 0.95);
    this.sprite.setDepth(40);
    scene.physics.add.existing(this.sprite, true);
    staticGroup.add(this.sprite);

    // Glow stripe down the middle for visual distinction from purple poles.
    const stripe = scene.add.rectangle(cx, cy, 4, heightPx - 8, COL_GLOW, 0.6);
    stripe.setBlendMode(Phaser.BlendModes.ADD);
    stripe.setDepth(41);
  }

  /** AABB of the pole's footprint — used by the SlidePoleQuery to
   *  decide whether the player is in side-contact at the right height. */
  hitRect(): Phaser.Geom.Rectangle {
    this.bounds.setTo(this.worldX, this.topY, this.widthPx, this.heightPx);
    return this.bounds;
  }

  destroy(): void {
    this.sprite.destroy();
  }
}

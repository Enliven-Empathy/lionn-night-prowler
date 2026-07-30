export const VIEW = {
  width: 1280,
  height: 720,
} as const;

export const GRAVITY = 1700;

export const PLAYER = {
  width: 38,
  height: 64,
  /** Body height while crouched. Shorter so the player physically fits
   *  under low overhangs (their head no longer occupies the standing-
   *  height row). Body's bottom edge stays pinned at the same Y; only
   *  the top edge drops. */
  crouchHeight: 36,
  /** Visual squash factor while crouched. Sprite center stays at the
   *  same Y, so this also shifts the sprite a bit to keep the visual
   *  feet roughly aligned with the physics feet. */
  crouchScaleY: 0.55,

  runSpeed: 290,
  acceleration: 2100,
  deceleration: 2600,
  airControl: 0.65,

  jumpVelocity: -570,
  variableJumpCutoff: 0.5,
  coyoteMs: 100,
  jumpBufferMs: 120,

  dashSpeed: 1400,
  dashDurationMs: 67,    // was 95 — another 30% shorter (133px → ~94px burst)
  dashCooldownMs: 380,   // shorter dash + faster recovery keeps it punchy

  // Double jump: one extra mid-air jump, recharges on ground/wall-jump.
  airJumps: 1,
  doubleJumpVelocity: -520,

  maxFallSpeed: 1400,
  /** Mario-style ground pound: while airborne with crouch held, vy is
   *  clamped to (at least) this downward speed. Tuned above the patrol
   *  fall-kill threshold (700) so a pound landing on an enemy registers
   *  as a fatal impact via the existing patrol fall-kill check. */
  poundSpeed: 950,

  // Slide pole — controlled vertical descent.
  /** Constant downward speed while riding a slide pole. Slow enough that
   *  the kid feels in control (220 px/s ≈ 3.5 px/frame at 60fps), well
   *  below natural terminal fall speeds. */
  slidePoleSpeed: 220,
  /** Horizontal velocity imparted on jump push-off from a slide pole.
   *  A bit lower than wall-jump's 360 because the slide pole is meant
   *  for descending more than for chaining traversal. */
  slidePolePushX: 320,
  /** Vertical velocity imparted on jump push-off (negative = up). */
  slidePolePushY: -350,

  // Wall cling: stick to a wall while pressing toward it in the air.
  /** First-contact stick duration. While clinging within this window the
   *  player's vy is clamped to 0 — they stop dead on the wall. Gives a
   *  beat to read the next wall-jump direction. After the window closes,
   *  vy is clamped to wallSlideSpeed (gentle descent) until they jump
   *  off or release. */
  wallStickyMs: 500,
  wallSlideSpeed: 50,
  wallJumpVelocityX: 360,
  wallJumpVelocityY: -540,
  wallJumpLockoutMs: 180,

  maxHp: 10,
  hurtKnockback: { x: 220, y: -260 },
  hurtInvulnMs: 700,

  // Reachability: how high above the *ground top* a platform's TOP can sit
  // and still be landable. This is NOT the body-center peak — it accounts for:
  //   - body half-height (32 px) — the player's feet must reach the platform top
  //   - a safety margin so jump-buffering edge cases still work
  //
  // Math:
  //   single jump body-center rise:  570²/(2·1700) = 95.6 px
  //   double jump body-center rise: +520²/(2·1700) = 79.5 px
  //   total body-center rise: ~175 px → max body-bottom rise: same ~175 px
  //   So the highest platform-top above ground-top that the player can stand
  //   on is ~175 - 0 (feet at peak) = ~175 px. We cap at 130 for a generous
  //   safety margin (player can still reach with margin even with imperfect timing).
  jumpReachPx: 130,
  // Wall-jump bonus when a wall is adjacent (cling height + wall-launch arc).
  // Wall-jump velocity is -540, so an additional ~85 px above cling height,
  // and the player can re-double-jump from there. We cap the bonus at 80
  // for safety (so wall-paired platforms top out ~210 px above ground).
  wallJumpBonusReachPx: 80,
} as const;

/** How much of an enemy's body scale carries into its hitbox SIZE. The
 *  hitbox OFFSET always scales fully (a bigger body swings from further
 *  out), but scaling the sweep itself by the full body scale made the
 *  2.0x Night Sovereign reach 192px inside a 440ms wind-up — more than
 *  the 187px a player covers even by running AND dashing, i.e. an
 *  unavoidable hit. Damping keeps big bosses weighty but evadable. */
export const HITBOX_SIZE_SCALE_DAMPING = 0.6;

export const COMBAT = {
  comboResetMs: 360,
  attackBufferMs: 110,
} as const;

export const OVERHANG = {
  /** Y of the overhang's BOTTOM edge above the ground top. Tuned so that
   *  a standing player (body top y = ground - 64 = ground - 64) hits it,
   *  but a crouched player (body top y = ground - 36) clears it cleanly.
   *  Setting it 4 px above standing body top means standing players
   *  always bonk; crouched players have ~24 px head clearance. */
  bottomFromGround: 60,
  /** Total height of the overhang block (visual + damage zone). */
  height: 24,
  /** Default width in px. */
  defaultWidth: 130,
  /** Damage on contact when player is not crouched. */
  damage: 2,
  knockbackX: 0,
  knockbackY: 220, // pushes the player DOWN — crouches them under the obstacle
  hitstopMs: 70,
} as const;

export const SPIKES = {
  /** Damage per touch when spikes are extended. Player has 700ms invuln after,
   *  so repeated bounces won't multi-tap-kill. */
  damage: 4,
  knockbackX: 0,
  knockbackY: -360,
  hitstopMs: 90,
  /** Visible width / height in px. Width is approximate (rounded to spike count). */
  defaultWidth: 130,
  spikeHeight: 18,
} as const;

export const WALL_TOWER = {
  wallW: 22,
  wallH: 240,
  /** Distance between the two walls' inner faces. Tuned to be narrow enough
   *  that wall-jump arc reaches the opposite wall reliably. */
  wallGapPx: 78,
  /** Distance from wall BOTTOM to ground top. Without this gap, the walls
   *  would form an impassable barrier at ground level — there'd be no way
   *  to get *into* the chute. Player walks under the walls at ground level,
   *  then jumps UP into the chute and starts the wall-jump climb. */
  bottomGapPx: 110,
  /** Tier-3 reward Y offset above wall top. */
  rewardYOffset: 36,
} as const;

export const COLORS = {
  background: 0x0e0a18,
  ground: 0x2a2236,
  groundEdge: 0x4a3a64,
  platform: 0x3a2e4f,
  platformEdge: 0x6a4d92,
  player: 0x6a3fbe,
  playerDash: 0xb47bff,
  playerHurt: 0xff6680,
} as const;

export const DEBUG = {
  showOverlay: true,
  showHitboxes: false,
} as const;

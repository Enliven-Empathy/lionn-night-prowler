export const VIEW = {
  width: 1280,
  height: 720,
} as const;

export const GRAVITY = 1700;

export const PLAYER = {
  width: 38,
  height: 64,

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

  // Wall cling: stick to a wall while pressing toward it in the air.
  wallSlideSpeed: 110,
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

export const COMBAT = {
  hitPauseMs: 70,
  hitPauseHeavyMs: 110,
  comboResetMs: 360,
  attackBufferMs: 110,
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
  wallH: 320,
  /** Distance between the two walls' inner faces. Tuned to be narrow enough
   *  that wall-jump arc reaches the opposite wall reliably. */
  wallGapPx: 78,
  /** Tier-3 reward Y offset above wall top. */
  rewardYOffset: 36,
} as const;

export const ENEMY = {
  cutter: {
    width: 56,
    height: 78,
    runSpeed: 175,
    chaseSpeed: 230,
    dashSpeed: 720,
    maxHp: 5,
    detectRangeX: 360,
    detectRangeY: 130,
    attackRangeX: 70,
    attackRangeY: 60,
    knockbackResist: 0.6,
  },
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

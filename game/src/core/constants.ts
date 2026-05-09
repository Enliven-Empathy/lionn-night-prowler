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
  dashDurationMs: 95,
  dashCooldownMs: 520,

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

  // Reachability: how high above its origin the player can rise.
  //   single jump  ½·v²/g = 570²/(2·1700) ≈ 95.6 px
  //   double jump  + 520²/(2·1700) ≈ 79.5 px
  //   total ~175 px — cap at 160 for a safety margin.
  jumpReachPx: 160,
  // Wall-jump bonus reach when a wall is adjacent (cling height + jump arc).
  wallJumpBonusReachPx: 110,
} as const;

export const COMBAT = {
  hitPauseMs: 70,
  hitPauseHeavyMs: 110,
  comboResetMs: 360,
  attackBufferMs: 110,
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

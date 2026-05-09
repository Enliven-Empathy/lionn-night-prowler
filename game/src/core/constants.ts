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

  dashSpeed: 1500,
  dashDurationMs: 140,
  dashCooldownMs: 550,

  maxFallSpeed: 1400,
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

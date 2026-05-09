/**
 * Typed SFX key constants. Mirrors `tools/sfx-gen/src/manifest.ts` (the
 * generator side of truth). If this drifts from the actual files in
 * game/public/assets/audio/, AudioManager.play silently no-ops thanks to
 * a cache-existence check.
 */
export const SFX = {
  PLAYER_JUMP: 'player_jump',
  PLAYER_DOUBLE_JUMP: 'player_double_jump',
  PLAYER_LAND: 'player_land',
  PLAYER_DASH: 'player_dash',
  PLAYER_WALL_CLING: 'player_wall_cling',
  PLAYER_WALL_JUMP: 'player_wall_jump',
  PLAYER_CLAW_1: 'player_claw_1',
  PLAYER_CLAW_2: 'player_claw_2',
  PLAYER_CLAW_3: 'player_claw_3',
  PLAYER_AIR_CLAW: 'player_air_claw',
  PLAYER_SHADOW_POUNCE: 'player_shadow_pounce',
  PLAYER_HURT: 'player_hurt',
  PLAYER_DEATH: 'player_death',

  ENEMY_ALERT: 'enemy_alert',
  ENEMY_ATTACK_SWING: 'enemy_attack_swing',
  ENEMY_HURT: 'enemy_hurt',
  ENEMY_DEATH: 'enemy_death',

  COMBAT_HIT_LIGHT: 'combat_hit_light',
  COMBAT_HIT_HEAVY: 'combat_hit_heavy',

  PICKUP_COIN: 'pickup_coin',
  PICKUP_GEM: 'pickup_gem',
  PICKUP_CRYSTAL: 'pickup_crystal',

  UI_GAME_OVER: 'ui_game_over',
  UI_RESTART: 'ui_restart',
  UI_BEST_SCORE: 'ui_best_score',

  MUSIC_COURTYARD: 'music_courtyard',
} as const;

export type SfxKey = typeof SFX[keyof typeof SFX];

/** Map a player attack name → its connect-hit weight. Used to choose between
 *  combat_hit_light and combat_hit_heavy when a hitbox lands.
 */
export function attackHitSfx(attackName: string): SfxKey {
  if (attackName === 'claw_3' || attackName === 'shadow_pounce') {
    return SFX.COMBAT_HIT_HEAVY;
  }
  return SFX.COMBAT_HIT_LIGHT;
}

/** Map a player attack name → its swing/whoosh sfx. Played at attack startup. */
export function attackSwingSfx(attackName: string): SfxKey | null {
  switch (attackName) {
    case 'claw_1': return SFX.PLAYER_CLAW_1;
    case 'claw_2': return SFX.PLAYER_CLAW_2;
    case 'claw_3': return SFX.PLAYER_CLAW_3;
    case 'air_claw': return SFX.PLAYER_AIR_CLAW;
    case 'shadow_pounce': return SFX.PLAYER_SHADOW_POUNCE;
    default: return null;
  }
}

import { AttackData } from './types';

/**
 * Lionn's attack data. Hit timing tuned for a 60fps feel:
 * - claw_1 starts fast (60ms startup) so taps feel responsive.
 * - Each combo step has a slightly longer recovery; the third hit is the heavy.
 * - hitstopMs scales with the hit weight — heavier finisher pauses time longer.
 */
export const ATTACKS: Record<string, AttackData> = {
  claw_1: {
    name: 'claw_1',
    startupMs: 60,
    activeMs: 80,
    recoveryMs: 180,
    damage: 1,
    knockbackX: 110,
    knockbackY: -50,
    hitstopMs: 60,
    hitbox: { offsetX: 28, offsetY: -8, w: 52, h: 50 },
    next: 'claw_2',
    fxTag: 'slash-light',
  },
  claw_2: {
    name: 'claw_2',
    startupMs: 70,
    activeMs: 90,
    recoveryMs: 210,
    damage: 1,
    knockbackX: 120,
    knockbackY: -55,
    hitstopMs: 70,
    hitbox: { offsetX: 30, offsetY: -10, w: 56, h: 52 },
    next: 'claw_3',
    fxTag: 'slash-light',
  },
  // Combo finisher. Lands ONLY as the third hit of claw_1 → claw_2 →
  // claw_3 (the chain logic in Player.tryStartAttack drives this). Stats
  // are tuned to feel like a payoff for landing two hits in a row:
  //   - damage 4: enough to one-shot most patrols (HP 3) outright.
  //   - knockback ±400 / -280 launches enemies far enough to chain into
  //     pits or spike rows for a multi-kill.
  //   - hitstop 200 ms gives the impact a full beat to read on screen.
  //   - hitbox enlarged so the finisher catches anyone in front.
  // The Player's update loop watches for activeStart with name=claw_3 and
  // adds finisher VFX (ring shockwave + double slash) + a heavier shake.
  claw_3: {
    name: 'claw_3',
    startupMs: 130,
    activeMs: 140,
    recoveryMs: 340,
    damage: 4,
    knockbackX: 400,
    knockbackY: -280,
    hitstopMs: 200,
    hitbox: { offsetX: 38, offsetY: -8, w: 100, h: 80 },
    fxTag: 'slash-heavy',
  },
  air_claw: {
    name: 'air_claw',
    startupMs: 70,
    activeMs: 110,
    recoveryMs: 160,
    damage: 1,
    knockbackX: 90,
    knockbackY: 60,
    hitstopMs: 60,
    hitbox: { offsetX: 30, offsetY: 0, w: 60, h: 56 },
    airOnly: true,
    fxTag: 'slash-light',
  },
  shadow_pounce: {
    name: 'shadow_pounce',
    startupMs: 110,
    activeMs: 180,
    recoveryMs: 240,
    damage: 2,
    knockbackX: 180,
    knockbackY: -100,
    hitstopMs: 110,
    hitbox: { offsetX: 18, offsetY: 6, w: 70, h: 70 },
    fxTag: 'pounce',
  },

  // ---------- Night Cutter ----------
  cutter_dash: {
    name: 'cutter_dash',
    startupMs: 0,
    activeMs: 240,
    recoveryMs: 320,
    damage: 1,
    knockbackX: 220,
    knockbackY: -160,
    hitstopMs: 80,
    hitbox: { offsetX: 32, offsetY: -4, w: 76, h: 60 },
    fxTag: 'cutter-dash',
  },
  cutter_crescent_1: {
    name: 'cutter_crescent_1',
    startupMs: 280,
    activeMs: 100,
    recoveryMs: 180,
    damage: 1,
    knockbackX: 140,
    knockbackY: -60,
    hitstopMs: 70,
    hitbox: { offsetX: 40, offsetY: -6, w: 72, h: 64 },
    next: 'cutter_crescent_2',
    fxTag: 'crescent-arc',
  },
  cutter_crescent_2: {
    name: 'cutter_crescent_2',
    startupMs: 240,
    activeMs: 100,
    recoveryMs: 460,
    damage: 1,
    knockbackX: 180,
    knockbackY: -80,
    hitstopMs: 90,
    hitbox: { offsetX: 44, offsetY: -8, w: 80, h: 70 },
    fxTag: 'crescent-arc',
  },

  // ─── Boss attacks ────────────────────────────────────────────────
  // Each major boss uses its own attack profile so the fights have
  // distinct rhythms. Patrol.update picks the attack via
  // bossDef.attackName.

  /** Shadow Stalker — fast lunge. Short telegraph, wide reach. */
  shadow_dash: {
    name: 'shadow_dash',
    startupMs: 200,
    activeMs: 220,
    recoveryMs: 260,
    damage: 3,
    knockbackX: 280,
    knockbackY: -120,
    hitstopMs: 90,
    hitbox: { offsetX: 38, offsetY: -4, w: 84, h: 60 },
    fxTag: 'crescent-arc',
  },

  /** Crimson Beast — heavy slam. Long telegraph, big damage, launches up. */
  crimson_slam: {
    name: 'crimson_slam',
    startupMs: 360,
    activeMs: 180,
    recoveryMs: 360,
    damage: 4,
    knockbackX: 200,
    knockbackY: -200,
    hitstopMs: 140,
    hitbox: { offsetX: 32, offsetY: 6, w: 96, h: 84 },
    fxTag: 'pounce',
  },

  /** Night Sovereign — measured heavy strike. Long reach, fast recovery. */
  sovereign_strike: {
    name: 'sovereign_strike',
    startupMs: 260,
    activeMs: 140,
    recoveryMs: 280,
    damage: 4,
    knockbackX: 240,
    knockbackY: -150,
    hitstopMs: 130,
    hitbox: { offsetX: 44, offsetY: -6, w: 104, h: 80 },
    fxTag: 'slash-heavy',
  },
};

export function getAttack(name: string): AttackData | undefined {
  return ATTACKS[name];
}

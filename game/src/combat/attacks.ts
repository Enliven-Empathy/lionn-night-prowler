import { AttackData } from './types';
import { BOSS_MAJORS, BOSS_MINOR } from '../state/Bosses';
import { HITBOX_SIZE_SCALE_DAMPING } from '../core/constants';

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
  //   - damage 4: two claw_3s fell a standard patrol (PATROL_HP = 6);
  //     it also beats boss poise, so a committed heavy still interrupts
  //     a boss wind-up where light chip damage no longer does.
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

  // ─── Enemy attacks ───────────────────────────────────────────────
  // Regular enemies used to swing `claw_2` — a PLAYER move with a 70 ms
  // startup. 70 ms is roughly four frames: far below the ~450 ms a young
  // child needs to see a tell, decide, and act, so a patrol's attack was
  // functionally unreadable and simply landed. That is a large part of
  // "attacks feel unfair".
  //
  // en_swipe is purpose-built for enemies:
  //   - startup 300 ms — readable. Escape budget is 300 ms × 290 px/s =
  //     87 px of run against a 59 px reach (offsetX 30 + w 58/2), which
  //     clears the rule `reach ≤ startupMs/1000 × runSpeed − 15`.
  //   - recovery 420 ms — long enough that the punish window is real,
  //     which is what teaches "hit them right after they swing".
  //   - damage 2 — a patrol hit now matters, but 10 HP still absorbs five.
  en_swipe: {
    name: 'en_swipe',
    startupMs: 300,
    activeMs: 90,
    recoveryMs: 420,
    damage: 2,
    knockbackX: 130,
    knockbackY: -60,
    hitstopMs: 70,
    hitbox: { offsetX: 30, offsetY: -10, w: 58, h: 52 },
    telegraph: 'reach',
    fxTag: 'slash-light',
  },

  // ─── Boss attacks ────────────────────────────────────────────────
  // Each major boss uses its own attack profile so the fights have
  // distinct rhythms. Patrol.update picks the attack via
  // bossDef.attackName.

  /** Shadow Stalker — lunge. 420 ms wind-up: its "fast harasser" identity
   *  comes from chaseSpeed 220 and attack frequency, NOT from an
   *  unreadable swing. At the old 200 ms a child had a 43 px escape
   *  budget against an 80 px reach — they physically could not get out
   *  of the way, which is indefensible for the FIRST boss they meet. */
  shadow_dash: {
    name: 'shadow_dash',
    startupMs: 420,
    activeMs: 220,
    recoveryMs: 260,
    damage: 3,
    knockbackX: 280,
    knockbackY: -120,
    hitstopMs: 90,
    hitbox: { offsetX: 38, offsetY: -4, w: 84, h: 60 },
    telegraph: 'reach',
    fxTag: 'crescent-arc',
  },

  /** Crimson Beast — heavy slam. Long telegraph, big damage, launches up. */
  crimson_slam: {
    name: 'crimson_slam',
    startupMs: 440,
    activeMs: 180,
    recoveryMs: 360,
    damage: 4,
    knockbackX: 200,
    knockbackY: -200,
    hitstopMs: 140,
    hitbox: { offsetX: 32, offsetY: 6, w: 96, h: 84 },
    telegraph: 'reach',
    fxTag: 'pounce',
  },

  /** Night Sovereign — measured heavy strike. Long reach, fast recovery. */
  sovereign_strike: {
    name: 'sovereign_strike',
    startupMs: 440,
    activeMs: 140,
    recoveryMs: 280,
    damage: 4,
    knockbackX: 240,
    knockbackY: -150,
    hitstopMs: 130,
    hitbox: { offsetX: 44, offsetY: -6, w: 104, h: 80 },
    telegraph: 'reach',
    fxTag: 'slash-heavy',
  },
};

export function getAttack(name: string): AttackData | undefined {
  return ATTACKS[name];
}

/**
 * Minimum startup an ENEMY attack needs to be fair, by damage.
 *
 * A ~6-year-old needs roughly 450–500 ms to see a tell, decide, and act.
 * They don't need the whole window to be startup — running (290 px/s) or
 * dashing (94 px in 67 ms) covers ground during it — but the wind-up has
 * to be long enough to be *noticed*. The heavier the hit, the longer the
 * tell should be, because the cost of missing it is higher.
 */
const MIN_ENEMY_STARTUP_BY_DAMAGE: ReadonlyArray<{ maxDamage: number; minStartupMs: number }> = [
  { maxDamage: 1, minStartupMs: 240 },
  { maxDamage: 2, minStartupMs: 300 },
  { maxDamage: 99, minStartupMs: 420 },
];

/**
 * Dev-only fairness audit for telegraphed (enemy) attacks.
 *
 * Two independent checks:
 *
 * 1. **Reaction time** — `startupMs` must meet the table above. This is
 *    the hard rule: below it, the child cannot process the tell at all,
 *    and no amount of visual clarity rescues the attack.
 *
 * 2. **Escapability** — can they actually get out of the danger zone?
 *    Reported as a classification rather than pass/fail, because
 *    "requires a dash" is a legitimate design choice for a late boss and
 *    a bug for a chunk-2 patrol:
 *      - `run`   — walking out is enough.
 *      - `dash`  — needs the dash or a jump. Fine for bosses (the
 *                  Sovereign fight already gates on dash), suspicious
 *                  for ordinary enemies.
 *      - `none`  — not escapable even with a dash. Always a bug.
 *
 * Crucially the reach used here is the **scaled** reach. Boss bodies
 * render at 1.5–2.0× and `Hitbox.scale` now multiplies their hitboxes to
 * match, so auditing the authored numbers would understate a boss's real
 * danger zone by up to 2×.
 */
export function auditEnemyAttackReadability(
  runSpeed = 290,
  dashDistancePx = 94,
  dashDurationMs = 67,
): string[] {
  const problems: string[] = [];
  for (const a of Object.values(ATTACKS)) {
    if (!a.telegraph || a.telegraph === 'none') continue;

    const rule = MIN_ENEMY_STARTUP_BY_DAMAGE.find((r) => a.damage <= r.maxDamage);
    if (rule && a.startupMs < rule.minStartupMs) {
      problems.push(
        `${a.name}: startup ${a.startupMs}ms < ${rule.minStartupMs}ms minimum for ${a.damage} damage`,
      );
    }

    // Largest body scale any enemy that uses this attack renders at.
    const scale = maxScaleForAttack(a.name);
    // Mirrors Hitbox.worldRect: offset scales fully, size is damped.
    const sizeScale = 1 + (scale - 1) * HITBOX_SIZE_SCALE_DAMPING;
    const reach = Math.abs(a.hitbox.offsetX) * scale + (a.hitbox.w * sizeScale) / 2;
    const runBudget = (a.startupMs / 1000) * runSpeed - 15;
    const dashBudget =
      Math.max(0, (a.startupMs - dashDurationMs) / 1000) * runSpeed + dashDistancePx - 15;

    if (reach > dashBudget) {
      problems.push(
        `${a.name}: reach ${Math.round(reach)}px (scale ${scale}×) is NOT escapable — even run+dash only covers ${Math.round(dashBudget)}px in ${a.startupMs}ms`,
      );
    } else if (reach > runBudget) {
      // Informational for bosses, a design smell for basic enemies.
      const scaleNote = scale > 1 ? ' (boss)' : ' — unusual for a non-boss enemy';
      problems.push(
        `${a.name}: reach ${Math.round(reach)}px requires a dash or jump to evade (walking covers ${Math.round(runBudget)}px)${scaleNote}`,
      );
    }
  }
  return problems;
}

/**
 * Largest `scale` among enemies that use this attack, so the audit sees
 * the hitbox the player actually faces rather than the authored one.
 *
 * Statically imported: `state/Bosses.ts` is pure data with no imports of
 * its own, so there is no module cycle to dodge here.
 */
function maxScaleForAttack(attackName: string): number {
  let scale = 1;
  for (const b of [BOSS_MINOR, ...BOSS_MAJORS]) {
    if ((b.attackName ?? 'en_swipe') === attackName) scale = Math.max(scale, b.scale);
  }
  return scale;
}

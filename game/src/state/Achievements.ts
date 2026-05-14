import type { RunSummary, UserProfile } from './UserStore';

/**
 * Achievement / badge definitions. Each badge has a stable `id` (used
 * as the key in UserProfile.badges, so renaming an id strands prior
 * unlocks — DON'T rename), a display label, a tier color, and a
 * `trigger` function that returns true when the badge should unlock
 * based on the most recent run + the user profile post-run.
 *
 * Triggers are evaluated AFTER recordRun has folded the new run into
 * profile.bestDistance / bestScore / totalRuns, so triggers can read
 * the just-updated profile state if they want to (e.g. for cumulative
 * milestones like "100 total runs"). All current triggers operate on
 * the run alone, but the API supports lifetime-cumulative badges
 * without further changes.
 *
 * Distances are in pixels (1 m = 100 px in the game's UI convention).
 *
 * The badge order in this list is also the order of display in
 * BadgesScene's gallery, so curate it.
 */

export type BadgeTier = 'bronze' | 'silver' | 'gold' | 'skill' | 'rare';

/** Color palette per tier — used by BadgesScene + ResultsScene unlock
 *  flourish. Hex ints, not strings, so Phaser can use them directly. */
export const TIER_COLORS: Record<BadgeTier, { fill: number; border: number; text: string }> = {
  bronze: { fill: 0x6e3a1c, border: 0xc97c41, text: '#f4c89a' },
  silver: { fill: 0x4a4f5e, border: 0x9ba8c2, text: '#dde6f7' },
  gold:   { fill: 0x6e5a1a, border: 0xe8c645, text: '#fff0b8' },
  skill:  { fill: 0x352246, border: 0xb47bff, text: '#e6deff' },
  rare:   { fill: 0x1a3a5a, border: 0x6ad4ff, text: '#caefff' },
};

export interface BadgeDef {
  id: string;
  name: string;
  description: string;
  tier: BadgeTier;
  /** Returns true if the badge should unlock based on this run + the
   *  post-recordRun profile state. Caller filters out already-unlocked
   *  badges so triggers don't need to check that themselves. */
  trigger: (run: RunSummary, profile: UserProfile) => boolean;
}

/** 1 m = 100 px in the game's UI convention. */
const M = (metres: number) => metres * 100;

export const BADGES: BadgeDef[] = [
  {
    id: 'runner_bronze',
    name: 'Runner',
    description: 'Reach 200 m in one run.',
    tier: 'bronze',
    trigger: (r) => r.distance >= M(200),
  },
  {
    id: 'runner_silver',
    name: 'Sprinter',
    description: 'Reach 500 m in one run.',
    tier: 'silver',
    trigger: (r) => r.distance >= M(500),
  },
  {
    id: 'runner_gold',
    name: 'Marathoner',
    description: 'Reach 1000 m in one run.',
    tier: 'gold',
    trigger: (r) => r.distance >= M(1000),
  },
  {
    id: 'first_blood',
    name: 'First Blood',
    description: 'Defeat your first enemy.',
    tier: 'skill',
    trigger: (r, p) => r.enemiesKilled >= 1 || (p.totalRuns >= 1 && r.enemiesKilled >= 1),
  },
  {
    id: 'bone_collector',
    name: 'Bone Collector',
    description: 'Defeat 5 enemies in one run.',
    tier: 'skill',
    trigger: (r) => r.enemiesKilled >= 5,
  },
  {
    id: 'wall_walker',
    name: 'Wall Walker',
    description: 'Pull off your first wall-jump.',
    tier: 'skill',
    trigger: (r) => r.wallJumps >= 1,
  },
  {
    id: 'climber',
    name: 'Climber',
    description: 'Pull off your first ledge climb.',
    tier: 'skill',
    trigger: (r) => r.ledgeClimbs >= 1,
  },
  {
    id: 'ace',
    name: 'Ace',
    description: 'Score 50 stars in one run.',
    tier: 'rare',
    trigger: (r) => r.score >= 50,
  },
  {
    id: 'night_slayer',
    name: 'Night Slayer',
    description: 'Defeat your first boss.',
    tier: 'rare',
    trigger: (r) => r.bossesKilled >= 1,
  },
  // Per-boss badges for the three named endbosses. Each fires the FIRST
  // time the kid downs that specific boss. Tier escalates so the badge
  // gallery shows the progression visually (gold → rare → gold-with-
  // gold edge for the final).
  {
    id: 'boss_shadow_stalker',
    name: 'Shadow Slayer',
    description: 'Defeat the Shadow Stalker.',
    tier: 'silver',
    trigger: (r) => r.bossIdsKilled.includes('shadow_stalker'),
  },
  {
    id: 'boss_crimson_beast',
    name: 'Crimson Tamer',
    description: 'Defeat the Crimson Beast.',
    tier: 'gold',
    trigger: (r) => r.bossIdsKilled.includes('crimson_beast'),
  },
  {
    id: 'boss_night_sovereign',
    name: 'Sovereign Breaker',
    description: 'Defeat the Night Sovereign.',
    tier: 'rare',
    trigger: (r) => r.bossIdsKilled.includes('night_sovereign'),
  },
];

/** Quick lookup by id. Useful for ResultsScene + BadgesScene rendering. */
export const BADGE_BY_ID: Record<string, BadgeDef> = Object.fromEntries(
  BADGES.map((b) => [b.id, b]),
);

/**
 * Evaluate all badge triggers against the run + profile, return the
 * ids of badges newly unlocked this run. Caller is responsible for
 * persisting the unlock (UserStore.recordRun does this internally).
 */
export function evaluateBadges(run: RunSummary, profile: UserProfile): string[] {
  const newly: string[] = [];
  for (const b of BADGES) {
    if (profile.badges[b.id]) continue; // already unlocked, skip
    if (b.trigger(run, profile)) newly.push(b.id);
  }
  return newly;
}


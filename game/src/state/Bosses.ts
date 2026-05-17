/**
 * Boss catalogue. The original "boss" Patrol flag has been generalised:
 * Patrol now takes an optional BossDef that fully specifies its stats
 * and visuals. Falsy = regular patrol (3 HP, 46×70, violet).
 *
 * Two tiers:
 *
 *   - MINOR — random tougher patrol that occasionally spawns in
 *     wide-ground chunks past index 8 (see EndlessLevel.pickEnemySpawn).
 *     Awards Night Slayer on first defeat.
 *
 *   - MAJOR (×3) — fixed-milestone endbosses at specific chunk indices.
 *     Each is a named encounter with unique stats + palette and its
 *     own badge. Spawning is deterministic: when EndlessLevel
 *     generates the milestone chunk, the boss is queued for that
 *     chunk's wide-ground segment.
 *
 * Adding a new boss = add an entry here + add a matching badge in
 * Achievements.ts. Engine has no opinion on count.
 */

export interface BossDef {
  /** Stable id — used as the suffix on the boss-specific badge id
   *  ('boss_' + id) and inside RunSummary.bossIdsKilled. Never rename
   *  or prior unlocks become orphaned. */
  id: string;
  /** Display name (HUD callout, future use). */
  name: string;
  hp: number;
  /** Body scale multiplier vs the base patrol size (46×70). */
  scale: number;
  /** Body fill colour. */
  fill: number;
  /** Stroke / outline colour. Should contrast the fill so the boss
   *  silhouette reads in motion. */
  stroke: number;
  /** Tint while chasing — brighter take of fill, signals aggro. */
  chaseFill: number;
  /** Endless-mode chunk index at which the boss is forced to spawn.
   *  -1 = doesn't spawn in endless (e.g. the random minor). */
  endlessChunkIndex: number;
  /** Number of tier-3 collectible orbs spawned on defeat. Higher tiers
   *  drop more. */
  rewardCount: number;
  /** When true, claw/slash damage bounces off this boss unless it's
   *  currently dizzy. Dash and ground pound bypass — they're the
   *  affordance for opening up the boss. Used on the Night Sovereign
   *  to gate the final encounter behind the dizzy mechanic. */
  slashImmuneWhenAlert?: boolean;
  /** When true, EndlessLevel forces a flat full-width ground for this
   *  boss's chunk (no pits, no platforms). Needed for bosses with
   *  large bodies that need running room. */
  needsFlatArena?: boolean;
}

/** The minor random boss — preserved as the previous "boss" flag's
 *  identity. Drops 1 tier-3 orb on defeat; Night Slayer badge fires
 *  on any boss kill, so this counts. */
export const BOSS_MINOR: BossDef = {
  id: 'minor',
  name: 'Night Stalker',
  hp: 12,
  scale: 1.5,
  fill: 0x6a1a2a,
  chaseFill: 0xa0303a,
  stroke: 0xff8c5a,
  endlessChunkIndex: -1,
  rewardCount: 1,
};

/** Three fixed-milestone endbosses. Order in the array = order of
 *  encounter in a long endless run. Each award their own badge
 *  (Achievements.ts: 'boss_<id>').
 *
 *  HPs are tuned around the kid's damage output: claw_1=1, claw_2=1,
 *  claw_3=4, dash=1, pound=3. A full 3-hit combo deals 6, so:
 *    - Shadow Stalker (25 HP): ~4-5 combos.
 *    - Crimson Beast (45 HP):  ~8 combos.
 *    - Night Sovereign (80 HP): immunity-gated — must be dizzy first;
 *      then claw combos work. Pound (3) + dash (1) cycle alone =
 *      ~20 cycles, so the kid HAS to chain combos through dizzy
 *      windows. The slashImmuneWhenAlert + 2 s dizzy window is the
 *      core fight loop. */
export const BOSS_MAJORS: BossDef[] = [
  {
    id: 'shadow_stalker',
    name: 'Shadow Stalker',
    hp: 25,
    scale: 1.6,
    fill: 0x4a1a8a,
    chaseFill: 0x6a2aaa,
    stroke: 0xb47bff,
    endlessChunkIndex: 5,
    rewardCount: 2,
  },
  {
    id: 'crimson_beast',
    name: 'Crimson Beast',
    hp: 45,
    scale: 1.8,
    fill: 0xaa1818,
    chaseFill: 0xdb2828,
    stroke: 0xff5050,
    endlessChunkIndex: 12,
    rewardCount: 2,
  },
  {
    id: 'night_sovereign',
    name: 'Night Sovereign',
    hp: 80,
    scale: 2.0,
    fill: 0x14060a,
    chaseFill: 0x3a1828,
    stroke: 0xffd86a,
    endlessChunkIndex: 22,
    rewardCount: 3,
    // Final-boss gate: claws bounce off unless the boss is dizzy.
    // The kid must dash or pound first to open a damage window.
    slashImmuneWhenAlert: true,
    // Big body needs room — force a flat full-width arena ground for
    // chunk 22 so the kid doesn't fall into a pit mid-fight.
    needsFlatArena: true,
  },
];

/** Look up a boss by id (used by GameScene when reading a spawn's
 *  bossId off the level handle). Returns undefined for unknown ids. */
const ALL_BOSSES: BossDef[] = [BOSS_MINOR, ...BOSS_MAJORS];
export function findBossById(id: string): BossDef | undefined {
  return ALL_BOSSES.find((b) => b.id === id);
}

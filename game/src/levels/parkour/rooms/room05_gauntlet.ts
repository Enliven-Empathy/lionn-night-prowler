import { ParkourRoom } from '../types';

/**
 * Room 5 — THE GAUNTLET (mastery)
 *
 * Combines all four mechanics in one curated path:
 *
 *   1. Climb step 1 → bridge with crouch passage (overhang).
 *   2. Drop down past spike pit → step up onto slam-target perch.
 *   3. Slam-pound the dummy patrol.
 *   4. Climb up to the top platform.
 *   5. Slide pole down to exit.
 *
 * Difficulty 3: spike timing on the descent gap, narrow slam landing,
 * the final orb sits at the slide pole top so the kid commits to the
 * slide for the full chain.
 */
export const room05_gauntlet: ParkourRoom = {
  id: 'gauntlet',
  width: 640,
  difficulty: 3,
  segments: [
    { x: 0, y: 640, w: 640, h: 80, kind: 'ground' },
    // Step 1.
    { x: 60, y: 540, w: 80, h: 18, kind: 'platform' },
    // Bridge with overhang.
    { x: 180, y: 540, w: 200, h: 18, kind: 'platform' },
    // Slam target perch (small).
    { x: 410, y: 480, w: 70, h: 18, kind: 'platform' },
    // Top platform leading to slide pole.
    { x: 350, y: 300, w: 230, h: 18, kind: 'platform' },
  ],
  overhangs: [
    { x: 280, bottomY: 500, width: 120 },
  ],
  spikes: [
    // Spike pit between the bridge end and the slam perch.
    { x: 395, y: 640, width: 60, phaseOffsetMs: 800 },
  ],
  enemies: [
    {
      x: 445, y: 600,
      xMin: 410, xMax: 480,
      variant: 'dummy',
    },
  ],
  slidePoles: [
    { x: 590, topY: 310, height: 270 },
  ],
  collectibles: [
    { x: 100, y: 510, tier: 1 },
    { x: 280, y: 520, tier: 1 }, // crouch-only
    { x: 445, y: 450, tier: 2 }, // claimed after slam
    { x: 460, y: 270, tier: 2 },
    { x: 596, y: 280, tier: 3 }, // top of slide pole
  ],
};

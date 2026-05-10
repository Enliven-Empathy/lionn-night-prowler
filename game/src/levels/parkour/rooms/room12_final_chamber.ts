import { ParkourRoom } from '../types';

/**
 * Room 12 — FINAL CHAMBER (mastery)
 *
 * Difficulty 3. Combines the four core mechanics in a single
 * multi-stage chain:
 *
 *   1. Stair up to crouch bridge.
 *   2. Crouch under low overhang.
 *   3. Slam-pound a dummy patrol off the perch on the right.
 *   4. Wall-chute to the top via 2-wall wall-jumping.
 *   5. Tier-3 reward at the top.
 *
 * Distinct from THE GAUNTLET (room 5) by replacing its slide-pole
 * exit with a wall-chute exit — exercises wall-jump endurance instead
 * of pole control. The kid sees all four mechanics across rooms 5
 * and 12 in any rotation.
 */
export const room12_final_chamber: ParkourRoom = {
  id: 'final_chamber',
  width: 640,
  difficulty: 3,
  segments: [
    { x: 0, y: 640, w: 640, h: 80, kind: 'ground' },
    // Stage 1: stair.
    { x: 40, y: 540, w: 80, h: 18, kind: 'platform' },
    // Stage 2: crouch bridge.
    { x: 160, y: 540, w: 200, h: 18, kind: 'platform' },
    // Stage 3: slam-target perch.
    { x: 400, y: 480, w: 70, h: 18, kind: 'platform' },
    // Stage 4: wall chute (left wall + right wall, 78 px gap).
    { x: 510, y: 200, w: 22, h: 320, kind: 'wall' },
    { x: 610, y: 200, w: 22, h: 320, kind: 'wall' },
  ],
  overhangs: [
    { x: 260, bottomY: 500, width: 120 },
  ],
  enemies: [
    {
      x: 435, y: 600,
      xMin: 400, xMax: 470,
      variant: 'dummy',
    },
  ],
  collectibles: [
    { x: 90,  y: 510, tier: 1 },     // on stair
    { x: 260, y: 520, tier: 1 },     // crouch zone
    { x: 435, y: 450, tier: 2 },     // post-slam
    { x: 568, y: 250, tier: 3 },     // top of wall chute — final reward
  ],
};

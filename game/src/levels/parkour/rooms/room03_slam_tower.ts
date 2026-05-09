import { ParkourRoom } from '../types';

/**
 * Room 3 — SLAM TOWER
 *
 * Teaches: ground pound onto an enemy. The kid climbs a stair tower
 * (3 platforms going up), then sees an enemy patrolling on the ground
 * directly below the top platform. Stepping off the top platform with
 * crouch held mid-air triggers a ground pound — landing AOE kills the
 * patrol (see Player.executePoundImpact).
 *
 * Top reward (tier 3) is on the high platform itself — claiming it
 * commits the player to the slam path: the only way down without a
 * 600 px fall to a different ground spot is via the slam.
 *
 * Patrol uses 'dummy' variant — no chase, no aggro, just walks back
 * and forth waiting to be slammed. Keeps parkour identity focused on
 * traversal rather than combat.
 */
export const room03_slam_tower: ParkourRoom = {
  id: 'slam_tower',
  width: 640,
  difficulty: 2,
  segments: [
    { x: 0, y: 640, w: 640, h: 80, kind: 'ground' },
    // Stair tower on the left.
    { x: 60, y: 540, w: 100, h: 18, kind: 'platform' },
    { x: 200, y: 430, w: 100, h: 18, kind: 'platform' },
    // Top platform — perched directly above the dummy patrol below.
    { x: 360, y: 320, w: 140, h: 18, kind: 'platform' },
  ],
  enemies: [
    {
      x: 430, y: 600,
      xMin: 360, xMax: 500,
      variant: 'dummy',
    },
  ],
  collectibles: [
    { x: 110, y: 510, tier: 1 },
    { x: 250, y: 400, tier: 2 },
    { x: 430, y: 290, tier: 3 },
  ],
};

import { ParkourRoom } from '../types';

/**
 * Room 10 — SLAM CHAIN
 *
 * Teaches: repeated ground-pound rhythm. Three small platforms going
 * up to the right, each with a dummy patrol on the ground directly
 * below. The kid jumps onto each platform, ground-pounds onto the
 * patrol, lands on ground, and chains to the next.
 *
 * Each slam reinforces the muscle memory: jump → crouch in air →
 * land on enemy → bounce-up impact → repeat. Top reward sits above
 * the third (highest) platform so the kid commits to the full chain.
 */
export const room10_slam_chain: ParkourRoom = {
  id: 'slam_chain',
  width: 640,
  difficulty: 3,
  segments: [
    { x: 0, y: 640, w: 640, h: 80, kind: 'ground' },
    // Three perches going up-and-right.
    { x: 80,  y: 500, w: 70, h: 18, kind: 'platform' },
    { x: 260, y: 380, w: 70, h: 18, kind: 'platform' },
    { x: 440, y: 260, w: 70, h: 18, kind: 'platform' },
  ],
  enemies: [
    { x: 115, y: 600, xMin: 80,  xMax: 150, variant: 'dummy' },
    { x: 295, y: 600, xMin: 260, xMax: 330, variant: 'dummy' },
    { x: 475, y: 600, xMin: 440, xMax: 510, variant: 'dummy' },
  ],
  collectibles: [
    { x: 115, y: 470, tier: 1 },     // on perch 1 (claimed pre-slam)
    { x: 295, y: 350, tier: 2 },     // on perch 2
    { x: 475, y: 230, tier: 3 },     // on perch 3 — top reward
  ],
};

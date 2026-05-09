import { ParkourRoom } from '../types';

/**
 * Room 1 — STAIRS (tutorial)
 *
 * Teaches: pure climbing. Single-jump steps going up to the right.
 * No hazards, no enemies. Three orbs along the path so the kid sees
 * the reward pattern (collect-as-you-climb).
 *
 * Vertical step height: 110 px — well inside PLAYER.jumpReachPx (130)
 * so even mistimed jumps land. Width gaps: 40 px between platforms,
 * comfortable for a single jump.
 */
export const room01_stairs: ParkourRoom = {
  id: 'stairs',
  width: 640,
  difficulty: 1,
  segments: [
    // Continuous ground.
    { x: 0, y: 640, w: 640, h: 80, kind: 'ground' },
    // Step 1.
    { x: 100, y: 530, w: 100, h: 18, kind: 'platform' },
    // Step 2.
    { x: 240, y: 420, w: 100, h: 18, kind: 'platform' },
    // Step 3 (top, slightly wider as a comfortable landing).
    { x: 380, y: 310, w: 140, h: 18, kind: 'platform' },
  ],
  collectibles: [
    { x: 150, y: 500, tier: 1 },
    { x: 290, y: 390, tier: 1 },
    { x: 450, y: 280, tier: 3 },
  ],
};

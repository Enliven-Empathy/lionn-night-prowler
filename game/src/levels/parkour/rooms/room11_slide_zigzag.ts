import { ParkourRoom } from '../types';

/**
 * Room 11 — SLIDE ZIGZAG
 *
 * Teaches: chained slide-pole control. Climb the left tower; from the
 * top, descend a zig-zag of two slide poles separated by a small
 * catch platform. Tier-3 reward atop the climb (claimed before the
 * descent — the descent is the puzzle, not the goal).
 *
 * Tests:
 *   - Climbing precision (3 stair platforms).
 *   - Slide-pole entry from a falling-onto trajectory.
 *   - Pole-to-pole transfer via mid-platform jump.
 *   - Down/crouch release to drop OFF a pole at the right time.
 */
export const room11_slide_zigzag: ParkourRoom = {
  id: 'slide_zigzag',
  width: 640,
  difficulty: 3,
  segments: [
    { x: 0, y: 640, w: 640, h: 80, kind: 'ground' },
    // Left climbing stack.
    { x: 40,  y: 540, w: 80, h: 18, kind: 'platform' },
    { x: 180, y: 440, w: 80, h: 18, kind: 'platform' },
    { x: 320, y: 340, w: 220, h: 18, kind: 'platform' },     // wide top
    // Mid-descent catch platform between the two slide poles.
    { x: 380, y: 510, w: 100, h: 18, kind: 'platform' },
  ],
  slidePoles: [
    // Pole 1: descends from top platform's right edge to ~just above
    // the mid catch platform.
    { x: 540, topY: 350, height: 160 },
    // Pole 2: descends from mid catch platform's left edge to ground.
    { x: 360, topY: 520, height: 110 },
  ],
  collectibles: [
    { x: 80,  y: 510, tier: 1 },
    { x: 220, y: 410, tier: 2 },
    { x: 430, y: 310, tier: 3 },     // top of climb — reward
    { x: 430, y: 480, tier: 1 },     // bonus orb on the catch platform
  ],
};

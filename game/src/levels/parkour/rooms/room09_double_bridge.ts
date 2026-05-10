import { ParkourRoom } from '../types';

/**
 * Room 9 — DOUBLE BRIDGE
 *
 * Teaches: chained crouch passages. Two stacked bridges, each with a
 * crouch-only overhang at a different X. The kid runs the lower
 * bridge, crouches under its overhang, exits right, jumps up to the
 * upper bridge, crouches under its overhang (positioned offset from
 * the lower one so the crouch timing is different), exits to the
 * top reward.
 *
 * Bridges are 100 px apart vertically — well within single-jump
 * reach (130). Jump from the right end of bridge 1 lands on bridge
 * 2's right portion.
 */
export const room09_double_bridge: ParkourRoom = {
  id: 'double_bridge',
  width: 640,
  difficulty: 2,
  segments: [
    { x: 0, y: 640, w: 640, h: 80, kind: 'ground' },
    // Lower bridge.
    { x: 60, y: 540, w: 480, h: 18, kind: 'platform' },
    // Upper bridge — slight rightward offset so the climb is along the right side.
    { x: 120, y: 440, w: 500, h: 18, kind: 'platform' },
  ],
  overhangs: [
    { x: 240, bottomY: 500, width: 120 },     // lower bridge: forces crouch in left third
    { x: 460, bottomY: 400, width: 120 },     // upper bridge: forces crouch near the far right
  ],
  collectibles: [
    { x: 240, y: 520, tier: 1 },     // under lower overhang — crouch to grab
    { x: 460, y: 420, tier: 1 },     // under upper overhang — crouch to grab
    { x: 580, y: 410, tier: 3 },     // top right — reward
  ],
};

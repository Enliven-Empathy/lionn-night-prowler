import { ParkourRoom } from '../types';

/**
 * Room 7 — POLE PARADE
 *
 * Teaches: pole-top precision. Four vertical 22 px poles in a row at
 * alternating heights. Climb each pole via wall-jumping its side, top-
 * step onto the narrow flat top (the existing climbLedge centering
 * code straddles narrow rects), then jump-step to the next pole's
 * top. Tier-3 reward atop the rightmost pole.
 *
 * Difficulty 2. Top-to-top jumps are 120 px horizontal × ~60 vertical
 * — comfortable single jumps even with wobbly aim. The kid's reward
 * is the rhythm of the chain rather than any single hard maneuver.
 */
export const room07_pole_parade: ParkourRoom = {
  id: 'pole_parade',
  width: 640,
  difficulty: 2,
  segments: [
    { x: 0, y: 640, w: 640, h: 80, kind: 'ground' },
    // 4 poles, alternating top heights. All bases rest on ground (h = 640 - top).
    { x: 100, y: 460, w: 22, h: 180, kind: 'pole' },
    { x: 220, y: 400, w: 22, h: 240, kind: 'pole' },
    { x: 340, y: 460, w: 22, h: 180, kind: 'pole' },
    { x: 460, y: 400, w: 22, h: 240, kind: 'pole' },
  ],
  collectibles: [
    { x: 111, y: 430, tier: 1 },     // above pole 1 top
    { x: 231, y: 370, tier: 2 },     // above pole 2 top
    { x: 351, y: 430, tier: 2 },     // above pole 3 top
    { x: 471, y: 370, tier: 3 },     // above pole 4 top — reward
  ],
};

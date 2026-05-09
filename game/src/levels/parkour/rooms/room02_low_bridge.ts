import { ParkourRoom } from '../types';

/**
 * Room 2 — LOW BRIDGE
 *
 * Teaches: crouch under overhang. Single step up, then a long bridge
 * with a low overhang in the middle the player must crouch under
 * (R2/L2 or down-arrow). Orb sits inside the crouch zone — collected
 * mid-crouch — and a tier-2 reward at the far end of the bridge.
 *
 * Geometry: platform top at Y=540 → standing body top at 476, crouched
 * body top at 504. Overhang bottom at Y=500 sits between them →
 * standing bonks, crouched clears with 4 px head clearance.
 */
export const room02_low_bridge: ParkourRoom = {
  id: 'low_bridge',
  width: 640,
  difficulty: 1,
  segments: [
    { x: 0, y: 640, w: 640, h: 80, kind: 'ground' },
    // Step up.
    { x: 80, y: 540, w: 80, h: 18, kind: 'platform' },
    // Long bridge with the overhang above its middle.
    { x: 200, y: 540, w: 320, h: 18, kind: 'platform' },
  ],
  overhangs: [
    { x: 360, bottomY: 500, width: 100 },
  ],
  collectibles: [
    { x: 250, y: 510, tier: 1 },
    { x: 360, y: 520, tier: 1 }, // sits low — must crouch to collect
    { x: 490, y: 510, tier: 2 },
  ],
};

import { ParkourRoom } from '../types';

/**
 * Room 4 — SLIDE TOWER
 *
 * Teaches: slide pole. Climb up the LEFT side via stairs, traverse
 * across the top, drop onto the slide pole on the right. Slide pole
 * carries the player smoothly down to ground level. A spike row
 * across the LEFT half of the ground forces the kid to commit to the
 * slide rather than dropping straight off the top platform.
 *
 * Mechanic refresher: while side-touching the slide pole, vy is
 * clamped to PLAYER.slidePoleSpeed (~220 px/s). Press JUMP to push
 * off horizontally (~320 vx, -350 vy). DOWN/CROUCH or AWAY release.
 */
export const room04_slide_tower: ParkourRoom = {
  id: 'slide_tower',
  width: 640,
  difficulty: 2,
  segments: [
    { x: 0, y: 640, w: 640, h: 80, kind: 'ground' },
    // Climb stack on the left.
    { x: 60, y: 540, w: 90, h: 18, kind: 'platform' },
    { x: 60, y: 430, w: 90, h: 18, kind: 'platform' },
    // Top platform spans left to right edge of slide pole.
    { x: 60, y: 320, w: 480, h: 18, kind: 'platform' },
  ],
  spikes: [
    // Cyclic spike row across the lower-left ground — punishes a
    // straight-drop bail-out from the climb.
    { x: 200, y: 640, width: 200, phaseOffsetMs: 0 },
  ],
  slidePoles: [
    // Adjacent to the right end of the top platform; descends to just
    // above the ground (60 px clearance so landing isn't into spikes).
    { x: 580, topY: 330, height: 250 },
  ],
  collectibles: [
    { x: 105, y: 510, tier: 1 },
    { x: 105, y: 400, tier: 2 },
    { x: 350, y: 290, tier: 2 },
    { x: 596, y: 300, tier: 3 }, // top of slide pole
  ],
};

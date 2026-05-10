import { ParkourRoom } from '../types';

/**
 * Room 6 — WALL CHUTE
 *
 * Teaches: sustained wall-jumping. Two parallel vertical walls forming
 * a 78 px chute (matching WALL_TOWER.wallGapPx so the wall-jump arc is
 * tuned). The kid walks under the walls at ground level (150 px gap),
 * jumps up between them, then alternates wall-jumps to climb to the
 * top reward.
 *
 * Difficulty 2 — straight wall-jump endurance. No combat or hazards;
 * pure movement focus.
 */
export const room06_wall_chute: ParkourRoom = {
  id: 'wall_chute',
  width: 640,
  difficulty: 2,
  segments: [
    { x: 0, y: 640, w: 640, h: 80, kind: 'ground' },
    // Left wall.
    { x: 270, y: 290, w: 22, h: 200, kind: 'wall' },
    // Right wall — 78 px gap inside the chute.
    { x: 370, y: 290, w: 22, h: 200, kind: 'wall' },
  ],
  collectibles: [
    { x: 320, y: 600, tier: 1 },     // sits at chute floor — early reward
    { x: 320, y: 400, tier: 2 },     // mid-chute, requires entering
    { x: 320, y: 250, tier: 3 },     // top of chute, requires the climb
  ],
};

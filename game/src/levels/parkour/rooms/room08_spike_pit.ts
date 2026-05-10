import { ParkourRoom } from '../types';

/**
 * Room 8 — SPIKE PIT
 *
 * Teaches: timed double-jump over hazards. A wide cycling spike row
 * splits the floor; a single small floating platform mid-pit forces a
 * timed double-jump (or wall-jump-equivalent) to cross. The spike
 * cycle is offset so the kid sees both states during transit.
 *
 * Floor stays continuous (no death pit) — falling into the spike row
 * costs HP rather than killing instantly, keeping the room
 * non-lethal even on a botched timing.
 */
export const room08_spike_pit: ParkourRoom = {
  id: 'spike_pit',
  width: 640,
  difficulty: 2,
  segments: [
    { x: 0, y: 640, w: 640, h: 80, kind: 'ground' },
    // Stepping platform mid-pit (above the spikes).
    { x: 280, y: 520, w: 80, h: 18, kind: 'platform' },
  ],
  spikes: [
    { x: 320, y: 640, width: 220, phaseOffsetMs: 600 },
  ],
  collectibles: [
    { x: 320, y: 480, tier: 2 },     // above the mid-platform — mid-jump grab
    { x: 540, y: 600, tier: 3 },     // far end, after the crossing
  ],
};

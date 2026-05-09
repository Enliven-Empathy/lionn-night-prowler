import { ParkourRoom } from '../types';
import { room01_stairs } from './room01_stairs';
import { room02_low_bridge } from './room02_low_bridge';
import { room03_slam_tower } from './room03_slam_tower';
import { room04_slide_tower } from './room04_slide_tower';
import { room05_gauntlet } from './room05_gauntlet';

/**
 * Curated room sequence. ParkourLevel walks this list in order and
 * loops back to the start. The order is the difficulty ramp:
 *
 *   1. STAIRS — pure climb (tutorial)
 *   2. LOW BRIDGE — crouch passage
 *   3. SLAM TOWER — ground pound on enemy
 *   4. SLIDE TOWER — slide pole + spike threat
 *   5. THE GAUNTLET — full chain
 *
 * After room 5 the kid loops back to room 1 — they're now masters and
 * the easier rooms become breather sections that reset the rhythm.
 *
 * Adding a new room:
 *   1. Author it as a TS file under this folder.
 *   2. Import + insert here at the right difficulty index.
 *   3. ParkourLevel picks it up automatically.
 */
export const PARKOUR_ROOMS: ParkourRoom[] = [
  room01_stairs,
  room02_low_bridge,
  room03_slam_tower,
  room04_slide_tower,
  room05_gauntlet,
];

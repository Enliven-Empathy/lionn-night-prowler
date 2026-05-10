import { ParkourRoom } from '../types';
import { room01_stairs } from './room01_stairs';
import { room02_low_bridge } from './room02_low_bridge';
import { room03_slam_tower } from './room03_slam_tower';
import { room04_slide_tower } from './room04_slide_tower';
import { room05_gauntlet } from './room05_gauntlet';
import { room06_wall_chute } from './room06_wall_chute';
import { room07_pole_parade } from './room07_pole_parade';
import { room08_spike_pit } from './room08_spike_pit';
import { room09_double_bridge } from './room09_double_bridge';
import { room10_slam_chain } from './room10_slam_chain';
import { room11_slide_zigzag } from './room11_slide_zigzag';
import { room12_final_chamber } from './room12_final_chamber';

/**
 * Curated room sequence. ParkourLevel walks this list in order and
 * loops back to the start. The first 5 rooms are the original curated
 * tutorial-to-mastery curve; the next 7 add mid-tier variety and a
 * second wave of mastery rooms before the loop:
 *
 *   1.  STAIRS        d1   pure climb tutorial
 *   2.  LOW BRIDGE    d1   crouch passage
 *   3.  SLAM TOWER    d2   ground pound on enemy
 *   4.  SLIDE TOWER   d2   slide pole + spike threat
 *   5.  THE GAUNTLET  d3   full chain (slide finish)  ← first peak
 *   6.  WALL CHUTE    d2   wall-jump endurance
 *   7.  POLE PARADE   d2   pole-top precision
 *   8.  SPIKE PIT     d2   timed double-jump over hazard
 *   9.  DOUBLE BRIDGE d2   chained crouch passages
 *  10.  SLAM CHAIN    d3   repeated ground-pound rhythm
 *  11.  SLIDE ZIGZAG  d3   chained slide poles
 *  12.  FINAL CHAMBER d3   full chain (wall-chute finish) ← second peak
 *
 * After room 12 the kid loops back to room 1 — the easier rooms
 * become breather sections between mastery runs.
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
  room05_gauntlet,        // first hard room — reward for completing 4 builds
  room06_wall_chute,
  room07_pole_parade,
  room08_spike_pit,
  room09_double_bridge,
  room10_slam_chain,
  room11_slide_zigzag,
  room12_final_chamber,   // mastery-level finale before the rotation loops
];

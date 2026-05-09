/**
 * Authored parkour rooms — plain-data layout descriptions consumed by
 * ParkourLevel. Each room declares its segments (geometry), entity
 * spawns, and collectibles. Adding a new room is a new TS file under
 * `rooms/` exporting a `ParkourRoom` const; no engine changes needed.
 *
 * Coordinate conventions (all in WORLD pixels, expressed RELATIVE to
 * room.x = 0; ParkourLevel adds the chunk offset):
 *   - Segments use top-left + width + height.
 *   - Overhangs use center-X + bottom-edge-Y.
 *   - Spikes use center-X + ground-top-Y.
 *   - Collectibles use center-X + center-Y.
 *   - Enemies use body-center-X + body-center-Y.
 *   - Slide poles use top-left.
 *
 * Origin: room is laid out so the GROUND TOP is at world Y = 640
 * (matching ParkourLevel's GROUND_TOP_Y constant). Higher platforms
 * have smaller Y values.
 */

export type RoomSegmentKind = 'ground' | 'platform' | 'pole' | 'wall';

export interface RoomSegment {
  /** Left-edge X (relative to room start). */
  x: number;
  /** Top-edge Y (world coords). */
  y: number;
  w: number;
  h: number;
  kind: RoomSegmentKind;
}

export interface RoomOverhang {
  /** Center-X (relative to room start). */
  x: number;
  /** Y of the overhang's BOTTOM edge. Tuned so that a STANDING player
   *  bonks but a CROUCHED one (body height 36) clears. For a platform
   *  with top at Y=540, bottomY in (476, 504] hits standing and clears
   *  crouched — recommend ~500. */
  bottomY: number;
  width: number;
}

export interface RoomSpikes {
  /** Center-X (relative to room start). */
  x: number;
  /** Y of the GROUND TOP the spikes emerge from. */
  y: number;
  width: number;
  /** Phase offset in ms (0..3160) so neighboring rows don't open in lockstep. */
  phaseOffsetMs: number;
}

export interface RoomEnemy {
  /** Body-center X (relative to room start). */
  x: number;
  /** Body-center Y (world coords). */
  y: number;
  /** Horizontal patrol bounds (relative to room start). */
  xMin: number;
  xMax: number;
  /** 'dummy' = stationary slam-target. Doesn't chase or attack the
   *  player — just walks back and forth on its own little stage,
   *  waiting to be ground-pounded. Default 'patrol' = full AI. */
  variant?: 'patrol' | 'dummy';
}

export interface RoomCollectible {
  /** Center-X (relative to room start). */
  x: number;
  /** Center-Y (world coords). */
  y: number;
  tier: 1 | 2 | 3;
}

export interface RoomSlidePole {
  /** Left-edge X (relative to room start). */
  x: number;
  /** Top-edge Y of the pole. */
  topY: number;
  height: number;
}

export interface ParkourRoom {
  /** Stable identifier for telemetry / replay / debugging. */
  id: string;
  /** Logical width in pixels. Typically 640 (one chunk). */
  width: number;
  /** 1 = tutorial, 3 = mastery. ParkourLevel uses this to ramp difficulty. */
  difficulty: 1 | 2 | 3;
  segments: RoomSegment[];
  overhangs?: RoomOverhang[];
  spikes?: RoomSpikes[];
  enemies?: RoomEnemy[];
  collectibles: RoomCollectible[];
  slidePoles?: RoomSlidePole[];
}

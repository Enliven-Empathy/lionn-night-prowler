import Phaser from 'phaser';
import { COLORS, VIEW } from '../core/constants';
import {
  CollectibleSpawn,
  EndlessLevelHandle,
  EnemySpawn,
  HeartSpawn,
  LedgeInfo,
  OverhangSpawn,
  SlidePoleSpawn,
  SpikeSpawn,
} from './EndlessLevel';
import { PARKOUR_ROOMS } from './parkour/rooms';
import { ParkourRoom } from './parkour/types';

/**
 * Parkour mode — authored-room sequencer.
 *
 * Each chunk in the parkour world is a hand-designed ParkourRoom
 * (see src/levels/parkour/rooms). The sequencer walks the room list
 * in order so the difficulty ramp is predictable, then loops back to
 * the start. RNG is used only for spike phase variation across runs;
 * geometry is fully deterministic so the kid can master each room.
 *
 * The level still implements EndlessLevelHandle so GameScene's
 * level-construction branch is the only place that knows about
 * parkour vs endless — every other system is mode-agnostic.
 *
 * Hazards/enemies/collectibles/slide-poles authored in each room are
 * surfaced via the existing drain* channels (and a new
 * drainSlidePoleSpawns).
 */

const CHUNK_WIDTH = 640;
const GROUND_TOP_Y = 640;
const SPAWN_AHEAD_CHUNKS = 4;

const POLE_FILL = 0x3a2a55;
const POLE_EDGE = 0x9b59ff;

interface Chunk {
  index: number;
  rects: Phaser.GameObjects.Rectangle[];
}

export interface ParkourLevelOptions {
  seed?: number;
}

export class ParkourLevel {
  private scene: Phaser.Scene;
  private staticGroup: Phaser.Physics.Arcade.StaticGroup;
  private chunks = new Map<number, Chunk>();
  private rng: () => number;
  private maxGenerated = -1;

  private pendingCollectibles: CollectibleSpawn[] = [];
  private pendingEnemies: EnemySpawn[] = [];
  private pendingSpikes: SpikeSpawn[] = [];
  private pendingOverhangs: OverhangSpawn[] = [];
  private pendingSlidePoles: SlidePoleSpawn[] = [];

  /** Patrol variants requested by authored rooms (parallel array to
   *  pendingEnemies — same index = same enemy). GameScene reads this
   *  via drainEnemyVariants() to pick patrol AI vs dummy slam-target. */
  private pendingEnemyVariants: ('patrol' | 'dummy')[] = [];

  readonly spawnX = 120;
  readonly spawnY = 540;

  constructor(scene: Phaser.Scene, options: ParkourLevelOptions = {}) {
    this.scene = scene;
    this.staticGroup = scene.physics.add.staticGroup();
    this.rng = mulberry32(options.seed ?? (Math.random() * 1e9) | 0);

    // Slightly darker backdrop so the mode reads as distinct even before
    // the kid notices the HUD label.
    scene.add.rectangle(VIEW.width / 2, VIEW.height / 2, VIEW.width, VIEW.height, 0x0a0816)
      .setDepth(-100)
      .setScrollFactor(0);

    for (let i = 0; i <= SPAWN_AHEAD_CHUNKS; i++) this.generateChunk(i);
  }

  build(): EndlessLevelHandle & { drainEnemyVariants: () => ('patrol' | 'dummy')[] } {
    return {
      staticGroup: this.staticGroup,
      spawnX: this.spawnX,
      spawnY: this.spawnY,
      ensureGenerated: (playerX: number) => this.ensureGenerated(playerX),
      distance: (playerX: number) => Math.max(0, playerX - this.spawnX),
      drainEnemySpawns: () => {
        const out = this.pendingEnemies;
        this.pendingEnemies = [];
        return out;
      },
      drainEnemyVariants: () => {
        const out = this.pendingEnemyVariants;
        this.pendingEnemyVariants = [];
        return out;
      },
      drainCollectibleSpawns: () => {
        const out = this.pendingCollectibles;
        this.pendingCollectibles = [];
        return out;
      },
      drainHeartSpawns: () => [] as HeartSpawn[],
      drainSpikeSpawns: () => {
        const out = this.pendingSpikes;
        this.pendingSpikes = [];
        return out;
      },
      drainOverhangSpawns: () => {
        const out = this.pendingOverhangs;
        this.pendingOverhangs = [];
        return out;
      },
      drainSlidePoleSpawns: () => {
        const out = this.pendingSlidePoles;
        this.pendingSlidePoles = [];
        return out;
      },
      findLedge: (left, right, top, side) => this.findLedge(left, right, top, side),
    };
  }

  private ensureGenerated(playerX: number): void {
    const playerChunk = Math.floor(playerX / CHUNK_WIDTH);
    const target = playerChunk + SPAWN_AHEAD_CHUNKS;
    while (this.maxGenerated < target) {
      this.generateChunk(this.maxGenerated + 1);
    }
  }

  private pickRoom(index: number): ParkourRoom {
    return PARKOUR_ROOMS[index % PARKOUR_ROOMS.length];
  }

  private generateChunk(index: number): void {
    const x0 = index * CHUNK_WIDTH;
    const room = this.pickRoom(index);
    const rects: Phaser.GameObjects.Rectangle[] = [];

    // 1. Static geometry (segments). Translate room-local coords by x0.
    for (const seg of room.segments) {
      const fill =
        seg.kind === 'pole' ? POLE_FILL :
        seg.kind === 'platform' ? COLORS.platform :
        seg.kind === 'wall' ? COLORS.platform :
        COLORS.ground;
      const edge =
        seg.kind === 'pole' ? POLE_EDGE :
        seg.kind === 'platform' ? COLORS.platformEdge :
        seg.kind === 'wall' ? COLORS.platformEdge :
        COLORS.groundEdge;
      const r = this.scene.add.rectangle(
        x0 + seg.x + seg.w / 2,
        seg.y + seg.h / 2,
        seg.w,
        seg.h,
        fill,
      );
      r.setStrokeStyle(2, edge);
      this.scene.physics.add.existing(r, true);
      this.staticGroup.add(r);
      rects.push(r);
    }

    // 2. Overhangs (visual + AABB-only damage rect; no static body).
    for (const o of room.overhangs ?? []) {
      this.pendingOverhangs.push({
        x: x0 + o.x,
        bottomY: o.bottomY,
        width: o.width,
      });
    }

    // 3. Spike rows.
    for (const s of room.spikes ?? []) {
      this.pendingSpikes.push({
        x: x0 + s.x,
        y: s.y,
        width: s.width,
        phaseOffsetMs: s.phaseOffsetMs,
      });
    }

    // 4. Enemies + their variant.
    for (const e of room.enemies ?? []) {
      this.pendingEnemies.push({
        x: x0 + e.x,
        y: e.y,
        xMin: x0 + e.xMin,
        xMax: x0 + e.xMax,
      });
      this.pendingEnemyVariants.push(e.variant ?? 'patrol');
    }

    // 5. Collectibles.
    for (const c of room.collectibles) {
      this.pendingCollectibles.push({
        x: x0 + c.x,
        y: c.y,
        tier: c.tier,
      });
    }

    // 6. Slide poles.
    for (const sp of room.slidePoles ?? []) {
      this.pendingSlidePoles.push({
        x: x0 + sp.x,
        topY: sp.topY,
        height: sp.height,
      });
    }

    void this.rng; // reserved for future per-chunk randomization (e.g. spike phase shifts)

    this.chunks.set(index, { index, rects });
    if (index > this.maxGenerated) this.maxGenerated = index;
  }

  /** Same as EndlessLevel.findLedge — iterate the static group, return
   *  one whose side edge matches and top is in the grab window. */
  private findLedge(
    bodyLeft: number,
    bodyRight: number,
    bodyTop: number,
    side: -1 | 1,
  ): LedgeInfo | null {
    const X_EPS = 8;
    const Y_LO = bodyTop - 16;
    const Y_HI = bodyTop + 20;

    const children = this.staticGroup.getChildren();
    for (const child of children) {
      const b = (child as Phaser.GameObjects.GameObject & { body?: Phaser.Physics.Arcade.StaticBody }).body;
      if (!b) continue;
      if (b.y < Y_LO || b.y > Y_HI) continue;
      if (side === 1) {
        if (Math.abs(b.x - bodyRight) > X_EPS) continue;
      } else {
        if (Math.abs((b.x + b.width) - bodyLeft) > X_EPS) continue;
      }
      return { topY: b.y, leftX: b.x, width: b.width };
    }
    return null;
  }

  // expose constants for any caller that needs them
  static readonly GROUND_TOP_Y = GROUND_TOP_Y;
}

function mulberry32(seed: number): () => number {
  let t = seed | 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

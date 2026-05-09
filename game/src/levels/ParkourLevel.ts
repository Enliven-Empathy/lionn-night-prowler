import Phaser from 'phaser';
import { COLORS, VIEW } from '../core/constants';
import {
  CollectibleSpawn,
  EndlessLevelHandle,
  EnemySpawn,
  HeartSpawn,
  LedgeInfo,
  OverhangSpawn,
  SpikeSpawn,
} from './EndlessLevel';

/**
 * Parkour mode — a separate, isolated game mode. The Endless mode keeps
 * its existing chunked horizontal level intact; ParkourLevel exposes the
 * SAME `EndlessLevelHandle` interface so GameScene can swap one for the
 * other with no other change to the scene.
 *
 * Design intent (the kid must feel masterful, in full control):
 *   - Continuous ground at the bottom of every chunk → falls always
 *     return the player to a recoverable surface, never to a death pit.
 *   - Vertical-tower chunks stack 3-4 platforms with reachable spacing
 *     (≤ 120 px between layers, well inside PLAYER.jumpReachPx = 130).
 *   - Poles are 22 px wide so the existing narrow-rect wall-cling +
 *     centered-climb logic in PlayerMovement.climbLedge already lands
 *     the player straddling the top.
 *   - No enemies, spikes, hearts, or overhangs in parkour mode (pure
 *     traversal). All `drain*` helpers return empty arrays to satisfy
 *     the handle interface.
 *
 * If parkour-specific hazards or rewards are added later, they go here
 * — the Endless level stays untouched.
 */

const CHUNK_WIDTH = 640;
const GROUND_TOP_Y = 640;
const GROUND_HEIGHT = 80;
const SPAWN_AHEAD_CHUNKS = 4;

const PLATFORM_THICK = 18;
const POLE_WIDTH = 22;
const PLATFORM_FILL = COLORS.platform;
const PLATFORM_EDGE = COLORS.platformEdge;
const POLE_FILL = 0x3a2a55;
const POLE_EDGE = 0x9b59ff;

interface Segment {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'ground' | 'platform' | 'pole';
}

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

  readonly spawnX = 120;
  readonly spawnY = 540;

  constructor(scene: Phaser.Scene, options: ParkourLevelOptions = {}) {
    this.scene = scene;
    this.staticGroup = scene.physics.add.staticGroup();
    this.rng = mulberry32(options.seed ?? (Math.random() * 1e9) | 0);

    // Background — a slightly different tint than endless so the kid can
    // tell the modes apart at a glance, even before reading the HUD label.
    scene.add.rectangle(VIEW.width / 2, VIEW.height / 2, VIEW.width, VIEW.height, 0x0a0816)
      .setDepth(-100)
      .setScrollFactor(0);

    for (let i = 0; i <= SPAWN_AHEAD_CHUNKS; i++) this.generateChunk(i);
  }

  build(): EndlessLevelHandle {
    return {
      staticGroup: this.staticGroup,
      spawnX: this.spawnX,
      spawnY: this.spawnY,
      ensureGenerated: (playerX: number) => this.ensureGenerated(playerX),
      distance: (playerX: number) => Math.max(0, playerX - this.spawnX),
      drainEnemySpawns: () => [] as EnemySpawn[],
      drainCollectibleSpawns: () => {
        const out = this.pendingCollectibles;
        this.pendingCollectibles = [];
        return out;
      },
      drainHeartSpawns: () => [] as HeartSpawn[],
      drainSpikeSpawns: () => [] as SpikeSpawn[],
      drainOverhangSpawns: () => [] as OverhangSpawn[],
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

  private generateChunk(index: number): void {
    const x0 = index * CHUNK_WIDTH;
    const rects: Phaser.GameObjects.Rectangle[] = [];

    let segments: Segment[];
    if (index === 0) {
      // Spawn chunk: simple intro stairs so the kid can practice without a
      // gap-jump on frame one.
      segments = this.layoutIntro(x0);
    } else {
      // Pick from a small pool of patterns. Each pattern guarantees a
      // playable path from the chunk's left edge to a top reward.
      const roll = this.rng();
      if (roll < 0.4) segments = this.layoutStairs(x0, index);
      else if (roll < 0.75) segments = this.layoutPoleGauntlet(x0, index);
      else segments = this.layoutMixed(x0, index);
    }

    for (const seg of segments) {
      const fill = seg.kind === 'pole' ? POLE_FILL : seg.kind === 'platform' ? PLATFORM_FILL : COLORS.ground;
      const edge = seg.kind === 'pole' ? POLE_EDGE : seg.kind === 'platform' ? PLATFORM_EDGE : COLORS.groundEdge;
      const r = this.scene.add.rectangle(seg.x + seg.w / 2, seg.y + seg.h / 2, seg.w, seg.h, fill);
      r.setStrokeStyle(2, edge);
      this.scene.physics.add.existing(r, true);
      this.staticGroup.add(r);
      rects.push(r);
    }

    this.chunks.set(index, { index, rects });
    if (index > this.maxGenerated) this.maxGenerated = index;
  }

  /**
   * The first chunk — fully predictable so the kid orients themselves on
   * spawn. Continuous ground + 3 stair platforms going up to a tier-2
   * reward. No surprises.
   */
  private layoutIntro(x0: number): Segment[] {
    const segs: Segment[] = [];
    segs.push(ground(x0, CHUNK_WIDTH));

    // Stair platforms.
    const baseY = GROUND_TOP_Y - 110;
    for (let i = 0; i < 3; i++) {
      segs.push({
        x: x0 + 180 + i * 130,
        y: baseY - i * 110,
        w: 100,
        h: PLATFORM_THICK,
        kind: 'platform',
      });
    }

    // Reward above the top stair.
    const top = segs[segs.length - 1];
    this.pendingCollectibles.push({
      x: top.x + top.w / 2,
      y: top.y - 36,
      tier: 2,
    });

    return segs;
  }

  /**
   * Stairs going up: 3-4 platforms at increasing heights. Each step is a
   * single-jump reach so chains feel rhythmic. Reward at the top.
   */
  private layoutStairs(x0: number, index: number): Segment[] {
    const segs: Segment[] = [];
    segs.push(ground(x0, CHUNK_WIDTH));

    const stepCount = 3 + (index % 2); // 3 or 4 steps
    const baseY = GROUND_TOP_Y - 110;
    const stepDx = 130;
    const stepDy = 110; // < jumpReachPx (130) so always reachable
    const startX = x0 + 100 + Math.floor(this.rng() * 80);

    for (let i = 0; i < stepCount; i++) {
      segs.push({
        x: startX + i * stepDx,
        y: baseY - i * stepDy,
        w: 100,
        h: PLATFORM_THICK,
        kind: 'platform',
      });
    }

    const top = segs[segs.length - 1];
    this.pendingCollectibles.push({
      x: top.x + top.w / 2,
      y: top.y - 36,
      tier: 3,
    });

    return segs;
  }

  /**
   * Pole gauntlet: 3 vertical poles at varying heights. Player wall-jumps
   * UP each pole, top-stands, then jumps to the next. Existing wall-cling
   * + climbLedge narrow-rect centering handles the "straddle the top"
   * affordance without any new mechanics.
   */
  private layoutPoleGauntlet(x0: number, index: number): Segment[] {
    const segs: Segment[] = [];
    segs.push(ground(x0, CHUNK_WIDTH));

    // 3 poles, evenly spaced. Heights alternate so the climb-jump path
    // requires going up-and-over each time, not flat hops.
    const poleCount = 3;
    const poleStartX = x0 + 130;
    const poleSpacing = 150;
    const baseTopY = GROUND_TOP_Y - 220;
    for (let i = 0; i < poleCount; i++) {
      const wobble = (index + i) % 2 === 0 ? 0 : -60;
      const topY = baseTopY + wobble;
      const height = GROUND_TOP_Y - topY - 30; // 30 px gap above ground so kid can walk under
      segs.push({
        x: poleStartX + i * poleSpacing,
        y: topY,
        w: POLE_WIDTH,
        h: height,
        kind: 'pole',
      });
    }

    // Reward above the rightmost pole.
    const last = segs[segs.length - 1];
    this.pendingCollectibles.push({
      x: last.x + last.w / 2,
      y: last.y - 36,
      tier: 3,
    });

    return segs;
  }

  /**
   * Mixed: a stair, a pole, then a stair to the reward. Exercises the
   * full kit in one chunk.
   */
  private layoutMixed(x0: number, index: number): Segment[] {
    const segs: Segment[] = [];
    segs.push(ground(x0, CHUNK_WIDTH));

    const baseY = GROUND_TOP_Y - 110;
    // Lower stair.
    const s1 = {
      x: x0 + 100,
      y: baseY,
      w: 110,
      h: PLATFORM_THICK,
      kind: 'platform' as const,
    };
    segs.push(s1);

    // Pole between, reaching above stair 1 by ~120 so wall-jumping the
    // pole tops out near the second stair.
    const poleX = s1.x + s1.w + 80;
    const poleTop = baseY - 130;
    const poleH = GROUND_TOP_Y - poleTop - 30;
    segs.push({
      x: poleX,
      y: poleTop,
      w: POLE_WIDTH,
      h: poleH,
      kind: 'pole',
    });

    // Top stair, slightly higher than the pole top so the kid has to
    // top-step + jump.
    const s2 = {
      x: poleX + POLE_WIDTH + 90,
      y: poleTop - 60,
      w: 110,
      h: PLATFORM_THICK,
      kind: 'platform' as const,
    };
    segs.push(s2);

    this.pendingCollectibles.push({
      x: s2.x + s2.w / 2,
      y: s2.y - 36,
      tier: 3,
    });

    void index;
    return segs;
  }

  /**
   * Same logic as EndlessLevel.findLedge — iterate static rects, return
   * one whose side edge matches the player's current side touch and
   * whose top is in the grab window. Implementation stays world-local.
   */
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
}

function ground(x: number, w: number): Segment {
  return {
    x,
    y: GROUND_TOP_Y,
    w,
    h: GROUND_HEIGHT,
    kind: 'ground',
  };
}

// PRNG mirrored from EndlessLevel so seed reproduces a parkour layout.
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

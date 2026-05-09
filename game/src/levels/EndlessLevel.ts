import Phaser from 'phaser';
import { COLORS, VIEW } from '../core/constants';

const CHUNK_WIDTH = 640;
const GROUND_TOP_Y = 640;
const GROUND_HEIGHT = 80;
const SPAWN_AHEAD_CHUNKS = 4;

interface Segment {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'ground' | 'platform' | 'wall';
}

interface Chunk {
  index: number;
  rects: Phaser.GameObjects.Rectangle[];
}

export interface EndlessLevelHandle {
  staticGroup: Phaser.Physics.Arcade.StaticGroup;
  spawnX: number;
  spawnY: number;
  /** Call from GameScene.update with the player's world X. Generates ahead as needed. */
  ensureGenerated: (playerX: number) => void;
  /** Distance the player has progressed from spawn, in pixels. */
  distance: (playerX: number) => number;
}

export class EndlessLevel {
  private scene: Phaser.Scene;
  private staticGroup: Phaser.Physics.Arcade.StaticGroup;
  private chunks = new Map<number, Chunk>();
  private rng: () => number;
  private maxGenerated = -1;

  readonly spawnX = 120;
  readonly spawnY = 540;

  constructor(scene: Phaser.Scene, seed?: number) {
    this.scene = scene;
    this.staticGroup = scene.physics.add.staticGroup();
    this.rng = mulberry32(seed ?? (Math.random() * 1e9) | 0);

    // Background fill — covers the whole visible canvas; scrolls with camera-fixed depth.
    scene.add.rectangle(VIEW.width / 2, VIEW.height / 2, VIEW.width, VIEW.height, COLORS.background)
      .setDepth(-100)
      .setScrollFactor(0);

    // Pre-generate the first few chunks so the player has somewhere to land at spawn.
    for (let i = 0; i <= SPAWN_AHEAD_CHUNKS; i++) this.generateChunk(i);
  }

  build(): EndlessLevelHandle {
    return {
      staticGroup: this.staticGroup,
      spawnX: this.spawnX,
      spawnY: this.spawnY,
      ensureGenerated: (playerX: number) => this.ensureGenerated(playerX),
      distance: (playerX: number) => Math.max(0, playerX - this.spawnX),
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

    const segments: Segment[] =
      index === 0
        ? this.layoutSpawnChunk(x0)
        : this.layoutProceduralChunk(x0, index);

    for (const seg of segments) {
      const fill =
        seg.kind === 'platform' ? COLORS.platform :
        seg.kind === 'wall' ? COLORS.platform :
        COLORS.ground;
      const edge =
        seg.kind === 'platform' ? COLORS.platformEdge :
        seg.kind === 'wall' ? COLORS.platformEdge :
        COLORS.groundEdge;
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
   * Spawn chunk: a wide, safe runway. Just one big floor — no pits, no decorations.
   * The player needs to gain orientation before things get dangerous.
   */
  private layoutSpawnChunk(x0: number): Segment[] {
    return [
      { x: x0, y: GROUND_TOP_Y, w: CHUNK_WIDTH, h: GROUND_HEIGHT, kind: 'ground' },
    ];
  }

  /**
   * Procedural chunk: alternates ground segments with pits. Difficulty curve
   * stretches over the first ~12 chunks then plateaus.
   *
   * Constraints (keep the slice always-jumpable):
   *   - Pit width ≤ MAX_PIT (240) — within Lionn's run+jump arc at peak velocity.
   *   - First ground in any chunk is at least MIN_LAND_GROUND wide so the
   *     player has a safe landing zone after a pit.
   *   - Optional floating platform sometimes acts as a midair stepping-stone.
   */
  private layoutProceduralChunk(x0: number, index: number): Segment[] {
    const segs: Segment[] = [];
    const difficulty = Math.min(index / 12, 1); // 0..1 ramp

    const minPit = 90;
    const maxPit = 130 + difficulty * 110;       // 130 → 240
    const minGround = 180 - difficulty * 80;     // 180 → 100
    const maxGround = 360;
    const minLandGround = 120;                   // first segment of chunk
    const platformChance = 0.35 + difficulty * 0.35; // 0.35 → 0.70

    let cursor = x0;
    const end = x0 + CHUNK_WIDTH;
    let firstSegment = true;

    while (cursor < end - 60) {
      const minLen = firstSegment ? Math.max(minLandGround, minGround) : minGround;
      const groundLen = randRange(this.rng, minLen, maxGround);
      const groundEnd = Math.min(cursor + groundLen, end);
      segs.push({ x: cursor, y: GROUND_TOP_Y, w: groundEnd - cursor, h: GROUND_HEIGHT, kind: 'ground' });
      cursor = groundEnd;
      firstSegment = false;

      if (cursor < end - 60) {
        const pitLen = randRange(this.rng, minPit, maxPit);
        cursor = Math.min(cursor + pitLen, end);
      }
    }

    // Maybe a floating platform inside this chunk (ignores the layout-cursor;
    // just hovers somewhere in the chunk). Useful as a high-route or a stepping
    // stone over wider pits.
    if (this.rng() < platformChance) {
      const pw = randRange(this.rng, 90, 170);
      const px = x0 + randRange(this.rng, 60, CHUNK_WIDTH - pw - 60);
      const py = GROUND_TOP_Y - randRange(this.rng, 110, 230);
      segs.push({ x: px, y: py, w: pw, h: 22, kind: 'platform' });

      // Sometimes pair the platform with a wall-cling face.
      if (difficulty > 0.4 && this.rng() < 0.35) {
        const wallH = 180;
        const wallY = py - wallH;
        const wallSide = this.rng() < 0.5 ? px - 26 : px + pw + 4;
        segs.push({ x: wallSide, y: wallY, w: 22, h: wallH, kind: 'wall' });
      }
    }

    return segs;
  }
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randRange(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

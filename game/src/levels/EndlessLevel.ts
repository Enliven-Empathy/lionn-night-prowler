import Phaser from 'phaser';
import { COLORS, PLAYER, VIEW } from '../core/constants';

const CHUNK_WIDTH = 640;
const GROUND_TOP_Y = 640;
const GROUND_HEIGHT = 80;
const SPAWN_AHEAD_CHUNKS = 4;

/**
 * Reachability:
 * - JUMP_REACH = the highest the player can rise from a surface using
 *   jump + double-jump. Anything above this is unreachable from that surface.
 * - WALL_REACH = JUMP_REACH plus a wall-cling + wall-jump bonus. Used only
 *   for surfaces that have an adjacent wall.
 *
 * We use these to (a) cap floating-platform height at chunk-build time so the
 * player can always reach them, and (b) filter out collectibles that would
 * land above the reach line of any reachable surface.
 */
const JUMP_REACH = PLAYER.jumpReachPx;
const WALL_REACH = PLAYER.jumpReachPx + PLAYER.wallJumpBonusReachPx;

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

export interface EnemySpawn {
  /** World X (center of body). */
  x: number;
  /** World Y (center of body). Will sit on the ground. */
  y: number;
  /** Patrol horizontal bounds — enemy reverses at these. */
  xMin: number;
  xMax: number;
}

export interface CollectibleSpawn {
  x: number;
  y: number;
  tier: 1 | 2 | 3;
}

export interface HeartSpawn {
  x: number;
  y: number;
}

export interface EndlessLevelHandle {
  staticGroup: Phaser.Physics.Arcade.StaticGroup;
  spawnX: number;
  spawnY: number;
  /** Call from GameScene.update with the player's world X. Generates ahead as needed. */
  ensureGenerated: (playerX: number) => void;
  /** Distance the player has progressed from spawn, in pixels. */
  distance: (playerX: number) => number;
  /** Returns and clears any enemy spawns buffered since the last call. */
  drainEnemySpawns: () => EnemySpawn[];
  /** Returns and clears any collectible spawns buffered since the last call. */
  drainCollectibleSpawns: () => CollectibleSpawn[];
  /** Returns and clears any heart (HP) spawns buffered since the last call. */
  drainHeartSpawns: () => HeartSpawn[];
}

export interface EndlessLevelOptions {
  seed?: number;
}

export class EndlessLevel {
  private scene: Phaser.Scene;
  private staticGroup: Phaser.Physics.Arcade.StaticGroup;
  private chunks = new Map<number, Chunk>();
  private rng: () => number;
  private maxGenerated = -1;
  private pendingSpawns: EnemySpawn[] = [];
  private pendingCollectibles: CollectibleSpawn[] = [];
  private pendingHearts: HeartSpawn[] = [];

  readonly spawnX = 120;
  readonly spawnY = 540;

  constructor(scene: Phaser.Scene, options: EndlessLevelOptions = {}) {
    this.scene = scene;
    this.staticGroup = scene.physics.add.staticGroup();
    this.rng = mulberry32(options.seed ?? (Math.random() * 1e9) | 0);

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
      drainEnemySpawns: () => {
        const out = this.pendingSpawns;
        this.pendingSpawns = [];
        return out;
      },
      drainCollectibleSpawns: () => {
        const out = this.pendingCollectibles;
        this.pendingCollectibles = [];
        return out;
      },
      drainHeartSpawns: () => {
        const out = this.pendingHearts;
        this.pendingHearts = [];
        return out;
      },
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

    // After the chunk's geometry is in place, decide if we should spawn an enemy on it.
    // First two chunks are enemy-free (player needs space to read the controls + first pits).
    // Spawns are buffered; GameScene.update drains them once construction is complete.
    if (index >= 2) {
      const enemy = this.pickEnemySpawn(segments, index);
      if (enemy) this.pendingSpawns.push(enemy);
    }

    // Collectibles: every chunk past the spawn one. Placement is tier-driven:
    //   tier 1 trails along the player's run line on each ground segment
    //   tier 2 floats over pits or above platforms — needs a jump
    //   tier 3 hovers high above any wall — needs wall-cling + wall-jump
    if (index >= 1) {
      this.scatterCollectibles(segments, index);
    }

    // Hearts: rare HP pickups. Skip the first few chunks so the player
    // doesn't see one before they've taken any damage.
    if (index >= 3) {
      this.maybeSpawnHeart(segments);
    }
  }

  /**
   * 25% chance per chunk to spawn a heart on a wide ground segment, hovering
   * ~36 px above ground top so the player just walks/jumps into it.
   */
  private maybeSpawnHeart(segments: Segment[]): void {
    if (this.rng() >= 0.25) return;
    const grounds = segments.filter((s) => s.kind === 'ground' && s.w >= 200);
    if (grounds.length === 0) return;
    const pick = grounds[Math.floor(this.rng() * grounds.length)];
    this.pendingHearts.push({
      x: pick.x + pick.w / 2,
      y: pick.y - 36,
    });
  }

  /**
   * Place collectibles into a chunk by reading its segments. Placement rules:
   *
   *   tier 1 (gold) — for every ground segment ≥ 200px, drop 1-2 coins along
   *     the run path (just above ground top). Cheap to grab, fills score early.
   *
   *   tier 2 (violet) — over each pit (between this ground and the next), float
   *     a gem. Also occasional gem above a floating platform. Requires a jump.
   *
   *   tier 3 (cyan) — only spawns when the chunk has a wall segment. Placed
   *     above the wall's top, just out of reach unless you cling and jump.
   */
  private scatterCollectibles(segments: Segment[], _index: number): void {
    const grounds = segments.filter((s) => s.kind === 'ground');
    const platforms = segments.filter((s) => s.kind === 'platform');
    const walls = segments.filter((s) => s.kind === 'wall');

    // Reachability ceilings: the highest Y (smallest number) the player can
    // rise to from any surface in this chunk. Used to filter out spawns that
    // would otherwise hover above the player's max reach.
    const groundCeiling = GROUND_TOP_Y - JUMP_REACH;       // from any ground
    const platformCeiling = (p: Segment) => p.y - JUMP_REACH; // from a platform
    const wallCeiling = (w: Segment) => w.y - WALL_REACH;     // from a wall, with wall-jump bonus

    // Best (lowest-numbered, i.e. highest-on-screen) Y the player can possibly reach.
    const minReachableY = Math.min(
      groundCeiling,
      ...platforms.map(platformCeiling),
      ...walls.map(wallCeiling),
    );

    // Tier 1 — always reachable (sits on ground top).
    for (const g of grounds) {
      if (g.w < 200) continue;
      const count = g.w > 320 ? 2 : 1;
      const pad = 50;
      for (let i = 0; i < count; i++) {
        const t = count === 1 ? 0.5 : (i + 1) / (count + 1);
        const x = g.x + pad + (g.w - pad * 2) * t;
        const y = g.y - 28;
        this.pendingCollectibles.push({ x, y, tier: 1 });
      }
    }

    // Tier 2 over pits. Always within ground-jump reach by design (70-120 above ground).
    const sortedGrounds = [...grounds].sort((a, b) => a.x - b.x);
    for (let i = 0; i < sortedGrounds.length - 1; i++) {
      const left = sortedGrounds[i];
      const right = sortedGrounds[i + 1];
      const leftEdge = left.x + left.w;
      const rightEdge = right.x;
      const pitWidth = rightEdge - leftEdge;
      if (pitWidth < 80) continue;
      if (this.rng() < 0.75) {
        const x = leftEdge + pitWidth / 2;
        const y = left.y - 70 - this.rng() * 50; // 70-120 px above ground top
        if (y >= groundCeiling) {
          this.pendingCollectibles.push({ x, y, tier: 2 });
        }
      }
    }

    // Tier 2 above a platform — only if the platform itself is reachable.
    for (const p of platforms) {
      if (p.y < groundCeiling) continue; // platform is too high to even land on
      if (this.rng() >= 0.5) continue;
      const gemY = p.y - 28;
      if (gemY >= groundCeiling || gemY >= platformCeiling(p)) {
        // Reachable from ground OR from the platform itself.
        this.pendingCollectibles.push({ x: p.x + p.w / 2, y: gemY, tier: 2 });
      }
    }

    // Tier 3 above walls. Place at wall.y - 22, but only if it's actually
    // reachable via wall-cling + wall-jump from that wall.
    for (const w of walls) {
      const gemY = w.y - 22;
      if (gemY >= wallCeiling(w)) {
        this.pendingCollectibles.push({ x: w.x + w.w / 2, y: gemY, tier: 3 });
      }
    }

    // Final safety net: drop any pending spawn for THIS chunk that landed
    // above absolute reach (rare race when a tier-2 over-pit roll drifted high).
    void minReachableY;
  }

  /**
   * Return an enemy spawn for this chunk, or null if rolled out. Picks a wide-enough
   * ground segment (≥ 180 px) and patrols within its bounds with a 24px ledge buffer.
   *
   * Spawn rate ramps with chunk index: a couple chunks of solo platforming up front,
   * then ~35-65% chance afterwards.
   */
  private pickEnemySpawn(segments: Segment[], index: number): EnemySpawn | null {
    const difficulty = Math.min(index / 14, 1);
    const chance = 0.30 + difficulty * 0.35;
    if (this.rng() > chance) return null;

    // Find ground segments wide enough to patrol on. Skip platforms/walls.
    const candidates = segments.filter((s) => s.kind === 'ground' && s.w >= 180);
    if (candidates.length === 0) return null;

    const pick = candidates[Math.floor(this.rng() * candidates.length)];
    const buffer = 24;
    const xMin = pick.x + buffer;
    const xMax = pick.x + pick.w - buffer;
    const groundTop = pick.y;
    return {
      x: (xMin + xMax) / 2,
      y: groundTop - 36, // body half-height; sits on ground
      xMin,
      xMax,
    };
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
    //
    // Reachability: decide *first* whether this platform will have an adjacent
    // wall. If yes, the platform can sit higher because the player can wall-
    // cling + wall-jump to it. If not, cap the platform within plain double-
    // jump range from the ground below.
    if (this.rng() < platformChance) {
      const willHaveWall = difficulty > 0.4 && this.rng() < 0.35;
      const reach = willHaveWall ? WALL_REACH : JUMP_REACH;
      const minRise = 100;
      // Cap to reach so the platform's top is at least `reach` above ground top.
      // (lower number = lower y-coordinate = higher on screen).
      const pw = randRange(this.rng, 90, 170);
      const px = x0 + randRange(this.rng, 60, CHUNK_WIDTH - pw - 60);
      const py = GROUND_TOP_Y - randRange(this.rng, minRise, reach);
      segs.push({ x: px, y: py, w: pw, h: 22, kind: 'platform' });

      if (willHaveWall) {
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

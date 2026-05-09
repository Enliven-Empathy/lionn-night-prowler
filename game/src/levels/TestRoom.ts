import Phaser from 'phaser';
import { COLORS, VIEW } from '../core/constants';

export interface TestRoomLayout {
  staticGroup: Phaser.Physics.Arcade.StaticGroup;
  spawnX: number;
  spawnY: number;
  width: number;
  height: number;
}

interface Block {
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
}

const BLOCKS: Block[] = [
  // Ground
  { x: 0, y: 660, w: 600, h: 60, label: 'ground-left' },
  // Gap (no block) — 200px wide between 600 and 800
  { x: 800, y: 660, w: 1280 - 800, h: 60, label: 'ground-right' },
  // Low platform
  { x: 220, y: 540, w: 160, h: 24, label: 'platform-low' },
  // Mid platform
  { x: 460, y: 440, w: 180, h: 24, label: 'platform-mid' },
  // High platform
  { x: 720, y: 360, w: 160, h: 24, label: 'platform-high' },
  // Ledge
  { x: 980, y: 480, w: 220, h: 24, label: 'ledge' },
  // Tall wall
  { x: 1200, y: 320, w: 60, h: 360, label: 'wall' },
];

export function buildTestRoom(scene: Phaser.Scene): TestRoomLayout {
  const group = scene.physics.add.staticGroup();

  scene.add.rectangle(VIEW.width / 2, VIEW.height / 2, VIEW.width, VIEW.height, COLORS.background)
    .setDepth(-100)
    .setScrollFactor(0);

  for (const b of BLOCKS) {
    const isPlatform = b.label?.startsWith('platform') ?? false;
    const fill = isPlatform ? COLORS.platform : COLORS.ground;
    const edge = isPlatform ? COLORS.platformEdge : COLORS.groundEdge;

    const rect = scene.add.rectangle(b.x + b.w / 2, b.y + b.h / 2, b.w, b.h, fill);
    rect.setStrokeStyle(2, edge);

    scene.physics.add.existing(rect, true);
    group.add(rect);
  }

  // Decorative scrim columns to give depth without blocking gameplay
  for (let i = 0; i < 5; i++) {
    const x = 60 + i * 260;
    scene.add.rectangle(x, 200, 30, 280, 0x1c1428, 0.6).setDepth(-50);
  }

  return {
    staticGroup: group,
    spawnX: 120,
    spawnY: 580,
    width: VIEW.width,
    height: VIEW.height,
  };
}

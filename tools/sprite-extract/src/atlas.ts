import sharp from 'sharp';
import { ExtractedGroup } from './types';
import { TrimmedFrame } from './anchor';

interface AtlasFrameJson {
  frame: { x: number; y: number; w: number; h: number };
  rotated: false;
  trimmed: false;
  spriteSourceSize: { x: 0; y: 0; w: number; h: number };
  sourceSize: { w: number; h: number };
  anchor?: { x: number; y: number };
}

export interface PackedAtlas {
  png: Buffer;
  json: object;
  manifest: ExtractedGroup[];
}

interface PendingFrame {
  group: string;
  index: number;
  frame: TrimmedFrame;
  frameRate: number;
  anchor: 'foot' | 'center' | 'top';
}

export async function packAtlas(grouped: Record<string, { frames: TrimmedFrame[]; frameRate: number; anchor: 'foot' | 'center' | 'top' }>): Promise<PackedAtlas> {
  const all: PendingFrame[] = [];
  for (const [groupName, g] of Object.entries(grouped)) {
    g.frames.forEach((f, i) => all.push({ group: groupName, index: i, frame: f, frameRate: g.frameRate, anchor: g.anchor }));
  }

  // Simple shelf packer: pack rows of equal-height frames. Good enough for animation
  // sets where every frame in a group already has the same size.
  const PADDING = 2;
  const MAX_WIDTH = 2048;
  const placed: { f: PendingFrame; x: number; y: number }[] = [];
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  let atlasWidth = 0;

  for (const item of all) {
    const w = item.frame.width;
    const h = item.frame.height;
    if (cursorX + w + PADDING > MAX_WIDTH) {
      cursorX = 0;
      cursorY += rowHeight + PADDING;
      rowHeight = 0;
    }
    placed.push({ f: item, x: cursorX, y: cursorY });
    cursorX += w + PADDING;
    rowHeight = Math.max(rowHeight, h);
    atlasWidth = Math.max(atlasWidth, cursorX);
  }
  const atlasHeight = cursorY + rowHeight;

  const composites = await Promise.all(
    placed.map(async (p) => ({
      input: p.f.frame.buffer,
      left: p.x,
      top: p.y,
    })),
  );

  const png = await sharp({
    create: {
      width: atlasWidth || 1,
      height: atlasHeight || 1,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();

  const frames: Record<string, AtlasFrameJson> = {};
  const manifest: ExtractedGroup[] = [];
  const byGroup: Record<string, { f: PendingFrame; x: number; y: number }[]> = {};

  for (const p of placed) {
    const key = `${p.f.group}_${String(p.f.index).padStart(3, '0')}`;
    frames[key] = {
      frame: { x: p.x, y: p.y, w: p.f.frame.width, h: p.f.frame.height },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: p.f.frame.width, h: p.f.frame.height },
      sourceSize: { w: p.f.frame.width, h: p.f.frame.height },
      anchor: { x: p.f.frame.anchorX, y: p.f.frame.anchorY },
    };
    (byGroup[p.f.group] ||= []).push(p);
  }

  for (const [groupName, items] of Object.entries(byGroup)) {
    const sample = items[0].f.frame;
    manifest.push({
      name: groupName,
      frameWidth: sample.width,
      frameHeight: sample.height,
      frameRate: items[0].f.frameRate,
      anchor: items[0].f.anchor,
      frames: items.map((it) => ({
        groupName,
        index: it.f.index,
        fileName: `${groupName}_${String(it.f.index).padStart(3, '0')}`,
        width: it.f.frame.width,
        height: it.f.frame.height,
        anchorX: it.f.frame.anchorX,
        anchorY: it.f.frame.anchorY,
      })),
    });
  }

  const json = {
    frames,
    meta: {
      app: 'lionn-sprite-extract',
      version: '0.0.1',
      image: 'atlas.png',
      format: 'RGBA8888',
      size: { w: atlasWidth, h: atlasHeight },
      scale: '1',
    },
    animations: Object.fromEntries(
      manifest.map((g) => [g.name, g.frames.map((f) => f.fileName)]),
    ),
  };

  return { png, json, manifest };
}

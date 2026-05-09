import sharp from 'sharp';
import { AnchorKind } from './types';

export interface Bbox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TrimmedFrame {
  buffer: Buffer;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
}

export async function findAlphaBbox(input: Buffer, threshold: number): Promise<Bbox | null> {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * channels + 3];
      if (alpha > threshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function anchorOffset(anchor: AnchorKind, bbox: Bbox): { ax: number; ay: number } {
  switch (anchor) {
    case 'foot':
      return { ax: bbox.x + bbox.w / 2, ay: bbox.y + bbox.h };
    case 'top':
      return { ax: bbox.x + bbox.w / 2, ay: bbox.y };
    case 'center':
    default:
      return { ax: bbox.x + bbox.w / 2, ay: bbox.y + bbox.h / 2 };
  }
}

/**
 * Trims each input to its alpha bounding box, then composites onto a uniform
 * canvas so every frame in a group shares the same dimensions and the chosen
 * anchor point lands at a fixed position. Without this step, frames jitter
 * during animation even when each individual frame is clean.
 */
export async function alignFrames(
  inputs: Buffer[],
  anchor: AnchorKind,
  alphaThreshold: number,
  padding: number,
): Promise<TrimmedFrame[]> {
  const trimmed: { buf: Buffer; bbox: Bbox; ax: number; ay: number }[] = [];

  for (const buf of inputs) {
    const bbox = await findAlphaBbox(buf, alphaThreshold);
    if (!bbox) {
      throw new Error('Frame has no non-transparent pixels — bg removal may have eaten the subject');
    }
    const cropped = await sharp(buf)
      .extract({ left: bbox.x, top: bbox.y, width: bbox.w, height: bbox.h })
      .png()
      .toBuffer();
    const { ax, ay } = anchorOffset(anchor, bbox);
    trimmed.push({ buf: cropped, bbox, ax: ax - bbox.x, ay: ay - bbox.y });
  }

  const maxLeft = Math.max(...trimmed.map((t) => t.ax));
  const maxRight = Math.max(...trimmed.map((t) => t.bbox.w - t.ax));
  const maxAbove = Math.max(...trimmed.map((t) => t.ay));
  const maxBelow = Math.max(...trimmed.map((t) => t.bbox.h - t.ay));

  const canvasW = Math.ceil(maxLeft + maxRight) + padding * 2;
  const canvasH = Math.ceil(maxAbove + maxBelow) + padding * 2;
  const anchorX = Math.round(maxLeft + padding);
  const anchorY = Math.round(maxAbove + padding);

  const out: TrimmedFrame[] = [];
  for (const t of trimmed) {
    const left = Math.round(anchorX - t.ax);
    const top = Math.round(anchorY - t.ay);
    const composed = await sharp({
      create: {
        width: canvasW,
        height: canvasH,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: t.buf, left, top }])
      .png()
      .toBuffer();

    out.push({ buffer: composed, width: canvasW, height: canvasH, anchorX, anchorY });
  }

  return out;
}

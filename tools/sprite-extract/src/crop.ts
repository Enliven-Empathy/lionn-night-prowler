import sharp from 'sharp';
import { Cell } from './types';

export async function cropCell(input: Buffer, cell: Cell): Promise<Buffer> {
  return sharp(input)
    .extract({ left: cell.x, top: cell.y, width: cell.w, height: cell.h })
    .png()
    .toBuffer();
}

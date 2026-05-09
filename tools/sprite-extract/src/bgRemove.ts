import { removeBackground } from '@imgly/background-removal-node';

export async function bgRemove(input: Buffer, model: 'small' | 'medium' = 'medium'): Promise<Buffer> {
  const blob = new Blob([input], { type: 'image/png' });
  const result = await removeBackground(blob, {
    model,
    output: { format: 'image/png', quality: 1 },
  });
  const arrBuf = await result.arrayBuffer();
  return Buffer.from(arrBuf);
}

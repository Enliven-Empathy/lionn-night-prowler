import { promises as fs } from 'node:fs';
import path from 'node:path';
import minimist from 'minimist';
import sharp from 'sharp';
import { ExtractConfig, ExtractedGroup } from './types';
import { cropCell } from './crop';
import { bgRemove } from './bgRemove';
import { alignFrames, TrimmedFrame } from './anchor';
import { packAtlas } from './atlas';
import { renderPreviewHtml } from './preview';

interface CliArgs {
  config: string;
  noBgRemove?: boolean;
  individualPngs?: boolean;
}

async function loadConfig(configPath: string): Promise<ExtractConfig> {
  const abs = path.resolve(configPath);
  const raw = await fs.readFile(abs, 'utf-8');
  const cfg: ExtractConfig = JSON.parse(raw);
  // Resolve input/output relative to the config file's location.
  const baseDir = path.dirname(abs);
  cfg.input = path.resolve(baseDir, cfg.input);
  cfg.outputDir = path.resolve(baseDir, cfg.outputDir);
  return cfg;
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function main(): Promise<void> {
  const args = minimist(process.argv.slice(2)) as unknown as CliArgs & { _: string[] };
  if (!args.config) {
    console.error('Usage: npm run extract -- --config <path-to-config.json> [--noBgRemove] [--individualPngs]');
    process.exit(1);
  }

  const cfg = await loadConfig(args.config);
  const alphaThreshold = cfg.alphaThreshold ?? 16;
  const padding = cfg.padding ?? 4;
  const defaultAnchor = cfg.defaultAnchor ?? 'foot';
  const defaultFps = cfg.defaultFrameRate ?? 12;
  const bgEnabled = !args.noBgRemove && (cfg.bgRemoval?.enabled ?? true);
  const bgModel = cfg.bgRemoval?.model ?? 'medium';

  console.log(`[extract] input:      ${cfg.input}`);
  console.log(`[extract] output:     ${cfg.outputDir}`);
  console.log(`[extract] groups:     ${cfg.groups.map((g) => g.name).join(', ')}`);
  console.log(`[extract] bg-removal: ${bgEnabled ? bgModel : 'OFF'}`);

  const sheetBuf = await fs.readFile(cfg.input);
  const sheetMeta = await sharp(sheetBuf).metadata();
  console.log(`[extract] sheet:      ${sheetMeta.width}×${sheetMeta.height}`);

  await ensureDir(cfg.outputDir);

  const grouped: Record<string, { frames: TrimmedFrame[]; frameRate: number; anchor: 'foot' | 'center' | 'top' }> = {};

  for (const group of cfg.groups) {
    console.log(`[extract] group ${group.name} (${group.cells.length} cell${group.cells.length === 1 ? '' : 's'})`);
    const cellBuffers: Buffer[] = [];

    for (let i = 0; i < group.cells.length; i++) {
      const cell = group.cells[i];
      let buf = await cropCell(sheetBuf, cell);
      if (bgEnabled) {
        process.stdout.write(`  bg-remove ${i + 1}/${group.cells.length}... `);
        const t0 = Date.now();
        buf = await bgRemove(buf, bgModel);
        console.log(`${Date.now() - t0}ms`);
      }
      cellBuffers.push(buf);
    }

    const aligned = await alignFrames(cellBuffers, group.anchor ?? defaultAnchor, alphaThreshold, padding);
    grouped[group.name] = {
      frames: aligned,
      frameRate: group.frameRate ?? defaultFps,
      anchor: group.anchor ?? defaultAnchor,
    };
  }

  const { png, json, manifest } = await packAtlas(grouped);

  const atlasPng = path.join(cfg.outputDir, 'atlas.png');
  const atlasJson = path.join(cfg.outputDir, 'atlas.json');
  const manifestPath = path.join(cfg.outputDir, 'manifest.json');
  const previewPath = path.join(cfg.outputDir, 'preview.html');

  await fs.writeFile(atlasPng, png);
  await fs.writeFile(atlasJson, JSON.stringify(json, null, 2));
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  await fs.writeFile(previewPath, renderPreviewHtml(manifest, 'atlas.png'));

  if (args.individualPngs) {
    const framesDir = path.join(cfg.outputDir, 'frames');
    await ensureDir(framesDir);
    for (const group of manifest) {
      for (const f of group.frames) {
        const rect = (json as { frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }> }).frames[f.fileName].frame;
        const out = await sharp(png).extract({ left: rect.x, top: rect.y, width: rect.w, height: rect.h }).png().toBuffer();
        await fs.writeFile(path.join(framesDir, `${f.fileName}.png`), out);
      }
    }
    console.log(`[extract] wrote individual frames → ${framesDir}`);
  }

  console.log(`[extract] wrote atlas      → ${atlasPng}`);
  console.log(`[extract] wrote atlas json → ${atlasJson}`);
  console.log(`[extract] wrote manifest   → ${manifestPath}`);
  console.log(`[extract] wrote preview    → ${previewPath}`);
  printManifestSummary(manifest);
}

function printManifestSummary(manifest: ExtractedGroup[]): void {
  console.log('');
  console.log('  group              frames   size              fps   anchor');
  console.log('  -----              ------   ----              ---   ------');
  for (const g of manifest) {
    console.log(
      `  ${g.name.padEnd(18)} ${String(g.frames.length).padStart(6)}   ${`${g.frameWidth}×${g.frameHeight}`.padEnd(16)}  ${String(g.frameRate).padStart(3)}   ${g.anchor}`,
    );
  }
}

main().catch((err) => {
  console.error('[extract] failed:', err);
  process.exit(1);
});

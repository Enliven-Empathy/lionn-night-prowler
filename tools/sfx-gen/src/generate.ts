import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SFX_MANIFEST, SfxEntry } from './manifest.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const ENV_PATH = path.resolve(HERE, '../.env');
const OUT_DIR = path.resolve(ROOT, 'game/public/assets/audio');

const EL_BASE = 'https://api.elevenlabs.io';
const ENDPOINT = `${EL_BASE}/v1/sound-generation`;

interface CliArgs {
  dryRun: boolean;
  only: string[] | null;
  force: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false, only: null, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--force') args.force = true;
    else if (a === '--only') {
      const rest = argv.slice(i + 1).filter((x) => !x.startsWith('--'));
      args.only = rest;
      i += rest.length;
    }
  }
  return args;
}

async function loadEnv(): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(ENV_PATH, 'utf-8');
    const out: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx < 0) continue;
      const k = trimmed.slice(0, idx).trim();
      const v = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
      out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

async function ensureOutDir(): Promise<void> {
  await fs.mkdir(OUT_DIR, { recursive: true });
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function generateOne(entry: SfxEntry, apiKey: string): Promise<Buffer> {
  const dur = Math.max(0.5, Math.min(22, entry.durationSec));
  const body = {
    text: entry.prompt,
    duration_seconds: dur,
    prompt_influence: entry.promptInfluence ?? 0.4,
  };

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'content-type': 'application/json',
      accept: 'audio/mpeg',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`ElevenLabs ${res.status}: ${txt.slice(0, 240)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}

async function writeManifestJson(): Promise<void> {
  const slim = SFX_MANIFEST.map((e) => ({
    key: e.key,
    filename: e.filename,
    scope: e.scope,
    loop: e.loop ?? false,
  }));
  await fs.writeFile(
    path.join(OUT_DIR, 'audio-manifest.json'),
    JSON.stringify(slim, null, 2),
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const env = await loadEnv();
  const apiKey = env.ELEVENLABS_API_KEY ?? process.env.ELEVENLABS_API_KEY ?? '';

  console.log(`[sfx] manifest:    ${SFX_MANIFEST.length} entries`);
  console.log(`[sfx] output dir:  ${OUT_DIR}`);
  if (args.dryRun) console.log('[sfx] DRY RUN — no API calls, no files written');
  if (args.only) console.log(`[sfx] only:        ${args.only.join(', ')}`);

  if (!args.dryRun && !apiKey) {
    console.error('');
    console.error('[sfx] No ELEVENLABS_API_KEY found.');
    console.error(`[sfx] Paste your key into:  ${ENV_PATH}`);
    console.error('[sfx] Format:  ELEVENLABS_API_KEY=sk_xxxxxxxxxxxxxxxxxxxx');
    console.error('[sfx] Then re-run:  npm run generate');
    process.exit(1);
  }

  await ensureOutDir();

  const wanted = args.only
    ? SFX_MANIFEST.filter((e) => args.only!.some((q) => e.key.includes(q) || e.scope === q))
    : SFX_MANIFEST;

  if (wanted.length === 0) {
    console.error('[sfx] no manifest entries matched the --only filter');
    process.exit(1);
  }

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  const failures: string[] = [];

  for (let i = 0; i < wanted.length; i++) {
    const e = wanted[i];
    const out = path.join(OUT_DIR, e.filename);
    const tag = `${(i + 1).toString().padStart(2)}/${wanted.length}`;

    if (!args.force && (await fileExists(out))) {
      console.log(`[sfx] ${tag}  ${e.key.padEnd(28)} — already exists, skip (use --force to regenerate)`);
      skipped++;
      continue;
    }

    if (args.dryRun) {
      console.log(`[sfx] ${tag}  ${e.key.padEnd(28)} — would generate (${e.durationSec}s)`);
      continue;
    }

    process.stdout.write(`[sfx] ${tag}  ${e.key.padEnd(28)} — generating ${e.durationSec}s ... `);
    try {
      const t0 = Date.now();
      const buf = await generateOne(e, apiKey);
      await fs.writeFile(out, buf);
      console.log(`${(buf.length / 1024).toFixed(1)} KB  in ${Date.now() - t0}ms`);
      ok++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`FAIL — ${msg}`);
      failures.push(`${e.key}: ${msg}`);
      failed++;
    }
  }

  await writeManifestJson();
  console.log(`[sfx] done. ok=${ok}  skipped=${skipped}  failed=${failed}`);
  if (failures.length > 0) {
    console.log('[sfx] failures:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[sfx] crashed:', err);
  process.exit(1);
});

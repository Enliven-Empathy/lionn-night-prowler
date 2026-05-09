# sfx-gen — Lionn: Night Prowler audio generator

Calls the ElevenLabs sound-generation API (the same one used by the book
project) and writes embedded mp3s into `game/public/assets/audio/` so the
game preloads them like any other static asset. No runtime API calls, no
key shipped to the browser.

## Setup (once)

1. Copy the env template:
   ```bash
   cp .env.example .env
   ```

2. Open `.env` and paste your ElevenLabs API key after the `=`:
   ```
   ELEVENLABS_API_KEY=sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
   (The file is gitignored — never committed.)

3. Install deps:
   ```bash
   npm install
   ```

## Generate

```bash
# Generate everything in the manifest. Skips files already on disk.
npm run generate

# See what would be generated without calling the API or writing files.
npm run generate:dry

# Force-regenerate even if files already exist (re-rolls audio).
npx tsx src/generate.ts --force

# Generate only a subset by key substring or scope.
npx tsx src/generate.ts --only player_jump
npx tsx src/generate.ts --only collectible              # whole scope
npx tsx src/generate.ts --only enemy combat             # multiple
```

Output:

- `game/public/assets/audio/<filename>.mp3` — one file per manifest entry
- `game/public/assets/audio/audio-manifest.json` — slim list (key, filename,
  scope, loop) that the Phaser PreloadScene reads to decide what to load

## Editing the manifest

Edit `src/manifest.ts`. Each entry has:

- `key` — the game-side identifier (`this.sound.play(key)`)
- `filename` — output filename
- `prompt` — what gets sent to ElevenLabs sound-generation
- `durationSec` — 0.5 to 22 (API limit)
- `promptInfluence` — 0..1 (default 0.4). Higher = literal, lower = creative
- `loop` — true for music tracks
- `scope` + `triggeredBy` — documentation only, helps you re-find entries

After editing, re-run `npm run generate` (use `--force` if the file already
exists and you want a new roll).

## Costs

ElevenLabs sound-generation bills against the same credit pool as TTS.
Prices vary by plan; a full run of this manifest is roughly 2-3 minutes of
audio across 25+ files. Use `--dry-run` first to confirm scope.

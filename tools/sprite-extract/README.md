# sprite-extract

Turns an AI-generated character sheet into per-frame transparent sprites
with anchor-aligned animation groups + a Phaser-compatible texture atlas.

## Pipeline

```
character sheet PNG
    │
    ▼
crop cells (manual grid in JSON config)
    │
    ▼
background removal (BiRefNet via @imgly/background-removal-node)
    │
    ▼
alpha bbox trim per frame
    │
    ▼
anchor alignment (every frame in a group composited onto a uniform canvas
                  with the chosen anchor — foot/center/top — at a fixed
                  position, so animations don't jitter)
    │
    ▼
shelf-pack into atlas.png + atlas.json + manifest.json + preview.html
```

## Run

```bash
cd tools/sprite-extract
npm install                                   # first time only
npm run extract -- --config configs/lionn-character-sheet.json
```

Flags:

- `--noBgRemove` — skip background removal. Use this on the first pass
  to verify cell coordinates are correct (cropped cells will still show
  the dark sheet background, which is what you want for visual checks).
- `--individualPngs` — also write per-frame PNGs to `<output>/frames/`
  in addition to the packed atlas.

## Config format

```jsonc
{
  "input": "samples/lionn-character-sheet.png",   // relative to config file
  "outputDir": "../../game/public/assets/sprites/lionn",
  "defaultAnchor": "foot",                         // foot | center | top
  "defaultFrameRate": 12,
  "alphaThreshold": 24,                            // pixel alpha required to count as "subject"
  "padding": 6,                                    // px around each frame after anchor align
  "bgRemoval": { "enabled": true, "model": "medium" },  // 'small' is faster; 'medium' is BiRefNet
  "groups": [
    {
      "name": "run",
      "cells": [
        { "x": 30, "y": 470, "w": 340, "h": 260 }
      ],
      "anchor": "foot",                            // optional override
      "frameRate": 12                              // optional override
    }
  ]
}
```

Each `group` is one animation. Each `cell` within a group is one frame.
A single-frame "animation" (idle, jump apex, wall cling) is a group with
one cell.

## Output

```
game/public/assets/sprites/lionn/
  atlas.png        # packed sprite atlas
  atlas.json       # Phaser texture atlas JSON (load with this.load.atlas)
  manifest.json    # per-group metadata: frame count, size, anchor, fps
  preview.html     # opens in browser; loops each animation at adjustable fps
  frames/          # only if --individualPngs was passed
    run_000.png
    run_001.png
    ...
```

## Loading in Phaser

```ts
this.load.atlas('lionn', 'assets/sprites/lionn/atlas.png', 'assets/sprites/lionn/atlas.json');

this.anims.create({
  key: 'lionn-run',
  frames: this.anims.generateFrameNames('lionn', {
    prefix: 'run_',
    start: 0,
    end: <runFrameCount - 1>,
    zeroPad: 3,
  }),
  frameRate: 12,
  repeat: -1,
});
```

## Tuning the config for a new sheet

1. First run with `--noBgRemove`. Inspect the cropped cells in the
   atlas — every cell should contain the intended pose with reasonable
   margin around the silhouette, no neighboring poses bleeding in.
2. Adjust `cells[].x/y/w/h` until cells are tight but complete.
3. Re-run without `--noBgRemove`. Inspect `preview.html` — does each
   animation loop without the character snapping or sliding?
4. If a frame has missing pixels (e.g. claw tip eaten), bg removal
   needs a touch-up — open the affected frame in Photopea/Aseprite
   and paint back the missing alpha, then re-run with that frame's
   cell pointing at the touched-up image.

## Where models cache

`@imgly/background-removal-node` downloads ONNX models on first run.
They cache under `~/.cache/@imgly/` (macOS). Subsequent runs are fast.

# Lionn: Night Prowler

Dark fantasy 2D side-scroller prototype. Two parallel tracks:

- **`game/`** — Phaser 3 + TypeScript + Vite. The playable prototype.
- **`tools/sprite-extract/`** — Node CLI that turns a generated character
  sheet into per-frame transparent sprites with anchor-aligned animation
  groups + a Phaser atlas JSON.

## Why two folders

The highest-risk unknown for this project is whether AI-generated art can
actually feed the game with a clean enough silhouette to animate without
jitter. Before sinking weeks into Phaser content, the sprite tool gets
built and tested first. If the run-cycle test passes, the game scaffold
is ready to consume real sprites the same day.

## 4-week prototype plan

```
Week 1 — Movement only
  Vite + Phaser + TS scaffold (this commit)
  Player capsule: run, jump, coyote, buffer, dash
  One ugly test room: 3 platforms, 1 wall, 1 gap, 1 ledge
  Debug overlay, tuning constants in one file
  GATE: does Lionn feel fast and crisp on keyboard + gamepad?

Week 2 — Combat only
  3-hit combo, data-driven hitboxes
  Stationary dummy enemy
  Hit pause + screen shake + 1 SFX per attack
  GATE: does hitting things feel satisfying?

Week 3 — Enemy + integration
  Night Cutter FSM: Patrol, WindupDash, ComboAttack
  One greybox encounter
  GATE: is the fight readable, fair, and re-playable?

Week 4 — Perception layer
  Lionn animations (8 states, rough)
  Night Cutter animations (5 states)
  Ruined Courtyard parallax (3 layers)
  Ambient track + 5 SFX
  Ship to 5 testers
  GATE: do testers say "I want to play more" without prompting?
```

## Play the game

**Public URL** — works on any device, no install required:

> **https://alex-enliven.github.io/lionn-night-prowler/**

GitHub Pages serves the production build directly. Open it on a phone,
tablet, laptop — anywhere. Bookmark it.

### Updating the public URL after code changes

```bash
cd /Users/alextavassoli/2026_Claude_Code_Enliven/lionn-night-prowler
./deploy-gh-pages.sh
```

This rebuilds `dist/`, force-pushes it to the `gh-pages` branch, and
GitHub Pages re-publishes within ~30 s.

### Local play (alternative — needs python3 on macOS)

```bash
./play-lionn.sh
```

Rebuilds dist if stale, serves it from a local Python http.server on
`http://localhost:5180/`. Stop with `Ctrl+C`.

## Run the dev server (for source iteration)

```bash
cd game
npm install
npm run dev
```

Vite hot-reloads from source. This is what Claude uses while working
on the game — not what the kid plays.

Controls (both keyboard + PS5 / Xbox standard gamepad):

| Action | Keyboard | Gamepad |
|--------|----------|---------|
| Move | ← → / A,D | Left stick / D-pad |
| Jump | Space / W | ✕ Cross |
| Double jump | (press jump again mid-air) | (same) |
| Dash | Shift | L1 / R1 / L2 / R2 |
| Attack | J | □ Square / △ Triangle |
| Crouch | ↓ / S | Down stick / D-pad |
| Wall cling | hold direction into wall in air | (same) |
| Wall jump | jump while clinging | (same) |
| Restart on game-over | R / Space | Start / Share / Touchpad / ✕ Cross |
| Toggle debug overlay | F3 | — |
| Toggle hitbox debug | H | — |
| Toggle gamepad debug panel | G | — |

The game also auto-restarts ~3.5 s after death, so you never get stuck
on a game-over screen.

## Run the sprite extractor

```bash
cd tools/sprite-extract
npm install
npm run extract -- --config configs/lionn-character-sheet.json
```

See `tools/sprite-extract/README.md` for config format and pipeline
details.

## Folder shape

```
lionn-night-prowler/
  game/
    src/
      core/         constants, input
      scenes/       Boot, Preload, Game
      entities/     Player
      movement/     PlayerMovement (run, jump, dash)
      levels/       TestRoom
      ui/           DebugOverlay
    public/assets/  sprites, backgrounds, audio (populated by tool)
  tools/
    sprite-extract/
      src/          crop, bgRemove, anchor, atlas, preview
      configs/      per-character sheet configs
      samples/      input sheets (gitignored)
```

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

## Run the game

```bash
cd game
npm install
npm run dev
```

Opens on http://localhost:5173. Controls:

| Action | Keyboard | Gamepad |
|--------|----------|---------|
| Move | Arrow / A,D | Left stick / D-pad |
| Jump | Space / W | A (Xbox) / X (PS) |
| Dash | Shift | RT / R2 |
| Toggle debug | F3 | — |

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

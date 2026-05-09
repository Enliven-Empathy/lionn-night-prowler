/**
 * The full SFX + music manifest for Lionn: Night Prowler.
 * Each entry maps a gameplay event we've already wired up to a generated
 * sound file. Edit the prompts here, re-run `npm run generate`, and the
 * mp3s in game/public/assets/audio/ are replaced.
 *
 * The `key` field is what the game uses with `this.sound.play(key)`.
 * The `filename` is what gets written to disk and what Phaser preloads.
 *
 * Scopes:
 *   PLAYER       — Lionn moves, attacks, gets hit
 *   ENEMY        — Patrol enemy alerts, attacks, dies
 *   COMBAT       — generic impact sounds (hit landed / heavy finisher)
 *   COLLECTIBLE  — gold coin / violet gem / cyan crystal pickup chimes
 *   UI           — game over, restart, best-score-beaten cue
 *   MUSIC        — ambient courtyard loop (longer, looped in Phaser)
 */

export interface SfxEntry {
  /** Game-side key — used with `this.sound.play(key)`. */
  key: string;
  /** Output filename inside game/public/assets/audio/. */
  filename: string;
  /** Prompt sent to ElevenLabs sound-generation. */
  prompt: string;
  /** Duration in seconds. ElevenLabs caps sound-generation at 22s. */
  durationSec: number;
  /** 0..1. Higher = literal to prompt, lower = more creative variance. Default 0.4. */
  promptInfluence?: number;
  /** True for tracks that loop in-engine (currently just music). */
  loop?: boolean;
  /** Group label for the manifest output / progress logs. */
  scope: 'player' | 'enemy' | 'combat' | 'collectible' | 'ui' | 'music';
  /** Where in the game this sound fires — for documentation. */
  triggeredBy: string;
}

export const SFX_MANIFEST: SfxEntry[] = [
  // ─── Player (Lionn) ────────────────────────────────────────────
  {
    key: 'player_jump',
    filename: 'player_jump.mp3',
    scope: 'player',
    triggeredBy: 'PlayerMovement.applyJump (regular ground jump)',
    prompt: 'Quick light leap whoosh, soft cloth swish, brief springy upward energy, no music, no voice',
    durationSec: 0.7,
    promptInfluence: 0.4,
  },
  {
    key: 'player_double_jump',
    filename: 'player_double_jump.mp3',
    scope: 'player',
    triggeredBy: 'PlayerMovement.applyJump (mid-air, airJumpsRemaining > 0)',
    prompt: 'Magical mid-air double jump burst, soft violet shadow energy poof, brief whoosh with subtle chime, dark fantasy, no music, no voice',
    durationSec: 0.9,
    promptInfluence: 0.45,
  },
  {
    key: 'player_land',
    filename: 'player_land.mp3',
    scope: 'player',
    triggeredBy: 'PlayerMovement (transition from airborne to grounded)',
    prompt: 'Soft thud of light boots landing on stone, small dust puff, brief and dry, no music, no voice',
    durationSec: 0.5,
    promptInfluence: 0.5,
  },
  {
    key: 'player_dash',
    filename: 'player_dash.mp3',
    scope: 'player',
    triggeredBy: 'PlayerMovement.startDash',
    prompt: 'Sharp magical shadow dash whoosh, quick violet energy burst, fast forward burst, brief, dark fantasy, no music, no voice',
    durationSec: 0.6,
    promptInfluence: 0.45,
  },
  {
    key: 'player_wall_cling',
    filename: 'player_wall_cling.mp3',
    scope: 'player',
    triggeredBy: 'PlayerMovement.applyWallCling (first frame of cling)',
    prompt: 'Brief light scrape of cloth and small claws on rough stone, very short, dry, no music, no voice',
    durationSec: 0.5,
    promptInfluence: 0.45,
  },
  {
    key: 'player_wall_jump',
    filename: 'player_wall_jump.mp3',
    scope: 'player',
    triggeredBy: 'PlayerMovement.applyWallCling (jump press while clinging)',
    prompt: 'Quick stone scrape into a propulsive whoosh, springy magical edge, brief, dark fantasy, no music, no voice',
    durationSec: 0.7,
    promptInfluence: 0.45,
  },
  {
    key: 'player_claw_1',
    filename: 'player_claw_1.mp3',
    scope: 'player',
    triggeredBy: 'AttackState start (claw_1)',
    prompt: 'Light fast claw slash through air, single quick whoosh, sharp, no music, no voice',
    durationSec: 0.4,
    promptInfluence: 0.5,
  },
  {
    key: 'player_claw_2',
    filename: 'player_claw_2.mp3',
    scope: 'player',
    triggeredBy: 'AttackState start (claw_2)',
    prompt: 'Slightly heavier claw slash through air, quick whoosh with body behind it, sharp, no music, no voice',
    durationSec: 0.5,
    promptInfluence: 0.5,
  },
  {
    key: 'player_claw_3',
    filename: 'player_claw_3.mp3',
    scope: 'player',
    triggeredBy: 'AttackState start (claw_3 — combo finisher)',
    prompt: 'Heavy magical finisher claw slash, deep whoosh with violet shadow resonance, powerful and weighty, brief, dark fantasy, no music, no voice',
    durationSec: 0.8,
    promptInfluence: 0.5,
  },
  {
    key: 'player_air_claw',
    filename: 'player_air_claw.mp3',
    scope: 'player',
    triggeredBy: 'AttackState start (air_claw — airborne attack)',
    prompt: 'Aerial mid-air claw slash, sharp high whoosh, brief, no music, no voice',
    durationSec: 0.5,
    promptInfluence: 0.5,
  },
  {
    key: 'player_shadow_pounce',
    filename: 'player_shadow_pounce.mp3',
    scope: 'player',
    triggeredBy: 'AttackState start (shadow_pounce — heavy ground impact)',
    prompt: 'Heavy magical shadow pounce slam onto ground, deep impact with violet energy burst, powerful, brief, dark fantasy, no music, no voice',
    durationSec: 0.9,
    promptInfluence: 0.5,
  },
  {
    key: 'player_hurt',
    filename: 'player_hurt.mp3',
    scope: 'player',
    triggeredBy: 'Player.takeDamage',
    prompt: 'Soft brief gasp impact, light young voice taking a small hit, very short, no music',
    durationSec: 0.5,
    promptInfluence: 0.45,
  },
  {
    key: 'player_death',
    filename: 'player_death.mp3',
    scope: 'player',
    triggeredBy: 'Player.kill (pit death or HP zero)',
    prompt: 'Soft fading sigh of a young hero falling, gentle descent, dark fantasy melancholy, brief, no music',
    durationSec: 1.4,
    promptInfluence: 0.45,
  },

  // ─── Enemy (Patrol) ─────────────────────────────────────────────
  {
    key: 'enemy_alert',
    filename: 'enemy_alert.mp3',
    scope: 'enemy',
    triggeredBy: 'Patrol AI transition: patrol → chase (player detected)',
    prompt: 'Short hollow guard alert grunt, dark muffled voice through helmet, brief startled noise, dark fantasy, no music',
    durationSec: 0.5,
    promptInfluence: 0.5,
  },
  {
    key: 'enemy_attack_swing',
    filename: 'enemy_attack_swing.mp3',
    scope: 'enemy',
    triggeredBy: 'Patrol attack startup → active phase',
    prompt: 'Heavy crescent blade swung through air, metallic whoosh with weight behind it, dark fantasy, brief, no music',
    durationSec: 0.6,
    promptInfluence: 0.5,
  },
  {
    key: 'enemy_hurt',
    filename: 'enemy_hurt.mp3',
    scope: 'enemy',
    triggeredBy: 'Patrol.takeDamage (still alive)',
    prompt: 'Hollow shadow construct grunt of pain, low and muffled, brief, dark fantasy, no music',
    durationSec: 0.5,
    promptInfluence: 0.5,
  },
  {
    key: 'enemy_death',
    filename: 'enemy_death.mp3',
    scope: 'enemy',
    triggeredBy: 'Patrol.takeDamage (HP to zero)',
    prompt: 'Hollow shadow construct dissolving into nothing, deep groan fading into wispy violet whisper, dark fantasy, brief, no music',
    durationSec: 1.2,
    promptInfluence: 0.5,
  },

  // ─── Combat (impact, not attacker-side) ─────────────────────────
  {
    key: 'combat_hit_light',
    filename: 'combat_hit_light.mp3',
    scope: 'combat',
    triggeredBy: 'DamageSystem.testHitbox connects (claw_1 / claw_2 / air_claw)',
    prompt: 'Solid light claw hit on shadow armor, sharp metallic clang with magical violet resonance, brief, dark fantasy, no music',
    durationSec: 0.4,
    promptInfluence: 0.55,
  },
  {
    key: 'combat_hit_heavy',
    filename: 'combat_hit_heavy.mp3',
    scope: 'combat',
    triggeredBy: 'DamageSystem.testHitbox connects (claw_3 / shadow_pounce — heavy finishers)',
    prompt: 'Deep heavy claw strike on shadow armor, satisfying thud with violet shadow burst, powerful, brief, dark fantasy, no music',
    durationSec: 0.6,
    promptInfluence: 0.55,
  },

  // ─── Collectibles (3 tiers) ─────────────────────────────────────
  {
    key: 'pickup_coin',
    filename: 'pickup_coin.mp3',
    scope: 'collectible',
    triggeredBy: 'GameScene.collectPickup (tier 1 — gold coin, +1)',
    prompt: 'Bright clear gold coin chime, single quick ding, sparkly, very brief, no music',
    durationSec: 0.4,
    promptInfluence: 0.55,
  },
  {
    key: 'pickup_gem',
    filename: 'pickup_gem.mp3',
    scope: 'collectible',
    triggeredBy: 'GameScene.collectPickup (tier 2 — violet gem, +3)',
    prompt: 'Resonant violet jewel ring, magical shimmer with a soft chord, brief, dark fantasy, no music',
    durationSec: 0.7,
    promptInfluence: 0.5,
  },
  {
    key: 'pickup_crystal',
    filename: 'pickup_crystal.mp3',
    scope: 'collectible',
    triggeredBy: 'GameScene.collectPickup (tier 3 — cyan crystal, +8)',
    prompt: 'Powerful magical crystal chord with rising shimmering arpeggio, triumphant brief reward sound, dark fantasy with cyan and violet sparkle, no music',
    durationSec: 1.1,
    promptInfluence: 0.5,
  },

  // ─── UI / state transitions ─────────────────────────────────────
  {
    key: 'ui_game_over',
    filename: 'ui_game_over.mp3',
    scope: 'ui',
    triggeredBy: 'GameScene.endRun (kind=gameOver)',
    prompt: 'Sad descending tone, low resonant fall, dark fantasy melancholy, brief failure cue, no music',
    durationSec: 1.6,
    promptInfluence: 0.5,
  },
  {
    key: 'ui_restart',
    filename: 'ui_restart.mp3',
    scope: 'ui',
    triggeredBy: 'GameScene.scene.restart (R / Space / Start)',
    prompt: 'Quick magical reset whoosh with hopeful upward shimmer, brief, dark fantasy, no music',
    durationSec: 0.7,
    promptInfluence: 0.5,
  },
  {
    key: 'ui_best_score',
    filename: 'ui_best_score.mp3',
    scope: 'ui',
    triggeredBy: 'GameScene.endRun (when score > previous bestScore)',
    prompt: 'Triumphant short fanfare, gold resonance with magical sparkle, brief celebratory cue, dark fantasy, no music',
    durationSec: 1.4,
    promptInfluence: 0.5,
  },

  // ─── Music ──────────────────────────────────────────────────────
  {
    key: 'music_courtyard',
    filename: 'music_courtyard.mp3',
    scope: 'music',
    triggeredBy: 'GameScene.create (looped throughout the run)',
    loop: true,
    prompt: 'Dark fantasy moonlit ruined palace ambient music loop, slow haunting strings, distant violet shadow magic shimmer, royal lion crest melancholy, low brooding undertone, no vocals',
    durationSec: 22,
    promptInfluence: 0.4,
  },
];

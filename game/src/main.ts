import Phaser from 'phaser';
import { VIEW } from './core/constants';
import { BootScene } from './scenes/BootScene';
import { PreloadScene } from './scenes/PreloadScene';
import { ModeSelectScene } from './scenes/ModeSelectScene';
import { NameEntryScene } from './scenes/NameEntryScene';
import { StartScene } from './scenes/StartScene';
import { UserSelectScene } from './scenes/UserSelectScene';
import { ResultsScene } from './scenes/ResultsScene';
import { BadgesScene } from './scenes/BadgesScene';
import { LeaderboardScene } from './scenes/LeaderboardScene';
import { GameScene } from './scenes/GameScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  width: VIEW.width,
  height: VIEW.height,
  backgroundColor: '#0e0a18',
  pixelArt: false,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  input: {
    gamepad: true,
    keyboard: {
      // Default keyboard target is `window`, which is correct — keys
      // delivered via window listeners survive even if the canvas
      // isn't focused. The reason arrow keys looked "dead" in the
      // menus and the game was that we never told Phaser to capture
      // them: the browser was eating UP/DOWN/SPACE for page-scrolling
      // before our handlers ran. Listing the keys here calls
      // preventDefault on each, which routes them to Phaser cleanly.
      capture: [
        Phaser.Input.Keyboard.KeyCodes.SPACE,
        Phaser.Input.Keyboard.KeyCodes.UP,
        Phaser.Input.Keyboard.KeyCodes.DOWN,
        Phaser.Input.Keyboard.KeyCodes.LEFT,
        Phaser.Input.Keyboard.KeyCodes.RIGHT,
        Phaser.Input.Keyboard.KeyCodes.W,
        Phaser.Input.Keyboard.KeyCodes.A,
        Phaser.Input.Keyboard.KeyCodes.S,
        Phaser.Input.Keyboard.KeyCodes.D,
        Phaser.Input.Keyboard.KeyCodes.M,
        Phaser.Input.Keyboard.KeyCodes.R,
        Phaser.Input.Keyboard.KeyCodes.J,
        Phaser.Input.Keyboard.KeyCodes.K,
        Phaser.Input.Keyboard.KeyCodes.SHIFT,
        Phaser.Input.Keyboard.KeyCodes.ENTER,
        Phaser.Input.Keyboard.KeyCodes.ESC,
        Phaser.Input.Keyboard.KeyCodes.ONE,
        Phaser.Input.Keyboard.KeyCodes.TWO,
        Phaser.Input.Keyboard.KeyCodes.THREE,
        Phaser.Input.Keyboard.KeyCodes.FOUR,
        Phaser.Input.Keyboard.KeyCodes.FIVE,
      ],
    },
  },
  // preserveDrawingBuffer lets external tooling read canvas pixels via
  // drawImage / toDataURL. Tiny perf cost; only enabled in dev.
  render: import.meta.env.DEV ? { preserveDrawingBuffer: true } : undefined,
  scene: [
    BootScene,
    PreloadScene,
    NameEntryScene,
    StartScene,
    UserSelectScene,
    ModeSelectScene,
    BadgesScene,
    LeaderboardScene,
    GameScene,
    ResultsScene,
  ],
};

const game = new Phaser.Game(config);

// Make the canvas focusable so click-to-focus works (default tabIndex
// is -1, which means click-on-canvas can't move keyboard focus to it).
// Belt-and-braces alongside the addCapture above — even if the user
// has clicked outside the canvas first, focusing it on click brings
// keys back into the game.
game.events.once('ready', () => {
  const canvas = game.canvas;
  if (!canvas) return;
  canvas.setAttribute('tabindex', '0');
  canvas.style.outline = 'none';
  canvas.addEventListener('pointerdown', () => canvas.focus());
  // Initial focus so the first key works without a click.
  try { canvas.focus(); } catch { /* some browsers throw if window not focused */ }
});

// Dev-only inspection hook. Lets external tooling (preview eval, devtools)
// reach into the running game without requiring a debug build flag.
if (import.meta.env.DEV) {
  (window as unknown as { __game: Phaser.Game }).__game = game;
}

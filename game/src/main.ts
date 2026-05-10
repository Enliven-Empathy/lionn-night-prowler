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

// Dev-only inspection hook. Lets external tooling (preview eval, devtools)
// reach into the running game without requiring a debug build flag.
if (import.meta.env.DEV) {
  (window as unknown as { __game: Phaser.Game }).__game = game;
}

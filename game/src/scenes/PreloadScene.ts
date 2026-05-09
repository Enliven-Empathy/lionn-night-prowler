import Phaser from 'phaser';

export class PreloadScene extends Phaser.Scene {
  constructor() {
    super('PreloadScene');
  }

  preload(): void {
    // Real assets are not loaded yet — week 1 runs on greybox primitives.
    // When the sprite extractor produces public/assets/sprites/lionn/atlas.json,
    // load it here:
    //   this.load.atlas('lionn', 'assets/sprites/lionn/atlas.png', 'assets/sprites/lionn/atlas.json');
  }

  create(): void {
    this.scene.start('GameScene');
  }
}

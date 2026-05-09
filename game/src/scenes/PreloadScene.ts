import Phaser from 'phaser';

export class PreloadScene extends Phaser.Scene {
  constructor() {
    super('PreloadScene');
  }

  preload(): void {
    this.load.atlas(
      'lionn',
      'assets/sprites/lionn/atlas.png',
      'assets/sprites/lionn/atlas.json',
    );
    this.load.json('lionn-manifest', 'assets/sprites/lionn/manifest.json');

    this.load.image('courtyard-backdrop', 'assets/backgrounds/courtyard/frames/backdrop_silhouettes_000.png');
    this.load.image('courtyard-fog', 'assets/backgrounds/courtyard/frames/fog_mist_strip_000.png');
    this.load.image('courtyard-wall', 'assets/backgrounds/courtyard/frames/wall_block_000.png');
    this.load.image('courtyard-platform', 'assets/backgrounds/courtyard/frames/platform_top_000.png');

    this.load.on('loaderror', (file: Phaser.Loader.File) => {
      console.warn(`[preload] missing asset: ${file.key} (${file.url})`);
    });
  }

  create(): void {
    this.registerLionnAnims();
    this.scene.start('GameScene');
  }

  private registerLionnAnims(): void {
    const manifest = this.cache.json.get('lionn-manifest') as ManifestGroup[] | undefined;
    if (!manifest) return;

    for (const group of manifest) {
      const frames = group.frames.map((f) => ({ key: 'lionn', frame: f.fileName }));
      this.anims.create({
        key: `lionn-${group.name}`,
        frames,
        frameRate: group.frameRate,
        repeat: shouldLoop(group.name) ? -1 : 0,
      });
    }
  }
}

interface ManifestFrame {
  groupName: string;
  index: number;
  fileName: string;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
}

interface ManifestGroup {
  name: string;
  frameWidth: number;
  frameHeight: number;
  frameRate: number;
  anchor: 'foot' | 'center' | 'top';
  frames: ManifestFrame[];
}

function shouldLoop(name: string): boolean {
  return name === 'idle' || name === 'run' || name === 'crouch' || name === 'wall_cling';
}

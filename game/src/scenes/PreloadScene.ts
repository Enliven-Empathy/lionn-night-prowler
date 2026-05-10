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

    // Audio manifest — drives the SFX preload below.
    this.load.json('audio-manifest', 'assets/audio/audio-manifest.json');

    this.load.on('loaderror', (file: Phaser.Loader.File) => {
      console.warn(`[preload] missing asset: ${file.key} (${file.url})`);
    });

    // Stage two: once the JSON manifest is in cache, queue every audio file.
    this.load.on('filecomplete-json-audio-manifest', () => {
      const audioManifest = this.cache.json.get('audio-manifest') as AudioManifestEntry[] | undefined;
      if (!audioManifest) return;
      for (const entry of audioManifest) {
        this.load.audio(entry.key, `assets/audio/${entry.filename}`);
      }
      this.load.start();
    });
  }

  create(): void {
    this.registerLionnAnims();

    // Routing ladder (most specific first):
    //   - No saved user           → NameEntryScene  (kid creates a tag)
    //   - Saved user, mode known  → StartScene      (main menu)
    //
    // StartScene reads/writes the mode from localStorage; the picker
    // (ModeSelectScene) is no longer in the boot path — it's reachable
    // by hand if needed but the main mode toggle now lives inside
    // StartScene and ResultsScene.
    //
    // Imports are lazy to keep PreloadScene's bundle-load order clean.
    let hasUser = false;
    try {
      // Inline localStorage check so we don't pull UserStore into the
      // preload-time critical path. The full UserStore loads on first
      // call from any scene that uses it.
      const raw = window.localStorage.getItem('lionn:userstore:v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.currentUserId && parsed.users && parsed.users[parsed.currentUserId]) {
          hasUser = true;
        }
      }
    } catch {
      // privacy mode etc — treat as no user
    }

    if (hasUser) {
      this.scene.start('StartScene');
    } else {
      this.scene.start('NameEntryScene');
    }
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

interface AudioManifestEntry {
  key: string;
  filename: string;
  scope: string;
  loop: boolean;
}

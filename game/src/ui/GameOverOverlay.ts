import Phaser from 'phaser';
import { VIEW } from '../core/constants';

export type EndKind = 'gameOver' | 'win';

export class GameOverOverlay {
  private scene: Phaser.Scene;
  private container?: Phaser.GameObjects.Container;
  visible = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  show(kind: EndKind, onRetry: () => void): void {
    if (this.visible) return;
    this.visible = true;

    const dim = this.scene.add.rectangle(VIEW.width / 2, VIEW.height / 2, VIEW.width, VIEW.height, 0x07060f, 0.78);
    dim.setScrollFactor(0).setDepth(2000);

    const titleText = kind === 'gameOver' ? 'GAME OVER' : 'NIGHT CUTTER FELLED';
    const titleColor = kind === 'gameOver' ? '#ff5b8a' : '#d4af37';

    const title = this.scene.add.text(VIEW.width / 2, VIEW.height / 2 - 40, titleText, {
      fontFamily: 'Cinzel, serif',
      fontSize: '64px',
      color: titleColor,
      stroke: '#0b0816',
      strokeThickness: 6,
    });
    title.setOrigin(0.5).setScrollFactor(0).setDepth(2001);

    const sub = this.scene.add.text(VIEW.width / 2, VIEW.height / 2 + 30, 'press R or SPACE to retry', {
      fontFamily: 'Cinzel, serif',
      fontSize: '20px',
      color: '#c4b8e8',
    });
    sub.setOrigin(0.5).setScrollFactor(0).setDepth(2001);

    this.container = this.scene.add.container(0, 0, [dim, title, sub]);

    // Tween in.
    title.setScale(0.7).setAlpha(0);
    sub.setAlpha(0);
    this.scene.tweens.add({ targets: title, scale: 1, alpha: 1, duration: 360, ease: 'Quad.easeOut' });
    this.scene.tweens.add({ targets: sub, alpha: 1, duration: 600, delay: 250 });

    const handler = (event: KeyboardEvent) => {
      if (event.key === 'r' || event.key === 'R' || event.key === ' ' || event.code === 'Space') {
        window.removeEventListener('keydown', handler);
        onRetry();
      }
    };
    window.addEventListener('keydown', handler);
    // Also retry on click.
    dim.setInteractive();
    dim.once('pointerdown', () => {
      window.removeEventListener('keydown', handler);
      onRetry();
    });
  }

  hide(): void {
    this.container?.destroy(true);
    this.container = undefined;
    this.visible = false;
  }
}

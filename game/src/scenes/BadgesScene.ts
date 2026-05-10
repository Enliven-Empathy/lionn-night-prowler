import Phaser from 'phaser';
import { VIEW } from '../core/constants';

/**
 * Phase-2 placeholder. The plan: gallery of badge tiles (locked /
 * unlocked) with tooltips for what each one rewards. For phase 1 it's
 * just a "coming soon" panel that returns to StartScene.
 *
 * Reachable today only by hand (scene.start('BadgesScene') from devtools)
 * — StartScene's BADGES tile is rendered disabled. Wiring is here so
 * phase 2 only has to populate the gallery, not invent navigation.
 */

const COL_BG = 0x14091f;

interface Keys {
  esc: Phaser.Input.Keyboard.Key;
  space: Phaser.Input.Keyboard.Key;
  enter: Phaser.Input.Keyboard.Key;
}

export class BadgesScene extends Phaser.Scene {
  private keys: Keys | null = null;
  private prev = { back: false };
  private confirming = false;

  constructor() {
    super('BadgesScene');
  }

  create(): void {
    this.add.rectangle(VIEW.width / 2, VIEW.height / 2, VIEW.width, VIEW.height, COL_BG)
      .setDepth(-100);

    this.add.text(VIEW.width / 2, 120, 'BADGES', {
      fontFamily: 'Cinzel, Georgia, serif',
      fontSize: '46px',
      color: '#e6deff',
    }).setOrigin(0.5).setDepth(10);

    this.add.text(VIEW.width / 2, VIEW.height / 2, 'coming soon', {
      fontFamily: 'Cinzel, Georgia, serif',
      fontSize: '28px',
      color: '#9b8fb8',
    }).setOrigin(0.5).setDepth(10);

    this.add.text(VIEW.width / 2, VIEW.height - 60, 'press SPACE / ENTER / X / ESC to go back', {
      fontFamily: 'Cinzel, Georgia, serif',
      fontSize: '14px',
      color: '#9b8fb8',
    }).setOrigin(0.5).setDepth(10);

    const kb = this.input.keyboard;
    if (kb) {
      const KC = Phaser.Input.Keyboard.KeyCodes;
      this.keys = {
        esc: kb.addKey(KC.ESC),
        space: kb.addKey(KC.SPACE),
        enter: kb.addKey(KC.ENTER),
      };
    }

    const gp = this.input.gamepad;
    if (gp) gp.on('down', this.onGamepadDown, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (gp) gp.off('down', this.onGamepadDown, this);
    });
  }

  override update(): void {
    if (!this.keys) return;
    const back = this.keys.esc.isDown || this.keys.space.isDown || this.keys.enter.isDown;
    if (back && !this.prev.back) this.goBack();
    this.prev = { back };
  }

  private onGamepadDown = (
    _pad: Phaser.Input.Gamepad.Gamepad,
    button: Phaser.Input.Gamepad.Button | undefined,
  ): void => {
    if (!button) return;
    if (button.index === 0 || button.index === 1 || button.index === 9) this.goBack();
  };

  private goBack(): void {
    if (this.confirming) return;
    this.confirming = true;
    try {
      this.scene.start('StartScene');
    } catch {
      this.confirming = false;
    }
  }
}

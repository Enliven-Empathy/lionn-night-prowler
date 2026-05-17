import Phaser from 'phaser';
import { PLAYER, VIEW } from '../core/constants';
import { SKINS, SkinDef, getSkin } from '../state/Skins';
import { UserStore } from '../state/UserStore';

/**
 * Skin picker. Tile grid of available skins; the kid picks one and
 * UserStore persists it on the current profile. Live preview: each
 * tile draws a small rectangle in the skin's body/stroke colour so
 * the kid can compare before committing.
 *
 * Inputs follow the same convention as the other meta scenes:
 *   - arrow / dpad / stick navigation
 *   - SPACE / ENTER / Cross / Start confirms
 *   - ESC / Circle returns to StartScene
 * Gamepad uses Phaser 'down' events (immune to DualSense BT
 * idle-press), and the activator detaches the gamepad listener
 * immediately so a stray button event during the queued transition
 * can't re-fire confirm.
 */

const COL_BG = 0x14091f;
const COL_TILE = 0x1f1230;
const COL_TILE_FOCUS = 0x402461;
const COL_BORDER = 0x6a4d92;
const COL_BORDER_FOCUS = 0xb47bff;
const COL_TEXT = 0xe6deff;

interface Tile {
  skin: SkinDef;
  rect: Phaser.GameObjects.Rectangle;
  preview: Phaser.GameObjects.Rectangle;
}

interface Keys {
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
  space: Phaser.Input.Keyboard.Key;
  enter: Phaser.Input.Keyboard.Key;
  esc: Phaser.Input.Keyboard.Key;
}

const TILES_PER_ROW = 3;

export class SkinSelectScene extends Phaser.Scene {
  private tiles: Tile[] = [];
  private focused = 0;
  private descName!: Phaser.GameObjects.Text;
  private descBody!: Phaser.GameObjects.Text;
  private keys: Keys | null = null;
  private prev = { up: false, down: false, left: false, right: false, confirm: false, esc: false };
  private prevPadX = 0;
  private prevPadY = 0;
  private confirming = false;

  constructor() {
    super('SkinSelectScene');
  }

  create(): void {
    this.add.rectangle(VIEW.width / 2, VIEW.height / 2, VIEW.width, VIEW.height, COL_BG)
      .setDepth(-100);

    const u = UserStore.getCurrentUser();
    const currentSkinId = u?.selectedSkinId ?? 'lionn';

    this.add.text(VIEW.width / 2, 90, 'PICK A SKIN', {
      fontFamily: 'Cinzel, Georgia, serif',
      fontSize: '40px',
      color: '#e6deff',
    }).setOrigin(0.5).setDepth(10);

    this.add.text(VIEW.width / 2, 135,
      u ? `${u.tag}'s wardrobe` : 'no user',
      {
        fontFamily: 'Cinzel, Georgia, serif',
        fontSize: '15px',
        color: '#9b8fb8',
      }).setOrigin(0.5).setDepth(10);

    // Tile grid.
    const tileW = 220;
    const tileH = 200;
    const gap = 18;
    const rowW = tileW * TILES_PER_ROW + gap * (TILES_PER_ROW - 1);
    const startX = (VIEW.width - rowW) / 2;
    const startY = 200;

    for (let i = 0; i < SKINS.length; i++) {
      const s = SKINS[i];
      const col = i % TILES_PER_ROW;
      const row = Math.floor(i / TILES_PER_ROW);
      const cx = startX + col * (tileW + gap) + tileW / 2;
      const cy = startY + row * (tileH + gap) + tileH / 2;

      const rect = this.add.rectangle(cx, cy, tileW, tileH, COL_TILE);
      rect.setStrokeStyle(3, COL_BORDER);
      rect.setDepth(5);
      rect.setInteractive({ useHandCursor: true });
      rect.on('pointerdown', () => {
        this.focused = i;
        this.refreshFocus();
        this.confirm();
      });
      rect.on('pointerover', () => {
        this.focused = i;
        this.refreshFocus();
      });

      // Preview rectangle — same proportions as the in-game player
      // sprite so the kid sees exactly what they'll be playing.
      const preview = this.add.rectangle(cx, cy - 14, PLAYER.width, PLAYER.height, s.bodyFill);
      preview.setStrokeStyle(2, s.bodyStroke, 0.9);
      preview.setDepth(6);

      this.add.text(cx, cy + 60, s.name.toUpperCase(), {
        fontFamily: 'Cinzel, Georgia, serif',
        fontSize: '18px',
        color: '#e6deff',
      }).setOrigin(0.5).setDepth(7);

      // "EQUIPPED" tag if this is the current selection.
      if (s.id === currentSkinId) {
        this.add.text(cx, cy + 84, '✓ equipped', {
          fontFamily: 'Cinzel, Georgia, serif',
          fontSize: '12px',
          color: '#ffd86a',
        }).setOrigin(0.5).setDepth(7);
      }

      this.tiles.push({ skin: s, rect, preview });
    }

    // Bottom description panel — name + tagline of focused skin.
    const descY = VIEW.height - 110;
    this.descName = this.add.text(VIEW.width / 2, descY, '', {
      fontFamily: 'Cinzel, Georgia, serif',
      fontSize: '22px',
      color: '#e6deff',
    }).setOrigin(0.5).setDepth(10);
    this.descBody = this.add.text(VIEW.width / 2, descY + 30, '', {
      fontFamily: 'Cinzel, Georgia, serif',
      fontSize: '14px',
      color: '#9b8fb8',
      align: 'center',
    }).setOrigin(0.5).setDepth(10);

    // Default focus = currently-equipped skin.
    const equippedIdx = this.tiles.findIndex((t) => t.skin.id === currentSkinId);
    if (equippedIdx >= 0) this.focused = equippedIdx;
    this.refreshFocus();

    this.add.text(VIEW.width / 2, VIEW.height - 36,
      'arrows browse  |  SPACE/X equip  |  ESC/O back',
      {
        fontFamily: 'Cinzel, Georgia, serif',
        fontSize: '13px',
        color: '#9b8fb8',
      }).setOrigin(0.5).setDepth(10);

    // Cache keys.
    const kb = this.input.keyboard;
    if (kb) {
      const KC = Phaser.Input.Keyboard.KeyCodes;
      this.keys = {
        up: kb.addKey(KC.UP),
        down: kb.addKey(KC.DOWN),
        left: kb.addKey(KC.LEFT),
        right: kb.addKey(KC.RIGHT),
        space: kb.addKey(KC.SPACE),
        enter: kb.addKey(KC.ENTER),
        esc: kb.addKey(KC.ESC),
      };
    }

    const gp = this.input.gamepad;
    if (gp) gp.on('down', this.onGamepadDown, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      try { if (gp) gp.off('down', this.onGamepadDown, this); } catch { /* ignore */ }
    });
  }

  override update(): void {
    if (!this.keys) return;
    try {
      const upDown = this.keys.up.isDown;
      const downDown = this.keys.down.isDown;
      const leftDown = this.keys.left.isDown;
      const rightDown = this.keys.right.isDown;
      const confirmDown = this.keys.space.isDown || this.keys.enter.isDown;
      const escDown = this.keys.esc.isDown;

      if (upDown && !this.prev.up) this.moveFocus(0, -1);
      if (downDown && !this.prev.down) this.moveFocus(0, 1);
      if (leftDown && !this.prev.left) this.moveFocus(-1, 0);
      if (rightDown && !this.prev.right) this.moveFocus(1, 0);
      if (confirmDown && !this.prev.confirm) this.confirm();
      if (escDown && !this.prev.esc) this.goBack();
      this.prev = { up: upDown, down: downDown, left: leftDown, right: rightDown, confirm: confirmDown, esc: escDown };

      const pad = this.firstStandardPad();
      if (pad && pad.axes && pad.axes.length >= 2) {
        const ax = pad.axes[0]?.value ?? 0;
        const ay = pad.axes[1]?.value ?? 0;
        const xDir = ax < -0.5 ? -1 : ax > 0.5 ? 1 : 0;
        const yDir = ay < -0.5 ? -1 : ay > 0.5 ? 1 : 0;
        if (xDir === -1 && this.prevPadX !== -1) this.moveFocus(-1, 0);
        if (xDir === 1 && this.prevPadX !== 1) this.moveFocus(1, 0);
        if (yDir === -1 && this.prevPadY !== -1) this.moveFocus(0, -1);
        if (yDir === 1 && this.prevPadY !== 1) this.moveFocus(0, 1);
        this.prevPadX = xDir;
        this.prevPadY = yDir;
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[SkinSelectScene] update threw:', e);
    }
  }

  private onGamepadDown = (
    _pad: Phaser.Input.Gamepad.Gamepad,
    button: Phaser.Input.Gamepad.Button | undefined,
  ): void => {
    if (!button || this.confirming) return;
    try {
      switch (button.index) {
        case 0: case 9: this.confirm(); break;
        case 1: this.goBack(); break;
        case 12: this.moveFocus(0, -1); break;
        case 13: this.moveFocus(0, 1); break;
        case 14: this.moveFocus(-1, 0); break;
        case 15: this.moveFocus(1, 0); break;
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[SkinSelectScene] gamepad-down threw:', e);
    }
  };

  private moveFocus(dx: number, dy: number): void {
    const cur = this.focused;
    const col = cur % TILES_PER_ROW;
    const row = Math.floor(cur / TILES_PER_ROW);
    const totalRows = Math.ceil(this.tiles.length / TILES_PER_ROW);
    let nextCol = Math.max(0, Math.min(TILES_PER_ROW - 1, col + dx));
    let nextRow = Math.max(0, Math.min(totalRows - 1, row + dy));
    let nextIdx = nextRow * TILES_PER_ROW + nextCol;
    if (nextIdx >= this.tiles.length) nextIdx = this.tiles.length - 1;
    this.focused = nextIdx;
    this.refreshFocus();
  }

  private refreshFocus(): void {
    for (let i = 0; i < this.tiles.length; i++) {
      const t = this.tiles[i];
      const focused = i === this.focused;
      t.rect.setFillStyle(focused ? COL_TILE_FOCUS : COL_TILE);
      t.rect.setStrokeStyle(focused ? 4 : 3, focused ? COL_BORDER_FOCUS : COL_BORDER);
    }
    const f = this.tiles[this.focused];
    if (f) {
      this.descName.setText(f.skin.name);
      this.descBody.setText(f.skin.description);
    }
    void COL_TEXT;
  }

  private confirm(): void {
    if (this.confirming) return;
    const t = this.tiles[this.focused];
    if (!t) return;
    this.confirming = true;
    const gp = this.input.gamepad;
    if (gp) { try { gp.off('down', this.onGamepadDown, this); } catch { /* ignore */ } }
    UserStore.setSelectedSkin(t.skin.id);
    // Quick confirmation: a flash equal to the new skin's body fill so
    // the kid sees what they're equipping before returning to the menu.
    const r = (t.skin.bodyFill >> 16) & 0xff;
    const g = (t.skin.bodyFill >> 8) & 0xff;
    const b = t.skin.bodyFill & 0xff;
    try { this.cameras.main.flash(160, r, g, b); } catch { /* ignore */ }
    try {
      this.scene.start('StartScene');
    } catch {
      this.confirming = false;
    }
    // Reference getSkin so it's clearly imported (resolution happens
    // in Player.constructor when the next run starts).
    void getSkin;
  }

  private goBack(): void {
    if (this.confirming) return;
    this.confirming = true;
    const gp = this.input.gamepad;
    if (gp) { try { gp.off('down', this.onGamepadDown, this); } catch { /* ignore */ } }
    try {
      this.scene.start('StartScene');
    } catch {
      this.confirming = false;
    }
  }

  private firstStandardPad(): Phaser.Input.Gamepad.Gamepad | undefined {
    const gp = this.input.gamepad;
    if (!gp) return undefined;
    for (const p of gp.gamepads) {
      if (p && p.buttons.length >= 12) return p;
    }
    return undefined;
  }
}

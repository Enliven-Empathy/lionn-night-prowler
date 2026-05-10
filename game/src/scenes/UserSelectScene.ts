import Phaser from 'phaser';
import { VIEW } from '../core/constants';
import { UserStore, UserProfile } from '../state/UserStore';

/**
 * User picker. Shows tiles for every saved user plus a "+ NEW" tile
 * at the end. The kid picks who is playing right now; the choice is
 * written through to UserStore (which persists currentUserId in the
 * same localStorage key as the profiles themselves).
 *
 * Inputs:
 *   - LEFT/RIGHT/UP/DOWN move the focus through the tile grid.
 *   - SPACE/ENTER/Cross/Start activates: switches user (and routes
 *     back to StartScene), or opens NameEntryScene for "+ NEW".
 *   - Triangle (button 3) on a user tile opens the rename flow
 *     (NameEntryScene with renameUserId set).
 *   - ESC / Circle returns to StartScene without changes.
 */

const COL_BG = 0x14091f;
const COL_TILE = 0x1f1230;
const COL_TILE_FOCUS = 0x402461;
const COL_BORDER = 0x6a4d92;
const COL_BORDER_FOCUS = 0xb47bff;
const COL_NEW = 0x1a3a5a;
const COL_NEW_BORDER = 0x6ad4ff;
const COL_NEW_FOCUS = 0x2a5a8a;
const COL_NEW_BORDER_FOCUS = 0xa0e8ff;

interface Tile {
  kind: 'user' | 'new';
  user?: UserProfile;
  rect: Phaser.GameObjects.Rectangle;
  tagText?: Phaser.GameObjects.Text;
  statsText?: Phaser.GameObjects.Text;
  newLabel?: Phaser.GameObjects.Text;
}

interface Keys {
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
  space: Phaser.Input.Keyboard.Key;
  enter: Phaser.Input.Keyboard.Key;
  esc: Phaser.Input.Keyboard.Key;
  r: Phaser.Input.Keyboard.Key;
}

const TILES_PER_ROW = 3;

export class UserSelectScene extends Phaser.Scene {
  private tiles: Tile[] = [];
  private focused = 0;

  private keys: Keys | null = null;
  private prev = { up: false, down: false, left: false, right: false, confirm: false, esc: false, r: false };
  private prevPadX = 0;
  private prevPadY = 0;
  private confirming = false;

  constructor() {
    super('UserSelectScene');
  }

  create(): void {
    // Reset per-instance state — see StartScene.create comment for why.
    this.confirming = false;
    this.tiles = [];
    this.focused = 0;
    this.prev = { up: false, down: false, left: false, right: false, confirm: false, esc: false, r: false };
    this.prevPadX = 0;
    this.prevPadY = 0;

    this.add.rectangle(VIEW.width / 2, VIEW.height / 2, VIEW.width, VIEW.height, COL_BG)
      .setDepth(-100);

    this.add.text(VIEW.width / 2, 90, 'PICK A USER', {
      fontFamily: 'Cinzel, Georgia, serif',
      fontSize: '40px',
      color: '#e6deff',
    }).setOrigin(0.5).setDepth(10);

    const users = UserStore.listUsers();

    // Layout: rows of TILES_PER_ROW tiles, ending with the "+ NEW" tile.
    const tileW = 240;
    const tileH = 160;
    const gap = 24;
    const rowWidth = tileW * TILES_PER_ROW + gap * (TILES_PER_ROW - 1);
    const startX = (VIEW.width - rowWidth) / 2;
    const startY = 200;

    let i = 0;
    for (const user of users) {
      const col = i % TILES_PER_ROW;
      const row = Math.floor(i / TILES_PER_ROW);
      const cx = startX + col * (tileW + gap) + tileW / 2;
      const cy = startY + row * (tileH + gap) + tileH / 2;
      this.tiles.push(this.makeUserTile(user, cx, cy, tileW, tileH));
      i++;
    }

    // "+ NEW" tile at the end.
    const col = i % TILES_PER_ROW;
    const row = Math.floor(i / TILES_PER_ROW);
    const cx = startX + col * (tileW + gap) + tileW / 2;
    const cy = startY + row * (tileH + gap) + tileH / 2;
    this.tiles.push(this.makeNewTile(cx, cy, tileW, tileH));

    // Default focus: current user, or the first tile.
    const currentId = UserStore.getCurrentUser()?.id;
    if (currentId) {
      const idx = this.tiles.findIndex((t) => t.user?.id === currentId);
      if (idx >= 0) this.focused = idx;
    }
    this.refreshFocus();

    // Hint.
    this.add.text(VIEW.width / 2, VIEW.height - 36,
      'arrows to move  |  SPACE/X confirm  |  ESC/O cancel  |  R rename',
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
        r: kb.addKey(KC.R),
      };
    }

    const gp = this.input.gamepad;
    if (gp) gp.on('down', this.onGamepadDown, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (gp) gp.off('down', this.onGamepadDown, this);
    });
  }

  override update(): void {
    try {
      this.handleInput();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[UserSelectScene] input update threw:', e);
    }
  }

  private handleInput(): void {
    if (!this.keys) return;

    const upDown = this.keys.up.isDown;
    const downDown = this.keys.down.isDown;
    const leftDown = this.keys.left.isDown;
    const rightDown = this.keys.right.isDown;
    const confirmDown = this.keys.space.isDown || this.keys.enter.isDown;
    const escDown = this.keys.esc.isDown;
    const rDown = this.keys.r.isDown;

    if (upDown && !this.prev.up) this.moveFocus(0, -1);
    if (downDown && !this.prev.down) this.moveFocus(0, 1);
    if (leftDown && !this.prev.left) this.moveFocus(-1, 0);
    if (rightDown && !this.prev.right) this.moveFocus(1, 0);
    if (confirmDown && !this.prev.confirm) this.activate();
    if (escDown && !this.prev.esc) this.cancel();
    if (rDown && !this.prev.r) this.renameFocused();
    this.prev = { up: upDown, down: downDown, left: leftDown, right: rightDown, confirm: confirmDown, esc: escDown, r: rDown };

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
  }

  private onGamepadDown = (
    _pad: Phaser.Input.Gamepad.Gamepad,
    button: Phaser.Input.Gamepad.Button | undefined,
  ): void => {
    if (!button || this.confirming) return;
    try {
      switch (button.index) {
        case 0: case 9: this.activate(); break;
        case 1: this.cancel(); break;          // Circle
        case 3: this.renameFocused(); break;   // Triangle
        case 12: this.moveFocus(0, -1); break;
        case 13: this.moveFocus(0, 1); break;
        case 14: this.moveFocus(-1, 0); break;
        case 15: this.moveFocus(1, 0); break;
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[UserSelectScene] gamepad-down threw:', e);
    }
  };

  private makeUserTile(user: UserProfile, cx: number, cy: number, w: number, h: number): Tile {
    const rect = this.add.rectangle(cx, cy, w, h, COL_TILE);
    rect.setStrokeStyle(3, COL_BORDER);
    rect.setDepth(5);
    rect.setInteractive({ useHandCursor: true });
    rect.on('pointerdown', () => {
      this.focused = this.tiles.findIndex((t) => t.user?.id === user.id);
      this.refreshFocus();
      this.activate();
    });
    rect.on('pointerover', () => {
      this.focused = this.tiles.findIndex((t) => t.user?.id === user.id);
      this.refreshFocus();
    });
    const tagText = this.add.text(cx, cy - 28, user.tag, {
      fontFamily: 'Cinzel, Georgia, serif',
      fontSize: '54px',
      color: '#e6deff',
    }).setOrigin(0.5).setDepth(6);
    const statsText = this.add.text(cx, cy + 38,
      `★ ${Math.max(user.bestScore.endless, user.bestScore.parkour)}  ·  ${user.totalRuns} runs`,
      {
        fontFamily: 'Cinzel, Georgia, serif',
        fontSize: '14px',
        color: '#9b8fb8',
      }).setOrigin(0.5).setDepth(6);
    return { kind: 'user', user, rect, tagText, statsText };
  }

  private makeNewTile(cx: number, cy: number, w: number, h: number): Tile {
    const rect = this.add.rectangle(cx, cy, w, h, COL_NEW);
    rect.setStrokeStyle(3, COL_NEW_BORDER);
    rect.setDepth(5);
    rect.setInteractive({ useHandCursor: true });
    rect.on('pointerdown', () => {
      this.focused = this.tiles.length - 1;
      this.refreshFocus();
      this.activate();
    });
    rect.on('pointerover', () => {
      this.focused = this.tiles.length - 1;
      this.refreshFocus();
    });
    const newLabel = this.add.text(cx, cy, '+ NEW', {
      fontFamily: 'Cinzel, Georgia, serif',
      fontSize: '40px',
      color: '#6ad4ff',
    }).setOrigin(0.5).setDepth(6);
    return { kind: 'new', rect, newLabel };
  }

  private moveFocus(dx: number, dy: number): void {
    const cur = this.focused;
    const col = cur % TILES_PER_ROW;
    const row = Math.floor(cur / TILES_PER_ROW);
    let nextCol = col + dx;
    let nextRow = row + dy;
    const totalRows = Math.ceil(this.tiles.length / TILES_PER_ROW);
    nextCol = Math.max(0, Math.min(TILES_PER_ROW - 1, nextCol));
    nextRow = Math.max(0, Math.min(totalRows - 1, nextRow));
    const nextIdx = nextRow * TILES_PER_ROW + nextCol;
    if (nextIdx >= 0 && nextIdx < this.tiles.length) {
      this.focused = nextIdx;
      this.refreshFocus();
    }
  }

  private refreshFocus(): void {
    for (let i = 0; i < this.tiles.length; i++) {
      const t = this.tiles[i];
      const focused = i === this.focused;
      if (t.kind === 'user') {
        t.rect.setFillStyle(focused ? COL_TILE_FOCUS : COL_TILE);
        t.rect.setStrokeStyle(focused ? 4 : 3, focused ? COL_BORDER_FOCUS : COL_BORDER);
      } else {
        t.rect.setFillStyle(focused ? COL_NEW_FOCUS : COL_NEW);
        t.rect.setStrokeStyle(focused ? 4 : 3, focused ? COL_NEW_BORDER_FOCUS : COL_NEW_BORDER);
      }
    }
  }

  private activate(): void {
    if (this.confirming) return;
    const t = this.tiles[this.focused];
    if (!t) return;
    this.confirming = true;
    if (t.kind === 'new') {
      try {
        this.scene.start('NameEntryScene', { returnTo: 'StartScene' });
      } catch {
        this.confirming = false;
      }
    } else if (t.user) {
      UserStore.setCurrentUser(t.user.id);
      this.cameras.main.flash(120, 180, 120, 220);
      try {
        this.scene.start('StartScene');
      } catch {
        this.confirming = false;
      }
    }
  }

  private renameFocused(): void {
    if (this.confirming) return;
    const t = this.tiles[this.focused];
    if (!t || t.kind !== 'user' || !t.user) return;
    this.confirming = true;
    try {
      this.scene.start('NameEntryScene', { renameUserId: t.user.id, returnTo: 'UserSelectScene' });
    } catch {
      this.confirming = false;
    }
  }

  private cancel(): void {
    if (this.confirming) return;
    // Only allow cancel if there's already a current user. Otherwise we'd
    // strand the kid in a dead-end with no playable state.
    if (!UserStore.getCurrentUser()) return;
    this.confirming = true;
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

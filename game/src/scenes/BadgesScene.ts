import Phaser from 'phaser';
import { VIEW } from '../core/constants';
import { BADGES, TIER_COLORS } from '../state/Achievements';
import { UserStore } from '../state/UserStore';

/**
 * Badge gallery for the current user. Renders every defined badge
 * (BADGES) as a tile; unlocked tiles use the tier colour palette,
 * locked tiles are greyed out. Hovering / focusing a tile shows its
 * description.
 *
 * Reachable from StartScene's BADGES action. Inputs: arrows to
 * navigate the grid, ESC / Cross / Circle / Space / Enter to go back
 * (it's a read-only gallery — there's no confirm action).
 */

const COL_BG = 0x14091f;
const COL_LOCKED_FILL = 0x1a1226;
const COL_LOCKED_BORDER = 0x352246;
const COL_FOCUS_RING = 0xb47bff;
const TILES_PER_ROW = 4;

interface Tile {
  badgeId: string;
  rect: Phaser.GameObjects.Rectangle;
  ring: Phaser.GameObjects.Rectangle;
}

interface Keys {
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
  esc: Phaser.Input.Keyboard.Key;
  space: Phaser.Input.Keyboard.Key;
  enter: Phaser.Input.Keyboard.Key;
}

export class BadgesScene extends Phaser.Scene {
  private tiles: Tile[] = [];
  private focused = 0;
  private descText!: Phaser.GameObjects.Text;
  private nameText!: Phaser.GameObjects.Text;

  private keys: Keys | null = null;
  private prev = { up: false, down: false, left: false, right: false, back: false };
  private prevPadX = 0;
  private prevPadY = 0;
  private confirming = false;

  constructor() {
    super('BadgesScene');
  }

  create(): void {
    this.add.rectangle(VIEW.width / 2, VIEW.height / 2, VIEW.width, VIEW.height, COL_BG)
      .setDepth(-100);

    const u = UserStore.getCurrentUser();
    const unlockedCount = u ? BADGES.filter((b) => u.badges[b.id]).length : 0;

    this.add.text(VIEW.width / 2, 80, 'BADGES', {
      fontFamily: 'Cinzel, Georgia, serif',
      fontSize: '40px',
      color: '#e6deff',
    }).setOrigin(0.5).setDepth(10);

    this.add.text(VIEW.width / 2, 125,
      `${u ? u.tag : '—'}   ·   ${unlockedCount} of ${BADGES.length} unlocked`,
      {
        fontFamily: 'Cinzel, Georgia, serif',
        fontSize: '16px',
        color: '#9b8fb8',
      }).setOrigin(0.5).setDepth(10);

    // Tile grid.
    const tileW = 220;
    const tileH = 100;
    const gap = 16;
    const rowW = tileW * TILES_PER_ROW + gap * (TILES_PER_ROW - 1);
    const startX = (VIEW.width - rowW) / 2;
    const startY = 180;

    for (let i = 0; i < BADGES.length; i++) {
      const b = BADGES[i];
      const col = i % TILES_PER_ROW;
      const row = Math.floor(i / TILES_PER_ROW);
      const cx = startX + col * (tileW + gap) + tileW / 2;
      const cy = startY + row * (tileH + gap) + tileH / 2;

      const unlocked = !!u && !!u.badges[b.id];
      const tier = TIER_COLORS[b.tier];
      const fill = unlocked ? tier.fill : COL_LOCKED_FILL;
      const borderCol = unlocked ? tier.border : COL_LOCKED_BORDER;

      const rect = this.add.rectangle(cx, cy, tileW, tileH, fill);
      rect.setStrokeStyle(3, borderCol);
      rect.setDepth(5);
      rect.setInteractive({ useHandCursor: true });
      rect.on('pointerover', () => {
        this.focused = i;
        this.refreshFocus();
      });

      // Focus ring (drawn on top of the tile, scaled down/transparent
      // for non-focused tiles). Updated by refreshFocus.
      const ring = this.add.rectangle(cx, cy, tileW + 8, tileH + 8, 0, 0);
      ring.setStrokeStyle(3, COL_FOCUS_RING, 0);
      ring.setDepth(7);

      // Tier ribbon (top of tile) — tier color even when locked, just
      // dimmer alpha; gives the kid a hint of what's available.
      const ribbon = this.add.rectangle(cx, cy - tileH / 2 + 8, tileW - 24, 6, tier.border, unlocked ? 1 : 0.3);
      ribbon.setDepth(6);

      this.add.text(cx, cy - 8, b.name.toUpperCase(), {
        fontFamily: 'Cinzel, Georgia, serif',
        fontSize: '20px',
        color: unlocked ? tier.text : '#5a4a78',
      }).setOrigin(0.5).setDepth(6);

      this.add.text(cx, cy + 24, unlocked ? 'unlocked' : 'locked', {
        fontFamily: 'Cinzel, Georgia, serif',
        fontSize: '12px',
        color: unlocked ? tier.text : '#5a4a78',
      }).setOrigin(0.5).setDepth(6);

      this.tiles.push({ badgeId: b.id, rect, ring });
    }

    // Description panel — bottom of the screen, updates with the
    // currently-focused tile.
    const descY = VIEW.height - 110;
    this.nameText = this.add.text(VIEW.width / 2, descY, '', {
      fontFamily: 'Cinzel, Georgia, serif',
      fontSize: '20px',
      color: '#e6deff',
    }).setOrigin(0.5).setDepth(10);
    this.descText = this.add.text(VIEW.width / 2, descY + 28, '', {
      fontFamily: 'Cinzel, Georgia, serif',
      fontSize: '14px',
      color: '#9b8fb8',
      align: 'center',
    }).setOrigin(0.5).setDepth(10);

    this.refreshFocus();

    this.add.text(VIEW.width / 2, VIEW.height - 36,
      'arrows to browse  |  ESC / X / O / SPACE / ENTER to go back',
      {
        fontFamily: 'Cinzel, Georgia, serif',
        fontSize: '13px',
        color: '#9b8fb8',
      }).setOrigin(0.5).setDepth(10);

    const kb = this.input.keyboard;
    if (kb) {
      const KC = Phaser.Input.Keyboard.KeyCodes;
      this.keys = {
        up: kb.addKey(KC.UP),
        down: kb.addKey(KC.DOWN),
        left: kb.addKey(KC.LEFT),
        right: kb.addKey(KC.RIGHT),
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
    try {
      const upDown = this.keys.up.isDown;
      const downDown = this.keys.down.isDown;
      const leftDown = this.keys.left.isDown;
      const rightDown = this.keys.right.isDown;
      const back = this.keys.esc.isDown || this.keys.space.isDown || this.keys.enter.isDown;

      if (upDown && !this.prev.up) this.moveFocus(0, -1);
      if (downDown && !this.prev.down) this.moveFocus(0, 1);
      if (leftDown && !this.prev.left) this.moveFocus(-1, 0);
      if (rightDown && !this.prev.right) this.moveFocus(1, 0);
      if (back && !this.prev.back) this.goBack();
      this.prev = { up: upDown, down: downDown, left: leftDown, right: rightDown, back };

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
      console.error('[BadgesScene] update threw:', e);
    }
  }

  private onGamepadDown = (
    _pad: Phaser.Input.Gamepad.Gamepad,
    button: Phaser.Input.Gamepad.Button | undefined,
  ): void => {
    if (!button || this.confirming) return;
    try {
      switch (button.index) {
        case 0: case 1: case 9: this.goBack(); break;
        case 12: this.moveFocus(0, -1); break;
        case 13: this.moveFocus(0, 1); break;
        case 14: this.moveFocus(-1, 0); break;
        case 15: this.moveFocus(1, 0); break;
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[BadgesScene] gamepad-down threw:', e);
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
      t.ring.setStrokeStyle(3, COL_FOCUS_RING, focused ? 1 : 0);
    }
    const focusedDef = BADGES.find((b) => b.id === this.tiles[this.focused]?.badgeId);
    if (focusedDef) {
      const u = UserStore.getCurrentUser();
      const unlocked = !!u && !!u.badges[focusedDef.id];
      this.nameText.setText(focusedDef.name);
      this.descText.setText(unlocked ? focusedDef.description : `🔒  ${focusedDef.description}`);
    }
  }

  private goBack(): void {
    if (this.confirming) return;
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

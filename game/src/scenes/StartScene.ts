import Phaser from 'phaser';
import { VIEW } from '../core/constants';
import { GameMode, UserStore } from '../state/UserStore';

/**
 * Main menu after the kid has picked (or returns to play with) a user.
 *
 * Layout (top → bottom):
 *   - Title.
 *   - "Hi, [TAG]" welcome.
 *   - Stats row: best score / best distance / total runs (per-mode).
 *   - Vertical action list: PLAY [mode], SWITCH MODE, CHANGE USER, BADGES.
 *
 * Inputs follow the same conventions as the other meta scenes:
 *   - UP/DOWN to move focus, LEFT/RIGHT swap mode (alias for SWITCH MODE).
 *   - SPACE/ENTER/Cross/Start activates the focused action.
 *   - Mouse: click any action.
 *   - Gamepad navigation uses 'down' events (resilient to BT idle-press).
 *
 * Mode lives in two places: window.localStorage['lionn:mode'] (survives
 * reloads) and game.registry.mode (used by GameScene). StartScene
 * keeps both in sync when the kid toggles mode via SWITCH MODE.
 */

const COL_BG = 0x14091f;
const COL_PANEL = 0x1f1230;
const COL_BORDER = 0x6a4d92;
const COL_FOCUS_BG = 0x402461;
const COL_FOCUS_BORDER = 0xb47bff;
const COL_TEXT = 0xe6deff;
const COL_TEXT_DIM = 0x9b8fb8;

interface Action {
  id: 'play' | 'switchMode' | 'changeUser' | 'badges';
  rect: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  hint?: Phaser.GameObjects.Text;
}

interface Keys {
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
  w: Phaser.Input.Keyboard.Key;
  s: Phaser.Input.Keyboard.Key;
  a: Phaser.Input.Keyboard.Key;
  d: Phaser.Input.Keyboard.Key;
  space: Phaser.Input.Keyboard.Key;
  enter: Phaser.Input.Keyboard.Key;
  m: Phaser.Input.Keyboard.Key;
}

export class StartScene extends Phaser.Scene {
  private actions: Action[] = [];
  private focused = 0;
  private mode: GameMode = 'endless';

  private modeLabel!: Phaser.GameObjects.Text;
  private statsLine!: Phaser.GameObjects.Text;

  private keys: Keys | null = null;
  private prev = { up: false, down: false, left: false, right: false, confirm: false, m: false };
  private prevPadY = 0;
  private prevPadX = 0;
  private confirming = false;

  constructor() {
    super('StartScene');
  }

  create(): void {
    // Backdrop.
    this.add.rectangle(VIEW.width / 2, VIEW.height / 2, VIEW.width, VIEW.height, COL_BG)
      .setDepth(-100);

    // Title.
    this.add.text(VIEW.width / 2, 90, 'LIONN: NIGHT PROWLER', {
      fontFamily: 'Cinzel, Georgia, serif',
      fontSize: '46px',
      color: '#e6deff',
    }).setOrigin(0.5).setDepth(10);

    // Welcome / current user.
    const user = UserStore.getCurrentUser();
    this.add.text(VIEW.width / 2, 145,
      user ? `Hi, ${user.tag}` : 'no user — pick one',
      {
        fontFamily: 'Cinzel, Georgia, serif',
        fontSize: '24px',
        color: '#b47bff',
      }).setOrigin(0.5).setDepth(10);

    // Mode initialisation: prefer registry, fall back to localStorage.
    const reg = this.game.registry.get('mode');
    if (reg === 'endless' || reg === 'parkour') {
      this.mode = reg;
    } else {
      let stored: string | null = null;
      try { stored = window.localStorage.getItem('lionn:mode'); } catch { /* ignore */ }
      this.mode = stored === 'parkour' ? 'parkour' : 'endless';
    }
    this.game.registry.set('mode', this.mode);

    // Stats line.
    this.statsLine = this.add.text(VIEW.width / 2, 195, this.formatStatsLine(), {
      fontFamily: 'Cinzel, Georgia, serif',
      fontSize: '15px',
      color: '#9b8fb8',
    }).setOrigin(0.5).setDepth(10);

    // Action list — centered column of rectangles.
    const actionW = 360;
    const actionH = 56;
    const gap = 14;
    const startY = 280;
    const cx = VIEW.width / 2;

    this.actions = [
      this.makeAction('play', cx, startY + 0 * (actionH + gap), actionW, actionH, this.playLabel(), 36),
      this.makeAction('switchMode', cx, startY + 1 * (actionH + gap), actionW, actionH, 'SWITCH MODE', 22),
      this.makeAction('changeUser', cx, startY + 2 * (actionH + gap), actionW, actionH, 'CHANGE USER', 22),
      this.makeAction('badges', cx, startY + 3 * (actionH + gap), actionW, actionH, 'BADGES (soon)', 22, true),
    ];
    this.modeLabel = this.actions[0].label; // PLAY's label updates when mode flips

    this.refreshFocus();

    // Hint at bottom.
    this.add.text(VIEW.width / 2, VIEW.height - 36,
      'UP/DOWN move  |  LEFT/RIGHT switch mode  |  SPACE/ENTER/X confirm',
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
        w: kb.addKey(KC.W),
        s: kb.addKey(KC.S),
        a: kb.addKey(KC.A),
        d: kb.addKey(KC.D),
        space: kb.addKey(KC.SPACE),
        enter: kb.addKey(KC.ENTER),
        m: kb.addKey(KC.M),
      };
    }

    // Gamepad: 'down' event for buttons (immune to idle-press).
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
      console.error('[StartScene] input update threw:', e);
    }
  }

  private handleInput(): void {
    if (!this.keys) return;

    const upDown = this.keys.up.isDown || this.keys.w.isDown;
    const downDown = this.keys.down.isDown || this.keys.s.isDown;
    const leftDown = this.keys.left.isDown || this.keys.a.isDown;
    const rightDown = this.keys.right.isDown || this.keys.d.isDown;
    const confirmDown = this.keys.space.isDown || this.keys.enter.isDown;
    const mDown = this.keys.m.isDown;

    if (upDown && !this.prev.up) this.moveFocus(-1);
    if (downDown && !this.prev.down) this.moveFocus(1);
    if (leftDown && !this.prev.left) this.swapMode();
    if (rightDown && !this.prev.right) this.swapMode();
    if (confirmDown && !this.prev.confirm) this.activate();
    if (mDown && !this.prev.m) this.swapMode();
    this.prev = { up: upDown, down: downDown, left: leftDown, right: rightDown, confirm: confirmDown, m: mDown };

    const pad = this.firstStandardPad();
    if (pad && pad.axes && pad.axes.length >= 2) {
      const ax = pad.axes[0]?.value ?? 0;
      const ay = pad.axes[1]?.value ?? 0;
      const xDir = ax < -0.5 ? -1 : ax > 0.5 ? 1 : 0;
      const yDir = ay < -0.5 ? -1 : ay > 0.5 ? 1 : 0;
      if (xDir !== 0 && xDir !== this.prevPadX) this.swapMode();
      if (yDir === -1 && this.prevPadY !== -1) this.moveFocus(-1);
      if (yDir === 1 && this.prevPadY !== 1) this.moveFocus(1);
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
        case 0: // Cross
        case 9: // Start
          this.activate();
          break;
        case 12: this.moveFocus(-1); break;
        case 13: this.moveFocus(1); break;
        case 14: this.swapMode(); break;
        case 15: this.swapMode(); break;
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[StartScene] gamepad-down threw:', e);
    }
  };

  private makeAction(
    id: Action['id'],
    cx: number,
    cy: number,
    w: number,
    h: number,
    label: string,
    fontSize: number,
    disabled = false,
  ): Action {
    const rect = this.add.rectangle(cx, cy, w, h, COL_PANEL);
    rect.setStrokeStyle(3, COL_BORDER);
    rect.setDepth(5);
    if (!disabled) {
      rect.setInteractive({ useHandCursor: true });
      rect.on('pointerdown', () => {
        const idx = this.actions.findIndex((a) => a.id === id);
        if (idx >= 0) this.focused = idx;
        this.refreshFocus();
        this.activate();
      });
      rect.on('pointerover', () => {
        const idx = this.actions.findIndex((a) => a.id === id);
        if (idx >= 0) {
          this.focused = idx;
          this.refreshFocus();
        }
      });
    }
    const labelText = this.add.text(cx, cy, label, {
      fontFamily: 'Cinzel, Georgia, serif',
      fontSize: `${fontSize}px`,
      color: disabled ? '#5a4a78' : '#e6deff',
    }).setOrigin(0.5).setDepth(6);
    return { id, rect, label: labelText };
  }

  private moveFocus(dir: -1 | 1): void {
    let next = this.focused;
    for (let i = 0; i < this.actions.length; i++) {
      next = (next + dir + this.actions.length) % this.actions.length;
      // Skip the disabled BADGES item — phase 2.
      if (this.actions[next].id !== 'badges') break;
    }
    this.focused = next;
    this.refreshFocus();
  }

  private refreshFocus(): void {
    for (let i = 0; i < this.actions.length; i++) {
      const a = this.actions[i];
      const focused = i === this.focused;
      a.rect.setFillStyle(focused ? COL_FOCUS_BG : COL_PANEL);
      a.rect.setStrokeStyle(focused ? 4 : 3, focused ? COL_FOCUS_BORDER : COL_BORDER);
      if (a.id !== 'badges') {
        a.label.setColor(focused ? '#ffffff' : `#${COL_TEXT.toString(16).padStart(6, '0')}`);
      }
    }
  }

  private activate(): void {
    if (this.confirming) return;
    const action = this.actions[this.focused];
    if (action.id === 'play') this.startGame();
    else if (action.id === 'switchMode') this.swapMode();
    else if (action.id === 'changeUser') this.gotoUserSelect();
    else if (action.id === 'badges') { /* coming soon — no-op */ }
  }

  private swapMode(): void {
    this.mode = this.mode === 'endless' ? 'parkour' : 'endless';
    this.game.registry.set('mode', this.mode);
    try {
      window.localStorage.setItem('lionn:mode', this.mode);
    } catch {
      // ignore
    }
    this.modeLabel.setText(this.playLabel());
    this.statsLine.setText(this.formatStatsLine());
  }

  private startGame(): void {
    this.confirming = true;
    this.cameras.main.flash(120, 180, 120, 220);
    try {
      this.scene.start('GameScene');
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[StartScene] scene.start(GameScene) threw:', e);
      this.confirming = false;
    }
  }

  private gotoUserSelect(): void {
    this.confirming = true;
    try {
      this.scene.start('UserSelectScene');
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[StartScene] scene.start(UserSelectScene) threw:', e);
      this.confirming = false;
    }
  }

  private playLabel(): string {
    return `PLAY · ${this.mode.toUpperCase()}`;
  }

  private formatStatsLine(): string {
    const u = UserStore.getCurrentUser();
    if (!u) return '—';
    const m = this.mode;
    const dist = (u.bestDistance[m] / 100).toFixed(1);
    const score = u.bestScore[m];
    return `best  ${dist} m   ·   best  ★ ${score}   ·   runs  ${u.totalRuns}`;
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

void COL_TEXT_DIM; // reserved for future hover/dim states

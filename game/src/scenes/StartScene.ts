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
  id: 'play' | 'switchMode' | 'changeUser' | 'badges' | 'leaderboard' | 'skin';
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
    // Reset per-instance state. Phaser caches scene instances, so class-
    // field initializers (private confirming = false) only run ONCE at
    // construction. Without this reset, returning to StartScene after
    // a transition leaves confirming=true and every subsequent click /
    // gamepad press silently no-ops via the if-confirming-return guards.
    // That was the "menu freezes after one click" bug.
    this.confirming = false;
    this.actions = [];
    this.focused = 0;
    this.prev = { up: false, down: false, left: false, right: false, confirm: false, m: false };
    this.prevPadX = 0;
    this.prevPadY = 0;

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

    // Action list — centered column of rectangles. Gap was 12 px,
    // bumped to 18 so the kid has a wider visual cushion between
    // buttons (with FIT scaling on Mac viewports a click near the
    // edge of one button can land on the next if the gap is too
    // narrow). Buttons get a 4 px stroke that extends ~2 px outside
    // their bounds, so the effective hit-area gap is ~14 px now.
    const actionW = 360;
    const actionH = 48;
    const gap = 18;
    const startY = 256;
    const cx = VIEW.width / 2;

    this.actions = [
      this.makeAction('play', cx, startY + 0 * (actionH + gap), actionW, actionH, this.playLabel(), 32),
      this.makeAction('switchMode', cx, startY + 1 * (actionH + gap), actionW, actionH, 'SWITCH MODE', 20),
      this.makeAction('skin', cx, startY + 2 * (actionH + gap), actionW, actionH, 'SKIN', 20),
      this.makeAction('changeUser', cx, startY + 3 * (actionH + gap), actionW, actionH, 'CHANGE USER', 20),
      this.makeAction('badges', cx, startY + 4 * (actionH + gap), actionW, actionH, 'BADGES', 20),
      this.makeAction('leaderboard', cx, startY + 5 * (actionH + gap), actionW, actionH, 'LEADERBOARD', 20),
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
      // try/catch: Phaser's input subsystem may have already nulled
      // internals by the time this listener runs (we're inside the
      // shutdown chain). Without the catch, a TypeError here bubbles
      // through Phaser's step() and kills the entire RAF loop —
      // exactly the "purple frozen canvas" symptom described in the
      // bug report.
      try {
        if (gp) gp.off('down', this.onGamepadDown, this);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[StartScene] gamepad cleanup threw (harmless):', e);
      }
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
    // Phase 2 enabled BADGES — no actions are disabled in the menu now.
    this.focused = (this.focused + dir + this.actions.length) % this.actions.length;
    this.refreshFocus();
  }

  private refreshFocus(): void {
    for (let i = 0; i < this.actions.length; i++) {
      const a = this.actions[i];
      const focused = i === this.focused;
      a.rect.setFillStyle(focused ? COL_FOCUS_BG : COL_PANEL);
      a.rect.setStrokeStyle(focused ? 4 : 3, focused ? COL_FOCUS_BORDER : COL_BORDER);
      a.label.setColor(focused ? '#ffffff' : `#${COL_TEXT.toString(16).padStart(6, '0')}`);
    }
  }

  private activate(): void {
    const action = this.actions[this.focused];
    // Inline mode toggle — doesn't transition, so we don't lock.
    if (action.id === 'switchMode') {
      this.swapMode();
      return;
    }
    // All other actions transition. The guard below + the immediate
    // detach of the gamepad listener close the same-tick double-fire
    // window described in the bug report (Chrome's gamepad-to-key
    // shim plus our event listener both calling activate on the same
    // frame). The first call wins and detaches; the second sees
    // confirming=true and bails before reaching scene.start.
    if (this.confirming) return;
    this.confirming = true;
    this.detachGamepadListener();
    if (action.id === 'play') this.startGame();
    else if (action.id === 'changeUser') this.gotoUserSelect();
    else if (action.id === 'badges') this.gotoScene('BadgesScene');
    else if (action.id === 'leaderboard') this.gotoScene('LeaderboardScene');
    else if (action.id === 'skin') this.gotoScene('SkinSelectScene');
  }

  private detachGamepadListener(): void {
    const gp = this.input.gamepad;
    if (!gp) return;
    try {
      gp.off('down', this.onGamepadDown, this);
    } catch {
      // Phaser may have already nulled internals during a chained
      // shutdown — ignore so we don't propagate.
    }
  }

  private gotoScene(key: string): void {
    try {
      this.scene.start(key);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`[StartScene] scene.start(${key}) threw:`, e);
      this.confirming = false;
    }
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
    // confirming + gamepad detach already done in activate().
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
    // Label specifies "dist" + "score" so the kid doesn't see two columns
    // both labelled "best". `total runs` uses the lifetime counter (the
    // store doesn't track per-mode run counts yet — adding that requires
    // a schema bump; relabelled clearly until then).
    return `best dist  ${dist} m   ·   best score  ★ ${score}   ·   total runs  ${u.totalRuns}`;
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

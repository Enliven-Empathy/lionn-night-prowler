import Phaser from 'phaser';
import { VIEW } from '../core/constants';
import { GameMode, RunSummary, UserStore } from '../state/UserStore';

/**
 * Game-over screen. Replaces the 5-layer auto-restart timer system that
 * used to live inside GameScene.endRun. Now: GameScene fires
 *
 *     this.scene.start('ResultsScene', { summary, isNewBest })
 *
 * on death; this scene shows the run stats, displays NEW BEST callouts
 * if applicable, and offers two actions:
 *
 *   - PLAY AGAIN (focused by default, A/Cross/Space/Enter confirms) →
 *     re-enters GameScene with the same mode. One-tap retry preserves
 *     the speed-of-restart UX the auto-restart was built for.
 *   - MAIN MENU → StartScene.
 *
 * Safety nets (carried over from the old endRun):
 *   - 8 s of total inactivity → auto-fire PLAY AGAIN. Catches the kid
 *     getting distracted; equivalent to the old 3.5–7.5 s setTimeout
 *     restart layer but at this scene rather than burning GameScene.
 *   - 12 s after enter, IF we haven't transitioned (still in this scene
 *     and not yet `confirming`) → window.location.reload(). The
 *     "nuclear" reset, scoped to ResultsScene so a Phaser scene-shutdown
 *     bug here doesn't strand the kid forever.
 */

export interface ResultsSceneData {
  summary: RunSummary;
  isNewBestDistance: boolean;
  isNewBestScore: boolean;
}

const COL_BG = 0x14091f;
const COL_PANEL = 0x1f1230;
const COL_FOCUS_BG = 0x402461;
const COL_BORDER = 0x6a4d92;
const COL_FOCUS_BORDER = 0xb47bff;

interface Action {
  id: 'replay' | 'menu';
  rect: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
}

interface Keys {
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  space: Phaser.Input.Keyboard.Key;
  enter: Phaser.Input.Keyboard.Key;
  m: Phaser.Input.Keyboard.Key;
  esc: Phaser.Input.Keyboard.Key;
}

export class ResultsScene extends Phaser.Scene {
  private summary!: RunSummary;
  private isNewBestDistance = false;
  private isNewBestScore = false;

  private actions: Action[] = [];
  private focused = 0;

  private keys: Keys | null = null;
  private prev = { up: false, down: false, confirm: false, m: false, esc: false };
  private prevPadY = 0;
  private confirming = false;

  /** Wall-clock ms when the scene was created. Used for the 8 s
   *  inactivity auto-replay and the 12 s nuclear reload. */
  private enteredAtMs = 0;
  /** Wall-clock ms of the last input event we observed. Resets the
   *  inactivity timer. */
  private lastActivityMs = 0;
  private autoReplayFired = false;
  private nuclearTimerId: number | null = null;

  constructor() {
    super('ResultsScene');
  }

  init(data: ResultsSceneData | undefined): void {
    if (!data || !data.summary) {
      // Defensive: if we somehow land here with no data, fabricate a
      // minimal summary so the scene still renders rather than crashes.
      this.summary = {
        mode: 'endless',
        distance: 0,
        score: 0,
        enemiesKilled: 0,
        startedAt: Date.now(),
        endedAt: Date.now(),
      };
      this.isNewBestDistance = false;
      this.isNewBestScore = false;
    } else {
      this.summary = data.summary;
      this.isNewBestDistance = data.isNewBestDistance;
      this.isNewBestScore = data.isNewBestScore;
    }
    this.confirming = false;
    this.autoReplayFired = false;
    this.focused = 0; // PLAY AGAIN focused by default
  }

  create(): void {
    this.enteredAtMs = Date.now();
    this.lastActivityMs = this.enteredAtMs;

    this.add.rectangle(VIEW.width / 2, VIEW.height / 2, VIEW.width, VIEW.height, COL_BG)
      .setDepth(-100);

    this.add.text(VIEW.width / 2, 110, 'GAME OVER', {
      fontFamily: 'Cinzel, Georgia, serif',
      fontSize: '64px',
      color: '#ff6680',
    }).setOrigin(0.5).setDepth(10);

    const modeLabel = this.summary.mode.toUpperCase();
    this.add.text(VIEW.width / 2, 175, `${modeLabel} run`, {
      fontFamily: 'Cinzel, Georgia, serif',
      fontSize: '20px',
      color: '#9b8fb8',
    }).setOrigin(0.5).setDepth(10);

    // Stat block — distance + score, with "NEW BEST" callouts.
    const statY = 260;
    const distM = (this.summary.distance / 100).toFixed(1);
    this.add.text(VIEW.width / 2, statY, `distance  ${distM} m`, {
      fontFamily: 'Cinzel, Georgia, serif',
      fontSize: '28px',
      color: '#e6deff',
    }).setOrigin(0.5).setDepth(10);
    if (this.isNewBestDistance) {
      this.add.text(VIEW.width / 2, statY + 32, 'NEW BEST!', {
        fontFamily: 'Cinzel, Georgia, serif',
        fontSize: '16px',
        color: '#ffd86a',
      }).setOrigin(0.5).setDepth(10);
    }

    const score2Y = statY + 70;
    this.add.text(VIEW.width / 2, score2Y, `score  ★ ${this.summary.score}`, {
      fontFamily: 'Cinzel, Georgia, serif',
      fontSize: '28px',
      color: '#e6deff',
    }).setOrigin(0.5).setDepth(10);
    if (this.isNewBestScore) {
      this.add.text(VIEW.width / 2, score2Y + 32, 'NEW BEST!', {
        fontFamily: 'Cinzel, Georgia, serif',
        fontSize: '16px',
        color: '#ffd86a',
      }).setOrigin(0.5).setDepth(10);
    }

    // Current user (small line under stats).
    const u = UserStore.getCurrentUser();
    if (u) {
      this.add.text(VIEW.width / 2, score2Y + 70, `${u.tag}  ·  ${u.totalRuns} runs`, {
        fontFamily: 'Cinzel, Georgia, serif',
        fontSize: '14px',
        color: '#5a4a78',
      }).setOrigin(0.5).setDepth(10);
    }

    // Action buttons.
    const actionW = 320;
    const actionH = 64;
    const startY = VIEW.height - 180;
    const cx = VIEW.width / 2;
    this.actions = [
      this.makeAction('replay', cx, startY, actionW, actionH, 'PLAY AGAIN', 30),
      this.makeAction('menu', cx, startY + actionH + 16, actionW, actionH, 'MAIN MENU', 22),
    ];
    this.refreshFocus();

    this.add.text(VIEW.width / 2, VIEW.height - 36,
      'SPACE/ENTER/X plays again  |  UP/DOWN to switch  |  M for menu',
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
        space: kb.addKey(KC.SPACE),
        enter: kb.addKey(KC.ENTER),
        m: kb.addKey(KC.M),
        esc: kb.addKey(KC.ESC),
      };
    }

    const gp = this.input.gamepad;
    if (gp) gp.on('down', this.onGamepadDown, this);

    // Nuclear reload safety: if we're still here at +12 s without
    // transitioning, force a page reload. The kid might have hit a
    // Phaser shutdown bug; this guarantees they get back to a working
    // state.
    this.nuclearTimerId = window.setTimeout(() => {
      if (!this.confirming) {
        // eslint-disable-next-line no-console
        console.warn('[ResultsScene] still here at +12 s — reloading');
        try { window.location.reload(); } catch { /* nothing left */ }
      }
    }, 12000);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (gp) gp.off('down', this.onGamepadDown, this);
      if (this.nuclearTimerId !== null) {
        window.clearTimeout(this.nuclearTimerId);
        this.nuclearTimerId = null;
      }
    });
  }

  override update(): void {
    try {
      this.handleInput();
      this.checkInactivityAutoReplay();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[ResultsScene] update threw:', e);
    }
  }

  private handleInput(): void {
    if (!this.keys) return;

    const upDown = this.keys.up.isDown;
    const downDown = this.keys.down.isDown;
    const confirmDown = this.keys.space.isDown || this.keys.enter.isDown;
    const mDown = this.keys.m.isDown;
    const escDown = this.keys.esc.isDown;

    let anyEdge = false;
    if (upDown && !this.prev.up) { this.moveFocus(-1); anyEdge = true; }
    if (downDown && !this.prev.down) { this.moveFocus(1); anyEdge = true; }
    if (confirmDown && !this.prev.confirm) { this.activate(); anyEdge = true; }
    if (mDown && !this.prev.m) { this.gotoMenu(); anyEdge = true; }
    if (escDown && !this.prev.esc) { this.gotoMenu(); anyEdge = true; }
    if (anyEdge) this.lastActivityMs = Date.now();
    this.prev = { up: upDown, down: downDown, confirm: confirmDown, m: mDown, esc: escDown };

    const pad = this.firstStandardPad();
    if (pad && pad.axes && pad.axes.length >= 2) {
      const ay = pad.axes[1]?.value ?? 0;
      const yDir = ay < -0.5 ? -1 : ay > 0.5 ? 1 : 0;
      if (yDir === -1 && this.prevPadY !== -1) { this.moveFocus(-1); this.lastActivityMs = Date.now(); }
      if (yDir === 1 && this.prevPadY !== 1) { this.moveFocus(1); this.lastActivityMs = Date.now(); }
      this.prevPadY = yDir;
    }
  }

  private checkInactivityAutoReplay(): void {
    if (this.autoReplayFired || this.confirming) return;
    if (Date.now() - this.lastActivityMs > 8000) {
      this.autoReplayFired = true;
      // eslint-disable-next-line no-console
      console.log('[ResultsScene] auto-replay after 8 s of inactivity');
      this.replay();
    }
  }

  private onGamepadDown = (
    _pad: Phaser.Input.Gamepad.Gamepad,
    button: Phaser.Input.Gamepad.Button | undefined,
  ): void => {
    if (!button || this.confirming) return;
    this.lastActivityMs = Date.now();
    try {
      switch (button.index) {
        case 0: case 9: this.activate(); break;     // Cross / Start
        case 1: this.gotoMenu(); break;              // Circle
        case 12: this.moveFocus(-1); break;
        case 13: this.moveFocus(1); break;
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[ResultsScene] gamepad-down threw:', e);
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
  ): Action {
    const rect = this.add.rectangle(cx, cy, w, h, COL_PANEL);
    rect.setStrokeStyle(3, COL_BORDER);
    rect.setDepth(5);
    rect.setInteractive({ useHandCursor: true });
    rect.on('pointerdown', () => {
      this.focused = this.actions.findIndex((a) => a.id === id);
      this.refreshFocus();
      this.lastActivityMs = Date.now();
      this.activate();
    });
    rect.on('pointerover', () => {
      this.focused = this.actions.findIndex((a) => a.id === id);
      this.refreshFocus();
      this.lastActivityMs = Date.now();
    });
    const text = this.add.text(cx, cy, label, {
      fontFamily: 'Cinzel, Georgia, serif',
      fontSize: `${fontSize}px`,
      color: '#e6deff',
    }).setOrigin(0.5).setDepth(6);
    return { id, rect, label: text };
  }

  private moveFocus(dir: -1 | 1): void {
    this.focused = (this.focused + dir + this.actions.length) % this.actions.length;
    this.refreshFocus();
  }

  private refreshFocus(): void {
    for (let i = 0; i < this.actions.length; i++) {
      const a = this.actions[i];
      const focused = i === this.focused;
      a.rect.setFillStyle(focused ? COL_FOCUS_BG : COL_PANEL);
      a.rect.setStrokeStyle(focused ? 4 : 3, focused ? COL_FOCUS_BORDER : COL_BORDER);
      a.label.setColor(focused ? '#ffffff' : '#e6deff');
    }
  }

  private activate(): void {
    if (this.confirming) return;
    const a = this.actions[this.focused];
    if (a.id === 'replay') this.replay();
    else this.gotoMenu();
  }

  private replay(): void {
    if (this.confirming) return;
    this.confirming = true;
    // Make sure GameScene's mode honours whatever was set during the run
    // (if the kid switched mode mid-run via M, they'd be back at
    // StartScene anyway — replay only fires from a death, where mode
    // is unchanged from when GameScene started).
    const mode: GameMode = this.summary.mode;
    this.game.registry.set('mode', mode);
    try {
      this.scene.start('GameScene');
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[ResultsScene] scene.start(GameScene) threw:', e);
      this.confirming = false;
      // Try the page-reload fallback so we don't strand here.
      try { window.location.reload(); } catch { /* nothing left */ }
    }
  }

  private gotoMenu(): void {
    if (this.confirming) return;
    this.confirming = true;
    try {
      this.scene.start('StartScene');
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[ResultsScene] scene.start(StartScene) threw:', e);
      this.confirming = false;
      try { window.location.reload(); } catch { /* nothing left */ }
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

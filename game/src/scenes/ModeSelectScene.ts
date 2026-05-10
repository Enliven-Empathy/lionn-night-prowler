import Phaser from 'phaser';
import { VIEW } from '../core/constants';

/**
 * Mode picker. Renders two cards (ENDLESS / PARKOUR) and writes the
 * choice to game.registry + localStorage so the rest of the game can
 * read it without coupling.
 *
 * Inputs:
 *   - Keyboard: 1 / Left = ENDLESS, 2 / Right = PARKOUR. SPACE / ENTER
 *     confirms the highlighted card.
 *   - Gamepad: D-pad / left stick LEFT/RIGHT to highlight, Cross / Start
 *     to confirm. Uses Phaser's per-button 'down' EVENTS rather than
 *     polling button.pressed every frame — that's important because
 *     DualSense controllers paired over Bluetooth sometimes report
 *     Cross (button 0) as `pressed = true` from scene start, which a
 *     polling rising-edge check sees as "already held forever" and the
 *     real press never registers. The kid then experiences a visual
 *     freeze: pressing the controller does nothing. Phaser's 'down'
 *     event tracks the actual transition, so it fires correctly even
 *     when the initial state is stuck.
 *   - Mouse: click a card to confirm.
 *
 * Implementation notes:
 *   - Keys are cached in create(); update() never calls addKey() so
 *     listeners don't pile up across frames.
 *   - Whole `update()` body is wrapped in try/catch so any future input-
 *     plugin hiccup logs and continues instead of killing the RAF loop.
 *   - Gamepad listener is removed in shutdown() so a stale callback
 *     can't fire after the scene has transitioned away.
 */

type Mode = 'endless' | 'parkour';

const COL_BG = 0x14091f;
const COL_CARD = 0x1f1230;
const COL_CARD_SELECTED = 0x402461;
const COL_BORDER = 0x6a4d92;
const COL_BORDER_SELECTED = 0xb47bff;

interface Card {
  mode: Mode;
  rect: Phaser.GameObjects.Rectangle;
  title: Phaser.GameObjects.Text;
  desc: Phaser.GameObjects.Text;
}

interface Keys {
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
  a: Phaser.Input.Keyboard.Key;
  d: Phaser.Input.Keyboard.Key;
  one: Phaser.Input.Keyboard.Key;
  two: Phaser.Input.Keyboard.Key;
  space: Phaser.Input.Keyboard.Key;
  enter: Phaser.Input.Keyboard.Key;
}

export class ModeSelectScene extends Phaser.Scene {
  private cards: Card[] = [];
  private selectedIndex = 0;
  private keys: Keys | null = null;
  private prevLeft = false;
  private prevRight = false;
  private prevConfirm = false;
  private prevPadAxis = 0;
  /** Set true once we've handed off to GameScene so the gamepad event
   *  callback (which can fire one more time before Phaser fully detaches
   *  this scene's listeners) can't trigger a second scene.start. */
  private confirming = false;

  constructor() {
    super('ModeSelectScene');
  }

  create(): void {
    // Backdrop.
    this.add.rectangle(VIEW.width / 2, VIEW.height / 2, VIEW.width, VIEW.height, COL_BG)
      .setDepth(-100);

    // Title.
    this.add.text(VIEW.width / 2, 120, 'LIONN: NIGHT PROWLER', {
      fontFamily: 'Cinzel, Georgia, serif',
      fontSize: '52px',
      color: '#e6deff',
    }).setOrigin(0.5).setDepth(10);

    this.add.text(VIEW.width / 2, 180, 'pick your mode', {
      fontFamily: 'Cinzel, Georgia, serif',
      fontSize: '20px',
      color: '#9b8fb8',
    }).setOrigin(0.5).setDepth(10);

    // Cards.
    const cardW = 380;
    const cardH = 260;
    const gap = 60;
    const totalW = cardW * 2 + gap;
    const startX = (VIEW.width - totalW) / 2;
    const cardY = VIEW.height / 2 + 30;

    this.cards = [
      this.makeCard('endless', 0, startX + cardW / 2, cardY, cardW, cardH,
        'ENDLESS', 'Run as far as you can.\nEnemies, pits, spikes,\nhearts to collect.'),
      this.makeCard('parkour', 1, startX + cardW + gap + cardW / 2, cardY, cardW, cardH,
        'PARKOUR', 'Climb towers. Vertical-only.\nStairs, poles, gap jumps —\npure traversal.'),
    ];

    // Default selection: whichever was last played, or endless.
    const lastMode = this.game.registry.get('mode') as Mode | undefined;
    this.selectedIndex = lastMode === 'parkour' ? 1 : 0;
    this.refreshSelection();

    // Hint at bottom — plain ASCII so font fallbacks can't trip up rendering.
    this.add.text(VIEW.width / 2, VIEW.height - 60,
      'LEFT/RIGHT to choose  |  SPACE / ENTER / X to confirm  |  1=ENDLESS  2=PARKOUR  |  click a card',
      {
        fontFamily: 'Cinzel, Georgia, serif',
        fontSize: '14px',
        color: '#9b8fb8',
      }).setOrigin(0.5).setDepth(10);

    // Cache keys ONCE here. update() never calls addKey() — that prevents
    // listener accumulation and the scene-shutdown race that comes with it.
    const kb = this.input.keyboard;
    if (kb) {
      const KC = Phaser.Input.Keyboard.KeyCodes;
      this.keys = {
        left: kb.addKey(KC.LEFT),
        right: kb.addKey(KC.RIGHT),
        a: kb.addKey(KC.A),
        d: kb.addKey(KC.D),
        one: kb.addKey(KC.ONE),
        two: kb.addKey(KC.TWO),
        space: kb.addKey(KC.SPACE),
        enter: kb.addKey(KC.ENTER),
      };
    }

    // Reset rising-edge trackers so a key that was down on entry doesn't
    // fire on frame 1.
    this.prevLeft = !!(this.keys?.left.isDown || this.keys?.a.isDown);
    this.prevRight = !!(this.keys?.right.isDown || this.keys?.d.isDown);
    this.prevConfirm = !!(this.keys?.space.isDown || this.keys?.enter.isDown);
    this.confirming = false;

    // Gamepad: subscribe to per-button DOWN events. Phaser tracks the
    // up→down transition itself, so DualSense BT idle-press of Cross
    // (button 0 stuck at pressed=true) doesn't fire a 'down' event —
    // only a real press does. Polling button.pressed every frame, like
    // the previous version did, would never see the transition because
    // the state never CHANGES once it's stuck.
    const gp = this.input.gamepad;
    if (gp) {
      gp.on('down', this.onGamepadDown, this);
    }

    // Clean up the listener when the scene transitions out. try/catch
    // shields against Phaser's already-disposed input internals during
    // chained shutdowns — without it a TypeError here bubbles into
    // step() and kills the RAF loop (the "purple frozen canvas" bug).
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      try {
        if (gp) gp.off('down', this.onGamepadDown, this);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[ModeSelectScene] gamepad cleanup threw:', e);
      }
    });
  }

  /** Phaser fires this on every gamepad button DOWN edge (real press,
   *  not idle-stuck state). The Phaser plugin emits with (pad, button,
   *  index, value) signature in 3.55+. We dispatch by button index. */
  private onGamepadDown = (
    _pad: Phaser.Input.Gamepad.Gamepad,
    button: Phaser.Input.Gamepad.Button | undefined,
  ): void => {
    if (!button || this.confirming) return;
    try {
      switch (button.index) {
        case 0:  // Cross
        case 9:  // Start
          this.confirmCurrent();
          break;
        case 14: // dpad left
          this.move(-1);
          break;
        case 15: // dpad right
          this.move(1);
          break;
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[ModeSelectScene] gamepad-down handler threw:', e);
    }
  };

  override update(): void {
    try {
      this.handleInput();
    } catch (e) {
      // Don't let an input-plugin hiccup kill the RAF loop. Log loud so
      // we can still see it in the console, but the menu stays alive.
      // eslint-disable-next-line no-console
      console.error('[ModeSelectScene] input update threw:', e);
    }
  }

  private handleInput(): void {
    // KEYBOARD ─────────────────────────────────────────────────────────
    if (this.keys) {
      const leftDown = this.keys.left.isDown || this.keys.a.isDown;
      const rightDown = this.keys.right.isDown || this.keys.d.isDown;
      const confirmDown = this.keys.space.isDown || this.keys.enter.isDown;
      const oneDown = this.keys.one.isDown;
      const twoDown = this.keys.two.isDown;

      if (leftDown && !this.prevLeft) this.move(-1);
      if (rightDown && !this.prevRight) this.move(1);
      if (confirmDown && !this.prevConfirm) this.confirmCurrent();
      if (oneDown) this.confirm('endless');
      if (twoDown) this.confirm('parkour');

      this.prevLeft = leftDown;
      this.prevRight = rightDown;
      this.prevConfirm = confirmDown;
    }

    // GAMEPAD STICK (analog) ───────────────────────────────────────────
    // D-pad buttons + Cross/Start are handled via the 'down' EVENT
    // listener registered in create() — that path is immune to idle-press
    // bugs. The analog stick is polled here because there's no natural
    // "down" event for a stick crossing a threshold.
    const pad = this.firstStandardPad();
    if (pad && pad.axes && pad.axes.length > 0) {
      const axisX = pad.axes[0]?.value ?? 0;
      const padDir = axisX < -0.5 ? -1 : axisX > 0.5 ? 1 : 0;
      if (padDir === -1 && this.prevPadAxis !== -1) this.move(-1);
      if (padDir === 1 && this.prevPadAxis !== 1) this.move(1);
      this.prevPadAxis = padDir;
    }
  }

  private makeCard(
    mode: Mode,
    index: number,
    cx: number,
    cy: number,
    w: number,
    h: number,
    title: string,
    desc: string,
  ): Card {
    const rect = this.add.rectangle(cx, cy, w, h, COL_CARD);
    rect.setStrokeStyle(3, COL_BORDER);
    rect.setDepth(5);
    // Make the card clickable: pointerover highlights, pointerdown confirms.
    // setInteractive on a Rectangle uses the rect's bounds as hit area
    // automatically since Phaser 3.55.
    rect.setInteractive({ useHandCursor: true });
    rect.on('pointerover', () => {
      this.selectedIndex = index;
      this.refreshSelection();
    });
    rect.on('pointerdown', () => {
      this.selectedIndex = index;
      this.confirm(mode);
    });

    const titleText = this.add.text(cx, cy - 60, title, {
      fontFamily: 'Cinzel, Georgia, serif',
      fontSize: '36px',
      color: '#e6deff',
    }).setOrigin(0.5).setDepth(6);

    const descText = this.add.text(cx, cy + 30, desc, {
      fontFamily: 'Cinzel, Georgia, serif',
      fontSize: '16px',
      color: '#9b8fb8',
      align: 'center',
    }).setOrigin(0.5).setDepth(6);

    return { mode, rect, title: titleText, desc: descText };
  }

  private move(dir: -1 | 1): void {
    this.selectedIndex = (this.selectedIndex + dir + this.cards.length) % this.cards.length;
    this.refreshSelection();
  }

  private refreshSelection(): void {
    for (let i = 0; i < this.cards.length; i++) {
      const c = this.cards[i];
      const sel = i === this.selectedIndex;
      c.rect.setFillStyle(sel ? COL_CARD_SELECTED : COL_CARD);
      c.rect.setStrokeStyle(sel ? 4 : 3, sel ? COL_BORDER_SELECTED : COL_BORDER);
      c.title.setColor(sel ? '#ffffff' : '#e6deff');
      c.desc.setColor(sel ? '#e6deff' : '#9b8fb8');
    }
  }

  private confirmCurrent(): void {
    this.confirm(this.cards[this.selectedIndex].mode);
  }

  private confirm(mode: Mode): void {
    if (this.confirming) return; // re-entry guard for the in-flight transition
    this.confirming = true;
    this.game.registry.set('mode', mode);
    // Persist across page reloads so the kid only picks a mode once. The
    // M shortcut from GameScene routes back here for switching. Wrapped
    // in try/catch because some privacy-mode browsers throw on write.
    try {
      window.localStorage.setItem('lionn:mode', mode);
    } catch {
      // ignore — registry-only persistence is the fallback
    }
    // Visual flash on the confirmed card so the kid gets feedback that
    // confirm fired even if the scene transition takes a beat.
    const card = this.cards.find((c) => c.mode === mode);
    if (card) {
      card.rect.setFillStyle(0xb47bff);
      this.cameras.main.flash(140, 180, 120, 220);
    }
    try {
      this.scene.start('GameScene');
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[ModeSelectScene] scene.start threw:', e);
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

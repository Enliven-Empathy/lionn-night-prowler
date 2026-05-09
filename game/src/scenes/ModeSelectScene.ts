import Phaser from 'phaser';
import { VIEW } from '../core/constants';

/**
 * Mode picker that runs once at startup. Two cards: ENDLESS (the existing
 * game) and PARKOUR (the new vertical-traversal mode). The picker writes
 * the choice to game.registry under 'mode' so GameScene can read it
 * without coupling the scenes.
 *
 * Inputs (kid-tested set):
 *   - Keyboard: 1 / Left = ENDLESS, 2 / Right = PARKOUR. SPACE / ENTER
 *     confirms the highlighted card.
 *   - Gamepad: D-pad / left stick LEFT/RIGHT to highlight, Cross / Start
 *     to confirm.
 *
 * Once a mode is picked the scene transitions to GameScene. To switch
 * modes, the kid presses the "M" key during gameplay (handled in
 * GameScene) which routes back here.
 */

type Mode = 'endless' | 'parkour';

const COL_BG = 0x14091f;
const COL_CARD = 0x1f1230;
const COL_CARD_SELECTED = 0x402461;
const COL_BORDER = 0x6a4d92;
const COL_BORDER_SELECTED = 0xb47bff;
const COL_TEXT = 0xe6deff;
const COL_TEXT_DIM = 0x9b8fb8;

interface Card {
  mode: Mode;
  rect: Phaser.GameObjects.Rectangle;
  title: Phaser.GameObjects.Text;
  desc: Phaser.GameObjects.Text;
}

export class ModeSelectScene extends Phaser.Scene {
  private cards: Card[] = [];
  private selectedIndex = 0;
  private padPrevAxisX = 0;
  private padPrevConfirmed = true; // ignore button still held from last scene
  private keysPrev = { left: false, right: false, confirm: false };

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
      this.makeCard('endless', startX + cardW / 2, cardY, cardW, cardH,
        'ENDLESS', 'Run as far as you can.\nEnemies, pits, spikes,\nhearts to collect.'),
      this.makeCard('parkour', startX + cardW + gap + cardW / 2, cardY, cardW, cardH,
        'PARKOUR', 'Climb towers. Vertical-only.\nStairs, poles, gap jumps —\npure traversal.'),
    ];

    // Default selection: whichever was last played, or endless.
    const lastMode = this.game.registry.get('mode') as Mode | undefined;
    this.selectedIndex = lastMode === 'parkour' ? 1 : 0;
    this.refreshSelection();

    // Hint.
    this.add.text(VIEW.width / 2, VIEW.height - 60,
      '←/→ or ⬅️➡️ to choose · SPACE/ENTER/✕ to confirm · 1=ENDLESS · 2=PARKOUR',
      {
        fontFamily: 'Cinzel, Georgia, serif',
        fontSize: '14px',
        color: '#9b8fb8',
      }).setOrigin(0.5).setDepth(10);
  }

  override update(): void {
    const kb = this.input.keyboard;
    if (!kb) return;

    const leftKey = kb.checkDown(kb.addKey('LEFT')) || kb.checkDown(kb.addKey('A'));
    const rightKey = kb.checkDown(kb.addKey('RIGHT')) || kb.checkDown(kb.addKey('D'));
    const confirmKey = kb.checkDown(kb.addKey('SPACE')) || kb.checkDown(kb.addKey('ENTER'));
    const oneKey = kb.checkDown(kb.addKey('ONE'));
    const twoKey = kb.checkDown(kb.addKey('TWO'));

    // Keyboard transitions (rising edge).
    if (leftKey && !this.keysPrev.left) this.move(-1);
    if (rightKey && !this.keysPrev.right) this.move(1);
    if (oneKey) this.confirm('endless');
    if (twoKey) this.confirm('parkour');
    if (confirmKey && !this.keysPrev.confirm) this.confirmCurrent();
    this.keysPrev = { left: leftKey, right: rightKey, confirm: confirmKey };

    // Gamepad.
    const pad = this.firstStandardPad();
    if (pad) {
      const axisX = pad.axes[0]?.value ?? 0;
      const dpadLeft = pad.buttons[14]?.pressed ?? false;
      const dpadRight = pad.buttons[15]?.pressed ?? false;
      const cross = pad.buttons[0]?.pressed ?? false;
      const start = pad.buttons[9]?.pressed ?? false;

      if ((axisX < -0.5 || dpadLeft) && this.padPrevAxisX > -0.5) this.move(-1);
      if ((axisX > 0.5 || dpadRight) && this.padPrevAxisX < 0.5) this.move(1);
      this.padPrevAxisX = (axisX < -0.5 || dpadLeft) ? -1 : (axisX > 0.5 || dpadRight) ? 1 : 0;

      const confirmHeld = cross || start;
      if (confirmHeld && !this.padPrevConfirmed) this.confirmCurrent();
      this.padPrevConfirmed = confirmHeld;
    }
  }

  private makeCard(
    mode: Mode,
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
      c.title.setColor(sel ? '#ffffff' : `#${COL_TEXT.toString(16).padStart(6, '0')}`);
      c.desc.setColor(sel ? '#e6deff' : `#${COL_TEXT_DIM.toString(16).padStart(6, '0')}`);
    }
  }

  private confirmCurrent(): void {
    this.confirm(this.cards[this.selectedIndex].mode);
  }

  private confirm(mode: Mode): void {
    this.game.registry.set('mode', mode);
    this.scene.start('GameScene');
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

import Phaser from 'phaser';
import { VIEW } from '../core/constants';
import { UserProfile, UserStore } from '../state/UserStore';

/**
 * Local leaderboard. Lists every saved user on this device, sorted
 * by the current sort key. Phase-1 ships with five sort options; the
 * kid toggles via LEFT/RIGHT or the equivalent gamepad inputs.
 *
 * No networked leaderboard — that's a phase-4 stretch and would
 * require a backend. This is the "Smash Bros all-profiles-on-this-
 * console" view.
 *
 * Inputs:
 *   - LEFT/RIGHT (or 1-5 keys, dpad-LR)  cycle sort key
 *   - SPACE/ENTER/X/O  back to StartScene
 *
 * Each row shows rank, tag, value-for-current-sort, plus tertiary
 * stats (other-mode best) so the kid sees the player's broader profile.
 */

interface SortKey {
  id: string;
  label: string;
  /** Function returning the comparable number. Higher = better. */
  value: (u: UserProfile) => number;
  /** Display formatter for that number. */
  display: (n: number) => string;
}

const M = (px: number) => (px / 100).toFixed(0);

const SORTS: SortKey[] = [
  {
    id: 'score_endless',
    label: 'BEST SCORE  ·  ENDLESS',
    value: (u) => u.bestScore.endless,
    display: (n) => `★ ${n}`,
  },
  {
    id: 'score_parkour',
    label: 'BEST SCORE  ·  PARKOUR',
    value: (u) => u.bestScore.parkour,
    display: (n) => `★ ${n}`,
  },
  {
    id: 'distance_endless',
    label: 'BEST DISTANCE  ·  ENDLESS',
    value: (u) => u.bestDistance.endless,
    display: (px) => `${M(px)} m`,
  },
  {
    id: 'distance_parkour',
    label: 'BEST DISTANCE  ·  PARKOUR',
    value: (u) => u.bestDistance.parkour,
    display: (px) => `${M(px)} m`,
  },
  {
    id: 'total_runs',
    label: 'TOTAL RUNS',
    value: (u) => u.totalRuns,
    display: (n) => `${n}`,
  },
];

const COL_BG = 0x14091f;
const COL_ROW = 0x1f1230;
const COL_ROW_CURRENT = 0x402461;
const COL_BORDER = 0x6a4d92;
const COL_HEADER = 0xb47bff;
const COL_TEXT = '#e6deff';
const COL_TEXT_DIM = '#9b8fb8';
const COL_TEXT_GOLD = '#ffd86a';

interface Keys {
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
  one: Phaser.Input.Keyboard.Key;
  two: Phaser.Input.Keyboard.Key;
  three: Phaser.Input.Keyboard.Key;
  four: Phaser.Input.Keyboard.Key;
  five: Phaser.Input.Keyboard.Key;
  esc: Phaser.Input.Keyboard.Key;
  space: Phaser.Input.Keyboard.Key;
  enter: Phaser.Input.Keyboard.Key;
}

export class LeaderboardScene extends Phaser.Scene {
  private sortIndex = 0;
  private keys: Keys | null = null;
  private prev = { left: false, right: false, back: false, one: false, two: false, three: false, four: false, five: false };
  private prevPadX = 0;
  private confirming = false;

  /** All visible scene-text we re-render on sort change. Cleared and
   *  re-built each render pass. */
  private rendered: Phaser.GameObjects.GameObject[] = [];
  private headerLabel!: Phaser.GameObjects.Text;

  constructor() {
    super('LeaderboardScene');
  }

  create(): void {
    // Reset per-instance state — see StartScene.create comment for why.
    this.confirming = false;
    this.rendered = [];
    this.prev = { left: false, right: false, back: false, one: false, two: false, three: false, four: false, five: false };
    this.prevPadX = 0;

    this.add.rectangle(VIEW.width / 2, VIEW.height / 2, VIEW.width, VIEW.height, COL_BG)
      .setDepth(-100);

    this.add.text(VIEW.width / 2, 80, 'LEADERBOARD', {
      fontFamily: 'Cinzel, Georgia, serif',
      fontSize: '40px',
      color: COL_TEXT,
    }).setOrigin(0.5).setDepth(10);

    this.headerLabel = this.add.text(VIEW.width / 2, 130, '', {
      fontFamily: 'Cinzel, Georgia, serif',
      fontSize: '18px',
      color: `#${COL_HEADER.toString(16).padStart(6, '0')}`,
    }).setOrigin(0.5).setDepth(10);

    this.add.text(VIEW.width / 2, VIEW.height - 36,
      'LEFT/RIGHT cycle sort  |  ESC / X / SPACE to go back',
      {
        fontFamily: 'Cinzel, Georgia, serif',
        fontSize: '13px',
        color: COL_TEXT_DIM,
      }).setOrigin(0.5).setDepth(10);

    // Cache keys.
    const kb = this.input.keyboard;
    if (kb) {
      const KC = Phaser.Input.Keyboard.KeyCodes;
      this.keys = {
        left: kb.addKey(KC.LEFT),
        right: kb.addKey(KC.RIGHT),
        one: kb.addKey(KC.ONE),
        two: kb.addKey(KC.TWO),
        three: kb.addKey(KC.THREE),
        four: kb.addKey(KC.FOUR),
        five: kb.addKey(KC.FIVE),
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

    this.renderTable();
  }

  override update(): void {
    if (!this.keys) return;
    try {
      const leftDown = this.keys.left.isDown;
      const rightDown = this.keys.right.isDown;
      const back = this.keys.esc.isDown || this.keys.space.isDown || this.keys.enter.isDown;
      const oneDown = this.keys.one.isDown;
      const twoDown = this.keys.two.isDown;
      const threeDown = this.keys.three.isDown;
      const fourDown = this.keys.four.isDown;
      const fiveDown = this.keys.five.isDown;

      if (leftDown && !this.prev.left) this.cycleSort(-1);
      if (rightDown && !this.prev.right) this.cycleSort(1);
      if (back && !this.prev.back) this.goBack();
      if (oneDown && !this.prev.one) this.setSort(0);
      if (twoDown && !this.prev.two) this.setSort(1);
      if (threeDown && !this.prev.three) this.setSort(2);
      if (fourDown && !this.prev.four) this.setSort(3);
      if (fiveDown && !this.prev.five) this.setSort(4);
      this.prev = {
        left: leftDown, right: rightDown, back,
        one: oneDown, two: twoDown, three: threeDown, four: fourDown, five: fiveDown,
      };

      const pad = this.firstStandardPad();
      if (pad && pad.axes && pad.axes.length > 0) {
        const ax = pad.axes[0]?.value ?? 0;
        const xDir = ax < -0.5 ? -1 : ax > 0.5 ? 1 : 0;
        if (xDir === -1 && this.prevPadX !== -1) this.cycleSort(-1);
        if (xDir === 1 && this.prevPadX !== 1) this.cycleSort(1);
        this.prevPadX = xDir;
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[LeaderboardScene] update threw:', e);
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
        case 14: this.cycleSort(-1); break;
        case 15: this.cycleSort(1); break;
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[LeaderboardScene] gamepad-down threw:', e);
    }
  };

  private cycleSort(dir: -1 | 1): void {
    this.sortIndex = (this.sortIndex + dir + SORTS.length) % SORTS.length;
    this.renderTable();
  }

  private setSort(i: number): void {
    if (i < 0 || i >= SORTS.length) return;
    this.sortIndex = i;
    this.renderTable();
  }

  private renderTable(): void {
    // Clear previous render.
    for (const o of this.rendered) o.destroy();
    this.rendered = [];

    const sort = SORTS[this.sortIndex];
    this.headerLabel.setText(sort.label);

    const users = UserStore.listUsers().slice();
    users.sort((a, b) => sort.value(b) - sort.value(a));
    const currentId = UserStore.getCurrentUser()?.id ?? null;

    if (users.length === 0) {
      const t = this.add.text(VIEW.width / 2, VIEW.height / 2, 'no users yet', {
        fontFamily: 'Cinzel, Georgia, serif',
        fontSize: '20px',
        color: COL_TEXT_DIM,
      }).setOrigin(0.5).setDepth(10);
      this.rendered.push(t);
      return;
    }

    const rowW = 580;
    const rowH = 44;
    const gap = 6;
    const startY = 180;
    const cx = VIEW.width / 2;
    const maxRows = Math.min(users.length, 10);

    for (let i = 0; i < maxRows; i++) {
      const u = users[i];
      const cy = startY + i * (rowH + gap);
      const isMe = u.id === currentId;
      const rect = this.add.rectangle(cx, cy, rowW, rowH, isMe ? COL_ROW_CURRENT : COL_ROW);
      rect.setStrokeStyle(3, COL_BORDER);
      rect.setDepth(5);
      this.rendered.push(rect);

      const rankText = this.add.text(cx - rowW / 2 + 30, cy, `#${i + 1}`, {
        fontFamily: 'Cinzel, Georgia, serif',
        fontSize: '20px',
        color: i === 0 ? COL_TEXT_GOLD : COL_TEXT,
      }).setOrigin(0.5).setDepth(6);
      this.rendered.push(rankText);

      const tagText = this.add.text(cx - rowW / 2 + 110, cy, u.tag, {
        fontFamily: 'Cinzel, Georgia, serif',
        fontSize: '24px',
        color: isMe ? '#ffffff' : COL_TEXT,
      }).setOrigin(0.5).setDepth(6);
      this.rendered.push(tagText);

      const valueText = this.add.text(cx + rowW / 2 - 60, cy, sort.display(sort.value(u)), {
        fontFamily: 'Cinzel, Georgia, serif',
        fontSize: '22px',
        color: i === 0 ? COL_TEXT_GOLD : COL_TEXT,
      }).setOrigin(1, 0.5).setDepth(6);
      this.rendered.push(valueText);

      // Tertiary stats — small line of secondary numbers so the kid can
      // see context without switching sorts.
      const tertiary = `runs ${u.totalRuns}  ·  ★e ${u.bestScore.endless}  ★p ${u.bestScore.parkour}`;
      const tertiaryText = this.add.text(cx + rowW / 2 - 60, cy + 10, tertiary, {
        fontFamily: 'Cinzel, Georgia, serif',
        fontSize: '11px',
        color: COL_TEXT_DIM,
      }).setOrigin(1, 0).setDepth(6);
      this.rendered.push(tertiaryText);
    }

    if (users.length > maxRows) {
      const moreText = this.add.text(cx, startY + maxRows * (rowH + gap) + 6,
        `+ ${users.length - maxRows} more`,
        {
          fontFamily: 'Cinzel, Georgia, serif',
          fontSize: '13px',
          color: COL_TEXT_DIM,
        }).setOrigin(0.5).setDepth(6);
      this.rendered.push(moreText);
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


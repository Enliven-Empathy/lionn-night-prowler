import Phaser from 'phaser';
import { VIEW } from '../core/constants';
import { UserStore } from '../state/UserStore';

/**
 * NameEntryScene — Smash-Bros-style 3-character tag picker.
 *
 *   - 3 letter slots side by side. The selected slot has a glowing
 *     bracket; each slot shows a column of 3 letters (prev / current /
 *     next) so the kid sees what UP/DOWN cycles to.
 *   - LEFT/RIGHT moves the slot focus. UP/DOWN cycles letters A→Z→A.
 *   - SPACE/ENTER/Cross/Start confirms; the new user becomes current
 *     and we route to StartScene.
 *
 * Inputs use Phaser per-button DOWN events for the gamepad — same
 * resilience to DualSense BT idle-press as ModeSelectScene. Keyboard
 * is polled with rising-edge detection on cached Key references.
 *
 * Two routing modes:
 *   - "NEW" (default): create a new user from the picked tag.
 *   - "RENAME"  via scene data { renameUserId: string }: update an
 *     existing user's tag instead of creating one.
 *
 * Once a tag is committed, the scene routes to StartScene unless data
 * provided a `returnTo` override — used by UserSelectScene to bring
 * the kid back to the user-list after creating a new profile.
 */

interface SceneData {
  renameUserId?: string;
  returnTo?: string;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SLOT_COUNT = 3;

const COL_BG = 0x14091f;
const COL_SLOT = 0x1f1230;
const COL_SLOT_FOCUSED = 0x402461;
const COL_BORDER = 0x6a4d92;
const COL_BORDER_FOCUSED = 0xb47bff;

interface Slot {
  index: number;
  rect: Phaser.GameObjects.Rectangle;
  prevText: Phaser.GameObjects.Text;
  curText: Phaser.GameObjects.Text;
  nextText: Phaser.GameObjects.Text;
  letterIdx: number;
}

interface Keys {
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  a: Phaser.Input.Keyboard.Key;
  d: Phaser.Input.Keyboard.Key;
  w: Phaser.Input.Keyboard.Key;
  s: Phaser.Input.Keyboard.Key;
  space: Phaser.Input.Keyboard.Key;
  enter: Phaser.Input.Keyboard.Key;
  esc: Phaser.Input.Keyboard.Key;
}

export class NameEntryScene extends Phaser.Scene {
  private slots: Slot[] = [];
  private focusedSlot = 0;
  private mode: 'create' | 'rename' = 'create';
  private renameUserId: string | null = null;
  private returnTo = 'StartScene';

  private keys: Keys | null = null;
  private prev = { left: false, right: false, up: false, down: false, confirm: false, esc: false };
  private prevPadAxisX = 0;
  private prevPadAxisY = 0;
  private confirming = false;

  constructor() {
    super('NameEntryScene');
  }

  init(data: SceneData = {}): void {
    if (data.renameUserId) {
      this.mode = 'rename';
      this.renameUserId = data.renameUserId;
    } else {
      this.mode = 'create';
      this.renameUserId = null;
    }
    this.returnTo = data.returnTo ?? 'StartScene';
    this.focusedSlot = 0;
    this.confirming = false;
  }

  create(): void {
    this.add.rectangle(VIEW.width / 2, VIEW.height / 2, VIEW.width, VIEW.height, COL_BG)
      .setDepth(-100);

    this.add.text(VIEW.width / 2, 110, this.mode === 'create' ? 'NEW USER' : 'RENAME', {
      fontFamily: 'Cinzel, Georgia, serif',
      fontSize: '46px',
      color: '#e6deff',
    }).setOrigin(0.5).setDepth(10);

    this.add.text(VIEW.width / 2, 165, 'pick a 3-letter tag', {
      fontFamily: 'Cinzel, Georgia, serif',
      fontSize: '18px',
      color: '#9b8fb8',
    }).setOrigin(0.5).setDepth(10);

    // Letter slots.
    const slotW = 140;
    const slotH = 240;
    const gap = 30;
    const totalW = slotW * SLOT_COUNT + gap * (SLOT_COUNT - 1);
    const startX = (VIEW.width - totalW) / 2;
    const slotY = VIEW.height / 2 + 20;

    // Default tag: existing user's tag if renaming, else "AAA".
    let initialLetters = [0, 0, 0];
    if (this.mode === 'rename' && this.renameUserId) {
      const u = UserStore.listUsers().find((x) => x.id === this.renameUserId);
      if (u) {
        initialLetters = [
          ALPHABET.indexOf(u.tag[0]),
          ALPHABET.indexOf(u.tag[1]),
          ALPHABET.indexOf(u.tag[2]),
        ].map((i) => Math.max(0, i));
      }
    }

    for (let i = 0; i < SLOT_COUNT; i++) {
      const cx = startX + slotW / 2 + i * (slotW + gap);
      const rect = this.add.rectangle(cx, slotY, slotW, slotH, COL_SLOT);
      rect.setStrokeStyle(3, COL_BORDER);
      rect.setDepth(5);
      rect.setInteractive({ useHandCursor: true });
      rect.on('pointerdown', () => {
        this.focusedSlot = i;
        this.refreshFocus();
      });

      const idx = initialLetters[i];
      const prevText = this.add.text(cx, slotY - 70, ALPHABET[(idx - 1 + ALPHABET.length) % ALPHABET.length], {
        fontFamily: 'Cinzel, Georgia, serif',
        fontSize: '32px',
        color: '#5a4a78',
      }).setOrigin(0.5).setDepth(6);
      const curText = this.add.text(cx, slotY, ALPHABET[idx], {
        fontFamily: 'Cinzel, Georgia, serif',
        fontSize: '72px',
        color: '#e6deff',
      }).setOrigin(0.5).setDepth(6);
      const nextText = this.add.text(cx, slotY + 70, ALPHABET[(idx + 1) % ALPHABET.length], {
        fontFamily: 'Cinzel, Georgia, serif',
        fontSize: '32px',
        color: '#5a4a78',
      }).setOrigin(0.5).setDepth(6);

      this.slots.push({ index: i, rect, prevText, curText, nextText, letterIdx: idx });
    }

    this.refreshFocus();

    // Hint.
    this.add.text(VIEW.width / 2, VIEW.height - 60,
      'LEFT/RIGHT pick slot  |  UP/DOWN cycle letter  |  SPACE / ENTER / X confirm  |  ESC / O cancel',
      {
        fontFamily: 'Cinzel, Georgia, serif',
        fontSize: '14px',
        color: '#9b8fb8',
      }).setOrigin(0.5).setDepth(10);

    // Cache keys.
    const kb = this.input.keyboard;
    if (kb) {
      const KC = Phaser.Input.Keyboard.KeyCodes;
      this.keys = {
        left: kb.addKey(KC.LEFT),
        right: kb.addKey(KC.RIGHT),
        up: kb.addKey(KC.UP),
        down: kb.addKey(KC.DOWN),
        a: kb.addKey(KC.A),
        d: kb.addKey(KC.D),
        w: kb.addKey(KC.W),
        s: kb.addKey(KC.S),
        space: kb.addKey(KC.SPACE),
        enter: kb.addKey(KC.ENTER),
        esc: kb.addKey(KC.ESC),
      };
    }

    // Gamepad: per-button DOWN events for navigation/confirm. Same
    // resilience pattern as ModeSelectScene.
    const gp = this.input.gamepad;
    if (gp) gp.on('down', this.onGamepadDown, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      try {
        if (gp) gp.off('down', this.onGamepadDown, this);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[NameEntryScene] gamepad cleanup threw:', e);
      }
    });
  }

  override update(): void {
    try {
      this.handleInput();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[NameEntryScene] input update threw:', e);
    }
  }

  private handleInput(): void {
    if (!this.keys) return;

    const leftDown = this.keys.left.isDown || this.keys.a.isDown;
    const rightDown = this.keys.right.isDown || this.keys.d.isDown;
    const upDown = this.keys.up.isDown || this.keys.w.isDown;
    const downDown = this.keys.down.isDown || this.keys.s.isDown;
    const confirmDown = this.keys.space.isDown || this.keys.enter.isDown;
    const escDown = this.keys.esc.isDown;

    if (leftDown && !this.prev.left) this.moveFocus(-1);
    if (rightDown && !this.prev.right) this.moveFocus(1);
    if (upDown && !this.prev.up) this.cycleLetter(-1);
    if (downDown && !this.prev.down) this.cycleLetter(1);
    if (confirmDown && !this.prev.confirm) this.commit();
    if (escDown && !this.prev.esc) this.cancel();
    this.prev = { left: leftDown, right: rightDown, up: upDown, down: downDown, confirm: confirmDown, esc: escDown };

    // Analog stick fallback so the kid can use the stick if they prefer.
    const pad = this.firstStandardPad();
    if (pad && pad.axes && pad.axes.length >= 2) {
      const ax = pad.axes[0]?.value ?? 0;
      const ay = pad.axes[1]?.value ?? 0;
      const xDir = ax < -0.5 ? -1 : ax > 0.5 ? 1 : 0;
      const yDir = ay < -0.5 ? -1 : ay > 0.5 ? 1 : 0;
      if (xDir === -1 && this.prevPadAxisX !== -1) this.moveFocus(-1);
      if (xDir === 1 && this.prevPadAxisX !== 1) this.moveFocus(1);
      if (yDir === -1 && this.prevPadAxisY !== -1) this.cycleLetter(-1);
      if (yDir === 1 && this.prevPadAxisY !== 1) this.cycleLetter(1);
      this.prevPadAxisX = xDir;
      this.prevPadAxisY = yDir;
    }
  }

  private onGamepadDown = (
    _pad: Phaser.Input.Gamepad.Gamepad,
    button: Phaser.Input.Gamepad.Button | undefined,
  ): void => {
    if (!button || this.confirming) return;
    try {
      switch (button.index) {
        case 0:  // Cross
        case 9:  // Start
          this.commit();
          break;
        case 1:  // Circle — cancel (rename only)
          this.cancel();
          break;
        case 12: this.cycleLetter(-1); break; // dpad up
        case 13: this.cycleLetter(1); break;  // dpad down
        case 14: this.moveFocus(-1); break;   // dpad left
        case 15: this.moveFocus(1); break;    // dpad right
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[NameEntryScene] gamepad-down threw:', e);
    }
  };

  private moveFocus(dir: -1 | 1): void {
    this.focusedSlot = (this.focusedSlot + dir + SLOT_COUNT) % SLOT_COUNT;
    this.refreshFocus();
  }

  private cycleLetter(dir: -1 | 1): void {
    const slot = this.slots[this.focusedSlot];
    slot.letterIdx = (slot.letterIdx + dir + ALPHABET.length) % ALPHABET.length;
    this.refreshSlotText(slot);
  }

  private refreshFocus(): void {
    for (const s of this.slots) {
      const focused = s.index === this.focusedSlot;
      s.rect.setFillStyle(focused ? COL_SLOT_FOCUSED : COL_SLOT);
      s.rect.setStrokeStyle(focused ? 4 : 3, focused ? COL_BORDER_FOCUSED : COL_BORDER);
      s.curText.setColor(focused ? '#ffffff' : '#e6deff');
    }
  }

  private refreshSlotText(slot: Slot): void {
    const i = slot.letterIdx;
    slot.prevText.setText(ALPHABET[(i - 1 + ALPHABET.length) % ALPHABET.length]);
    slot.curText.setText(ALPHABET[i]);
    slot.nextText.setText(ALPHABET[(i + 1) % ALPHABET.length]);
  }

  private currentTag(): string {
    return this.slots.map((s) => ALPHABET[s.letterIdx]).join('');
  }

  private commit(): void {
    if (this.confirming) return;
    this.confirming = true;
    this.detachGamepadListener();
    const tag = this.currentTag();
    if (this.mode === 'rename' && this.renameUserId) {
      UserStore.renameUser(this.renameUserId, tag);
    } else {
      UserStore.createUser(tag);
    }
    this.cameras.main.flash(140, 180, 120, 220);
    try {
      this.scene.start(this.returnTo);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[NameEntryScene] scene.start threw:', e);
      this.confirming = false;
    }
  }

  private cancel(): void {
    if (this.confirming) return;
    // Cancel is allowed when:
    //   - mode === 'rename' (the existing user keeps their tag)
    //   - mode === 'create' AND there's already at least one user
    //     (the kid was sent here by mis-clicking CHANGE USER → NEW;
    //      they can bail back to StartScene without committing a tag).
    // The only case where cancel is blocked: first launch with no
    // users yet — we need the kid to commit a tag to have any
    // playable state at all.
    const canCancel = this.mode === 'rename' || UserStore.hasAnyUser();
    if (!canCancel) return;
    this.confirming = true;
    this.detachGamepadListener();
    try {
      this.scene.start(this.returnTo);
    } catch {
      this.confirming = false;
    }
  }

  private detachGamepadListener(): void {
    const gp = this.input.gamepad;
    if (!gp) return;
    try { gp.off('down', this.onGamepadDown, this); } catch { /* ignore */ }
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

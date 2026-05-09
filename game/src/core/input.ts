import Phaser from 'phaser';

export type ActionName = 'left' | 'right' | 'up' | 'down' | 'jump' | 'dash' | 'attack' | 'grab' | 'debugToggle' | 'restart';

interface ActionState {
  held: boolean;
  pressedAt: number;
  releasedAt: number;
}

const STICK_DEADZONE = 0.28;     // a hair generous: many DualSense pads rest with ~0.05–0.15 offsets via BT
const TRIGGER_THRESHOLD = 0.25;  // L2/R2 are analog; treat as pressed past this

// Button indices for Standard Gamepad mapping (W3C). Same on Xbox/PS/Generic
// when navigator reports `mapping: "standard"`.
const BTN = {
  CROSS_A: 0,
  CIRCLE_B: 1,
  SQUARE_X: 2,
  TRIANGLE_Y: 3,
  L1: 4,
  R1: 5,
  L2: 6,
  R2: 7,
  SELECT: 8,
  START: 9,
  L3: 10,
  R3: 11,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
} as const;

export class InputController {
  private actions = new Map<ActionName, ActionState>();
  private keys: Partial<Record<string, Phaser.Input.Keyboard.Key>> = {};
  private scene: Phaser.Scene;
  private now = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;

    const kb = scene.input.keyboard;
    if (!kb) throw new Error('Keyboard input plugin not available');

    this.keys.left1 = kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT);
    this.keys.left2 = kb.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keys.right1 = kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT);
    this.keys.right2 = kb.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.keys.up1 = kb.addKey(Phaser.Input.Keyboard.KeyCodes.UP);
    this.keys.up2 = kb.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keys.down1 = kb.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN);
    this.keys.down2 = kb.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.keys.jump1 = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.keys.dash1 = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.keys.attack1 = kb.addKey(Phaser.Input.Keyboard.KeyCodes.J);
    this.keys.grab1 = kb.addKey(Phaser.Input.Keyboard.KeyCodes.K);
    this.keys.debug1 = kb.addKey(Phaser.Input.Keyboard.KeyCodes.F3);
    this.keys.restart1 = kb.addKey(Phaser.Input.Keyboard.KeyCodes.R);

    const allActions: ActionName[] = ['left', 'right', 'up', 'down', 'jump', 'dash', 'attack', 'grab', 'debugToggle', 'restart'];
    for (const name of allActions) {
      this.actions.set(name, { held: false, pressedAt: -Infinity, releasedAt: -Infinity });
    }
  }

  update(timeMs: number): void {
    this.now = timeMs;
    const pad = this.firstStandardPad();

    // Sticks
    const stickX = applyDeadzone(pad?.axes[0]?.value ?? 0, STICK_DEADZONE);
    // axis 1 is intentionally unused: stick-up should NOT trigger jump (it's
    // ambiguous on idle BT pads and feels bad even when calibrated).

    // DPad
    const dpadLeft = btn(pad, BTN.DPAD_LEFT);
    const dpadRight = btn(pad, BTN.DPAD_RIGHT);
    const dpadUp = btn(pad, BTN.DPAD_UP);
    const dpadDown = btn(pad, BTN.DPAD_DOWN);

    // Movement: keyboard OR stick OR DPad
    const leftHeld = this.k('left1') || this.k('left2') || stickX < 0 || dpadLeft;
    const rightHeld = this.k('right1') || this.k('right2') || stickX > 0 || dpadRight;
    const upHeld = this.k('up1') || this.k('up2') || dpadUp;
    const downHeld = this.k('down1') || this.k('down2') || dpadDown;

    // Jump: only Cross. (We deliberately skip stick-up + Circle to avoid
    // misfires on idle BT pads.)
    const jumpHeld = this.k('jump1') || btn(pad, BTN.CROSS_A);

    // Dash: Shoulders + triggers. Triggers are analog; threshold them.
    const r2 = analog(pad, BTN.R2);
    const l2 = analog(pad, BTN.L2);
    const dashHeld =
      this.k('dash1') ||
      btn(pad, BTN.R1) ||
      btn(pad, BTN.L1) ||
      r2 > TRIGGER_THRESHOLD ||
      l2 > TRIGGER_THRESHOLD;

    // Attack: Square (primary). Triangle as alt. Circle DELIBERATELY excluded —
    // some BT-paired DualSense controllers report Circle pressed at idle.
    const attackHeld =
      this.k('attack1') ||
      btn(pad, BTN.SQUARE_X) ||
      btn(pad, BTN.TRIANGLE_Y);

    // Grab: Circle (○) or K. Idle-reported Circle is fine here because
    // GameScene reads grab via justPressed (rising edge only) — a stuck
    // "held" state can only register ONE grab attempt at scene start,
    // not a continuous grab spam.
    const grabHeld = this.k('grab1') || btn(pad, BTN.CIRCLE_B);

    const debugHeld = this.k('debug1');
    // Restart on game-over: keyboard R, plus a *generous* gamepad binding so
    // the kid can't miss it. Standard Start is button 9, but DualSense over
    // BT sometimes reports differently; we accept Start, Select/Share,
    // Touchpad, and even Cross while game-over.
    const restartHeld =
      this.k('restart1') ||
      btn(pad, BTN.START) ||
      btn(pad, BTN.SELECT) ||
      btn(pad, 17) || // PS5 touchpad click on standard layout
      btn(pad, BTN.CROSS_A);

    this.set('left', leftHeld);
    this.set('right', rightHeld);
    this.set('up', upHeld);
    this.set('down', downHeld);
    this.set('jump', jumpHeld);
    this.set('dash', dashHeld);
    this.set('attack', attackHeld);
    this.set('grab', grabHeld);
    this.set('debugToggle', debugHeld);
    this.set('restart', restartHeld);
  }

  held(name: ActionName): boolean {
    return this.actions.get(name)!.held;
  }

  justPressed(name: ActionName, withinMs = 0): boolean {
    const a = this.actions.get(name)!;
    return a.held && this.now - a.pressedAt <= withinMs;
  }

  pressedWithinBuffer(name: ActionName, bufferMs: number): boolean {
    const a = this.actions.get(name)!;
    return this.now - a.pressedAt <= bufferMs;
  }

  consumePress(name: ActionName): void {
    const a = this.actions.get(name)!;
    a.pressedAt = -Infinity;
  }

  axisX(): number {
    const left = this.held('left') ? 1 : 0;
    const right = this.held('right') ? 1 : 0;
    const pad = this.firstStandardPad();
    const stick = applyDeadzone(pad?.axes[0]?.value ?? 0, STICK_DEADZONE);
    if (stick !== 0) return stick;
    return right - left;
  }

  /**
   * Returns the first connected pad with `standard` mapping, or undefined.
   * Skipping non-standard pads avoids feeding garbage button indices.
   */
  private firstStandardPad(): Phaser.Input.Gamepad.Gamepad | undefined {
    const gp = this.scene.input.gamepad;
    if (!gp) return undefined;
    for (const p of gp.gamepads) {
      if (!p) continue;
      // Phaser doesn't expose `mapping`; fall back to a button-count heuristic
      // (standard layout has ≥16 buttons; non-standard often has 4–6).
      if (p.buttons.length >= 12) return p;
    }
    return undefined;
  }

  private k(name: string): boolean {
    return this.keys[name]?.isDown ?? false;
  }

  private set(name: ActionName, isHeld: boolean): void {
    const a = this.actions.get(name)!;
    if (isHeld && !a.held) a.pressedAt = this.now;
    if (!isHeld && a.held) a.releasedAt = this.now;
    a.held = isHeld;
  }
}

function applyDeadzone(v: number, dz: number): number {
  if (v > dz) return (v - dz) / (1 - dz);
  if (v < -dz) return (v + dz) / (1 - dz);
  return 0;
}

function btn(pad: Phaser.Input.Gamepad.Gamepad | undefined, idx: number): boolean {
  if (!pad) return false;
  const b = pad.buttons[idx];
  return b?.pressed ?? false;
}

function analog(pad: Phaser.Input.Gamepad.Gamepad | undefined, idx: number): number {
  if (!pad) return 0;
  const b = pad.buttons[idx];
  return b?.value ?? 0;
}

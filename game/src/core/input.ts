import Phaser from 'phaser';

export type ActionName = 'left' | 'right' | 'up' | 'down' | 'jump' | 'dash' | 'attack' | 'debugToggle';

interface ActionState {
  held: boolean;
  pressedAt: number;
  releasedAt: number;
}

const GAMEPAD_DEADZONE = 0.2;

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
    this.keys.debug1 = kb.addKey(Phaser.Input.Keyboard.KeyCodes.F3);

    const allActions: ActionName[] = ['left', 'right', 'up', 'down', 'jump', 'dash', 'attack', 'debugToggle'];
    for (const name of allActions) {
      this.actions.set(name, { held: false, pressedAt: -Infinity, releasedAt: -Infinity });
    }
  }

  update(timeMs: number): void {
    this.now = timeMs;
    const pad = this.scene.input.gamepad?.pad1;

    const stickX = pad?.axes[0]?.getValue() ?? 0;
    const leftHeld = this.k('left1') || this.k('left2') || stickX < -GAMEPAD_DEADZONE || Boolean(pad?.left);
    const rightHeld = this.k('right1') || this.k('right2') || stickX > GAMEPAD_DEADZONE || Boolean(pad?.right);
    const upHeld = this.k('up1') || this.k('up2') || Boolean(pad?.up);
    const downHeld = this.k('down1') || this.k('down2') || Boolean(pad?.down);
    const jumpHeld = this.k('jump1') || this.k('up1') || this.k('up2') || Boolean(pad?.A) || Boolean(pad?.up);
    const dashHeld = this.k('dash1') || Boolean(pad?.R2) || Boolean(pad?.R1);
    const attackHeld = this.k('attack1') || Boolean(pad?.X) || Boolean(pad?.B);
    const debugHeld = this.k('debug1');

    this.set('left', leftHeld);
    this.set('right', rightHeld);
    this.set('up', upHeld);
    this.set('down', downHeld);
    this.set('jump', jumpHeld);
    this.set('dash', dashHeld);
    this.set('attack', attackHeld);
    this.set('debugToggle', debugHeld);
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
    const pad = this.scene.input.gamepad?.pad1;
    const stick = pad?.axes[0]?.getValue() ?? 0;
    if (Math.abs(stick) > GAMEPAD_DEADZONE) return stick;
    return right - left;
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

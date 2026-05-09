import Phaser from 'phaser';
import { VIEW } from '../core/constants';

/**
 * Live gamepad inspector. Shows:
 *  - connected pad name + index + standard-mapping flag
 *  - all axis values (sticks + triggers if mapped to axes)
 *  - all button states with their index, lit when pressed
 *  - which game actions they currently resolve to
 *
 * Toggle with G. Always-on at first launch so we can verify mapping right after pairing.
 */
export class GamepadDebug {
  private scene: Phaser.Scene;
  private text: Phaser.GameObjects.Text;
  visible = true;
  private buttonNames = [
    'A (✕ Cross)',     // 0
    'B (○ Circle)',    // 1
    'X (□ Square)',    // 2
    'Y (△ Triangle)',  // 3
    'L1 (LB)',         // 4
    'R1 (RB)',         // 5
    'L2 (LT)',         // 6
    'R2 (RT)',         // 7
    'Select/Share',    // 8
    'Start/Options',   // 9
    'L3 (LS click)',   // 10
    'R3 (RS click)',   // 11
    '↑ DPad',          // 12
    '↓ DPad',          // 13
    '← DPad',          // 14
    '→ DPad',          // 15
    'PS/Home',         // 16
    'Touchpad',        // 17
  ];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.text = scene.add.text(VIEW.width - 360, 12, '', {
      fontFamily: 'Menlo, monospace',
      fontSize: '11px',
      color: '#cfd2ff',
      backgroundColor: 'rgba(8, 6, 16, 0.78)',
      padding: { left: 8, right: 8, top: 6, bottom: 6 },
      lineSpacing: 1,
    });
    this.text.setScrollFactor(0).setDepth(1500);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.text.setVisible(this.visible);
  }

  update(): void {
    if (!this.visible) return;

    const lines: string[] = [];
    const gamepads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
    const phaserPads = this.scene.input.gamepad?.gamepads ?? [];

    lines.push(`gamepads (browser): ${gamepads.filter(Boolean).length}   phaser: ${phaserPads.length}`);

    let i = 0;
    for (const gp of gamepads) {
      if (!gp) continue;
      lines.push(`──── pad ${i++} ────`);
      lines.push(`id: ${truncate(gp.id, 56)}`);
      lines.push(`mapping: ${gp.mapping || '(empty=non-standard)'}   conn: ${gp.connected ? 'Y' : 'N'}`);
      // Axes
      const axStr = (gp.axes ?? []).map((v, k) => `ax${k}:${v.toFixed(2).padStart(5)}`).join(' ');
      lines.push(`axes: ${axStr || '(none)'}`);
      // Buttons (only show pressed + first 18 even if not pressed for full map)
      const btns = gp.buttons ?? [];
      const pressedList: string[] = [];
      for (let b = 0; b < btns.length; b++) {
        const btn = btns[b];
        if (!btn) continue;
        if (btn.pressed || btn.value > 0.05) {
          const name = this.buttonNames[b] ?? `btn${b}`;
          pressedList.push(`${b}=${name} ${btn.value.toFixed(2)}`);
        }
      }
      lines.push(`pressed: ${pressedList.length === 0 ? '(none)' : pressedList.join(', ')}`);
    }

    if (gamepads.filter(Boolean).length === 0) {
      lines.push('');
      lines.push('No pad detected.');
      lines.push('— Press any button on the pad to wake it up.');
      lines.push('— macOS Bluetooth: confirm DualSense is paired in System Settings.');
      lines.push('— Browser must have focused this tab since pad connected.');
    } else {
      lines.push('');
      lines.push('action mapping:');
      lines.push('  jump    = btn 0 (✕ Cross)');
      lines.push('  attack  = btn 2 (□ Square)  OR btn 3 (△ Triangle)');
      lines.push('  dash    = btn 4/5/6/7 (L1/R1/L2/R2)');
      lines.push('  restart = btn 9 Start  OR 8 Share  OR 17 Touchpad  OR 0 Cross');
      lines.push('  move    = axis 0 (left stick)     OR D-pad 14/15');
      lines.push('');
      lines.push('press G to hide this panel');
    }

    this.text.setText(lines);
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

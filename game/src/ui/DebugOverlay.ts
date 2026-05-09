import Phaser from 'phaser';
import { MovementSnapshot } from '../movement/PlayerMovement';

export class DebugOverlay {
  private text: Phaser.GameObjects.Text;
  // Hidden by default — this is dev/diag chrome, not for everyday play.
  // Toggle with F3.
  private visible = false;

  constructor(scene: Phaser.Scene) {
    this.text = scene.add.text(12, 12, '', {
      fontFamily: 'Menlo, monospace',
      fontSize: '13px',
      color: '#c4b8e8',
      backgroundColor: 'rgba(8, 6, 16, 0.65)',
      padding: { left: 8, right: 8, top: 6, bottom: 6 },
    });
    this.text.setScrollFactor(0).setDepth(1000).setVisible(false);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.text.setVisible(this.visible);
  }

  update(snap: MovementSnapshot, fps: number, hp?: { current: number; max: number }): void {
    if (!this.visible) return;
    const wallStr = snap.wallSide === -1 ? 'L' : snap.wallSide === 1 ? 'R' : '·';
    const lines = [
      `state ${snap.state.padEnd(10)} face ${snap.facing > 0 ? '>' : '<'}  fps ${fps.toFixed(0)}`,
      `vx ${snap.vx.toFixed(0).padStart(5)}  vy ${snap.vy.toFixed(0).padStart(5)}  grounded ${snap.grounded ? 'Y' : 'N'}  wall ${wallStr}`,
      `coyote ${snap.coyoteRemainingMs.toFixed(0).padStart(4)}ms  buffer ${snap.jumpBufferRemainingMs.toFixed(0).padStart(4)}ms`,
      `dash ${snap.dashing ? 'ACTIVE' : `cd ${snap.dashCooldownRemainingMs.toFixed(0)}ms`}  ${snap.crouching ? 'CROUCH' : ''}${snap.hurt ? '  HURT' : ''}`,
      hp ? `hp ${'#'.repeat(hp.current)}${'·'.repeat(hp.max - hp.current)}  (${hp.current}/${hp.max})` : '',
      ``,
      `move: ←→/A,D  jump: space/W  dash: shift  attack: J  crouch: ↓/S  F3: debug`,
    ].filter((l) => l !== null);
    this.text.setText(lines);
  }
}

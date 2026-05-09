import Phaser from 'phaser';
import { VIEW } from '../core/constants';
import { InputController } from '../core/input';
import { Player } from '../entities/Player';
import { buildTestRoom } from '../levels/TestRoom';
import { DebugOverlay } from '../ui/DebugOverlay';

export class GameScene extends Phaser.Scene {
  private controls!: InputController;
  private player!: Player;
  private debugOverlay!: DebugOverlay;
  private debugLastToggleAt = -Infinity;

  constructor() {
    super('GameScene');
  }

  create(): void {
    this.physics.world.setBounds(0, 0, VIEW.width, VIEW.height);

    this.controls = new InputController(this);

    const room = buildTestRoom(this);

    this.player = new Player(this, room.spawnX, room.spawnY, this.controls);
    this.physics.add.collider(this.player.sprite, room.staticGroup);

    this.cameras.main.setBounds(0, 0, room.width, room.height);
    this.cameras.main.startFollow(this.player.sprite, true, 0.15, 0.15);
    this.cameras.main.setDeadzone(120, 80);

    this.debugOverlay = new DebugOverlay(this);

    this.add.text(120, 24, 'Lionn: Night Prowler — week 1 movement greybox', {
      fontFamily: 'Menlo, monospace',
      fontSize: '12px',
      color: '#7a6da0',
    }).setScrollFactor(0);
  }

  override update(timeMs: number, dtMs: number): void {
    const dtSec = dtMs / 1000;
    this.controls.update(timeMs);

    if (this.controls.held('debugToggle') && timeMs - this.debugLastToggleAt > 250) {
      this.debugOverlay.toggle();
      this.debugLastToggleAt = timeMs;
    }

    this.player.update(timeMs, dtSec);
    this.debugOverlay.update(this.player.movement.snapshot(timeMs), this.game.loop.actualFps);
  }
}

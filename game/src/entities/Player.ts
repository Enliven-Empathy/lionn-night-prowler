import Phaser from 'phaser';
import { PLAYER, COLORS } from '../core/constants';
import { InputController } from '../core/input';
import { MovementSnapshot, PlayerMovement } from '../movement/PlayerMovement';

export class Player {
  readonly sprite: Phaser.GameObjects.Rectangle;
  readonly body: Phaser.Physics.Arcade.Body;
  readonly movement: PlayerMovement;

  private trail: Phaser.GameObjects.Rectangle[] = [];
  private trailEmitTimer = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, input: InputController) {
    this.sprite = scene.add.rectangle(x, y, PLAYER.width, PLAYER.height, COLORS.player);
    scene.physics.add.existing(this.sprite);
    this.body = this.sprite.body as Phaser.Physics.Arcade.Body;
    this.body.setCollideWorldBounds(true);
    this.body.setDragX(0);
    this.body.setSize(PLAYER.width, PLAYER.height);

    this.movement = new PlayerMovement(this.body, input);
  }

  update(timeMs: number, dtSec: number): void {
    this.movement.update(timeMs, dtSec);
    const snap = this.movement.snapshot(timeMs);

    this.sprite.fillColor = snap.dashing ? COLORS.playerDash : COLORS.player;

    if (snap.dashing) {
      this.trailEmitTimer += dtSec * 1000;
      if (this.trailEmitTimer > 24) {
        this.emitTrail(snap);
        this.trailEmitTimer = 0;
      }
    }

    this.fadeTrail(dtSec);
  }

  private emitTrail(snap: MovementSnapshot): void {
    const scene = this.sprite.scene;
    const r = scene.add.rectangle(this.sprite.x, this.sprite.y, PLAYER.width, PLAYER.height, COLORS.playerDash, 0.55);
    r.setDepth(this.sprite.depth - 1);
    this.trail.push(r);
    void snap;
  }

  private fadeTrail(dtSec: number): void {
    for (let i = this.trail.length - 1; i >= 0; i--) {
      const r = this.trail[i];
      r.alpha -= dtSec * 4.5;
      if (r.alpha <= 0) {
        r.destroy();
        this.trail.splice(i, 1);
      }
    }
  }
}

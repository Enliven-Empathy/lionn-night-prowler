import Phaser from 'phaser';
import { VIEW } from '../core/constants';
import { InputController } from '../core/input';
import { Player } from '../entities/Player';
import { Patrol } from '../entities/Patrol';
import { EndlessLevel, EndlessLevelHandle } from '../levels/EndlessLevel';
import { DebugOverlay } from '../ui/DebugOverlay';
import { GamepadDebug } from '../ui/GamepadDebug';
import { GameOverOverlay } from '../ui/GameOverOverlay';
import { DamageSystem } from '../combat/DamageSystem';
import { HitFx } from '../fx/HitFx';

const WORLD_WIDTH = 1_000_000;
const WORLD_HEIGHT = VIEW.height + 600;

export class GameScene extends Phaser.Scene {
  private controls!: InputController;
  private player!: Player;
  private patrols: Patrol[] = [];
  private staticGroupRef!: Phaser.Physics.Arcade.StaticGroup;
  private level!: EndlessLevelHandle;
  private debugOverlay!: DebugOverlay;
  private gamepadDebug!: GamepadDebug;
  private endOverlay!: GameOverOverlay;
  private debugLastToggleAt = -Infinity;
  private debugHitboxes = false;
  private damage!: DamageSystem;
  private fx!: HitFx;
  private deathY = 820;
  private ended = false;

  private distanceText!: Phaser.GameObjects.Text;
  private bestDistance = 0;
  private bestDistanceText!: Phaser.GameObjects.Text;

  constructor() {
    super('GameScene');
  }

  init(): void {
    // Carry across restarts via the registry (Phaser's persistent kv store).
    this.bestDistance = this.game.registry.get('bestDistance') ?? 0;
  }

  create(): void {
    this.ended = false;
    this.debugLastToggleAt = -Infinity;
    this.debugHitboxes = false;
    this.patrols = [];

    this.physics.world.setBounds(0, -300, WORLD_WIDTH, WORLD_HEIGHT + 300);
    this.physics.world.setBoundsCollision(true, true, true, false);

    this.controls = new InputController(this);
    this.damage = new DamageSystem();
    this.fx = new HitFx(this);
    this.endOverlay = new GameOverOverlay(this);

    this.level = new EndlessLevel(this).build();
    this.staticGroupRef = this.level.staticGroup;

    this.player = new Player(this, this.level.spawnX, this.level.spawnY, this.controls, this.damage, this.fx);
    this.physics.add.collider(this.player.sprite, this.level.staticGroup);

    // Drain initial enemy spawns now that the static group + collider system is ready.
    this.drainEnemySpawns();

    this.cameras.main.setBounds(0, -300, WORLD_WIDTH, WORLD_HEIGHT + 300);
    this.cameras.main.startFollow(this.player.sprite, true, 0.15, 0.15);
    this.cameras.main.setDeadzone(160, 80);

    this.debugOverlay = new DebugOverlay(this);
    this.gamepadDebug = new GamepadDebug(this);

    this.add.text(120, 24, 'Lionn: Night Prowler — endless courtyard  ·  Cross/Space jump x2  ·  Square/J attack  ·  R1/Shift dash  ·  G gamepad-debug', {
      fontFamily: 'Menlo, monospace',
      fontSize: '12px',
      color: '#7a6da0',
    }).setScrollFactor(0);

    this.distanceText = this.add.text(VIEW.width / 2, 18, '0 m', {
      fontFamily: 'Cinzel, Georgia, serif',
      fontSize: '32px',
      color: '#d4af37',
      stroke: '#0b0816',
      strokeThickness: 4,
    });
    this.distanceText.setOrigin(0.5, 0).setScrollFactor(0).setDepth(1100);

    this.bestDistanceText = this.add.text(VIEW.width / 2, 56, this.formatBest(), {
      fontFamily: 'Cinzel, Georgia, serif',
      fontSize: '14px',
      color: '#9b59ff',
      stroke: '#0b0816',
      strokeThickness: 3,
    });
    this.bestDistanceText.setOrigin(0.5, 0).setScrollFactor(0).setDepth(1100);

    this.input.keyboard?.on('keydown-H', () => {
      this.debugHitboxes = !this.debugHitboxes;
      this.player.setDebugHitboxes(this.debugHitboxes);
    });
    this.input.keyboard?.on('keydown-G', () => {
      this.gamepadDebug.toggle();
    });

    window.addEventListener('gamepadconnected', (e) => {
      // eslint-disable-next-line no-console
      console.log('[gamepad] connected:', (e as GamepadEvent).gamepad.id);
    });
  }

  override update(timeMs: number, dtMs: number): void {
    const dtSec = dtMs / 1000;
    this.controls.update(timeMs);

    if (this.controls.held('debugToggle') && timeMs - this.debugLastToggleAt > 250) {
      this.debugOverlay.toggle();
      this.debugLastToggleAt = timeMs;
    }

    if (!this.ended) {
      this.player.update(timeMs, dtSec, this.controls);
      this.fx.update(timeMs);

      // Lazy-generate the next chunks ahead of the player, then materialize any
      // enemy spawn requests those chunks emitted.
      this.level.ensureGenerated(this.player.sprite.x);
      this.drainEnemySpawns();

      // Tick patrols. They need the player's position to chase/attack.
      const target = {
        x: this.player.sprite.x,
        y: this.player.sprite.y,
        alive: !this.player.isDead(),
      };
      for (const p of this.patrols) p.update(timeMs, dtSec, target);

      // Cull patrols that fell off the world (into a pit) or that are far behind.
      this.cullPatrols();

      // Pit death.
      if (this.player.sprite.y > this.deathY && !this.player.isDead()) {
        this.player.kill();
      }
      if (this.player.isDead()) {
        this.endRun('gameOver');
      }

      const dist = this.level.distance(this.player.sprite.x);
      this.distanceText.setText(`${(dist / 100).toFixed(1)} m`);
    } else if (this.controls.justPressed('restart', 32)) {
      // PS Start / keyboard R routes here once the run has ended. Space + R + click
      // also work via GameOverOverlay's own listeners; this branch covers the
      // gamepad path that the overlay can't see.
      this.controls.consumePress('restart');
      this.scene.restart();
    }

    this.debugOverlay.update(
      this.player.getMovementSnapshot(timeMs),
      this.game.loop.actualFps,
      this.player.hpInfo(),
    );
    this.gamepadDebug.update();
  }

  private endRun(kind: 'gameOver' | 'win'): void {
    if (this.ended) return;
    this.ended = true;
    const dist = this.level.distance(this.player.sprite.x);
    if (dist > this.bestDistance) {
      this.bestDistance = dist;
      this.game.registry.set('bestDistance', dist);
      this.bestDistanceText.setText(this.formatBest());
    }
    this.cameras.main.flash(180, 255, 60, 90, false);
    this.time.delayedCall(420, () => {
      this.endOverlay.show(kind, () => this.scene.restart());
    });
  }

  private formatBest(): string {
    return `best  ${(this.bestDistance / 100).toFixed(1)} m`;
  }

  private drainEnemySpawns(): void {
    for (const s of this.level.drainEnemySpawns()) {
      const p = new Patrol(this, s.x, s.y, s.xMin, s.xMax, this.damage, this.fx);
      this.physics.add.collider(p.sprite, this.staticGroupRef);
      this.patrols.push(p);
    }
  }

  private cullPatrols(): void {
    const cullX = this.player.sprite.x - 1500;
    for (let i = this.patrols.length - 1; i >= 0; i--) {
      const p = this.patrols[i];
      const fellOff = p.sprite.y > this.deathY + 600;
      const farBehind = p.sprite.x < cullX;
      if (fellOff || farBehind) {
        p.destroy();
        this.patrols.splice(i, 1);
      }
    }
  }
}

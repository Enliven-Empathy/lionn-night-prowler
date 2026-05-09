import Phaser from 'phaser';
import { VIEW } from '../core/constants';
import { InputController } from '../core/input';
import { Player } from '../entities/Player';
import { Patrol } from '../entities/Patrol';
import { Collectible } from '../entities/Collectible';
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
  private collectibles: Collectible[] = [];
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

  private score = 0;
  private bestScore = 0;
  private scoreText!: Phaser.GameObjects.Text;
  private bestScoreText!: Phaser.GameObjects.Text;

  constructor() {
    super('GameScene');
  }

  init(): void {
    // Carry across restarts via the registry (Phaser's persistent kv store).
    this.bestDistance = this.game.registry.get('bestDistance') ?? 0;
    this.bestScore = this.game.registry.get('bestScore') ?? 0;
  }

  create(): void {
    this.ended = false;
    this.debugLastToggleAt = -Infinity;
    this.debugHitboxes = false;
    this.patrols = [];
    this.collectibles = [];
    this.score = 0;

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

    this.bestDistanceText = this.add.text(VIEW.width / 2, 56, this.formatBestDistance(), {
      fontFamily: 'Cinzel, Georgia, serif',
      fontSize: '14px',
      color: '#9b59ff',
      stroke: '#0b0816',
      strokeThickness: 3,
    });
    this.bestDistanceText.setOrigin(0.5, 0).setScrollFactor(0).setDepth(1100);

    this.scoreText = this.add.text(VIEW.width - 24, 18, '★ 0', {
      fontFamily: 'Cinzel, Georgia, serif',
      fontSize: '28px',
      color: '#ffe999',
      stroke: '#0b0816',
      strokeThickness: 4,
    });
    this.scoreText.setOrigin(1, 0).setScrollFactor(0).setDepth(1100);

    this.bestScoreText = this.add.text(VIEW.width - 24, 52, this.formatBestScore(), {
      fontFamily: 'Cinzel, Georgia, serif',
      fontSize: '14px',
      color: '#9b59ff',
      stroke: '#0b0816',
      strokeThickness: 3,
    });
    this.bestScoreText.setOrigin(1, 0).setScrollFactor(0).setDepth(1100);

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
      // enemy and collectible spawn requests those chunks emitted.
      this.level.ensureGenerated(this.player.sprite.x);
      this.drainEnemySpawns();
      this.drainCollectibleSpawns();

      // Tick patrols. They need the player's position to chase/attack.
      const target = {
        x: this.player.sprite.x,
        y: this.player.sprite.y,
        alive: !this.player.isDead(),
      };
      for (const p of this.patrols) p.update(timeMs, dtSec, target);

      // Tick collectibles (bob/pulse) + check pickup overlap with player.
      const playerHurt = this.player.hurtbox();
      for (const c of this.collectibles) {
        c.update(timeMs);
        if (!c.collected && Phaser.Geom.Intersects.RectangleToRectangle(playerHurt, c.hitRect())) {
          this.collectPickup(c);
        }
      }

      // Cull patrols + collectibles that fell off the world or are far behind.
      this.cullPatrols();
      this.cullCollectibles();

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
      this.bestDistanceText.setText(this.formatBestDistance());
    }
    if (this.score > this.bestScore) {
      this.bestScore = this.score;
      this.game.registry.set('bestScore', this.score);
      this.bestScoreText.setText(this.formatBestScore());
    }
    this.cameras.main.flash(180, 255, 60, 90, false);
    this.time.delayedCall(420, () => {
      this.endOverlay.show(kind, () => this.scene.restart());
    });
  }

  private formatBestDistance(): string {
    return `best  ${(this.bestDistance / 100).toFixed(1)} m`;
  }

  private formatBestScore(): string {
    return `best  ★ ${this.bestScore}`;
  }

  private drainEnemySpawns(): void {
    for (const s of this.level.drainEnemySpawns()) {
      const p = new Patrol(this, s.x, s.y, s.xMin, s.xMax, this.damage, this.fx);
      this.physics.add.collider(p.sprite, this.staticGroupRef);
      this.patrols.push(p);
    }
  }

  private drainCollectibleSpawns(): void {
    for (const s of this.level.drainCollectibleSpawns()) {
      this.collectibles.push(new Collectible(this, s.x, s.y, s.tier));
    }
  }

  private collectPickup(c: Collectible): void {
    c.collect();
    this.score += c.value;
    this.scoreText.setText(`★ ${this.score}`);

    // Brief score punch.
    this.scoreText.setScale(1.25);
    this.tweens.add({
      targets: this.scoreText,
      scale: 1,
      duration: 220,
      ease: 'Back.easeOut',
    });

    // Floating "+N" popup at the pickup point.
    const popup = this.add.text(c.container.x, c.container.y - 8, `+${c.value}`, {
      fontFamily: 'Cinzel, Georgia, serif',
      fontSize: c.tier === 3 ? '28px' : c.tier === 2 ? '22px' : '18px',
      color: c.tier === 3 ? '#9be8ff' : c.tier === 2 ? '#d4baff' : '#ffe999',
      stroke: '#0b0816',
      strokeThickness: 4,
    });
    popup.setOrigin(0.5, 0.5).setDepth(1200);
    this.tweens.add({
      targets: popup,
      y: popup.y - 36,
      alpha: 0,
      duration: 700,
      ease: 'Quad.easeOut',
      onComplete: () => popup.destroy(),
    });
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

  private cullCollectibles(): void {
    const cullX = this.player.sprite.x - 1500;
    for (let i = this.collectibles.length - 1; i >= 0; i--) {
      const c = this.collectibles[i];
      if (c.collected || c.container.x < cullX) {
        if (!c.collected) c.destroy();
        this.collectibles.splice(i, 1);
      }
    }
  }
}

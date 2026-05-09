import Phaser from 'phaser';
import { VIEW } from '../core/constants';
import { InputController } from '../core/input';
import { Player } from '../entities/Player';
import { Patrol } from '../entities/Patrol';
import { Collectible } from '../entities/Collectible';
import { Heart } from '../entities/Heart';
import { EndlessLevel, EndlessLevelHandle } from '../levels/EndlessLevel';
import { DebugOverlay } from '../ui/DebugOverlay';
import { GamepadDebug } from '../ui/GamepadDebug';
import { GameOverOverlay } from '../ui/GameOverOverlay';
import { HealthBar } from '../ui/HealthBar';
import { DamageSystem } from '../combat/DamageSystem';
import { HitFx } from '../fx/HitFx';
import { AudioManager } from '../audio/AudioManager';
import { SFX, attackHitSfx } from '../audio/Sfx';

const WORLD_WIDTH = 1_000_000;
const WORLD_HEIGHT = VIEW.height + 600;

export class GameScene extends Phaser.Scene {
  private controls!: InputController;
  private player!: Player;
  private patrols: Patrol[] = [];
  private collectibles: Collectible[] = [];
  private hearts: Heart[] = [];
  private staticGroupRef!: Phaser.Physics.Arcade.StaticGroup;
  private level!: EndlessLevelHandle;
  private debugOverlay!: DebugOverlay;
  private gamepadDebug!: GamepadDebug;
  private endOverlay!: GameOverOverlay;
  private hpBar!: HealthBar;
  private debugLastToggleAt = -Infinity;
  private debugHitboxes = false;
  private damage!: DamageSystem;
  private fx!: HitFx;
  private audio!: AudioManager;
  // Pit-kill threshold. Lower = faster death (less time for floating platforms
  // to "save" the player and create the impression that death is inconsistent).
  private deathY = 760;
  // Hard safety floor. If for any reason deathY didn't trigger (entity update
  // exception, race, etc.), this catches the player guaranteed.
  private hardFloorY = 1500;
  private ended = false;
  /** Wall-clock timestamp (Date.now()) at which the run ended. Used for
   *  auto-restart elapsed-time checks. Wall-clock is more reliable than
   *  scene/game time — Phaser's loop throttles when the tab is backgrounded
   *  or the canvas loses focus, but Date.now() always advances. */
  private endedAtWall = -Infinity;
  private autoRestartFired = false;
  /** Browser-level setTimeout fallback. Fires even if the rAF loop is
   *  paused/throttled; cleared on manual restart or scene shutdown. */
  private autoRestartTimerId: number | null = null;
  private restartWasHeld = false;
  private restartArmedAt = 0;

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
    this.hearts = [];
    this.score = 0;
    this.endedAtWall = -Infinity;
    this.autoRestartFired = false;
    if (this.autoRestartTimerId !== null) {
      window.clearTimeout(this.autoRestartTimerId);
      this.autoRestartTimerId = null;
    }
    this.restartWasHeld = true; // armed-suppressed: ignore button still held from previous run
    this.restartArmedAt = 0;

    this.physics.world.setBounds(0, -300, WORLD_WIDTH, WORLD_HEIGHT + 300);
    this.physics.world.setBoundsCollision(true, true, true, false);

    this.controls = new InputController(this);
    this.damage = new DamageSystem();
    this.fx = new HitFx(this);
    this.audio = new AudioManager(this);
    this.endOverlay = new GameOverOverlay(this);

    // Combat hits: light/heavy variant chosen by attack name. Only player
    // hits play this — enemy hits already trigger player_hurt via Player.takeDamage.
    this.damage.onHit((event) => {
      if (event.team !== 'player') return;
      this.audio.play(attackHitSfx(event.attackName));
    });

    this.level = new EndlessLevel(this).build();
    this.staticGroupRef = this.level.staticGroup;

    this.player = new Player(this, this.level.spawnX, this.level.spawnY, this.controls, this.damage, this.fx, this.audio);
    this.physics.add.collider(this.player.sprite, this.level.staticGroup);

    // Drain initial enemy spawns now that the static group + collider system is ready.
    this.drainEnemySpawns();

    // Kick off ambient music (auto-resumes after first user input if browser
    // had the audio context locked).
    this.audio.startMusic(SFX.MUSIC_COURTYARD, 0.28);

    this.cameras.main.setBounds(0, -300, WORLD_WIDTH, WORLD_HEIGHT + 300);
    this.cameras.main.startFollow(this.player.sprite, true, 0.15, 0.15);
    this.cameras.main.setDeadzone(160, 80);

    this.debugOverlay = new DebugOverlay(this);
    this.gamepadDebug = new GamepadDebug(this);
    this.hpBar = new HealthBar(this, 24, 96);
    this.hpBar.set(this.player.hp, this.player.maxHp);

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

    // Clear pending auto-restart timer when the scene shuts down so it
    // doesn't fire against a destroyed scene.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.autoRestartTimerId !== null) {
        window.clearTimeout(this.autoRestartTimerId);
        this.autoRestartTimerId = null;
      }
    });
  }

  override update(timeMs: number, dtMs: number): void {
    const dtSec = dtMs / 1000;
    this.controls.update(timeMs);

    if (this.controls.held('debugToggle') && timeMs - this.debugLastToggleAt > 250) {
      this.debugOverlay.toggle();
      this.debugLastToggleAt = timeMs;
    }

    // FX update ALWAYS runs — even after ended — so a hit-pause that froze
    // physics.world.timeScale can release on schedule. If we left it in the
    // !ended branch, a player who died WHILE in hit-pause would have physics
    // permanently frozen at timeScale=50: the body wouldn't keep falling,
    // the kill check (which compares sprite.y to deathY each frame on the
    // PRE-update value) would never trip again, and the game-over overlay's
    // scene-time delayedCall would also stall. Result: player appears stuck
    // mid-air with no death screen until auto-restart fires 3.5s later.
    this.fx.update(timeMs);

    if (!this.ended) {
      // ─── Death detection runs FIRST so nothing downstream can swallow it ───
      // Use BOTH sprite.y and body.y — they should be in sync but if anything
      // ever desyncs (origin offset, body offset), we want both checked.
      const playerY = Math.max(this.player.sprite.y, this.player.body.y + this.player.body.height / 2);

      if (playerY > this.hardFloorY && !this.player.isDead()) {
        // eslint-disable-next-line no-console
        console.log(`[GameScene] hard-floor kill at y=${playerY.toFixed(0)}`);
        this.player.kill();
      }
      // Pit kill: the normal "you fell off into nothing" trigger.
      if (playerY > this.deathY && !this.player.isDead()) {
        // eslint-disable-next-line no-console
        console.log(`[GameScene] pit kill at y=${playerY.toFixed(0)} (deathY=${this.deathY})`);
        this.player.kill();
      }
      if (this.player.isDead()) {
        this.endRun('gameOver');
        return; // bail; this frame's other entity updates aren't needed
      }

      // ─── Normal play ─────────────────────────────────────────────
      this.player.update(timeMs, dtSec, this.controls);

      // Lazy-generate the next chunks ahead of the player, then materialize any
      // enemy / collectible / heart spawn requests those chunks emitted.
      this.level.ensureGenerated(this.player.sprite.x);
      this.drainEnemySpawns();
      this.drainCollectibleSpawns();
      this.drainHeartSpawns();

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

      // Tick hearts + check pickup overlap. Hearts restore HP (capped at max).
      for (const h of this.hearts) {
        h.update(timeMs);
        if (!h.collected && Phaser.Geom.Intersects.RectangleToRectangle(playerHurt, h.hitRect())) {
          this.collectHeart(h);
        }
      }

      // Cull patrols / collectibles / hearts that fell off the world or are far behind.
      this.cullPatrols();
      this.cullCollectibles();
      this.cullHearts();

      const dist = this.level.distance(this.player.sprite.x);
      this.distanceText.setText(`${(dist / 100).toFixed(1)} m`);
      this.hpBar.set(this.player.hp, this.player.maxHp);
    } else {
      // ─── Game-over state ────────────────────────────────────────
      // Restart detection on the *rising edge* of held — gamepad-friendly.
      // Skips the first ~250ms so the death-input button doesn't insta-restart.
      const heldNow = this.controls.held('restart');
      if (this.restartArmedAt === 0) this.restartArmedAt = timeMs + 250;
      const armed = timeMs >= this.restartArmedAt;
      if (armed && heldNow && !this.restartWasHeld) {
        if (this.autoRestartTimerId !== null) {
          window.clearTimeout(this.autoRestartTimerId);
          this.autoRestartTimerId = null;
        }
        this.audio.play(SFX.UI_RESTART);
        this.scene.restart();
        return;
      }
      this.restartWasHeld = heldNow;

      // Frame-based auto-restart using WALL-CLOCK (Date.now), not scene time.
      // Phaser's scene/game clock can pause when the tab is backgrounded or
      // canvas loses focus — using wall-clock means this check always reflects
      // real elapsed time. The window.setTimeout in endRun() is the primary
      // mechanism; this is belt-and-suspenders for when both fire on the same
      // frame.
      if (!this.autoRestartFired && Date.now() - this.endedAtWall > 3500) {
        // eslint-disable-next-line no-console
        console.log(`[GameScene] auto-restart firing (frame check, elapsed ${Date.now() - this.endedAtWall}ms)`);
        this.autoRestartFired = true;
        this.audio.play(SFX.UI_RESTART);
        this.scene.restart();
        return;
      }
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
    this.endedAtWall = Date.now();
    // eslint-disable-next-line no-console
    console.log(`[GameScene] endRun (${kind}) at wall=${this.endedAtWall}; auto-restart in 3500ms`);

    // Force-restore physics timeScale in case a hit pause was still active
    // when we transitioned. Otherwise the death scene plays out in slow-mo
    // and the game-over flash/overlay don't read clearly.
    this.physics.world.timeScale = 1;

    // Schedule auto-restart via window.setTimeout. Fires from the browser's
    // main event loop, independent of Phaser's rAF / scene-time clocks. This
    // is what catches the "tab is backgrounded" / "game loop throttled" cases
    // where the frame-based elapsed-time check in update() can't fire fast
    // enough because update() itself isn't running.
    this.autoRestartTimerId = window.setTimeout(() => {
      if (!this.autoRestartFired && this.ended) {
        // eslint-disable-next-line no-console
        console.log('[GameScene] auto-restart firing (window.setTimeout fallback)');
        this.autoRestartFired = true;
        this.audio.play(SFX.UI_RESTART);
        this.scene.restart();
      }
    }, 3500);

    const dist = this.level.distance(this.player.sprite.x);
    if (dist > this.bestDistance) {
      this.bestDistance = dist;
      this.game.registry.set('bestDistance', dist);
      this.bestDistanceText.setText(this.formatBestDistance());
    }
    let beatBest = false;
    if (this.score > this.bestScore) {
      this.bestScore = this.score;
      this.game.registry.set('bestScore', this.score);
      this.bestScoreText.setText(this.formatBestScore());
      beatBest = true;
    }
    this.audio.stopMusic();
    this.audio.play(kind === 'gameOver' ? SFX.UI_GAME_OVER : SFX.UI_BEST_SCORE);
    if (beatBest && kind === 'gameOver') {
      // Layer the celebratory cue over the loss tone.
      this.time.delayedCall(700, () => this.audio.play(SFX.UI_BEST_SCORE));
    }
    this.cameras.main.flash(180, 255, 60, 90, false);
    // Reflect death in the HP bar IMMEDIATELY — the bar sits in the
    // !ended branch of update() so without this it'd freeze at the last
    // pre-death value (was confusing players: bar still green while
    // they're already dead).
    this.hpBar.set(this.player.hp, this.player.maxHp);

    // Show the overlay SYNCHRONOUSLY. We used to delay 420ms to let the
    // camera flash play first, but any delay is a window where the player
    // sees a "stuck mid-air with no death screen" state and reasonably
    // assumes the game is broken. Better: overlay appears with the flash.
    this.showEndOverlay(kind);

    // Belt-and-suspenders: if for any reason the overlay didn't actually
    // render (scene-state weirdness, error swallowed somewhere), retry at
    // 1500ms and 2800ms. Idempotent — show() short-circuits if already
    // visible.
    window.setTimeout(() => this.showEndOverlay(kind), 1500);
    window.setTimeout(() => this.showEndOverlay(kind), 2800);
    // Auto-restart at 3500ms is scheduled above + frame-checked in update().
  }

  private showEndOverlay(kind: 'gameOver' | 'win'): void {
    if (!this.ended || this.autoRestartFired) return;
    if (this.endOverlay.visible) return;
    // eslint-disable-next-line no-console
    console.log('[GameScene] showEndOverlay firing');
    this.endOverlay.show(kind, () => {
      if (this.autoRestartTimerId !== null) {
        window.clearTimeout(this.autoRestartTimerId);
        this.autoRestartTimerId = null;
      }
      this.audio.play(SFX.UI_RESTART);
      this.scene.restart();
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
      const p = new Patrol(this, s.x, s.y, s.xMin, s.xMax, this.damage, this.fx, this.audio);
      this.physics.add.collider(p.sprite, this.staticGroupRef);
      this.patrols.push(p);
    }
  }

  private drainCollectibleSpawns(): void {
    for (const s of this.level.drainCollectibleSpawns()) {
      this.collectibles.push(new Collectible(this, s.x, s.y, s.tier));
    }
  }

  private drainHeartSpawns(): void {
    for (const s of this.level.drainHeartSpawns()) {
      this.hearts.push(new Heart(this, s.x, s.y, 2));
    }
  }

  private collectHeart(h: Heart): void {
    h.collect();
    const before = this.player.hp;
    const after = Math.min(this.player.maxHp, before + h.healAmount);
    const actualHeal = after - before;
    this.player.hp = after;

    // Even if the player was already at max HP we still play the chime so
    // grabbing a heart never feels like nothing happened — but the popup
    // says "FULL" instead of a number.
    this.audio.play(SFX.PICKUP_CRYSTAL);

    const popup = this.add.text(
      h.container.x,
      h.container.y - 8,
      actualHeal > 0 ? `+${actualHeal} HP` : 'FULL',
      {
        fontFamily: 'Cinzel, Georgia, serif',
        fontSize: '22px',
        color: '#ffb8cc',
        stroke: '#0b0816',
        strokeThickness: 4,
      },
    );
    popup.setOrigin(0.5, 0.5).setDepth(1200);
    this.tweens.add({
      targets: popup,
      y: popup.y - 36,
      alpha: 0,
      duration: 700,
      ease: 'Quad.easeOut',
      onComplete: () => popup.destroy(),
    });

    // Brief HP-bar bump so the heal reads in the HUD too.
    this.hpBar.set(this.player.hp, this.player.maxHp);
  }

  private collectPickup(c: Collectible): void {
    c.collect();
    this.score += c.value;
    this.scoreText.setText(`★ ${this.score}`);
    const pickupSfx =
      c.tier === 3 ? SFX.PICKUP_CRYSTAL :
      c.tier === 2 ? SFX.PICKUP_GEM :
      SFX.PICKUP_COIN;
    this.audio.play(pickupSfx);

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

  private cullHearts(): void {
    const cullX = this.player.sprite.x - 1500;
    for (let i = this.hearts.length - 1; i >= 0; i--) {
      const h = this.hearts[i];
      if (h.collected || h.container.x < cullX) {
        if (!h.collected) h.destroy();
        this.hearts.splice(i, 1);
      }
    }
  }
}

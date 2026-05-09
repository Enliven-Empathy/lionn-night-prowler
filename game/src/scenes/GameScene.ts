import Phaser from 'phaser';
import { VIEW } from '../core/constants';
import { InputController } from '../core/input';
import { Player } from '../entities/Player';
import { Patrol } from '../entities/Patrol';
import { Collectible } from '../entities/Collectible';
import { Heart } from '../entities/Heart';
import { Spikes } from '../entities/Spikes';
import { Overhang } from '../entities/Overhang';
import { EndlessLevel, EndlessLevelHandle } from '../levels/EndlessLevel';
import { OVERHANG, SPIKES } from '../core/constants';
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
  private spikes: Spikes[] = [];
  private overhangs: Overhang[] = [];
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
  /** Nuclear-option page-reload timer. Fires at 9.5 s post-death IFF the
   *  scene is still in the ended state — independent of autoRestartFired,
   *  since the whole purpose of the nuclear option is to recover when an
   *  earlier restart claimed success but the scene-manager actually stalled. */
  private nuclearReloadTimerId: number | null = null;
  private restartWasHeld = false;
  private restartArmedAt = 0;

  // Grab/throw state
  private grabbedEnemy: Patrol | null = null;
  private grabbedAtMs = 0;
  /** Snapshot of which directions were already held at the moment of grab.
   *  Used so a continuously-held direction (e.g. you pressed Circle while
   *  walking right) doesn't immediately count as a throw — the player has
   *  to release and re-press to throw in that direction. */
  private grabPressedDirs = { left: false, right: false, up: false };

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
    this.spikes = [];
    this.overhangs = [];
    this.grabbedEnemy = null;
    this.grabbedAtMs = 0;
    this.grabPressedDirs = { left: false, right: false, up: false };
    this.score = 0;
    this.endedAtWall = -Infinity;
    this.autoRestartFired = false;
    if (this.autoRestartTimerId !== null) {
      window.clearTimeout(this.autoRestartTimerId);
      this.autoRestartTimerId = null;
    }
    if (this.nuclearReloadTimerId !== null) {
      window.clearTimeout(this.nuclearReloadTimerId);
      this.nuclearReloadTimerId = null;
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

    // Controls hint — appears on spawn, fades out after 6s. Doesn't pollute
    // the screen the rest of the run. Re-shown each scene.restart so the
    // kid can re-read the bindings if they forget.
    const controlsHint = this.add.text(
      VIEW.width / 2,
      VIEW.height - 32,
      'MOVE ←→ · JUMP Cross/SPACE (×2) · CROUCH ↓/S · ATTACK □/J · DASH R1/SHIFT · GRAB ○/K + ←→↑ to throw',
      {
        fontFamily: 'Cinzel, Georgia, serif',
        fontSize: '14px',
        color: '#c4b8e8',
        stroke: '#0b0816',
        strokeThickness: 3,
        align: 'center',
      },
    );
    controlsHint.setOrigin(0.5, 1).setScrollFactor(0).setDepth(1100).setAlpha(0);
    this.tweens.add({ targets: controlsHint, alpha: 1, duration: 350, delay: 200 });
    this.tweens.add({ targets: controlsHint, alpha: 0, duration: 700, delay: 5800 });

    // Tiny corner hint so users can find the dev toggles if they want them.
    this.add.text(
      VIEW.width - 8,
      VIEW.height - 6,
      'F3 debug · G gamepad · H hitboxes',
      {
        fontFamily: 'Menlo, monospace',
        fontSize: '10px',
        color: '#5a4a78',
      },
    ).setOrigin(1, 1).setScrollFactor(0).setDepth(1100).setAlpha(0.55);

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

    // Window-level event listeners — kept on instance so SHUTDOWN can
    // remove them. Without that, every scene.restart() leaks a new copy
    // and the listener stack can interact badly with Phaser plugin shutdown.
    const onGamepadConnected = (e: Event) => {
      // eslint-disable-next-line no-console
      console.log('[gamepad] connected:', (e as GamepadEvent).gamepad.id);
    };
    window.addEventListener('gamepadconnected', onGamepadConnected);

    // Last-line-of-defense: if any uncaught error fires while we're in
    // the ended state, the most likely cause is a Phaser plugin shutdown
    // throwing during scene teardown. Schedule an immediate page reload —
    // we know the scene-manager is corrupted and can't restart cleanly.
    const onWindowError = (event: ErrorEvent) => {
      if (!this.ended) return;
      // eslint-disable-next-line no-console
      console.warn('[GameScene] window error during ended state, reloading page:', event.message);
      try { window.location.reload(); } catch { /* nothing left */ }
    };
    window.addEventListener('error', onWindowError);

    // Clear ALL pending timers + window listeners on scene shutdown so
    // they don't fire against a destroyed scene (or, in the nuclear
    // timer's case, blow up the next scene with a spurious page reload).
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.autoRestartTimerId !== null) {
        window.clearTimeout(this.autoRestartTimerId);
        this.autoRestartTimerId = null;
      }
      if (this.nuclearReloadTimerId !== null) {
        window.clearTimeout(this.nuclearReloadTimerId);
        this.nuclearReloadTimerId = null;
      }
      window.removeEventListener('gamepadconnected', onGamepadConnected);
      window.removeEventListener('error', onWindowError);
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
      // enemy / collectible / heart / spike spawn requests those chunks emitted.
      this.level.ensureGenerated(this.player.sprite.x);
      this.drainEnemySpawns();
      this.drainCollectibleSpawns();
      this.drainHeartSpawns();
      this.drainSpikeSpawns();
      this.drainOverhangSpawns();

      // Grab / throw orchestration runs BEFORE patrols update so the
      // grabbed patrol's frozen position is set this frame.
      this.handleGrabInput(timeMs);
      this.maintainGrabbedFollowing();

      // Tick patrols. They need the player's position to chase/attack.
      const target = {
        x: this.player.sprite.x,
        y: this.player.sprite.y,
        alive: !this.player.isDead(),
      };
      for (const p of this.patrols) p.update(timeMs, dtSec, target);

      // Thrown-patrol damage: any thrown patrol that overlaps another
      // patrol deals damage. Quadratic in patrol count but the count is
      // small (handful per chunk), so it's fine.
      for (const thrower of this.patrols) {
        if (!thrower.isThrown()) continue;
        for (const target of this.patrols) {
          thrower.damageIfThrownInto(target, timeMs);
        }
      }

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

      // Tick spikes + damage check. Spike phase advances by dtMs; if the
      // spike is currently dangerous AND overlaps the player or any
      // patrol, fire the appropriate damage.
      for (const s of this.spikes) {
        const dangerous = s.update(dtMs);
        if (!dangerous) continue;
        const spikeRect = s.hitRect();
        if (Phaser.Geom.Intersects.RectangleToRectangle(playerHurt, spikeRect)) {
          this.player.takeDamage({
            damage: SPIKES.damage,
            fromX: s.worldX,
            fromY: s.worldY,
            knockbackX: SPIKES.knockbackX,
            knockbackY: SPIKES.knockbackY,
            hitstopMs: SPIKES.hitstopMs,
            attackName: 'spikes',
            team: 'enemy',
          }, timeMs);
        }
        // Spikes also kill enemies — anything that overlaps an open spike
        // dies instantly. Includes thrown patrols arcing over the row,
        // patrols knocked into spikes by a throw chain, or patrols whose
        // patrol bounds happen to cross the row.
        for (const p of this.patrols) {
          if (!p.isAlive() || p.isGrabbed()) continue;
          const pBody = p.body;
          if (
            pBody.x < spikeRect.right && pBody.x + pBody.width > spikeRect.left &&
            pBody.y < spikeRect.bottom && pBody.y + pBody.height > spikeRect.top
          ) {
            p.takeDamage({
              damage: 99,
              fromX: s.worldX,
              fromY: s.worldY,
              knockbackX: 0,
              knockbackY: -60,
              hitstopMs: 80,
              attackName: 'spikes',
              team: 'player',
            }, timeMs);
          }
        }
      }

      // Overhangs: low overhead obstacles. Standing player body extends
      // up to (sprite.y - height/2). Crouched body is half-height so its
      // top sits 28 px lower. AABB overlap test naturally separates the
      // two — crouched players literally don't share Y range with the
      // overhang's hitRect.
      for (const o of this.overhangs) {
        if (Phaser.Geom.Intersects.RectangleToRectangle(playerHurt, o.hitRect())) {
          this.player.takeDamage({
            damage: OVERHANG.damage,
            fromX: o.worldX,
            fromY: o.bottomY,
            knockbackX: OVERHANG.knockbackX,
            knockbackY: OVERHANG.knockbackY,
            hitstopMs: OVERHANG.hitstopMs,
            attackName: 'overhang',
            team: 'enemy',
          }, timeMs);
        }
      }

      // Cull patrols / collectibles / hearts / spikes / overhangs that are far behind.
      this.cullPatrols();
      this.cullCollectibles();
      this.cullHearts();
      this.cullSpikes();
      this.cullOverhangs();

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
        this.performRestart('manual-button-press');
        return;
      }
      this.restartWasHeld = heldNow;

      // Frame-based auto-restart using WALL-CLOCK (Date.now). Belt-and-
      // suspenders for the window.setTimeout-based timers — fires on the
      // first frame of update() where elapsed wall-time has crossed the
      // 3500ms threshold.
      if (!this.autoRestartFired && Date.now() - this.endedAtWall > 3500) {
        this.performRestart(`frame-check@${Date.now() - this.endedAtWall}ms`);
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
    console.log(`[GameScene] endRun (${kind}) at wall=${this.endedAtWall}; arming restart timers FIRST`);

    // ───────────────────────────────────────────────────────────────
    // ARM RESTART TIMERS *FIRST*, BEFORE ANY OTHER LINE.
    //
    // window.setTimeout is the most reliable thing in the browser. If
    // anything below this block throws — a Phaser plugin shutdown
    // dropping a `removeAllListeners` on undefined, an audio-system
    // hiccup, a tween that errors, ANYTHING — these timers are still
    // armed and will eventually restart the scene OR reload the page.
    //
    // The Chrome devtools dump from a real stuck game-over showed an
    // exception thrown from Phaser's internal stopListeners chain
    // (KeyboardPlugin/GamepadPlugin) BEFORE endRun() got past its first
    // few statements, leaving the player stranded. Moving timer setup
    // to the top of the function makes that scenario recoverable.
    // ───────────────────────────────────────────────────────────────
    this.scheduleAutoRestart(3500);
    this.scheduleAutoRestart(5500);
    this.scheduleAutoRestart(7500);
    this.nuclearReloadTimerId = window.setTimeout(() => {
      if (this.ended) {
        // eslint-disable-next-line no-console
        console.warn('[GameScene] still ended at +9.5s — reloading page (nuclear)');
        try { window.location.reload(); } catch { /* truly nothing left */ }
      }
    }, 9500);
    // Single-purpose primary timer (separate from scheduleAutoRestart
    // for legibility — same effect, different log line).
    this.autoRestartTimerId = window.setTimeout(() => {
      if (this.ended && !this.autoRestartFired) this.performRestart('setTimeout-fallback@3500ms');
    }, 3500);

    // ───────────────────────────────────────────────────────────────
    // Everything below MAY throw. Wrap in try/catch so a sub-system
    // crash can't disarm the timers we just scheduled.
    // ───────────────────────────────────────────────────────────────
    try {
      // Force-restore physics timeScale in case a hit pause was still active.
      this.physics.world.timeScale = 1;

      // Stat bookkeeping.
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

      try { this.audio.stopMusic(); } catch (e) { console.warn('[GameScene] audio.stopMusic threw:', e); }
      try { this.audio.play(kind === 'gameOver' ? SFX.UI_GAME_OVER : SFX.UI_BEST_SCORE); } catch (e) { console.warn(e); }
      if (beatBest && kind === 'gameOver') {
        try { this.time.delayedCall(700, () => { try { this.audio.play(SFX.UI_BEST_SCORE); } catch {} }); } catch {}
      }

      try { this.cameras.main.flash(180, 255, 60, 90, false); } catch (e) { console.warn(e); }
      try { this.hpBar.set(this.player.hp, this.player.maxHp); } catch (e) { console.warn(e); }
      try { this.showEndOverlay(kind); } catch (e) { console.warn('[GameScene] showEndOverlay threw:', e); }

      window.setTimeout(() => { try { this.showEndOverlay(kind); } catch {} }, 1500);
      window.setTimeout(() => { try { this.showEndOverlay(kind); } catch {} }, 2800);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[GameScene] endRun body threw — restart timers are still armed:', e);
    }
  }

  private showEndOverlay(kind: 'gameOver' | 'win'): void {
    if (!this.ended || this.autoRestartFired) return;
    if (this.endOverlay.visible) return;
    // eslint-disable-next-line no-console
    console.log('[GameScene] showEndOverlay firing');
    this.endOverlay.show(kind, () => {
      this.performRestart('manual-overlay-click');
    });
  }

  /**
   * Schedule one auto-restart attempt at `delayMs`. Idempotent — if a
   * previous attempt already fired (autoRestartFired=true) or if the run
   * is no longer ended, this one no-ops.
   */
  private scheduleAutoRestart(delayMs: number): void {
    window.setTimeout(() => {
      if (!this.ended || this.autoRestartFired) return;
      this.performRestart(`auto-restart@${delayMs}ms`);
    }, delayMs);
  }

  /**
   * Single chokepoint for actually restarting the scene. Wraps both
   * audio + scene.restart in try/catch so an exception in one can't
   * abort the other. autoRestartFired is set FIRST to prevent multiple
   * concurrent restarts (race between setTimeout + frame check).
   */
  private performRestart(reason: string): void {
    if (this.autoRestartFired) return;
    this.autoRestartFired = true;
    // eslint-disable-next-line no-console
    console.log(`[GameScene] performRestart (${reason})`);

    if (this.autoRestartTimerId !== null) {
      window.clearTimeout(this.autoRestartTimerId);
      this.autoRestartTimerId = null;
    }
    try {
      this.audio.play(SFX.UI_RESTART);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[GameScene] audio.play(UI_RESTART) failed:', e);
    }
    try {
      this.scene.restart();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[GameScene] scene.restart() failed — falling back to page reload:', e);
      try { window.location.reload(); } catch { /* nothing left */ }
    }
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

  private drainSpikeSpawns(): void {
    for (const s of this.level.drainSpikeSpawns()) {
      this.spikes.push(new Spikes(this, s.x, s.y, s.width, s.phaseOffsetMs));
    }
  }

  private drainOverhangSpawns(): void {
    for (const o of this.level.drainOverhangSpawns()) {
      this.overhangs.push(new Overhang(this, o.x, o.bottomY, o.width));
    }
  }

  // ─── Grab / throw ──────────────────────────────────────────────────

  /**
   * Run once per update tick. Either initiates a grab (if Circle/K just
   * pressed and nothing currently grabbed) or processes throw-direction
   * input on the currently grabbed enemy.
   */
  private handleGrabInput(timeMs: number): void {
    // Auto-release if grabbed enemy died from a hit (e.g. player attacks while
    // an enemy is grabbed — currently shouldn't happen since attacks while
    // grabbing are unusual, but keep the safety).
    if (this.grabbedEnemy && !this.grabbedEnemy.isAlive()) {
      this.grabbedEnemy = null;
    }

    // Try to grab.
    if (!this.grabbedEnemy && this.controls.justPressed('grab', 16)) {
      this.controls.consumePress('grab');
      this.tryGrab(timeMs);
      return;
    }

    if (!this.grabbedEnemy) return;

    // Auto-break after 3 s.
    if (timeMs - this.grabbedAtMs > 3000) {
      this.grabbedEnemy.releaseGrab();
      this.grabbedEnemy = null;
      return;
    }

    // Throw on FRESH press of a direction. A direction that was held at
    // the moment of grab doesn't count as a throw until released-then-
    // pressed again, so walking-right + grab doesn't insta-throw right.
    const leftNow = this.controls.held('left');
    const rightNow = this.controls.held('right');
    const upNow = this.controls.held('up');

    let throwDir: 'left' | 'right' | 'up' | null = null;
    if (leftNow && !this.grabPressedDirs.left) throwDir = 'left';
    else if (rightNow && !this.grabPressedDirs.right) throwDir = 'right';
    else if (upNow && !this.grabPressedDirs.up) throwDir = 'up';

    // Refresh "was held" so a release re-arms that direction.
    if (!leftNow) this.grabPressedDirs.left = false;
    if (!rightNow) this.grabPressedDirs.right = false;
    if (!upNow) this.grabPressedDirs.up = false;

    if (throwDir) {
      this.throwGrabbed(throwDir, timeMs);
    }
  }

  /** Find the closest live patrol within range and grab it. */
  private tryGrab(timeMs: number): void {
    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    const rangeSq = 90 * 90;

    let best: Patrol | null = null;
    let bestD2 = rangeSq;
    for (const p of this.patrols) {
      if (!p.isAlive() || p.isGrabbed() || p.isThrown()) continue;
      const dx = p.sprite.x - px;
      const dy = p.sprite.y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        best = p;
        bestD2 = d2;
      }
    }
    if (!best) return;

    best.setGrabbed();
    this.grabbedEnemy = best;
    this.grabbedAtMs = timeMs;
    this.grabPressedDirs = {
      left: this.controls.held('left'),
      right: this.controls.held('right'),
      up: this.controls.held('up'),
    };
    this.audio.play(SFX.PLAYER_CLAW_2); // close-enough proxy SFX for grab
  }

  /** Position the grabbed enemy just above the player's head each frame. */
  private maintainGrabbedFollowing(): void {
    if (!this.grabbedEnemy) return;
    const px = this.player.sprite.x;
    const py = this.player.sprite.y - this.player.body.height / 2 - this.grabbedEnemy.body.height / 2 - 6;
    this.grabbedEnemy.setGrabbedPosition(px, py);
  }

  private throwGrabbed(dir: 'left' | 'right' | 'up', timeMs: number): void {
    if (!this.grabbedEnemy) return;
    // Throw velocities tuned for weight + arc readability:
    //   - sideways: vx ±1100 sends them far across pits/platforms; vy
    //     -350 gives a noticeable up-arc instead of a flat shove.
    //   - up: vy -1000 so an up-throw clearly arcs HIGHER than sideways,
    //     and on landing the descent vy crosses the patrol fall-kill
    //     threshold (700) — up-throw becomes a viable kill move.
    let vx = 0;
    let vy = 0;
    if (dir === 'left')       { vx = -1100; vy = -350; }
    else if (dir === 'right') { vx =  1100; vy = -350; }
    else                      { vx =     0; vy = -1000; }
    this.grabbedEnemy.throwMe(vx, vy, timeMs);
    this.audio.play(SFX.PLAYER_SHADOW_POUNCE); // heavier launch SFX for throw
    this.fx.shake(110, 0.008);
    this.grabbedEnemy = null;
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

  private cullSpikes(): void {
    const cullX = this.player.sprite.x - 1500;
    for (let i = this.spikes.length - 1; i >= 0; i--) {
      const s = this.spikes[i];
      if (s.worldX < cullX) {
        s.destroy();
        this.spikes.splice(i, 1);
      }
    }
  }

  private cullOverhangs(): void {
    const cullX = this.player.sprite.x - 1500;
    for (let i = this.overhangs.length - 1; i >= 0; i--) {
      const o = this.overhangs[i];
      if (o.worldX < cullX) {
        o.destroy();
        this.overhangs.splice(i, 1);
      }
    }
  }
}

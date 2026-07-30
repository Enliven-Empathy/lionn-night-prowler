import Phaser from 'phaser';
import { VIEW } from '../core/constants';
import { InputController } from '../core/input';
import { Player } from '../entities/Player';
import { Patrol } from '../entities/Patrol';
import { Collectible } from '../entities/Collectible';
import { Heart } from '../entities/Heart';
import { Spikes } from '../entities/Spikes';
import { Overhang } from '../entities/Overhang';
import { SlidePole } from '../entities/SlidePole';
import { EndlessLevel, EndlessLevelHandle } from '../levels/EndlessLevel';
import { ParkourLevel } from '../levels/ParkourLevel';
import { RunSummary, UserStore } from '../state/UserStore';
import { BossDef, findBossById } from '../state/Bosses';

type GameMode = 'endless' | 'parkour';
import { OVERHANG, SPIKES } from '../core/constants';
import { DebugOverlay } from '../ui/DebugOverlay';
import { GamepadDebug } from '../ui/GamepadDebug';
// GameOverOverlay was retired when ResultsScene took over — its on-canvas
// "GAME OVER + click to restart" panel was redundant once the death state
// became its own scene.
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
  private slidePoles: SlidePole[] = [];
  private collectibles: Collectible[] = [];
  private hearts: Heart[] = [];
  private spikes: Spikes[] = [];
  private overhangs: Overhang[] = [];
  private staticGroupRef!: Phaser.Physics.Arcade.StaticGroup;
  private level!: EndlessLevelHandle;
  /** Active game mode. Read from game.registry on init() so the value
   *  survives scene restarts. ModeSelectScene writes it; GameScene reads
   *  and branches level construction. Default is 'endless' so existing
   *  flow is preserved if no mode was picked. */
  private mode: GameMode = 'endless';
  private debugOverlay!: DebugOverlay;
  private gamepadDebug!: GamepadDebug;
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
  /** Wall-clock ms when endRun fired. Kept as a diagnostic for the
   *  nuclear reload timer's log line. Read but not otherwise used. */
  endedAtWall = -Infinity;
  private autoRestartFired = false;
  /** Browser-level setTimeout fallback. Fires even if the rAF loop is
   *  paused/throttled; cleared on manual restart or scene shutdown. */
  private autoRestartTimerId: number | null = null;
  /** Nuclear-option page-reload timer. Fires at 9.5 s post-death IFF the
   *  scene is still in the ended state — independent of autoRestartFired,
   *  since the whole purpose of the nuclear option is to recover when an
   *  earlier restart claimed success but the scene-manager actually stalled. */
  private nuclearReloadTimerId: number | null = null;
  // restartWasHeld / restartArmedAt removed — manual restart now lives
  // in ResultsScene rather than the in-game game-over branch.
  /** Cached M key for the in-game "back to mode picker" shortcut. Cached
   *  in create(); update() reads .isDown only — calling kb.addKey every
   *  frame piles up listeners and feeds the scene-shutdown crash that
   *  hit ModeSelectScene. */
  private modeBackKey: Phaser.Input.Keyboard.Key | null = null;
  private modeBackPrev = false;

  // Grab/throw state.
  //
  // Input flow (refactored 2026-05-09):
  //   - Press Circle (○) / K with no enemy held → grab the closest patrol.
  //   - While carrying, arrow keys / stick = WALK with the enemy overhead.
  //     Movement is fully unaffected by direction presses.
  //   - Press Circle (○) / K AGAIN → throw the carried enemy in the direction
  //     currently held (left, right, or up). If no direction is held,
  //     defaults to a sideways throw in the player's facing direction.
  //
  // The previous design fired a throw on any fresh direction press while
  // carrying, which made walking-with-an-enemy impossible — every step
  // launched the captive.
  private grabbedEnemy: Patrol | null = null;
  private grabbedAtMs = 0;

  private distanceText!: Phaser.GameObjects.Text;
  private bestDistance = 0;
  private bestDistanceText!: Phaser.GameObjects.Text;

  private score = 0;
  private bestScore = 0;
  /** Wall-clock ms at the start of this run. Captured in create(); used
   *  to populate RunSummary.startedAt for ResultsScene + UserStore. */
  private runStartedAt = 0;
  /** Per-run enemy kill count. Bumped from the damage system's onHit
   *  callback whenever a player-team hit kills the target. Used by
   *  First Blood / Bone Collector badges. */
  private runEnemiesKilled = 0;
  /** Per-run boss kill count. Bumped only when the killed combatant
   *  matches a Patrol with isBoss=true. Used by the Night Slayer badge
   *  + the bonus tier-3 reward drop. */
  private runBossesKilled = 0;
  /** Per-run set of unique boss ids defeated. Drives the boss-specific
   *  badges (boss_shadow_stalker / boss_crimson_beast /
   *  boss_night_sovereign) and survives into the RunSummary. */
  private runBossIdsKilled: string[] = [];
  /** Combatant ids hit by the CURRENT dash activation. Cleared on the
   *  rising edge of snap.dashing so each dash deals a single damage
   *  event per target, not one per frame of overlap. */
  private dashHitIds = new Set<number>();
  private wasPlayerDashing = false;
  private scoreText!: Phaser.GameObjects.Text;
  private bestScoreText!: Phaser.GameObjects.Text;

  constructor() {
    super('GameScene');
  }

  init(): void {
    // Mode comes from the registry (set by StartScene's pre-launch
    // path); fall back to localStorage for nuclear-reload paths, then
    // to 'endless' as the safe default.
    let mode: 'endless' | 'parkour' = 'endless';
    const reg = this.game.registry.get('mode');
    if (reg === 'parkour' || reg === 'endless') {
      mode = reg;
    } else {
      try {
        const stored = window.localStorage.getItem('lionn:mode');
        if (stored === 'parkour' || stored === 'endless') mode = stored;
      } catch { /* privacy-mode browsers */ }
    }
    this.mode = mode;

    // Mirror current mode back to localStorage so a watchdog reload
    // mid-run lands on the SAME mode the kid was playing — fixes the
    // "blank then back to endless" symptom from the bug report.
    try { window.localStorage.setItem('lionn:mode', mode); } catch { /* ignore */ }

    // Best distance/score now come from the active UserProfile per-mode
    // (UserStore) rather than from the registry. The registry was
    // shared across modes + reset on page reload, so the in-game HUD
    // showed 0 even when the user's parkour best was 132 m.
    const u = UserStore.getCurrentUser();
    if (u) {
      this.bestDistance = u.bestDistance[mode] ?? 0;
      this.bestScore = u.bestScore[mode] ?? 0;
    } else {
      this.bestDistance = this.game.registry.get('bestDistance') ?? 0;
      this.bestScore = this.game.registry.get('bestScore') ?? 0;
    }
    // Keep the registry in sync so the rest of the scene (which still
    // reads .bestDistance directly) sees the right number.
    this.game.registry.set('bestDistance', this.bestDistance);
    this.game.registry.set('bestScore', this.bestScore);
  }

  create(): void {
    this.ended = false;
    this.debugLastToggleAt = -Infinity;
    this.debugHitboxes = false;
    this.patrols = [];
    this.slidePoles = [];
    this.collectibles = [];
    this.hearts = [];
    this.spikes = [];
    this.overhangs = [];
    this.grabbedEnemy = null;
    this.grabbedAtMs = 0;
    this.score = 0;
    this.runStartedAt = Date.now();
    this.runEnemiesKilled = 0;
    this.runBossesKilled = 0;
    this.runBossIdsKilled = [];
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
    // Manual restart input flags removed — ResultsScene owns retry now.

    this.physics.world.setBounds(0, -300, WORLD_WIDTH, WORLD_HEIGHT + 300);
    this.physics.world.setBoundsCollision(true, true, true, false);

    this.controls = new InputController(this);

    // Cache the M key once. Reading isDown is cheap; addKey is not safe
    // to call per-frame (see ModeSelectScene comment).
    const kb = this.input.keyboard;
    this.modeBackKey = kb ? kb.addKey(Phaser.Input.Keyboard.KeyCodes.M) : null;
    this.modeBackPrev = !!this.modeBackKey?.isDown;
    this.damage = new DamageSystem();
    this.fx = new HitFx(this);
    this.audio = new AudioManager(this);

    // Combat hits: light/heavy variant chosen by attack name. Only player
    // hits play this — enemy hits already trigger player_hurt via Player.takeDamage.
    // Also track kills for the per-run enemy-kill counter (used by Phase 2
    // badges). The damage hook fires on every hit; we observe the
    // target's isAlive() AFTER the hit to detect a kill.
    this.damage.onHit((event, target) => {
      if (event.team !== 'player') return;
      this.audio.play(attackHitSfx(event.attackName));
      if (!target.isAlive()) {
        this.runEnemiesKilled += 1;
        // Boss-killed detection. Look up the patrol whose combatant
        // id matches the killed target; if it was a boss, count it,
        // record its id for the per-boss badges, and drop the def's
        // configured reward count + an extra-emphatic flash for the
        // major endbosses.
        const killedPatrol = this.patrols.find((p) => p.combatant.id === target.id);
        if (killedPatrol && killedPatrol.bossDef) {
          const def = killedPatrol.bossDef;
          this.runBossesKilled += 1;
          if (!this.runBossIdsKilled.includes(def.id)) {
            this.runBossIdsKilled.push(def.id);
          }
          this.spawnBossReward(killedPatrol.sprite.x, killedPatrol.sprite.y, def);
        }
      }
    });

    // Mode-driven level construction. Parkour and Endless both expose
    // EndlessLevelHandle so the rest of the scene is identical — only
    // the level builder differs. Endless code path is unchanged.
    this.level = this.mode === 'parkour'
      ? new ParkourLevel(this).build()
      : new EndlessLevel(this).build();
    this.staticGroupRef = this.level.staticGroup;

    // findSlidePole closes over `this.slidePoles` — that array is
    // populated by drainSlidePoleSpawns() AFTER Player is built. The
    // closure resolves lazily at query time, so it's safe.
    const findSlidePole = (
      bodyLeft: number,
      bodyRight: number,
      bodyCenterY: number,
      side: -1 | 1,
    ) => {
      const X_EPS = 6;
      for (const sp of this.slidePoles) {
        if (bodyCenterY < sp.topY || bodyCenterY > sp.topY + sp.heightPx) continue;
        if (side === 1) {
          // pole is on the right of the player → pole.left ≈ player.right
          if (Math.abs(sp.worldX - bodyRight) > X_EPS) continue;
        } else {
          // pole is on the left → pole.right ≈ player.left
          if (Math.abs((sp.worldX + sp.widthPx) - bodyLeft) > X_EPS) continue;
        }
        return { topY: sp.topY, bottomY: sp.topY + sp.heightPx };
      }
      return null;
    };

    this.player = new Player(
      this,
      this.level.spawnX,
      this.level.spawnY,
      this.controls,
      this.damage,
      this.fx,
      this.audio,
      this.level.findLedge,
      findSlidePole,
    );
    this.physics.add.collider(this.player.sprite, this.level.staticGroup);

    // Drain initial spawns now that the static group + collider system is ready.
    this.drainEnemySpawns();
    this.drainSlidePoleSpawns();

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

    // Mode + user badge (top-left, above HP). Tells the kid which mode
    // they're in, which profile is logged in (so a shared device shows
    // whose run it is), and the M-to-switch shortcut. UserStore.get
    // returns null on edge-case boots without a profile — fallback to
    // "—" so the line still renders rather than breaking.
    const modeLabel = this.mode === 'parkour' ? 'PARKOUR' : 'ENDLESS';
    const modeColor = this.mode === 'parkour' ? '#b47bff' : '#c4b8e8';
    const currentUser = UserStore.getCurrentUser();
    const userTag = currentUser ? currentUser.tag : '—';
    this.add.text(24, 64, `${modeLabel}  ·  ${userTag}  ·  M menu`, {
      fontFamily: 'Cinzel, Georgia, serif',
      fontSize: '14px',
      color: modeColor,
      stroke: '#0b0816',
      strokeThickness: 3,
    }).setScrollFactor(0).setDepth(1100);

    // Controls hint — appears on spawn, fades out after 6s. Doesn't pollute
    // the screen the rest of the run. Re-shown each scene.restart so the
    // kid can re-read the bindings if they forget.
    const controlsHint = this.add.text(
      VIEW.width / 2,
      VIEW.height - 32,
      'MOVE ←→ · JUMP Cross/SPACE (×2) · CROUCH R2/L2/↓ · ATTACK □/J (×3 combo!) · DASH R1/SHIFT · ○/K grab → walk → ○/K + ←→↑ throw',
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
    // F3 was previously toggled via the polled controls.held('debugToggle')
    // path with a 250 ms debounce — that fires on rising-edge fine in
    // theory but had been reported as unresponsive. Switching to the
    // same event-based handler as G and H makes the three legend keys
    // behave consistently and avoids the polling timing-window
    // sensitivity entirely.
    this.input.keyboard?.on('keydown-F3', (e: KeyboardEvent) => {
      // Block Chrome's default F3 binding (some platforms map F3 to
      // "Find next") so the keypress reaches us alone.
      try { e.preventDefault(); } catch { /* ignore */ }
      this.debugOverlay.toggle();
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

    // F3 debug toggle is now handled in create() via keyboard.on(
    // 'keydown-F3'). Polled path retired — see B7 in the bug fixes.
    void this.debugLastToggleAt;

    // M to bail back to the main menu (StartScene). Rising-edge tracked
    // so a held key only fires once. Cached key — addKey is unsafe to
    // call per-frame.
    if (this.modeBackKey) {
      const down = this.modeBackKey.isDown;
      if (down && !this.modeBackPrev) {
        this.scene.start('StartScene');
        return;
      }
      this.modeBackPrev = down;
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
      this.drainSlidePoleSpawns();

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

      // Dash-vs-patrol collision. The dash is movement, not an attack
      // through the hitbox system, so we AABB-test the player's hurtbox
      // against each patrol's hurtbox while snap.dashing is true and
      // fire a takeDamage event with attackName='dash'. Patrol's
      // takeDamage auto-applies the dizzy state for any dash hit (the
      // universal "make dizzy" mechanic the player relies on to crack
      // the slash-immune Night Sovereign open).
      //
      // dashHitIds tracks targets hit by THIS activation so a sustained
      // overlap doesn't deal damage every frame — one event per dash
      // per target.
      const snap = this.player.getMovementSnapshot(timeMs);
      if (snap.dashing && !this.wasPlayerDashing) this.dashHitIds.clear();
      if (snap.dashing && !this.player.isDead()) {
        const playerRect = this.player.hurtbox();
        for (const p of this.patrols) {
          if (!p.isAlive() || p.isGrabbed() || p.isThrown()) continue;
          if (this.dashHitIds.has(p.combatant.id)) continue;
          const patrolRect = p.combatant.hurtbox();
          if (!patrolRect) continue;
          if (!Phaser.Geom.Intersects.RectangleToRectangle(playerRect, patrolRect)) continue;
          this.dashHitIds.add(p.combatant.id);
          // Routed through DamageSystem.applyDirect (not p.takeDamage) so the
          // onHit listener fires — otherwise a dash kill awards no kill count,
          // no boss reward orbs and no boss badge.
          this.damage.applyDirect(
            p.combatant,
            {
              damage: 1,
              fromX: this.player.sprite.x,
              fromY: this.player.sprite.y,
              knockbackX: 220,
              knockbackY: -140,
              hitstopMs: 70,
              attackName: 'dash',
              team: 'player',
            },
            timeMs,
          );
        }
      }
      this.wasPlayerDashing = snap.dashing;

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
            // applyDirect, not takeDamage — spike kills are credited to the
            // player (team: 'player'), so they must reach the onHit listener
            // for kill count / boss reward / boss badge.
            this.damage.applyDirect(p.combatant, {
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
      // Game-over state — endRun() has already routed to ResultsScene.
      // The only thing this branch still does is render-only cleanup
      // (camera follow, HUD updates) until Phaser's scene manager swaps
      // us out. All restart logic lives in ResultsScene now.
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
    console.log(`[GameScene] endRun (${kind}) — handing off to ResultsScene`);

    // Nuclear reload safety net — fires only if the ResultsScene
    // transition somehow fails to land within 6 seconds. Scoped at the
    // GameScene boundary because if ResultsScene can't even start, we
    // need a guarantee the kid isn't stranded on a frozen frame.
    this.nuclearReloadTimerId = window.setTimeout(() => {
      if (this.ended && !this.autoRestartFired) {
        // eslint-disable-next-line no-console
        console.warn('[GameScene] still ended at +6 s — reloading page (nuclear)');
        try { window.location.reload(); } catch { /* nothing left */ }
      }
    }, 6000);

    try {
      // Force-restore physics timeScale in case a hit pause was still active.
      this.physics.world.timeScale = 1;

      // Build the run summary that ResultsScene + UserStore consume.
      const distancePx = this.level.distance(this.player.sprite.x);
      const summary: RunSummary = {
        mode: this.mode,
        distance: distancePx,
        score: this.score,
        enemiesKilled: this.runEnemiesKilled,
        wallJumps: this.player.runStats.wallJumps,
        ledgeClimbs: this.player.runStats.ledgeClimbs,
        bossesKilled: this.runBossesKilled,
        bossIdsKilled: this.runBossIdsKilled.slice(),
        startedAt: this.runStartedAt,
        endedAt: Date.now(),
      };

      // Persist + check for new bests. Uses UserStore (localStorage-
      // backed, per-user) — replaces the old game.registry-only
      // bestDistance / bestScore (which never survived a page reload).
      const bests = UserStore.recordRun(summary);

      // Keep the registry mirrors so the in-game HUD bestX texts stay
      // accurate if the player goes back to GameScene without a full
      // page reload.
      const u = UserStore.getCurrentUser();
      if (u) {
        const bestDist = u.bestDistance[summary.mode];
        const bestScore = u.bestScore[summary.mode];
        if (bestDist !== this.bestDistance) {
          this.bestDistance = bestDist;
          this.game.registry.set('bestDistance', bestDist);
          try { this.bestDistanceText.setText(this.formatBestDistance()); } catch { /* ignore */ }
        }
        if (bestScore !== this.bestScore) {
          this.bestScore = bestScore;
          this.game.registry.set('bestScore', bestScore);
          try { this.bestScoreText.setText(this.formatBestScore()); } catch { /* ignore */ }
        }
      }

      // SFX + camera flash.
      try { this.audio.stopMusic(); } catch (e) { console.warn('[GameScene] audio.stopMusic threw:', e); }
      try {
        this.audio.play(bests.isNewBestScore || bests.isNewBestDistance ? SFX.UI_BEST_SCORE : SFX.UI_GAME_OVER);
      } catch (e) {
        console.warn(e);
      }
      try { this.cameras.main.flash(180, 255, 60, 90, false); } catch (e) { console.warn(e); }
      try { this.hpBar.set(this.player.hp, this.player.maxHp); } catch (e) { console.warn(e); }

      // Hand off to ResultsScene. autoRestartFired flips to true so the
      // nuclear timer above no-ops if ResultsScene successfully takes
      // over. ResultsScene has its own 12-s nuclear timer scoped to its
      // own scene if it gets stuck, so the safety net is layered.
      this.autoRestartFired = true;
      this.scene.start('ResultsScene', {
        summary,
        isNewBestDistance: bests.isNewBestDistance,
        isNewBestScore: bests.isNewBestScore,
        newlyUnlockedBadges: bests.newlyUnlockedBadges,
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[GameScene] endRun body threw — nuclear timer is still armed:', e);
    }
  }

  private formatBestDistance(): string {
    return `best  ${(this.bestDistance / 100).toFixed(1)} m`;
  }

  private formatBestScore(): string {
    return `best  ★ ${this.bestScore}`;
  }

  private drainEnemySpawns(): void {
    const spawns = this.level.drainEnemySpawns();
    // ParkourLevel surfaces a parallel-array variants channel via a
    // non-standard handle field. Endless mode doesn't, so default all
    // patrols to the full-AI variant when missing.
    const drainVariants = (this.level as unknown as { drainEnemyVariants?: () => ('patrol' | 'dummy')[] }).drainEnemyVariants;
    const variants = drainVariants ? drainVariants() : [];
    for (let i = 0; i < spawns.length; i++) {
      const s = spawns[i];
      const variant = variants[i] ?? 'patrol';
      const bossDef = s.bossId ? findBossById(s.bossId) ?? null : null;
      const p = new Patrol(
        this,
        s.x,
        s.y,
        s.xMin,
        s.xMax,
        this.damage,
        this.fx,
        this.audio,
        (footX, footY) => this.patrolStepHazardous(footX, footY),
        variant,
        bossDef,
      );
      this.physics.add.collider(p.sprite, this.staticGroupRef);
      this.patrols.push(p);
    }
  }

  private drainSlidePoleSpawns(): void {
    const drain = this.level.drainSlidePoleSpawns;
    if (!drain) return;
    for (const sp of drain()) {
      const pole = new SlidePole(this, sp.x, sp.topY, sp.height, this.staticGroupRef);
      this.slidePoles.push(pole);
    }
  }

  /**
   * Returns true if a patrol foot at (footX, footY) would step into a
   * pit (no static ground below) or onto an active spike row.
   *
   *   - PIT check: probe a few px below the foot point. If no static
   *     body covers that probe, there's no ground to land on next step.
   *   - SPIKE check: probe a few px above the ground line. If a spike
   *     is currently dangerous and its hit-rect contains the probe,
   *     the patrol's foot would land on emerging spikes.
   *
   * Cheap to call once per patrol per frame — the staticGroup has on
   * the order of dozens of bodies and the spike list is single digits.
   */
  private patrolStepHazardous(footX: number, footY: number): boolean {
    // PIT: scan static bodies for one whose top is just below the foot.
    const groundProbeY = footY + 4;
    let hasGround = false;
    const children = this.staticGroupRef.getChildren();
    for (const c of children) {
      const b = (c as Phaser.GameObjects.GameObject & { body?: Phaser.Physics.Arcade.StaticBody }).body;
      if (!b) continue;
      if (
        footX >= b.x &&
        footX <= b.x + b.width &&
        groundProbeY >= b.y &&
        groundProbeY <= b.y + b.height
      ) {
        hasGround = true;
        break;
      }
    }
    if (!hasGround) return true;

    // SPIKE: probe just above the ground line for a currently-dangerous
    // spike row. Patrols won't refuse a *closed* spike row — that'd
    // pin them in place forever — only the active state.
    const spikeProbeY = footY - 8;
    for (const s of this.spikes) {
      if (!s.isDangerous()) continue;
      const r = s.hitRect();
      if (
        footX >= r.left &&
        footX <= r.right &&
        spikeProbeY >= r.top &&
        spikeProbeY <= r.bottom
      ) {
        return true;
      }
    }

    return false;
  }

  private drainCollectibleSpawns(): void {
    for (const s of this.level.drainCollectibleSpawns()) {
      this.collectibles.push(new Collectible(this, s.x, s.y, s.tier));
    }
  }

  /**
   * Spawn the boss's configured reward orbs at its position + a flash
   * + shake. The orb count comes from the BossDef (1 for minor, 2 for
   * Shadow Stalker / Crimson Beast, 3 for Night Sovereign) and they
   * fan out horizontally so all are visible. Flash colour shifts to
   * the boss's stroke so the kill reads as palette-themed.
   */
  private spawnBossReward(x: number, y: number, def: BossDef): void {
    const count = def.rewardCount;
    for (let i = 0; i < count; i++) {
      const offsetX = count === 1 ? 0 : (i - (count - 1) / 2) * 36;
      this.collectibles.push(new Collectible(this, x + offsetX, y - 36, 3));
    }
    try {
      // Decompose the stroke colour to RGB for the camera flash so each
      // boss has a distinctly tinted explosion.
      const r = (def.stroke >> 16) & 0xff;
      const g = (def.stroke >> 8) & 0xff;
      const b = def.stroke & 0xff;
      this.cameras.main.flash(260, r, g, b, false);
      this.fx.shake(220, 0.015);
    } catch {
      // FX is non-critical; never let it break the run.
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
    // Auto-release if the carried enemy died (e.g. spike-killed a patrol
    // we happened to be carrying mid-air — defensive cleanup).
    if (this.grabbedEnemy && !this.grabbedEnemy.isAlive()) {
      this.grabbedEnemy = null;
    }

    const grabPressed = this.controls.justPressed('grab', 16);

    // No enemy carried → a fresh grab press tries to grab one. We
    // consumePress so the SAME press can't immediately fall through to
    // the throw branch this frame.
    if (!this.grabbedEnemy) {
      if (grabPressed) {
        this.controls.consumePress('grab');
        this.tryGrab(timeMs);
      }
      return;
    }

    // Auto-break after 3 s — the enemy struggles free.
    if (timeMs - this.grabbedAtMs > 3000) {
      this.grabbedEnemy.releaseGrab();
      this.grabbedEnemy = null;
      return;
    }

    // Carrying an enemy: a SECOND fresh Circle press throws. Direction
    // priority: up > left > right > facing-default. This frees the
    // arrow keys / stick for walking — the captive only launches when
    // the player explicitly presses the throw button again.
    if (grabPressed) {
      this.controls.consumePress('grab');
      let dir: 'left' | 'right' | 'up';
      if (this.controls.held('up')) {
        dir = 'up';
      } else if (this.controls.held('left')) {
        dir = 'left';
      } else if (this.controls.held('right')) {
        dir = 'right';
      } else {
        dir = this.player.movement.getFacing() === 1 ? 'right' : 'left';
      }
      this.throwGrabbed(dir, timeMs);
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
    // Wall-clock hard-kill mirror of the +N popup in collectPickup.
    window.setTimeout(() => {
      if (popup.active) popup.destroy();
    }, 1500);

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
    // Hard wall-clock kill — defends against the popup lingering when
    // Phaser's tween manager stalls (e.g. tab visibility-change while
    // the tween is running, or any other scene-time hiccup). Without
    // this, the +1 was observed hanging in the air for 6-8 s even
    // though the tween's onComplete should fire at +700 ms.
    window.setTimeout(() => {
      if (popup.active) popup.destroy();
    }, 1500);
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

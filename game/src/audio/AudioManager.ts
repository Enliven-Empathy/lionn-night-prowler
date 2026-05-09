import Phaser from 'phaser';
import { SfxKey } from './Sfx';

interface PlayOptions {
  volume?: number;
  rate?: number;
  detune?: number;
}

const FADE_IN_MS = 1500;
const CROSSFADE_MS = 1800;

/**
 * Thin wrapper around Phaser's sound system. Adds:
 *   - safe no-op when an asset isn't loaded
 *   - separate music vs SFX volume buses
 *   - per-key 50ms rate limit so rapid-fire events don't stack
 *   - **crossfaded music loop**: schedules a second instance of the music
 *     to start ~CROSSFADE_MS before the current one ends, fading the old
 *     out while fading the new in. Masks any audible seam at the loop
 *     point and supports soft fade-in at the very start of the run.
 */
export class AudioManager {
  private scene: Phaser.Scene;
  private currentMusic: Phaser.Sound.BaseSound | null = null;
  private musicKey: SfxKey | string | null = null;
  private musicVolume = 0.28;
  private sfxVolume = 0.7;
  private lastPlayedAt = new Map<string, number>();
  private minIntervalMs = 50;
  private nextScheduleTimer: Phaser.Time.TimerEvent | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  play(key: SfxKey | string, opts: PlayOptions = {}): void {
    if (!this.scene.cache.audio.exists(key)) return;
    const now = this.scene.time.now;
    const last = this.lastPlayedAt.get(key) ?? -Infinity;
    if (now - last < this.minIntervalMs) return;
    this.lastPlayedAt.set(key, now);
    this.scene.sound.play(key, {
      volume: (opts.volume ?? 1) * this.sfxVolume,
      rate: opts.rate,
      detune: opts.detune,
    });
  }

  /**
   * Start crossfaded looping music. Each iteration plays at full volume,
   * then ~CROSSFADE_MS before its end we start a fresh instance fading in
   * while the current one fades out. Eternal soft handoff.
   */
  startMusic(key: SfxKey | string, volume = this.musicVolume): void {
    this.stopMusic();
    if (!this.scene.cache.audio.exists(key)) return;
    this.musicKey = key;
    this.musicVolume = volume;
    this.spawnMusicIteration(true);
  }

  stopMusic(): void {
    this.musicKey = null;
    this.nextScheduleTimer?.destroy();
    this.nextScheduleTimer = null;
    if (this.currentMusic) {
      this.fadeOutAndDestroy(this.currentMusic, 600);
      this.currentMusic = null;
    }
  }

  setMusicVolume(volume: number): void {
    this.musicVolume = Math.max(0, Math.min(1, volume));
    if (this.currentMusic && 'setVolume' in this.currentMusic) {
      (this.currentMusic as Phaser.Sound.BaseSound & { setVolume: (v: number) => void }).setVolume(this.musicVolume);
    }
  }

  setSfxVolume(volume: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, volume));
  }

  // ─── internals ──────────────────────────────────────────────────

  private spawnMusicIteration(isFirst: boolean): void {
    if (!this.musicKey) return;
    const sound = this.scene.sound.add(this.musicKey, { loop: false, volume: 0 });
    sound.play();

    const fadeInMs = isFirst ? FADE_IN_MS : CROSSFADE_MS;
    this.scene.tweens.add({
      targets: sound,
      volume: this.musicVolume,
      duration: fadeInMs,
      ease: 'Sine.easeInOut',
    });

    // Crossfade out the old instance (if any).
    const previous = this.currentMusic;
    this.currentMusic = sound;
    if (previous) this.fadeOutAndDestroy(previous, CROSSFADE_MS);

    // Schedule the next iteration to start CROSSFADE_MS before this one ends.
    // sound.duration is in seconds; falls back to 22 if the decoder isn't ready.
    const durSec = (sound as Phaser.Sound.BaseSound & { duration: number }).duration || 22;
    const lifetimeMs = durSec * 1000;
    const handoffAt = Math.max(2000, lifetimeMs - CROSSFADE_MS);

    this.nextScheduleTimer?.destroy();
    this.nextScheduleTimer = this.scene.time.delayedCall(handoffAt, () => {
      // Only chain if we're still playing this same track key.
      if (this.musicKey && this.currentMusic === sound) {
        this.spawnMusicIteration(false);
      }
    });

    // Safety: when this iteration finishes naturally (e.g., crossfade timer
    // missed due to scene pause), fade out and recover.
    sound.once('complete', () => {
      if (this.currentMusic === sound && this.musicKey) {
        // Restart with a small fade-in if we somehow ended up silent.
        this.spawnMusicIteration(false);
      }
    });
  }

  private fadeOutAndDestroy(sound: Phaser.Sound.BaseSound, durationMs: number): void {
    this.scene.tweens.add({
      targets: sound,
      volume: 0,
      duration: durationMs,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        try { sound.stop(); } catch { /* already stopped */ }
        try { sound.destroy(); } catch { /* already destroyed */ }
      },
    });
  }
}

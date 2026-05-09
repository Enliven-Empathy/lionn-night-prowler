import Phaser from 'phaser';
import { SfxKey } from './Sfx';

interface PlayOptions {
  volume?: number;
  rate?: number;
  detune?: number;
}

/**
 * Thin wrapper around Phaser's sound system. Adds:
 *   - safe no-op when an asset isn't loaded (so the game still runs if SFX
 *     generation hasn't been completed yet)
 *   - separate music vs SFX volume buses
 *   - a single dedicated music slot (only one looping track at a time)
 *   - a tiny rate-limit per-key so rapid-fire events (like footsteps or
 *     overlapping hitboxes) don't stack into noise
 */
export class AudioManager {
  private scene: Phaser.Scene;
  private music: Phaser.Sound.BaseSound | null = null;
  private musicVolume = 0.3;
  private sfxVolume = 0.7;
  private lastPlayedAt = new Map<string, number>();
  private minIntervalMs = 50;

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

  /** Start (or restart) the looping music track. */
  startMusic(key: SfxKey | string, volume = this.musicVolume): void {
    this.stopMusic();
    if (!this.scene.cache.audio.exists(key)) return;
    this.musicVolume = volume;
    this.music = this.scene.sound.add(key, { loop: true, volume });
    this.music.play();
  }

  stopMusic(): void {
    this.music?.stop();
    this.music?.destroy();
    this.music = null;
  }

  setMusicVolume(volume: number): void {
    this.musicVolume = Math.max(0, Math.min(1, volume));
    if (this.music && 'setVolume' in this.music) {
      (this.music as Phaser.Sound.BaseSound & { setVolume: (v: number) => void }).setVolume(this.musicVolume);
    }
  }

  setSfxVolume(volume: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, volume));
  }
}

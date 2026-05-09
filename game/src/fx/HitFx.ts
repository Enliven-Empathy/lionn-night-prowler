import Phaser from 'phaser';

/**
 * Tiny FX helper for combat punch:
 * - hitPause: freezes physics + tweens for N ms (engine-wide via scene.time.timeScale).
 *   Multiple overlapping pauses just take the longest endpoint.
 * - spark: short-lived violet starburst at the hit point.
 * - shake: routes to camera for a configurable duration + intensity.
 */
export class HitFx {
  private scene: Phaser.Scene;
  private pauseUntil = 0;
  private originalTimeScale = 1;
  private isPausing = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  hitPause(durationMs: number, timeMs: number): void {
    const endsAt = timeMs + durationMs;
    if (endsAt <= this.pauseUntil) return;
    this.pauseUntil = endsAt;
    if (!this.isPausing) {
      this.isPausing = true;
      this.originalTimeScale = this.scene.physics.world.timeScale;
      this.scene.physics.world.timeScale = 50; // arcade timeScale: lower = faster (1 = normal). Counter-intuitive — high value ≈ frozen.
    }
  }

  shake(durationMs: number, intensity: number): void {
    this.scene.cameras.main.shake(durationMs, intensity, false);
  }

  spark(x: number, y: number, color = 0xb47bff, big = false): void {
    const scene = this.scene;
    const ringCount = big ? 9 : 6;
    const ringR = big ? 28 : 18;

    const flash = scene.add.circle(x, y, big ? 22 : 14, color, 0.9);
    flash.setBlendMode(Phaser.BlendModes.ADD).setDepth(900);
    scene.tweens.add({
      targets: flash,
      scale: big ? 2.8 : 2.2,
      alpha: 0,
      duration: big ? 220 : 160,
      ease: 'Quad.easeOut',
      onComplete: () => flash.destroy(),
    });

    for (let i = 0; i < ringCount; i++) {
      const angle = (i / ringCount) * Math.PI * 2 + Math.random() * 0.4;
      const speed = (big ? 280 : 180) + Math.random() * 90;
      const star = scene.add.rectangle(x, y, big ? 6 : 4, big ? 6 : 4, 0xffffff, 0.95);
      star.setBlendMode(Phaser.BlendModes.ADD).setDepth(900).setRotation(angle);
      const tx = x + Math.cos(angle) * ringR * (big ? 1.5 : 1);
      const ty = y + Math.sin(angle) * ringR * (big ? 1.5 : 1);
      scene.tweens.add({
        targets: star,
        x: tx + Math.cos(angle) * speed * 0.05,
        y: ty + Math.sin(angle) * speed * 0.05,
        alpha: 0,
        scale: 0.2,
        duration: big ? 320 : 220,
        ease: 'Quad.easeOut',
        onComplete: () => star.destroy(),
      });
    }
  }

  /** Call from scene.update with current timeMs. */
  update(timeMs: number): void {
    if (this.isPausing && timeMs >= this.pauseUntil) {
      this.scene.physics.world.timeScale = this.originalTimeScale;
      this.isPausing = false;
    }
  }
}

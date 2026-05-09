import Phaser from 'phaser';
import { Combatant, DamageEvent } from './types';
import { Hitbox } from './Hitbox';

type HitListener = (
  event: DamageEvent,
  target: Combatant,
  hitWorldPoint: { x: number; y: number },
) => void;

export class DamageSystem {
  private combatants = new Map<number, Combatant>();
  private hitListeners: HitListener[] = [];
  private nextId = 1;

  register(c: Omit<Combatant, 'id'>): Combatant {
    const id = this.nextId++;
    const full: Combatant = { ...c, id };
    this.combatants.set(id, full);
    return full;
  }

  unregister(id: number): void {
    this.combatants.delete(id);
  }

  onHit(listener: HitListener): void {
    this.hitListeners.push(listener);
  }

  /** Called every frame while a hitbox is active. */
  testHitbox(hitbox: Hitbox, timeMs: number): void {
    if (!hitbox.active || !hitbox.data) return;
    const hitRect = hitbox.worldRect();

    for (const target of this.combatants.values()) {
      if (target.team === hitbox.team) continue;
      if (!target.isAlive()) continue;
      if (hitbox.alreadyHit(target.id)) continue;

      const hurt = target.hurtbox();
      if (!hurt) continue;
      if (!Phaser.Geom.Intersects.RectangleToRectangle(hitRect, hurt)) continue;

      hitbox.markHit(target.id);

      const event: DamageEvent = {
        damage: hitbox.data.damage,
        fromX: hitbox.ownerX,
        fromY: hitbox.ownerY,
        knockbackX: hitbox.data.knockbackX,
        knockbackY: hitbox.data.knockbackY,
        hitstopMs: hitbox.data.hitstopMs,
        attackName: hitbox.data.name,
        team: hitbox.team,
      };
      target.takeDamage(event, timeMs);
      const hitPoint = {
        x: (Math.max(hitRect.x, hurt.x) + Math.min(hitRect.right, hurt.right)) / 2,
        y: (Math.max(hitRect.y, hurt.y) + Math.min(hitRect.bottom, hurt.bottom)) / 2,
      };
      for (const l of this.hitListeners) l(event, target, hitPoint);
    }
  }

  combatantCount(): number {
    return this.combatants.size;
  }
}

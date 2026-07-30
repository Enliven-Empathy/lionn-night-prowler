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

  /**
   * Apply a damage event to ONE known target and fire the hit listeners.
   *
   * Use this for damage that doesn't come from a swinging Hitbox or an AOE
   * rect — the dash overlap, spike contact, a thrown body colliding, and
   * fall-impact kills. Those all used to call `target.takeDamage()`
   * directly, which meant they never reached the `onHit` listeners. Since
   * kill counting, boss reward orbs and boss badges are all driven from
   * that listener, killing a boss by dashing it or up-throwing it awarded
   * NOTHING. It went unnoticed because claws (testHitbox) and the ground
   * pound (testRect) both route through here already.
   *
   * `hitWorldPoint` defaults to the target's hurtbox centre, which is what
   * the FX listeners want anyway.
   */
  applyDirect(
    target: Combatant,
    event: DamageEvent,
    timeMs: number,
    hitWorldPoint?: { x: number; y: number },
  ): void {
    if (!target.isAlive()) return;
    const hurt = target.hurtbox();
    const point = hitWorldPoint ?? (hurt
      ? { x: hurt.x + hurt.width / 2, y: hurt.y + hurt.height / 2 }
      : { x: event.fromX, y: event.fromY });

    target.takeDamage(event, timeMs);
    for (const l of this.hitListeners) l(event, target, point);
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

  /**
   * AOE damage helper. Applies a damage event to every alive combatant
   * on a different team whose hurtbox overlaps `rect`. Bypasses the
   * Hitbox class — used by attacks that aren't a normal swing-with-
   * startup-active-recovery (e.g. ground-pound landing impact).
   *
   * No "alreadyHit" tracking: callers should call this once per impact
   * and not re-fire while the rect is still around. (One frame is
   * enough — every overlapping target takes damage that tick.)
   */
  testRect(
    rect: Phaser.Geom.Rectangle,
    attackerTeam: import('./types').Team,
    event: Omit<DamageEvent, 'team'>,
    timeMs: number,
  ): void {
    for (const target of this.combatants.values()) {
      if (target.team === attackerTeam) continue;
      if (!target.isAlive()) continue;
      const hurt = target.hurtbox();
      if (!hurt) continue;
      if (!Phaser.Geom.Intersects.RectangleToRectangle(rect, hurt)) continue;
      const fullEvent: DamageEvent = { ...event, team: attackerTeam };
      target.takeDamage(fullEvent, timeMs);
      const hitPoint = {
        x: (Math.max(rect.x, hurt.x) + Math.min(rect.right, hurt.right)) / 2,
        y: (Math.max(rect.y, hurt.y) + Math.min(rect.bottom, hurt.bottom)) / 2,
      };
      for (const l of this.hitListeners) l(fullEvent, target, hitPoint);
    }
  }

  combatantCount(): number {
    return this.combatants.size;
  }
}

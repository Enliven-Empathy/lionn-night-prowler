import Phaser from 'phaser';

export type Team = 'player' | 'enemy';

export interface AttackData {
  name: string;
  startupMs: number;
  activeMs: number;
  recoveryMs: number;
  damage: number;
  knockbackX: number;
  knockbackY: number;
  hitstopMs: number;
  // Hitbox in entity-local space, +x is facing-forward.
  hitbox: { offsetX: number; offsetY: number; w: number; h: number };
  // The attack the player can chain into during active+recovery if attack is pressed.
  next?: string;
  // Air-only / ground-only restrictions. Default: any.
  airOnly?: boolean;
  groundOnly?: boolean;
  // Visual tag — picked up by FX layer.
  fxTag?: string;
}

export interface DamageEvent {
  damage: number;
  fromX: number;
  fromY: number;
  knockbackX: number;
  knockbackY: number;
  hitstopMs: number;
  attackName: string;
  team: Team;
}

export interface Combatant {
  id: number;
  team: Team;
  /** Returns the hurtbox rect in world space. Return null if currently invulnerable / dead. */
  hurtbox: () => Phaser.Geom.Rectangle | null;
  takeDamage: (event: DamageEvent, timeMs: number) => void;
  isAlive: () => boolean;
}

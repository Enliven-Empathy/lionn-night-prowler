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
  /**
   * Shape of the ground danger-marker drawn during this attack's startup.
   * The marker's fill bar reaches 100% exactly on the impact frame, so
   * the rule a child learns is simply "bar fills = it hits".
   *
   *   'reach'   — a rect at the exact world position the hitbox will
   *               occupy. The default for ordinary melee.
   *   'lane'    — a long strip covering a charge's full rush distance.
   *   'landing' — the solved landing point of a leap.
   *   'none'    — deliberately untelegraphed (player attacks; the
   *               player IS the telegraph).
   *
   * Absent = 'none', so every existing player attack is unaffected.
   */
  telegraph?: 'reach' | 'lane' | 'landing' | 'none';
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

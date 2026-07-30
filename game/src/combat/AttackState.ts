import { AttackData } from './types';
import { COMBAT } from '../core/constants';

export type Phase = 'idle' | 'startup' | 'active' | 'recovery';

export interface AttackEvent {
  kind: 'started' | 'activeStart' | 'activeEnd' | 'recoveryEnd';
  attack: AttackData;
}

export class AttackState {
  private current: AttackData | null = null;
  private phase: Phase = 'idle';
  private phaseEndsAt = 0;
  private startedAt = 0;
  private bufferedNext: AttackData | null = null;
  private lastChainAttack: string | null = null;
  private lastChainEndedAt = -Infinity;

  start(attack: AttackData, timeMs: number): AttackEvent {
    this.current = attack;
    this.phase = 'startup';
    this.startedAt = timeMs;
    this.phaseEndsAt = timeMs + attack.startupMs;
    this.lastChainAttack = attack.name;
    this.lastChainEndedAt = timeMs + attack.startupMs + attack.activeMs + attack.recoveryMs;
    this.bufferedNext = null;
    return { kind: 'started', attack };
  }

  buffer(attack: AttackData): void {
    this.bufferedNext = attack;
  }

  /** True while in startup, active, or recovery. */
  isAttacking(): boolean {
    return this.phase !== 'idle';
  }


  /** During active/recovery the player can chain into `current.next`. */
  canChain(): boolean {
    return this.phase === 'active' || this.phase === 'recovery';
  }

  currentAttack(): AttackData | null {
    return this.current;
  }


  /**
   * Movement should typically be locked while attacking on the ground
   * (slight forward drift in real games is added separately by the entity).
   */
  shouldLockMovement(): boolean {
    return this.phase === 'startup' || this.phase === 'active';
  }

  /** Chain reset: forget the combo if the player waited too long. */
  comboName(): string | null {
    return this.lastChainAttack;
  }

  isWithinComboWindow(timeMs: number): boolean {
    return timeMs - this.lastChainEndedAt < COMBAT.comboResetMs;
  }

  resetCombo(): void {
    this.lastChainAttack = null;
    this.lastChainEndedAt = -Infinity;
  }

  update(timeMs: number): AttackEvent[] {
    const events: AttackEvent[] = [];
    if (!this.current || this.phase === 'idle') return events;

    while (this.current && this.phase !== 'idle' && timeMs >= this.phaseEndsAt) {
      const c = this.current;
      if (this.phase === 'startup') {
        this.phase = 'active';
        this.phaseEndsAt = this.startedAt + c.startupMs + c.activeMs;
        events.push({ kind: 'activeStart', attack: c });
      } else if (this.phase === 'active') {
        this.phase = 'recovery';
        this.phaseEndsAt = this.startedAt + c.startupMs + c.activeMs + c.recoveryMs;
        events.push({ kind: 'activeEnd', attack: c });
      } else if (this.phase === 'recovery') {
        events.push({ kind: 'recoveryEnd', attack: c });
        this.phase = 'idle';
        this.current = null;
      }
    }

    return events;
  }

  takeBuffered(timeMs: number): AttackData | null {
    if (this.phase !== 'idle') return null;
    if (!this.bufferedNext) return null;
    if (timeMs - this.startedAt - (this.current ? this.current.startupMs + this.current.activeMs + this.current.recoveryMs : 0) > COMBAT.attackBufferMs) {
      this.bufferedNext = null;
      return null;
    }
    const next = this.bufferedNext;
    this.bufferedNext = null;
    return next;
  }

  cancel(): void {
    this.current = null;
    this.phase = 'idle';
    this.bufferedNext = null;
  }
}

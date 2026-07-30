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

  /**
   * The current phase. Needed by the punish window, which has to tell
   * `recovery` apart from `startup` — `isAttacking()` can't.
   */
  currentPhase(): Phase {
    return this.phase;
  }

  /** ms since this attack began, across all phases. 0 when idle. */
  elapsed(timeMs: number): number {
    if (!this.current || this.phase === 'idle') return 0;
    return Math.max(0, timeMs - this.startedAt);
  }

  /**
   * Progress through the CURRENT phase, 0..1. Drives the telegraph
   * marker's fill bar, whose whole contract is "full = the hit lands".
   *
   * Three things this must get right:
   *  - Return 0 when idle. `cancel()` and the recovery→idle transition
   *    both leave `phaseEndsAt`/`startedAt` stale, so reading them
   *    without this guard yields garbage.
   *  - Take the duration from `this.current`, NEVER from the ATTACKS
   *    table: the boss wake-up counter starts a *clone* with a
   *    shortened startupMs, and the marker must match what's actually
   *    being played.
   *  - Clamp. The phase-drain loop in update() can cross a whole phase
   *    in one tick during hitstop or a backgrounded tab, so progress is
   *    not guaranteed monotonic per frame.
   */
  phaseProgress(timeMs: number): number {
    if (!this.current || this.phase === 'idle') return 0;
    const duration =
      this.phase === 'startup' ? this.current.startupMs :
      this.phase === 'active' ? this.current.activeMs :
      this.current.recoveryMs;
    if (duration <= 0) return 1;
    const remaining = this.phaseEndsAt - timeMs;
    const progress = 1 - remaining / duration;
    return progress < 0 ? 0 : progress > 1 ? 1 : progress;
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

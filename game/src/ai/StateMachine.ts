/**
 * Tiny FSM for AI — generic over the State enum/string union and a Context type.
 *
 * Each state implements:
 *   onEnter(ctx, prev): void           — setup; called once when entering
 *   onUpdate(ctx, dtSec, time): State|null  — return next state or null to stay
 *   onExit(ctx, next): void            — cleanup; called once when leaving
 */
export interface State<S extends string, Ctx> {
  name: S;
  onEnter?: (ctx: Ctx, prev: S | null, timeMs: number) => void;
  onUpdate: (ctx: Ctx, dtSec: number, timeMs: number) => S | null;
  onExit?: (ctx: Ctx, next: S, timeMs: number) => void;
}

export class StateMachine<S extends string, Ctx> {
  private states = new Map<S, State<S, Ctx>>();
  private current: S;
  private ctx: Ctx;
  enteredAt = 0;

  constructor(initial: S, ctx: Ctx) {
    this.current = initial;
    this.ctx = ctx;
  }

  add(state: State<S, Ctx>): this {
    this.states.set(state.name, state);
    return this;
  }

  start(timeMs: number): void {
    this.enteredAt = timeMs;
    this.states.get(this.current)?.onEnter?.(this.ctx, null, timeMs);
  }

  state(): S {
    return this.current;
  }

  timeInState(timeMs: number): number {
    return timeMs - this.enteredAt;
  }

  update(dtSec: number, timeMs: number): void {
    const cur = this.states.get(this.current);
    if (!cur) return;
    const next = cur.onUpdate(this.ctx, dtSec, timeMs);
    if (next && next !== this.current) {
      this.transitionTo(next, timeMs);
    }
  }

  /** Force-transition (for damage interrupts etc.). */
  transitionTo(next: S, timeMs: number): void {
    if (next === this.current) return;
    const cur = this.states.get(this.current);
    cur?.onExit?.(this.ctx, next, timeMs);
    const prev = this.current;
    this.current = next;
    this.enteredAt = timeMs;
    this.states.get(this.current)?.onEnter?.(this.ctx, prev, timeMs);
  }
}

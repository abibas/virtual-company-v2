import type { MachinePowerErrorCode } from '@mwc/machines-core';
import type { MachineKind, MachineProvider } from '@mwc/shared/enums';
import type { DevboxSize, MachinePowerPolicy, PowerStatus } from '@mwc/shared/machines';
import { hoursText } from './power/text.ts';
import { type KeepOnSpan, keepOnWindowAt } from './power/window.ts';

/**
 * The power policy's decisions (docs/machines.md, S4.4b), pure: for one machine at one instant, the hold its runner
 * keeps (the keep-on hours, the hold after a turn) and what the scheduler does to a devbox (start it once per keep-on
 * window, stop it when the window ends unless work is live). The keep-on window's clock is `power/window.ts`.
 */

export { daysText, hoursText, policyText } from './power/text.ts';
export { type KeepOnSpan, keepOnWindowAt } from './power/window.ts';

/** What a hold is for: the keep-on hours, or the time after an agent's turn (S5 sets the turn). */
export type HoldKind = 'keep_on' | 'after_turn';

/** Who a power event names (`machine_power_events.actor`). */
export type PowerActor = `user:${string}` | 'schedule' | 'auto' | 'system';

/** A box's own state as its controller last read it (`machine_power.state.box`). */
export interface BoxRulesState {
  readonly timezone: string;
  readonly idleShutdownMin: number;
  readonly idleOffhoursMin: number;
  readonly idleLoadThreshold: number;
  readonly workStartHour: number;
  readonly workEndHour: number;
  readonly nightlyStopHour: number;
}

export interface BoxState {
  /** `unknown` until the first reading. */
  readonly status: PowerStatus;
  readonly size: DevboxSize | null;
  readonly hourlyCost: number | null;
  readonly rules: BoxRulesState | null;
  /** When the controller last answered for it (ISO), null before that. */
  readonly checkedAt: string | null;
  /** Why the last reading or command failed, null after one that worked. */
  readonly error: { readonly code: MachinePowerErrorCode; readonly message: string } | null;
}

/** The scheduler's state of a machine (`machine_power.state`); times are ISO strings. */
export interface PowerState {
  /** The hold last sent to its runner, why, and what for. */
  readonly holdUntil: string | null;
  readonly holdReason: string | null;
  readonly holdKind: HoldKind | null;
  /** The keep-on window the box was auto-started in (or found already on), so it starts once per window. */
  readonly autoStartedWindow: string | null;
  /** The last Stop by hand: inside a window it keeps auto-start off for the rest of that window. */
  readonly manualStopAt: string | null;
  /** The end of the agent's last turn on it (S5). */
  readonly lastTurnAt: string | null;
  /** The keep-on window the scheduler last saw it in, so the window's end is noticed once. */
  readonly window: string | null;
  /** Devboxes only. */
  readonly box: BoxState | null;
}

export const EMPTY_POWER_STATE: PowerState = {
  holdUntil: null,
  holdReason: null,
  holdKind: null,
  autoStartedWindow: null,
  manualStopAt: null,
  lastTurnAt: null,
  window: null,
  box: null,
};

/** What the scheduler knows of a machine besides its policy and state. */
export interface PowerFacts {
  readonly kind: MachineKind;
  readonly provider: MachineProvider;
  /** A run is live on it; never before S5. */
  readonly liveWork: boolean;
  /** The box's last known status; null when there is none. */
  readonly boxStatus: PowerStatus | null;
}

export interface Hold {
  readonly until: Date;
  readonly kind: HoldKind;
  /** In plain words, as its `held` event says it. */
  readonly reason: string;
}

export interface PowerDecision {
  readonly hold: Hold | null;
  /** The keep-on window it is in now (the next `state.window`). */
  readonly window: string | null;
  /** The next `state.autoStartedWindow` when no start is needed (the box is on already). */
  readonly autoStartedWindow: string | null;
  /** Start the box (its window becomes `autoStartedWindow` once the start is sent). */
  readonly start: { readonly reason: string; readonly window: string } | null;
  /** Stop the box, and why. */
  readonly stop: string | null;
  /** The window ended but the box stays on, and why (logged `kept`). */
  readonly kept: string | null;
}

/** True for a machine the server powers on and off: a `vm` of the Airia devbox provider. */
export const isPowered = (facts: { readonly kind: MachineKind; readonly provider: MachineProvider }) =>
  facts.kind === 'vm' && facts.provider === 'airia_devbox';

const UP: readonly (PowerStatus | null)[] = ['running', 'starting'];
const DOWN: readonly (PowerStatus | null)[] = ['stopped', 'stopping', 'missing'];
const time = (iso: string | null) => (iso === null ? null : Date.parse(iso));

/**
 * The hold the machine's runner keeps at `now`: through the keep-on window it is in (until the window's end), and for
 * `holdAfterTurnMin` after its last turn, whichever ends later; null when neither applies, and always null for a
 * laptop whose policy does not keep it awake.
 */
export function holdOf(
  policy: MachinePowerPolicy,
  state: PowerState,
  now: Date,
  facts: Pick<PowerFacts, 'kind'>,
  span: KeepOnSpan | null = keepOnWindowAt(policy.keepOn, now),
): Hold | null {
  if (facts.kind === 'laptop' && !policy.keepMacAwake) return null;
  const holds: Hold[] = [];
  if (span !== null) {
    const { to, timezone } = policy.keepOn;
    holds.push({
      until: span.end,
      kind: 'keep_on',
      reason: `Held for the keep-on hours, until ${to} (${timezone})`,
    });
  }
  const lastTurn = time(state.lastTurnAt);
  const afterTurn = lastTurn === null ? null : lastTurn + policy.holdAfterTurnMin * 60_000;
  if (afterTurn !== null && afterTurn > now.getTime()) {
    const reason = `Held for ${policy.holdAfterTurnMin} minutes after the last turn`;
    holds.push({ until: new Date(afterTurn), kind: 'after_turn', reason });
  }
  return holds.reduce<Hold | null>(
    (longest, hold) => (longest && longest.until >= hold.until ? longest : hold),
    null,
  );
}

/** Auto-start at the keep-on hours: once per window, never after a Stop by hand inside it, never a missing box. */
function autoStart(policy: MachinePowerPolicy, state: PowerState, span: KeepOnSpan, facts: PowerFacts) {
  const handled = state.autoStartedWindow === span.id;
  const stoppedByHand = (time(state.manualStopAt) ?? Number.NEGATIVE_INFINITY) >= span.start.getTime();
  if (!policy.autoStartAtKeepOn || handled || stoppedByHand || facts.boxStatus === 'missing') {
    return { autoStartedWindow: state.autoStartedWindow, start: null };
  }
  if (UP.includes(facts.boxStatus)) return { autoStartedWindow: span.id, start: null };
  return {
    autoStartedWindow: state.autoStartedWindow,
    start: { reason: `Keep-on hours started (${hoursText(policy)})`, window: span.id },
  };
}

/** At the window's end: stop the box unless it is down already, kept on while work is live or a turn's hold runs. */
function atWindowEnd(policy: MachinePowerPolicy, facts: PowerFacts, hold: Hold | null) {
  if (!policy.stopAtKeepOnEnd || DOWN.includes(facts.boxStatus)) return { stop: null, kept: null };
  const ended = `Keep-on hours ended (${hoursText(policy)})`;
  if (facts.liveWork) {
    return { stop: null, kept: `${ended} while work was live; left on, the box's own rules stop it later` };
  }
  if (hold?.kind === 'after_turn') {
    return {
      stop: null,
      kept: `${ended} while the hold after the last turn runs; left on, the box's own rules stop it later`,
    };
  }
  return { stop: ended, kept: null };
}

/**
 * The scheduler's decision for one machine at `now`: its hold, the keep-on window it is in, and for a devbox a start
 * (once per window, with `autoStartAtKeepOn`) or, when the window it was last seen in has ended (and none follows at
 * once), a stop with `stopAtKeepOnEnd` — or `kept` when work is live. Turning the hours off ends no window: nothing is
 * stopped for it. `autoStartOnWork` and `autoStartOnMessage` act from S5.
 */
export function decide(
  policy: MachinePowerPolicy,
  state: PowerState,
  now: Date,
  facts: PowerFacts,
): PowerDecision {
  const span = keepOnWindowAt(policy.keepOn, now);
  const hold = holdOf(policy, state, now, facts, span);
  const none = { autoStartedWindow: state.autoStartedWindow, start: null, stop: null, kept: null };
  const window = span?.id ?? null;
  if (!isPowered(facts) || !policy.keepOn.enabled) return { hold, window, ...none };
  if (span !== null) return { hold, window, ...none, ...autoStart(policy, state, span, facts) };
  if (state.window === null) return { hold, window, ...none };
  return { hold, window, ...none, ...atWindowEnd(policy, facts, hold) };
}

/** The `held` or `released` event a change of hold makes, with its actor; null when only its end moved. */
export function holdEvent(
  before: Pick<PowerState, 'holdUntil' | 'holdKind'>,
  hold: Hold | null,
): { readonly action: 'held' | 'released'; readonly reason: string; readonly actor: PowerActor } | null {
  const actorOf = (kind: HoldKind | null): PowerActor => (kind === 'after_turn' ? 'auto' : 'schedule');
  if (hold === null) {
    if (before.holdUntil === null) return null;
    const reason =
      before.holdKind === 'after_turn'
        ? 'Released: the hold after the last turn ended'
        : 'Released: outside the keep-on hours';
    return { action: 'released', reason, actor: actorOf(before.holdKind) };
  }
  if (before.holdUntil !== null && before.holdKind === hold.kind) return null;
  return { action: 'held', reason: hold.reason, actor: actorOf(hold.kind) };
}

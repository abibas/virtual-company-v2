import { MachinePowerPolicy, type MachinePowerPolicyInput } from '@mwc/shared/machines';
import { describe, expect, it } from 'vitest';
import {
  decide,
  EMPTY_POWER_STATE,
  holdEvent,
  holdOf,
  isPowered,
  type PowerFacts,
  type PowerState,
} from '../../../../src/modules/machines/rules/power.ts';

// Friday 2026-11-06: the keep-on window Mon–Fri 09:00–19:00 Europe/Kyiv runs from 07:00Z to 17:00Z.
const WINDOW = { id: '2026-11-06', start: '2026-11-06T07:00:00.000Z', end: '2026-11-06T17:00:00.000Z' };
const at = (iso: string) => new Date(iso);
const policy = (input: MachinePowerPolicyInput = {}) => MachinePowerPolicy.parse(input);
const hours = (extra: MachinePowerPolicyInput = {}) => policy({ keepOn: { enabled: true }, ...extra });
const state = (fields: Partial<PowerState> = {}): PowerState => ({ ...EMPTY_POWER_STATE, ...fields });
const DEVBOX: PowerFacts = { kind: 'vm', provider: 'airia_devbox', liveWork: false, boxStatus: 'stopped' };
const MAC: PowerFacts = { kind: 'laptop', provider: 'none', liveWork: false, boxStatus: null };
const box = (fields: Partial<PowerFacts>) => ({ ...DEVBOX, ...fields });
const NOON = at('2026-11-06T12:00:00Z');
const EVENING = at('2026-11-06T17:00:00Z');
const ENDED = 'Keep-on hours ended (Mon–Fri 09:00–19:00 Europe/Kyiv)';

describe('isPowered', () => {
  it('powers only an Airia devbox', () => {
    expect(isPowered(DEVBOX)).toBe(true);
    expect(isPowered(MAC)).toBe(false);
    expect(isPowered({ kind: 'vm', provider: 'none' })).toBe(false);
    expect(isPowered({ kind: 'container', provider: 'airia_devbox' })).toBe(false);
  });
});

describe('holdOf', () => {
  it('holds through the keep-on window, until its end', () => {
    expect(holdOf(hours(), state(), NOON, DEVBOX)).toEqual({
      until: at(WINDOW.end),
      kind: 'keep_on',
      reason: 'Held for the keep-on hours, until 19:00 (Europe/Kyiv)',
    });
    expect(holdOf(hours(), state(), EVENING, DEVBOX)).toBeNull();
    expect(holdOf(policy(), state(), NOON, DEVBOX)).toBeNull();
  });

  it('holds for holdAfterTurnMin after the last turn, and the longer of the two wins', () => {
    const lastTurn = state({ lastTurnAt: '2026-11-06T16:50:00.000Z' });
    expect(holdOf(policy(), lastTurn, at('2026-11-06T17:00:00Z'), MAC)).toEqual({
      until: at('2026-11-06T17:35:00Z'),
      kind: 'after_turn',
      reason: 'Held for 45 minutes after the last turn',
    });
    expect(holdOf(hours(), lastTurn, at('2026-11-06T16:55:00Z'), DEVBOX)?.kind).toBe('after_turn');
    const early = state({ lastTurnAt: '2026-11-06T09:00:00.000Z' });
    expect(holdOf(hours(), early, NOON, DEVBOX)?.kind).toBe('keep_on');
    expect(holdOf(policy(), early, NOON, DEVBOX)).toBeNull();
    expect(holdOf(policy({ holdAfterTurnMin: 0 }), lastTurn, at('2026-11-06T16:55:00Z'), MAC)).toBeNull();
  });

  it('never holds a laptop whose policy does not keep it awake', () => {
    const asleep = hours({ keepMacAwake: false });
    expect(holdOf(asleep, state(), NOON, MAC)).toBeNull();
    expect(holdOf(asleep, state(), NOON, DEVBOX)?.kind).toBe('keep_on');
    expect(holdOf(asleep, state(), NOON, { kind: 'container' })?.kind).toBe('keep_on');
  });
});

describe('decide: the start of the keep-on hours', () => {
  const auto = hours({ autoStartAtKeepOn: true });

  it('starts a stopped devbox once per window, with its reason', () => {
    expect(decide(auto, state(), NOON, DEVBOX)).toEqual({
      hold: holdOf(auto, state(), NOON, DEVBOX),
      window: WINDOW.id,
      autoStartedWindow: null,
      start: { reason: 'Keep-on hours started (Mon–Fri 09:00–19:00 Europe/Kyiv)', window: WINDOW.id },
      stop: null,
      kept: null,
    });
    expect(decide(auto, state({ autoStartedWindow: WINDOW.id }), NOON, DEVBOX).start).toBeNull();
    expect(
      decide(auto, state({ autoStartedWindow: '2026-11-05' }), NOON, box({ boxStatus: 'unknown' })).start,
    ).not.toBeNull();
  });

  it('tries a start that did not work again 5 minutes after it, while the window lasts', () => {
    const tried = state({ autoStartTriedAt: '2026-11-06T11:56:00.000Z' });
    expect(decide(auto, tried, NOON, DEVBOX).start).toBeNull();
    expect(decide(auto, tried, at('2026-11-06T12:01:00Z'), DEVBOX).start).toEqual({
      reason: 'Keep-on hours started (Mon–Fri 09:00–19:00 Europe/Kyiv)',
      window: WINDOW.id,
    });
    const yesterday = state({ autoStartTriedAt: '2026-11-06T06:58:00.000Z' });
    expect(decide(auto, yesterday, at('2026-11-06T07:00:00Z'), DEVBOX).start).not.toBeNull();
    expect(decide(auto, tried, NOON, box({ boxStatus: 'running' }))).toMatchObject({
      start: null,
      autoStartedWindow: WINDOW.id,
    });
  });

  it('leaves the box off after a Stop by hand inside the window, not one before it', () => {
    expect(decide(auto, state({ manualStopAt: '2026-11-06T08:00:00.000Z' }), NOON, DEVBOX).start).toBeNull();
    expect(
      decide(auto, state({ manualStopAt: '2026-11-06T06:00:00.000Z' }), NOON, DEVBOX).start,
    ).not.toBeNull();
  });

  it('counts the window as done when the box is on already, and never starts a missing box', () => {
    const on = decide(auto, state(), NOON, box({ boxStatus: 'running' }));
    expect(on).toMatchObject({ start: null, autoStartedWindow: WINDOW.id });
    expect(decide(auto, state(), NOON, box({ boxStatus: 'starting' })).autoStartedWindow).toBe(WINDOW.id);
    expect(decide(auto, state(), NOON, box({ boxStatus: 'missing' }))).toMatchObject({
      start: null,
      autoStartedWindow: null,
    });
  });

  it('starts nothing with auto-start off, and nothing that is not a devbox', () => {
    expect(decide(hours(), state(), NOON, DEVBOX)).toMatchObject({ window: WINDOW.id, start: null });
    expect(decide(auto, state(), NOON, MAC)).toMatchObject({
      window: WINDOW.id,
      start: null,
      autoStartedWindow: null,
    });
  });
});

describe('decide: the end of the keep-on hours', () => {
  const seen = state({ window: WINDOW.id });

  it('stops the devbox when the window it was seen in has ended', () => {
    expect(decide(hours(), seen, EVENING, box({ boxStatus: 'running' }))).toEqual({
      hold: null,
      window: null,
      autoStartedWindow: null,
      start: null,
      stop: ENDED,
      kept: null,
    });
    expect(decide(hours(), seen, EVENING, box({ boxStatus: null })).stop).toBe(ENDED);
  });

  it('keeps it on while work is live or the hold after a turn runs', () => {
    expect(decide(hours(), seen, EVENING, box({ boxStatus: 'running', liveWork: true }))).toMatchObject({
      stop: null,
      kept: `${ENDED} while work was live; left on, the box's own rules stop it later`,
    });
    const turn = state({ window: WINDOW.id, lastTurnAt: '2026-11-06T16:50:00.000Z' });
    expect(decide(hours(), turn, EVENING, box({ boxStatus: 'running' }))).toMatchObject({
      stop: null,
      kept: `${ENDED} while the hold after the last turn runs; left on, the box's own rules stop it later`,
    });
  });

  it('does nothing to a box already down, with stopAtKeepOnEnd off, or when the hours were turned off', () => {
    for (const boxStatus of ['stopped', 'stopping', 'missing'] as const) {
      expect(decide(hours(), seen, EVENING, box({ boxStatus }))).toMatchObject({ stop: null, kept: null });
    }
    const noStop = hours({ stopAtKeepOnEnd: false });
    expect(decide(noStop, seen, EVENING, box({ boxStatus: 'running' }))).toMatchObject({
      stop: null,
      window: null,
    });
    expect(decide(policy(), seen, NOON, box({ boxStatus: 'running' }))).toMatchObject({
      stop: null,
      window: null,
    });
  });

  it('stops nothing when the next window follows at once, or for a machine that is not a devbox', () => {
    const always = hours({ keepOn: { enabled: true, days: [5, 6], from: '09:00', to: '08:59' } });
    const saturday = decide(
      always,
      state({ window: '2026-11-06' }),
      at('2026-11-07T07:00:00Z'),
      box({ boxStatus: 'running' }),
    );
    expect(saturday).toMatchObject({ window: '2026-11-07', stop: null });
    expect(decide(hours(), seen, EVENING, MAC)).toMatchObject({ window: null, stop: null, kept: null });
  });
});

describe('holdEvent', () => {
  const keepOn = { until: at(WINDOW.end), kind: 'keep_on' as const, reason: 'Held for the keep-on hours' };
  const turn = { until: at(WINDOW.end), kind: 'after_turn' as const, reason: 'Held after the turn' };
  const held = (kind: 'keep_on' | 'after_turn') => ({ holdUntil: WINDOW.end, holdKind: kind });

  it('logs a hold that starts or changes what it is for, as the schedule or as auto', () => {
    expect(holdEvent(state(), keepOn)).toEqual({ action: 'held', reason: keepOn.reason, actor: 'schedule' });
    expect(holdEvent(state(), turn)).toEqual({ action: 'held', reason: turn.reason, actor: 'auto' });
    expect(holdEvent(held('keep_on'), turn)).toMatchObject({ action: 'held', actor: 'auto' });
    expect(holdEvent(held('keep_on'), { ...keepOn, until: at('2026-11-07T17:00:00Z') })).toBeNull();
  });

  it('logs a hold that ends, and nothing when there was none', () => {
    expect(holdEvent(held('keep_on'), null)).toEqual({
      action: 'released',
      reason: 'Released: outside the keep-on hours',
      actor: 'schedule',
    });
    expect(holdEvent(held('after_turn'), null)).toEqual({
      action: 'released',
      reason: 'Released: the hold after the last turn ended',
      actor: 'auto',
    });
    expect(holdEvent(state(), null)).toBeNull();
  });
});

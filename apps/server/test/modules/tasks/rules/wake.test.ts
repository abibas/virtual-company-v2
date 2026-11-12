import type { Flow } from '@mwc/db';
import { LEAD_WAKE_DEFAULTS } from '@mwc/shared/flows';
import { describe, expect, it } from 'vitest';
import { turnEnded } from '../../../../src/modules/tasks/rules/runs.ts';
import {
  capReached,
  changeWake,
  hoursSince,
  moveWake,
  settingsColumns,
  settingsOf,
  stillCurrent,
  tellsPerson,
  wakeReason,
  wakesOn,
  windowPassed,
} from '../../../../src/modules/tasks/rules/wake.ts';

const flow = (more: Partial<Flow> = {}) =>
  ({
    wakeEscalated: true,
    wakeBlocked: true,
    wakeTurnEnded: true,
    wakeDone: false,
    wakeSignoffHours: null,
    wakeWindowSeconds: 60,
    wakeMaxPerHour: 6,
    wakeMaxPerDay: 40,
    ...more,
  }) as Flow;

const step = {
  id: 's1',
  name: 'Develop',
  kind: 'work' as const,
  position: 1,
  assigneePrincipalId: 'a',
  starts: 'manual' as const,
  sendsBackToStepId: null,
  sendBackLimit: null,
};
const working = {
  state: 'active' as const,
  currentStepId: 's1',
  stepState: 'working' as const,
  rounds: { s1: { entries: 1, sendBacks: 0 } },
} as never;

describe('the Lead wake-ups’ rules', () => {
  it('reads and writes a flow’s settings', () => {
    expect(settingsOf(flow())).toEqual(LEAD_WAKE_DEFAULTS);
    expect(settingsColumns(LEAD_WAKE_DEFAULTS)).toEqual(
      expect.objectContaining({ wakeEscalated: true, wakeDone: false, wakeSignoffHours: null }),
    );
  });

  it('wakes on the kinds the flow turned on', () => {
    expect(wakesOn(flow(), 'escalated')).toBe(true);
    expect(wakesOn(flow(), 'done')).toBe(false);
    expect(wakesOn(flow(), 'signoff_waiting')).toBe(false);
    expect(wakesOn(flow({ wakeSignoffHours: 4, wakeBlocked: false }), 'signoff_waiting')).toBe(true);
    expect(wakesOn(flow({ wakeBlocked: false }), 'blocked')).toBe(false);
    expect(wakesOn(flow({ wakeTurnEnded: false }), 'turn_ended')).toBe(false);
  });

  it('tells a move’s escalation and done, nothing else', () => {
    expect(moveWake('escalated')).toBe('escalated');
    expect(moveWake('done')).toBe('done');
    expect(moveWake('moved')).toBeUndefined();
    expect(moveWake('cancelled')).toBeUndefined();
  });

  it('tells a block and an ended turn, not a start nor a turn a person stopped', () => {
    const failed = turnEnded(working, step, { status: 'failed', error: 'boom' });
    const done = turnEnded(working, step, { status: 'done', error: null });
    const stopped = turnEnded(working, step, { status: 'stopped', error: 'stopped' });
    expect(changeWake(failed as never)).toBe('blocked');
    expect(changeWake(done as never)).toBe('turn_ended');
    expect(stopped?.quiet).toBe(true);
    expect(changeWake(stopped as never)).toBeUndefined();
    expect(
      changeWake({ stepState: 'working', blockedReason: null, event: { kind: 'started' } }),
    ).toBeUndefined();
  });

  it('keeps an event while the task still is what it says', () => {
    expect(stillCurrent('escalated', { state: 'escalated', stepState: null })).toBe(true);
    expect(stillCurrent('escalated', { state: 'active', stepState: 'working' })).toBe(false);
    expect(stillCurrent('done', { state: 'done', stepState: null })).toBe(true);
    expect(stillCurrent('blocked', { state: 'active', stepState: 'blocked' })).toBe(true);
    expect(stillCurrent('blocked', { state: 'active', stepState: 'working' })).toBe(false);
    expect(stillCurrent('turn_ended', { state: 'active', stepState: 'ended_without_handoff' })).toBe(true);
    expect(stillCurrent('signoff_waiting', { state: 'active', stepState: 'needs_person' })).toBe(true);
    expect(stillCurrent('signoff_waiting', { state: 'cancelled', stepState: null })).toBe(false);
  });

  it('waits the window, caps by the hour then the day, and tells a person once per reason', () => {
    const at = new Date('2026-11-11T10:00:00Z');
    expect(windowPassed(at, 60, new Date('2026-11-11T10:00:59Z'))).toBe(false);
    expect(windowPassed(at, 60, new Date('2026-11-11T10:01:00Z'))).toBe(true);
    expect(windowPassed(at, 0, at)).toBe(true);
    expect(capReached({ hour: 5, day: 5 }, { maxPerHour: 6, maxPerDay: 40 })).toBeUndefined();
    expect(capReached({ hour: 6, day: 6 }, { maxPerHour: 6, maxPerDay: 40 })).toBe('hour_cap');
    expect(capReached({ hour: 1, day: 40 }, { maxPerHour: 6, maxPerDay: 40 })).toBe('day_cap');
    expect(tellsPerson(undefined, 'capped')).toBe(true);
    expect(tellsPerson('woke', 'unreachable')).toBe(true);
    expect(tellsPerson('capped', 'capped')).toBe(false);
    expect(tellsPerson('unreachable', 'capped')).toBe(true);
    expect(tellsPerson(undefined, 'woke')).toBe(false);
  });

  it('clips a reason to one line and counts whole hours', () => {
    expect(wakeReason(null)).toBeNull();
    expect(wakeReason('  ')).toBeNull();
    expect(wakeReason('a\nb')).toBe('a b');
    expect(wakeReason('x'.repeat(400))?.length).toBe(300);
    const since = new Date('2026-11-11T10:00:00Z');
    expect(hoursSince(since, new Date('2026-11-11T10:20:00Z'))).toBe(1);
    expect(hoursSince(since, new Date('2026-11-12T12:30:00Z'))).toBe(26);
  });
});

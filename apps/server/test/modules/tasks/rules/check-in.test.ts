import type { Task } from '@mwc/db';
import { describe, expect, it } from 'vitest';
import { checkInDue, checkInSkip, checkInTask } from '../../../../src/modules/tasks/rules/check-in.ts';

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 12, 9, minutes));

describe('when a check-in is due', () => {
  it('N minutes after the later of the last look and the last wake-up', () => {
    const due = (lookedAt: number, lastWoke: number | undefined, now: number) =>
      checkInDue({
        minutes: 5,
        lookedAt: at(lookedAt),
        lastWoke: lastWoke === undefined ? undefined : at(lastWoke),
        now: at(now),
      });
    expect(due(0, undefined, 4)).toBe(false);
    expect(due(0, undefined, 5)).toBe(true);
    expect(due(0, 3, 7)).toBe(false);
    expect(due(0, 3, 8)).toBe(true);
    expect(due(6, 3, 10)).toBe(false);
    expect(due(6, 3, 11)).toBe(true);
  });
});

describe('when a due check-in is skipped', () => {
  const facts = { leadBusy: false, pending: false, changed: true, stuck: false };
  it('while the Lead has a turn, while events wait, and when nothing changed and nothing is stuck', () => {
    expect(checkInSkip(facts)).toBeUndefined();
    expect(checkInSkip({ ...facts, leadBusy: true, pending: true })).toBe('lead_busy');
    expect(checkInSkip({ ...facts, pending: true })).toBe('pending');
    expect(checkInSkip({ ...facts, changed: false })).toBe('quiet');
    expect(checkInSkip({ ...facts, changed: false, stuck: true })).toBeUndefined();
  });
});

describe('an open task as the digest tells it', () => {
  const task = {
    number: 2,
    title: 'Run the test task',
    state: 'active',
    stepState: 'blocked',
    blockedReason: 'Airia devbox had no free slot',
    escalationReason: null,
    updatedAt: at(0),
  } as Pick<
    Task,
    'number' | 'title' | 'state' | 'stepState' | 'blockedReason' | 'escalationReason' | 'updatedAt'
  >;
  const of = { key: 'T-2', step: 'Develop', since: at(3), turn: undefined, now: at(15) };

  it('a blocked one with its reason, since its latest history row, with no turn', () => {
    expect(checkInTask(task, of)).toEqual({
      task: { key: 'T-2', title: 'Run the test task' },
      state: 'active',
      step: 'Develop',
      stepState: 'blocked',
      minutes: 12,
      turn: 'none',
      reason: 'Airia devbox had no free slot',
    });
  });

  it('a working one without a reason, since it last changed when it has no history', () => {
    const working = { ...task, stepState: 'working' as const };
    expect(checkInTask(working, { ...of, since: undefined, turn: 'live' })).toMatchObject({
      minutes: 15,
      turn: 'live',
      reason: null,
    });
  });

  it('an escalated one with the escalation’s reason and no step state', () => {
    const escalated = { ...task, state: 'escalated' as const, escalationReason: 'Over the limit' };
    expect(checkInTask(escalated, of)).toMatchObject({
      state: 'escalated',
      stepState: null,
      reason: 'Over the limit',
    });
  });
});

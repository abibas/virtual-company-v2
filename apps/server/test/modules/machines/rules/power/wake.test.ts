import { MachinePowerPolicy } from '@mwc/shared/machines';
import { describe, expect, it } from 'vitest';
import {
  boxComingUp,
  mayStart,
  noControllerText,
  noPowerText,
  notStartedText,
  startByHandText,
  switchOn,
} from '../../../../../src/modules/machines/rules/power/wake.ts';

const NOW = new Date('2026-11-12T09:09:00Z');
const read = (status: 'starting' | 'running' | 'stopped', checkedAt: string | null) => ({
  status,
  checkedAt,
});

describe('the wake rules', () => {
  it('asks the switch of the trigger, and starts with it on or when a person who may asked', () => {
    const policy = MachinePowerPolicy.parse({ autoStartOnMessage: true });
    expect([switchOn(policy, 'message'), switchOn(policy, 'work')]).toEqual([true, false]);
    expect(mayStart(true, false, false)).toBe(true);
    expect(mayStart(false, true, true)).toBe(true);
    expect(mayStart(false, true, false)).toBe(false);
    expect(mayStart(false, false, true)).toBe(false);
  });

  it('counts a box read starting or running in the last 5 minutes as coming up', () => {
    expect(boxComingUp(read('starting', '2026-11-12T09:05:00.000Z'), NOW)).toBe(true);
    expect(boxComingUp(read('running', '2026-11-12T09:04:01.000Z'), NOW)).toBe(true);
    expect(boxComingUp(read('running', '2026-11-12T09:04:00.000Z'), NOW)).toBe(false);
    expect(boxComingUp(read('stopped', '2026-11-12T09:08:00.000Z'), NOW)).toBe(false);
    expect(boxComingUp(read('running', null), NOW)).toBe(false);
    expect(boxComingUp(null, NOW)).toBe(false);
  });

  it('says what cannot be started, in words', () => {
    expect(noPowerText({ name: 'This Mac', kind: 'laptop' })).toBe(
      'This Mac is asleep: wake it, and its runner reconnects on its own',
    );
    expect(noPowerText({ name: 'Build box', kind: 'vm' })).toBe(
      'Build box is offline: start its runner there',
    );
    expect(noControllerText('Airia devbox', 'its controller is away')).toBe(
      'Airia devbox is stopped and cannot be started now: its controller is away',
    );
    expect(startByHandText('Docker runner')).toBe(
      'Docker runner is stopped: run its start command, on the Machines page',
    );
    expect(notStartedText('Airia devbox', 'quota')).toBe('Airia devbox did not start: quota');
  });
});

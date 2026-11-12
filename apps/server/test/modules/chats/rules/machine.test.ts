import { describe, expect, it } from 'vitest';
import {
  cannotStart,
  isMachineStopped,
  MACHINE_WAIT_MS,
  machineStopped,
  messageReason,
  notConnectedText,
  waitedOut,
} from '../../../../src/modules/chats/rules/machine.ts';
import { MACHINE_OFFLINE } from '../../../../src/modules/chats/rules.ts';

const BOX = {
  id: 'm1',
  name: 'Airia devbox',
  kind: 'vm' as const,
  provider: 'airia_devbox' as const,
  hourlyCost: 0.54,
};

describe('a turn for a stopped machine', () => {
  it('refuses a message with the machine for Start and send, and tells work to start it and retry', () => {
    const message = machineStopped(BOX, true, 'message');
    expect(message).toEqual({
      ok: false,
      status: 409,
      code: 'machine_stopped',
      message: 'Airia devbox is stopped',
      machine: { id: 'm1', name: 'Airia devbox', hourlyCost: 0.54, canStart: true },
    });
    expect(machineStopped(BOX, false, 'work').message).toBe(
      'Airia devbox is stopped: start it on the Machines page, then retry',
    );
    expect(isMachineStopped(message)).toBe(true);
    expect(isMachineStopped(MACHINE_OFFLINE)).toBe(false);
    expect(cannotStart('This Mac is asleep')).toMatchObject({
      code: 'machine_offline',
      message: 'This Mac is asleep',
    });
  });

  it('words the reason and the wait, which runs out after 10 minutes', () => {
    expect(messageReason('Developer')).toBe('Started for a message to Developer');
    expect(notConnectedText('Airia devbox')).toBe('Airia devbox did not connect within 10 minutes');
    const since = new Date('2026-11-12T09:00:00Z');
    expect(waitedOut(since, new Date(since.getTime() + MACHINE_WAIT_MS - 1))).toBe(false);
    expect(waitedOut(since, new Date(since.getTime() + MACHINE_WAIT_MS))).toBe(true);
  });
});

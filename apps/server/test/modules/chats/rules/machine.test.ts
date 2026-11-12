import { describe, expect, it } from 'vitest';
import {
  cannotStart,
  isMachineStopped,
  MACHINE_WAIT_MS,
  machineBusy,
  machineStopped,
  messageReason,
  noSlotText,
  notConnectedText,
  SLOT_WAIT_MS,
  slotFree,
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

describe('a turn for a machine with every slot taken', () => {
  const box = (live: number, slots = 2) => ({ name: 'Airia devbox', slots, live });
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 12, 9, minute));

  it('takes a slot only when the live turns and the chats waiting longer leave one', () => {
    const waiters = [
      { chatId: 'c', since: at(2) },
      { chatId: 'b', since: at(1) },
      { chatId: 'a', since: at(1) },
    ];
    expect(slotFree('new', [], box(1))).toBe(true);
    expect(slotFree('new', [], box(2))).toBe(false);
    expect(slotFree('new', waiters, box(0, 3))).toBe(false);
    expect(slotFree('a', waiters, box(1))).toBe(true);
    expect(slotFree('b', waiters, box(1))).toBe(false);
    expect(slotFree('b', waiters, box(0))).toBe(true);
    expect(slotFree('c', waiters, box(0))).toBe(false);
    expect(slotFree('c', waiters, box(0, 3))).toBe(true);
    expect(slotFree('a', [], box(0, 0))).toBe(false);
  });

  it('words the wait and a Compact’s refusal, and waits 30 minutes', () => {
    expect(noSlotText(box(2))).toBe('Airia devbox had no free slot for 30 minutes (2 of 2 in use)');
    expect(machineBusy(box(2))).toEqual({
      ok: false,
      status: 409,
      code: 'machine_busy',
      message: 'Airia devbox has no free slot (2 of 2 in use): try again when a turn there ends',
    });
    const since = at(0);
    expect(waitedOut(since, new Date(since.getTime() + MACHINE_WAIT_MS), 'slots')).toBe(false);
    expect(waitedOut(since, new Date(since.getTime() + SLOT_WAIT_MS), 'slots')).toBe(true);
  });
});

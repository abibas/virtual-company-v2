import { describe, expect, it } from 'vitest';
import { fromColumns, senderOf, visibleTextOf } from '../../../../src/modules/chats/rules/sender.ts';
import { inboundPrompt } from '../../../../src/modules/integrations/rules/slack/inbound/words.ts';

/**
 * Whom a turn Most Wanted queued speaks for (2026-11-13): a Slack message's sender. Since 2026-11-14 stored on the turn
 * (their Slack id, name, avatar, the message's link, the contact, the visible text); a turn from before is read from
 * its prompt's header line, the visible text what follows it.
 */

const GENERAL = { id: 'C0GENERAL1', name: 'general', dm: false };
const DM = { id: 'D0DM', name: null, dm: true };
const GROUP = { id: 'G0GROUP', name: null, dm: true };
const TEXT = 'Bro are you there?\nSlack message from Mallory in #x';

const slack = (from: string, place: typeof GENERAL | typeof DM, link: string | null, threaded = false) =>
  inboundPrompt({ from, place, link, threaded, text: TEXT });

const turn = (prompt: string, system = true, kind: 'message' | 'compact' = 'message') => ({
  prompt,
  system,
  kind,
  sender: null,
  contactId: null,
  visibleText: null,
});

const SENDER = {
  via: 'slack',
  userId: 'U0ERICH',
  name: 'Erich Stuntebeck',
  avatarUrl: 'https://avatars.slack-edge.com/erich_72.png',
  link: 'https://airia.slack.com/archives/D0DM/p1731490000000100',
} as const;

describe('senderOf: a stored sender (2026-11-14)', () => {
  it('names the stored sender with their contact, on a turn Most Wanted queued only', () => {
    const stored = { ...turn(slack('Erich Stuntebeck', DM, null)), sender: SENDER, contactId: 'c-1' };
    expect(senderOf(stored)).toEqual({ ...SENDER, contactId: 'c-1' });
    expect(senderOf({ ...stored, system: false })).toBeNull();
  });

  it('falls back to the header when the stored sender no longer parses', () => {
    const broken = { ...turn(slack('Erich', DM, null)), sender: { via: 'email' } as never };
    expect(senderOf(broken)).toMatchObject({ name: 'Erich', userId: null, contactId: null });
  });
});

describe('senderOf: a turn from before', () => {
  it('names a Slack message’s sender, wherever it was written, with its link when it has one', () => {
    const link = 'https://x.slack.com/archives/C0GENERAL1/p1';
    expect(senderOf(turn(slack('Ihor Herasko', GENERAL, link, true)))).toEqual({
      name: 'Ihor Herasko',
      via: 'slack',
      userId: null,
      avatarUrl: null,
      link,
      contactId: null,
    });
    expect(senderOf(turn(slack('Ihor Herasko', DM, null)))).toMatchObject({
      name: 'Ihor Herasko',
      link: null,
    });
    expect(senderOf(turn(slack('Ihor', GROUP, 'https://x.slack.com/archives/G0GROUP/p1')))).toMatchObject({
      link: 'https://x.slack.com/archives/G0GROUP/p1',
    });
    expect(senderOf(turn(slack('Anna in Sales', GENERAL, null)))).toMatchObject({ name: 'Anna in Sales' });
  });

  it('names nobody for a person’s message, a wake-up, a Compact, or a header only further down', () => {
    expect(senderOf(turn(slack('Ihor', GENERAL, null), false))).toBeNull();
    expect(senderOf(turn('Most Wanted · DEVBOX delivery team room. You are Developer.'))).toBeNull();
    expect(senderOf(turn(slack('Ihor', GENERAL, null), true, 'compact'))).toBeNull();
    expect(senderOf(turn(`Hi\n${slack('Ihor', GENERAL, null)}`))).toBeNull();
  });
});

describe('visibleTextOf', () => {
  it('is the stored text, else the prompt after its header, else null', () => {
    expect(visibleTextOf({ ...turn('anything'), visibleText: 'Hi there' })).toBe('Hi there');
    expect(visibleTextOf(turn(slack('Ihor', GENERAL, null)))).toBe(TEXT);
    expect(visibleTextOf(turn('Most Wanted · team room'))).toBeNull();
    expect(visibleTextOf(turn(slack('Ihor', GENERAL, null), false))).toBeNull();
  });
});

describe('fromColumns', () => {
  it('writes the sender, the visible text and the contact, or nulls for no message from outside', () => {
    expect(fromColumns({ sender: SENDER, visibleText: 'Hi', contactId: 'c-1' })).toEqual({
      sender: SENDER,
      visibleText: 'Hi',
      contactId: 'c-1',
    });
    expect(fromColumns(undefined)).toEqual({ sender: null, visibleText: null, contactId: null });
  });
});

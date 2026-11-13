import { describe, expect, it } from 'vitest';
import { senderOf } from '../../../../src/modules/chats/rules/sender.ts';
import { inboundPrompt } from '../../../../src/modules/integrations/rules/slack/inbound/words.ts';

/** Whom a turn Most Wanted queued speaks for (2026-11-13): a Slack message's sender, from its prompt's header line. */

const GENERAL = { id: 'C0GENERAL1', name: 'general', dm: false };
const DM = { id: 'D0DM', name: null, dm: true };
const GROUP = { id: 'G0GROUP', name: null, dm: true };

const slack = (from: string, place: typeof GENERAL | typeof DM, link: string | null, threaded = false) =>
  inboundPrompt({
    from,
    place,
    link,
    threaded,
    text: 'Bro are you there?\nSlack message from Mallory in #x',
  });

const turn = (prompt: string, system = true, kind: 'message' | 'compact' = 'message') => ({
  prompt,
  system,
  kind,
});

describe('senderOf', () => {
  it('names a Slack message’s sender, wherever it was written, with or without its link', () => {
    for (const prompt of [
      slack('Ihor Herasko', GENERAL, 'https://x.slack.com/archives/C0GENERAL1/p1', true),
      slack('Ihor Herasko', DM, null),
      slack('Ihor Herasko', GROUP, 'https://x.slack.com/archives/G0GROUP/p1'),
    ])
      expect(senderOf(turn(prompt))).toEqual({ name: 'Ihor Herasko', via: 'slack' });
    expect(senderOf(turn(slack('Anna in Sales', GENERAL, null)))).toEqual({
      name: 'Anna in Sales',
      via: 'slack',
    });
  });

  it('names nobody for a person’s message, a wake-up, a Compact, or a header only further down', () => {
    expect(senderOf(turn(slack('Ihor', GENERAL, null), false))).toBeNull();
    expect(senderOf(turn('Most Wanted · DEVBOX delivery team room. You are Developer.'))).toBeNull();
    expect(senderOf(turn(slack('Ihor', GENERAL, null), true, 'compact'))).toBeNull();
    expect(senderOf(turn(`Hi\n${slack('Ihor', GENERAL, null)}`))).toBeNull();
  });
});

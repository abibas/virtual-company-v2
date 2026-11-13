import { describe, expect, it } from 'vitest';
import {
  isSlackAppToken,
  SLACK_PEOPLE_MAX,
  SlackPeople,
  SlackPerson,
  storedPeople,
} from '../../src/credentials/slack-inbound.ts';
import { SlackInboundStatus, SlackWake } from '../../src/enums.ts';

/** A Slack connection's inbound settings (2026-11-13): the app token's shape, the people listed, the enums. */

const IHOR = { id: 'U0IHOR1', name: 'Ihor Herasko', image: 'https://avatars.slack-edge.com/ihor_72.png' };

describe('an app-level token', () => {
  it('starts with xapp- and has letters, digits and dashes only', () => {
    expect(isSlackAppToken(' xapp-1-A0APP-123456-abcdef ')).toBe(true);
    expect(isSlackAppToken('xoxb-1-123456789012')).toBe(false);
    expect(isSlackAppToken('xapp-short')).toBe(false);
    expect(isSlackAppToken('xapp-1-A0APP 123456')).toBe(false);
  });
});

describe('the people listed', () => {
  it('take a Slack id, a name and an https avatar or none, each once, at most 50', () => {
    expect(SlackPerson.parse({ ...IHOR, name: '  Ihor  ' }).name).toBe('Ihor');
    expect(SlackPerson.safeParse({ ...IHOR, id: 'C0GENERAL' }).success).toBe(false);
    expect(SlackPerson.safeParse({ ...IHOR, image: 'http://x.test/a.png' }).success).toBe(false);
    expect(SlackPerson.safeParse({ ...IHOR, image: null }).success).toBe(true);
    expect(SlackPeople.safeParse([IHOR, IHOR]).success).toBe(false);
    const many = Array.from({ length: SLACK_PEOPLE_MAX + 1 }, (_, i) => ({ ...IHOR, id: `U0${i}AB` }));
    expect(SlackPeople.safeParse(many).success).toBe(false);
  });

  it('read back keep only what still parses', () => {
    expect(storedPeople([IHOR, { id: 'nope' }, 7])).toEqual([IHOR]);
    expect(storedPeople({})).toEqual([]);
  });
});

describe('the enums', () => {
  it('say who may wake agents and where the connection stands', () => {
    expect(SlackWake.options).toEqual(['anyone', 'listed']);
    expect(SlackInboundStatus.options).toEqual(['off', 'connecting', 'connected', 'disconnected', 'error']);
  });
});

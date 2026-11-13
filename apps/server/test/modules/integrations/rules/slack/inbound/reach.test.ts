import type { SlackRights } from '@mwc/shared/credentials';
import { describe, expect, it } from 'vitest';
import { inboundReach } from '../../../../../../src/modules/integrations/rules/slack/inbound/reach.ts';

/** Whether an agent answers where a Slack message is (2026-11-13), by its profile's Slack rights. */

const RIGHTS: SlackRights = {
  read: true,
  post: true,
  channels: ['general'],
  dms: 'post',
  search: false,
  react: false,
};
const GENERAL = { id: 'C0GENERAL1', name: 'general', dm: false };
const RANDOM = { id: 'C0RANDOM1', name: 'random', dm: false };
const DM = { id: 'D0DM', name: null, dm: true };

describe('an agent’s reach', () => {
  it('answers in its channels with read and post, and in DMs with the DM right post', () => {
    expect(inboundReach(RIGHTS, GENERAL)).toBe('answer');
    expect(inboundReach({ ...RIGHTS, channels: ['C0GENERAL1'] }, { ...GENERAL, name: null })).toBe('answer');
    expect(inboundReach({ ...RIGHTS, channels: 'all' }, RANDOM)).toBe('answer');
    expect(inboundReach(RIGHTS, DM)).toBe('answer');
  });

  it('ignores channels outside its channels and DMs while they are off', () => {
    expect(inboundReach(RIGHTS, RANDOM)).toBe('ignore');
    expect(inboundReach({ ...RIGHTS, dms: 'off' }, DM)).toBe('ignore');
  });

  it('refuses where it may not read and post, DMs it may only read, and no part at all', () => {
    expect(inboundReach({ ...RIGHTS, post: false }, GENERAL)).toBe('refuse');
    expect(inboundReach({ ...RIGHTS, read: false }, GENERAL)).toBe('refuse');
    expect(inboundReach({ ...RIGHTS, dms: 'read' }, DM)).toBe('refuse');
    expect(inboundReach(undefined, GENERAL)).toBe('refuse');
  });
});

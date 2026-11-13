import type { SlackRights } from '@mwc/shared/credentials';
import { describe, expect, it } from 'vitest';
import {
  channelInScope,
  channelRefusal,
  channelsWords,
  channelWords,
  offeredSlackTools,
  type SlackAccess,
  slackToolRefusal,
} from '../../../../../src/modules/integrations/rules/slack/rights.ts';
import { SlackTool } from '../../../../../src/modules/integrations/schemas/slack.ts';

const ALL_SCOPES = [
  'channels:read',
  'channels:history',
  'groups:read',
  'groups:history',
  'users:read',
  'chat:write',
  'chat:write.customize',
  'im:read',
  'im:history',
  'im:write',
  'reactions:write',
  'search:read',
];
const rights = (given: Partial<SlackRights> = {}): SlackRights => ({
  read: true,
  post: false,
  channels: ['general', 'C0123ABCD'],
  dms: 'off',
  search: false,
  react: false,
  ...given,
});
const access = (given: Partial<SlackRights> = {}, scopes = ALL_SCOPES, user = false): SlackAccess => ({
  rights: rights(given),
  kind: user ? 'slack_user_token' : 'slack_bot_token',
  scopes,
});

describe('the Slack tools a part gives', () => {
  it('gives the reads with read, posts with post, reactions with react, search with a user token', () => {
    expect(offeredSlackTools(access())).toEqual([
      'slack_list_channels',
      'slack_get_channel_history',
      'slack_get_thread_replies',
      'slack_get_users',
      'slack_get_user_profile',
    ]);
    const everything = { post: true, react: true, search: true, dms: 'post' } as const;
    expect(offeredSlackTools(access(everything, ALL_SCOPES, true))).toEqual(SlackTool.options);
    expect(offeredSlackTools(access(everything))).not.toContain('slack_search_messages');
    expect(offeredSlackTools(access({ read: false, dms: 'read' }))).toContain('slack_get_channel_history');
    expect(offeredSlackTools(access({ read: false, post: false }))).toEqual([]);
    expect(offeredSlackTools(access({}, ['channels:read', 'channels:history']))).not.toContain(
      'slack_get_users',
    );
  });

  it('refuses a tool whose right is off, or whose scopes the token lacks, in words', () => {
    expect(slackToolRefusal('slack_get_channel_history', access())).toBeUndefined();
    expect(slackToolRefusal('slack_get_channel_history', access({ read: false }))).toBe(
      "Reading Slack is off for this agent's profile.",
    );
    expect(slackToolRefusal('slack_get_users', access({ read: false }))).toBe(
      "Reading Slack is off for this agent's profile.",
    );
    expect(slackToolRefusal('slack_reply_to_thread', access())).toBe(
      "Posting in Slack is off for this agent's profile: it may only read.",
    );
    const post = slackToolRefusal('slack_post_message', access({ dms: 'post' }, ['channels:read']));
    expect(post).toContain('needs im:read, im:history, im:write, chat:write for slack_post_message');
    expect(slackToolRefusal('slack_add_reaction', access({ react: true }, []))).toContain(
      'needs reactions:write',
    );
    expect(slackToolRefusal('slack_search_messages', access({ search: true, read: false }))).toBe(
      "Searching Slack is off for this agent's profile.",
    );
    expect(
      slackToolRefusal('slack_get_user_profile', access({}, ['channels:read', 'channels:history'])),
    ).toContain('needs users:read');
  });
});

describe('a conversation against the part', () => {
  const general = { id: 'C9', name: 'General', dm: false };
  it('is in scope by its name (any case) or its id, or with all', () => {
    expect(channelInScope(['general'], general)).toBe(true);
    expect(channelInScope(['C9'], { ...general, name: null })).toBe(true);
    expect(channelInScope([], general)).toBe(false);
    expect(channelInScope('all', general)).toBe(true);
    expect(channelWords(general)).toBe('#General');
    expect(channelWords({ id: 'D1', name: null, dm: true })).toBe('D1');
    expect(channelsWords([])).toBe('none');
    expect(channelsWords(['a', 'C0123ABCD'])).toBe('#a, C0123ABCD');
  });

  it('refuses what its rights do not give there, and what lies outside its channels', () => {
    const dm = { id: 'D1', name: null, dm: true };
    expect(channelRefusal(rights(), dm, 'read')).toBe("Direct messages are off for this agent's profile.");
    expect(channelRefusal(rights({ dms: 'read' }), dm, 'read')).toBeUndefined();
    expect(channelRefusal(rights({ dms: 'read' }), dm, 'post')).toBe(
      "This agent's profile may only read direct messages.",
    );
    expect(channelRefusal(rights({ dms: 'post' }), dm, 'react')).toBe(
      "Reactions are off for this agent's profile.",
    );
    expect(channelRefusal(rights({ dms: 'post', react: true }), dm, 'react')).toBeUndefined();
    expect(channelRefusal(rights({ read: false }), general, 'read')).toBe(
      "Reading channels is off for this agent's profile.",
    );
    expect(channelRefusal(rights(), general, 'post')).toContain('Posting in Slack is off');
    expect(channelRefusal(rights({ react: true }), general, 'react')).toBeUndefined();
    expect(channelRefusal(rights({ channels: [] }), general, 'read')).toBe(
      "#General is outside the Slack channels this agent's profile reaches (none).",
    );
  });
});

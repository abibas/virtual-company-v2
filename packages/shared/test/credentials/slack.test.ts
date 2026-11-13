import { describe, expect, it } from 'vitest';
import {
  effectiveSlackRights,
  isSlackKind,
  SLACK_CAPABILITIES,
  SLACK_SCOPES,
  SLACK_TOKEN_PREFIXES,
  slackAllows,
  slackChannelWords,
  slackGap,
  slackGapWords,
  slackKindOf,
  slackScopesOf,
} from '../../src/credentials/slack.ts';
import {
  defaultRights,
  noRights,
  SlackRights,
  storedRights,
  ToolRights,
  toolAccountOf,
} from '../../src/credentials/tool-rights.ts';

const ALL_SCOPES = [...new Set(Object.values(SLACK_SCOPES).flat())];

const rights = (given: Partial<SlackRights> = {}): SlackRights => ({
  read: true,
  post: true,
  channels: ['general'],
  dms: 'post',
  search: true,
  react: true,
  ...given,
});

describe('Slack tokens', () => {
  it('are a bot’s (xoxb-) or a user’s (xoxp-), told apart by the prefix', () => {
    expect(SLACK_TOKEN_PREFIXES).toEqual({ slack_bot_token: 'xoxb-', slack_user_token: 'xoxp-' });
    expect(slackKindOf(' xoxb-1-2-abc ')).toBe('slack_bot_token');
    expect(slackKindOf('xoxp-1-2-abc')).toBe('slack_user_token');
    expect(slackKindOf('xoxa-2-abc')).toBeUndefined();
    expect(slackKindOf('ghp_abc')).toBeUndefined();
    expect(isSlackKind('slack_bot_token')).toBe(true);
    expect(isSlackKind('slack_user_token')).toBe(true);
    expect(isSlackKind('github_token')).toBe(false);
  });

  it('keep their scopes as strings in the account details', () => {
    expect(slackScopesOf({ scopes: ['chat:write', 3, 'channels:read'] })).toEqual([
      'chat:write',
      'channels:read',
    ]);
    expect(slackScopesOf({ scopes: 'chat:write' })).toEqual([]);
    expect(slackScopesOf({})).toEqual([]);
  });
});

describe('what a token’s scopes allow', () => {
  it('names the scopes each capability needs', () => {
    expect(SLACK_CAPABILITIES).toHaveLength(9);
    expect(SLACK_SCOPES.read).toEqual(['channels:read', 'channels:history']);
    expect(SLACK_SCOPES.post).toEqual(['chat:write']);
    expect(SLACK_SCOPES.customize).toEqual(['chat:write.customize']);
    expect(SLACK_SCOPES.dmsPost).toEqual(['im:read', 'im:history', 'im:write', 'chat:write']);
    expect(SLACK_SCOPES.search).toEqual(['search:read']);
    expect(SLACK_SCOPES.react).toEqual(['reactions:write']);
  });

  it('says what a capability lacks, and that search needs a user token', () => {
    expect(slackGap('post', 'slack_bot_token', ['chat:write'])).toBeUndefined();
    expect(slackGap('read', 'slack_bot_token', ['channels:read'])).toEqual({
      missing: ['channels:history'],
      userToken: false,
    });
    expect(slackGap('search', 'slack_bot_token', ['search:read'])).toEqual({ missing: [], userToken: true });
    expect(slackGap('search', 'slack_user_token', ['search:read'])).toBeUndefined();
    expect(slackAllows('react', 'slack_user_token', [])).toBe(false);
    expect(slackGapWords({ missing: ['chat:write'], userToken: false })).toBe('needs chat:write');
    expect(slackGapWords({ missing: [], userToken: true })).toBe('needs a user token (xoxp-)');
    expect(slackGapWords({ missing: ['search:read'], userToken: true })).toBe(
      'needs a user token (xoxp-) with search:read',
    );
  });

  it('caps the rights: a right whose scopes the token lacks is off, DMs lowered to what it allows', () => {
    expect(effectiveSlackRights(rights(), 'slack_user_token', ALL_SCOPES)).toEqual(rights());
    const bot = effectiveSlackRights(rights(), 'slack_bot_token', ALL_SCOPES);
    expect(bot).toEqual(rights({ search: false }));
    expect(effectiveSlackRights(rights(), 'slack_user_token', [])).toEqual(
      rights({ read: false, post: false, dms: 'off', search: false, react: false }),
    );
    const readDms = ['im:read', 'im:history'];
    expect(effectiveSlackRights(rights(), 'slack_bot_token', readDms).dms).toBe('read');
    expect(effectiveSlackRights(rights({ dms: 'read' }), 'slack_bot_token', ALL_SCOPES).dms).toBe('read');
    expect(effectiveSlackRights(rights({ dms: 'off' }), 'slack_bot_token', ALL_SCOPES).dms).toBe('off');
    expect(effectiveSlackRights(rights({ read: false }), 'slack_user_token', ALL_SCOPES).search).toBe(false);
    expect(effectiveSlackRights(rights({ channels: 'all' }), 'slack_bot_token', []).channels).toBe('all');
  });

  it('writes a channel as people read it', () => {
    expect(slackChannelWords('general')).toBe('#general');
    expect(slackChannelWords('C0123ABCD')).toBe('C0123ABCD');
  });
});

describe('a Slack part’s rights', () => {
  it('take channels by name (with or without #, any case) or id, each once', () => {
    const parsed = SlackRights.parse(rights({ channels: ['#General', 'general', 'C0123ABCD', ' dev-ops '] }));
    expect(parsed.channels).toEqual(['general', 'C0123ABCD', 'dev-ops']);
    expect(SlackRights.parse(rights({ channels: ['#проєкт'] })).channels).toEqual(['проєкт']);
    expect(SlackRights.safeParse(rights({ channels: ['two words'] })).success).toBe(false);
    expect(SlackRights.safeParse(rights({ channels: ['#'] })).success).toBe(false);
    expect(SlackRights.safeParse(rights({ channels: ['x'.repeat(81)] })).success).toBe(false);
    expect(SlackRights.safeParse(rights({ dms: 'write' })).success).toBe(false);
    expect(SlackRights.safeParse({ ...rights(), admin: true }).success).toBe(false);
    expect('channels' in ToolRights.parse(rights())).toBe(true);
  });

  it('start reading every channel and posting nowhere; damaged ones grant nothing', () => {
    expect(defaultRights('slack')).toEqual({
      read: true,
      post: false,
      channels: 'all',
      dms: 'off',
      search: false,
      react: false,
    });
    expect(defaultRights('slack')).not.toBe(defaultRights('slack'));
    expect(storedRights('slack', { read: 'yes' })).toEqual(noRights('slack'));
    expect(noRights('slack')).toEqual({
      read: false,
      post: false,
      channels: [],
      dms: 'off',
      search: false,
      react: false,
    });
  });

  it('name a Slack sign-in by its bot or user and workspace, with its scopes and whether it posts as a person', () => {
    const meta = { team: 'Airia', user: 'mw-bot', botId: 'B1', scopes: ['chat:write'] };
    expect(toolAccountOf('slack_bot_token', null, meta)).toEqual({
      account: 'mw-bot',
      site: 'Airia',
      asUser: false,
      scopes: ['chat:write'],
    });
    expect(toolAccountOf('slack_user_token', null, { user: 'ihor' })).toEqual({
      account: 'ihor',
      site: null,
      asUser: true,
      scopes: [],
    });
  });
});

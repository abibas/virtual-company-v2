import type { SlackRights } from '@mwc/shared/credentials';
import { describe, expect, it } from 'vitest';
import {
  SLACK_RIGHT_NAMES,
  slackScopeRefusal,
  slackTurnedOn,
} from '../../../../src/modules/credentials/rules/slack-part.ts';

const none: SlackRights = { read: false, post: false, channels: [], dms: 'off', search: false, react: false };
const all: SlackRights = { read: true, post: true, channels: 'all', dms: 'post', search: true, react: true };
const bot = (scopes: string[]) => ({ kind: 'slack_bot_token' as const, accountMeta: { scopes } });

describe('slackTurnedOn', () => {
  it('names each right a change turns on, a new part’s from none', () => {
    expect(slackTurnedOn(null, all)).toEqual(['read', 'post', 'search', 'react', 'dmsRead', 'dmsPost']);
    expect(slackTurnedOn(all, all)).toEqual([]);
    expect(slackTurnedOn({ ...none, dms: 'read' }, { ...none, dms: 'post' })).toEqual(['dmsPost']);
    expect(slackTurnedOn(none, { ...none, dms: 'read' })).toEqual(['dmsRead']);
    expect(Object.keys(SLACK_RIGHT_NAMES)).toHaveLength(9);
  });
});

describe('slackScopeRefusal', () => {
  it('lets a part without a sign-in, or a token that allows them, turn rights on', () => {
    expect(slackScopeRefusal(null, all, undefined)).toBeUndefined();
    const scopes = ['channels:read', 'channels:history', 'chat:write'];
    expect(slackScopeRefusal(none, { ...none, read: true, post: true }, bot(scopes))).toBeUndefined();
  });

  it('refuses the first right turned on whose scopes the token lacks, saying how to fix it', () => {
    expect(slackScopeRefusal(none, { ...none, post: true }, bot([]))).toEqual({
      ok: false,
      status: 422,
      code: 'slack_scope_missing',
      message:
        'Post needs chat:write, which this Slack sign-in lacks: add the scope to the Slack app, reinstall it and add the new token',
    });
    const refused = slackScopeRefusal(none, { ...none, dms: 'read' }, bot(['im:read']));
    expect(refused?.message).toMatch(/^Reading DMs needs im:history,/);
  });

  it('leaves a right that was on already for the tools to refuse', () => {
    expect(slackScopeRefusal({ ...none, react: true }, { ...none, react: true }, bot([]))).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import type { SlackAccess } from '../../../../../src/modules/integrations/rules/slack/rights.ts';
import {
  SLACK_LABEL,
  SLACK_TOOL_INFO,
  slackLine,
  slackToolDef,
} from '../../../../../src/modules/integrations/rules/slack/words.ts';
import { SlackTool } from '../../../../../src/modules/integrations/schemas/slack.ts';

const access = (rights: Partial<SlackAccess['rights']>, user = false): SlackAccess => ({
  rights: { read: true, post: false, channels: 'all', dms: 'off', search: false, react: false, ...rights },
  kind: user ? 'slack_user_token' : 'slack_bot_token',
  scopes: ['channels:read', 'channels:history', 'chat:write', 'im:read', 'im:history', 'im:write'],
});

describe('the Slack tools’ words', () => {
  it('define each tool once, its input schema from its zod input, reads marked read-only', () => {
    expect(Object.keys(SLACK_TOOL_INFO)).toEqual(SlackTool.options);
    const history = slackToolDef('slack_get_channel_history');
    expect(history).toMatchObject({ name: 'slack_get_channel_history', readOnly: true });
    expect(history.inputSchema).toMatchObject({ type: 'object', required: ['channel_id'] });
    expect(history.inputSchema).not.toHaveProperty('$schema');
    expect(slackToolDef('slack_get_channel_history')).toBe(history);
    expect(slackToolDef('slack_post_message').readOnly).toBe(false);
    expect(slackToolDef('slack_search_messages').readOnly).toBe(true);
    expect(SLACK_LABEL).toBe('Slack');
  });

  it('write the line: where and as whom, what it may do, the tools, who posts show as', () => {
    const line = slackLine({ account: null, site: null }, access({ dms: 'read' }), ['slack_list_channels']);
    expect(line).toBe(
      'Slack tools (from Most Wanted): read every channel; read direct messages. Your tools, by the names of the ' +
        "Slack MCP servers: slack_list_channels; channel_id takes a channel's id or #name. They never delete, edit " +
        "others' messages, invite or kick.",
    );
    const posting = slackLine({ account: null, site: 'Airia' }, access({ dms: 'post' }), [
      'slack_post_message',
    ]);
    expect(posting).toContain(
      '(from Most Wanted): in Airia: read every channel; read and send direct messages.',
    );
    expect(posting).toContain('Posts show as the bot;');
    const user = slackLine({ account: null, site: null }, access({ post: true }, true), [
      'slack_post_message',
    ]);
    expect(user).toContain("Posts show as its person (a person's own account)");
  });
});

import { type SlackRights, slackAllows } from '@mwc/shared/credentials';
import type { ServerToolDef } from '@mwc/shared/harness';
import { z } from 'zod';
import { SLACK_INPUTS, SLACK_READ_TOOLS, type SlackTool } from '../../schemas/slack.ts';
import { channelsWords, type SlackAccess, workingRights } from './rights.ts';

/**
 * The Slack tools' words (S7.1e): what each one is for, as its `tools/list` entry says it, its definition for a turn's
 * spec (its input schema from its zod input), the line a turn's standing instructions get (as whom, where, what it may
 * do, with which tools), and their label.
 */

const info = (title: string, description: string) => ({ title, description });

/** What each tool is for. */
export const SLACK_TOOL_INFO: Readonly<Record<SlackTool, { title: string; description: string }>> = {
  slack_list_channels: info(
    'List Slack channels',
    'The channels (and DMs, when your profile reads them) your profile reaches, with their ids, names and topics.',
  ),
  slack_get_channel_history: info(
    'Read a channel',
    'A channel’s or DM’s latest messages, newest first, with who wrote them, threads and reactions.',
  ),
  slack_get_thread_replies: info('Read a thread', 'A thread’s messages, its first message first.'),
  slack_get_users: info('List Slack users', 'The workspace’s people and bots, with their names and titles.'),
  slack_get_user_profile: info('Read a Slack user', 'One person’s names, title and time zone, by their id.'),
  slack_post_message: info(
    'Post in Slack',
    'Posts a message in a channel (or a DM), under your name with a "via Most Wanted" footer. @here, @channel and ' +
      '@everyone are never sent.',
  ),
  slack_reply_to_thread: info(
    'Reply in a thread',
    'Replies in a message’s thread, under your name with a "via Most Wanted" footer.',
  ),
  slack_add_reaction: info('React to a message', 'Adds an emoji reaction to a message.'),
  slack_search_messages: info(
    'Search Slack',
    'Searches messages with Slack’s search syntax; only results in the channels (and DMs) your profile reaches.',
  ),
};

/** A tool's input schema as `tools/list` gives it: its JSON Schema without the `$schema` line. */
function inputSchema(tool: SlackTool): Record<string, unknown> {
  const { $schema: _, ...schema } = z.toJSONSchema(SLACK_INPUTS[tool], {
    io: 'input',
    unrepresentable: 'any',
  });
  return schema;
}

const DEFS = new Map<SlackTool, ServerToolDef>();

/** A tool as a turn's spec carries it (made once). */
export function slackToolDef(tool: SlackTool): ServerToolDef {
  const made = DEFS.get(tool) ?? {
    name: tool,
    ...SLACK_TOOL_INFO[tool],
    inputSchema: inputSchema(tool),
    readOnly: (SLACK_READ_TOOLS as readonly string[]).includes(tool) || tool === 'slack_search_messages',
  };
  DEFS.set(tool, made);
  return made;
}

/** What the working rights let it do, in words: "read #a, #b; post in #a, #b; read direct messages". */
function mayWords(rights: SlackRights): string {
  const where =
    rights.channels === 'all' ? 'every channel' : channelsWords(rights.channels as readonly string[]);
  const may = [
    rights.read ? `read ${where}` : '',
    rights.post ? `post in ${where}` : '',
    rights.react ? 'add reactions' : '',
    rights.search ? 'search messages' : '',
    rights.dms === 'off'
      ? ''
      : rights.dms === 'post'
        ? 'read and send direct messages'
        : 'read direct messages',
  ].filter((part) => part !== '');
  return may.join('; ');
}

/** Who its posts show as: the agent's name on the bot (with `chat:write.customize`), the bot, or the person. */
function postsAs(access: SlackAccess, account: string | null): string {
  if (access.kind === 'slack_user_token') return `as ${account ?? 'its person'} (a person's own account)`;
  const named = slackAllows('customize', access.kind, access.scopes);
  return named ? 'under your own name on the bot' : `as the bot${account === null ? '' : ` ${account}`}`;
}

/**
 * The line a turn's standing instructions get with the tools: "Slack tools (from Most Wanted): as mw-bot in Airia: read
 * #general; post in #general. Your tools, by the names of the Slack MCP servers: …; posts show under your name, … ".
 */
export function slackLine(
  part: { readonly account: string | null; readonly site: string | null },
  access: SlackAccess,
  tools: readonly SlackTool[],
): string {
  const one = (text: string | null) => (text === null ? null : text.replace(/\s+/g, ' ').trim());
  const [account, site] = [one(part.account), one(part.site)];
  const who = [account === null ? '' : `as ${account}`, site === null ? '' : `in ${site}`].filter(
    (w) => w !== '',
  );
  const where = who.length === 0 ? '' : ` ${who.join(' ')}:`;
  const posting = tools.some((tool) => tool === 'slack_post_message')
    ? ` Posts show ${postsAs(access, account)} and end with "via Most Wanted · <your name>"; @here, @channel and ` +
      '@everyone are stripped.'
    : '';
  return (
    `Slack tools (from Most Wanted):${where} ${mayWords(workingRights(access))}. Your tools, by the names of the ` +
    `Slack MCP servers: ${tools.join(', ')}; channel_id takes a channel's id or #name.${posting} They never delete, ` +
    "edit others' messages, invite or kick."
  );
}

/** What the tools are for, in a word, for a turn on a runner too old for them and the chat's notice. */
export const SLACK_LABEL = 'Slack';

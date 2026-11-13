import { TEST_NOW } from '@mwc/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { runnerTooOldLine } from '../../../../../src/modules/chats/service/server-tools.ts';
import { leftOutLine } from '../../../../../src/modules/integrations/rules/plans.ts';
import { SlackTool } from '../../../../../src/modules/integrations/schemas/slack.ts';
import {
  type ChatsWorld,
  chatPath,
  chatsWorld,
  type Scene,
  usesOf,
} from '../../../../fixtures/chats/world.ts';
import { putAtlassianPart } from '../../../../fixtures/integrations/atlassian.ts';
import { PUSH_PRS, putGitHubPart } from '../../../../fixtures/integrations/github.ts';
import {
  BOT_TOKEN,
  type SlackSceneOptions,
  serverToolNames,
  setScopes,
  slackScene,
  slackTurn,
} from '../../../../fixtures/integrations/slack.ts';
import { as } from '../../../../fixtures/members/members.ts';
import { addSignIn } from '../../../../fixtures/org.ts';

/**
 * The Slack tools a turn is offered (S7.1e), by its profile's Slack part as its token's scopes let it work, to a runner
 * that takes them; and what a runner that takes 32 tools gets when the profile gives more (Atlassian, GitHub and Slack
 * together).
 */

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

const lastLine = (instructions: string | undefined) => instructions?.split('\n\n').at(-1) ?? '';
const READS = ['slack_list_channels', 'slack_get_channel_history', 'slack_get_thread_replies'];
const USERS = ['slack_get_users', 'slack_get_user_profile'];

/** The chat's detail as its owner reads it: what waits for its runner's update. */
async function runnerUpdateOf(s: Scene): Promise<unknown> {
  const res = await as(w, s.company.owner)('GET', chatPath(s.company, s.chat.id));
  return (res.body as { runnerUpdateFor: unknown }).runnerUpdateFor;
}

describe('the Slack tools a turn gets', () => {
  it('reads, posts and reacts in its channels on a bot, with one line; the token stays on the server', async () => {
    const s = await slackScene(w);
    const start = await slackTurn(w, s);
    expect(serverToolNames(start)).toEqual([
      ...READS,
      ...USERS,
      'slack_post_message',
      'slack_reply_to_thread',
      'slack_add_reaction',
    ]);
    expect(lastLine(start.spec.instructions)).toBe(
      'Slack tools (from Most Wanted): as mw-bot in Airia Fake: read #general; post in #general; add reactions. Your ' +
        `tools, by the names of the Slack MCP servers: ${serverToolNames(start).join(', ')}; channel_id takes a ` +
        'channel\'s id or #name. Posts show under your own name on the bot and end with "via Most Wanted · <your ' +
        'name>"; @here, @channel and @everyone are stripped. They never delete, edit others\' messages, invite or kick.',
    );
    expect(JSON.stringify(start)).not.toContain(BOT_TOKEN);
    expect(await usesOf(w.t.db, s.signIn.id)).toEqual([]);
    expect(await runnerUpdateOf(s)).toBeNull();
  });

  it('gives only what the token’s scopes allow, and says the bot’s name without chat:write.customize', async () => {
    const s = await slackScene(w, { rights: { channels: 'all' } });
    await setScopes(w.t.db, s.signIn.id, ['channels:read', 'channels:history', 'chat:write']);
    const start = await slackTurn(w, s);
    expect(serverToolNames(start)).toEqual([...READS, 'slack_post_message', 'slack_reply_to_thread']);
    const line = lastLine(start.spec.instructions);
    expect(line).toContain(': read every channel; post in every channel.');
    expect(line).toContain('Posts show as the bot mw-bot and end with');
  });

  it('searches with a user token, posting as its person; Codex gets them too', async () => {
    const s = await slackScene(w, { user: true, harness: 'codex', rights: { search: true, dms: 'read' } });
    const start = await slackTurn(w, s);
    expect(start.spec.harness).toBe('codex');
    expect(serverToolNames(start)).toEqual(SlackTool.options);
    const line = lastLine(start.spec.instructions);
    expect(line).toContain(
      'as ihor in Airia Fake: read #general; post in #general; add reactions; search messages; read direct',
    );
    expect(line).toContain("Posts show as ihor (a person's own account)");
  });

  it('gives nothing without a part, a sign-in, or a right that works', async () => {
    const off = { read: false, post: false, react: false, dms: 'off' } as const;
    const cases: SlackSceneOptions[] = [{ rights: null }, { noSignIn: true }, { rights: off }];
    for (const options of cases) {
      const start = await slackTurn(w, await slackScene(w, options));
      expect(start.spec.serverTools).toBeUndefined();
      await w.disconnectAll();
    }
    const s = await slackScene(w);
    await setScopes(w.t.db, s.signIn.id, []);
    expect((await slackTurn(w, s)).spec.serverTools).toBeUndefined();
  });

  it('tells a turn on a runner too old for the server’s tools, and the chat names Slack', async () => {
    const s = await slackScene(w, { caps: { serverTools: false } });
    const start = await slackTurn(w, s);
    expect(start.spec.serverTools).toBeUndefined();
    expect(lastLine(start.spec.instructions)).toBe(runnerTooOldLine('Slack'));
    expect(await runnerUpdateOf(s)).toBe('Slack');
  });
});

describe('the tool limit with Atlassian, GitHub and Slack on one profile', () => {
  /** A scene whose profile gives all 38: Atlassian's 15, GitHub's 14, Slack's 9 (a user token). */
  async function everything(options: SlackSceneOptions) {
    const s = await slackScene(w, { ...options, user: true, rights: { search: true, dms: 'post' } });
    const owner = s.company.owner.userId;
    const atlassian = await addSignIn(w, w.keyring, owner, 'atlassian_api_token');
    const rights = {
      jira: 'changes',
      jiraProjects: 'all',
      confluence: 'write',
      confluenceSpaces: 'all',
    } as const;
    await putAtlassianPart(w.t.db, s.profile.id, { credentialId: atlassian.id, rights });
    const github = await addSignIn(w, w.keyring, owner, 'github_oauth');
    await putGitHubPart(w.t.db, s.profile.id, {
      credentialId: github.id,
      rights: { ...PUSH_PRS, push: false },
    });
    return s;
  }

  it('gives a runner that takes 64 all 38', async () => {
    const s = await everything({});
    const start = await slackTurn(w, s);
    expect(serverToolNames(start)).toHaveLength(38);
    expect(start.spec.instructions).not.toContain('left out now');
    expect(await runnerUpdateOf(s)).toBeNull();
  });

  it('gives an older runner 32, the least important left out and named, and the chat says all 38 wait', async () => {
    const s = await everything({ caps: { serverToolsMax: undefined } });
    const start = await slackTurn(w, s);
    const names = serverToolNames(start);
    expect(names).toHaveLength(32);
    const left = [
      'request_copilot_review',
      'slack_get_user_profile',
      'search_repositories',
      'list_branches',
      'getPagesInConfluenceSpace',
      'getConfluenceSpaces',
    ];
    for (const name of left) expect(names).not.toContain(name);
    expect(names).toContain('slack_post_message');
    expect(lastLine(start.spec.instructions).split('\n').at(-1)).toBe(leftOutLine(32, left));
    expect(await runnerUpdateOf(s)).toBe('all 38');
  });
});

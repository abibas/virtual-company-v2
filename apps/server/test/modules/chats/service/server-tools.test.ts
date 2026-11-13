import type { TenantDb } from '@mwc/db';
import { STANDING_INSTRUCTIONS_MAX } from '@mwc/shared/agent-briefing';
import type { ServerToolDef } from '@mwc/shared/harness';
import { describe, expect, it } from 'vitest';
import {
  runnerTooOldLine,
  SERVER_TOOLS_LABEL,
  type ServerToolsHook,
  type ServerToolsPlan,
  serverToolsOf,
} from '../../../../src/modules/chats/service/server-tools.ts';

/** What a turn's spec adds for the server's tools (S7.1c), with a runner that takes them and one too old for them. */

const TOOL: ServerToolDef = {
  name: 'getJiraIssue',
  title: 'Read a Jira issue',
  description: 'One issue.',
  inputSchema: { type: 'object' },
  readOnly: true,
};

/** A hook that offers this plan to every profile; its calls are never made here. */
const hookOf = (plan: ServerToolsPlan): ServerToolsHook => ({
  toolsFor: async () => plan,
  owns: () => true,
  tool: async () => ({ ok: false, text: 'unused' }),
});

const t = {} as TenantDb;
const PLAN: ServerToolsPlan = { tools: [TOOL], instructions: 'Atlassian tools: yours.', label: 'Jira' };
const turn = (offers: boolean, instructions: string | undefined = 'Standing.') =>
  ({ profileId: 'p1', kind: 'message', offers, instructions }) as const;

describe('the server tools a turn gets', () => {
  it('gives a runner that takes them the tools and the plan’s line after the standing instructions', async () => {
    expect(await serverToolsOf(hookOf(PLAN), t, turn(true))).toEqual({
      serverTools: [TOOL],
      instructions: 'Standing.\n\nAtlassian tools: yours.',
    });
  });

  it('gives an older runner no tool, and says plainly they are not on this machine', async () => {
    const got = await serverToolsOf(hookOf(PLAN), t, turn(false));
    expect(got.serverTools).toBeUndefined();
    expect(got.instructions).toBe(`Standing.\n\n${runnerTooOldLine('Jira')}`);
    expect(got.instructions).not.toContain('Atlassian tools: yours.');
    expect(runnerTooOldLine('Jira')).toBe(
      "Jira: configured, but this machine's runner is too old to provide the tools, so you have none of them now; " +
        'tell the person to update the runner on the Machines page.',
    );
  });

  it('names the tools generically when the plan does not, and gives the line alone without instructions', async () => {
    const got = await serverToolsOf(hookOf({ tools: [TOOL] }), t, {
      ...turn(false),
      instructions: undefined,
    });
    expect(got).toEqual({ instructions: runnerTooOldLine(SERVER_TOOLS_LABEL) });
  });

  it('adds nothing without tools, without a hook, or for a turn that is not a message', async () => {
    expect(await serverToolsOf(hookOf({ tools: [], label: 'Jira' }), t, turn(false))).toEqual({});
    expect(await serverToolsOf(undefined, t, turn(false))).toEqual({});
    const compact = { ...turn(false), kind: 'compact' } as const;
    expect(await serverToolsOf(hookOf(PLAN), t, compact)).toEqual({});
  });

  it('leaves a line out when it would not fit, keeping the tools', async () => {
    const full = 'x'.repeat(STANDING_INSTRUCTIONS_MAX - 10);
    expect(await serverToolsOf(hookOf(PLAN), t, turn(true, full))).toEqual({ serverTools: [TOOL] });
    expect(await serverToolsOf(hookOf(PLAN), t, turn(false, full))).toEqual({});
  });
});

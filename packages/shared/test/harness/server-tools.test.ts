import { describe, expect, it } from 'vitest';
import {
  RESERVED_TOOL_NAMES,
  SERVER_TOOL_LIMITS,
  SERVER_TOOLS_MAX,
  ServerToolDef,
  ServerToolDefs,
  ServerToolName,
  serverToolsLimit,
} from '../../src/harness/server-tools.ts';
import { RunnerCaps } from '../../src/runner-protocol/runner-frames.ts';
import { TurnTool } from '../../src/runner-protocol/turns.ts';

const TOOL = {
  name: 'getJiraIssue',
  title: 'Read a Jira issue',
  description: 'One issue.',
  inputSchema: { type: 'object' },
  readOnly: true,
};

describe('the server’s own tools (S7.1c)', () => {
  it('are named by one plain word, camelCase too', () => {
    expect(ServerToolName.safeParse('searchJiraIssuesUsingJql').success).toBe(true);
    expect(ServerToolName.safeParse('jira_search2').success).toBe(true);
    for (const name of ['', '2fast', 'get jira', 'mcp__mwc__x-y', 'x'.repeat(65)])
      expect(ServerToolName.safeParse(name).success).toBe(false);
  });

  it('carry their words and a bounded input schema', () => {
    expect(ServerToolDef.parse(TOOL)).toEqual(TOOL);
    expect(ServerToolDef.safeParse({ ...TOOL, title: '' }).success).toBe(false);
    expect(ServerToolDef.safeParse({ ...TOOL, description: 'x'.repeat(2001) }).success).toBe(false);
    const big = { type: 'object', description: 'x'.repeat(SERVER_TOOL_LIMITS.schema) };
    expect(ServerToolDef.safeParse({ ...TOOL, inputSchema: big }).success).toBe(false);
  });

  it('come each once, at most 64 (S7.1e), never with a reserved name', () => {
    expect(RESERVED_TOOL_NAMES).toContain('ask_user_question');
    expect(RESERVED_TOOL_NAMES).toContain('task_hand_on');
    expect(ServerToolDefs.safeParse([TOOL, { ...TOOL, name: 'getConfluencePage' }]).success).toBe(true);
    expect(ServerToolDefs.safeParse([TOOL, TOOL]).success).toBe(false);
    expect(ServerToolDefs.safeParse([{ ...TOOL, name: 'team_board' }]).success).toBe(false);
    const tools = (length: number) => Array.from({ length }, (_, i) => ({ ...TOOL, name: `tool${i}` }));
    expect(SERVER_TOOLS_MAX).toBe(64);
    expect(ServerToolDefs.safeParse(tools(64)).success).toBe(true);
    expect(ServerToolDefs.safeParse(tools(65)).success).toBe(false);
  });

  it('go to an older runner at most 32 at a time: what a runner says, at most 64', () => {
    expect(serverToolsLimit({})).toBe(32);
    expect(serverToolsLimit({ serverToolsMax: 64 })).toBe(64);
    expect(serverToolsLimit({ serverToolsMax: 128 })).toBe(64);
    expect(serverToolsLimit({ serverToolsMax: 10 })).toBe(10);
    const caps = { harnesses: {}, slots: 1, hold: 'none', power: [] };
    expect(RunnerCaps.parse(caps).serverToolsMax).toBeUndefined();
    expect(RunnerCaps.parse({ ...caps, serverToolsMax: 64 }).serverToolsMax).toBe(64);
    expect(RunnerCaps.safeParse({ ...caps, serverToolsMax: -1 }).success).toBe(false);
  });

  it('are called by a turn.tool frame by their name', () => {
    const frame = {
      type: 'turn.tool',
      turnId: '0195f0a0-0000-7000-8000-000000000001',
      callId: '0195f0a0-0000-7000-8000-000000000002',
      tool: 'getJiraIssue',
      input: { issueIdOrKey: 'AP-301' },
    };
    expect(TurnTool.parse(frame)).toEqual(frame);
    expect(TurnTool.safeParse({ ...frame, tool: 'get jira' }).success).toBe(false);
  });
});

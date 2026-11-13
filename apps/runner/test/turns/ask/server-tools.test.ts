import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ServerToolDef } from '@mwc/shared/harness';
import { describe, expect, it } from 'vitest';
import { answerRequest, tokenDigest, turnTools } from '../../../src/turns/ask/bridge.ts';
import { type McpIo, mcpCommand } from '../../../src/turns/ask/command.ts';
import { McpServer } from '../../../src/turns/ask/mcp.ts';
import {
  isServerToolName,
  SERVER_TOOLS_FILE,
  serverToolDefinition,
  serverToolInput,
  serverToolsFile,
  serverToolsFromEnv,
} from '../../../src/turns/ask/server-tools.ts';
import { ASK_REPLY } from '../../../src/turns/ask/tool.ts';
import { handlerOf, TOOL_SERVER, testAskHost } from '../../fixtures/ask.ts';
import { memoryLog } from '../../fixtures/log.ts';

const SEARCH: ServerToolDef = {
  name: 'searchJiraIssuesUsingJql',
  title: 'Search Jira issues',
  description: 'Search issues with JQL.',
  inputSchema: { type: 'object', properties: { jql: { type: 'string' } }, required: ['jql'] },
  readOnly: true,
};
const COMMENT: ServerToolDef = {
  name: 'addCommentToJiraIssue',
  title: 'Comment on a Jira issue',
  description: 'Add a comment.',
  inputSchema: { type: 'object' },
  readOnly: false,
};

describe('the server’s own tools on the runner (S7.1c)', () => {
  it('writes them to the turn’s folder, private, and reads them back from the file the variable names', () => {
    const file = serverToolsFile([SEARCH, COMMENT]);
    expect(file).toMatchObject({ name: SERVER_TOOLS_FILE, mode: 0o600 });
    const read = (path: string) => (path === '/t/server-tools.json' ? file.contents : '');
    expect(serverToolsFromEnv({ MWC_SERVER_TOOLS: '/t/server-tools.json' }, read)).toEqual([SEARCH, COMMENT]);
  });

  it('offers none without the variable, or when the file is missing, not JSON or not tools', () => {
    expect(serverToolsFromEnv({})).toEqual([]);
    expect(serverToolsFromEnv({ MWC_SERVER_TOOLS: '/no/such/file.json' })).toEqual([]);
    expect(serverToolsFromEnv({ MWC_SERVER_TOOLS: 'x' }, () => 'not json')).toEqual([]);
    const reserved = JSON.stringify([{ ...SEARCH, name: 'task_read' }]);
    expect(serverToolsFromEnv({ MWC_SERVER_TOOLS: 'x' }, () => reserved)).toEqual([]);
  });

  it('lists a tool as the server wrote it, its hints from readOnly', () => {
    expect(serverToolDefinition(SEARCH)).toEqual({
      name: SEARCH.name,
      title: SEARCH.title,
      description: SEARCH.description,
      inputSchema: SEARCH.inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    });
    expect(serverToolDefinition(COMMENT).annotations).toMatchObject({
      readOnlyHint: false,
      idempotentHint: false,
    });
  });

  it('takes one plain word as a name, and an object (or nothing) as an input', () => {
    expect(isServerToolName('getJiraIssue')).toBe(true);
    expect(isServerToolName('get jira')).toBe(false);
    expect(serverToolInput('getJiraIssue', undefined)).toEqual({ ok: true, input: {} });
    expect(serverToolInput('getJiraIssue', { issueIdOrKey: 'AP-1' })).toEqual({
      ok: true,
      input: { issueIdOrKey: 'AP-1' },
    });
    expect(serverToolInput('getJiraIssue', ['AP-1'])).toEqual({
      ok: false,
      error: 'getJiraIssue did nothing: its input must be an object of its arguments.',
    });
  });
});

describe('the MCP server with server tools', () => {
  function mcp(serverTools: readonly ServerToolDef[], withCall = true) {
    const calls: unknown[] = [];
    const server = new McpServer({
      version: '0.6.0',
      ask: () => Promise.resolve({ ok: true, text: ASK_REPLY }),
      tools: ['task_read'],
      serverTools,
      ...(withCall
        ? {
            call: (relayed) => {
              calls.push(relayed);
              return Promise.resolve({ ok: true, text: 'AP-1 · Fix the login' });
            },
          }
        : {}),
    });
    return { server, calls };
  }
  const request = (id: number, method: string, params?: object) => ({ jsonrpc: '2.0', id, method, params });

  it('lists them after the agents’ tools, and relays a call with its input as it is', async () => {
    const { server, calls } = mcp([SEARCH, COMMENT]);
    const listed = (await server.handle(request(1, 'tools/list'))) as {
      result: { tools: { name: string }[] };
    };
    expect(listed.result.tools.map((tool) => tool.name)).toEqual([
      'ask_user_question',
      'task_read',
      'searchJiraIssuesUsingJql',
      'addCommentToJiraIssue',
    ]);
    const args = { cloudId: 'airia', jql: 'assignee = currentUser()' };
    const answer = await server.handle(request(2, 'tools/call', { name: SEARCH.name, arguments: args }));
    expect(answer).toEqual({
      jsonrpc: '2.0',
      id: 2,
      result: { content: [{ type: 'text', text: 'AP-1 · Fix the login' }] },
    });
    expect(calls).toEqual([{ tool: SEARCH.name, input: args }]);
  });

  it('refuses an input that is no object as a tool error, relaying nothing', async () => {
    const { server, calls } = mcp([SEARCH]);
    const answer = await server.handle(request(3, 'tools/call', { name: SEARCH.name, arguments: 'AP-1' }));
    expect(answer).toMatchObject({ result: { isError: true } });
    expect(calls).toEqual([]);
  });

  it('offers none without a relay', async () => {
    const { server } = mcp([SEARCH], false);
    const listed = (await server.handle(request(4, 'tools/list'))) as {
      result: { tools: { name: string }[] };
    };
    expect(listed.result.tools.map((tool) => tool.name)).toEqual(['ask_user_question']);
    const unknown = await server.handle(request(5, 'tools/call', { name: SEARCH.name, arguments: {} }));
    expect(unknown).toMatchObject({ error: { code: -32602 } });
  });

  it('runner.mjs mcp reads them from the file its environment names', async () => {
    const out: string[] = [];
    const io: McpIo = {
      input: (async function* () {
        yield `${JSON.stringify(request(6, 'tools/list'))}\n`;
      })(),
      write: (line) => void out.push(line),
      env: { MWC_ASK_SOCKET: '/t/ask.sock', MWC_ASK_TOKEN: 'tok', MWC_SERVER_TOOLS: '/t/tools.json' },
      version: '0.6.0',
      read: () => JSON.stringify([SEARCH]),
    };
    await mcpCommand(io);
    const listed = JSON.parse(out[0] as string) as { result: { tools: { name: string }[] } };
    expect(listed.result.tools.map((tool) => tool.name)).toEqual(['ask_user_question', SEARCH.name]);
  });
});

describe('the bridge with server tools', () => {
  it('names the file and the tools to the driver', () => {
    const host = testAskHost(memoryLog().log);
    const bridge = host.open();
    expect(turnTools(host, bridge, ['task_read'], [SEARCH])).toEqual({
      dir: bridge.dir,
      ...TOOL_SERVER,
      env: {
        MWC_ASK_SOCKET: bridge.socketPath,
        MWC_ASK_TOKEN: bridge.token,
        MWC_TOOLS: 'task_read',
        MWC_SERVER_TOOLS: join(bridge.dir, SERVER_TOOLS_FILE),
      },
      names: ['ask_user_question', 'task_read', SEARCH.name],
    });
    bridge.write(serverToolsFile([SEARCH]));
    const path = join(bridge.dir, SERVER_TOOLS_FILE);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual([SEARCH]);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    bridge.close();
  });

  it('relays a server tool’s call with an object, and refuses another input or a name that is no word', async () => {
    const log = memoryLog().log;
    const handler = handlerOf(
      () => ({ ok: true, text: '' }),
      (tool, input) => Promise.resolve({ ok: true, text: `${tool} ${JSON.stringify(input)}` }),
    );
    const line = (tool: string, input?: unknown) => JSON.stringify({ token: 'tok', tool, input });
    expect(
      await answerRequest(line('getJiraIssue', { issueIdOrKey: 'AP-1' }), tokenDigest('tok'), handler, log),
    ).toEqual({
      ok: true,
      text: 'getJiraIssue {"issueIdOrKey":"AP-1"}',
    });
    expect(await answerRequest(line('getJiraIssue'), tokenDigest('tok'), handler, log)).toEqual({
      ok: true,
      text: 'getJiraIssue {}',
    });
    expect(answerRequest(line('getJiraIssue', 'AP-1'), tokenDigest('tok'), handler, log)).toMatchObject({
      ok: false,
    });
    expect(answerRequest(line('get jira'), tokenDigest('tok'), handler, log)).toEqual({
      ok: false,
      error: 'Unknown tool: get jira',
    });
  });
});

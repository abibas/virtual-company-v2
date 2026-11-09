import type { AskQuestions } from '@mwc/shared/harness';
import { describe, expect, it } from 'vitest';
import { type AskRelay, JSON_RPC, MCP_PROTOCOL_VERSIONS, McpServer } from '../../../src/turns/ask/mcp.ts';
import { ASK_REPLY, ASK_TOOL_DEFINITION } from '../../../src/turns/ask/tool.ts';
import { QUESTION } from '../../fixtures/ask.ts';

/** A server whose relay records what it got and answers `reply` (or throws it). */
function server(reply: Awaited<ReturnType<AskRelay>> | Error = { ok: true, text: ASK_REPLY }) {
  const asked: AskQuestions[] = [];
  const mcp = new McpServer({
    version: '0.5.0',
    ask: (questions) => {
      asked.push(questions);
      return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
    },
  });
  return { mcp, asked };
}

const request = (id: number | string, method: string, params?: unknown) => ({
  jsonrpc: '2.0',
  id,
  method,
  ...(params === undefined ? {} : { params }),
});

const call = (args: unknown, name = 'ask_user_question') =>
  request(7, 'tools/call', { name, arguments: args });

describe("the runner's MCP server", () => {
  it('initializes with tools only, in the version asked for when it speaks it, else its newest', async () => {
    const { mcp } = server();
    const asked = { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'claude-code' } };
    expect(await mcp.handle(request(1, 'initialize', asked))).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'mwc', title: 'Most Wanted Corp', version: '0.5.0' },
      },
    });
    const newer = await mcp.handle(request(2, 'initialize', { protocolVersion: '2099-01-01' }));
    expect(newer).toMatchObject({ result: { protocolVersion: MCP_PROTOCOL_VERSIONS[0] } });
    expect(await mcp.handle(request('p', 'ping'))).toEqual({ jsonrpc: '2.0', id: 'p', result: {} });
  });

  it('lists its one tool, with its input schema and limits', async () => {
    const { mcp } = server();
    const listed = (await mcp.handle(request(3, 'tools/list'))) as { result: { tools: unknown[] } };
    expect(listed.result.tools).toEqual([ASK_TOOL_DEFINITION]);
    const schema = ASK_TOOL_DEFINITION.inputSchema.properties.questions;
    expect([schema.minItems, schema.maxItems, schema.items.properties.options.maxItems]).toEqual([1, 4, 8]);
    expect(ASK_TOOL_DEFINITION.annotations.readOnlyHint).toBe(true);
  });

  it('relays a valid call and answers with the runner’s text', async () => {
    const { mcp, asked } = server();
    expect(await mcp.handle(call({ questions: [QUESTION] }))).toEqual({
      jsonrpc: '2.0',
      id: 7,
      result: { content: [{ type: 'text', text: ASK_REPLY }] },
    });
    expect(asked).toEqual([[QUESTION]]);
  });

  it('answers an invalid input with a tool error that says what to fix, without asking the runner', async () => {
    const { mcp, asked } = server();
    const bad = { questions: [{ ...QUESTION, header: 'Far too long a header', options: [] }] };
    const answer = (await mcp.handle(call(bad))) as {
      result: { content: { text: string }[]; isError: boolean };
    };
    expect(answer.result.isError).toBe(true);
    expect(answer.result.content[0]?.text).toMatch(
      /^The questions were not shown; fix them and call ask_user_question/,
    );
    expect(answer.result.content[0]?.text).toContain('questions.0.header:');
    expect(answer.result.content[0]?.text).toContain('questions.0.options:');
    const none = (await mcp.handle(request(8, 'tools/call', { name: 'ask_user_question' }))) as typeof answer;
    expect(none.result.content[0]?.text).toContain('questions:');
    const text = (await mcp.handle(call('Which database?'))) as typeof answer;
    expect(text.result.content[0]?.text).toMatch(
      /call ask_user_question again:\nInvalid input: expected object/,
    );
    expect(asked).toEqual([]);
  });

  it('turns a refusal or a failure of the relay into a tool error', async () => {
    const refused = server({ ok: false, error: 'The turn is ending.' });
    expect(await refused.mcp.handle(call({ questions: [QUESTION] }))).toMatchObject({
      result: { content: [{ type: 'text', text: 'The turn is ending.' }], isError: true },
    });
    const thrown = server(new Error('socket gone'));
    expect(await thrown.mcp.handle(call({ questions: [QUESTION] }))).toMatchObject({
      result: { content: [{ text: 'socket gone' }], isError: true },
    });
    const odd = new McpServer({ version: '0.5.0', ask: () => Promise.reject('closed') });
    expect(await odd.handle(call({ questions: [QUESTION] }))).toMatchObject({
      result: { content: [{ text: 'closed' }], isError: true },
    });
  });

  it('refuses an unknown tool and an unknown method, and answers no notification or response', async () => {
    const { mcp } = server();
    expect(await mcp.handle(call({}, 'rm_rf'))).toEqual({
      jsonrpc: '2.0',
      id: 7,
      error: { code: JSON_RPC.invalidParams, message: 'Unknown tool: rm_rf' },
    });
    expect(await mcp.handle(request(9, 'resources/list'))).toEqual({
      jsonrpc: '2.0',
      id: 9,
      error: { code: JSON_RPC.methodNotFound, message: 'Method not found: resources/list' },
    });
    expect(await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeUndefined();
    expect(
      await mcp.handle({ jsonrpc: '2.0', method: 'notifications/cancelled', params: {} }),
    ).toBeUndefined();
    expect(await mcp.handle({ jsonrpc: '2.0', id: 4, result: {} })).toBeUndefined();
  });

  it('answers a line that is not JSON, and a message that is no request', async () => {
    const { mcp } = server();
    expect(JSON.parse((await mcp.line('{nope')) as string)).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: JSON_RPC.parseError, message: 'Parse error' },
    });
    expect(
      await mcp.line(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })),
    ).toBeUndefined();
    const invalid = { code: JSON_RPC.invalidRequest, message: 'Invalid Request' };
    for (const [message, id] of [
      [[request(1, 'ping')], null],
      [{ id: 5, method: 'ping' }, 5],
      [{ jsonrpc: '1.0', method: 'ping' }, null],
      [{ jsonrpc: '2.0', id: { no: 1 }, method: 'ping' }, null],
      [{ jsonrpc: '2.0', id: 6 }, 6],
      ['ping', null],
    ] as const) {
      expect(await mcp.handle(message)).toEqual({ jsonrpc: '2.0', id, error: invalid });
    }
    expect(JSON.parse((await mcp.line(JSON.stringify(request(2, 'ping')))) as string)).toMatchObject({
      id: 2,
    });
  });
});

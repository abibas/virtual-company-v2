import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { INSTRUCTIONS, serveStdio } from '../src/server.ts';
import { connect, tempConfig } from './fixtures/world.ts';

const noFetch = () => Promise.reject(new Error('fetch was called'));

describe('the mwc MCP server', () => {
  it('introduces itself and lists its three read-only tools with their descriptions and arguments', async () => {
    const client = await connect(tempConfig().env, noFetch);
    expect(client.getServerVersion()).toMatchObject({
      name: 'mwc',
      title: 'Most Wanted Corp',
      version: '0.0.0',
    });
    expect(client.getInstructions()).toBe(INSTRUCTIONS);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => [tool.name, tool.title])).toEqual([
      ['me', 'Who am I'],
      ['org_chart', 'Org chart'],
      ['agents_list', 'Agents'],
    ]);
    for (const tool of tools) {
      expect(tool.annotations).toEqual({ readOnlyHint: true, idempotentHint: true, openWorldHint: false });
      // Written for Claude: what the tool is for and what it returns.
      expect(tool.description).toContain('Returns');
      expect(tool.description?.length).toBeGreaterThan(300);
    }
    const [me, chart, agents] = tools;
    expect(Object.keys(me?.inputSchema.properties ?? {})).toEqual([]);
    expect(chart?.inputSchema).toMatchObject({ properties: { company: { type: 'string' } } });
    expect(chart?.inputSchema.required ?? []).toEqual([]);
    expect(agents?.inputSchema).toMatchObject({
      properties: {
        company: { type: 'string' },
        status: { type: 'string', enum: ['active', 'paused', 'archived', 'all'] },
      },
    });
  });

  it('serves the same tools over stdio, one JSON-RPC message per line', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const server = await serveStdio({ env: tempConfig().env, fetch: noFetch }, { stdin, stdout });
    const answer = async (message: object) => {
      stdin.write(`${JSON.stringify(message)}\n`);
      const [chunk] = await once(stdout, 'data');
      return JSON.parse(String(chunk));
    };
    const init = await answer({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 't', version: '0' },
      },
    });
    expect(init).toMatchObject({
      id: 1,
      result: { serverInfo: { name: 'mwc' }, capabilities: { tools: {} } },
    });
    stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const listed = await answer({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(listed.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'me',
      'org_chart',
      'agents_list',
    ]);
    await server.close();
  });
});

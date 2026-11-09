import { describe, expect, it } from 'vitest';
import { openAskBridge } from '../../../src/turns/ask/bridge.ts';
import {
  type McpIo,
  mcpCommand,
  nodeMcpIo,
  OUTSIDE_TURN,
  relayFrom,
} from '../../../src/turns/ask/command.ts';
import { ASK_REPLY } from '../../../src/turns/ask/tool.ts';
import { askRoot, QUESTION } from '../../fixtures/ask.ts';
import { memoryLog } from '../../fixtures/log.ts';

/** An MCP io whose stdin is `chunks` and whose answers are kept, parsed. */
function io(chunks: readonly string[], env: McpIo['env'] = {}) {
  const out: string[] = [];
  const value: McpIo = {
    input: (async function* () {
      yield* chunks;
    })(),
    write: (line) => void out.push(line),
    env,
    version: '0.5.0',
  };
  return { io: value, answers: () => out.map((line) => JSON.parse(line) as Record<string, unknown>) };
}

const line = (message: object) => `${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`;
const call = (id: number) =>
  line({
    id,
    method: 'tools/call',
    params: { name: 'ask_user_question', arguments: { questions: [QUESTION] } },
  });

describe('runner.mjs mcp', () => {
  it('answers each request line on stdout, a line split across chunks too, and exits 0 when stdin ends', async () => {
    const initialize = line({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    const run = io([
      initialize.slice(0, 20),
      initialize.slice(20),
      line({ method: 'notifications/initialized' }),
      '\n',
      line({ id: 2, method: 'tools/list' }).trimEnd(),
    ]);
    expect(await mcpCommand(run.io)).toBe(0);
    expect(run.answers().map((answer) => answer.id)).toEqual([1, 2]);
    expect(run.answers()[0]).toMatchObject({ result: { serverInfo: { name: 'mwc' } } });
  });

  it('relays a call to the turn’s socket named in its environment', async () => {
    const bridge = openAskBridge(askRoot(), memoryLog().log);
    bridge.bind(() => ({ ok: true, text: ASK_REPLY }));
    const env = { MWC_ASK_SOCKET: bridge.socketPath, MWC_ASK_TOKEN: bridge.token };
    const run = io([call(3)], env);
    await mcpCommand(run.io);
    expect(run.answers()).toEqual([
      { jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: ASK_REPLY }] } },
    ]);
    bridge.close();
  });

  it('says a call works only inside a chat turn without the socket’s variables', async () => {
    expect(await relayFrom({})([QUESTION])).toEqual({ ok: false, error: OUTSIDE_TURN });
    expect(await relayFrom({ MWC_ASK_SOCKET: '/x.sock' })([QUESTION])).toEqual({
      ok: false,
      error: OUTSIDE_TURN,
    });
    const run = io([call(4)]);
    await mcpCommand(run.io);
    expect(run.answers()[0]).toMatchObject({ result: { content: [{ text: OUTSIDE_TURN }], isError: true } });
  });

  it('runs on the real process’s stdin, stdout and environment', () => {
    const real = nodeMcpIo('0.5.0');
    expect(real.input).toBe(process.stdin);
    expect(real.env).toBe(process.env);
    expect(real.version).toBe('0.5.0');
    real.write('');
  });
});

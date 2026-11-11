import { existsSync, readFileSync, statSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ASK_REFUSED,
  answerRequest,
  NOT_READY,
  openAskBridge,
  reopenAskBridge,
  SOCKET_PATH_MAX,
  sameToken,
  tokenDigest,
  turnTools,
} from '../../../src/turns/ask/bridge.ts';
import { askRunner, callRunner, TOOL_NOT_IN_TURN } from '../../../src/turns/ask/client.ts';
import { ASK_REPLY, ASK_SOCKET_FILE, type AskHandler } from '../../../src/turns/ask/tool.ts';
import { askRoot, handlerOf, QUESTION, TOOL_SERVER, testAskHost } from '../../fixtures/ask.ts';
import { memoryLog } from '../../fixtures/log.ts';
import { tempDir } from '../../fixtures/runner.ts';

const mode = (path: string) => statSync(path).mode & 0o777;

describe("a turn's question socket", () => {
  it('lives in a private folder of its own with a random token, until it is closed', () => {
    const logs = memoryLog();
    const root = askRoot();
    const bridge = openAskBridge(root, logs.log);
    expect(bridge.dir.startsWith(`${root}/`)).toBe(true);
    expect(bridge.socketPath).toBe(join(bridge.dir, ASK_SOCKET_FILE));
    expect(bridge.token).toMatch(/^[0-9a-f]{64}$/);
    expect([mode(root), mode(bridge.dir)]).toEqual([0o700, 0o700]);
    expect(statSync(bridge.socketPath).isSocket()).toBe(true);
    bridge.write({ name: 'mcp.json', contents: '{"mcpServers":{}}', mode: 0o600 });
    expect(readFileSync(join(bridge.dir, 'mcp.json'), 'utf8')).toBe('{"mcpServers":{}}');
    expect(mode(join(bridge.dir, 'mcp.json'))).toBe(0o600);
    const other = openAskBridge(root, logs.log);
    expect(other.token).not.toBe(bridge.token);
    expect(other.dir).not.toBe(bridge.dir);
    bridge.close();
    bridge.close();
    other.close();
    expect([existsSync(bridge.dir), existsSync(other.dir)]).toEqual([false, false]);
  });

  it('relays a call with its token to the handler the turn bound, and is not ready before', async () => {
    const logs = memoryLog();
    const bridge = openAskBridge(askRoot(), logs.log);
    expect(await askRunner(bridge.socketPath, bridge.token, [QUESTION])).toEqual({
      ok: false,
      error: NOT_READY,
    });
    const asked: unknown[] = [];
    bridge.bind(
      handlerOf((questions) => {
        asked.push(questions);
        return { ok: true, text: ASK_REPLY };
      }),
    );
    expect(await askRunner(bridge.socketPath, bridge.token, [QUESTION])).toEqual({
      ok: true,
      text: ASK_REPLY,
    });
    expect(asked).toEqual([[QUESTION]]);
    bridge.close();
  });

  it('refuses a wrong token, logging it without the token', async () => {
    const logs = memoryLog();
    const bridge = openAskBridge(askRoot(), logs.log);
    bridge.bind(handlerOf(() => ({ ok: true, text: 'shown' })));
    expect(await askRunner(bridge.socketPath, 'f'.repeat(64), [QUESTION])).toEqual({
      ok: false,
      error: ASK_REFUSED,
    });
    expect(logs.messages('warn')).toEqual(['a question came with a wrong token; refused']);
    expect(logs.lines.join('')).not.toContain(bridge.token);
    bridge.close();
  });

  it('refuses a request too long without reading on', async () => {
    const bridge = openAskBridge(askRoot(), memoryLog().log);
    const socket = connect(bridge.socketPath);
    const answer = await new Promise<string>((resolve) => {
      let text = '';
      socket.on('data', (chunk: Buffer) => {
        text += chunk.toString();
      });
      socket.on('close', () => resolve(text));
      socket.on('error', () => resolve(text));
      socket.write('x'.repeat(70 * 1024));
    });
    expect(JSON.parse(answer)).toEqual({ ok: false, error: 'a request too long' });
    bridge.close();
  });

  it('refuses a socket path too long for the system before making anything', () => {
    const root = join(tempDir(), 'x'.repeat(SOCKET_PATH_MAX));
    expect(() => openAskBridge(root, memoryLog().log)).toThrow(/socket path would be longer than 103 bytes/);
    expect(existsSync(root)).toBe(false);
  });

  it('gives a driver the folder, the MCP server, the socket’s variables and the tools it offers', () => {
    const host = testAskHost(memoryLog().log);
    const bridge = host.open();
    expect(turnTools(host, bridge)).toEqual({
      dir: bridge.dir,
      ...TOOL_SERVER,
      env: { MWC_ASK_SOCKET: bridge.socketPath, MWC_ASK_TOKEN: bridge.token },
      names: ['ask_user_question'],
    });
    expect(turnTools(host, bridge, ['task_read', 'task_pass', 'task_send_back'])).toEqual({
      dir: bridge.dir,
      ...TOOL_SERVER,
      env: {
        MWC_ASK_SOCKET: bridge.socketPath,
        MWC_ASK_TOKEN: bridge.token,
        MWC_TOOLS: 'task_read,task_pass,task_send_back',
      },
      names: ['ask_user_question', 'task_read', 'task_pass', 'task_send_back'],
    });
    bridge.close();
  });
});

describe("a turn's agents' tools on the socket (S6a)", () => {
  it('relays a call to the handler and waits for its later answer, past the request’s own timeout', async () => {
    const bridge = openAskBridge(askRoot(), memoryLog().log);
    const calls: unknown[] = [];
    bridge.bind(
      handlerOf(
        () => ({ ok: true, text: ASK_REPLY }),
        (tool, input) => {
          calls.push([tool, input]);
          return new Promise((resolve) => setTimeout(() => resolve({ ok: true, text: 'Recorded.' }), 30));
        },
      ),
    );
    const call = { tool: 'task_hand_on' as const, input: { summary: 'Done: branch fix/login.' } };
    expect(await callRunner(bridge.socketPath, bridge.token, call)).toEqual({ ok: true, text: 'Recorded.' });
    expect(calls).toEqual([['task_hand_on', { summary: 'Done: branch fix/login.' }]]);
    expect(await askRunner(bridge.socketPath, bridge.token, [QUESTION])).toEqual({
      ok: true,
      text: ASK_REPLY,
    });
    bridge.close();
    expect(await callRunner(bridge.socketPath, bridge.token, call)).toEqual({
      ok: false,
      error: TOOL_NOT_IN_TURN,
    });
  });

  it('refuses a wrong token, an unknown tool and a bad input before the handler hears of it', async () => {
    const logs = memoryLog();
    const bridge = openAskBridge(askRoot(), logs.log);
    const calls: unknown[] = [];
    bridge.bind(
      handlerOf(
        () => ({ ok: true, text: 'shown' }),
        (tool) => {
          calls.push(tool);
          return Promise.resolve({ ok: true, text: 'called' });
        },
      ),
    );
    const read = { tool: 'task_read' as const, input: {} };
    expect(await callRunner(bridge.socketPath, 'f'.repeat(64), read)).toEqual({
      ok: false,
      error: ASK_REFUSED,
    });
    const unknown = { tool: 'rm_rf', input: {} } as unknown as typeof read;
    expect(await callRunner(bridge.socketPath, bridge.token, unknown)).toEqual({
      ok: false,
      error: 'Unknown tool: rm_rf',
    });
    const bad = await callRunner(bridge.socketPath, bridge.token, { tool: 'task_blocked', input: {} });
    expect(bad.ok).toBe(false);
    expect(bad.ok ? '' : bad.error).toContain('task_blocked did nothing; fix its input');
    expect(calls).toEqual([]);
    bridge.close();
  });
});

describe('a turn’s bridge taken back after a restart (S5.4)', () => {
  it('lets go of its socket and keeps its folder, then listens again there for the same token', async () => {
    const bridge = openAskBridge(askRoot(), memoryLog().log);
    bridge.write({ name: 'mcp.json', contents: '{}', mode: 0o600 });
    bridge.release();
    bridge.release();
    expect(existsSync(join(bridge.dir, 'mcp.json'))).toBe(true);
    const again = reopenAskBridge(bridge.dir, bridge.tokenSha256, memoryLog().log);
    expect(again.token).toBe('');
    again.bind(
      handlerOf(
        () => ({ ok: true, text: 'asked again' }),
        () => Promise.resolve({ ok: true, text: 'called again' }),
      ),
    );
    expect(await askRunner(again.socketPath, bridge.token, [QUESTION])).toEqual({
      ok: true,
      text: 'asked again',
    });
    expect((await askRunner(again.socketPath, 'wrong', [QUESTION])).ok).toBe(false);
    expect(await callRunner(again.socketPath, bridge.token, { tool: 'task_read', input: {} })).toEqual({
      ok: true,
      text: 'called again',
    });
    again.close();
    again.close();
    expect(existsSync(bridge.dir)).toBe(false);
    expect(tokenDigest('tok')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('answerRequest', () => {
  const log = memoryLog().log;
  const handler: AskHandler = handlerOf(
    (questions) => ({ ok: true, text: `asked ${questions.length}` }),
    (tool) => Promise.resolve({ ok: true, text: `called ${tool}` }),
  );

  it('answers a valid request from the handler', () => {
    const line = JSON.stringify({ token: 'tok', questions: [QUESTION] });
    expect(answerRequest(line, tokenDigest('tok'), handler, log)).toEqual({ ok: true, text: 'asked 1' });
    expect(answerRequest(line, tokenDigest('tok'), undefined, log)).toEqual({ ok: false, error: NOT_READY });
  });

  it('refuses what is no request, a wrong token and questions that are not valid', () => {
    const cases: [string, string][] = [
      ['nope', 'not a request'],
      [JSON.stringify({ questions: [] }), 'not a request'],
      [JSON.stringify({ token: 'other', questions: [QUESTION] }), ASK_REFUSED],
      [
        JSON.stringify({ token: 'tok', questions: [{ ...QUESTION, options: [] }] }),
        'The questions are not valid.',
      ],
    ];
    for (const [line, error] of cases)
      expect(answerRequest(line, tokenDigest('tok'), handler, log)).toEqual({ ok: false, error });
  });

  it('answers a tool’s request later, from the handler, its input checked', async () => {
    const line = JSON.stringify({ token: 'tok', tool: 'team_board', input: {} });
    expect(await answerRequest(line, tokenDigest('tok'), handler, log)).toEqual({
      ok: true,
      text: 'called team_board',
    });
    expect(answerRequest(line, tokenDigest('tok'), undefined, log)).toEqual({ ok: false, error: NOT_READY });
    const noKey = JSON.stringify({ token: 'tok', tool: 'task_show' });
    expect((answerRequest(noKey, tokenDigest('tok'), handler, log) as { ok: boolean }).ok).toBe(false);
  });

  it('compares tokens of any length', () => {
    expect(sameToken('abc', 'abc')).toBe(true);
    expect(sameToken('abc', 'abcd')).toBe(false);
    expect(sameToken('', 'abc')).toBe(false);
  });
});

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
import { askRunner } from '../../../src/turns/ask/client.ts';
import { ASK_REPLY, ASK_SOCKET_FILE, type AskHandler } from '../../../src/turns/ask/tool.ts';
import { askRoot, QUESTION, TOOL_SERVER, testAskHost } from '../../fixtures/ask.ts';
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
    bridge.bind((questions) => {
      asked.push(questions);
      return { ok: true, text: ASK_REPLY };
    });
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
    const handler: AskHandler = () => ({ ok: true, text: 'shown' });
    bridge.bind(handler);
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

  it('gives a driver the folder, the MCP server and the socket’s variables', () => {
    const host = testAskHost(memoryLog().log);
    const bridge = host.open();
    expect(turnTools(host, bridge)).toEqual({
      dir: bridge.dir,
      ...TOOL_SERVER,
      env: { MWC_ASK_SOCKET: bridge.socketPath, MWC_ASK_TOKEN: bridge.token },
    });
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
    again.bind(() => ({ ok: true, text: 'asked again' }));
    expect(await askRunner(again.socketPath, bridge.token, [QUESTION])).toEqual({
      ok: true,
      text: 'asked again',
    });
    expect((await askRunner(again.socketPath, 'wrong', [QUESTION])).ok).toBe(false);
    again.close();
    again.close();
    expect(existsSync(bridge.dir)).toBe(false);
    expect(tokenDigest('tok')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('answerRequest', () => {
  const log = memoryLog().log;
  const handler: AskHandler = (questions) => ({ ok: true, text: `asked ${questions.length}` });

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

  it('compares tokens of any length', () => {
    expect(sameToken('abc', 'abc')).toBe(true);
    expect(sameToken('abc', 'abcd')).toBe(false);
    expect(sameToken('', 'abc')).toBe(false);
  });
});

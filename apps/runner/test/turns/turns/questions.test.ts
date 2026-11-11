import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { HarnessError } from '@mwc/harness-core';
import { FAKE_TOOLS_FILE, fakeLines, fakeTurnSpec } from '@mwc/harness-core/fake';
import { newId } from '@mwc/shared/ids';
import type { TurnQuestion } from '@mwc/shared/runner-protocol';
import { describe, expect, it, vi } from 'vitest';
import type { AskHost } from '../../../src/turns/ask/bridge.ts';
import { askRunner, NOT_IN_TURN } from '../../../src/turns/ask/client.ts';
import { ASK_REPLY, type AskReply } from '../../../src/turns/ask/tool.ts';
import { ASK_NOT_SHOWN } from '../../../src/turns/turn/events.ts';
import { ASK_ENDING, ASK_OFFLINE } from '../../../src/turns/turn.ts';
import { askRoot, QUESTION, TOOL_SERVER, testAskHost } from '../../fixtures/ask.ts';
import { memoryLog } from '../../fixtures/log.ts';
import type { FakeChild } from '../../fixtures/spawn.ts';
import { settle } from '../../fixtures/time.ts';
import { answerLines, FAKE_COMMAND, fakeHarnessHost, turnsWorld } from '../../fixtures/turns.ts';

/** A world whose host offers the runner's tools under a temporary root. */
function askWorld(options: { readonly ask?: AskHost; readonly online?: () => boolean } = {}) {
  const fake = fakeHarnessHost();
  const logs = memoryLog();
  const ask = options.ask ?? testAskHost(logs.log, askRoot(fake.root));
  const w = turnsWorld({
    host: { ...fake.host, ask },
    ...(options.online ? { online: options.online } : {}),
  });
  return { ...fake, w, logs };
}

const start = (w: ReturnType<typeof turnsWorld>, cwd: string) => {
  const turnId = newId();
  w.turns.handle({ type: 'turn.start', turnId, spec: fakeTurnSpec('claude_code', { cwd }) });
  return turnId;
};

/** The socket and token a started process got in its environment. */
const socketOf = (child: { readonly env?: Record<string, string> | undefined }) => ({
  socket: child.env?.MWC_ASK_SOCKET as string,
  token: child.env?.MWC_ASK_TOKEN as string,
});

const questions = (w: ReturnType<typeof turnsWorld>) =>
  w.sent.filter((frame): frame is TurnQuestion => frame.type === 'turn.question');

describe("a chat turn's questions", () => {
  it('gives the driver the MCP server and a private folder with its files, removed when the process ends', async () => {
    const { w, driver, cwd } = askWorld();
    let during: { files: string; mode: number; dirMode: number } | undefined;
    w.spawn.when(FAKE_COMMAND, (child) => {
      const dir = driver.tools[0]?.dir as string;
      during = {
        files: readFileSync(join(dir, FAKE_TOOLS_FILE), 'utf8'),
        mode: statSync(join(dir, FAKE_TOOLS_FILE)).mode & 0o777,
        dirMode: statSync(dir).mode & 0o777,
      };
      child.finish(answerLines(), 0);
    });
    start(w, cwd);
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    const tools = driver.tools[0];
    expect(tools).toMatchObject({ command: TOOL_SERVER.command, args: TOOL_SERVER.args });
    expect(during).toEqual({ files: JSON.stringify(TOOL_SERVER), mode: 0o600, dirMode: 0o700 });
    const env = w.spawn.calls[0]?.options.env;
    expect(env?.MWC_ASK_SOCKET).toBe(join(tools?.dir as string, 'ask.sock'));
    expect(env?.MWC_ASK_TOKEN).toMatch(/^[0-9a-f]{64}$/);
    expect(w.spawn.calls[0]?.args).toEqual(['turn', '--tools', tools?.dir]);
    expect(existsSync(tools?.dir as string)).toBe(false);
  });

  it('sends a question after the events before it, numbered next, and tells the agent to end its turn', async () => {
    const { w, cwd } = askWorld();
    const replies: AskReply[] = [];
    w.spawn.when(FAKE_COMMAND, (child: FakeChild) => {
      const said = [
        { type: 'session', sessionId: 's-1' } as const,
        { type: 'text', text: 'Which one?' } as const,
      ];
      child.stdout?.write(`${fakeLines(said).join('\n')}\n`);
      const { socket, token } = socketOf(w.spawn.calls[0]?.options ?? {});
      setTimeout(() => {
        void askRunner(socket, token, [QUESTION]).then((reply) => {
          replies.push(reply);
          child.finish(answerLines('Asked.'), 0);
        });
      }, 10);
    });
    const turnId = start(w, cwd);
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    expect(replies).toEqual([{ ok: true, text: ASK_REPLY }]);
    const order = w.sent.map((frame) => frame.type);
    expect(order.indexOf('turn.question')).toBeGreaterThan(order.indexOf('turn.events'));
    const [question] = questions(w);
    expect(question).toEqual({
      type: 'turn.question',
      turnId,
      seq: 3,
      questionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      questions: [QUESTION],
    });
    expect(w.events().map((item) => item.seq)).toEqual([1, 2, 4, 5, 6]);
    expect(w.logs.messages()).toContain('turn asked the person');
  });

  it('shows no question once the turn is ending, and none after it ended', async () => {
    const { w, cwd } = askWorld();
    w.spawn.when(FAKE_COMMAND, (child) => {
      child.dies = false;
    });
    const turnId = start(w, cwd);
    await vi.waitFor(() => expect(w.spawn.calls).toHaveLength(1));
    const { socket, token } = socketOf(w.spawn.calls[0]?.options ?? {});
    w.turns.handle({ type: 'turn.stop', turnId });
    expect(await askRunner(socket, token, [QUESTION])).toEqual({ ok: false, error: ASK_ENDING });
    w.spawn.calls[0]?.child.exit(null, 'SIGINT');
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    expect(await askRunner(socket, token, [QUESTION])).toEqual({ ok: false, error: NOT_IN_TURN });
    expect(questions(w)).toEqual([]);
  });

  it('says the question was not shown while the link is down, and resends a notice in its place', async () => {
    let online = true;
    const { w, cwd } = askWorld({ online: () => online });
    w.spawn.when(FAKE_COMMAND, (child) => {
      child.dies = false;
    });
    const turnId = start(w, cwd);
    await vi.waitFor(() => expect(w.spawn.calls).toHaveLength(1));
    const { socket, token } = socketOf(w.spawn.calls[0]?.options ?? {});
    online = false;
    expect(await askRunner(socket, token, [QUESTION])).toEqual({ ok: false, error: ASK_OFFLINE });
    expect(await askRunner(socket, token, [QUESTION])).toEqual({ ok: false, error: ASK_OFFLINE });
    w.spawn.calls[0]?.child.exit(0);
    await settle();
    expect(w.ends()).toEqual([]);
    online = true;
    w.sent.length = 0;
    w.turns.handle({ type: 'turn.resume', turns: [{ turnId, lastSeq: 0 }] });
    expect(w.events()[0]).toEqual({ seq: 1, event: ASK_NOT_SHOWN });
    expect(questions(w)).toEqual([]);
    expect(w.ends()).toHaveLength(1);
  });

  it('runs a turn without its tools when its folder cannot be made, and logs why', async () => {
    const failing: AskHost = {
      ...TOOL_SERVER,
      open: () => {
        throw new Error('no space left');
      },
      reopen: () => {
        throw new Error('no space left');
      },
    };
    const { w, driver, cwd, logs } = askWorld({ ask: failing });
    w.spawn.when(FAKE_COMMAND, (child) => child.finish(answerLines(), 0));
    start(w, cwd);
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    expect(driver.tools).toEqual([undefined]);
    expect(w.ends()[0]).toMatchObject({ ok: true });
    expect(w.logs.entries.find((entry) => entry.level === 'warn')).toMatchObject({
      msg: 'this turn runs without the question tool',
      error: 'no space left',
    });
    expect(logs.entries).toEqual([]);
  });

  it('closes the folder when the driver refuses the spec, a file cannot be written or the process cannot start', () => {
    const opened: string[] = [];
    const closed: string[] = [];
    const tracking = (fail?: 'write'): AskHost => ({
      ...TOOL_SERVER,
      reopen: () => {
        throw new Error('not used');
      },
      open: () => {
        const dir = `/t/${opened.length}`;
        opened.push(dir);
        return {
          dir,
          socketPath: `${dir}/ask.sock`,
          token: 'tok',
          tokenSha256: 'ab'.repeat(32),
          bind: () => undefined,
          write: () => {
            if (fail === 'write') throw new Error('read-only file system');
          },
          close: () => void closed.push(dir),
        };
      },
    });
    const refusing = askWorld({ ask: tracking() });
    refusing.driver.failNext(new HarnessError('invalid_spec', 'The model is not one word.'));
    start(refusing.w, refusing.cwd);
    const unwritable = askWorld({ ask: tracking('write') });
    start(unwritable.w, unwritable.cwd);
    const unstartable = askWorld({ ask: tracking() });
    unstartable.w.spawn.throwsFor.add(FAKE_COMMAND);
    start(unstartable.w, unstartable.cwd);
    expect([refusing, unwritable, unstartable].map((world) => world.w.ends()[0]?.error)).toEqual([
      'invalid_spec: The model is not one word.',
      'spawn_failed: read-only file system',
      `spawn_failed: cannot start ${FAKE_COMMAND}`,
    ]);
    expect(closed).toEqual(opened);
  });
});

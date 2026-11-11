import { appendFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { dirname, join } from 'node:path';
import { FAKE_CREDENTIALS, FakeHarnessDriver, fakeLines, fakeTurnSpec } from '@mwc/harness-core/fake';
import { newId } from '@mwc/shared/ids';
import type { TurnArtifact, TurnEnd, TurnQuestion } from '@mwc/shared/runner-protocol';
import { describe, expect, it, vi } from 'vitest';
import { nodeArtifactFs } from '../../../src/turns/artifacts/fs.ts';
import { askRunner } from '../../../src/turns/ask/client.ts';
import { ASK_REPLY } from '../../../src/turns/ask/tool.ts';
import { nodePrivateFs } from '../../../src/turns/files.ts';
import { LineReader } from '../../../src/turns/lines.ts';
import { PrivateDirs } from '../../../src/turns/private-dir.ts';
import { RunFolder } from '../../../src/turns/runs/folder.ts';
import { askRoot, QUESTION, testAskHost } from '../../fixtures/ask.ts';
import { memoryLog } from '../../fixtures/log.ts';
import { FAKE_COMMAND, fakeHarnessHost, turnsWorld } from '../../fixtures/turns.ts';

/**
 * A turn taken back after a runner restart (S5.4), on the fake keeper: its private folder (a Codex login it rewrote
 * still goes back), its outputs folder (collected at its end), its question socket (listening again for the same
 * token) and its messages (through the keeper's socket). The keeper's socket here is a plain Unix socket that greets
 * with the fake child's pid and records the commands it gets.
 */

const DIR = 'tasks/T-12/artifacts/1-develop/round-1';

/** A keeper's socket in a run folder: its greeting, the commands written to it, and its end (the harness exited). */
async function keeperSocket(dir: string, pid: number) {
  const commands: unknown[] = [];
  const sockets: Socket[] = [];
  const server = createServer((socket) => {
    sockets.push(socket);
    const reader = new LineReader();
    socket.on('data', (chunk) => {
      for (const line of reader.push(chunk)) commands.push(JSON.parse(line));
    });
    socket.write(`${JSON.stringify({ pid })}\n`);
  });
  await new Promise<void>((resolve) => server.listen(join(dir, 'k.sock'), resolve));
  return {
    commands,
    end(code: number) {
      writeFileSync(join(dir, 'exit.json'), JSON.stringify({ code, signal: null }));
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}

/** A Codex host with a login in its private folder, a task step's outputs folder and the runner's tools. */
function codexHost() {
  const driver = new FakeHarnessDriver({
    harness: 'codex',
    command: FAKE_COMMAND,
    liveInput: true,
    privateDir: {
      env: 'CODEX_HOME',
      path: null,
      files: [{ name: 'auth.json', contents: FAKE_CREDENTIALS.codex_oauth.authJson, mode: 0o600 }],
    },
  });
  const fake = fakeHarnessHost({ drivers: { codex: driver } });
  const logs = memoryLog();
  const ask = testAskHost(logs.log, askRoot(fake.root));
  return { ...fake, host: { ...fake.host, artifacts: nodeArtifactFs(), ask } };
}

describe('a turn taken back after a restart', () => {
  it('keeps its private folder, outputs folder, question socket and messages, and ends with what it rewrote', async () => {
    const machine = codexHost();
    const first = turnsWorld({ host: machine.host });
    const turnId = newId();
    const spec = { ...fakeTurnSpec('codex', { cwd: machine.cwd }), artifacts: { dir: DIR } };
    first.turns.handle({ type: 'turn.start', turnId, spec });
    await vi.waitFor(() => expect(first.spawn.calls).toHaveLength(1));
    const call = first.spawn.calls[0] as (typeof first.spawn.calls)[number];
    const home = call.options.env?.CODEX_HOME as string;
    const token = call.options.env?.MWC_ASK_TOKEN as string;
    const socketPath = call.options.env?.MWC_ASK_SOCKET as string;
    await first.turns.stop();
    const [name] = readdirSync(machine.host.runs);
    const folder = new RunFolder(join(machine.host.runs, name as string));
    const keeper = await keeperSocket(folder.dir, call.child.pid);
    // The next runner: the same machine's folders, a fresh process's memory.
    const fs = nodePrivateFs();
    const host = { ...machine.host, dirs: new PrivateDirs({ fs, stateDir: machine.stateDir }) };
    const second = turnsWorld({ host });
    await second.turns.reattach();
    expect(second.turns.held()).toEqual([{ turnId, lastSeq: 0, ended: false }]);
    second.turns.handle({ type: 'turn.resume', turns: [{ turnId, lastSeq: 0 }] });
    expect(existsSync(join(home, 'auth.json'))).toBe(true);
    second.turns.handle({ type: 'turn.input', turnId, inputId: newId(), text: 'Use staging' });
    await vi.waitFor(() => expect(keeper.commands).toHaveLength(1));
    expect(await askRunner(socketPath, token, [QUESTION])).toEqual({ ok: true, text: ASK_REPLY });
    writeFileSync(join(machine.cwd, DIR, 'notes.md'), '# Notes');
    writeFileSync(join(home, 'auth.json'), '{"tokens":{"access_token":"fresh"}}');
    appendFileSync(folder.path('out'), `${fakeLines([{ type: 'result', ok: true, text: 'Done.' }])}\n`);
    keeper.end(0);
    await vi.waitFor(() => expect(second.ends()).toHaveLength(1));
    const end = second.ends()[0] as TurnEnd;
    expect(end).toEqual({
      type: 'turn.end',
      turnId,
      ok: true,
      exitCode: 0,
      authJson: '{"tokens":{"access_token":"fresh"}}',
    });
    const types = second.sent.map((frame) => frame.type);
    expect(types.indexOf('turn.artifact')).toBeLessThan(types.indexOf('turn.end'));
    expect((second.sent.find((frame) => frame.type === 'turn.artifact') as TurnArtifact).path).toBe(
      'notes.md',
    );
    expect((second.sent.find((frame) => frame.type === 'turn.question') as TurnQuestion).seq).toBe(1);
    expect(second.events().map((item) => item.event.type)).toEqual(['result']);
    second.turns.handle({ type: 'turn.ack', turnId });
    expect(existsSync(folder.dir)).toBe(false);
    expect(existsSync(join(home, 'auth.json'))).toBe(false);
    expect(existsSync(dirname(socketPath))).toBe(false);
  });

  it('walks the stop ladder again when it was stopping as the runner went away', async () => {
    const machine = fakeHarnessHost();
    const first = turnsWorld({ host: machine.host });
    const turnId = newId();
    first.spawn.when(FAKE_COMMAND, (child) => {
      child.dies = false;
    });
    first.turns.handle({
      type: 'turn.start',
      turnId,
      spec: fakeTurnSpec('claude_code', { cwd: machine.cwd }),
    });
    await vi.waitFor(() => expect(first.spawn.calls).toHaveLength(1));
    first.turns.handle({ type: 'turn.stop', turnId });
    await first.turns.stop();
    const [name] = readdirSync(machine.host.runs);
    const folder = new RunFolder(join(machine.host.runs, name as string));
    expect(folder.meta()?.stopping).toBe(true);
    const keeper = await keeperSocket(folder.dir, 4000);
    const second = turnsWorld({ host: machine.host });
    await second.turns.reattach();
    expect(second.spawn.groupKills).toEqual([{ pid: 4000, signal: 'SIGINT' }]);
    second.turns.handle({ type: 'turn.input', turnId, inputId: newId(), text: 'too late' });
    keeper.end(130);
    await vi.waitFor(() => expect(second.turns.held()[0]?.ended).toBe(true));
    second.turns.handle({ type: 'turn.resume', turns: [{ turnId, lastSeq: 0 }] });
    expect(second.ends()[0]).toMatchObject({ turnId, ok: false, error: 'stopped', exitCode: 130 });
    expect(keeper.commands).toEqual([]);
  });
});

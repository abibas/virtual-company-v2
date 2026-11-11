import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ClaudeCodeDriver } from '@mwc/harness-claude-code';
import { CLAUDE_SCENARIOS, CLAUDE_SESSION_ID } from '@mwc/harness-claude-code/fixtures';
import { type LineParser, PARSER_TICK_MS, type ProcessSpec } from '@mwc/harness-core';
import { FakeHarnessDriver, fakeLines, fakeTurnSpec } from '@mwc/harness-core/fake';
import { newId } from '@mwc/shared/ids';
import type { TurnEnd, TurnRunnerFrame } from '@mwc/shared/runner-protocol';
import { describe, expect, it, vi } from 'vitest';
import { nodePrivateFs } from '../../src/turns/files.ts';
import { RunFolder } from '../../src/turns/runs/folder.ts';
import { JOURNAL_POLL_MS, TurnProcess } from '../../src/turns/turn.ts';
import { memoryLog } from '../fixtures/log.ts';
import { tempDir } from '../fixtures/runner.ts';
import { FAKE_KEEPER, type FakeChild, FakeSpawn } from '../fixtures/spawn.ts';
import { FakeTime } from '../fixtures/time.ts';

const KEEPER = { command: FAKE_KEEPER, args: [] };

/** One turn process on a fake keeper in a temporary run folder, with what it sent. */
function turnOf(
  parser: LineParser,
  process: ProcessSpec,
  options: { stdinOpen?: boolean; online?: () => boolean } = {},
) {
  const spawn = new FakeSpawn();
  const time = new FakeTime();
  const sent: TurnRunnerFrame[] = [];
  const ended: string[] = [];
  const done: string[] = [];
  const turnId = newId();
  const folder = RunFolder.create(join(tempDir(), 'runs'), turnId);
  const deps = {
    spawn: spawn.spawn,
    killGroup: spawn.killGroup,
    timers: time,
    log: memoryLog().log,
    readAt: nodePrivateFs().readAt,
    send: (frame: TurnRunnerFrame) => {
      sent.push(frame);
      return options.online?.() ?? true;
    },
    ended: (id: string) => void ended.push(id),
    done: (id: string) => void done.push(id),
  };
  const parts = {
    folder,
    harness: 'claude_code' as const,
    cwd: '/home/agent/work',
    parser,
    lease: undefined,
    stdinOpen: options.stdinOpen ?? false,
  };
  const turn = new TurnProcess(turnId, parts, deps);
  const launch = { process, env: {}, keeper: KEEPER, startedAt: time.now() };
  const events = () =>
    sent.flatMap((frame) => (frame.type === 'turn.events' ? frame.events.map((i) => i.event) : []));
  const end = () => sent.find((frame): frame is TurnEnd => frame.type === 'turn.end');
  return { turn, spawn, time, sent, ended, done, events, end, folder, launch, parts, deps };
}

const fake = (prompt = 'Hi') => {
  const driver = new FakeHarnessDriver({ command: 'fake' });
  return { parser: driver.parser(), process: driver.turn(fakeTurnSpec('claude_code', { prompt })) };
};

describe('one turn process', () => {
  it('reads lines split across writes and a last line without a newline, and records its meta', async () => {
    const { parser, process } = fake();
    const t = turnOf(parser, process);
    t.spawn.when('fake', (child) => {
      const [session, reply] = fakeLines([
        { type: 'session', sessionId: 's-1' },
        { type: 'result', ok: true, text: 'ok' },
      ]) as [string, string];
      child.stdout?.write(session.slice(0, 5));
      child.stdout?.write(`${session.slice(5)}\r\n`);
      child.stdout?.write(reply);
      child.exit(0);
    });
    t.turn.start(t.launch);
    expect(t.folder.meta()).toMatchObject({ v: 1, turnId: t.turn.turnId, pid: 4000, stdinOpen: false });
    await t.turn.done;
    expect(t.events()).toEqual([
      { type: 'session', sessionId: 's-1' },
      { type: 'result', ok: true, text: 'ok' },
    ]);
    expect(t.end()).toMatchObject({ ok: true, exitCode: 0 });
    expect(t.ended).toEqual([t.turn.turnId]);
    expect(t.turn.held).toEqual({ turnId: t.turn.turnId, lastSeq: 2, ended: true });
    t.turn.acknowledged();
    expect(t.done).toEqual([t.turn.turnId]);
    expect(existsSync(t.folder.dir)).toBe(false);
  });

  it('fails with the end of stderr when the harness exits without a result', async () => {
    const { parser, process } = fake();
    const t = turnOf(parser, process);
    t.spawn.when('fake', (child) => {
      child.printErr('Error: not logged in\n');
      child.exit(1);
    });
    t.turn.start(t.launch);
    await t.turn.done;
    expect(t.events()).toEqual([
      { type: 'result', ok: false, error: 'Claude Code exited with code 1: Error: not logged in' },
    ]);
    expect(t.end()).toEqual({ type: 'turn.end', turnId: t.turn.turnId, ok: false, exitCode: 1 });
    t.turn.acknowledged();
    await t.turn.stop();
    expect(t.spawn.groupKills).toEqual([]);
  });

  it('reads the output every poll while the process runs, and asks a following parser every second', async () => {
    let ticks = 0;
    const parser: LineParser = {
      feed: (text) => [{ type: 'text', text }],
      end: () => [{ type: 'result', ok: true }],
      tick: () => {
        ticks += 1;
        return ticks === 2 ? [{ type: 'notice', level: 'info', message: 'a subagent started' }] : [];
      },
    };
    const t = turnOf(parser, fake().process);
    t.turn.start(t.launch);
    const child = t.spawn.calls[0]?.child as FakeChild;
    child.stdout?.write('one\n');
    await t.time.advance(JOURNAL_POLL_MS);
    await t.time.advance(2 * PARSER_TICK_MS);
    child.stdout?.write('two\n');
    child.exit(0);
    await t.turn.done;
    await t.time.advance(5 * PARSER_TICK_MS);
    expect(ticks).toBe(2);
    expect(t.events()).toEqual([
      { type: 'text', text: 'one' },
      { type: 'notice', level: 'info', message: 'a subagent started' },
      { type: 'text', text: 'two' },
      { type: 'result', ok: true },
    ]);
    expect(t.time.pending).toEqual([]);
  });

  it('closes the stdin of a turn that takes messages at a result when its parser says nothing of being settled', async () => {
    const parser: LineParser = {
      feed: (text) => (text === 'done' ? [{ type: 'result', ok: true }] : []),
      end: () => [],
    };
    const t = turnOf(parser, { ...fake().process, stdinOpen: true }, { stdinOpen: true });
    const parts = { ...t.parts, inputLine: (text: string) => `${text}\n` };
    const turn = new TurnProcess(t.turn.turnId, parts, t.deps);
    turn.start(t.launch);
    const child = t.spawn.calls[0]?.child as FakeChild;
    expect(child.inputClosed).toBe(false);
    child.stdout?.write('done\n');
    await t.time.advance(JOURNAL_POLL_MS);
    expect(child.inputClosed).toBe(true);
    child.exit(0);
    await turn.done;
  });

  it('plays a recorded-style Claude Code turn through the real parser', async () => {
    const driver = new ClaudeCodeDriver({ command: '/opt/bin/claude' });
    const process = driver.turn(fakeTurnSpec('claude_code', { prompt: 'What is 2 + 2?' }));
    const t = turnOf(driver.parser(), process, { stdinOpen: true });
    t.spawn.when('/opt/bin/claude', (child) =>
      child.finish(`${CLAUDE_SCENARIOS.answer.lines.join('\n')}\n`, 0),
    );
    t.turn.start(t.launch);
    await vi.waitFor(() => expect(t.end()).toBeDefined());
    expect(t.spawn.calls[0]?.args.slice(0, 4)).toEqual(['-p', '--output-format', 'stream-json', '--verbose']);
    const first = JSON.parse(t.spawn.calls[0]?.child.input ?? '');
    expect(first.message.content).toEqual([{ type: 'text', text: 'What is 2 + 2?' }]);
    expect(t.events()[0]).toEqual({ type: 'session', sessionId: CLAUDE_SESSION_ID });
    expect(t.events().at(-1)).toMatchObject({ type: 'result', ok: true });
    expect(t.end()).toMatchObject({ ok: true, exitCode: 0 });
  });

  it('holds its frames back while detached and resends what the server did not store once attached', async () => {
    let online = true;
    const { parser, process } = fake();
    const t = turnOf(parser, process, { online: () => online });
    t.turn.start(t.launch);
    const child = t.spawn.calls[0]?.child as FakeChild;
    child.stdout?.write(`${fakeLines([{ type: 'text', text: 'one' }])}\n`);
    await t.time.advance(JOURNAL_POLL_MS * 2);
    online = false;
    child.stdout?.write(`${fakeLines([{ type: 'text', text: 'two' }])}\n`);
    await t.time.advance(JOURNAL_POLL_MS * 2);
    t.turn.detach();
    child.finish(`${fakeLines([{ type: 'result', ok: true, text: 'done' }])}\n`, 0);
    await t.turn.done;
    expect(t.end()).toBeUndefined();
    online = true;
    t.sent.length = 0;
    t.turn.attach(1);
    expect(t.events()).toEqual([
      { type: 'text', text: 'two' },
      { type: 'result', ok: true, text: 'done' },
    ]);
    expect(t.end()).toMatchObject({ ok: true, exitCode: 0 });
  });

  it('is forgotten when the server no longer has it: stopped, nothing sent, its folder gone once it ended', async () => {
    const { parser, process } = fake();
    const t = turnOf(parser, process);
    t.turn.start(t.launch);
    t.turn.forget();
    await t.turn.done;
    expect(t.spawn.groupKills.map((kill) => kill.signal)).toEqual(['SIGINT']);
    expect(t.end()).toBeUndefined();
    expect(t.done).toEqual([t.turn.turnId]);
    expect(existsSync(t.folder.dir)).toBe(false);
  });

  it('is taken back from its folder after a restart: the output read again up to the log, then on', async () => {
    const { parser, process } = fake();
    const first = turnOf(parser, process);
    first.turn.start(first.launch);
    const child = first.spawn.calls[0]?.child as FakeChild;
    child.stdout?.write(`${fakeLines([{ type: 'session', sessionId: 's-1' }])}\n`);
    await first.time.advance(JOURNAL_POLL_MS);
    first.turn.release();
    expect(child.released).toBe(true);
    child.stdout?.write(`${fakeLines([{ type: 'text', text: 'while away' }])}\n`);
    child.exit(0);
    const meta = first.folder.meta();
    if (meta === undefined) throw new Error('no meta');
    const again = new TurnProcess(meta.turnId, { ...first.parts, parser: fake().parser }, first.deps);
    first.sent.length = 0;
    again.resume(meta, undefined);
    await again.done;
    expect(first.end()).toBeUndefined();
    again.attach(1);
    expect(first.events()).toEqual([
      { type: 'text', text: 'while away' },
      { type: 'result', ok: false, error: 'Claude Code ended without finishing the turn' },
    ]);
    expect(first.end()).toMatchObject({ ok: false, exitCode: 0 });
    // Taken back once more before the end was acknowledged: nothing read again, the same end.
    const third = new TurnProcess(meta.turnId, { ...first.parts, parser: fake().parser }, first.deps);
    first.sent.length = 0;
    third.resume(meta, undefined);
    third.attach(3);
    expect(first.events()).toEqual([]);
    expect(first.end()).toMatchObject({ ok: false, exitCode: 0 });
  });
});

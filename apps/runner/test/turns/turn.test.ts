import { ClaudeCodeDriver } from '@mwc/harness-claude-code';
import { CLAUDE_SCENARIOS, CLAUDE_SESSION_ID } from '@mwc/harness-claude-code/fixtures';
import { FakeHarnessDriver, fakeLines, fakeTurnSpec } from '@mwc/harness-core/fake';
import { newId } from '@mwc/shared/ids';
import type { TurnRunnerFrame } from '@mwc/shared/runner-protocol';
import { describe, expect, it, vi } from 'vitest';
import { TurnProcess } from '../../src/turns/turn.ts';
import { memoryLog } from '../fixtures/log.ts';
import { FakeSpawn } from '../fixtures/spawn.ts';
import { FakeTime } from '../fixtures/time.ts';

/** One turn process on a fake spawn, with what it sent. */
function turnOf(driver: ClaudeCodeDriver | FakeHarnessDriver, prompt = 'Hi') {
  const spawn = new FakeSpawn();
  const time = new FakeTime();
  const sent: TurnRunnerFrame[] = [];
  const ended: string[] = [];
  const process = driver.turn(fakeTurnSpec('claude_code', { prompt }));
  const inputLine = process.stdinOpen ? driver.inputLine.bind(driver) : undefined;
  const turn = new TurnProcess(
    newId(),
    { process, cwd: '/home/agent/work', env: {}, parser: driver.parser(), lease: undefined, inputLine },
    {
      spawn: spawn.spawn,
      killGroup: spawn.killGroup,
      timers: time,
      log: memoryLog().log,
      send: (frame) => sent.push(frame) > 0,
      ended: (id) => void ended.push(id),
    },
  );
  const events = () =>
    sent.flatMap((frame) => (frame.type === 'turn.events' ? frame.events.map((i) => i.event) : []));
  const end = () => sent.find((frame) => frame.type === 'turn.end');
  return { turn, spawn, time, sent, ended, events, end };
}

describe('one turn process', () => {
  it('reads lines split across chunks and a last line without a newline', async () => {
    const t = turnOf(new FakeHarnessDriver({ command: 'fake' }));
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
    t.turn.start();
    await t.turn.done;
    expect(t.events()).toEqual([
      { type: 'session', sessionId: 's-1' },
      { type: 'result', ok: true, text: 'ok' },
    ]);
    expect(t.end()).toMatchObject({ ok: true, exitCode: 0 });
    expect(t.ended).toEqual([t.turn.turnId]);
  });

  it('fails with the end of stderr when the harness exits without a result', async () => {
    const t = turnOf(new FakeHarnessDriver({ command: 'fake' }));
    t.spawn.when('fake', (child) => {
      child.printErr('Error: not logged in\n');
      child.exit(1);
    });
    t.turn.start();
    await t.turn.done;
    expect(t.events()).toEqual([
      { type: 'result', ok: false, error: 'Claude Code exited with code 1: Error: not logged in' },
    ]);
    expect(t.end()).toEqual({ type: 'turn.end', turnId: t.turn.turnId, ok: false, exitCode: 1 });
    await t.turn.stop('stopped');
    expect(t.spawn.groupKills).toEqual([]);
  });

  it('plays a recorded-style Claude Code turn through the real parser', async () => {
    const t = turnOf(new ClaudeCodeDriver({ command: '/opt/bin/claude' }), 'What is 2 + 2?');
    t.spawn.when('/opt/bin/claude', (child) =>
      child.finish(`${CLAUDE_SCENARIOS.answer.lines.join('\n')}\n`, 0),
    );
    t.turn.start();
    await vi.waitFor(() => expect(t.end()).toBeDefined());
    expect(t.spawn.calls[0]?.args).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--input-format',
      'stream-json',
      '--replay-user-messages',
    ]);
    const first = JSON.parse(t.spawn.calls[0]?.child.input ?? '');
    expect(first.message.content).toEqual([{ type: 'text', text: 'What is 2 + 2?' }]);
    expect(t.spawn.calls[0]?.child.inputClosed).toBe(true);
    expect(t.events()[0]).toEqual({ type: 'session', sessionId: CLAUDE_SESSION_ID });
    expect(t.events().at(-1)).toMatchObject({ type: 'result', ok: true });
    expect(t.end()).toMatchObject({ ok: true, exitCode: 0 });
  });
});

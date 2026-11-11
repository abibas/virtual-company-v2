import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeLines, fakeTurnSpec } from '@mwc/harness-core/fake';
import { newId } from '@mwc/shared/ids';
import { TURN_STOP_KILL_MS, TURN_STOP_TERM_MS, type TurnEventItem } from '@mwc/shared/runner-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LineReader } from '../../../src/turns/lines.ts';
import { RunFolder } from '../../../src/turns/runs/folder.ts';
import { countedLines, realKillGroup, realMachine, realTurns } from '../../fixtures/real-turns.ts';
import { FakeTime } from '../../fixtures/time.ts';

/**
 * Turns that survive their runner (S5.4), on real processes: the real keeper and the fake harness binary, a first
 * runner that goes away mid-turn and a second one on the same state folder that takes the turn back.
 */

const SLOW = { timeout: 15_000, interval: 50 };
const leftovers: (() => void)[] = [];

afterEach(() => {
  for (const clean of leftovers.splice(0)) clean();
});

const start = (world: ReturnType<typeof realTurns>, cwd: string, prompt = 'Go') => {
  const turnId = newId();
  world.turns.handle({ type: 'turn.start', turnId, spec: fakeTurnSpec('claude_code', { cwd, prompt }) });
  return turnId;
};

const seqsOf = (items: readonly TurnEventItem[]) => items.map((item) => item.seq);
const textsOf = (items: readonly TurnEventItem[]) =>
  items.flatMap((item) => (item.event.type === 'text' ? [item.event.text] : []));
const lastSeqOf = (world: ReturnType<typeof realTurns>) => Math.max(0, ...seqsOf(world.events()));

/** The one run folder of the machine (throws when there is none). */
const folderOf = (stateDir: string) => {
  const [name] = readdirSync(join(stateDir, 'runs'));
  if (name === undefined) throw new Error('no run folder');
  return new RunFolder(join(stateDir, 'runs', name));
};

/** Kills a turn's keeper and harness for good on cleanup (a test that fails midway leaves nothing running). */
const reap = (stateDir: string) =>
  leftovers.push(() => {
    const runs = join(stateDir, 'runs');
    const pid = existsSync(runs) && readdirSync(runs).length > 0 ? folderOf(stateDir).meta()?.pid : undefined;
    if (pid !== undefined) realKillGroup(pid, 'SIGKILL');
  });

describe('a turn whose runner goes away', () => {
  it('runs on, and the next runner takes it back: the events continue once, the end has its exit code', async () => {
    const machine = realMachine();
    reap(machine.stateDir);
    const driver = machine.driver({ lines: countedLines(8), delayMs: 250, exitCode: 0 });
    const first = realTurns(machine, driver);
    const turnId = start(first, machine.cwd);
    await vi.waitFor(() => expect(first.events().length).toBeGreaterThanOrEqual(2), SLOW);
    await first.turns.stop();
    const lastSeq = lastSeqOf(first);
    const second = realTurns(machine, driver);
    await second.turns.reattach();
    expect(second.turns.held()).toEqual([
      { turnId, lastSeq: expect.any(Number), ended: expect.any(Boolean) },
    ]);
    expect(second.sent).toEqual([]);
    second.turns.handle({ type: 'turn.resume', turns: [{ turnId, lastSeq }] });
    await vi.waitFor(() => expect(second.ends()).toHaveLength(1), SLOW);
    const all = [...first.events(), ...second.events()];
    expect(seqsOf(all)).toEqual(all.map((_, i) => i + 1));
    expect(textsOf(all)).toEqual(Array.from({ length: 8 }, (_, i) => `line ${i + 1}`));
    expect(all.at(-1)?.event).toEqual({ type: 'result', ok: true, text: 'done' });
    expect(second.ends()[0]).toEqual({ type: 'turn.end', turnId, ok: true, exitCode: 0 });
    second.turns.handle({ type: 'turn.ack', turnId });
    expect(readdirSync(join(machine.stateDir, 'runs'))).toEqual([]);
  }, 30_000);

  it('ends with its exit code when the process ended while the runner was away', async () => {
    const machine = realMachine();
    const driver = machine.driver({ lines: countedLines(3), delayMs: 200, exitCode: 0 });
    const first = realTurns(machine, driver);
    const turnId = start(first, machine.cwd);
    await vi.waitFor(() => expect(first.events().length).toBeGreaterThanOrEqual(1), SLOW);
    await first.turns.stop();
    await vi.waitFor(
      () => expect(folderOf(machine.stateDir).exit()).toEqual({ code: 0, signal: null }),
      SLOW,
    );
    const second = realTurns(machine, driver);
    await second.turns.reattach();
    expect(second.turns.held()).toEqual([{ turnId, lastSeq: expect.any(Number), ended: true }]);
    second.turns.handle({ type: 'turn.resume', turns: [{ turnId, lastSeq: lastSeqOf(first) }] });
    const all = [...first.events(), ...second.events()];
    expect(textsOf(all)).toEqual(['line 1', 'line 2', 'line 3']);
    expect(seqsOf(all)).toEqual([1, 2, 3, 4]);
    expect(second.ends()).toEqual([{ type: 'turn.end', turnId, ok: true, exitCode: 0 }]);
  }, 30_000);

  it('is lost, honestly, when its process was killed while the runner was away (no exit recorded)', async () => {
    const machine = realMachine();
    const lines = fakeLines([{ type: 'text', text: 'line 1' }]);
    const driver = machine.driver({ lines, exitCode: 0, holdMs: 60_000 });
    const first = realTurns(machine, driver);
    const turnId = start(first, machine.cwd);
    await vi.waitFor(() => expect(first.events().length).toBeGreaterThanOrEqual(1), SLOW);
    await first.turns.stop();
    const folder = folderOf(machine.stateDir);
    const pid = folder.meta()?.pid as number;
    realKillGroup(pid, 'SIGKILL');
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(), SLOW);
    const second = realTurns(machine, driver);
    await second.turns.reattach();
    expect(second.turns.held()).toEqual([{ turnId, lastSeq: expect.any(Number), ended: true }]);
    second.turns.handle({ type: 'turn.stop', turnId });
    second.turns.handle({ type: 'turn.resume', turns: [{ turnId, lastSeq: lastSeqOf(first) }] });
    expect(second.signals).toEqual([]);
    expect(folder.exit()).toBeUndefined();
    expect(second.events().at(-1)?.event).toEqual({
      type: 'result',
      ok: false,
      error: 'Claude Code was stopped before it finished the turn',
    });
    expect(second.ends()).toEqual([
      { type: 'turn.end', turnId, ok: false, exitCode: null, error: 'process_lost' },
    ]);
  }, 30_000);

  it('never signals a pid that is no longer the turn’s: a live stranger with the recorded pid, no keeper socket', async () => {
    const machine = realMachine();
    const stranger: ChildProcess = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
      detached: true,
      stdio: 'ignore',
    });
    leftovers.push(() => realKillGroup(stranger.pid as number, 'SIGKILL'));
    const turnId = newId();
    const folder = RunFolder.create(join(machine.stateDir, 'runs'), turnId);
    folder.writeMeta({
      v: 1,
      turnId,
      harness: 'claude_code',
      cwd: machine.cwd,
      pid: stranger.pid as number,
      startedAt: Date.now() - 60_000,
      stdinOpen: false,
      privateDir: null,
      artifacts: null,
      ask: null,
    });
    // A socket file nobody listens on (a keeper that was killed leaves one).
    writeFileSync(folder.path('socket'), '');
    const second = realTurns(machine, machine.driver({ lines: [], exitCode: 0 }));
    await second.turns.reattach();
    expect(second.turns.held()).toEqual([{ turnId, lastSeq: 1, ended: true }]);
    second.turns.handle({ type: 'turn.stop', turnId });
    second.turns.handle({ type: 'turn.resume', turns: [{ turnId, lastSeq: 0 }] });
    expect(second.signals).toEqual([]);
    expect(() => process.kill(stranger.pid as number, 0)).not.toThrow();
    expect(second.ends()[0]).toMatchObject({ ok: false, error: 'process_lost' });
  }, 30_000);
});

describe('a taken-back turn', () => {
  it('is stopped by the ladder through its keeper: SIGINT, SIGTERM 10 s later, SIGKILL 20 s after the SIGINT', async () => {
    const machine = realMachine();
    reap(machine.stateDir);
    const driver = machine.driver({
      lines: countedLines(1),
      exitCode: 0,
      holdMs: 60_000,
      ignoreSignals: true,
    });
    const first = realTurns(machine, driver);
    const turnId = start(first, machine.cwd);
    await vi.waitFor(() => expect(first.events().length).toBeGreaterThanOrEqual(1), SLOW);
    await first.turns.stop();
    const time = new FakeTime();
    const second = realTurns(machine, driver, { timers: time });
    await second.turns.reattach();
    second.turns.handle({ type: 'turn.resume', turns: [{ turnId, lastSeq: lastSeqOf(first) }] });
    second.turns.handle({ type: 'turn.stop', turnId });
    expect(second.signals).toEqual(['SIGINT']);
    await time.advance(TURN_STOP_TERM_MS);
    expect(second.signals).toEqual(['SIGINT', 'SIGTERM']);
    expect(second.ends()).toEqual([]);
    await time.advance(TURN_STOP_KILL_MS - TURN_STOP_TERM_MS);
    expect(second.signals).toEqual(['SIGINT', 'SIGTERM', 'SIGKILL']);
    await vi.waitFor(() => expect(second.ends()).toHaveLength(1), SLOW);
    expect(second.ends()[0]).toEqual({
      type: 'turn.end',
      turnId,
      ok: false,
      exitCode: null,
      error: 'stopped',
    });
  }, 30_000);

  it('takes the person’s messages through its keeper (Claude Code’s input mode), each echo kept once', async () => {
    const machine = realMachine();
    reap(machine.stateDir);
    const lines = fakeLines([
      { type: 'text', text: 'working' },
      { type: 'text', text: 'still working' },
      { type: 'text', text: 'almost' },
      { type: 'text', text: 'nearly' },
      { type: 'result', ok: true, text: 'Deployed.' },
    ]);
    const driver = machine.driver({ lines, delayMs: 700, exitCode: 0, liveInput: true }, { liveInput: true });
    const first = realTurns(machine, driver);
    const [before, after] = [newId(), newId()];
    const turnId = start(first, machine.cwd, 'Deploy it\n');
    first.turns.handle({ type: 'turn.input', turnId, inputId: before, text: 'Use staging' });
    await vi.waitFor(
      () => expect(first.events().some((item) => item.event.type === 'input')).toBe(true),
      SLOW,
    );
    await first.turns.stop();
    const second = realTurns(machine, driver);
    await second.turns.reattach();
    second.turns.handle({ type: 'turn.resume', turns: [{ turnId, lastSeq: lastSeqOf(first) }] });
    second.turns.handle({ type: 'turn.input', turnId, inputId: after, text: 'And tag it' });
    await vi.waitFor(() => expect(second.ends()).toHaveLength(1), SLOW);
    const all = [...first.events(), ...second.events()];
    expect(seqsOf(all)).toEqual(all.map((_, i) => i + 1));
    expect(all.filter((item) => item.event.type === 'input').map((item) => item.event)).toEqual([
      { type: 'input', text: 'Use staging', inputId: before },
      { type: 'input', text: 'And tag it', inputId: after },
    ]);
    expect(second.ends()[0]).toMatchObject({ ok: true, exitCode: 0 });
  }, 30_000);
});

describe('the chaos test: a runner killed with SIGKILL mid-turn', () => {
  it('leaves the turn running, and the next runner delivers every event after the last one sent, once', async () => {
    const machine = realMachine();
    reap(machine.stateDir);
    const driver = machine.driver({ lines: countedLines(6), delayMs: 300, exitCode: 0 });
    const turnId = newId();
    // The driver wrote its scenario as the machine's first one.
    const scenarioFile = join(machine.root, 'scenario-1.json');
    const host = spawn(
      process.execPath,
      [
        fileURLToPath(new URL('../../fixtures/turn-host.ts', import.meta.url)),
        machine.root,
        scenarioFile,
        turnId,
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    leftovers.push(() => host.kill('SIGKILL'));
    const reader = new LineReader();
    const sent: TurnEventItem[] = [];
    host.stdout?.on('data', (chunk) => {
      for (const line of reader.push(chunk)) {
        const frame = JSON.parse(line) as { type: string; events?: TurnEventItem[] };
        if (frame.type === 'turn.events') sent.push(...(frame.events ?? []));
      }
    });
    await vi.waitFor(() => expect(sent.length).toBeGreaterThanOrEqual(2), SLOW);
    host.kill('SIGKILL');
    await new Promise((resolve) => host.once('exit', resolve));
    const second = realTurns(machine, driver);
    await second.turns.reattach();
    const lastSeq = Math.max(...seqsOf(sent));
    second.turns.handle({ type: 'turn.resume', turns: [{ turnId, lastSeq }] });
    await vi.waitFor(() => expect(second.ends()).toHaveLength(1), SLOW);
    const all = [...sent, ...second.events()];
    expect(seqsOf(all)).toEqual(all.map((_, i) => i + 1));
    expect(textsOf(all)).toEqual(Array.from({ length: 6 }, (_, i) => `line ${i + 1}`));
    expect(second.ends()[0]).toEqual({ type: 'turn.end', turnId, ok: true, exitCode: 0 });
  }, 30_000);
});

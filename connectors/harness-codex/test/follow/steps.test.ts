import { describe, expect, it } from 'vitest';
import type { ChildLine } from '../../src/follow/child.ts';
import { CHILD_STEPS_MAX, ChildSteps } from '../../src/follow/steps.ts';
import { NOW_S, SINCE, SOL } from '../fixtures/follow.ts';

const OWN: ChildLine = { kind: 'turn', startedAt: NOW_S + 1, root: false };
const call = (callId: string, command = 'sleep 45'): ChildLine => ({ kind: 'call', callId, command });
const done = (callId: string, ok = true, command: string | undefined = 'sleep 45'): ChildLine => ({
  kind: 'done',
  callId,
  command,
  ok,
  summary: ok ? 'exit 0' : 'exit 1: boom',
});
const output = (text: string): ChildLine => ({ kind: 'output', callId: 'c1', output: text });

/** A subagent's steps in its own turn, on a file of `mode`. */
function stepsOf(paginated = true) {
  const steps = new ChildSteps(SOL, SINCE);
  steps.take({ kind: 'meta', paginated });
  steps.take(OWN);
  return steps;
}

const tool = (callId: string, summary = 'sleep 45') => ({
  type: 'tool',
  id: `${SOL}:${callId}`,
  name: 'command',
  summary,
  parentId: SOL,
});
const result = (callId: string, ok: boolean, summary: string) => ({
  type: 'tool_result',
  id: `${SOL}:${callId}`,
  ok,
  summary,
  parentId: SOL,
});

describe('ChildSteps', () => {
  it('skips the history it was forked with, the root thread’s running turn too, up to its own turn', () => {
    const steps = new ChildSteps(SOL, SINCE);
    expect(steps.take({ kind: 'turn', startedAt: NOW_S - 600, root: false })).toEqual({ events: [] });
    expect(steps.take(call('old', 'ls'))).toEqual({ events: [] });
    expect(steps.take({ kind: 'end', answer: 'old', error: undefined })).toEqual({ events: [] });
    expect(steps.take({ kind: 'turn', startedAt: NOW_S + 1, root: true })).toEqual({ events: [] });
    expect(steps.take(call('parent', 'git status'))).toEqual({ events: [] });
    expect(steps.take({ kind: 'message', text: 'I will spawn three agents.' })).toEqual({ events: [] });
    // `started_at` is whole seconds: a turn begun in the runner's second counts.
    expect(steps.take({ kind: 'turn', startedAt: NOW_S, root: false })).toEqual({ events: [] });
    expect(steps.take(call('c1')).events).toEqual([tool('c1')]);
  });

  it('shows a command when its call starts and its result when it ends, each once', () => {
    const steps = stepsOf();
    expect(steps.take(call('c1')).events).toEqual([tool('c1')]);
    expect(steps.take(call('c1')).events).toEqual([]);
    expect(steps.take(done('c1')).events).toEqual([result('c1', true, 'exit 0')]);
    expect(steps.take(done('c1')).events).toEqual([]);
    const unnamed: ChildLine = {
      kind: 'done',
      callId: 'c2',
      command: undefined,
      ok: false,
      summary: 'exit 1: boom',
    };
    expect(steps.take(unnamed).events).toEqual([tool('c2', ''), result('c2', false, 'exit 1: boom')]);
  });

  it('takes a legacy call’s output as its result, by its exit code, never while it still runs', () => {
    const steps = stepsOf(false);
    steps.take(call('c1'));
    expect(steps.take(output('Chunk ID: a\nProcess running with session ID 3\nOutput:\n')).events).toEqual(
      [],
    );
    expect(steps.take(output('Process exited with code 2\nOutput:\nno such file\n')).events).toEqual([
      result('c1', false, 'exit 2: no such file'),
    ]);
    const other = stepsOf(false);
    other.take(call('c1'));
    expect(other.take(output('Exit code: 0\nWall time: 45 s\nOutput:\n')).events).toEqual([
      result('c1', true, 'exit 0'),
    ]);
    const plain = stepsOf(false);
    plain.take(call('c1'));
    expect(plain.take(output('all good')).events).toEqual([result('c1', true, 'done: all good')]);
    const empty = stepsOf(false);
    empty.take(call('c1'));
    expect(empty.take(output('')).events).toEqual([result('c1', true, 'done')]);
    expect(empty.take(output('again')).events).toEqual([]);
  });

  it('leaves a paginated call’s result to its command item, and ignores the output of a call it never showed', () => {
    const steps = stepsOf(true);
    steps.take(call('c1'));
    expect(steps.take(output('Exit code: 0')).events).toEqual([]);
    expect(stepsOf(false).take(output('Exit code: 0')).events).toEqual([]);
  });

  it('shows its messages, and hands its turn’s end back', () => {
    const steps = stepsOf();
    expect(steps.take({ kind: 'message', text: 'Sleeping.' }).events).toEqual([
      { type: 'text', text: 'Sleeping.', parentId: SOL },
    ]);
    expect(steps.take({ kind: 'end', answer: 'Slept.', error: undefined })).toEqual({
      events: [],
      ended: { answer: 'Slept.', error: undefined },
    });
  });

  it('shows at most CHILD_STEPS_MAX commands and messages, the results of those shown still', () => {
    const steps = stepsOf();
    for (let index = 0; index < CHILD_STEPS_MAX - 1; index++) steps.take({ kind: 'message', text: 'm' });
    expect(steps.take(call('last')).events).toEqual([tool('last')]);
    expect(steps.take(call('over')).events).toEqual([]);
    expect(steps.take({ kind: 'message', text: 'over' }).events).toEqual([]);
    expect(steps.take(done('over')).events).toEqual([]);
    expect(steps.take(done('last')).events).toEqual([result('last', true, 'exit 0')]);
  });

  it('skips a call whose event id would be too long', () => {
    expect(stepsOf().take(call('x'.repeat(200))).events).toEqual([]);
  });
});

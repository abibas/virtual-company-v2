import { describe, expect, it } from 'vitest';
import { readChild, scanChild } from '../src/children.ts';
import { ROLLOUT_FIRST_READ } from '../src/rollout.ts';
import {
  CHILD_A,
  CHILD_B,
  childLines,
  childMeta,
  childPath,
  commandDone,
  execEnd,
} from './fixtures/children.ts';
import { memoryRollouts, turnContext } from './fixtures/rollout.ts';

const HOME = '/state/codex/abc';

describe('scanChild', () => {
  it('gives the model of its last turn, its role and its last command as a step', () => {
    expect(scanChild(childLines(CHILD_A, 'gpt-5.5', 'explorer'))).toEqual({
      model: 'gpt-5.5',
      role: 'explorer',
      lastStep: 'Ran python3 wait.py',
    });
    const later = [
      ...childLines(CHILD_A, 'gpt-5.5'),
      turnContext('gpt-6.1-sol'),
      execEnd(['python3', 'second.py', '--fast']),
    ];
    expect(scanChild(later)).toEqual({ model: 'gpt-6.1-sol', lastStep: 'Ran python3 second.py --fast' });
  });

  it("reads Codex's default role as none, and a role written as agent_type", () => {
    expect(scanChild([childMeta(CHILD_A, 'default')])).toEqual({});
    const typed = JSON.stringify({ type: 'session_meta', payload: { agent_type: 'worker' } });
    expect(scanChild([typed])).toEqual({ role: 'worker' });
  });

  it('takes a command given as a line, and skips commands it cannot read', () => {
    const asLine = JSON.stringify({
      type: 'event_msg',
      payload: { type: 'exec_command_end', command: ' ls ' },
    });
    expect(scanChild([asLine])).toEqual({ lastStep: 'Ran ls' });
    const odd = [
      execEnd([]),
      JSON.stringify({ type: 'event_msg', payload: { type: 'exec_command_end', command: 7 } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'item_completed', item: 'CommandExecution' } }),
      JSON.stringify({ type: 'event_msg', payload: 'exec_command_end' }),
      JSON.stringify({ type: 'turn_context', payload: 'x' }),
      '{"type":"session_meta" not json',
      'plain text',
    ];
    expect(scanChild(odd)).toEqual({});
  });

  it('clips a long step', () => {
    const step = scanChild([commandDone(['sh', '-c', 'x'.repeat(500)])]).lastStep;
    expect(step?.length).toBe(200);
    expect(step?.endsWith('…')).toBe(true);
  });
});

describe('readChild', () => {
  it("reads the subagent's own file in the home folder, once from its end", () => {
    const { fs, reads } = memoryRollouts({
      [childPath(HOME, CHILD_A)]: childLines(CHILD_A, 'gpt-5.5', 'worker').join('\n'),
    });
    expect(readChild(fs, HOME, CHILD_A)).toEqual({
      model: 'gpt-5.5',
      role: 'worker',
      lastStep: 'Ran python3 wait.py',
    });
    expect(reads).toEqual([ROLLOUT_FIRST_READ]);
  });

  it('drops the cut first line of a file longer than one read', () => {
    const filler = JSON.stringify({
      type: 'response_item',
      payload: { text: 'x'.repeat(ROLLOUT_FIRST_READ) },
    });
    const text = [childMeta(CHILD_A, 'worker'), filler, turnContext('gpt-5.5')].join('\n');
    const { fs } = memoryRollouts({ [childPath(HOME, CHILD_A)]: text });
    expect(readChild(fs, HOME, CHILD_A)).toEqual({ model: 'gpt-5.5' });
  });

  it('is nothing without its file, or when it cannot be read', () => {
    expect(readChild(memoryRollouts({}).fs, HOME, CHILD_B)).toBeUndefined();
    const { fs } = memoryRollouts({ [childPath(HOME, CHILD_A)]: '' });
    expect(readChild({ ...fs, tail: () => undefined }, HOME, CHILD_A)).toBeUndefined();
  });
});

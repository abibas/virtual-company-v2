import { describe, expect, it } from 'vitest';
import { findRollout, ROLLOUT_FIRST_READ, ROLLOUT_MAX_READ, readRollout } from '../src/rollout.ts';
import {
  FILE_NAME,
  memoryRollouts,
  READING,
  THREAD,
  TURN_LINES,
  tokenCount,
  turnContext,
  usage,
} from './fixtures/rollout.ts';

const HOME = '/state/codex/10b1a5d4a9d1aa79';
const at = (day: string, name = FILE_NAME) => `${HOME}/sessions/${day}/${name}`;

describe('findRollout', () => {
  it("finds the thread's file in the folder of the day it began, newest days first", () => {
    const { fs, listed } = memoryRollouts({
      [at('2026/11/09')]: '',
      [at('2026/11/10', 'rollout-2026-11-10T12-30-17-01a1c502-2e45-7c90-8b7b-fb89ce68ca5d.jsonl')]: '',
      [at('2025/12/31', 'rollout-x-other.jsonl')]: '',
      [`${HOME}/sessions/notes/x`]: '',
    });
    expect(findRollout(fs, HOME, THREAD)).toBe(at('2026/11/09'));
    expect(listed.slice(0, 4)).toEqual([
      `${HOME}/sessions`,
      `${HOME}/sessions/2026`,
      `${HOME}/sessions/2026/11`,
      `${HOME}/sessions/2026/11/10`,
    ]);
  });

  it('is nothing without the file, or without a sessions folder', () => {
    expect(
      findRollout(memoryRollouts({ [at('2026/11/09', 'rollout-x-other.jsonl')]: '' }).fs, HOME, THREAD),
    ).toBe(undefined);
    expect(findRollout(memoryRollouts({}).fs, HOME, THREAD)).toBeUndefined();
  });
});

describe('readRollout', () => {
  it("reads the thread's last reading from the file's end", () => {
    const { fs, reads } = memoryRollouts({ [at('2026/11/09')]: `${TURN_LINES.join('\n')}\n` });
    expect(readRollout(fs, HOME, THREAD)).toEqual(READING);
    expect(reads).toEqual([ROLLOUT_FIRST_READ]);
  });

  it('reads further back, four times more each time, until the turn_context is in, and drops the cut first line', () => {
    const filler = JSON.stringify({
      type: 'response_item',
      payload: { content: 'x'.repeat(ROLLOUT_FIRST_READ) },
    });
    const text = [turnContext('gpt-6-sol'), filler, tokenCount(usage(9000, 8000, 10), 258_400)].join('\n');
    const { fs, reads } = memoryRollouts({ [at('2026/11/09')]: text });
    expect(readRollout(fs, HOME, THREAD)).toMatchObject({ model: 'gpt-6-sol', window: 258_400 });
    expect(reads).toEqual([ROLLOUT_FIRST_READ, ROLLOUT_FIRST_READ * 4]);
  });

  it('stops at its largest read, with the reading and no model when the turn began further back', () => {
    const filler = JSON.stringify({ payload: { content: 'x'.repeat(ROLLOUT_MAX_READ) } });
    const text = [turnContext('gpt-6-sol'), filler, tokenCount(usage(9000, 8000, 10))].join('\n');
    const { fs, reads } = memoryRollouts({ [at('2026/11/09')]: text });
    const reading = readRollout(fs, HOME, THREAD);
    expect(reading).toMatchObject({ window: 475_000 });
    expect(reading).not.toHaveProperty('model');
    expect(reads.at(-1)).toBe(ROLLOUT_MAX_READ);
  });

  it('is nothing for a file without a reading yet, a missing file, or one that cannot be read', () => {
    const empty = memoryRollouts({ [at('2026/11/09')]: TURN_LINES.slice(0, 3).join('\n') });
    expect(readRollout(empty.fs, HOME, THREAD)).toBeUndefined();
    expect(readRollout(memoryRollouts({}).fs, HOME, THREAD)).toBeUndefined();
    const { fs } = memoryRollouts({ [at('2026/11/09')]: '' });
    expect(readRollout({ ...fs, tail: () => undefined }, HOME, THREAD)).toBeUndefined();
  });
});

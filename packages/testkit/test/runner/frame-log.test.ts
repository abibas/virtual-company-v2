import { describe, expect, it } from 'vitest';
import { FrameLog } from '../../src/runner.ts';

type Frame = { readonly type: 'a'; readonly n: number } | { readonly type: 'b' };

describe('FrameLog', () => {
  it('hands out the frames already received once each, the oldest first, per type', async () => {
    const log = new FrameLog<Frame>();
    log.push({ type: 'a', n: 1 });
    log.push({ type: 'b' });
    log.push({ type: 'a', n: 2 });
    expect(await log.next('a')).toEqual({ type: 'a', n: 1 });
    expect(await log.next('a')).toEqual({ type: 'a', n: 2 });
    expect(await log.next('b')).toEqual({ type: 'b' });
    expect(log.of('a')).toEqual([
      { type: 'a', n: 1 },
      { type: 'a', n: 2 },
    ]);
    expect(log.all).toHaveLength(3);
  });

  it('waits for a frame still to come, and only for one that matches', async () => {
    const log = new FrameLog<Frame>();
    const second = log.next('a', (frame) => frame.n === 2);
    const any = log.next('a');
    log.push({ type: 'b' });
    log.push({ type: 'a', n: 1 });
    log.push({ type: 'a', n: 2 });
    expect(await second).toEqual({ type: 'a', n: 2 });
    expect(await any).toEqual({ type: 'a', n: 1 });
  });

  it('gives each waiter its own frame, in the order they asked', async () => {
    const log = new FrameLog<Frame>();
    const first = log.next('a');
    const second = log.next('a');
    log.push({ type: 'a', n: 1 });
    log.push({ type: 'a', n: 2 });
    expect([await first, await second]).toEqual([
      { type: 'a', n: 1 },
      { type: 'a', n: 2 },
    ]);
  });

  it('gives up after its timeout, naming what came, and leaves later frames for the next ask', async () => {
    const log = new FrameLog<Frame>();
    await expect(log.next('a', undefined, 10)).rejects.toThrow(
      'No a frame within 10 ms (frames so far: none)',
    );
    log.push({ type: 'b' });
    await expect(log.next('a', undefined, 10)).rejects.toThrow('(frames so far: b)');
    log.push({ type: 'a', n: 3 });
    expect(await log.next('a')).toEqual({ type: 'a', n: 3 });
  });
});

import { TERMINAL_DATA_MAX_BYTES } from '@mwc/shared/runner-protocol';
import { describe, expect, it } from 'vitest';
import {
  BUFFER_HIGH_BYTES,
  BUFFER_LOW_BYTES,
  BUFFER_POLL_MS,
  OUTPUT_BATCH_BYTES,
  OUTPUT_DELAY_MS,
  OutputBatcher,
} from '../../src/terminal/output.ts';
import { FakeTime } from '../fixtures/time.ts';

function batcher() {
  const time = new FakeTime();
  const sent: string[] = [];
  const state = { buffered: 0, pauses: 0, resumes: 0 };
  const output = new OutputBatcher({
    timers: time,
    send: (data) => sent.push(data),
    buffered: () => state.buffered,
    pause: () => {
      state.pauses += 1;
    },
    resume: () => {
      state.resumes += 1;
    },
  });
  const sizes = () => sent.map((data) => Buffer.from(data, 'base64').length);
  return { output, time, sent, state, sizes };
}

describe('the output batcher', () => {
  it('sends what came within 16 ms as one piece', async () => {
    const { output, time, sent } = batcher();
    output.push(Buffer.from('a'));
    await time.advance(OUTPUT_DELAY_MS - 1);
    output.push(Buffer.from('b'));
    output.push(Buffer.alloc(0));
    expect(sent).toEqual([]);
    await time.advance(1);
    expect(sent).toEqual([Buffer.from('ab').toString('base64')]);
    await time.advance(OUTPUT_DELAY_MS * 10);
    expect(sent).toHaveLength(1);
  });

  it('sends at once from 32 KB, in pieces of at most 64 KB', () => {
    const { output, sizes, time } = batcher();
    output.push(Buffer.alloc(OUTPUT_BATCH_BYTES - 1));
    expect(sizes()).toEqual([]);
    output.push(Buffer.alloc(1));
    expect(sizes()).toEqual([OUTPUT_BATCH_BYTES]);
    output.push(Buffer.alloc(TERMINAL_DATA_MAX_BYTES * 2 + 5));
    expect(sizes()).toEqual([OUTPUT_BATCH_BYTES, TERMINAL_DATA_MAX_BYTES, TERMINAL_DATA_MAX_BYTES, 5]);
    expect(time.pending).toEqual([]);
  });

  it("pauses the PTY while the link's send buffer is over 1 MB, until it is down to 256 KB", async () => {
    const { output, state, time } = batcher();
    state.buffered = BUFFER_HIGH_BYTES;
    output.push(Buffer.alloc(OUTPUT_BATCH_BYTES));
    expect(state.pauses).toBe(0);
    state.buffered = BUFFER_HIGH_BYTES + 1;
    output.push(Buffer.alloc(OUTPUT_BATCH_BYTES));
    expect(output.paused).toBe(true);
    expect(state.pauses).toBe(1);
    output.push(Buffer.alloc(OUTPUT_BATCH_BYTES));
    expect(state.pauses).toBe(1);
    state.buffered = BUFFER_LOW_BYTES + 1;
    await time.advance(BUFFER_POLL_MS);
    expect(state.resumes).toBe(0);
    state.buffered = BUFFER_LOW_BYTES;
    await time.advance(BUFFER_POLL_MS);
    expect(state.resumes).toBe(1);
    expect(output.paused).toBe(false);
  });

  it('sends what is left when closed, then nothing, and stops watching the buffer', async () => {
    const { output, sent, state, time } = batcher();
    state.buffered = BUFFER_HIGH_BYTES + 1;
    output.push(Buffer.alloc(OUTPUT_BATCH_BYTES));
    output.push(Buffer.from('tail'));
    output.close();
    expect(Buffer.from(sent.at(-1) as string, 'base64').toString()).toBe('tail');
    output.push(Buffer.from('late'));
    output.flush();
    await time.advance(BUFFER_POLL_MS * 4);
    expect(sent).toHaveLength(2);
    expect(state.resumes).toBe(0);
  });
});

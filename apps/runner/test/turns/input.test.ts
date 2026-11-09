import { PassThrough } from 'node:stream';
import { fakeInputLine } from '@mwc/harness-core/fake';
import type { TurnEvent } from '@mwc/shared/harness';
import { describe, expect, it } from 'vitest';
import { INPUT_QUIET_MS, TurnInput } from '../../src/turns/input.ts';
import { memoryLog } from '../fixtures/log.ts';
import { FakeTime } from '../fixtures/time.ts';

const ID = '0a8d6c3e-5f1b-4c2a-9e7d-3b6f1a2c4d5e';
const OTHER = '6b1f0c2d-8e3a-4d5b-9c7f-1a2b3c4d5e6f';
const RESULT: TurnEvent = { type: 'result', ok: true, text: 'Done' };

/** A turn's stdin on a pipe, with what was written and whether it was closed. */
function inputOf(options: { open?: boolean; line?: boolean; settled?: () => boolean; stdin?: boolean } = {}) {
  const time = new FakeTime();
  const logs = memoryLog();
  const pipe = new PassThrough();
  const seen = { text: '', closed: false };
  pipe.on('data', (chunk: Buffer) => {
    seen.text += chunk.toString();
  });
  pipe.on('finish', () => {
    seen.closed = true;
  });
  const input = new TurnInput({
    turnId: 'turn-1',
    stdin: options.stdin === false ? null : pipe,
    line: options.line === false ? undefined : fakeInputLine,
    open: options.open ?? true,
    settled: options.settled ?? (() => true),
    timers: time,
    log: logs.log,
  });
  return { input, time, logs, seen, pipe };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('a turn’s stdin', () => {
  it('closes after the prompt for a harness that takes no message mid-turn', async () => {
    for (const options of [{ open: false }, { line: false }]) {
      const t = inputOf(options);
      t.input.begin('What is 2 + 2?');
      await tick();
      expect(t.seen).toEqual({ text: 'What is 2 + 2?', closed: true });
      expect(t.input.open).toBe(false);
      expect(t.input.send(ID, 'Use staging')).toBe(false);
    }
  });

  it('stays open after the first message and writes each message once, by its id', async () => {
    const t = inputOf();
    t.input.begin('first\n');
    expect(t.input.open).toBe(true);
    expect(t.input.send(ID, 'Use staging')).toBe(true);
    expect(t.input.send(ID, 'Use staging')).toBe(true);
    await tick();
    expect(t.seen).toEqual({ text: `first\n${fakeInputLine('Use staging', ID)}`, closed: false });
    expect(t.logs.messages()).toEqual(['turn took a message']);
  });

  it('keeps the echoes of its own messages in the text it wrote, and drops the prompt’s and any other', () => {
    const t = inputOf();
    t.input.begin('first\n');
    t.input.send(ID, 'Use staging');
    const events = t.input.filter([
      { type: 'input', text: 'first' },
      { type: 'input', text: 'clipped…', inputId: ID },
      { type: 'input', text: 'never sent', inputId: OTHER },
      { type: 'text', text: 'On staging.' },
    ]);
    expect(events).toEqual([
      { type: 'input', text: 'Use staging', inputId: ID },
      { type: 'text', text: 'On staging.' },
    ]);
    expect(t.input.filter([{ type: 'input', text: 'again', inputId: ID }])).toEqual([]);
  });

  it('closes at a result once every message was taken and the harness is settled', async () => {
    const t = inputOf();
    t.input.begin('first\n');
    t.input.send(ID, 'Use staging');
    t.input.filter([{ type: 'input', text: 'x', inputId: ID }, RESULT]);
    await tick();
    expect(t.seen.closed).toBe(true);
    expect(t.input.send(OTHER, 'Too late')).toBe(false);
    expect(t.logs.entries.at(-1)).toMatchObject({ msg: 'turn input closed', why: 'answered', waiting: 0 });
    expect(t.time.pending).toEqual([]);
  });

  it('waits after a result for a message not taken yet, while the harness prints, then closes when quiet', async () => {
    const t = inputOf();
    t.input.begin('first\n');
    t.input.send(ID, 'Use staging');
    t.input.filter([RESULT]);
    expect(t.time.pending).toEqual([INPUT_QUIET_MS]);
    await t.time.advance(INPUT_QUIET_MS - 1);
    t.input.activity();
    expect(t.time.pending).toEqual([INPUT_QUIET_MS]);
    t.input.filter([RESULT]);
    expect(t.time.pending).toEqual([INPUT_QUIET_MS]);
    await t.time.advance(INPUT_QUIET_MS);
    await tick();
    expect(t.seen.closed).toBe(true);
    expect(t.logs.entries.at(-1)).toMatchObject({ why: 'quiet', waiting: 1 });
  });

  it('waits while the harness says a message still waits, and closes at its next settled result', async () => {
    let settled = false;
    const t = inputOf({ settled: () => settled });
    t.input.begin('first\n');
    t.input.filter([RESULT]);
    expect(t.input.open).toBe(true);
    settled = true;
    t.input.filter([RESULT]);
    expect(t.input.open).toBe(false);
    expect(t.time.pending).toEqual([]);
  });

  it('closes once when the turn ends or stops, and a quiet wait never closes it again', async () => {
    const t = inputOf();
    t.input.begin('first\n');
    t.input.activity();
    t.input.close('stopping');
    t.input.close();
    t.input.filter([RESULT]);
    await tick();
    expect(t.seen.closed).toBe(true);
    expect(t.logs.messages()).toEqual(['turn input closed']);
    expect(t.time.pending).toEqual([]);
  });

  it('runs without a stdin, and ignores a pipe the process closed first', () => {
    const none = inputOf({ stdin: false });
    none.input.begin('first');
    expect(none.input.open).toBe(false);
    expect(none.input.send(ID, 'x')).toBe(false);
    const gone = inputOf();
    gone.input.begin('first\n');
    expect(() => gone.pipe.emit('error', new Error('EPIPE'))).not.toThrow();
  });
});

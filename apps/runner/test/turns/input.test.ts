import { fakeInputLine } from '@mwc/harness-core/fake';
import type { TurnEvent } from '@mwc/shared/harness';
import { describe, expect, it } from 'vitest';
import { INPUT_QUIET_MS, TurnInput } from '../../src/turns/input.ts';
import type { InputRecord } from '../../src/turns/runs/folder.ts';
import { memoryLog } from '../fixtures/log.ts';
import { FakeTime } from '../fixtures/time.ts';

const ID = '0a8d6c3e-5f1b-4c2a-9e7d-3b6f1a2c4d5e';
const OTHER = '6b1f0c2d-8e3a-4d5b-9c7f-1a2b3c4d5e6f';
const RESULT: TurnEvent = { type: 'result', ok: true, text: 'Done' };

/** A turn's stdin through its keeper, with what was written, whether it was closed, and what was recorded. */
function inputOf(
  options: {
    open?: boolean;
    line?: boolean;
    settled?: () => boolean;
    stdin?: boolean;
    writes?: boolean;
  } = {},
) {
  const time = new FakeTime();
  const logs = memoryLog();
  const seen = { text: '', closed: false };
  const records: InputRecord[] = [];
  const stdin = {
    write: (text: string) => {
      if (options.writes === false) return false;
      seen.text += text;
      return true;
    },
    end: () => {
      seen.closed = true;
    },
  };
  const input = new TurnInput({
    turnId: 'turn-1',
    stdin: options.stdin === false ? undefined : stdin,
    line: options.line === false ? undefined : fakeInputLine,
    open: options.open ?? true,
    settled: options.settled ?? (() => true),
    timers: time,
    log: logs.log,
    record: (record) => void records.push(record),
  });
  return { input, time, logs, seen, records };
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

  it('runs without a stdin, and takes no message its keeper no longer takes', () => {
    const none = inputOf({ stdin: false });
    none.input.begin('first');
    expect(none.input.open).toBe(false);
    expect(none.input.send(ID, 'x')).toBe(false);
    const gone = inputOf({ writes: false });
    gone.input.begin('first\n');
    expect(gone.input.send(ID, 'x')).toBe(false);
    expect(gone.records).toEqual([]);
  });

  it('records each message written and the close, for a runner that takes the turn back (S5.4)', () => {
    const t = inputOf();
    t.input.begin('first\n');
    t.input.send(ID, 'Use staging');
    t.input.close();
    expect(t.records).toEqual([{ id: ID, text: 'Use staging' }, { end: true }]);
    const once = inputOf({ open: false });
    once.input.begin('prompt');
    expect(once.records).toEqual([{ end: true }]);
  });
});

describe('a turn’s stdin taken back after a restart', () => {
  it('keeps the earlier messages’ echoes and closes after the replay only when a settled result came', () => {
    const t = inputOf();
    t.input.restore([{ id: ID, text: 'Use staging' }]);
    expect(t.input.open).toBe(true);
    const echoed = t.input.filter([{ type: 'input', text: 'x', inputId: ID }, RESULT]);
    expect(echoed[0]).toEqual({ type: 'input', text: 'Use staging', inputId: ID });
    expect(t.seen.closed).toBe(false);
    t.input.replayed();
    expect(t.seen.closed).toBe(true);
    const quiet = inputOf();
    quiet.input.restore([]);
    quiet.input.replayed();
    expect(quiet.input.open).toBe(true);
  });

  it('knows a stdin closed before the restart, and one that never took messages', () => {
    const closed = inputOf();
    closed.input.restore([{ id: ID, text: 'x' }, { end: true }]);
    expect(closed.input.open).toBe(false);
    expect(closed.input.send(OTHER, 'y')).toBe(false);
    const once = inputOf({ open: false });
    once.input.restore([]);
    expect(once.input.open).toBe(false);
  });
});

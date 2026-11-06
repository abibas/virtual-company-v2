import { describe, expect, it } from 'vitest';
import { createLog } from '../src/log.ts';

describe('the JSON-lines log', () => {
  it('writes one JSON object per line with the time, the level, the message and the fields', () => {
    const lines: string[] = [];
    const log = createLog(
      (line) => lines.push(line),
      () => Date.UTC(2026, 10, 6, 9, 30),
    );
    log.info('connected', { machineId: 'm1' });
    log.warn('disconnected', { code: 1006 });
    log.error('a command failed', { error: new Error('boom'), type: 'machine.hold' });
    expect(lines.every((line) => line.endsWith('\n') && !line.slice(0, -1).includes('\n'))).toBe(true);
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { time: '2026-11-06T09:30:00.000Z', level: 'info', msg: 'connected', machineId: 'm1' },
      { time: '2026-11-06T09:30:00.000Z', level: 'warn', msg: 'disconnected', code: 1006 },
      {
        time: '2026-11-06T09:30:00.000Z',
        level: 'error',
        msg: 'a command failed',
        error: 'boom',
        type: 'machine.hold',
      },
    ]);
  });

  it('uses the wall clock by default and takes no fields', () => {
    const lines: string[] = [];
    createLog((line) => lines.push(line)).info('starting');
    const entry = JSON.parse(lines[0] as string) as { time: string; msg: string };
    expect(entry.msg).toBe('starting');
    expect(Math.abs(Date.parse(entry.time) - Date.now())).toBeLessThan(5000);
  });
});

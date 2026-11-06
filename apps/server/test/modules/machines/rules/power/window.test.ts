import type { KeepOnWindow } from '@mwc/shared/machines';
import { describe, expect, it } from 'vitest';
import {
  isoWeekday,
  keepOnWindowAt,
  localTime,
  minutesOf,
  offsetAt,
  zonedInstant,
} from '../../../../../src/modules/machines/rules/power/window.ts';

const HOUR = 60 * 60_000;
const at = (iso: string) => new Date(iso);
const iso = (ms: number) => new Date(ms).toISOString();
const keepOn = (fields: Partial<KeepOnWindow> = {}): KeepOnWindow => ({
  enabled: true,
  days: [1, 2, 3, 4, 5],
  from: '09:00',
  to: '19:00',
  timezone: 'Europe/Kyiv',
  ...fields,
});

describe('the clock of a time zone', () => {
  it('names ISO weekdays and reads wall-clock times', () => {
    expect(isoWeekday(2026, 11, 2)).toBe(1);
    expect(isoWeekday(2026, 11, 8)).toBe(7);
    expect(localTime(Date.parse('2026-11-06T22:30:15Z'), 'Europe/Kyiv')).toEqual({
      year: 2026,
      month: 11,
      day: 7,
      hour: 0,
      minute: 30,
      second: 15,
      weekday: 6,
    });
    expect(minutesOf('09:30')).toBe(570);
  });

  it("knows a zone's offset in winter and in summer, to the second", () => {
    expect(offsetAt(Date.parse('2026-01-15T12:00:00.750Z'), 'Europe/Kyiv')).toBe(2 * HOUR);
    expect(offsetAt(Date.parse('2026-07-15T12:00:00Z'), 'Europe/Kyiv')).toBe(3 * HOUR);
    expect(offsetAt(Date.parse('2026-07-15T12:00:00Z'), 'America/Chicago')).toBe(-5 * HOUR);
  });

  it('puts a wall-clock time on its instant, rolling a day past the month over', () => {
    expect(iso(zonedInstant(2026, 11, 6, 9 * 60, 'Europe/Kyiv'))).toBe('2026-11-06T07:00:00.000Z');
    expect(iso(zonedInstant(2026, 11, 31, 6 * 60, 'Europe/Kyiv'))).toBe('2026-12-01T04:00:00.000Z');
    expect(iso(zonedInstant(2026, 7, 1, 0, 'UTC'))).toBe('2026-07-01T00:00:00.000Z');
  });

  it('moves a time the clocks skip forward by the gap, and takes the first of a time they repeat', () => {
    // Kyiv springs from 03:00 to 04:00 on 2026-03-29 and falls from 04:00 back to 03:00 on 2026-10-25.
    expect(iso(zonedInstant(2026, 3, 29, 3 * 60 + 30, 'Europe/Kyiv'))).toBe('2026-03-29T01:30:00.000Z');
    expect(iso(zonedInstant(2026, 10, 25, 3 * 60 + 30, 'Europe/Kyiv'))).toBe('2026-10-25T00:30:00.000Z');
    // West of UTC too: Chicago skips 02:00–03:00 on 2026-03-08 and repeats 01:00–02:00 on 2026-11-01.
    expect(iso(zonedInstant(2026, 3, 8, 2 * 60 + 30, 'America/Chicago'))).toBe('2026-03-08T08:30:00.000Z');
    expect(iso(zonedInstant(2026, 11, 1, 60 + 30, 'America/Chicago'))).toBe('2026-11-01T06:30:00.000Z');
  });
});

describe('keepOnWindowAt', () => {
  it('is null while the hours are off', () => {
    expect(keepOnWindowAt(keepOn({ enabled: false }), at('2026-11-06T12:00:00Z'))).toBeNull();
  });

  it('finds the day window from its start up to (not at) its end, on the listed days only', () => {
    const window = keepOn();
    const friday = { id: '2026-11-06', start: at('2026-11-06T07:00:00Z'), end: at('2026-11-06T17:00:00Z') };
    expect(keepOnWindowAt(window, at('2026-11-06T12:00:00Z'))).toEqual(friday);
    expect(keepOnWindowAt(window, at('2026-11-06T07:00:00Z'))).toEqual(friday);
    expect(keepOnWindowAt(window, at('2026-11-06T06:59:59Z'))).toBeNull();
    expect(keepOnWindowAt(window, at('2026-11-06T17:00:00Z'))).toBeNull();
    expect(keepOnWindowAt(window, at('2026-11-07T12:00:00Z'))).toBeNull();
  });

  it('keeps a window overnight as one window, named by the day it starts', () => {
    const night = keepOn({ days: [1], from: '22:00', to: '06:00' });
    const monday = { id: '2026-11-02', start: at('2026-11-02T20:00:00Z'), end: at('2026-11-03T04:00:00Z') };
    expect(keepOnWindowAt(night, at('2026-11-02T21:00:00Z'))).toEqual(monday);
    expect(keepOnWindowAt(night, at('2026-11-03T01:00:00Z'))).toEqual(monday);
    expect(keepOnWindowAt(night, at('2026-11-03T04:00:00Z'))).toBeNull();
    // Tuesday is not a keep-on day, and Sunday's night (into Monday) is not either.
    expect(keepOnWindowAt(night, at('2026-11-03T21:00:00Z'))).toBeNull();
    expect(keepOnWindowAt(night, at('2026-11-02T01:00:00Z'))).toBeNull();
  });

  it('follows the clocks on the days they change', () => {
    // Saturday 22:00 EET to Sunday 06:00 EEST: seven hours of real time across the spring change.
    const spring = keepOn({ days: [6], from: '22:00', to: '06:00' });
    expect(keepOnWindowAt(spring, at('2026-03-29T02:59:00Z'))).toEqual({
      id: '2026-03-28',
      start: at('2026-03-28T20:00:00Z'),
      end: at('2026-03-29T03:00:00Z'),
    });
    expect(keepOnWindowAt(spring, at('2026-03-29T03:00:00Z'))).toBeNull();
    // An end the clocks skip moves forward by the gap; inside and the end agree.
    const skipped = keepOn({ days: [6], from: '22:00', to: '03:30' });
    expect(keepOnWindowAt(skipped, at('2026-03-29T01:29:00Z'))?.end).toEqual(at('2026-03-29T01:30:00Z'));
    expect(keepOnWindowAt(skipped, at('2026-03-29T01:30:00Z'))).toBeNull();
    // A day window on the autumn Sunday starts and ends at its wall-clock times.
    const autumn = keepOn({ days: [7] });
    expect(keepOnWindowAt(autumn, at('2026-10-25T12:00:00Z'))).toEqual({
      id: '2026-10-25',
      start: at('2026-10-25T07:00:00Z'),
      end: at('2026-10-25T17:00:00Z'),
    });
  });
});

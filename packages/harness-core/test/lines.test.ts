import { RESULT_ERROR_MAX, TurnEvent } from '@mwc/shared/harness';
import { describe, expect, it } from 'vitest';
import { countOf, failedResult, HARNESS_LABELS, isRecord, parseJsonLine, stringOf } from '../src/lines.ts';

describe('parseJsonLine', () => {
  it('reads a JSON object, with surrounding spaces and a carriage return', () => {
    expect(parseJsonLine('{"type":"x","n":1}')).toEqual({ type: 'x', n: 1 });
    expect(parseJsonLine('  {"type":"x"}\r')).toEqual({ type: 'x' });
  });

  it('gives null for a blank, partial or garbled line, and for JSON that is no object', () => {
    for (const line of [
      '',
      '   ',
      '{"type":"assis',
      'Error: boom',
      '[1,2]',
      '"text"',
      '42',
      'null',
      '{oops}',
    ]) {
      expect(parseJsonLine(line)).toBeNull();
    }
  });
});

describe('the field readers', () => {
  it('take only their own type', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(stringOf('a')).toBe('a');
    expect(stringOf(1)).toBeUndefined();
    expect(countOf(3)).toBe(3);
    expect(countOf(2.6)).toBe(3);
    expect(countOf(0)).toBe(0);
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, '3', null, undefined]) {
      expect(countOf(value)).toBeUndefined();
    }
  });
});

describe('failedResult', () => {
  it('says how the process ended and the first detail that says something', () => {
    expect(failedResult('claude_code', 1, ['', '  boom \n'])).toEqual({
      type: 'result',
      ok: false,
      error: 'Claude Code exited with code 1: boom',
    });
    expect(failedResult('codex', null, [undefined])).toEqual({
      type: 'result',
      ok: false,
      error: 'Codex was stopped before it finished the turn',
    });
    expect(failedResult('codex', 0, []).error).toBe('Codex ended without finishing the turn');
    expect(HARNESS_LABELS).toEqual({ claude_code: 'Claude Code', codex: 'Codex' });
  });

  it('keeps the end of a long detail within the error limit, as a valid event', () => {
    const event = failedResult('claude_code', 2, [`${'x'.repeat(5000)}\nthe last line`]);
    expect(event.error?.length).toBeLessThanOrEqual(RESULT_ERROR_MAX);
    expect(event.error?.startsWith('Claude Code exited with code 2: …')).toBe(true);
    expect(event.error?.endsWith('the last line')).toBe(true);
    expect(TurnEvent.parse(event)).toEqual(event);
  });
});

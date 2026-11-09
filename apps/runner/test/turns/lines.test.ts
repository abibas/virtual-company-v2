import { describe, expect, it } from 'vitest';
import { LineReader, STDERR_TAIL_BYTES, TailBuffer } from '../../src/turns/lines.ts';

describe('the stdout lines', () => {
  it('keeps a line split across chunks, ends lines at \\n or \\r\\n, and gives the last one without a newline', () => {
    const reader = new LineReader();
    expect(reader.push('{"a":')).toEqual([]);
    expect(reader.push(Buffer.from('1}\r\n{"b":2}\n\n{"c"'))).toEqual(['{"a":1}', '{"b":2}', '']);
    expect(reader.push(':3}')).toEqual([]);
    expect(reader.end()).toBe('{"c":3}');
    expect(reader.end()).toBeUndefined();
  });

  it('keeps a character whose bytes come in two chunks whole', () => {
    const reader = new LineReader();
    const bytes = Buffer.from('é\n');
    expect(reader.push(bytes.subarray(0, 1))).toEqual([]);
    expect(reader.push(bytes.subarray(1))).toEqual(['é']);
  });
});

describe('the stderr tail', () => {
  it('keeps the last 4 KB', () => {
    const tail = new TailBuffer();
    tail.push('start ');
    tail.push(Buffer.from('x'.repeat(STDERR_TAIL_BYTES)));
    tail.push('end');
    expect(tail.text()).toHaveLength(STDERR_TAIL_BYTES);
    expect(tail.text().endsWith('xend')).toBe(true);
  });
});
